[CmdletBinding()]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
$managedRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'IDCard-LAN'
$statusPath = Join-Path $managedRoot 'lan-status.json'
$statePath = Join-Path $managedRoot 'lan-state.json'
$ruleName = 'IDCard-Managed-LAN-8080'
$taskName = 'IDCard LAN forwarding'
$lanPort = 8080
$distro = 'Ubuntu'
function Save-Status([string]$state, [string]$message, [string]$url = '') {
    @{ state=$state; message=$message; url=$url; time=(Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Invoke-Native 'icacls.exe' @($statusPath, '/setowner', '*S-1-5-32-544')
}
function Invoke-Native([string]$exe, [string[]]$arguments) {
    & $exe @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$exe failed (exit $LASTEXITCODE)." }
}
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run Enable-Lan.ps1 from Administrator PowerShell.'
    }
    if (-not (Test-Path -LiteralPath $managedRoot)) { New-Item -ItemType Directory -Path $managedRoot | Out-Null }
    if ((Get-Item -LiteralPath $managedRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The managed folder must not be a junction or symbolic link.' }
    # A task running with elevation must never execute scripts writable by ordinary users.
    Invoke-Native 'icacls.exe' @($managedRoot, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX')
    Invoke-Native 'icacls.exe' @($managedRoot, '/setowner', '*S-1-5-32-544')
    foreach ($fileName in @('Enable-Lan.ps1','configure-lan.py','lan-status.json','lan-state.json')) {
        $existingFile=Join-Path $managedRoot $fileName
        if (Test-Path -LiteralPath $existingFile) {
            if ((Get-Item -LiteralPath $existingFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A managed file must not be a symbolic link.' }
            Invoke-Native 'icacls.exe' @($existingFile, '/reset')
            Invoke-Native 'icacls.exe' @($existingFile, '/setowner', '*S-1-5-32-544')
        }
    }
    if ($Install) {
        Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $managedRoot 'Enable-Lan.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'configure-lan.py') -Destination (Join-Path $managedRoot 'configure-lan.py') -Force
        foreach ($fileName in @('Enable-Lan.ps1','configure-lan.py')) {
            Invoke-Native 'icacls.exe' @((Join-Path $managedRoot $fileName), '/reset')
            Invoke-Native 'icacls.exe' @((Join-Path $managedRoot $fileName), '/setowner', '*S-1-5-32-544')
        }
    }
    Save-Status 'RUNNING' 'Preparing the local-network address.'
    $network = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if (-not $network) { throw 'No connected IPv4 network with a gateway was found.' }
    $lanAddress = $network.IPv4Address.IPAddress | Select-Object -First 1
    $parsedAddress = [Net.IPAddress]::Parse($lanAddress)
    if ($parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $lanAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
        throw 'The selected network is not a private IPv4 LAN; no forwarding was added.'
    }
    $wslAddresses = (& wsl.exe -d $distro -u root -- hostname -I | Out-String).Trim() -split '\s+'
    if ($LASTEXITCODE -ne 0) { throw 'Ubuntu could not be started.' }
    $wslAddress = $wslAddresses | Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d' } | Select-Object -First 1
    if (-not $wslAddress) { throw 'Ubuntu has no private IPv4 address.' }
    $origin = "http://${lanAddress}:$lanPort"
    $helper = Join-Path $managedRoot 'configure-lan.py'
    $windowsHelperPath = $helper.Replace('\','/')
    $linuxHelper = (& wsl.exe -d $distro -u root --exec wslpath -u $windowsHelperPath | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'The helper path could not be resolved in Ubuntu.' }
    Invoke-Native 'wsl.exe' @('-d',$distro,'-u','root','--','python3',$linuxHelper,'--origin',$origin,'--check')
    $previous = $null
    if (Test-Path -LiteralPath $statePath) { $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $lanPort -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @($lanAddress, '0.0.0.0', '::') }
    if ($listener -and (-not $previous -or $previous.listenAddress -ne $lanAddress)) { throw 'Port 8080 is already in use by another listener; no existing forwarding was replaced.' }
    Start-Service iphlpsvc
    if ($previous -and $previous.listenAddress -ne $lanAddress -and $previous.listenAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
        Invoke-Native 'netsh.exe' @('interface','portproxy','delete','v4tov4',"listenaddress=$($previous.listenAddress)","listenport=$lanPort")
    }
    Invoke-Native 'netsh.exe' @('interface','portproxy','add','v4tov4',"listenaddress=$lanAddress","listenport=$lanPort","connectaddress=$wslAddress",'connectport=80','protocol=tcp')
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name $ruleName -DisplayName 'ID Card - local subnet only' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $lanAddress -LocalPort $lanPort -RemoteAddress LocalSubnet -Profile Any | Out-Null
    $ready = $false
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        try { $probe=Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/health/ready" -TimeoutSec 3; if ($probe.StatusCode -eq 200) {$ready=$true; break} } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'The LAN forwarding health check failed. The original app address has not been changed.' }
    Save-Status 'RUNNING' 'Forwarding is ready; updating the app address.' $origin
    Invoke-Native 'wsl.exe' @('-d',$distro,'-u','root','--','python3',$linuxHelper,'--origin',$origin)
    $probe=Invoke-WebRequest -UseBasicParsing -Uri "$origin/api/health/ready" -TimeoutSec 15
    if ($probe.StatusCode -ne 200) { throw 'The final LAN readiness check failed.' }
    @{listenAddress=$lanAddress;port=$lanPort;wslAddress=$wslAddress;distro=$distro} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    Invoke-Native 'icacls.exe' @($statePath, '/setowner', '*S-1-5-32-544')
    if ($Install) {
        $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File `"$(Join-Path $managedRoot 'Enable-Lan.ps1')`""
        $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
        $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
        $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Refresh this ID Card installation forwarding after Windows sign-in; only local-subnet TCP 8080 is allowed.' -Force | Out-Null
    }
    Save-Status 'READY' 'LAN access is ready. localhost redirects to the LAN address.' $origin
} catch {
    if (Test-Path -LiteralPath $managedRoot) { Save-Status 'FAILED' $_.Exception.Message }
    Write-Error $_.Exception.Message
    exit 1
}

# Deployment

Traffic flows through Caddy on 80/443 to Next.js on `127.0.0.1:3000`. The worker has no public listener. PostgreSQL listens only on localhost. Both application units run as `idcard` with restrictive service settings and a private temporary directory.

`npm run build` builds the web app, worker and CLI in one command. The web application and worker share the same code and lockfile. The build currently uses Next.js's webpack option for repeatability across the tested Windows workspace and Ubuntu deployment.

The installer copies sources into a new release, runs dependency installation/build as the non-root service identity, migrates without destructive statements, changes release ownership to root and atomically switches the `current` symlink. Persistent storage stays outside releases.

The environment file is root owned, mode 600. systemd reads it and injects the process environment before switching to the `idcard` identity. Never copy it into a web-served folder, source archive or release artifact.

On a fresh Caddy install the default sample page is replaced after preserving its configuration. Existing customized configurations are retained and receive an import for the dedicated application snippet. Validation must succeed before reload. If a conflicting site exists, resolve it before rerunning.

Domains need correct A/AAAA records and inbound 80/443 for public certificate issuance. The application origin must agree with Caddy's public hostname. The installer preserves an existing origin and refuses a conflicting `--domain` argument.

Use `sudo idcardctl doctor` to check database version/role, migration presence, forced RLS, storage capacity/write access, queue, worker heartbeat, rendering, service status and Caddy syntax. The admin health page is `/admin/system/health` and requires Super Admin.

Use `idcardctl update <trusted-source-directory>` for upgrades. Daily root-only backups, staged recovery, compatibility-gated code rollback and three-release retention are implemented. Read BACKUP-RESTORE.md and test on a fresh Ubuntu staging server. Native systemd/Caddy/TLS execution has not been validated in the Windows development environment.

The service account can write application data directories but cannot replace releases, configuration or backup files. Backup operations run as root and use the local PostgreSQL administrator because forced row-level security must not omit tenants. Browser HTML uses a fresh script nonce; inline styles remain enabled for the designer and map layout.

Phase 22 adds privileged policy setup and security diagnostics; see HARDENING.md. Service units allow managed staged restored storage in addition to the initial storage root. Runtime definitions and the control script are refreshed by 0.22 update/rollback. V8 JIT remains enabled; no runtime browser is installed for PDF generation. Final dedicated-server acceptance is documented in ACCEPTANCE.md.

## Windows 11 / Ubuntu WSL local-network access

The optional `deploy/windows/Enable-Lan.ps1 -Install` helper runs in Administrator PowerShell. It forwards the Windows private LAN address on TCP 8080 to Ubuntu's port 80, allows only LocalSubnet clients through a dedicated Windows Firewall rule, and registers an at-sign-in forwarding refresh. It never opens a router port or enables an internet tunnel. Managed executable helpers are copied to the administrator-owned `C:\ProgramData\IDCard-LAN` directory with ordinary users limited to read/execute. Existing unrelated listeners are preserved.

The helper verifies forwarding before changing the installed app's APP_ORIGIN. The WSL companion validates Caddy configuration, privately backs up the environment and Caddy site under `/etc/idcard/lan-backups`, restarts the app and worker, and restores the original configuration if readiness fails. `localhost` then redirects to the LAN URL so login security and generated form links use the correct address. Existing domain configurations are preserved.

The LAN helper reports your hosting PC's address, for example `http://192.168.1.100:8080`. Connect applicant devices to that LAN and keep the hosting PC awake. Reserve its IP address in the router so shared links remain valid. Windows guest-network isolation can prevent devices from reaching each other. Status is recorded without credentials in `C:\ProgramData\IDCard-LAN\lan-status.json`. After manually restarting WSL, run the **IDCard LAN forwarding** scheduled task to refresh its target address.

Use a stable HTTPS domain for internet deployment. The LAN helper does not configure an internet tunnel or router port forwarding.

#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
failed=0
check() { local label=$1 fix=$2; shift 2; if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s: %s\n' "$label" "$fix" >&2; failed=1; fi; }
firewall() { ufw status verbose | grep -q 'Status: active' && ufw status verbose | grep -q 'deny (incoming)'; }
updates() { local setting; setting=$(apt-config shell IDCARD_UPGRADE_PERIOD APT::Periodic::Unattended-Upgrade); [[ $setting == "IDCARD_UPGRADE_PERIOD='1'" ]]; }
postgres_local() { local listeners; listeners=$(ss -H -ltn '( sport = :5432 )'); [[ -n $listeners ]] && ! awk '{print $4}' <<<"$listeners" | grep -Ev '^(127\.0\.0\.1|\[::1\]|::1):5432$'; }
web_local() { local listeners; listeners=$(ss -H -ltn '( sport = :3000 )'); [[ -n $listeners ]] && ! awk '{print $4}' <<<"$listeners" | grep -Ev '^127\.0\.0\.1:3000$'; }
check 'Firewall active / incoming denied' 'Run deploy/scripts/harden.sh and review ufw rules.' firewall
check 'Daily unattended upgrades' 'Install unattended-upgrades and restore the ID Card apt policy.' updates
check 'APT update timer' 'Enable apt-daily.timer.' systemctl is-enabled --quiet apt-daily.timer
check 'APT upgrade timer' 'Enable apt-daily-upgrade.timer.' systemctl is-enabled --quiet apt-daily-upgrade.timer
check 'Daily backup timer' 'Enable idcard-backup.timer.' systemctl is-active --quiet idcard-backup.timer
check 'PostgreSQL listener restricted' 'Set listen_addresses=localhost and restart the cluster.' postgres_local
check 'Web listener restricted' 'Use the supplied loopback-only web unit.' web_local
check 'Environment private' 'Set root ownership and mode 600 on the environment file.' test "$(stat -c '%U:%a' /etc/idcard/idcard.env)" = root:600
check 'Storage root protected' 'Set root:idcard ownership and mode 750 on managed storage.' bash -c 'set -a; source /etc/idcard/idcard.env; set +a; [[ $(stat -c "%U:%G:%a" "$STORAGE_ROOT") == root:idcard:750 ]]'
if [[ -f /var/run/reboot-required ]]; then echo 'ACTION: a reboot is required. Schedule it after a verified backup.'; fi
if [[ -f /etc/fail2ban/jail.d/idcard-sshd.local ]]; then check 'Optional SSH bans' 'Inspect the fail2ban service journal.' fail2ban-client status sshd; fi
exit "$failed"

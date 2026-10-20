#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
fail2ban=false
case "${1:-}" in --fail2ban) fail2ban=true;; '') :;; *) echo 'Usage: harden.sh [--fail2ban]' >&2; exit 2;; esac
source /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 22.04 || $VERSION_ID == 24.04 ) ]] || { echo 'Ubuntu 22.04/24.04 required.' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
apt-get install -y ufw unattended-upgrades
# Preserve all configured SSH listener ports before enabling the firewall.
ports=(22)
if command -v sshd >/dev/null; then
  sshd -t
  ssh_configuration=$(sshd -T)
  while read -r port; do [[ $port =~ ^[0-9]+$ ]] && ports+=("$port"); done < <(awk '$1=="port" {print $2}' <<<"$ssh_configuration")
fi
if [[ -n ${SSH_CONNECTION:-} ]]; then
  read -r client_ip client_port server_ip server_port <<<"$SSH_CONNECTION"
  [[ $server_port =~ ^[0-9]+$ ]] || { echo 'Cannot identify current SSH port; firewall not changed.' >&2; exit 1; }
  ports+=("$server_port")
fi
for port in "${ports[@]}"; do ufw allow "$port/tcp"; done
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw logging low
ufw --force enable
install -m 644 "$script_dir/../security/52idcard-upgrades" /etc/apt/apt.conf.d/52idcard-upgrades
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
if $fail2ban; then
  command -v sshd >/dev/null || { echo 'Fail2ban SSH protection requires an installed SSH server.' >&2; exit 1; }
  apt-get install -y fail2ban
  install -d -m 755 /etc/fail2ban/jail.d
  port_list=$(printf '%s\n' "${ports[@]}" | sort -un | paste -sd, -)
  printf '[sshd]\nenabled = true\nbackend = systemd\nport = %s\nmaxretry = 6\nfindtime = 10m\nbantime = 1h\n' "$port_list" >/etc/fail2ban/jail.d/idcard-sshd.local
  fail2ban-client -t
  systemctl enable --now fail2ban
  systemctl restart fail2ban
  fail2ban-client status sshd
fi
if [[ -f /etc/idcard/idcard.env && -L /opt/idcard/current ]]; then
  for unit in idcard-web.service idcard-worker.service idcard-backup.service idcard-backup.timer; do
    install -m 644 "$script_dir/../systemd/$unit" "/etc/systemd/system/$unit"
  done
  install -m 755 "$script_dir/idcardctl" /usr/local/bin/idcardctl
  systemctl daemon-reload
  systemctl restart idcard-web idcard-worker
fi
echo 'Hardening applied. Existing firewall rules and SSH authentication settings were preserved.'
echo 'Review ufw status numbered for pre-existing extra allowances. Reboots remain administrator-controlled.'
ufw status verbose

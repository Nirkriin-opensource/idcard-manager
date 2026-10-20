# Production hardening — phase 22

The installer applies these policies to a dedicated Ubuntu 22.04/24.04 server. Do not run server installation scripts against an unrelated shared computer. `scripts/linux-check.sh` is the non-root alternative for temporary application testing.

```bash
sudo idcardctl harden
sudo idcardctl security
sudo idcardctl doctor
sudo idcardctl test
```

Optional SSH brute-force protection:

```bash
sudo idcardctl harden --fail2ban
```

Hardening installs UFW and unattended-upgrades. It preserves configured SSH listener ports and the current SSH connection port before enabling an incoming-deny firewall. Ports 80/443 are allowed. Existing explicit rules are retained, so inspect `sudo ufw status numbered` for extra allowances; no shared rule is silently deleted. Custom SSH authentication settings are left unchanged. Confirm a separate SSH session works before closing your current session.

The apt drop-in enables daily package-list updates and unattended Ubuntu security updates while retaining existing administrator origin policy. Automatic reboots and automatic unused-dependency removal are off. Third-party Node/PostgreSQL/Caddy repositories need their own reviewed upgrade maintenance. Updates can restart services; plan a maintenance window and monitor `/var/log/unattended-upgrades`. If `/var/run/reboot-required` exists, take a verified backup and schedule a reboot.

Optional Fail2ban installs a journald-backed sshd jail using all detected SSH ports, six attempts in ten minutes and a one-hour ban. Review network allowlists and shared NAT access before enabling on a server used by many administrators. It does not add an application-login jail; the app already has persistent sign-in and API throttles.

Web and worker units use an unprivileged identity, no ambient capabilities, a read-only system filesystem, private temporary/device namespaces, protected kernel settings/logs/clock, restricted namespaces/address families and private file creation. V8 executable memory remains available. Both original and staged restored storage locations are writable subject to filesystem ownership; releases and configuration remain protected. Applying hardening refreshes units and restarts web/worker; jobs recover from durable state. Updates/rollbacks also install the selected release's runtime definitions.

`idcardctl security` checks firewall mode, update/backup timers, loopback-only listeners and private configuration/storage permissions. It reports missing listeners as failures. It does not infer that a printer, certificate renewal or recovery drill passed.

Read-only offline systemd analysis was run with Ubuntu systemd 255: both units reported exposure 2.9 (OK). That is a configuration heuristic, not proof of runtime sandbox compatibility or an independent security audit. Native service installation, firewall activation and full recovery still need a fresh-server rehearsal.

Upgrading from 0.20.0: take an off-server backup, use `idcardctl update <reviewed-source>`, then run `sudo bash /opt/idcard/current/deploy/scripts/harden.sh` once to refresh the older control script/runtime units and apply phase-22 policies. Run doctor/security/test and rehearse staged recovery. The 0.22 control script supports `idcardctl harden` for subsequent changes.

References: [Ubuntu automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/), [Ubuntu firewall](https://documentation.ubuntu.com/server/how-to/security/firewalls/index.html), [systemd execution controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html). CI uses pinned commits from the official [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node) and [upload-artifact](https://github.com/actions/upload-artifact) repositories.

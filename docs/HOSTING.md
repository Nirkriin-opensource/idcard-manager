# Host IDcard Manager

## What the package contains

One source archive includes the native Ubuntu installer, web application, background worker, all ten database migrations, PostgreSQL/Caddy/systemd configuration templates, source, tests, documentation, lockfile, MIT license and third-party notices. `SBOM.cdx.json`, `SOURCE-MANIFEST.json` and internal `SHA256SUMS` document the exact package contents. Personal data, users, photos, credentials, database dumps, backups, build output, fonts copied from a developer's PC and local delivery reports are excluded.

This is an internet-connected installer, not an offline binary or Windows executable. It downloads signed operating-system packages and npm dependencies and builds on the target platform. Use a dedicated Ubuntu 22.04/24.04 LTS VM/VPS with systemd, at least 2 GB RAM (4 GB recommended for building), 10 GB initial free disk and additional capacity for images, exports and backups. A clean installation checks these prerequisites; do not run it on an unrelated shared server.

## Install on a dedicated Ubuntu host

1. Point a domain such as `cards.example.org` to the host. Allow your SSH port and public HTTP/HTTPS ports 80/443. Check cloud firewall rules as well as the host firewall.
2. Download `idcard-manager-0.23.1.tar.gz` and `SHA256SUMS.txt` from the project's tagged GitHub release. Obtain them from a trusted release; checksums provide integrity, not independent certification of the publisher.
3. Verify, extract and install:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
tar -xzf idcard-manager-0.23.1.tar.gz
cd idcard-manager-0.23.1
sha256sum --check SHA256SUMS
sudo bash install.sh --domain cards.example.org --email your-admin@example.org --non-interactive
```

Use your real hostname and administrator login. The installer installs Node.js 24, PostgreSQL 16, Caddy, fonts and runtime services; creates private storage and random credentials; and configures update/backup timers and firewall policy. It preserves existing data and credentials on rerun. Review installer output and retain SSH access while configuring the firewall.

4. Open `https://cards.example.org`. Use the administrator login and unique temporary password printed by the installer. Change the password at first sign-in. No shared default password is shipped.
5. Create an organization, configure fields/time/branding, then use Setup. Follow People → Photos → Template → Generate → Download. Keep API and public verification access limited to required fields.
6. Verify the host:

```bash
sudo idcardctl status
sudo idcardctl doctor
sudo idcardctl security
sudo idcardctl test
```

Check the actual HTTPS certificate and renewal, worker progress, a sample export and a physical print/scan. A passing diagnostics script alone does not establish public-launch acceptance.

## Initial administrator on an empty migrated database

`sudo idcardctl setup-admin` creates `admin@idcard.local` only if no users exist, prints one random temporary password and requires a password change. Supply an email argument for another login. It does not overwrite existing accounts, recreate a deleted admin on startup or expose a public bootstrap route. The regular installer uses the email you supply.

## Windows 11 and Ubuntu WSL

Use WSL for development or a controlled LAN deployment. The same archive can be extracted inside Ubuntu WSL; systemd must be enabled. Optional local forwarding is documented in [deployment](DEPLOYMENT.md). A PC going to sleep, restarting WSL or changing its LAN address can interrupt access. For public hosting, use the dedicated-server path above with stable DNS and HTTPS.

## Back up, update and recover

```bash
sudo idcardctl backup
sudo idcardctl update /path/to/reviewed/idcard-manager-source
sudo idcardctl doctor
```

Copy backups off the host with encryption and controlled key access. Test a full restore using [backup and restore](BACKUP-RESTORE.md) before relying on them. Updates take a safety backup, build a separate release, apply migrations and switch services. Follow documented matching-version restore/rollback rules; code rollback does not undo database migrations.

Ordinary deletion is recoverable. Admin Recycle bin permanent purge requires a preview and PURGE confirmation; shared assets and historical backups remain protected. Do not use purge to bypass legal, contractual or incident-retention requirements.

## Before inviting the public

Complete [public-launch review](PUBLIC-LAUNCH-REVIEW.md), [security](../SECURITY.md), [hardening](HARDENING.md) and [acceptance](ACCEPTANCE.md). Native MFA, encrypted off-server backup operations and independent VAPT are not provided as completed certifications by this package. Use a tested access layer for administrator MFA, verify tenant isolation, define privacy/retention and incident procedures, and fix/retest security findings before unrestricted public launch.

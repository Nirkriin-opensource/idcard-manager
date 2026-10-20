# IDcard Manager

Self-hosted identity data collection, card design and printing. **Version 0.23.1 · MIT license.**

Manage an organization’s people and photos, collect responses through shareable forms, design one reusable General card template, generate cards in the background and download print-ready files.

## Host from one package

Download the tagged hosting archive and checksum file from [GitHub Releases](https://github.com/Nirkriin-opensource/idcard-manager/releases).

On a dedicated Ubuntu 22.04/24.04 LTS server:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
tar -xzf idcard-manager-0.23.1.tar.gz
cd idcard-manager-0.23.1
sudo bash install.sh --domain cards.example.org --email your-admin@example.org --non-interactive
```

Replace the hostname and login with your own. Installation downloads dependencies and builds on the target server; it is not an offline binary. The package includes the installer, source, all migrations, lockfile, documentation, SBOM and checksums. No user accounts, passwords, personal data, photos, database dumps or backups are included.

The installer creates a unique temporary administrator password and requires a password change. It preserves existing data and credentials on rerun. **There is no shared default password.** See [hosting instructions](docs/HOSTING.md), [installation](docs/INSTALLATION.md) and [first-admin setup](docs/INSTALLATION.md).

## Daily workflow

1. **Organization:** configure branding, required fields, time zone, numbering and team access.
2. **People / Forms / Imports:** add people, validate spreadsheets, or review and approve self-service responses.
3. **Photos:** upload individual images or ZIP batches, preview bulk matches and assign portraits.
4. **Templates:** edit the front/back, place dynamic fields and preview with a real record.
5. **Cards / Jobs:** generate a sample or queue a batch. New batches capture current details and photos.
6. **Exports:** download PNG/JPG/PDF/ZIP files and print sheets. Print PDFs at actual size / 100%.

Manage data provides task search and shortcuts. Existing themes remain available. Card fields, languages, fonts, logos, signatures and layouts are configurable. Templates use archive/restore. People and Photos have checkboxes, bulk deletion and restoration. Admin Recycle bin purge previews related data and requires typed confirmation; backup copies remain subject to their separate retention policy.

## Included capabilities

- Tenant organization roles and PostgreSQL row-level security.
- Shareable forms, profession/practice presets, custom fields and review history.
- CSV/XLSX imports, photo ZIP upload and bulk matching, cropping and local face framing.
- Front/back designer, themes, dynamic text, photos, signatures, logos, QR and barcodes.
- Background generation, frozen card snapshots, lifecycle history and public verification controls.
- Image/PDF exports, print profiles, duplex sheets, audit history and operational diagnostics.
- Native PostgreSQL/Caddy/systemd installation, private storage, backups, staged updates and recovery tools.

## Production operation

Use stable DNS and HTTPS for public hosting. Native application MFA is not implemented; protect administration with a tested MFA access layer. Configure encrypted off-server backups, perform a restore drill, establish privacy/retention and incident procedures, and commission independent security testing before unrestricted public launch. This package is not a security certification.

Read [security policy](SECURITY.md), [public-launch review](docs/PUBLIC-LAUNCH-REVIEW.md), [hardening](docs/HARDENING.md), [acceptance](docs/ACCEPTANCE.md) and [backup/recovery](docs/BACKUP-RESTORE.md).

Windows 11 / Ubuntu WSL is supported for development and controlled LAN use; see [deployment](docs/DEPLOYMENT.md). Use a dedicated Ubuntu server for stable public hosting.

## Development and verification

Requires Node.js 24. PostgreSQL 16 integration tests create their own isolated cluster and use synthetic data. Run as a regular user, not root.

```bash
npm ci
npm run check
npm run package:production
```

Windows browser tests use Edge by default. Linux/CI uses Chromium (`npx playwright install --with-deps chromium`, then set `PLAYWRIGHT_CHANNEL=chromium`). Default isolated test ports are PostgreSQL 55432 and web 3107; override using IDCARD_TEST_PG_PORT / IDCARD_TEST_HTTP_PORT when needed.

Generated hosting assets are in `.production-dist/`. The package policy excludes runtime storage, backups, environment secrets, local reports and build output. The tagged release workflow tests and packages the source before uploading hosting assets.

## Documentation and contribution

[User guide](docs/USER-GUIDE.md) · [API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Contributing](CONTRIBUTING.md) · [Third-party notices](THIRD-PARTY-NOTICES.md)

Application source is licensed under [MIT](LICENSE). Dependencies, detector data, test fixtures and user-supplied fonts/images retain their respective licenses; preserve the included notices.

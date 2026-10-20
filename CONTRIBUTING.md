# Contributing

Use synthetic records and licensed test fixtures. Never commit deployment secrets, uploaded photos, real-person spreadsheets, storage, databases, backups or local delivery reports.

Use Node.js 24 and PostgreSQL 16. Install with `npm ci`, then run `npm run check`. Integration tests create an isolated PostgreSQL cluster; run them as an ordinary user, not root. Windows defaults to Edge; Linux CI installs Chromium.

Submit a focused pull request describing the problem, resulting behavior and verification. Preserve role checks, tenant isolation, immutable history, migration checksums and recovery behavior. Add a new database migration instead of editing an already-applied migration.

Contributions are provided under the project's MIT license. Preserve third-party license notices and source attribution. Review changes to installation, retention, public forms or authentication carefully; do not silently weaken security or introduce destructive defaults.

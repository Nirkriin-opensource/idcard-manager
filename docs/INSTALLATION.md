# Installation

## Ubuntu server or VPS

Use Ubuntu 22.04/24.04 LTS. The installer checks the OS, root privileges, RAM, available root disk and registry connectivity. It installs Node 24, PostgreSQL 16, Caddy, ufw, fonts and native build prerequisites through signed apt repositories. It does not install Chromium on the production server: rendering uses sharp. Browser tests are a development dependency.

```bash
sudo ./install.sh --domain cards.example.org --email admin@example.org --non-interactive
```

Use `--demo-data` only to explicitly create a separate DEMO organization with ten sample people and a template. Demo seeding is idempotent. No demo accounts or predictable passwords are created.

The administrator email and temporary password are printed in the terminal. A rerun does not reset an existing user's password. Save the password privately and replace it on first login.

For a migrated, completely empty database, `sudo idcardctl setup-admin` creates the initial account with login **admin@idcard.local**, a unique random temporary password printed once, and a required first-login password change. Supply `sudo idcardctl setup-admin your-admin@example.org` to choose another login. The command refuses to create any account when users already exist; it never resets an existing password. There is no shared default password, public setup endpoint or automatic account recreation at startup. Keep the printed password private. Existing installations continue using their existing logins.

On an existing PostgreSQL host, the installer requires PostgreSQL 16/main on port 5432. It refuses to delete or repurpose another cluster. Existing environment credentials are retained. Resolve conflicting clusters or credentials manually before retrying.

The installer adds ufw rules for ports 22, 80 and 443. It preserves existing firewall rules to avoid removing another service's access. On a fresh server these are the application access rules; review an existing server's rules separately.

## Local development on Ubuntu VM / WSL2

Install Node 24 and PostgreSQL 16. Create a non-superuser application role and a database owned by it. Use `psql`'s interactive `\password` command rather than putting a password in shell history:

```sql
CREATE ROLE idcard LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password idcard
CREATE DATABASE idcard OWNER idcard;
```

Create a private local environment file from `.env.example` and set the actual credentials. This local file is ignored by source packaging. Do not use the example password.

```bash
npm ci
set -a
source .env.local
set +a
npm run migrate
npm run admin -- admin@example.org
npm run build
npm start
```

In another terminal with the same environment:

```bash
npm run worker
```

For development hot reload use `npm run dev`. `APP_ORIGIN` must match the browser's exact origin, including the port; `http://localhost:3000` differs from `http://127.0.0.1:3000`. Origin and CSRF checks intentionally reject mismatches.

On Windows PowerShell, assign the values with `$env:DATABASE_URL`, `$env:APP_ORIGIN` and `$env:STORAGE_ROOT` instead of sourcing a Bash file. The target deployment remains Ubuntu.

## Build resources

Two GB is the minimum installation check, not a guarantee that a low-memory host can build Next.js alongside PostgreSQL without swap. If the build is killed, add RAM or administrator-managed swap and rerun. Do not repeatedly restart an out-of-memory build against a busy production server.


## Completing setup and hardening

After the first password change, create your organization and open Setup. Progress is stored per user/organization in this browser; choose the same organization after reloading. The wizard saves real assets, templates, cards and print profiles. A sample remains DRAFT until deliberately activated in Cards. Your logo is optional; a matched portrait is required by the starter design. Use Templates to customize an existing or starter layout.

The installer also configures phase-22 UFW/security updates. `--fail2ban` enables optional SSH protection. Run `idcardctl security` and read HARDENING.md before public deployment. The code archive includes Unix line endings; preserve them when editing shell scripts on Windows. Never save the installer with CRLF line endings.

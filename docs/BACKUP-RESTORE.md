# Backup, restore and releases

Run these commands on the Ubuntu server with sudo. Operations require the managed local PostgreSQL 16/main cluster on port 5432 and real storage under /var/lib/idcard/storage or /var/lib/idcard/restored; invalid configurations are refused before changing storage permissions. Backups contain identity data and database credentials: keep them private and make encrypted off-server copies. Local root-only archives are not encrypted. The backup directory is protected from the application account.

## Backup

```bash
sudo idcardctl backup
systemctl list-timers idcard-backup.timer
```

The command stops previously running web/worker services, uses PostgreSQL's local administrator to dump every forced-RLS tenant table, copies managed storage and configuration, then resumes services. A private stage becomes `backups/backup-YYYY-MM-DD-HHMMSS.tar.gz` with per-file SHA-256 manifest and an adjacent archive checksum. A failed capture returns an error; it never announces a successful backup. Daily systemd backups run around 02:30 with a random delay and retain matching backups for 14 days. UTC is used in filenames. Preserve the checksum separately when copying off server. A checksum detects corruption; it does not establish the trustworthiness of a supplied archive.

## Restore

```bash
sudo idcardctl restore /absolute/path/backup-2026-10-18-023000.tar.gz
```

Type RESTORE in an interactive terminal. Validation rejects unknown entries, traversal, links, duplicates, oversized contents, missing files, unsafe configuration keys and checksum mismatches. Restore requires the matching application version and enough disk for staged and retained data. Only use archives from a trusted administrator: a PostgreSQL dump is executable database input.

A fresh safety backup is taken before changes. Recovery uses a new database and storage directory; the current database and storage remain available. The current domain and database credentials are preserved. After recovery, a readiness check must pass. Failure after switching configuration restores the old configuration and restarts services; failed staging databases/directories remain for diagnosis. Native root/systemd recovery must be rehearsed on a separate Ubuntu server before relying on it.

## Update

```bash
sudo idcardctl update /absolute/path/to/trusted/idcard-source
```

Use reviewed source with its package-lock.json. Source build/install scripts execute as the service account. The command takes a backup, copies into a new release, installs locked dependencies, builds web/worker/CLI, runs transactional non-destructive migrations, switches the active symlink and restarts. A health check gates success. Three releases are retained. Data is outside releases. If health fails, code rollback is attempted only if compatible; otherwise services stop and the safety backup path is reported. Migration files already applied must never be edited.

## Rollback and uninstall

```bash
sudo idcardctl rollback
sudo idcardctl uninstall
sudo idcardctl uninstall --purge
```

Rollback switches code to the previous compatible release; **the database is not rolled back**. If a release cannot understand every applied migration, rollback is refused. Use matching-version staged recovery instead.

Uninstall removes application service definitions and its Caddy snippet while retaining database, releases and data. Purge requires two exact interactive confirmations and then removes fixed managed directories and the currently configured managed database. It retains shared PostgreSQL/Caddy packages and unrelated databases. Retained old restore databases are not removed automatically. Export backups off server before purging.

Operations hold a root-only lock. After a crash, verify no operation remains before an administrator removes `/run/idcard/operations.lock`. Inspect `/var/lib/idcard/operations` for retained private failure stages and remove only after diagnosis. Never overwrite selected live database tables or copy storage over a running instance.

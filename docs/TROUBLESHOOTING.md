# Troubleshooting

| Symptom | Likely cause | What to try |
|---|---|---|
| Login security/origin failure | Browser URL differs from APP_ORIGIN | Use the configured hostname/scheme/port; update environment and Caddy together, then restart |
| Sign-in throttled | Too many attempts for that email/address | Wait 15 minutes; verify credentials before retrying |
| Password change required | Initial temporary password is still active | Change it using the first-login form |
| Database connection fails | PostgreSQL stopped, wrong credentials or conflicting port | Check `sudo systemctl status postgresql@16-main` and the protected environment file |
| Migration checksum mismatch | An applied migration was modified | Restore its original contents; implement subsequent changes in a new migration |
| Foreign-reference error | Unit/photo/template belongs to another organization | Select an object in the currently selected organization |
| Permission denied | Role cannot perform the action | Ask Org Admin to assign the correct organization role |
| Imported ID duplicates | Existing person or repeated ID in the file | Correct the source file and upload it again; imports do not silently overwrite |
| Image rejected | Unsupported format, animation, corrupt data or excessive size | Re-export a single-frame JPEG/PNG/WebP below 12 MB and 40 megapixels |
| Crop rejected | Bounds exceed normalized image dimensions | Use the displayed width/height and valid pixel coordinates |
| Photo did not auto-match | Filename does not match exactly, or custom value is not unique | Select the right field or visually match the uploaded photo |
| Text overflows | Bound value is longer than the text box permits | Enlarge the box or reduce font size; preview with long values |
| Binding has no value | Misspelled or undefined field key | Create the field or correct the binding; use the key rather than display label |
| QR too small/low contrast | Inadequate module resolution or colors | Increase size/DPI and use dark modules on white |
| Barcode invalid | Format-specific length/character/checksum mismatch | Correct data or choose Code 128 for general IDs |
| Verification returns 404 | Invalid token, incorrect APP_ORIGIN or wrong deployment | Scan the current card, check the configured domain and inspect card history. DRAFT is not valid until activated |
| Worker unhealthy | Worker stopped, queue connection failed or heartbeat stale | `sudo idcardctl logs worker`, then fix DB connectivity and restart |
| Caddy validation fails | Duplicate site, malformed config or existing port binding | Inspect the dedicated snippet and existing Caddy sites; do not delete another service's configuration |
| Certificate not issued | DNS/AAAA points elsewhere or ports 80/443 blocked | Correct DNS and firewall; inspect `journalctl -u caddy` |
| Build is killed | Insufficient RAM | Add memory or administrator-managed swap, then rerun |

Start with `sudo idcardctl doctor`, then inspect the named service journal. Errors intentionally avoid printing credentials or request bodies. Include the failure time and affected action when contacting the deployment owner.


| New workflow problem | Likely cause | What to try |
|---|---|---|
| PDF sheet rejected | Cards do not fit without scaling | Reduce rows/columns, bleed, gaps or margins; use larger paper |
| JPEG rejected | Code would be too degraded | Use quality 85+ or lossless PNG |
| Job remains queued | Worker stopped or dispatcher/database unavailable | Inspect worker journal and heartbeat; restart worker; do not resubmit with a fresh key |
| Failed item after retry | Pinned input has a binding/photo/template error | Correct source and submit a new job; retry reuses the original input |
| Public page shows no fields | Default private configuration or non-ACTIVE state | Org Admin chooses approved non-private fields in Privacy; inspect current state |
| Locations denied | Optional feature is off | Enable in Privacy before storing coordinates or using Map elements |
| Restore validation fails | Wrong version, corrupt or unsupported archive | Keep original untouched; verify checksum and restore on matching version with enough space |
| Code rollback refused | Old release lacks applied migration knowledge | Use matching-version staged recovery; DB is never silently reversed |


## PostgreSQL startup: idcard.conf Permission denied

An installer permission bug under umask 077 created the non-secret PostgreSQL include as root:root mode 600. PostgreSQL could not read it. The installer now sets mode 644 before restarting the cluster. This correction does not change database credentials or recreate data.

For an older extracted installer, add `chmod 644 /etc/postgresql/16/main/conf.d/idcard.conf` immediately before the PostgreSQL restart step. Repair the existing configuration and start the cluster:

```bash
sudo chmod 644 /etc/postgresql/16/main/conf.d/idcard.conf
sudo systemctl start postgresql@16-main
pg_isready -h 127.0.0.1 -p 5432
```

Confirmed on the affected Ubuntu WSL installation: service active; 127.0.0.1:5432 accepting connections. Resume the patched installer afterward. Do not change permissions on /etc/idcard/idcard.env: it must stay root-owned mode 600.


## Services say Cannot find module although build files exist

Root-owned generated directories must remain readable/traversable by idcard. An installer using umask 077 left node_modules/.next/dist with private modes after changing ownership. The installer and update command now run `chmod -R a+rX` on the code release after ownership changes, before activation. This does not change configuration or stored-data permissions.

For an affected older deployment, verify `readlink -f /opt/idcard/current` points to the expected managed release. Apply `sudo chmod -R a+rX /opt/idcard/current/` to that code release only, then `sudo idcardctl restart` and `sudo idcardctl test`. Update the extracted installer as well so rerunning it preserves code access.

An older unattended-upgrade checker could falsely fail because grep exited early under pipefail. The corrected check uses `apt-config shell` to read the exact interval; it does not weaken or change the upgrade policy. HTTP-only Caddy warnings are expected for localhost installations and do not mean TLS is configured.

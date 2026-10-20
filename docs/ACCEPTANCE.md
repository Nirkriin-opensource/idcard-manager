# Final acceptance and evidence

Release 0.22.0 completes the implementation of phases 1–22. It does not declare deployment and hardware acceptance complete without evidence from the target server and printer.

## Automated coverage

`npm run check` runs typecheck → unit checks → full build → integration/browser tests. The integration cluster uses random credentials, a non-superuser PostgreSQL 16 role and private storage/test-* directories. It does not connect to your production database. Default ports are PostgreSQL 55432 and web 3107; isolated parallel runners can set IDCARD_TEST_PG_PORT / IDCARD_TEST_HTTP_PORT. Build before integration tests. Windows defaults to Edge; CI uses installed Chromium. Linux tests must run as a regular user. IDCARD_SKIP_BROWSER=1 explicitly marks the browser test skipped and never counts it as passed.

Coverage includes tenant/RBAC/CSRF checks, imports and photo matching, immutable template/render/history, independent code decoding, PDF physical geometry, background jobs, live verification privacy/status/expiry, bearer token limits/revocation, audit immutability, map opt-in, 10,000-record pagination and setup persistence. The volume acceptance imports a 100-row XLSX, matches 100 photos, kills the worker during generation, resumes without duplicate numbers and exports 100 two-sided cards as 26 A4 pages.

Windows evidence: delivery/build-22.log, unit-tests-22.log, integration-22.log, typecheck-22.log, dependency-audit-22.json. Linux evidence: linux-final-22.log. Offline systemd reports: systemd-web-22.log and systemd-worker-22.log. Native shell checks: shell-syntax-22.log. Screenshots ending -22.png contain synthetic data.

Ubuntu 24.04 WSL was used for a non-root temporary build/unit/API/PostgreSQL/worker/PDF run with checksum-verified Node 24.22.0. Browser acceptance runs separately under Windows Edge. WSL is not a fresh server installation. The GitHub Actions Ubuntu 22.04/24.04 matrix is configured and pinned but has not been run here.

## Dedicated-server and hardware rehearsal — still required

Use a disposable Ubuntu VM/VPS with its own hostname and synthetic records. Keep existing production data away from this rehearsal.

1. Extract the source, verify its SHA-256, then run `sudo ./install.sh --domain cards.test.example.org --email your-admin-address`. Inspect the install output and certificates; run doctor/security/test. No real address is embedded in source.
2. Change the temporary password. Follow Setup: create organization, upload logo, create starter template, import 100 Excel rows, upload a ZIP containing matching ID filenames, inspect a sample and save print settings.
3. Generate all 100 through Jobs; close the browser and reopen progress. Download PNG and duplex PDF; verify dimensions, portrait matching and both sides.
4. Print at actual size/100%, with fit-to-page off. Measure a CR80 trim (85.60 × 53.98 mm), inspect duplex registration, then scan QR and supported barcodes from the physical stock using actual devices. Test both sides/orientations and intended lighting. Record printer model, driver, feed settings and scanner results.
5. Activate a sample and scan its public URL. Show only approved fields, mark LOST and confirm it immediately changes. Reissue and confirm the old token stays REPLACED and new token follows new status.
6. Run backup; copy archive/checksum off server. Update from a second reviewed source directory; verify service units and data. Test compatible code rollback and confirm the database is not silently reverted.
7. Restore the trusted matching-version archive into staged database/storage; confirm services can write new photos/exports in restored storage, old data remains retained and public verification still works. Run doctor/security/test again. Try a corrupt archive and confirm rejection before live changes.
8. Check daily backup and apt timers, SSH access after firewall activation, Caddy HTTPS renewal, disk capacity and reboot-required maintenance. If optional Fail2ban is enabled, verify the jail and administrative access policy.

Record timestamps and actual outcomes for each step. Application diagnostics alone cannot certify physical printing or restore/update behavior. Do not mark these steps passed merely because scripts exist or unit tests pass.

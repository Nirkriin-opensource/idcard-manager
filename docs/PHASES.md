# Phase delivery

The original phase 1–10 delivery was release 0.10.0; the current integrated release is 0.22.0. Source snapshots in `delivery/phase-01.md` through `delivery/phase-10.md` provide complete contents for each phase's relevant files. Shared files are shown in their final integrated form, not an invented historical commit sequence. The source archive includes the exact package lock.

[Open all phase reports and verification logs](../delivery/README.md).

| Phase | Implemented | Verification |
|---|---|---|
| 1 | Source repository, one build, native installer, Caddy, two systemd units, service controls | Build and Bash syntax checked; fresh Ubuntu execution remains a deployment gate |
| 2 | PostgreSQL 16 migrations, checksums, forced RLS, tenant foreign keys, immutable history | Real PostgreSQL 16, migration rerun, non-superuser RLS and cross-tenant rejection |
| 3 | Argon2id, sessions, first password change, roles, CSRF, Origin, throttling | Authenticated API/browser flow, CSRF/Origin rejection, Viewer mutation and tenant denial |
| 4 | Organizations, typed units/custom fields, people editing, combined filters, pagination | Two organizations, custom values, unit references and 10,000-record pagination |
| 5 | CSV/XLSX upload, mapping, validation, preview, duplicate detection, error reports, atomic import | CSV/XLSX parsing, formulas rejected, duplicate batch blocked, commit once, Excel error report read back |
| 6 | Single/multiple/drag-drop/ZIP photos, ID/custom-field matching, manual matching, normalization, thumbnails, crops, replacement/removal | Real images, ZIP matching, thumbnail bounds, crop dimensions, original preservation and tenant protection |
| 7 | Front/back editor, physical units, text/images/shapes/codes, transforms, layers, lock, undo/redo, copy/paste, alignment, snap, rulers, zoom, version create/duplicate/archive/restore/default | Template schema/version immutability plus actual browser designer/preview workflow |
| 8 | Built-in/custom bindings, escaped resolved text, missing-field and overflow errors | Binding resolution, inherited-key rejection, XML escaping, overflow rejection |
| 9 | QR and Code 128/39/EAN/UPC; error correction, colors, sizing and scan guards | Independent decoding of generated images; invalid code data/contrast/size rejected |
| 10 | Authoritative front/back PNG rendering, card number allocation, private saved renders, immutable snapshots | Real person/photo/template generation, exact dimensions/DPI and unchanged historical output after template edit |

## Commands

On a development machine after `npm ci`:

```bash
npm run typecheck
npm test
npm run build
npm run test:integration
```

Build before integration tests: the test launches the compiled worker and production Next.js server. Use the browser setup described in README. Integration data is generated with fresh random credentials and is isolated under storage/test-*.

On a fresh Ubuntu staging server:

```bash
sudo ./install.sh --domain cards.example.org --email admin@example.org
sudo idcardctl doctor
sudo idcardctl test
```

Then sign in, change the temporary password, create an organization, define fields, import a file, upload matching photos, design both sides, render a preview and generate a DRAFT card. Change the source template and confirm the saved card stays unchanged.

## Phases 11–20 — release 0.20.0

The first ten reports are retained as historical release-0.10.0 snapshots. Reports 11–20 contain complete current relevant source, commands and checks. Current integrated source is in the new archive; no historical source snapshot is represented as a current implementation.

| Phase | Implemented | Evidence / boundary |
|---|---|---|
| 11 | Frozen PNG/JPG, DPI/quality/background/alpha and scannability guards | Images decoded with sharp, DPI/pixels and frozen background checked |
| 12 | Exact-size and bulk PDF; front/back; stream to private atomic output | PDF.js checks page sizes/count; sample sheet rendered and visually inspected |
| 13 | A4/A3/Letter/custom sheets, configurable rows/columns, margins/gap/bleed/crop marks, duplex and profiles | Fit/mirror tests; actual-size printer calibration remains a target acceptance gate |
| 14 | Durable pg-boss generation/export, live progress, per-item errors, retry/cancel and idempotency | Actual worker completes generation and ZIP jobs; request resubmission does not duplicate |
| 15 | Public live verification, current state/expiry, configured non-private fields, no-cache and throttles | API privacy/status/replacement tests; browser public route and script policy |
| 16 | Off-by-default locations, branch/org coordinates/link/QR binding, Leaflet viewer, uploaded static map rendering | Disabled access denied, enabled location stored; no automated tile fetching |
| 17 | State transitions, expiry extension, renew/replace/reissue, supersession and immutable history | Old verification shows REPLACED; terminal activation and deletion rejected |
| 18 | Tenant dashboard totals, generation/status/department/import charts and CSV report | Live database reports; browser navigation and screenshots |
| 19 | Mutation audit triggers, immutable logs, scoped expiring/revocable bearer tokens, persistent rate limits, nonce CSP | Scope/tenant/revocation/audit secrecy tests and production browser hydration |
| 20 | Native backup/restore/update/rollback/uninstall, timer/retention, compatibility gates and safety backups | Archive round trip, corruption/path/size rejection, build and Bash syntax; native Ubuntu operations need target rehearsal |

## Phases 21–22 — release 0.22.0

| Phase | Implemented | Evidence / remaining boundary |
|---|---|---|
| 21 | Reproducible check command, expanded unit and real integration/browser acceptance, 100-row XLSX/100-photo job interruption recovery, starter render/QR validation, CI matrix pinned to official action commits | Windows build/tests; isolated Ubuntu 24.04 WSL build/tests (browser explicitly skipped there); GitHub CI not dispatched |
| 22 | SSH-port-aware UFW, unattended Ubuntu security updates, optional Fail2ban, hardened systemd units, read-only security diagnostics, restored-storage permission fix, runtime-unit refresh during update/rollback | Native shell syntax and offline systemd analysis; applying root policies and full server recovery still need dedicated-server rehearsal |

The guided first-card wizard is implemented and browser-tested, including per-user/organization progress persistence, real logo upload, valid starter template, sample generation and saved print settings. Phase 21–22 reports contain full relevant current sources; reports 01–20 are historical snapshots.

## External acceptance remaining

The final fresh-Ubuntu install/TLS/root backup-update-restore and physical printer/scanner rehearsal is not complete. Isolated WSL application tests and offline unit analysis are additional evidence, not substitutes. See ACCEPTANCE.md for the exact procedure. Optional face detection remains disabled.

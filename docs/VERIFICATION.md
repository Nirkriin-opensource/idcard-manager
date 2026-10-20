# Verification record — 18 October 2026

Environment: Windows, Node.js 24.21.0, a real isolated PostgreSQL 16 cluster, and headless Microsoft Edge. Production target: native Ubuntu 22.04/24.04 LTS.

| Check | Result | Evidence |
|---|---|---|
| Production web/worker/CLI build | Passed | `delivery/build.log` |
| Unit, import parsing, binding and rendering tests | 25 passed; zero failed/skipped | `delivery/unit-tests.log` |
| PostgreSQL, worker and browser integration | 14 passed; zero failed/skipped | `delivery/integration-tests.log` |
| npm dependency audit | Zero reported vulnerabilities at verification time | `delivery/dependency-audit.json` |
| Installer and service-control Bash syntax | Passed using Git Bash | Syntax validation; no Ubuntu installation claim |
| Desktop/mobile visual inspection | People directory, designer/server preview and mobile card list inspected | `docs/screenshots/` |

## What the tests establish

- Migrations apply and safely rerun on PostgreSQL 16. The tested application database role is neither superuser nor BYPASSRLS.
- Unscoped reads return no tenant rows; cross-tenant writes and referenced units/assets are rejected.
- Sessions require valid credentials, CSRF and Origin. Viewer writes and access to another organization are refused.
- CSV/XLSX parsing preserves IDs/Unicode and rejects malformed rows, duplicate headers and spreadsheet formulas. Duplicate imports cannot commit; valid imports commit once. Generated XLSX error reports can be read as real workbooks.
- Real image uploads normalize successfully, produce bounded thumbnails, match filenames, work inside ZIPs and can be cropped without changing the original asset.
- Template versions cannot be updated/deleted. Actual front/back generation freezes a person/photo/template snapshot, and the old rendered bytes remain identical after a template change.
- The real compiled worker initializes pg-boss and publishes a heartbeat. Readiness is 503 before the worker and 200 after it starts.
- Ten thousand stored records remain paginated; combined filters and organization isolation still work.
- A real browser signs in, opens the people directory and template designer, requests a server preview and opens the card list. No browser page errors were recorded in the tested flow.
- QR, Code 128, Code 39, EAN-13, EAN-8, UPC-A and UPC-E generated images decode independently. Retail scanners may normalize UPC-E/UPC-A into an equivalent expanded identifier; tests check that equivalence. The test decoders do not generate the barcodes.
- Invalid code data, inadequate contrast, undersized modules, unknown bindings, injected markup and overflowing text are rejected or escaped.

The QR test uses jsQR; linear barcode tests use the maintained ZXing-C++ WebAssembly reader with its WASM loaded locally. No remote decoding service receives any image.

## Limits of this evidence

The integration suite does not certify every editor keyboard interaction, every font/script, every printer or every hardware scanner. Its 10,000-record check verifies pagination and filtering, not 10,000-card bulk throughput. Test photo rectangles are synthetic fixtures, not actual people.

Fresh Ubuntu apt installation, systemd confinement, Caddy DNS/certificate issuance, minimum-memory builds, physical print alignment/scanning and recovery on the target server remain unverified here. A source build passing on Windows does not replace those gates.

This historical release was followed by phases 11–20; see the current results below. At that release, phases 21–22 remained; they are implemented in 0.22.0 below. Final production acceptance remains outstanding.


## Release 0.20.0 verification

The historical results above belong to release 0.10.0. Current build and acceptance logs are `delivery/build-20.log`, `unit-tests-20.log`, `integration-20.log`, `dependency-audit-20.json` and `shell-syntax-20.log`. Run build before integration tests. The expanded suite uses isolated PostgreSQL 16, a real worker/Next server and Edge.

New checks cover exact PDF dimensions/duplex pages, visual PDF rendering, frozen PNG/JPG and quality guards, real bulk generation/ZIP completion and resubmission, current verification/privacy/lifecycle/history, optional location controls, scoped bearer tenant boundaries/revocation, immutable audit, dashboard/report queries and archive validation/corruption rejection. Unit tests include physical print fit/mirror and archive path/type/size validation. Test PDFs and screenshots live in isolated storage/test-* and are excluded from source packages.

Native root operations are implemented but cannot be executed on Windows. A fresh Ubuntu backup/restore/update rehearsal, TLS issuance, physical print/scan acceptance, and phases 21–22 remain outstanding. `idcardctl test` reports application diagnostics only, not those external acceptance gates.

Final recorded results: production build and typecheck passed; 29 unit/rendering/archive tests passed; 19 PostgreSQL/worker/browser integration tests passed; 0 known dependency vulnerabilities; both Bash entrypoints passed syntax checks. Screenshots ending in -20.png show the current release using synthetic test data.


## Release 0.22.0 — remaining phases

Current results supersede earlier phase boundaries. The wizard is now implemented. Source/build/check evidence is listed in ACCEPTANCE.md. Windows runs the full browser suite; non-root Ubuntu 24.04 WSL independently runs build/unit/API/worker/PDF acceptance with its browser test explicitly skipped. Both exercise 100-person XLSX/photo matching, worker interruption/recovery, unique card numbering and a 26-page duplex PDF. Neither run installs services or changes a live firewall. Offline systemd analysis exits successfully and scores both units 2.9 (OK); it does not certify runtime deployment. Current exact totals are recorded in the final log summaries.

Final 0.22.0 totals: Windows production build/typecheck passed, 35 unit checks passed and all 20 integration/browser checks passed. Ubuntu 24.04 WSL with Node 24.22.0 independently passed build, 35 unit checks and 19 integration checks; one browser check was explicitly skipped. The 100-card PDF first front sheet and final back sheet were rendered and visually inspected. Dependency audit: zero known vulnerabilities. Five native Bash entrypoints passed syntax checks.

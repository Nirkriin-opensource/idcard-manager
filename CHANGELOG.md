# Changelog

## 0.23.0 — public hosting package

Publish the integrated application under MIT with a single native Ubuntu hosting archive, all ten migrations, dependency lockfile, CycloneDX SBOM, file manifest and SHA-256 checksums. Exclude runtime storage, backups, private environment files, local reports and screenshots from the public bundle. Add hosting/contribution/security documentation and a tagged GitHub release workflow. Generate Next.js route types before checking a fresh checkout. Existing deployment data and credentials are not distributed or changed by packaging.

## 0.22.0 — task navigation and recoverable data lifecycle

Add a searchable Manage data task directory, sidebar menu search, card-preparation workflow links and organization section shortcuts, preserving existing themes. Add an administrator-only Recycle bin for deleted People/Photos with selection, restore, per-category empty previews and typed permanent-purge confirmation. Migration 010 permits deletion of specifically previewed linked cards/history only under an authorized live purge receipt. Revalidate dependencies before confirmation, block active jobs, protect shared sources and queue physical file cleanup. Related mixed generation jobs/downloads are explicitly counted and removed as whole batches/files. Accounts, templates, organization settings, audit history and backup copies are retained. Add a dated public-launch security/certification review; this is not an independent security certification.

## 0.22.0 — organization time management

Add organization time-zone and 12/24-hour preferences, with a server-synchronized clock and India Standard Time default. Enter form deadlines in the organization zone with an AM/PM preview, reject active deadlines in the past, and label expired forms explicitly. Normalize datetime answers on the server and reject stale zone selections. Use the same zone for submission/audit history, purge cutoffs and new card dates/year numbering. Preserve existing deadline instants, historical card snapshots and saved time settings when appearance changes.

## 0.22.0 — HTTP LAN browser compatibility

Fix the workspace crash on HTTP LAN addresses where browser randomUUID is unavailable. Use cryptographic getRandomValues to generate UUIDv4 IDs for workflows, setup and designer elements. Exercise the full browser workflow with randomUUID disabled so localhost-only tests cannot hide the issue.

## 0.22.0 — shareable profession data collection

Add admin-managed collection forms with profession and practice presets, custom questions, required rules, ordering, closing dates and revocable share links. Public forms accept consented text answers and sanitized photos/signatures without a login. Preserve original questions and answers; admins can correct answers, approve into People or reject. Pending images remain admin-only until approval. Keep the existing General card workflow. Migration 007 adds tenant-isolated forms, responses and image privacy rules.

## 0.22.0 — additional CardDesk theme

Add CardDesk alongside the five existing themes, preserving their definitions and the current default. Use the reference's blue/white palette, compact sidebar, rounded panels and smaller headings only when CardDesk is selected. Add accessible theme switch tabs alongside the existing dropdown, with per-organization preference persistence. Keep all live workflows and organization branding intact; no demo metrics or placeholder actions are imported from the reference HTML.

## 0.22.0 — admin purge controls

Add tenant-scoped, session-admin-only purge controls for older audit entries, saved ID-card renders/related exports and completed job logs. Require an expiring exact-record preview and typed confirmation. Preserve ordinary history immutability, card identities and purge receipts. Coordinate concurrent generation/export work, retain shared images, and clean up files through a durable worker queue. Migration 006 adds the controlled deletion exception; no production data is purged during deployment.

## 0.22.0 — multilingual printing and navigation

Add English-first primary/additional print languages, installed font choices, Windows/WSL PC sync and manual TTF/OTF/TTC uploads. Check actual glyph coverage and shape complex scripts with Pango, freeze font identifiers for new batches, retain per-field font overrides, and provide authenticated browser font loading. Replace all menu glyphs with coordinated SVG icons, including mobile, and set the footer to “Multipurpose card Manager”. Renderer revision 0.23.0. The supplied Claude reference requires sign-in, so no exact visual match is claimed.

## 0.22.0 — application branding and themes

Add manual global application-logo upload/reset, a persistent top-right five-theme switcher, custom institution colour/font/logo/field settings, Classic/Vertical/Modern presets for all four card types, per-type defaults and an admin card-theme lock. Queue jobs freeze theme and field-policy settings across worker restarts. Enforce contrast on custom palettes, preserve black/white codes, retain historical card images, and test desktop/mobile switching and uploads.

## 0.22.0 — card field profiles

Add complete Faculty/Staff, Student, Visitor and Working Professional catalogs with manually selected printed and mandatory fields, per-template extra requirements, typed full-field presets, signature and logo assignment, matching bulk upload kits with a requirements sheet, and checks during person save, import validation/commit and card generation. Visitor validity and card validity set actual expiry. Existing cards and templates are retained. See docs/CARD-FIELDS.md.

## 0.22.0 native service access correction

Preserve code readability/traversal after transferring builds to root ownership, including future updates. Fix the unattended-upgrade diagnostic to query its exact value instead of a pipefail-sensitive early-exit pipeline. Repaired the deployed WSL release and verified all installed diagnostics pass.

## 0.22.0 installer permission correction

Fix PostgreSQL startup under umask 077 by explicitly making the non-secret idcard.conf include readable before restarting PostgreSQL. Confirmed against the affected native Ubuntu WSL cluster, without recreating databases. Added a regression check.

## 0.22.0 — phases 21–22 and first-card setup

Added the guided setup wizard, tested starter template/QR, persistent browser progress, combined check command, pinned Ubuntu CI matrix, 100-person Excel/photo/worker-restart/PDF acceptance, isolated native Linux validation, Unix-newline regression checks, SSH-aware firewall hardening, unattended update policy, optional Fail2ban and security diagnostics. Strengthened service isolation and fixed staged restored-storage write access; update/rollback refresh runtime definitions and rollback restores the prior runtime on health failure. Application version is now independent of frozen renderer version. Fresh-server/root recovery and physical print/scan acceptance remain external gates.


## 0.20.0 — phases 11–20

Added frozen PNG/JPG/PDF/ZIP exports; configurable physical print sheets and duplex presets; durable background generation/export; live private-field-controlled public verification; optional Leaflet locations and uploaded print maps; lifecycle/history/renew/reissue; dashboard/CSV reporting; audit triggers, bearer scopes, rate limits and script nonces; native backup/restore/update/rollback/uninstall with daily retention. Added isolated acceptance tests and PDF visual checks. Native Ubuntu and physical printer acceptance remain outstanding.


## 0.10.0 — 2026-10-18

- Added the native Ubuntu installer foundation, protected configuration, systemd units and Caddy integration.
- Added PostgreSQL 16 migration checksums, forced tenant RLS, composite tenant references and immutable history records.
- Added password/session authentication, organization roles, CSRF/origin checks and login throttling.
- Added people, units, typed custom fields, combined search and configurable card numbers.
- Added staged CSV/XLSX import mapping, duplicate detection, preview, atomic commit and error reports.
- Added normalized private photo assets, thumbnails, filename matching, ZIP handling, visual assignment and non-destructive crops.
- Added front/back Konva template editor with dimensions, layers, transforms, clipboard, undo/redo, locking, alignment, grid and rulers.
- Added validated bindings, QR/barcode generation, immutable server card renders and independent image decoding tests.
- Added PostgreSQL/worker/browser integration tests and phase documentation.

This version covers the first ten development phases, not the final production acceptance scope.

- Fixed collection-form Copy link on HTTP LAN addresses: added selection-copy fallback and automatic URL selection with manual-copy instructions when browser permissions block copying.

- Added explicit Upload images and Upload ZIP buttons on Photos, selected-file summaries, upload status and matching results. File selection no longer starts a batch upload automatically.
- Added pre-upload ZIP/image size checks and clear connection-interruption guidance with retained files for manual retry.

- Custom templates without a legacy card type now follow the organization General policy during preview and generation, preserving the saved design and mandatory validation. Added matching custom-prefixed field bindings for preview and frozen card snapshots.

- Added a preview/apply bulk photo matcher for existing uploads, including optional whitespace normalization, identical duplicate grouping, ambiguity detection, stale-preview rejection and protection for existing/private photos.

- Added administrator Delete person confirmation, a Deleted people view and Restore. Deletion preserves history/photos, excludes records from generation/matching and disables public verification until restored. Migration 008 adds the deletion marker.

- Replaced individual People delete buttons with row selection, select-all and bulk delete/restore. Added checkbox-based bulk photo deletion and a Deleted photos view. Photo deletion clears current matches while retaining historical renders; migration 009 adds the photo deletion marker.

# Security model

## Implemented

- Argon2id password hashing, random first-admin passwords, mandatory first password change and session revocation on password change.
- Cryptographically random opaque session tokens; SHA-256 token hashes in the database. HttpOnly/SameSite cookies, Secure on HTTPS, eight-hour expiry.
- Persistent sign-in throttling keyed by account and client address. Caddy overwrites the forwarded address; the web listener is loopback-only.
- Role authorization per organization plus forced PostgreSQL RLS. The application role is not a superuser and has no BYPASSRLS. Tenant context is transaction-local to prevent connection-pool leakage.
- Composite tenant foreign keys for references, including photos, units, templates, cards and rendered assets.
- Explicit Origin and CSRF checks for authenticated mutations. Session API clients must supply the configured origin and CSRF token; explicitly scoped bearer clients use token authorization.
- Parameterized SQL and server schema validation. Dynamic SQL is limited to fixed field names chosen in code.
- Private storage outside releases, generated storage names, bounded bodies, decoded image checks, pixel limits and normalized thumbnails. No unrestricted remote asset fetching.
- ZIPs are read in memory with entry, path, encryption and expanded-size limits; they are never extracted to user-supplied paths.
- Spreadsheet formulas/hyperlinks are rejected; CSV error reports neutralize formula prefixes.
- Immutable template versions and card events; render/audit updates remain forbidden. A narrowly scoped, previewed session-admin purge can delete selected render/audit rows and retains an immutable purge receipt. See [purge controls](PURGE.md). Mutation auditing records action/actor/target, not passwords, tokens or uploaded values.
- Secure response headers and a CSP that permits Next.js hydration. HTML responses use request-scoped script nonces and strict-dynamic, with no production unsafe-inline/eval scripts. Inline styles support canvas/map UI. Public/API/login rate limits persist in PostgreSQL.

## Roles

| Action | Super Admin | Org Admin | Designer | Operator | Viewer |
|---|---|---|---|---|---|
| Create organizations | Yes | No | No | No | No |
| Read organization data | Yes | Yes | Yes | Yes | Yes |
| Manage people/imports/photo matches | Yes | Yes | No | Yes | No |
| Upload image assets | Yes | Yes | Yes | Yes | No |
| Design templates/preview | Yes | Yes | Yes | No | No |
| Generate cards | Yes | Yes | No | Yes | No |
| Manage units/fields/team/numbering | Yes | Yes | No | No | No |
| Global system diagnostics | Yes | No | No | No | No |

Super Admin access is intentionally global and audited for mutations. PostgreSQL host administrators can access all data; tenant isolation is not a defense against a compromised server administrator.

Card verification identifiers are generated from 32 random bytes. The cards table retains only a token hash; the verification URL necessarily exists in the frozen rendering snapshot and output image. Those snapshots/images are private application data. Do not publish them unintentionally.

## Remaining production gates

Migration 010 adds the explicitly authorized recycle-bin exception: an authenticated Org Admin/Super Admin can preview deleted people/photos and their dependencies, then confirm a ten-minute actor/organization-bound manifest with PURGE. Card identities and lifecycle events can only be deleted when their IDs appear in that running manifest; ordinary deletion and all event updates remain forbidden. Confirmation recomputes the manifest, rejects stale selections and blocks active generation/export jobs. Shared assets are protected; whole affected export files and generation batches are disclosed in the preview. Purge receipts remain immutable. This does not erase historical backups or enforce a jurisdiction-specific legal retention/hold policy. See [public-launch review](PUBLIC-LAUNCH-REVIEW.md) before exposing the deployment to the internet.

The release has not undergone a third-party security audit. Phase 19 adds business mutation triggers, immutable audit/history, scoped expiring/revocable tokens, verification privacy controls, persistent throttles and script nonces. Backups are root-only, checksum validated and locally retained; they contain credentials and are not encrypted. Use encrypted off-server backups. Only trusted PostgreSQL archives may be restored.

Phases 21–22 are implemented, including unattended update policy, SSH-aware firewall setup, optional Fail2ban and strengthened service permissions. Fresh Ubuntu restore/update/TLS/physical scan acceptance remains outstanding; see HARDENING.md and ACCEPTANCE.md. Root administrators can bypass database isolation; checksum manifests establish integrity rather than archive authenticity.

Report security findings privately to the deployment owner. Do not attach environment files, password hashes, session cookies or real-person imports to public issues.

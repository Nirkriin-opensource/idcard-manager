# REST API — phases 1–22

All responses contain JSON unless documented as images, CSV or XLSX. Errors use `{ "error": "what failed", "fix": "what to try" }` with an appropriate non-2xx status. Requests are never considered successful merely because the transport succeeded.

## Authentication

`POST /api/auth/login` takes `{email,password}` and sets an HttpOnly SameSite=Strict session cookie. It returns a CSRF token. Send the exact `Origin` matching `APP_ORIGIN` and `X-CSRF-Token` for subsequent writes, plus the session cookie. Secure cookies are used with an HTTPS origin. Sessions expire after eight hours.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Current identity, CSRF token, password-change requirement |
| POST | `/api/auth/password` | `{current,password}`; minimum 14 characters; revokes all sessions |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/health/live` | Minimal public liveness; no secrets or database details |
| GET | `/api/health/ready` | Minimal readiness; 503 until database, migration, queue and worker heartbeat are ready |
| GET | `/api/system/health` | Super Admin service diagnostics |
| GET / POST | `/api/orgs` | Accessible organizations / create organization as Super Admin |

Organization creation takes `{name,code}`. Code accepts uppercase letters, digits, underscores and hyphens.

## Organization scope

Use `/api/orgs/:organizationId/` as the prefix below. UUIDs are validated. Each operation checks both membership/role and the PostgreSQL organization policy. Identical external person IDs are permitted in different organizations.

| Method | Relative endpoint | Payload / response |
|---|---|---|
| GET / POST | `units` | List/create `{name,code,kind,parent_id?}`; kind BRANCH/DEPARTMENT/CLASS/SECTION |
| GET / POST | `fields` | List/create `{key,label,type,required?,private?}`; text/number/date/boolean |
| GET / POST | `members` | Admin-only team view / assign `{email,role,password?}`; password required for new account |
| GET / PUT | `numbering` | Current sequence / `{prefix,pattern,padding,start}`; start cannot move backwards |
| GET | `people` | `{items,total,page,limit}`; page size 50 |
| POST | `people` | Create person |
| GET / PUT | `people/:id` | Read / replace editable person fields |
| GET / POST | `assets` | Asset list / raw JPEG, PNG or WebP upload |
| GET | `assets/:id?thumb=1` | Private thumbnail; omit thumb for normalized image |
| POST | `assets/:id/crop` | `{left,top,width,height}` in pixels; creates a new asset |
| PUT | `photos/:personId` | `{asset_id,slot?}`; null removes match; photo/signature slots |
| POST | `photos?match=external_id&filename=photos.zip` | Raw ZIP, up to 200 entries / 25 MB compressed / 100 MB expanded |
| GET / POST | `imports` | Recent batches / raw CSV or XLSX with `?filename=people.xlsx` |
| GET | `imports/:id?offset=0` | First/next 100 staged rows with validation errors |
| POST | `imports/:id/validate` | `{mapping:{"Source Header":"external_id","Full Name":"name"}}` |
| POST | `imports/:id/commit` | Commit a validated, error-free batch exactly once |
| GET | `imports/:id?report=csv` | Error report with row, field, error, suggested fix |
| GET | `imports/:id?report=xlsx` | Excel error report |
| GET / POST | `templates` | List / create `{name,document}` |
| GET / PUT | `templates/:id` | Latest version / append version or modify metadata |
| POST | `templates/:id/duplicate` | Create separate template copy |
| POST | `preview` | `{document,person_id,side}` → image/png |
| GET / POST | `cards` | Latest 100 cards / generate `{person_id,template_id,expires_at?}` |
| GET | `renders/:id?side=front` | Immutable PNG render; side may be back |

Asset uploads accept `kind=PHOTO|IMAGE|LOGO|SIGNATURE|STAMP` and `filename`. PHOTO uploads optionally auto-match filename against `match` (external_id by default; otherwise a custom-field key). A unique match is required; ambiguous/missing matches remain unassigned. Lists return 100 assets at a time; use `offset` for older assets.

Person payload: `{external_id,name,email?,phone?,designation?,status?,custom_fields?,unit_ids?}`. Status ACTIVE/INACTIVE. Custom keys must be defined for that organization. Preserve leading zeros in IDs by using strings.

People filters combine with AND: `q`, `name`, `external_id`, `email`, `phone`, `designation`, `status`, `card_number`, `branch`, `department`, `class`, `section`. Unit filters take unit UUIDs. Search values are parameterized; `%`/`_` retain PostgreSQL ILIKE wildcard semantics.

Import mappings may also target `custom.<key>`. Boolean source values must be `true`/`false`; dates use YYYY-MM-DD. Formula/hyperlink spreadsheet cells are rejected; paste values before uploading. The first worksheet is read. Maximum 10,000 data rows / 100 columns / 15 MB upload. Existing or intra-batch duplicate IDs are errors. There is no silent update/upsert mode.

Template updates accept `{name?,document?,archived?,is_default?,restore_version_id?}`. Restore copies the chosen version into a new version; no historical version is mutated.

## Template and bindings

Document: `{schemaVersion:1,width,height,dpi,background,front:[],back:[]}`. Width/height and element geometry use mm. DPI 150–600; the rendered canvas must remain below 40 megapixels. Template element schema is defined in `src/core/template.ts`; it is validated on the server.

Types: text, date, photo, image, logo, signature, stamp, rect, ellipse, line, qr, barcode. A map element uses an uploaded licensed static image and is rejected while locations are disabled. No server-side public tile downloading occurs. Photos resolve from the person's assigned photo unless no assignment exists and an explicit fallback asset is selected. Other images require an asset UUID.

Bindings include `{{name}}`, `{{external_id}}`, `{{email}}`, `{{phone}}`, `{{designation}}`, `{{status}}`, `{{card.number}}`, `{{card.verify_url}}`, `{{card.date}}` and configured custom-field keys. Unknown bindings fail with a correction. Preview uses PREVIEW as the card number; generation uses the allocated number. Empty defined values render empty.

QR codes enforce a square shape, four-module quiet zone, minimum three pixels/module and dark-on-light contrast. Barcode data is validated by bwip-js. Supported linear formats: Code 128, Code 39, EAN-13, EAN-8, UPC-A and UPC-E.

## Phases 11–20 endpoints

All paths below use `/api/orgs/:org/` and require the same tenant/role authorization as the underlying operation.

| Method | Path | Payload / result |
|---|---|---|
| GET | `cards/:id/image?format=png&dpi=300&quality=95&side=front` | Frozen PNG/JPG image, private attachment |
| GET | `cards/:id/pdf` | Exact-size PDF, optional `side=both` |
| POST | `generation` | `{template_id,person_ids?:UUID[],filters?:{},request_key}` → job ID, HTTP 202 |
| GET | `generation` / `generation/:id` | Jobs/progress; one job includes per-item results |
| POST | `generation/:id/cancel` / `retry` | Cancel pending work / retry failed items |
| POST | `exports` | `{render_ids?:UUID[],filters?:{},options:{...},request_key}` → job ID, HTTP 202 |
| GET | `exports` / `exports/:id` | Job status/progress |
| GET | `exports/:id/download` | Completed PDF/ZIP/PNG/JPG attachment |
| POST | `exports/:id/retry` | Retry failed export |
| GET | `cards/:id/history` | Card, events, immutable render versions |
| POST | `cards/:id/state` | `{status}`; validates lifecycle transitions |
| POST | `cards/:id/extend` | `{expires_at:ISOdatetime}`; future expiry required |
| POST | `cards/:id/renew` / `replace` / `reissue` | `{request_key,template_id?,expires_at?}`; creates new ACTIVE card, old card REPLACED |
| GET / PUT | `settings` | `{verification_fields:string[],location_enabled:boolean}`; Org Admin |
| GET / POST | `locations` | `{address,latitude,longitude,unit_id?,map_asset_id?}`; disabled when feature off |
| GET / POST | `print-profiles` | `{name,options}`; save requires Org Admin |
| GET | `dashboard` / `reports` | Tenant counts/charts/recent jobs; CSV status report |
| GET | `audit?offset=0` | Latest 100 tenant audit entries; Org Admin |
| GET / POST / DELETE | `tokens` / `tokens/:id` | Create `{name,scopes,expires_at}`; plaintext token returned once; Org Admin |

Public `GET /api/verify/:token` and `/verify/:token` return current status. Only configured non-private fields of ACTIVE cards are shown; all other states omit person fields. Responses are not cached and never include the token hash, raw snapshot, email or phone. Default public field selection is empty.

Bearer clients use `Authorization: Bearer <token>`, with scopes `read`, `people`, `generate`, `design`, `asset`. Scopes must permit the exact operation; tokens remain bound to one organization and the issuing user's current permissions. Bearer clients do not use browser CSRF cookies. Tokens cannot change account settings or grant new tokens. Session clients continue to require Origin and CSRF for writes. API limit: 600 requests/user/minute; public verify: 60/IP/minute; sign-in has an additional 30/IP/5-minute limit and account/address limits.

Export options: `format:png|jpg|pdf|zip`, `imageFormat:png|jpg`, `dpi:150..600`, `quality:50..100` (minimum 85 with codes), optional hex `background`, `transparent`, `side:front|back|both`, `layout:card|sheet`, `paper:A4|A3|Letter|custom`, `paperWidth`, `paperHeight`, `columns`, `rows`, `margin`, `gap`, `bleed`, `cropMarks`, `duplex:long|short`, `backRotate`. Geometry uses mm; paper-fit validation prevents accidental scaling. Example 2/4/6/8 cards: columns=2, rows=1/2/3/4 if they fit. Full-bleed output repeats edge pixels and does not invent artwork.

Generation filters: `q,status,unit_id`; export filters add `from,to,batch_id`. Unit IDs cover branch/department/class/section. At most 10,000 items per job. Generation snapshots people/photo assignment and template version at submission. Retry handles transient errors using stable card IDs; correcting source data requires a fresh job to capture those changes. Cancel preserves completed items. Jobs survive browser closure and worker restarts through durable DB state plus pg-boss dispatch. Reuse a request key only for the same submission.

Location bindings: `location.address`, `location.url`, `location.map_asset_id`, `location.enabled`. A person's assigned unit location takes precedence over an organization location. Bind the URL to a QR element for location links. Interactive OpenStreetMap tiles load only after explicit user action; static print maps are uploaded assets.

Setup uses the documented organization/assets/templates/people/cards/print-profiles endpoints. Single-card requests can send an Idempotency-Key header (8–100 characters) to recover a prior identical submission without allocating a second card. Health reports application release separately from the historical renderer version.
# Bulk upload templates

`GET /api/orgs/:org/upload-templates?kind=people|photos|kit` requires people-management permission for the organization. Downloads use private, no-store responses. `people` returns a blank UTF-8 CSV with core and organization custom field headers, suitable for Excel; `photos` returns current people and expected portrait filenames; `kit` bundles both CSV files and upload instructions as ZIP. Import people before downloading the final photo guide. Upload only actual renamed images in the photo ZIP, using Organization ID matching. The template kit itself is not a photo upload.


## Data collection forms

All `/api/orgs/:org/forms` routes require a signed-in Org Admin or Super Admin, tenant authorization and normal CSRF/Origin checks on writes. API tokens cannot manage forms. `GET` lists forms (including admin-only share URLs and pending counts) plus available field definitions. `POST` creates a form; `GET/PUT /:id` reads or updates it. Form definitions contain `title`, `profession`, `description`, ordered `fields`, `active` and nullable ISO `closes_at`. Each field has `key`, `label`, `type`, `required` and dropdown `options`. Name and external ID are always required; organization-required fields must also be included. Custom questions register private organization field definitions without changing printed templates.

`POST /:id/rotate-link` replaces the share capability. `GET /:id/submissions?status=PENDING&page=1` lists up to 25 admin-only responses, with APPROVED and REJECTED also supported. `POST /:id/submissions/:submission` takes `{action:'approve'|'reject',values?:{...}}`. Approval locks the response, validates its frozen questions and current organization rules, creates a person, releases its images for normal card use and records the reviewer. Duplicate person IDs return 409 while preserving the pending response. Repeat review returns 409. Original submitted values remain in the frozen definition alongside reviewed values.

`GET /api/collect/:org/:capability` returns only an active, unexpired form's public questions and organization name. `POST` accepts `{version,values,images,consent:true,website:''}` from the configured application Origin. `images` contains base64 photo/cardholder_signature bytes, each up to 4 MB; JPEG, PNG and WebP are sanitized through the normal image pipeline. The request limit is 12 MB. Images are private to admins while pending or rejected. The response returns a reference and no person data; anonymous visitors cannot list or retrieve responses. Outdated form versions return 409; closed, expired or revoked links return 404. Rate limits apply separately to reads and submissions, and the form queue is capped at 1,000 pending responses. The browser page is `/collect/:org/:capability`, is not indexed, and sets no-referrer behavior.

## Organization time management

`GET /api/orgs/:org/time-settings` returns `timeZone`, `hour12`, `serverNow` and supported IANA zones. Authorized organization readers can read; only organization administrators can `PUT {timeZone,hour12}`. Changes are audited and preserve appearance settings. Appearance updates preserve the separately saved time settings.

Form editors may send `closes_local` (organization wall time, or empty for no deadline) and `editing_time_zone`. A changed organization zone returns 409; invalid or ambiguous local times return 400. Active forms require a future deadline or no deadline. Existing absolute deadlines are preserved when time settings change. Form metadata includes `closes_local`, `timeZone` and `expired`; lists and public definitions include the organization clock settings and server time. Public submissions and approval may send `time_zone` to detect stale settings; timezone-less datetime answers are converted using the organization zone, while explicit ISO instants remain unchanged.

## Bulk photo matching

`POST /api/orgs/:org/photo-matches` requires people-management permission and normal CSRF/Origin checks. `{field:'external_id',ignore_spaces:true,action:'preview'}` returns filename/person pairs, skip reasons, counts and `preview_token`. Send the same settings with `action:'apply'` and that token to match ready rows. Changed plans return 409. Existing photo links are never overwritten, identical duplicate images are grouped, ambiguous matches are skipped, and private collection images are excluded. Matching is organization-scoped and audited.

## Deleted people

Administrators can `DELETE /api/orgs/:org/people/:id` to move a person to Deleted people and `POST /api/orgs/:org/people/:id/restore` to restore them. Both operations are tenant-scoped, CSRF-protected and audited. `GET people` excludes deleted records; `GET people?deleted=only` is admin-only. Normal GET-by-id, editing, new generation and photo matching exclude deleted people. Card/photo/history records are retained; public card verification is inactive while the person is deleted.

## Bulk record deletion and restore

`POST /api/orgs/:org/bulk-records` is admin-only and accepts `{kind:'people'|'photos',action:'delete'|'restore',ids:[UUID,...]}` (1–10,000 selected IDs). Every ID must be eligible and belong to the current organization; invalid mixed selections fail atomically. People are moved to the existing deleted view. Photos must be ordinary non-private PHOTO assets; deletion clears current person-asset links while retaining bytes for historical cards. `GET assets` hides deleted uploads; admin `GET assets?deleted=only` lists deleted photos for restoration. New card generation, matching and cropping cannot use deleted photos. Bulk operations are audited.
# Recycle bin

`GET /api/orgs/:org/recycle-bin?kind=people|photos&offset=0` lists up to 100 deleted records plus total. Signed-in Organization Admin/Super Admin only; API tokens are rejected.

`POST /api/orgs/:org/recycle-bin` accepts `{action:"restore",kind,ids}` or `{action:"preview",kind,ids}` (up to 1,000 unique selected IDs), or `{action:"preview",kind,all:true}` (up to 1,000 deleted records from that category). Preview returns an expiring ID and dependency counts. Confirm with `{action:"confirm",id,confirmation:"PURGE"}`. Confirmation is actor/organization-bound, revalidates the dependency manifest and is idempotent for completed requests. Active generation/export jobs block purge. Shared references may block photo purge or retain assets. Related generation jobs and export files are removed as whole batches/files. Cleanup is durable and asynchronous; backups remain outside this endpoint. See USER-GUIDE.md for exact retention and removal scope.


# Public launch review — 20 October 2026

## Decision

Not approved for unrestricted public launch yet. This is an implementation review and release checklist, not independent certification, legal advice, or a completed penetration test. Continue the LAN pilot with authorized users while closing the gates below. Launch countries, customer contracts, treatment of children’s data and hosting arrangements are still unspecified; “all in one” describes the product, not a legal jurisdiction.

## Evidence and limits

- Reviewed the repository security model, tenant authorization, storage handling, deletion controls and deployment/acceptance documentation.
- Production dependency audit on 20 October 2026: `npm audit --omit=dev` reported zero known vulnerabilities. This does not establish absence of vulnerabilities or audit the host, browser, PostgreSQL, Caddy or dev/build toolchain.
- Existing implementation includes Argon2id password hashing, session expiry/revocation, CSRF/origin checks, tenant RLS and role checks, upload/ZIP limits, public verification field controls and immutable history with controlled purge exceptions. See SECURITY.md. These are source-review observations; deploy-time verification is still needed.
- No native MFA implementation was found. Existing local backups are not encrypted. Independent security audit and dedicated-server restore/TLS/printing acceptance remain outstanding in the existing documentation.
- The initial direct LAN health request did not connect from the restricted execution environment. A subsequent native WSL `idcardctl doctor` passed application services, database/RLS, queue, worker, renderer, firewall, update/backup timer, storage and HTTP checks. Caddy's log confirms HTTP-only configuration. This verifies the local runtime checks, not public TLS, external access or public-launch readiness.

## Required launch gates

| Priority | Gate | Required evidence |
|---|---|---|
| Blocker | Stable hosting and HTTPS | Owned domain, supported dedicated host, valid TLS and renewal test, secure cookies, configured application origin, restricted DB/web listeners, external scan |
| Blocker | Administrator account protection | MFA through a tested identity provider/access gateway or implemented application MFA; recovery, session revocation and least-privilege checks |
| Blocker | Independent application assessment | Authenticated VAPT covering every role and at least two organizations; fix critical/high findings and obtain retest evidence; review remaining risks |
| Blocker | Recoverable backups | Encrypted off-server backups with key management; timed restore into isolated storage/database; documented RPO/RTO and retention; never assume a successful backup means restore works |
| Blocker | Privacy and retention | Customer/data-role mapping, notices, lawful processing basis, applicant rights/grievance process, processor contracts, children’s-data rules where applicable, approved deletion and security-log retention policies |
| Blocker | Operational response | Named incident owner, alerting for service/worker/disk/certificate/backup failures, patch schedule, abuse reporting and tested response procedure |
| High | File processing | Malformed image, decompression-bomb, path traversal, oversized ZIP/XLSX and resource-exhaustion testing; isolate processing and review malware-scanning needs |
| High | Tenant isolation | Attempt cross-organization People/Photos/Forms/Templates/Cards/Exports/Recycle bin access and mutation, guessed IDs and bearer-token abuse; inspect RLS under pooled connections |
| High | Public entry points | Test form-token revocation/expiry, spam/rate limits, file authorization, QR verification privacy, cache headers and no unintended indexing or personal data in logs |
| High | Delete and purge | Test recovery, stale preview rejection, independent admins, shared images, whole mixed export impact, active-job blocking, physical cleanup retries and immutable receipts |
| High | Load and continuity | Concurrent imports, uploads, generation and downloads; queue recovery/restarts; slow network/retry handling; target-user task testing and accessibility |
| High | Dependency and host maintenance | Scan runtime AND build dependencies; OS/container configuration, secrets/license checks, software bill of materials and ongoing advisories |

Use OWASP ASVS as a verifiable technical assessment baseline; for this application, target an appropriately scoped Level 2 assessment because it handles personal identity information. This is a recommendation, not a certification already held. [OWASP ASVS](https://owasp.org/projects/asvs)

## Certifications and legal applicability

There is no single universal “website launch certificate.” Determine requirements by operating country, customer procurement and sector. A TLS certificate secures the connection; it does not certify the application’s security or privacy compliance.

| Item | What it establishes | Launch relevance |
|---|---|---|
| TLS certificate | Server/domain identity and encrypted transport | Needed for this application's public production deployment |
| VAPT report and retest | Findings for a defined application/version/scope on a given date | Recommended launch gate; customer/government contracts may specify auditor qualifications or CERT-In empanelment |
| ISO/IEC 27001 | Certification of a scoped organization information-security management system | Usually a business/procurement choice, unless a specific rule/contract requires it; not a source-code safety certificate |
| SOC 2 | Independent attestation report about scoped service controls | Consider for enterprise customers; an attestation report, not a generic application certification |
| Privacy compliance | Ongoing notices, processing controls, rights handling, retention and security obligations | Depends on jurisdiction and processing; not achieved by buying a certificate |

[ISO explains that certification is optional for organizations implementing ISO/IEC 27001](https://www.iso.org/standard/27001). [AICPA SOC services](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services) describe the reporting framework.

For India, map the DPDP Act and notified Rules against the applicable commencement dates and actual processing model; do not assume all provisions began together. Review student/minor data and any sensitive medical or identity fields with counsel before collection. [MeitY DPDP Rules](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025)

For entities covered by CERT-In directions, the directions include reporting specified incidents within six hours and maintaining ICT logs securely for a rolling 180 days within Indian jurisdiction. Confirm applicability and operational details with a qualified adviser. The app's optional audit purge must not be used to defeat required retention; OS/security logs are separate from app activity history. CERT-In directions are obligations, not a universal “CERT-In certified app” label. [Official directions](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf), [official FAQs and updates](https://www.cert-in.org.in/Directions70B.jsp).

For customers or individuals in other countries, assess their privacy/sector rules and any international-transfer obligations before claiming compliance. Payment card processing, Aadhaar integrations, regulated health records or government procurement need separate scope reviews if added; they are not implied by printing an ID card.

## Suggested release sequence

1. Finish the usability and recycle-bin acceptance checks with synthetic records.
2. Confirm launch countries, customers, retention policy, minors’ data and hosting owner.
3. Prepare staging on the intended hosting stack using HTTPS and synthetic records.
4. Add/test MFA, encrypted backup recovery, monitoring and incident procedures.
5. Commission the independent assessment and fix/retest findings.
6. Run a small restricted pilot with trained administrators and measured support response.
7. Publicly launch only after the owner records acceptance of all launch gates. Keep this checklist and evidence updated after releases.

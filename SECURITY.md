# Security policy

Do not publish personal records, photos, passwords, environment files, database dumps, backup archives or session tokens in issues or pull requests.

Report a vulnerability through GitHub's **Security → Report a vulnerability** when private reporting is enabled. If that option is unavailable, contact a repository maintainer privately to arrange a confidential channel before sharing technical details. Public issues are not an appropriate channel for exploit details or private deployment data.

This project has not received an independent security certification. Before internet deployment, complete the [public-launch review](docs/PUBLIC-LAUNCH-REVIEW.md) and [server acceptance](docs/ACCEPTANCE.md). Use HTTPS, administrator MFA through a tested access layer, encrypted off-server backups, approved data-retention policies and a documented incident response process.

Version 0.23.x is the initial public release series. No paid support or response-time guarantee is implied. Use the latest reviewed patch and monitor dependency and operating-system advisories.

See [security model](docs/SECURITY.md), [hardening](docs/HARDENING.md) and [purge scope](docs/PURGE.md).

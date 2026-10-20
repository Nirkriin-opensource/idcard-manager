# Admin purge controls

Organization Admins and Super Admins see **Purge data · Admin only** in Organization, Audit, Cards and Jobs. Operators, Designers, Viewers and API tokens cannot use these controls or the purge endpoint.

Choose a category and a **Created before** cutoff in local time. The server stores an exact preview of up to 1,000 matching records per category for ten minutes. Review the counts, type **PURGE**, and select **Permanently purge previewed data**. Changing the category or cutoff clears the preview. A preview can only be confirmed by its original administrator in its original organization. Repeating a completed confirmation does not delete more records.

- **Audit log entries:** removes older audit entries except purge receipts. Ordinary updates and deletes remain prohibited.
- **Rendered ID cards & related exports:** removes saved front/back render snapshots and unshared renderer image assets. Export jobs/downloads containing those renders are also removed, even when the export is newer than the cutoff. Shared images used elsewhere are retained. People, uploaded photos/signatures/logos, templates, card identities/numbers/status, verification links and lifecycle events remain. Reissue a card when a new saved render is needed.
- **Completed job logs & export downloads:** removes completed/cancelled generation job records and their item logs, plus completed export jobs and their downloadable files. Failed jobs stay available for retry. Rendered cards remain.

Queued/running generation or export jobs block render and job-log purges. New writes and purges coordinate through organization-scoped transaction locks. If exports change after a render preview, create a fresh preview. Larger selections are processed in batches of 1,000; repeat the preview with the same cutoff for the next batch. If one render batch has more than 1,000 related exports, purge completed job logs first.

Deletion commits before physical file cleanup. A durable, tenant-scoped queue lets the worker retry cleanup after errors or restarts. Use **Refresh cleanup status** to check pending files. Every completed purge keeps an immutable receipt with the acting administrator, cutoff, original record IDs and summary; the Audit tab also retains a `retention.purge` entry. Historical backups retain their existing copies. Operating-system journals, authentication throttles and backups are outside these controls.

After purging renders, choose a **Replacement template** in Cards before renewing/reissuing that card. Its original identity and events remain; the replacement receives a new card number.

Adding these controls does not purge existing production data. Deletion happens only after the administrator previews and confirms it in the application.

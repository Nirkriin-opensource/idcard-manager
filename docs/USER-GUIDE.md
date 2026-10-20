
## Quick workflow and data management

Open **Manage data** for a task directory with links to People, Forms, Imports, Photos, Templates, Cards, bulk generation, downloads and administration. Search tasks by words such as edit, photo, restore or purge. The sidebar also has **Find a menu**. The workflow bar on the main preparation screens jumps between People → Photos → Template → Generate → Download. These are navigation shortcuts, not completion indicators; permissions are still enforced by the server.

Create or import people, match their photos, preview the template with a real record, generate a sample, then queue a batch and export its results. Changes to people/photos/templates require a new card or batch to use the updated values.

## Recycle bin and permanent removal

Ordinary People/Photos deletion is recoverable. Organization Admins and Super Admins can open **Recycle bin**, switch between Deleted people and Deleted photos, select records (or select the current page), and restore them. Restoring photos requires matching again.

When work is complete, choose **Preview permanent purge** for selected items or **Preview empty people/photos recycle bin** for the category. Review the counts and type **PURGE** to confirm. Cancel returns without deletion. Each preview expires after ten minutes, belongs to its original admin and organization, and is rejected if related records changed. Active generation/export jobs block purge. At most 1,000 deleted records are previewed at once; repeat for larger bins.

Purging deleted people removes their issued cards and verification links, lifecycle events, saved renders, approved linked form responses, matching normalized import rows and unshared linked photo/signature/render assets. Related generation jobs and exports are removed as whole batches/files, even when they also contain other people; those other people's records and separately saved cards stay. Review this impact before confirmation.

Purging deleted photos removes their related saved renders, downloads and generation snapshots, while retaining the person and card identity. Photos referenced by a template or another surviving record are blocked from purge. Shared assets are retained. Templates, organization settings, accounts/passwords, audit history and immutable purge receipts are retained. Existing backup copies expire under the backup policy; this feature does not rewrite them or securely erase disk media. Unlinked/unapproved responses and unrelated raw import records are outside this selection.

Files are queued for worker cleanup after the database transaction commits. Check **Refresh cleanup status** in the existing admin purge panel. Do not permanently remove records or logs that must be retained under your organization’s legal or contractual policy.

## Logs, archived templates and portrait framing

Audit and Jobs have no red Delete logs shortcut. Administrators can expand Purge data · Admin only when cleanup is needed, choose a cutoff, preview the selected records and type PURGE before confirming. No records are deleted by opening the controls.

Templates has General templates and Archive tabs. Archive moves a template out of General; Restore returns it. Archived templates cannot be selected for new cards.

Photo elements automatically locate and frame a clear face locally, with headroom and shoulders. This runs without sending photos to an external service and does not identify people. In the designer, select the photo and turn Automatically frame the face off to use the normal crop. Square photo sets a square frame. If no clear face is found, or several similarly sized faces are present, normal cropping remains available. Original uploaded photos are retained. Existing rendered cards and historical export framing are preserved.


## Shareable data collection forms

Open **Forms** as an organization administrator. Choose Employee, Student, Healthcare / practice, Visitor or Custom, then select **New form**. These are question presets; all responses use the existing General card workflow.

Set the title, profession or practice name, instructions, required questions and optional closing date. Healthcare forms include registration number, practice name, specialization and practice address. Add existing fields or create custom text, date, number, checkbox or dropdown questions. Reorder with the arrows. Name, ID and organization-required questions remain mandatory. Applicants can upload a photo and cardholder signature (JPEG, PNG or WebP, 4 MB each). Organization logos and authorized signatures remain organization-managed.

Save a draft, or enable **Accept responses** and save to open it. Copy the share link and send it to the intended applicants. A localhost link only works on the hosting computer; configure the application's network address or domain before sharing with other devices. The form does not require a login and never lists existing people or responses. It requires consent before submission.

Choose **Review responses**, open a response, check its images and correct text answers if needed. **Approve and add to People** creates a person and links the submitted images; then generate and download cards normally. Duplicate IDs cannot overwrite existing people: correct the ID during review or reject the duplicate. Rejected responses remain in the review history. Original submitted values, questions, form version and consent are retained alongside the reviewed values.

**Close form** stops new submissions while keeping responses. A closing date automatically stops the form. **Change share link** revokes the previous link. Form edits require applicants with an older page to reload, and do not change the questions frozen on previous responses. Submissions and share-link management are admin-only. Public submissions are rate-limited and each form can hold up to 1,000 pending responses.

## Organization time management

Open **Organization > Time management** to choose the organization's IANA time zone and 12-hour AM/PM or 24-hour display. The default is **India Standard Time (Asia/Kolkata)**. The displayed organization clock synchronizes with the server, refreshes periodically and resynchronizes when the tab becomes visible. Save time settings independently of appearance preferences.

Form closing times and datetime answers use the organization's zone rather than the applicant's browser zone. A clear closing-time preview shows AM or PM and the zone. Active forms cannot be saved with a closing time already in the past; use **No closing date** for manual closure. Form lists show **Expired** separately from closed/draft. Changing the time zone preserves each existing deadline's scheduled instant; edit the deadline explicitly if it needs extending. An expired form must have its deadline removed or extended and Accept responses enabled to reopen.

Timezone changes made while another person is editing a form or submitting datetime answers require them to reload, preventing silent interpretation in the wrong zone. Ambiguous or nonexistent daylight-saving clock times are rejected with a clear instruction. Submission history, audit entries, purge cutoffs and newly generated card dates/year numbering use the organization's time zone. Previously rendered cards and export snapshots retain their saved dates.

Copying form links works on HTTP LAN addresses using selection copying when the Clipboard API is unavailable. If the browser blocks automatic copying, the full link stays selected with instructions for Ctrl+C or touch-and-hold Copy. The copied link and Open form use the same saved address.

Photo batches now use an explicit submit step: select a matching field, choose multiple images or a photo ZIP, then click Upload images or Upload ZIP. Choosing files alone does not upload them. The button shows uploading progress; results appear after completion. A failed ZIP stays selected for retry.

Photo ZIP files larger than 25 MB are rejected in the browser before upload. Interrupted upload connections keep the selected file and explain how to check the photo list before retrying, because an interrupted response can occur after processing completes.

## Bulk match photos already uploaded

Open Photos → Bulk match uploaded photos. Choose Organization ID, leave Ignore spaces selected for filenames such as Admin_ 1.jpg, and click Preview bulk matches. Check the filename/person pairs, then click Match photos. Existing photo assignments are preserved. Identical duplicate uploads are treated as one choice; conflicting photos and ambiguous IDs must be matched manually. After matching, queue a new card batch because older batches keep their original snapshots.

## Delete and restore people

Organization administrators can tick person checkboxes, use Select all on this page if needed, and click Delete selected. Confirm the selected count. Records move to Deleted people; select their checkboxes there and click Restore selected. Photos and card history remain available for restoration; deleted people are excluded from normal directories, matching and new card generation. Public verification is inactive while a person is deleted. Restoring preserves the previous person and card data. IDs remain reserved; restore the record rather than creating the same ID again.

## Bulk delete people and photos

People: tick individual rows or Select all on this page, then choose Delete selected and confirm. Deleted people supports the same selection controls with Restore selected.

Photos: tick photos or Select all loaded photos, then choose Delete selected and confirm. Only ordinary photo uploads are selectable; logos, template images and private form photos are protected. Deleted photos supports Restore selected. Deleting photos removes their current person matches but keeps historical card images. After restoring photos, run bulk matching again. Changing pages or filters clears the selection.

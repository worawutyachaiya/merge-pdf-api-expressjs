# Merge PDF setup

Run `src/_workspace/sql/merge-pdf/schema.sql` to create the complete `_sit_merge_pdf_worawut_2026_09_30` database,
all Merge PDF tables, constraints, indexes and the ten document categories. It preserves existing
tables and data and creates missing tables and seed rows. Change the database name in CREATE DATABASE
and USE if needed, and set the API's DB configuration to that name. It is a complete schema file,
not a sequence of migration scripts; it does not alter definitions of tables that already exist.
Use MySQL 8.0.16+ and configure max_allowed_packet to at least 64 MiB on the server.

Install API dependencies with `pnpm install` and use Node.js >=22.13 (Node.js 24 recommended).
PDF thumbnails use PDF.js and @napi-rs/canvas. Excel conversion also requires Windows Tahoma fonts.

Set MERGE_PDF_OUTPUT_DIR to the output folder. The current environment files specify
`\\192.168.14.35\C12_PM-Support\MergePDF_TEST`. The account running the API needs permission
to read, create, rename and delete files there. Restart the API after environment changes.

New drafts automatically reserve IYY-MMNN names using Asia/Bangkok year/month and a locked
monthly sequence. Names remain the same on edits, and deleted numbers are never reused.
Add New previews the next number; allocation is confirmed under a database lock when creating
the draft, so simultaneous users can receive different numbers from their previews.
The sequence records the employee creator/updater and timestamps; INUSE=0 stops new reservations.
Save & Complete writes the merged PDF; Save Changes replaces the same file at the same shared path.
The list previews the current PDF, and Source documents downloads each original uploaded file.
Combined PDF imports classify clear document headings from the text layer on each page.
Scanned pages, conflicting headings and pages without a recognized heading remain unclassified
for manual selection. No OCR is performed. Import-entry status 04 is confirmed automatically only
when every selected import-entry page has an unambiguous labelled status 04 in its PDF text layer.
Bare numbers, scans without text, unreadable fields, other status codes and conflicting/uncertain fields
remain unconfirmed for the user to check. Automatic confirmations use ENTRY_STATUS_SOURCE=DOCUMENT;
manual confirmations use USER. The API rechecks new automatic confirmations against the uploaded PDF
when saving, and preserves the verified source on later saves. Confirmed Status 04 opens a confirmation
dialog before the user can remove the confirmation; that edit takes effect only when saved.
The Choose document type dropzone suggests a category per file using its filename first. If the
filename is unclear, it reads PDF text headings (up to the existing 500-page limit) or Excel headings
(first 40 rows of up to 10 sheets). Mixed/ambiguous types, scans without text and unreadable content
default to Other. Users can override suggestions, including while detection is running; late results
never overwrite their choice or restore removed files. Detection uses POST `/merge-pdf/editor/detect-document-type`
and does not save files or database rows. Import waits until queued detection finishes.
The multiline Description above Import is required when the batch contains Other pages, including
unclassified pages from Combined files. The whole batch is prepared and validated before adding pages,
so a missing description does not leave a partially imported batch. MERGE_PDF_DOCUMENT.DESCRIPTION
stores the source import description and MERGE_PDF_PAGE.DESCRIPTION stores each page's editable
description (nullable VARCHAR(1000), included in revision history). Other pages start with the import
description; their descriptions can be edited individually in the page preview. Save Draft and completion
both reject Other pages with missing descriptions. Existing records retain NULL until described.
Existing databases need these two nullable DESCRIPTION columns as defined in schema.sql; the configured
development database has been updated. Fresh databases receive them from the complete schema file.
Selected pages can change type, rotate or be removed in one transaction with one row-version update.
Invalid/stale selections are rejected before changes; deleting all pages of a source deactivates it.

Deleting a Draft or Completed document sets INUSE=0 on its database rows with the employee
performing the action, while physically deleting its recorded PDFs from the output folder.
Database document bytes and audit history remain. Modified or out-of-folder files are rejected;
failed database transactions restore files removed in that attempt.

CREATE_BY and UPDATE_BY come from the logged-in profile's EMPLOYEE_CODE, following the project's
existing client-profile pattern. Login and menu/action permissions follow the existing frontend Security Center flow, as in masterdata.

Saved edits preserve row history in the same tables. Each entity has a stable identifier and a
`REVISION_NO`; together they form the physical primary key. Editing retires the current row with
`INUSE = 0, IS_CURRENT = 0` and inserts a new revision with `INUSE = 1, IS_CURRENT = 1` in the same transaction. Retirement changes
only these flags and audit fields, preserving old values, page positions and PDF bytes. The new row's
CREATE_BY/UPDATE_BY identify the employee saving that revision (SYSTEM for scheduled work).
This covers document metadata, status 04, page type/rotation/order, Draft/Completed saves, monthly
number allocation, email settings/recipient selections and delivery status/attempts. Deletes retire
rows without inserting replacements. Frontend edits remain local until Save.

`IS_CURRENT` is a regular 1/0 column following masterdata, and current queries require both
`IS_CURRENT = 1` and `INUSE = 1`. Functional unique indexes use
`IF(IS_CURRENT = 1 AND INUSE = 1, 1, NULL)` to allow multiple history rows with IS_CURRENT = 0
while enforcing one current row and preventing duplicate current file codes, page positions and
scheduled batches. Foreign keys retain stable entity identifiers through
MySQL 8.0's support for nonunique referenced indexes. Normal queries filter INUSE = 1 on every
versioned join; history is available by identifier ordered by REVISION_NO. Saved document revisions
appear in Search result, View and Preview modals, and the editor header. Preview shows PDF version
separately from the document row revision. Email Settings displays its saved setting revision.
A successful PDF save
retires previous publications, keeping their bytes in the database; the Share keeps the latest file
under the existing filename. Earlier overwrites made before this change cannot be reconstructed.

Email settings let administrators select active employees from the `ACCOUNTING` department in
`person.MEMBER_FED` and choose the daily digest time (default 17:00 Asia/Bangkok). After a PDF is
published successfully, the API queues it and sends a summary at the configured time with
the document code, PDF name, completion time and Server Share path. Changing the delivery time allows
another batch on the same day, containing only eligible PDFs that have not already been assigned or sent.
Each date/time pair is processed once; earlier batches remain in the delivery history. Failed recipients are retried;
already delivered recipient emails are not resent during normal retries. Configure the person directory
connection explicitly with `PERSON_HOST`, `PERSON_USER_NAME`, `PERSON_PASSWORD`, `PERSON_DB`, and
`PERSON_PORT` in each environment file. Person lookups use this connection only; no values fall back to
the main database connection. Missing/invalid configuration produces an error and the recipients dropdown
does not show previous query results after a failed refresh. The API reads env at startup using the same loader and dev commands as masterdata. Restart the API
after changing env so that its connection pools use the new values. Set `MERGE_PDF_MAIL_API_URL` to the mail relay endpoint. The database
schema for a new database is defined completely in `schema.sql`. CREATE TABLE IF NOT EXISTS does
not modify an existing table definition; the existing configured database must also have the revision
columns and indexes before this API version starts. Existing data is retained as revision 1.

The localhost/development-only middleware has been removed. Environment mode does not block API routes.
Settings is a separate menu (Security Center ID 730), with its page at
`src/_workspace/pages/settings` and its URL at `/settings`. Document order and Accounting email appear
on the same page, side by side on larger screens and stacked on smaller screens, with separate Save/Reset actions.
Document types can be dragged into order with the pointer or reordered using Space and arrow keys; changes are saved explicitly.
The old `/email-settings` and `/merge-pdf/email-settings` page URLs redirect to Settings.
Accounting email retains separate API routes/controllers/services/SQL under `email-settings`. The API uses GET `/email-settings/get`,
GET `/email-settings/accounting-people` and PATCH `/email-settings/update`. Merge PDF routes are mounted
under `/merge-pdf`, with file handling and business logic in its controller/services. The scheduler is started
from `_workspace/jobs/emailDigestJob.ts` after the API starts, following the masterdata job pattern.
The Save action uses the menu's `IS_UPDATE` permission through the existing project helper.

Document order uses the existing `MERGE_PDF_CATEGORY.SORT_ORDER`; no new tables or columns are needed.
GET `/settings/document-order/get` returns current categories in their configured order.
PATCH `/settings/document-order/update` accepts the complete ordered list of category IDs and their
revision numbers. Saves reject stale/incomplete lists and retire the current group before inserting
replacement revisions in one transaction, preserving audit employee codes and old ordering.
The editor loads the latest saved order before an import batch or Sort by document type action;
pages of the same type keep their relative order. Settings changes do not reorder saved PDFs.
Page changes remain local until the document is explicitly saved.

Query construction follows masterdata's service/SQL split. `sql/merge-pdf/MergePdfSQL.ts` and
`sql/email-settings/EmailSettingsSQL.ts` build SQL without accessing connections or services.
Their corresponding `MergePdfDataService` and `EmailSettingsDataService` execute statements,
bind values and map results; application services handle the document and email flows.
`RecordRevisionSQL` builds revision queries, while `RecordRevisionService` executes retirement
and replacement on the caller's transaction connection. Queries retain bound parameters,
row locks and the same transaction boundaries for document history and email delivery.

The six email tables are:

| Table | Purpose |
| --- | --- |
| MERGE_PDF_EMAIL_SETTING | Daily send time and time zone; one current setting plus previous revisions. |
| MERGE_PDF_EMAIL_RECIPIENT | Selected Accounting employee codes; deselection sets INUSE to 0. |
| MERGE_PDF_EMAIL_QUEUE | Published PDF versions waiting for notification; edited/deleted jobs deactivate obsolete queue rows. |
| MERGE_PDF_EMAIL_DIGEST | One batch per date and configured send time, with status, attempt count and completion time. |
| MERGE_PDF_EMAIL_DIGEST_ITEM | Publications included in each daily batch. |
| MERGE_PDF_EMAIL_DIGEST_RECIPIENT | Recipient name/email snapshot and delivery status per batch, so retries skip delivered recipients. |

All six tables have INUSE, CREATE_BY, CREATE_DATE, UPDATE_BY and UPDATE_DATE. User changes use the
logged-in employee code; seeded settings and scheduler actions use SYSTEM. Failed batches remain eligible
for retry on later days, and inactive jobs/publications are excluded. The mail API accepts Server Share links
in the HTML body; this feature does not attach PDF files. Email clients may block file:// links, so the UNC path
is displayed as well. The relay has no confirmed idempotency contract: a crash after the relay accepts a mail
but before its delivery status is saved can cause a duplicate on retry.

Configuration follows masterdata: shared API application settings live in `.env`, database connection
settings live in each `.env.<mode>`, and connections use the generic prefix argument to `connection`.
Frontend application identity lives in `.env`; endpoint URLs live in each `.env.<mode>`. Development
connection values and the PDF output path have been copied to SIT, UAT, Production and Azure at the
user's request. Environment labels/modes still correspond to their files. `MERGE_PDF_OUTPUT_DIR` is
required; the output location is not hardcoded in the storage service. All modes currently share the same
Merge PDF database and output folder.

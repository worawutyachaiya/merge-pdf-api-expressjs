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
for manual selection. No OCR is performed, and import-entry status 04 still requires confirmation.
Selected pages can change type, rotate or be removed in one transaction with one row-version update.
Invalid/stale selections are rejected before changes; deleting all pages of a source deactivates it.

Deleting a Draft or Completed document sets INUSE=0 on its database rows with the employee
performing the action, while physically deleting its recorded PDFs from the output folder.
Database document bytes and audit history remain. Modified or out-of-folder files are rejected;
failed database transactions restore files removed in that attempt.

CREATE_BY and UPDATE_BY come from the logged-in profile's EMPLOYEE_CODE, following the project's
existing client-profile pattern. Login and menu/action permissions follow the existing frontend Security Center flow, as in masterdata.

Email settings let administrators select active employees from the `ACCOUNTING` department in
`person.MEMBER_FED` and choose the daily digest time (default 17:00 Asia/Bangkok). After a PDF is
published successfully, the API queues it and sends one daily summary per selected employee with
the document code, PDF name, completion time and Server Share path. Failed recipients are retried;
already delivered recipient emails are not resent during normal retries. Configure the person directory
connection explicitly with `PERSON_HOST`, `PERSON_USER_NAME`, `PERSON_PASSWORD`, `PERSON_DB`, and
`PERSON_PORT` in each environment file. Person lookups use this connection only; no values fall back to
the main database connection. Missing/invalid configuration produces an error and the recipients dropdown
does not show previous query results after a failed refresh. The API reads env at startup using the same loader and dev commands as masterdata. Restart the API
after changing env so that its connection pools use the new values. Set `MERGE_PDF_MAIL_API_URL` to the mail relay endpoint. The database
schema should be applied from the current `schema.sql`; existing jobs and already-created tables are
preserved while missing email tables and the default setting are added.

The localhost/development-only middleware has been removed. Environment mode does not block API routes.
Email Settings is a separate menu (Security Center ID 730), with its page at
`src/_workspace/pages/email-settings`, its URL at `/email-settings`, and separate API
routes/controllers/services/SQL under `email-settings`. The API uses GET `/email-settings/get`,
GET `/email-settings/accounting-people` and PATCH `/email-settings/update`. Merge PDF routes are mounted
under `/merge-pdf`, with file handling and business logic in its controller/services. The scheduler is started
from `_workspace/jobs/emailDigestJob.ts` after the API starts, following the masterdata job pattern. The previous page URL redirects to the new URL.
The Save action uses the menu's `IS_UPDATE` permission through the existing project helper.

The six email tables are:

| Table | Purpose |
| --- | --- |
| MERGE_PDF_EMAIL_SETTING | Daily send time and time zone; one setting row. |
| MERGE_PDF_EMAIL_RECIPIENT | Selected Accounting employee codes; deselection sets INUSE to 0. |
| MERGE_PDF_EMAIL_QUEUE | Published PDF versions waiting for notification; edited/deleted jobs deactivate obsolete queue rows. |
| MERGE_PDF_EMAIL_DIGEST | One daily batch with status, attempt count and completion time. |
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

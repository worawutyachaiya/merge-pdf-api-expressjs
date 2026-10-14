# Merge PDF setup

Run `src/_workspace/sql/merge-pdf/schema.sql` once to create the complete `merge_pdf` database,
all six tables, constraints, indexes and the ten document categories. Change the database name
in CREATE DATABASE and USE if needed, and set the API's DB configuration to that name.
This schema is for a new database and contains no business documents or incremental migrations.
Use MySQL 8.0.16+ and configure max_allowed_packet to at least 64 MiB on the server.

Install API dependencies with `pnpm install` and use Node.js >=22.13 (Node.js 24 recommended).
PDF thumbnails use PDF.js and @napi-rs/canvas. Excel conversion also requires Windows Tahoma fonts.

Set MERGE_PDF_OUTPUT_DIR to the output folder. Its default is
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
existing client-profile pattern. The API's development-only access restriction remains;
server-side company authentication is required before enabling production access.

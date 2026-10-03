-- Manual rollback for an unused development installation only. Never use for application deletes.
-- Verify all operational tables are empty before running; DROP permanently removes stored files.
DROP TABLE IF EXISTS MERGE_PDF_PUBLICATION;
DROP TABLE IF EXISTS MERGE_PDF_PAGE;
DROP TABLE IF EXISTS MERGE_PDF_DOCUMENT;
DROP TABLE IF EXISTS MERGE_PDF_JOB;
DROP TABLE IF EXISTS MERGE_PDF_CATEGORY;

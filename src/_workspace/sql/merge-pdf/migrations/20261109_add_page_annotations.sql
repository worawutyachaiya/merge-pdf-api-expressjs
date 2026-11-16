-- Remark metadata stays in the editor. Only E-stamp images enter exported PDFs.
ALTER TABLE MERGE_PDF_PAGE ADD COLUMN EDITOR_ANNOTATIONS JSON NULL AFTER DESCRIPTION;

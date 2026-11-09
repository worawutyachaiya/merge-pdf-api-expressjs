-- Preserve the existing 10 pt appearance for every existing revision.
ALTER TABLE MERGE_PDF_JOB
  ADD COLUMN STAMP_FONT_SIZE DOUBLE NOT NULL DEFAULT 10 AFTER STAMP_Y;

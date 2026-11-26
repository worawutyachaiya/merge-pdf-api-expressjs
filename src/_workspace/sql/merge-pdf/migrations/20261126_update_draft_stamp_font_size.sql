-- Run once after 20261126_set_default_stamp_font_size.sql.
-- A draft that explicitly saved 10 pt has the same stored value as the old default.
UPDATE MERGE_PDF_JOB
SET STAMP_FONT_SIZE = 25, ROW_VERSION = ROW_VERSION + 1, UPDATE_DATE = UPDATE_DATE
WHERE IS_CURRENT = 1
  AND INUSE = 1
  AND STATUS = 'DRAFT'
  AND LAST_COMPLETE_DATE IS NULL
  AND STAMP_FONT_SIZE = 10;

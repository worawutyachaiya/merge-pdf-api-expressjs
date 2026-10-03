-- Apply only to the dedicated Merge PDF development database after the initial schema.
UPDATE MERGE_PDF_CATEGORY
SET REQUIRED_FOR_COMPLETE = 1, UPDATE_BY = 'SYSTEM'
WHERE CATEGORY_ID IN (2, 4) AND INUSE = 1;

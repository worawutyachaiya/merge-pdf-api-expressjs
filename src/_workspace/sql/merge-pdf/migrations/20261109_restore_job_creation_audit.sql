-- Restore original creator and creation time for job revisions affected by the previous revision writer.
UPDATE MERGE_PDF_JOB AS job
JOIN MERGE_PDF_JOB AS original
  ON original.JOB_ID = job.JOB_ID
 AND original.REVISION_NO = 1
SET job.CREATE_BY = original.CREATE_BY,
    job.CREATE_DATE = original.CREATE_DATE,
    job.UPDATE_DATE = job.UPDATE_DATE
WHERE job.CREATE_BY <> original.CREATE_BY
   OR job.CREATE_DATE <> original.CREATE_DATE;

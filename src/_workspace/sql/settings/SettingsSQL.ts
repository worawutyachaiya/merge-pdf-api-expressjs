export const SettingsSQL = {
  documentOrder: (lock = false): string =>
    `SELECT
        MERGE_PDF_CATEGORY_ID AS CATEGORY_ID,
        MERGE_PDF_CATEGORY_NAME AS CATEGORY_NAME,
        SORT_ORDER, REVISION_NO, IS_ENABLED, REQUIRED_FOR_COMPLETE
     FROM MERGE_PDF_CATEGORY
     WHERE INUSE = 1 AND IS_CURRENT = 1
     ORDER BY SORT_ORDER, MERGE_PDF_CATEGORY_ID${lock ? ' FOR UPDATE' : ''}`,
  whereCategories: (count: number): string => `MERGE_PDF_CATEGORY_ID IN (${Array(count).fill('?').join(', ')})`,
  categoryValues: (count: number): string => `CASE MERGE_PDF_CATEGORY_ID ${Array(count).fill('WHEN ? THEN ?').join(' ')} END`,
  insertCategory: (): string =>
    `INSERT INTO MERGE_PDF_CATEGORY
       (MERGE_PDF_CATEGORY_ID, MERGE_PDF_CATEGORY_CODE, MERGE_PDF_CATEGORY_NAME, SORT_ORDER, CREATE_BY, UPDATE_BY)
     VALUES (?, ?, ?, ?, ?, ?)`,
}

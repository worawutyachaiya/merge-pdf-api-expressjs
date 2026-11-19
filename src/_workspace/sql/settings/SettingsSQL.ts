export const SettingsSQL = {
  documentOrder: (lock = false): string =>
    `SELECT CATEGORY_ID, CATEGORY_NAME, SORT_ORDER, REVISION_NO, IS_ENABLED, REQUIRED_FOR_COMPLETE FROM MERGE_PDF_CATEGORY
     WHERE INUSE = 1 AND IS_CURRENT = 1 ORDER BY SORT_ORDER, CATEGORY_ID${lock ? ' FOR UPDATE' : ''}`,
  whereCategories: (count: number): string => `CATEGORY_ID IN (${Array(count).fill('?').join(', ')})`,
  categoryValues: (count: number): string => `CASE CATEGORY_ID ${Array(count).fill('WHEN ? THEN ?').join(' ')} END`,
  insertCategory: (): string =>
    'INSERT INTO MERGE_PDF_CATEGORY (CATEGORY_ID, CATEGORY_CODE, CATEGORY_NAME, SORT_ORDER, CREATE_BY, UPDATE_BY) VALUES (?, ?, ?, ?, ?, ?)',
}

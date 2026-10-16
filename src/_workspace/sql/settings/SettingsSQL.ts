export const SettingsSQL = {
  documentOrder: (lock = false): string =>
    `SELECT CATEGORY_ID, CATEGORY_NAME, SORT_ORDER, REVISION_NO FROM MERGE_PDF_CATEGORY
     WHERE INUSE = 1 AND IS_CURRENT = 1 ORDER BY SORT_ORDER, CATEGORY_ID${lock ? ' FOR UPDATE' : ''}`,
  whereCategories: (count: number): string => `CATEGORY_ID IN (${Array(count).fill('?').join(', ')})`,
  categoryOrder: (count: number): string => `CASE CATEGORY_ID ${Array(count).fill('WHEN ? THEN ?').join(' ')} END`,
}

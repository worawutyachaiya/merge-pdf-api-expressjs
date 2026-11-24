// Entity identifiers remain stable across revisions so document/page/mail references stay valid.
// The physical primary key is (entity ID, REVISION_NO).
const fieldsByTable = {
  MERGE_PDF_CATEGORY: 'MERGE_PDF_CATEGORY_CODE MERGE_PDF_CATEGORY_NAME SORT_ORDER REQUIRED_FOR_COMPLETE IS_ENABLED',
  MERGE_PDF_JOB: 'MERGE_PDF_JOB_CODE MERGE_PDF_JOB_REFERENCE HAWB_OVERRIDE MERGE_PDF_JOB_TITLE STAMP_X STAMP_Y STAMP_FONT_SIZE STAMP_STYLE STATUS ROW_VERSION LAST_COMPLETE_DATE',
  MERGE_PDF_DOCUMENT:
    'MERGE_PDF_JOB_ID MERGE_PDF_CATEGORY_ID UPLOAD_ORDER ORIGINAL_FILE_NAME SOURCE_TYPE SOURCE_MIME ORIGINAL_SIZE_BYTES ORIGINAL_SHA256 ORIGINAL_BYTES ' +
    'NORMALIZED_PDF_SIZE_BYTES NORMALIZED_PDF_SHA256 NORMALIZED_PDF_BYTES PDF_PAGE_COUNT ENTRY_STATUS_CODE ENTRY_STATUS_SOURCE DESCRIPTION',
  MERGE_PDF_PAGE:
    'MERGE_PDF_JOB_ID MERGE_PDF_DOCUMENT_ID MERGE_PDF_CATEGORY_ID CLASSIFICATION_SOURCE CLASSIFICATION_CONFIDENCE SOURCE_PAGE_NUMBER ' +
    'ROTATION_DEGREES DESKEW_DEGREES SORT_ORDER DESCRIPTION EDITOR_ANNOTATIONS',
  MERGE_PDF_PUBLICATION:
    'MERGE_PDF_JOB_ID PUBLICATION_VERSION STATUS OUTPUT_FILE_NAME OUTPUT_SIZE_BYTES OUTPUT_SHA256 OUTPUT_PDF_BYTES OUTPUT_PAGE_COUNT NETWORK_PATH FAILURE_CODE PUBLISH_DATE',
  MERGE_PDF_FILE_SEQUENCE: 'PREFIX NEXT_VALUE',
  MERGE_PDF_EMAIL_SETTING: 'SCHEDULE_TIME TIME_ZONE',
  MERGE_PDF_EMAIL_RECIPIENT: 'EMPLOYEE_CODE',
  MERGE_PDF_EMAIL_QUEUE: 'MERGE_PDF_JOB_ID MERGE_PDF_PUBLICATION_ID STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE',
  MERGE_PDF_EMAIL_DIGEST: 'DIGEST_DATE SCHEDULE_TIME STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE',
  MERGE_PDF_EMAIL_DIGEST_ITEM: 'MERGE_PDF_EMAIL_DIGEST_ID MERGE_PDF_EMAIL_QUEUE_ID',
  MERGE_PDF_EMAIL_DIGEST_RECIPIENT:
    'MERGE_PDF_EMAIL_DIGEST_ID EMPLOYEE_CODE RECIPIENT_NAME RECIPIENT_EMAIL STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE',
} as const

export const revisionSql = (sql: string, ...params: unknown[]) => ({ sql, params })
export type RevisionTable = keyof typeof fieldsByTable

type RevisionRow = Record<string, unknown>
const identityOf = (table: RevisionTable, rows: readonly RevisionRow[]) => {
  const idColumn = `${table}_ID`
  return {
    predicate: `(${idColumn}, REVISION_NO) IN (${rows.map(() => '(?, ?)').join(', ')})`,
    params: rows.flatMap((row) => [row[idColumn], row.REVISION_NO]),
  }
}

export const RecordRevisionSQL = {
  selectActive: (table: RevisionTable, where: string, changes: Record<string, unknown>): string => {
    const columns = fieldsByTable[table].split(' ')
    for (const field of Object.keys(changes)) if (!columns.includes(field)) throw new Error(`Cannot revise ${table}.${field}`)
    return `SELECT ${table}_ID, REVISION_NO FROM ${table} WHERE INUSE = 1 AND IS_CURRENT = 1 AND (${where}) FOR UPDATE`
  },
  retire: (table: RevisionTable, rows: readonly RevisionRow[], actor: string) => {
    const identity = identityOf(table, rows)
    return {
      sql: `UPDATE ${table} SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE INUSE = 1 AND IS_CURRENT = 1 AND ${identity.predicate}`,
      params: [actor, ...identity.params],
    }
  },
  insertReplacement: (table: RevisionTable, rows: readonly RevisionRow[], changes: Record<string, unknown>, actor: string) => {
    const columns = [`${table}_ID`, ...fieldsByTable[table].split(' '), 'CREATE_DATE']
    const identity = identityOf(table, rows)
    const values: unknown[] = []
    const expressions = columns.map((column) => {
      if (!Object.hasOwn(changes, column)) return column
      const value = changes[column]
      if (value && typeof value === 'object' && 'sql' in value && 'params' in value) {
        const expression = value as ReturnType<typeof revisionSql>
        values.push(...expression.params)
        return expression.sql
      }
      values.push(value)
      return '?'
    })
    return {
      sql: `INSERT INTO ${table} (${columns.join(', ')}, REVISION_NO, IS_CURRENT, INUSE, CREATE_BY, UPDATE_BY)
     SELECT ${expressions.join(', ')}, REVISION_NO + 1, 1, 1, CREATE_BY, ? FROM ${table} WHERE ${identity.predicate}`,
      params: [...values, actor, ...identity.params],
    }
  },
}

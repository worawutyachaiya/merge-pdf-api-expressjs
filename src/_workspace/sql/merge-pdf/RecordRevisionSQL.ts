// Entity identifiers remain stable across revisions so document/page/mail references stay valid.
// The physical primary key is (entity identifier(s), REVISION_NO).
const records = {
  MERGE_PDF_CATEGORY: ['CATEGORY_ID', 'CATEGORY_CODE CATEGORY_NAME SORT_ORDER REQUIRED_FOR_COMPLETE'],
  MERGE_PDF_JOB: ['JOB_ID', 'JOB_CODE JOB_REFERENCE JOB_TITLE STATUS ROW_VERSION LAST_COMPLETED_AT'],
  MERGE_PDF_DOCUMENT: [
    'DOCUMENT_ID',
    'JOB_ID CATEGORY_ID UPLOAD_ORDER ORIGINAL_FILE_NAME SOURCE_TYPE SOURCE_MIME ORIGINAL_SIZE_BYTES ORIGINAL_SHA256 ORIGINAL_BYTES ' +
      'NORMALIZED_PDF_SIZE_BYTES NORMALIZED_PDF_SHA256 NORMALIZED_PDF_BYTES PDF_PAGE_COUNT ENTRY_STATUS_CODE ENTRY_STATUS_SOURCE DESCRIPTION',
  ],
  MERGE_PDF_PAGE: ['PAGE_ID', 'JOB_ID DOCUMENT_ID CATEGORY_ID CLASSIFICATION_SOURCE CLASSIFICATION_CONFIDENCE SOURCE_PAGE_NUMBER ROTATION_DEGREES SORT_ORDER DESCRIPTION'],
  MERGE_PDF_PUBLICATION: [
    'PUBLICATION_ID',
    'JOB_ID PUBLICATION_VERSION STATUS OUTPUT_FILE_NAME OUTPUT_SIZE_BYTES OUTPUT_SHA256 OUTPUT_PDF_BYTES OUTPUT_PAGE_COUNT NETWORK_PATH FAILURE_CODE PUBLISHED_AT',
  ],
  MERGE_PDF_FILE_SEQUENCE: ['PREFIX', 'NEXT_VALUE'],
  MERGE_PDF_EMAIL_SETTING: ['SETTING_ID', 'SCHEDULE_TIME TIME_ZONE'],
  MERGE_PDF_EMAIL_RECIPIENT: ['EMPLOYEE_CODE', ''],
  MERGE_PDF_EMAIL_QUEUE: ['QUEUE_ID', 'JOB_ID PUBLICATION_ID STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE'],
  MERGE_PDF_EMAIL_DIGEST: ['DIGEST_ID', 'DIGEST_DATE SCHEDULE_TIME STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE'],
  MERGE_PDF_EMAIL_DIGEST_ITEM: ['DIGEST_ID QUEUE_ID', ''],
  MERGE_PDF_EMAIL_DIGEST_RECIPIENT: ['DIGEST_ID EMPLOYEE_CODE', 'RECIPIENT_NAME RECIPIENT_EMAIL STATUS ATTEMPT_COUNT LAST_ERROR SENT_DATE'],
} as const

export const revisionSql = (sql: string, ...params: unknown[]) => ({ sql, params })
export type RevisionTable = keyof typeof records

type RevisionRow = Record<string, unknown>
const recordColumns = (table: RevisionTable) => records[table].map((value) => value.split(' ').filter(Boolean))
const identityOf = (table: RevisionTable, rows: readonly RevisionRow[]) => {
  const [keys] = recordColumns(table)
  const identity = rows.map(() => `(${[...keys, 'REVISION_NO'].map(() => '?').join(', ')})`).join(', ')
  return {
    predicate: `(${[...keys, 'REVISION_NO'].join(', ')}) IN (${identity})`,
    params: rows.flatMap((row) => [...keys.map((key) => row[key]), row.REVISION_NO]),
  }
}

export const RecordRevisionSQL = {
  selectActive: (table: RevisionTable, where: string, changes: Record<string, unknown>): string => {
    const [keys, fields] = recordColumns(table)
    for (const field of Object.keys(changes)) if (!fields.includes(field)) throw new Error(`Cannot revise ${table}.${field}`)
    return `SELECT ${keys.join(', ')}, REVISION_NO FROM ${table} WHERE INUSE = 1 AND IS_CURRENT = 1 AND (${where}) FOR UPDATE`
  },
  retire: (table: RevisionTable, rows: readonly RevisionRow[], actor: string) => {
    const identity = identityOf(table, rows)
    return {
      sql: `UPDATE ${table} SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE INUSE = 1 AND IS_CURRENT = 1 AND ${identity.predicate}`,
      params: [actor, ...identity.params],
    }
  },
  insertReplacement: (table: RevisionTable, rows: readonly RevisionRow[], changes: Record<string, unknown>, actor: string) => {
    const [keys, fields] = recordColumns(table)
    const columns = [...keys, ...fields]
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
     SELECT ${expressions.join(', ')}, REVISION_NO + 1, 1, 1, ?, ? FROM ${table} WHERE ${identity.predicate}`,
      params: [...values, actor, actor, ...identity.params],
    }
  },
}

import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { FileSequenceInactiveError } from '@src/_workspace/services/merge-pdf/ImportFileName'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { MySQLExecute } from '@src/businessData/dbExecute'
import { replaceActiveRecords, revisionSql } from './RecordRevision'
import type { DocumentStatusSummary, DocumentSummary, JobSummary, PageClassification, PageSummary, PublicationSummary } from '@src/_workspace/types/merge-pdf/MergePdf'

interface JobRow extends RowDataPacket, JobSummary {}
interface DocumentRow extends RowDataPacket, DocumentSummary {}
interface PageRow extends RowDataPacket, PageSummary {}
interface PublicationRow extends RowDataPacket, PublicationSummary {}
interface BlobRow extends RowDataPacket {
  DOCUMENT_ID: number
  NORMALIZED_PDF_BYTES: Buffer
}
interface BinaryRow extends RowDataPacket {
  OUTPUT_PDF_BYTES: Buffer
  OUTPUT_FILE_NAME: string
}
interface PendingRow extends BinaryRow {
  PUBLICATION_ID: number
  NETWORK_PATH: string | null
}
interface PublishedRow extends PublicationRow {
  OUTPUT_PDF_BYTES: Buffer
  OUTPUT_SHA256: Buffer
}
interface PageSourceRow extends RowDataPacket {
  SOURCE_PAGE_NUMBER: number
  ROTATION_DEGREES: number
  NORMALIZED_PDF_BYTES: Buffer
}
interface PageThumbnailRow extends RowDataPacket {
  DOCUMENT_ID: number
  SOURCE_PAGE_NUMBER: number
  ROTATION_DEGREES: number
  PDF_PAGE_COUNT: number
}
interface CountRow extends RowDataPacket {
  NEXT_VALUE: number
}
interface FileSequenceRow extends CountRow {
  INUSE: number
}
interface TotalRow extends RowDataPacket {
  TOTAL: number
}
interface CategoryIdRow extends RowDataPacket {
  CATEGORY_ID: number
}
interface DocumentStatusRow extends RowDataPacket {
  JOB_ID: number
  CATEGORY_ID: number
  PAGE_COUNT: number
  UNCLASSIFIED_PAGE_COUNT: number
}

const jobSelect = `
  SELECT J.JOB_ID, J.INUSE, J.JOB_CODE,
    CASE WHEN J.JOB_CODE REGEXP '^I[0-9]{2}-[0-9]{4,}$' THEN J.JOB_CODE ELSE J.JOB_TITLE END AS JOB_TITLE,
    J.JOB_REFERENCE, J.STATUS, J.ROW_VERSION, J.REVISION_NO,
    J.CREATE_DATE, J.CREATE_BY, J.UPDATE_DATE, J.UPDATE_BY, J.LAST_COMPLETED_AT,
    (SELECT OUTPUT_FILE_NAME FROM MERGE_PDF_PUBLICATION R WHERE R.JOB_ID = J.JOB_ID
      AND R.STATUS = 'PUBLISHED' AND R.INUSE = 1 AND R.IS_CURRENT = 1 ORDER BY R.PUBLICATION_VERSION DESC LIMIT 1) AS OUTPUT_FILE_NAME,
    (SELECT NETWORK_PATH FROM MERGE_PDF_PUBLICATION R WHERE R.JOB_ID = J.JOB_ID
      AND R.STATUS = 'PUBLISHED' AND R.INUSE = 1 AND R.IS_CURRENT = 1 ORDER BY R.PUBLICATION_VERSION DESC LIMIT 1) AS NETWORK_PATH,
    (SELECT COUNT(*) FROM MERGE_PDF_DOCUMENT D WHERE D.JOB_ID = J.JOB_ID AND D.INUSE = 1 AND D.IS_CURRENT = 1) AS DOCUMENT_COUNT,
    (SELECT COUNT(*) FROM MERGE_PDF_PAGE P WHERE P.JOB_ID = J.JOB_ID AND P.INUSE = 1 AND P.IS_CURRENT = 1) AS PAGE_COUNT
  FROM MERGE_PDF_JOB J`

export const MergePdfRepository = {
  getNextImportNumber: async (prefix: string) => {
    const [row] = await MySQLExecute.queryParams<FileSequenceRow[]>('SELECT NEXT_VALUE, INUSE FROM MERGE_PDF_FILE_SEQUENCE WHERE PREFIX = ? ORDER BY REVISION_NO DESC LIMIT 1', [
      prefix,
    ])
    return row
  },
  getDocumentStatuses: async (jobIds: readonly number[]): Promise<Map<number, DocumentStatusSummary>> => {
    const summaries = new Map<number, DocumentStatusSummary>()
    if (!jobIds.length) return summaries
    const rows = await MySQLExecute.queryParams<DocumentStatusRow[]>(
      `SELECT P.JOB_ID, COALESCE(P.CATEGORY_ID, D.CATEGORY_ID) AS CATEGORY_ID,
        SUM(CASE WHEN P.CLASSIFICATION_SOURCE = 'UNKNOWN' THEN 0 ELSE 1 END) AS PAGE_COUNT,
        SUM(CASE WHEN P.CLASSIFICATION_SOURCE = 'UNKNOWN' THEN 1 ELSE 0 END) AS UNCLASSIFIED_PAGE_COUNT
       FROM MERGE_PDF_PAGE P JOIN MERGE_PDF_DOCUMENT D ON D.DOCUMENT_ID = P.DOCUMENT_ID
       WHERE P.INUSE = 1 AND P.IS_CURRENT = 1 AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND P.JOB_ID IN (${jobIds.map(() => '?').join(',')})
       GROUP BY P.JOB_ID, COALESCE(P.CATEGORY_ID, D.CATEGORY_ID)`,
      jobIds
    )
    for (const row of rows) {
      const summary: DocumentStatusSummary = summaries.get(row.JOB_ID) ?? { DOCUMENT_PAGE_COUNTS: {}, UNCLASSIFIED_PAGE_COUNT: 0 }
      if (Number(row.PAGE_COUNT) > 0) summary.DOCUMENT_PAGE_COUNTS[row.CATEGORY_ID] = Number(row.PAGE_COUNT)
      summary.UNCLASSIFIED_PAGE_COUNT += Number(row.UNCLASSIFIED_PAGE_COUNT)
      summaries.set(row.JOB_ID, summary)
    }
    return summaries
  },

  getRequiredCategoryIds: async (conn: PoolConnection): Promise<number[]> => {
    const [rows] = await conn.query<CategoryIdRow[]>(
      'SELECT CATEGORY_ID FROM MERGE_PDF_CATEGORY WHERE INUSE = 1 AND IS_CURRENT = 1 AND REQUIRED_FOR_COMPLETE = 1 ORDER BY SORT_ORDER'
    )
    return rows.map((row) => row.CATEGORY_ID)
  },

  listJobs: async (
    search: string,
    status: 'ALL' | 'DRAFT' | 'COMPLETED',
    page: number,
    pageSize: number,
    titleFilter: string,
    updateByFilter: string,
    sortBy: 'JOB_TITLE' | 'STATUS' | 'DOCUMENT_COUNT' | 'PAGE_COUNT' | 'UPDATE_DATE' | 'UPDATE_BY',
    sortDesc: boolean
  ): Promise<{ rows: JobRow[]; total: number }> => {
    const where = `WHERE J.INUSE = 1 AND J.IS_CURRENT = 1 AND (? = '' OR J.JOB_TITLE LIKE ? OR J.JOB_CODE LIKE ?)
      AND (? = 'ALL' OR J.STATUS = ?) AND (? = '' OR (CASE WHEN J.JOB_CODE REGEXP '^I[0-9]{2}-[0-9]{4,}$' THEN J.JOB_CODE ELSE J.JOB_TITLE END) LIKE ?)
      AND (? = '' OR J.UPDATE_BY LIKE ?)`
    const params = [search, `%${search}%`, `%${search}%`, status, status, titleFilter, `%${titleFilter}%`, updateByFilter, `%${updateByFilter}%`]
    const sortColumns = {
      JOB_TITLE: 'JOB_TITLE',
      STATUS: 'J.STATUS',
      DOCUMENT_COUNT: 'DOCUMENT_COUNT',
      PAGE_COUNT: 'PAGE_COUNT',
      UPDATE_DATE: 'J.UPDATE_DATE',
      UPDATE_BY: 'J.UPDATE_BY',
    } as const
    const orderBy = `${sortColumns[sortBy]} ${sortDesc ? 'DESC' : 'ASC'}, J.JOB_ID DESC`
    const [rows, counts] = await Promise.all([
      MySQLExecute.queryParams<JobRow[]>(`${jobSelect} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
      MySQLExecute.queryParams<TotalRow[]>(`SELECT COUNT(*) AS TOTAL FROM MERGE_PDF_JOB J ${where}`, params),
    ])
    return { rows, total: counts[0].TOTAL }
  },

  getJob: async (jobId: number, conn?: PoolConnection): Promise<JobRow | undefined> => {
    const sql = `${jobSelect} WHERE J.JOB_ID = ? AND J.INUSE = 1 AND J.IS_CURRENT = 1`
    const rows = conn ? (await conn.query<JobRow[]>(sql, [jobId]))[0] : await MySQLExecute.queryParams<JobRow[]>(sql, [jobId])
    return rows[0]
  },

  lockJob: async (conn: PoolConnection, jobId: number): Promise<JobRow | undefined> => {
    const [rows] = await conn.query<JobRow[]>(`${jobSelect} WHERE J.JOB_ID = ? AND J.INUSE = 1 AND J.IS_CURRENT = 1 FOR UPDATE`, [jobId])
    return rows[0]
  },

  getDocuments: async (jobId: number, conn?: PoolConnection): Promise<DocumentRow[]> => {
    const sql = `SELECT D.DOCUMENT_ID, D.JOB_ID, D.CATEGORY_ID, C.CATEGORY_NAME,
      D.ORIGINAL_FILE_NAME, D.SOURCE_TYPE, D.PDF_PAGE_COUNT, D.ENTRY_STATUS_CODE,
      D.ENTRY_STATUS_SOURCE, D.UPLOAD_ORDER
      FROM MERGE_PDF_DOCUMENT D JOIN MERGE_PDF_CATEGORY C ON C.CATEGORY_ID = D.CATEGORY_ID
      WHERE D.JOB_ID = ? AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND C.INUSE = 1 AND C.IS_CURRENT = 1 ORDER BY C.SORT_ORDER, D.UPLOAD_ORDER`
    return conn ? (await conn.query<DocumentRow[]>(sql, [jobId]))[0] : MySQLExecute.queryParams<DocumentRow[]>(sql, [jobId])
  },

  getPages: async (jobId: number, conn?: PoolConnection): Promise<PageRow[]> => {
    const sql = `SELECT P.PAGE_ID, P.DOCUMENT_ID, P.SOURCE_PAGE_NUMBER, P.ROTATION_DEGREES, P.SORT_ORDER,
      COALESCE(P.CATEGORY_ID, D.CATEGORY_ID) AS CATEGORY_ID,
      P.CLASSIFICATION_SOURCE, P.CLASSIFICATION_CONFIDENCE
      FROM MERGE_PDF_PAGE P JOIN MERGE_PDF_DOCUMENT D ON D.DOCUMENT_ID = P.DOCUMENT_ID
      WHERE P.JOB_ID = ? AND P.INUSE = 1 AND P.IS_CURRENT = 1 AND D.INUSE = 1 AND D.IS_CURRENT = 1 ORDER BY P.SORT_ORDER`
    return conn ? (await conn.query<PageRow[]>(sql, [jobId]))[0] : MySQLExecute.queryParams<PageRow[]>(sql, [jobId])
  },

  getPublications: (jobId: number): Promise<PublicationRow[]> =>
    MySQLExecute.queryParams<PublicationRow[]>(
      `SELECT PUBLICATION_ID, PUBLICATION_VERSION, STATUS, OUTPUT_FILE_NAME, NETWORK_PATH, PUBLISHED_AT
     FROM MERGE_PDF_PUBLICATION WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1 ORDER BY PUBLICATION_VERSION DESC`,
      [jobId]
    ),

  getDocumentPdf: async (documentId: number): Promise<Buffer | undefined> => {
    const rows = await MySQLExecute.queryParams<BlobRow[]>(
      `SELECT D.DOCUMENT_ID, D.NORMALIZED_PDF_BYTES FROM MERGE_PDF_DOCUMENT D
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = D.JOB_ID
       WHERE D.DOCUMENT_ID = ? AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND J.INUSE = 1 AND J.IS_CURRENT = 1`,
      [documentId]
    )
    return rows[0]?.NORMALIZED_PDF_BYTES
  },

  getOriginalDocument: async (jobId: number, documentId: number) => {
    const [row] = await MySQLExecute.queryParams<(RowDataPacket & { ORIGINAL_FILE_NAME: string; SOURCE_MIME: string; ORIGINAL_BYTES: Buffer })[]>(
      `SELECT D.ORIGINAL_FILE_NAME, D.SOURCE_MIME, D.ORIGINAL_BYTES FROM MERGE_PDF_DOCUMENT D
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = D.JOB_ID
       WHERE D.JOB_ID = ? AND D.DOCUMENT_ID = ? AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND J.INUSE = 1 AND J.IS_CURRENT = 1`,
      [jobId, documentId]
    )
    return row
  },

  getDeletionPublications: async (conn: PoolConnection, jobId: number) => {
    const [rows] = await conn.query<PublishedRow[]>(
      `SELECT OUTPUT_FILE_NAME, NETWORK_PATH, OUTPUT_SHA256 FROM MERGE_PDF_PUBLICATION
       WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1 AND STATUS = 'PUBLISHED' ORDER BY PUBLICATION_VERSION DESC`,
      [jobId]
    )
    return rows
  },

  getPagePdfSource: async (jobId: number, pageId: number): Promise<PageSourceRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PageSourceRow[]>(
      `SELECT P.SOURCE_PAGE_NUMBER, P.ROTATION_DEGREES, D.NORMALIZED_PDF_BYTES
       FROM MERGE_PDF_PAGE P
       JOIN MERGE_PDF_DOCUMENT D ON D.DOCUMENT_ID = P.DOCUMENT_ID
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = P.JOB_ID
       WHERE P.JOB_ID = ? AND P.PAGE_ID = ? AND P.INUSE = 1 AND P.IS_CURRENT = 1 AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND J.INUSE = 1 AND J.IS_CURRENT = 1`,
      [jobId, pageId]
    )
    return rows[0]
  },

  getPageThumbnailSource: async (jobId: number, pageId: number): Promise<PageThumbnailRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PageThumbnailRow[]>(
      `SELECT P.DOCUMENT_ID, P.SOURCE_PAGE_NUMBER, P.ROTATION_DEGREES, D.PDF_PAGE_COUNT
       FROM MERGE_PDF_PAGE P
       JOIN MERGE_PDF_DOCUMENT D ON D.DOCUMENT_ID = P.DOCUMENT_ID
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = P.JOB_ID
       WHERE P.JOB_ID = ? AND P.PAGE_ID = ? AND P.INUSE = 1 AND P.IS_CURRENT = 1 AND D.INUSE = 1 AND D.IS_CURRENT = 1 AND J.INUSE = 1 AND J.IS_CURRENT = 1`,
      [jobId, pageId]
    )
    return rows[0]
  },

  getPublicationPdf: async (jobId: number, publicationId: number): Promise<BinaryRow | undefined> => {
    const rows = await MySQLExecute.queryParams<BinaryRow[]>(
      `SELECT P.OUTPUT_PDF_BYTES, P.OUTPUT_FILE_NAME FROM MERGE_PDF_PUBLICATION P
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = P.JOB_ID
       WHERE P.JOB_ID = ? AND P.PUBLICATION_ID = ? AND P.STATUS = 'PUBLISHED'
       AND P.INUSE = 1 AND P.IS_CURRENT = 1 AND J.INUSE = 1 AND J.IS_CURRENT = 1`,
      [jobId, publicationId]
    )
    return rows[0]
  },

  getPendingPublication: async (jobId: number): Promise<PendingRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PendingRow[]>(
      `SELECT PUBLICATION_ID, OUTPUT_FILE_NAME, OUTPUT_PDF_BYTES, NETWORK_PATH
       FROM MERGE_PDF_PUBLICATION WHERE JOB_ID = ? AND STATUS = 'PENDING' AND INUSE = 1 AND IS_CURRENT = 1
       ORDER BY PUBLICATION_VERSION DESC LIMIT 1`,
      [jobId]
    )
    return rows[0]
  },

  getLatestPublished: async (jobId: number, conn?: PoolConnection): Promise<PublishedRow | undefined> => {
    const sql = `SELECT PUBLICATION_ID, PUBLICATION_VERSION, STATUS, OUTPUT_FILE_NAME, NETWORK_PATH,
      PUBLISHED_AT, OUTPUT_PDF_BYTES, OUTPUT_SHA256 FROM MERGE_PDF_PUBLICATION
      WHERE JOB_ID = ? AND STATUS = 'PUBLISHED' AND INUSE = 1 AND IS_CURRENT = 1 ORDER BY PUBLICATION_VERSION DESC LIMIT 1`
    const rows = conn ? (await conn.query<PublishedRow[]>(sql, [jobId]))[0] : await MySQLExecute.queryParams<PublishedRow[]>(sql, [jobId])
    return rows[0]
  },

  assignImportCode: async (conn: PoolConnection, jobId: number, prefix: string): Promise<string> => {
    const employeeCode = getAuditEmployeeCode()
    // A duplicate leaves the first revision unchanged and takes an exclusive allocation lock.
    // INSERT IGNORE would take shared locks and deadlock concurrent allocations.
    await conn.query('INSERT INTO MERGE_PDF_FILE_SEQUENCE (PREFIX, NEXT_VALUE, CREATE_BY, UPDATE_BY) VALUES (?, 1, ?, ?) ON DUPLICATE KEY UPDATE PREFIX = PREFIX', [
      prefix,
      employeeCode,
      employeeCode,
    ])
    const [rows] = await conn.query<FileSequenceRow[]>('SELECT NEXT_VALUE, INUSE FROM MERGE_PDF_FILE_SEQUENCE WHERE PREFIX = ? ORDER BY REVISION_NO DESC LIMIT 1 FOR UPDATE', [
      prefix,
    ])
    if (rows[0].INUSE !== 1) throw new FileSequenceInactiveError(`Monthly file sequence ${prefix} is inactive. Contact your administrator.`)
    const code = `${prefix}${String(rows[0].NEXT_VALUE).padStart(2, '0')}`
    await replaceActiveRecords(conn, 'MERGE_PDF_FILE_SEQUENCE', 'PREFIX = ?', [prefix], { NEXT_VALUE: revisionSql('NEXT_VALUE + 1') }, employeeCode)
    await replaceActiveRecords(conn, 'MERGE_PDF_JOB', 'JOB_ID = ?', [jobId], { JOB_CODE: code, JOB_TITLE: code }, employeeCode)
    return code
  },

  insertJob: async (conn: PoolConnection, code: string, title: string, reference: string | null): Promise<number> => {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO MERGE_PDF_JOB (JOB_CODE, JOB_TITLE, JOB_REFERENCE, CREATE_BY, UPDATE_BY)
       VALUES (?, ?, ?, ?, ?)`,
      [code, title, reference, getAuditEmployeeCode(), getAuditEmployeeCode()]
    )
    return result.insertId
  },

  updateJob: async (conn: PoolConnection, jobId: number, title: string, reference: string | null): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      'JOB_ID = ?',
      [jobId],
      { JOB_TITLE: title, JOB_REFERENCE: reference, ROW_VERSION: revisionSql('ROW_VERSION + 1') },
      getAuditEmployeeCode()
    )
  },

  bumpJob: async (conn: PoolConnection, jobId: number): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      'JOB_ID = ?',
      [jobId],
      { STATUS: revisionSql("CASE WHEN LAST_COMPLETED_AT IS NOT NULL THEN 'COMPLETED' ELSE STATUS END"), ROW_VERSION: revisionSql('ROW_VERSION + 1') },
      getAuditEmployeeCode()
    )
  },

  softDeleteDraft: async (conn: PoolConnection, jobId: number): Promise<void> => MergePdfRepository.softDeleteJob(conn, jobId, true),

  softDeleteJob: async (conn: PoolConnection, jobId: number, draftOnly = false): Promise<void> => {
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE MERGE_PDF_JOB SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ?
       WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1 AND STATUS <> 'COMPLETING' AND (? = 0 OR STATUS = 'DRAFT')`,
      [getAuditEmployeeCode(), jobId, draftOnly ? 1 : 0]
    )
    if (result.affectedRows !== 1) throw new Error('Active document not found')
    await conn.query<ResultSetHeader>('UPDATE MERGE_PDF_PAGE SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [
      getAuditEmployeeCode(),
      jobId,
    ])
    await conn.query<ResultSetHeader>('UPDATE MERGE_PDF_DOCUMENT SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [
      getAuditEmployeeCode(),
      jobId,
    ])
    await conn.query<ResultSetHeader>('UPDATE MERGE_PDF_PUBLICATION SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [
      getAuditEmployeeCode(),
      jobId,
    ])
  },

  insertDocument: async (
    conn: PoolConnection,
    input: {
      jobId: number
      categoryId: number
      uploadOrder: number
      fileName: string
      sourceType: string
      sourceMime: string
      original: Buffer
      normalized: Buffer
      originalHash: Buffer
      normalizedHash: Buffer
      pageCount: number
      entryStatusCode: string | null
    }
  ): Promise<number> => {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO MERGE_PDF_DOCUMENT (
        JOB_ID, CATEGORY_ID, UPLOAD_ORDER, ORIGINAL_FILE_NAME, SOURCE_TYPE, SOURCE_MIME,
        ORIGINAL_SIZE_BYTES, ORIGINAL_SHA256, ORIGINAL_BYTES, NORMALIZED_PDF_SIZE_BYTES,
        NORMALIZED_PDF_SHA256, NORMALIZED_PDF_BYTES, PDF_PAGE_COUNT,
        ENTRY_STATUS_CODE, ENTRY_STATUS_SOURCE, CREATE_BY, UPDATE_BY
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, X'', ?, ?, X'', ?, ?, ?, ?, ?)`,
      [
        input.jobId,
        input.categoryId,
        input.uploadOrder,
        input.fileName,
        input.sourceType,
        input.sourceMime,
        input.original.length,
        input.originalHash,
        input.normalized.length,
        input.normalizedHash,
        input.pageCount,
        input.entryStatusCode,
        input.entryStatusCode ? 'USER' : null,
        getAuditEmployeeCode(),
        getAuditEmployeeCode(),
      ]
    )
    // mysql2's prepared binary serializer fails on larger PDF Buffers. Each BASE64
    // update stays below the development server's 64 MiB packet limit.
    await conn.query<ResultSetHeader>('UPDATE MERGE_PDF_DOCUMENT SET ORIGINAL_BYTES = FROM_BASE64(?) WHERE DOCUMENT_ID = ? AND REVISION_NO = 1 AND INUSE = 1 AND IS_CURRENT = 1', [
      input.original.toString('base64'),
      result.insertId,
    ])
    await conn.query<ResultSetHeader>(
      'UPDATE MERGE_PDF_DOCUMENT SET NORMALIZED_PDF_BYTES = FROM_BASE64(?) WHERE DOCUMENT_ID = ? AND REVISION_NO = 1 AND INUSE = 1 AND IS_CURRENT = 1',
      [input.normalized.toString('base64'), result.insertId]
    )
    return result.insertId
  },

  nextUploadOrder: async (conn: PoolConnection, jobId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>('SELECT COALESCE(MAX(UPLOAD_ORDER), 0) + 1 AS NEXT_VALUE FROM MERGE_PDF_DOCUMENT WHERE JOB_ID = ?', [jobId])
    return rows[0].NEXT_VALUE
  },

  nextPageOrder: async (conn: PoolConnection, jobId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>('SELECT COALESCE(MAX(SORT_ORDER), 0) + 1 AS NEXT_VALUE FROM MERGE_PDF_PAGE WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [
      jobId,
    ])
    return rows[0].NEXT_VALUE
  },

  insertPages: async (
    conn: PoolConnection,
    jobId: number,
    documentId: number,
    count: number,
    firstOrder: number,
    classifications?: readonly PageClassification[]
  ): Promise<void> => {
    if (classifications && classifications.length !== count) throw new Error('Page classification count mismatch')
    for (let index = 0; index < count; index += 1) {
      const classification = classifications?.[index]
      await conn.query<ResultSetHeader>(
        `INSERT INTO MERGE_PDF_PAGE
         (JOB_ID, DOCUMENT_ID, CATEGORY_ID, CLASSIFICATION_SOURCE, CLASSIFICATION_CONFIDENCE,
          SOURCE_PAGE_NUMBER, SORT_ORDER, CREATE_BY, UPDATE_BY)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          jobId,
          documentId,
          classification?.categoryId ?? null,
          classification?.source ?? null,
          classification?.confidence ?? null,
          index + 1,
          firstOrder + index,
          getAuditEmployeeCode(),
          getAuditEmployeeCode(),
        ]
      )
    }
  },

  updatePageCategory: async (conn: PoolConnection, jobId: number, pageId: number, categoryId: number): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      'JOB_ID = ? AND PAGE_ID = ?',
      [jobId, pageId],
      { CATEGORY_ID: categoryId, CLASSIFICATION_SOURCE: 'USER', CLASSIFICATION_CONFIDENCE: null },
      getAuditEmployeeCode()
    )
  },

  updatePageDetails: async (
    conn: PoolConnection,
    jobId: number,
    pageId: number,
    changes: { CATEGORY_ID: number; CLASSIFICATION_SOURCE: string | null; CLASSIFICATION_CONFIDENCE: number | null; ROTATION_DEGREES: number }
  ): Promise<void> => {
    await replaceActiveRecords(conn, 'MERGE_PDF_PAGE', 'JOB_ID = ? AND PAGE_ID = ?', [jobId, pageId], changes, getAuditEmployeeCode())
  },

  rotatePage: async (conn: PoolConnection, jobId: number, pageId: number, delta: 90 | 270): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      'JOB_ID = ? AND PAGE_ID = ?',
      [jobId, pageId],
      { ROTATION_DEGREES: revisionSql('MOD(ROTATION_DEGREES + ?, 360)', delta) },
      getAuditEmployeeCode()
    )
  },

  softDeletePage: async (conn: PoolConnection, jobId: number, pageId: number): Promise<number | undefined> => {
    const [rows] = await conn.query<(RowDataPacket & { DOCUMENT_ID: number })[]>(
      'SELECT DOCUMENT_ID FROM MERGE_PDF_PAGE WHERE JOB_ID = ? AND PAGE_ID = ? AND INUSE = 1 AND IS_CURRENT = 1 FOR UPDATE',
      [jobId, pageId]
    )
    if (!rows[0]) return undefined
    await conn.query<ResultSetHeader>('UPDATE MERGE_PDF_PAGE SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND PAGE_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [
      getAuditEmployeeCode(),
      jobId,
      pageId,
    ])
    return rows[0].DOCUMENT_ID
  },

  countActiveDocumentPages: async (conn: PoolConnection, documentId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>('SELECT COUNT(*) AS NEXT_VALUE FROM MERGE_PDF_PAGE WHERE DOCUMENT_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [documentId])
    return rows[0].NEXT_VALUE
  },

  reorderPages: async (conn: PoolConnection, jobId: number, ids: readonly number[]): Promise<void> => {
    if (!ids.length) return
    const order = `CASE PAGE_ID ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END`
    const orderParams = ids.flatMap((id, index) => [id, index + 1])
    // Retire the whole reordered group before inserting, so swaps never require temporary positions.
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      `JOB_ID = ? AND PAGE_ID IN (${ids.map(() => '?').join(', ')})`,
      [jobId, ...ids],
      { SORT_ORDER: revisionSql(order, ...orderParams) },
      getAuditEmployeeCode()
    )
  },

  softDeleteDocument: async (conn: PoolConnection, jobId: number, documentId: number): Promise<number> => {
    const [result] = await conn.query<ResultSetHeader>(
      'UPDATE MERGE_PDF_DOCUMENT SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND DOCUMENT_ID = ? AND INUSE = 1 AND IS_CURRENT = 1',
      [getAuditEmployeeCode(), jobId, documentId]
    )
    if (result.affectedRows === 1) {
      await conn.query<ResultSetHeader>(
        'UPDATE MERGE_PDF_PAGE SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND DOCUMENT_ID = ? AND INUSE = 1 AND IS_CURRENT = 1',
        [getAuditEmployeeCode(), jobId, documentId]
      )
    }
    return result.affectedRows
  },

  updateEntryStatus: async (conn: PoolConnection, jobId: number, documentId: number, statusCode: string | null): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_DOCUMENT',
      `JOB_ID = ? AND DOCUMENT_ID = ?
      AND EXISTS (SELECT 1 FROM MERGE_PDF_PAGE P WHERE P.DOCUMENT_ID = MERGE_PDF_DOCUMENT.DOCUMENT_ID
        AND P.JOB_ID = ? AND P.INUSE = 1 AND P.IS_CURRENT = 1 AND COALESCE(P.CATEGORY_ID, MERGE_PDF_DOCUMENT.CATEGORY_ID) = 1)`,
      [jobId, documentId, jobId],
      { ENTRY_STATUS_CODE: statusCode, ENTRY_STATUS_SOURCE: statusCode ? 'USER' : null },
      getAuditEmployeeCode()
    )
  },

  clearEntryStatus: async (conn: PoolConnection, jobId: number, documentId: number): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_DOCUMENT',
      'JOB_ID = ? AND DOCUMENT_ID = ?',
      [jobId, documentId],
      { ENTRY_STATUS_CODE: null, ENTRY_STATUS_SOURCE: null },
      getAuditEmployeeCode()
    )
  },

  getAllPdfBytes: async (conn: PoolConnection, jobId: number): Promise<BlobRow[]> => {
    const [rows] = await conn.query<BlobRow[]>('SELECT DOCUMENT_ID, NORMALIZED_PDF_BYTES FROM MERGE_PDF_DOCUMENT WHERE JOB_ID = ? AND INUSE = 1 AND IS_CURRENT = 1', [jobId])
    return rows
  },

  nextPublicationVersion: async (conn: PoolConnection, jobId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>(
      `SELECT COALESCE(MAX(PUBLICATION_VERSION), 0) + 1 AS NEXT_VALUE
       FROM MERGE_PDF_PUBLICATION WHERE JOB_ID = ?`,
      [jobId]
    )
    return rows[0].NEXT_VALUE
  },

  insertPublication: async (
    conn: PoolConnection,
    jobId: number,
    version: number,
    fileName: string,
    bytes: Buffer,
    hash: Buffer,
    pageCount: number,
    targetPath: string | null = null
  ): Promise<number> => {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO MERGE_PDF_PUBLICATION
       (JOB_ID, PUBLICATION_VERSION, OUTPUT_FILE_NAME, OUTPUT_SIZE_BYTES, OUTPUT_SHA256,
        OUTPUT_PDF_BYTES, OUTPUT_PAGE_COUNT, NETWORK_PATH, CREATE_BY, UPDATE_BY)
       VALUES (?, ?, ?, ?, ?, X'', ?, ?, ?, ?)`,
      [jobId, version, fileName, bytes.length, hash, pageCount, targetPath, getAuditEmployeeCode(), getAuditEmployeeCode()]
    )
    await conn.query<ResultSetHeader>(
      'UPDATE MERGE_PDF_PUBLICATION SET OUTPUT_PDF_BYTES = FROM_BASE64(?) WHERE PUBLICATION_ID = ? AND REVISION_NO = 1 AND INUSE = 1 AND IS_CURRENT = 1',
      [bytes.toString('base64'), result.insertId]
    )
    await replaceActiveRecords(conn, 'MERGE_PDF_JOB', 'JOB_ID = ?', [jobId], { STATUS: 'COMPLETING' }, getAuditEmployeeCode())
    return result.insertId
  },

  finishPublication: async (conn: PoolConnection, jobId: number, publicationId: number, networkPath: string | null): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_PUBLICATION',
      'JOB_ID = ? AND PUBLICATION_ID = ?',
      [jobId, publicationId],
      {
        STATUS: networkPath ? 'PUBLISHED' : 'FAILED',
        NETWORK_PATH: networkPath,
        PUBLISHED_AT: networkPath ? new Date() : null,
        FAILURE_CODE: networkPath ? null : 'NETWORK_WRITE_FAILED',
      },
      getAuditEmployeeCode()
    )
    if (networkPath) {
      await conn.query('UPDATE MERGE_PDF_PUBLICATION SET INUSE = 0, IS_CURRENT = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND PUBLICATION_ID <> ? AND INUSE = 1 AND IS_CURRENT = 1', [
        getAuditEmployeeCode(),
        jobId,
        publicationId,
      ])
    }
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      'JOB_ID = ?',
      [jobId],
      {
        STATUS: revisionSql("CASE WHEN ? IS NOT NULL OR LAST_COMPLETED_AT IS NOT NULL THEN 'COMPLETED' ELSE 'DRAFT' END", networkPath),
        ROW_VERSION: revisionSql('ROW_VERSION + 1'),
        LAST_COMPLETED_AT: revisionSql('CASE WHEN ? IS NULL THEN LAST_COMPLETED_AT ELSE CURRENT_TIMESTAMP(3) END', networkPath),
      },
      getAuditEmployeeCode()
    )
  },
}

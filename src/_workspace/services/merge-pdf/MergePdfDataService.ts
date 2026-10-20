import { revisionSql } from '@src/_workspace/sql/merge-pdf/RecordRevisionSQL'
import { MergePdfSQL } from '@src/_workspace/sql/merge-pdf/MergePdfSQL'
import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { FileSequenceInactiveError } from '@src/_workspace/services/merge-pdf/ImportFileName'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

import { MySQLExecute } from '@src/businessData/dbExecute'
import { replaceActiveRecords } from '@src/_workspace/services/merge-pdf/RecordRevisionService'
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

export const MergePdfDataService = {
  getNextImportNumber: async (prefix: string) => {
    const [row] = await MySQLExecute.queryParams<FileSequenceRow[]>(MergePdfSQL.getNextImportNumber(), [prefix])
    return row
  },
  getDocumentStatuses: async (jobIds: readonly number[]): Promise<Map<number, DocumentStatusSummary>> => {
    const summaries = new Map<number, DocumentStatusSummary>()
    if (!jobIds.length) return summaries
    const rows = await MySQLExecute.queryParams<DocumentStatusRow[]>(MergePdfSQL.getDocumentStatuses(jobIds), jobIds)
    for (const row of rows) {
      const summary: DocumentStatusSummary = summaries.get(row.JOB_ID) ?? { DOCUMENT_PAGE_COUNTS: {}, UNCLASSIFIED_PAGE_COUNT: 0 }
      if (Number(row.PAGE_COUNT) > 0) summary.DOCUMENT_PAGE_COUNTS[row.CATEGORY_ID] = Number(row.PAGE_COUNT)
      summary.UNCLASSIFIED_PAGE_COUNT += Number(row.UNCLASSIFIED_PAGE_COUNT)
      summaries.set(row.JOB_ID, summary)
    }
    return summaries
  },

  getRequiredCategoryIds: async (conn: PoolConnection): Promise<number[]> => {
    const [rows] = await conn.query<CategoryIdRow[]>(MergePdfSQL.getRequiredCategoryIds())
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
    const params = [search, `%${search}%`, `%${search}%`, status, status, titleFilter, `%${titleFilter}%`, updateByFilter, `%${updateByFilter}%`]
    const [rows, counts] = await Promise.all([
      MySQLExecute.queryParams<JobRow[]>(MergePdfSQL.listJobs(sortBy, sortDesc), [...params, pageSize, (page - 1) * pageSize]),
      MySQLExecute.queryParams<TotalRow[]>(MergePdfSQL.countJobs(), params),
    ])
    return { rows, total: counts[0].TOTAL }
  },

  getJob: async (jobId: number, conn?: PoolConnection): Promise<JobRow | undefined> => {
    const sql = MergePdfSQL.getJob()
    const rows = conn ? (await conn.query<JobRow[]>(sql, [jobId]))[0] : await MySQLExecute.queryParams<JobRow[]>(sql, [jobId])
    return rows[0]
  },

  lockJob: async (conn: PoolConnection, jobId: number): Promise<JobRow | undefined> => {
    const [rows] = await conn.query<JobRow[]>(MergePdfSQL.lockJob(), [jobId])
    return rows[0]
  },

  getDocuments: async (jobId: number, conn?: PoolConnection): Promise<DocumentRow[]> => {
    const sql = MergePdfSQL.getDocuments()
    return conn ? (await conn.query<DocumentRow[]>(sql, [jobId]))[0] : MySQLExecute.queryParams<DocumentRow[]>(sql, [jobId])
  },

  getPages: async (jobId: number, conn?: PoolConnection): Promise<PageRow[]> => {
    const sql = MergePdfSQL.getPages()
    return conn ? (await conn.query<PageRow[]>(sql, [jobId]))[0] : MySQLExecute.queryParams<PageRow[]>(sql, [jobId])
  },

  getPublications: (jobId: number): Promise<PublicationRow[]> => MySQLExecute.queryParams<PublicationRow[]>(MergePdfSQL.getPublications(), [jobId]),

  getDocumentPdf: async (documentId: number): Promise<Buffer | undefined> => {
    const rows = await MySQLExecute.queryParams<BlobRow[]>(MergePdfSQL.getDocumentPdf(), [documentId])
    return rows[0]?.NORMALIZED_PDF_BYTES
  },

  getOriginalDocument: async (jobId: number, documentId: number) => {
    const [row] = await MySQLExecute.queryParams<(RowDataPacket & { ORIGINAL_FILE_NAME: string; SOURCE_MIME: string; ORIGINAL_BYTES: Buffer })[]>(
      MergePdfSQL.getOriginalDocument(),
      [jobId, documentId]
    )
    return row
  },

  getDeletionPublications: async (conn: PoolConnection, jobId: number) => {
    const [rows] = await conn.query<PublishedRow[]>(MergePdfSQL.getDeletionPublications(), [jobId])
    return rows
  },

  getPagePdfSource: async (jobId: number, pageId: number): Promise<PageSourceRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PageSourceRow[]>(MergePdfSQL.getPagePdfSource(), [jobId, pageId])
    return rows[0]
  },

  getPageThumbnailSource: async (jobId: number, pageId: number): Promise<PageThumbnailRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PageThumbnailRow[]>(MergePdfSQL.getPageThumbnailSource(), [jobId, pageId])
    return rows[0]
  },

  getPublicationPdf: async (jobId: number, publicationId: number): Promise<BinaryRow | undefined> => {
    const rows = await MySQLExecute.queryParams<BinaryRow[]>(MergePdfSQL.getPublicationPdf(), [jobId, publicationId])
    return rows[0]
  },

  getPendingPublication: async (jobId: number): Promise<PendingRow | undefined> => {
    const rows = await MySQLExecute.queryParams<PendingRow[]>(MergePdfSQL.getPendingPublication(), [jobId])
    return rows[0]
  },

  getLatestPublished: async (jobId: number, conn?: PoolConnection): Promise<PublishedRow | undefined> => {
    const sql = MergePdfSQL.getLatestPublished()
    const rows = conn ? (await conn.query<PublishedRow[]>(sql, [jobId]))[0] : await MySQLExecute.queryParams<PublishedRow[]>(sql, [jobId])
    return rows[0]
  },

  assignImportCode: async (conn: PoolConnection, jobId: number, prefix: string): Promise<string> => {
    const employeeCode = getAuditEmployeeCode()
    // A duplicate leaves the first revision unchanged and takes an exclusive allocation lock.
    // INSERT IGNORE would take shared locks and deadlock concurrent allocations.
    await conn.query(MergePdfSQL.ensureFileSequence(), [prefix, employeeCode, employeeCode])
    const [rows] = await conn.query<FileSequenceRow[]>(MergePdfSQL.lockFileSequence(), [prefix])
    if (rows[0].INUSE !== 1) throw new FileSequenceInactiveError(`Monthly file sequence ${prefix} is inactive. Contact your administrator.`)
    const code = `${prefix}${String(rows[0].NEXT_VALUE).padStart(2, '0')}`
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_FILE_SEQUENCE',
      MergePdfSQL.whereFileSequence(),
      [prefix],
      { NEXT_VALUE: revisionSql(MergePdfSQL.incrementSequence()) },
      employeeCode
    )
    await replaceActiveRecords(conn, 'MERGE_PDF_JOB', MergePdfSQL.whereJob(), [jobId], { JOB_CODE: code, JOB_TITLE: code }, employeeCode)
    return code
  },

  insertJob: async (conn: PoolConnection, code: string, title: string, reference: string | null): Promise<number> => {
    const [result] = await conn.query<ResultSetHeader>(MergePdfSQL.insertJob(), [code, title, reference, getAuditEmployeeCode(), getAuditEmployeeCode()])
    return result.insertId
  },

  updateJob: async (conn: PoolConnection, jobId: number, title: string, reference: string | null): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      MergePdfSQL.whereJob(),
      [jobId],
      { JOB_TITLE: title, JOB_REFERENCE: reference, ROW_VERSION: revisionSql(MergePdfSQL.incrementRowVersion()) },
      getAuditEmployeeCode()
    )
  },

  bumpJob: async (conn: PoolConnection, jobId: number): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      MergePdfSQL.whereJob(),
      [jobId],
      { STATUS: revisionSql(MergePdfSQL.savedJobStatus()), ROW_VERSION: revisionSql(MergePdfSQL.incrementRowVersion()) },
      getAuditEmployeeCode()
    )
  },

  softDeleteDraft: async (conn: PoolConnection, jobId: number): Promise<void> => MergePdfDataService.softDeleteJob(conn, jobId, true),

  softDeleteJob: async (conn: PoolConnection, jobId: number, draftOnly = false): Promise<void> => {
    const [result] = await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteJob(), [getAuditEmployeeCode(), jobId, draftOnly ? 1 : 0])
    if (result.affectedRows !== 1) throw new Error('Active document not found')
    await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteJobPages(), [getAuditEmployeeCode(), jobId])
    await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteJobDocuments(), [getAuditEmployeeCode(), jobId])
    await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteJobPublications(), [getAuditEmployeeCode(), jobId])
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
      entryStatusSource?: 'USER' | 'DOCUMENT' | null
      description?: string | null
    }
  ): Promise<number> => {
    const [result] = await conn.execute<ResultSetHeader>(MergePdfSQL.insertDocument(), [
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
      input.entryStatusCode ? (input.entryStatusSource ?? 'USER') : null,
      input.categoryId === 10 ? (input.description ?? null) : null,
      getAuditEmployeeCode(),
      getAuditEmployeeCode(),
    ])
    // mysql2's prepared binary serializer fails on larger PDF Buffers. Each BASE64
    // update stays below the development server's 64 MiB packet limit.
    await conn.query<ResultSetHeader>(MergePdfSQL.writeOriginalDocumentBytes(), [input.original.toString('base64'), result.insertId])
    await conn.query<ResultSetHeader>(MergePdfSQL.writeNormalizedDocumentBytes(), [input.normalized.toString('base64'), result.insertId])
    return result.insertId
  },

  nextUploadOrder: async (conn: PoolConnection, jobId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>(MergePdfSQL.nextUploadOrder(), [jobId])
    return rows[0].NEXT_VALUE
  },

  nextPageOrder: async (conn: PoolConnection, jobId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>(MergePdfSQL.nextPageOrder(), [jobId])
    return rows[0].NEXT_VALUE
  },

  insertPages: async (
    conn: PoolConnection,
    jobId: number,
    documentId: number,
    count: number,
    firstOrder: number,
    classifications?: readonly PageClassification[],
    description: string | null = null,
    categoryId = 10
  ): Promise<void> => {
    if (classifications && classifications.length !== count) throw new Error('Page classification count mismatch')
    for (let index = 0; index < count; index += 1) {
      const classification = classifications?.[index]
      await conn.query<ResultSetHeader>(MergePdfSQL.insertPages(), [
        jobId,
        documentId,
        classification?.categoryId ?? null,
        classification?.source ?? null,
        classification?.confidence ?? null,
        index + 1,
        firstOrder + index,
        (classification?.categoryId ?? categoryId) === 10 ? description : null,
        getAuditEmployeeCode(),
        getAuditEmployeeCode(),
      ])
    }
  },

  updatePageCategory: async (conn: PoolConnection, jobId: number, pageId: number, categoryId: number): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      MergePdfSQL.whereJobPage(),
      [jobId, pageId],
      { CATEGORY_ID: categoryId, CLASSIFICATION_SOURCE: 'USER', CLASSIFICATION_CONFIDENCE: null, ...(categoryId === 10 ? {} : { DESCRIPTION: null }) },
      getAuditEmployeeCode()
    )
  },

  updatePageDetails: async (
    conn: PoolConnection,
    jobId: number,
    pageId: number,
    changes: { CATEGORY_ID: number; CLASSIFICATION_SOURCE: string | null; CLASSIFICATION_CONFIDENCE: number | null; ROTATION_DEGREES: number; DESCRIPTION: string | null }
  ): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      MergePdfSQL.whereJobPage(),
      [jobId, pageId],
      { ...changes, DESCRIPTION: changes.CATEGORY_ID === 10 ? changes.DESCRIPTION : null },
      getAuditEmployeeCode()
    )
  },

  updateDocumentMetadata: async (
    conn: PoolConnection,
    jobId: number,
    documentId: number,
    changes: { DESCRIPTION: string | null; ENTRY_STATUS_CODE: string | null; ENTRY_STATUS_SOURCE: string | null }
  ): Promise<void> => {
    await replaceActiveRecords(conn, 'MERGE_PDF_DOCUMENT', MergePdfSQL.whereJobDocument(), [jobId, documentId], changes, getAuditEmployeeCode())
  },

  rotatePage: async (conn: PoolConnection, jobId: number, pageId: number, delta: 90 | 270): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_PAGE',
      MergePdfSQL.whereJobPage(),
      [jobId, pageId],
      { ROTATION_DEGREES: revisionSql(MergePdfSQL.rotatePage(), delta) },
      getAuditEmployeeCode()
    )
  },

  softDeletePage: async (conn: PoolConnection, jobId: number, pageId: number): Promise<number | undefined> => {
    const [rows] = await conn.query<(RowDataPacket & { DOCUMENT_ID: number })[]>(MergePdfSQL.lockPageDocument(), [jobId, pageId])
    if (!rows[0]) return undefined
    await conn.query<ResultSetHeader>(MergePdfSQL.softDeletePage(), [getAuditEmployeeCode(), jobId, pageId])
    return rows[0].DOCUMENT_ID
  },

  countActiveDocumentPages: async (conn: PoolConnection, documentId: number): Promise<number> => {
    const [rows] = await conn.query<CountRow[]>(MergePdfSQL.countActiveDocumentPages(), [documentId])
    return rows[0].NEXT_VALUE
  },

  reorderPages: async (conn: PoolConnection, jobId: number, ids: readonly number[]): Promise<void> => {
    if (!ids.length) return
    const order = MergePdfSQL.pageSortOrder(ids)
    const orderParams = ids.flatMap((id, index) => [id, index + 1])
    // Retire the whole reordered group before inserting, so swaps never require temporary positions.
    await replaceActiveRecords(conn, 'MERGE_PDF_PAGE', MergePdfSQL.whereJobPages(ids), [jobId, ...ids], { SORT_ORDER: revisionSql(order, ...orderParams) }, getAuditEmployeeCode())
  },

  softDeleteDocument: async (conn: PoolConnection, jobId: number, documentId: number): Promise<number> => {
    const [result] = await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteDocument(), [getAuditEmployeeCode(), jobId, documentId])
    if (result.affectedRows === 1) {
      await conn.query<ResultSetHeader>(MergePdfSQL.softDeleteDocumentPages(), [getAuditEmployeeCode(), jobId, documentId])
    }
    return result.affectedRows
  },

  updateEntryStatus: async (conn: PoolConnection, jobId: number, documentId: number, statusCode: string | null): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_DOCUMENT',
      MergePdfSQL.whereImportEntryDocument(),
      [jobId, documentId, jobId],
      { ENTRY_STATUS_CODE: statusCode, ENTRY_STATUS_SOURCE: statusCode ? 'USER' : null },
      getAuditEmployeeCode()
    )
  },

  clearEntryStatus: async (conn: PoolConnection, jobId: number, documentId: number): Promise<number> => {
    return replaceActiveRecords(
      conn,
      'MERGE_PDF_DOCUMENT',
      MergePdfSQL.whereJobDocument(),
      [jobId, documentId],
      { ENTRY_STATUS_CODE: null, ENTRY_STATUS_SOURCE: null },
      getAuditEmployeeCode()
    )
  },

  getAllPdfBytes: async (conn: PoolConnection, jobId: number): Promise<BlobRow[]> => {
    const [rows] = await conn.query<BlobRow[]>(MergePdfSQL.getAllPdfBytes(), [jobId])
    return rows
  },

  allocateNextPublicationVersion: async (conn: PoolConnection, jobId: number): Promise<number> => {
    await conn.query<ResultSetHeader>(MergePdfSQL.retireFailedPublications(), [getAuditEmployeeCode(), jobId])
    const [rows] = await conn.query<CountRow[]>(MergePdfSQL.nextPublicationVersion(), [jobId])
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
    const [result] = await conn.execute<ResultSetHeader>(MergePdfSQL.insertPublication(), [
      jobId,
      version,
      fileName,
      bytes.length,
      hash,
      pageCount,
      targetPath,
      getAuditEmployeeCode(),
      getAuditEmployeeCode(),
    ])
    await conn.query<ResultSetHeader>(MergePdfSQL.writePublicationBytes(), [bytes.toString('base64'), result.insertId])
    await replaceActiveRecords(conn, 'MERGE_PDF_JOB', MergePdfSQL.whereJob(), [jobId], { STATUS: 'COMPLETING' }, getAuditEmployeeCode())
    return result.insertId
  },

  finishPublication: async (conn: PoolConnection, jobId: number, publicationId: number, networkPath: string | null): Promise<void> => {
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_PUBLICATION',
      MergePdfSQL.whereJobPublication(),
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
      await conn.query(MergePdfSQL.retireOtherPublications(), [getAuditEmployeeCode(), jobId, publicationId])
    }
    await replaceActiveRecords(
      conn,
      'MERGE_PDF_JOB',
      MergePdfSQL.whereJob(),
      [jobId],
      {
        STATUS: revisionSql(MergePdfSQL.completedJobStatus(), networkPath),
        ROW_VERSION: revisionSql(MergePdfSQL.incrementRowVersion()),
        LAST_COMPLETED_AT: revisionSql(MergePdfSQL.completionTimestamp(), networkPath),
      },
      getAuditEmployeeCode()
    )
  },
}

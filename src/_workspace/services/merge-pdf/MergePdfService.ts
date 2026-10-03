import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { MySQLExecute } from '@src/businessData/dbExecute'
import { MergePdfRepository as repo } from '@src/_workspace/sql/merge-pdf/MergePdfRepository'
import type { JobDetail, JobSummary, PageClassification } from '@src/_workspace/types/merge-pdf/MergePdf'

import { extractPage, mergePages, normalizeFile, type NormalizedFile } from './PdfEngine'

const getDevelopmentShare = (): string => process.env.MERGE_PDF_DEVELOPMENT_SHARE || '\\\\192.168.14.35\\C12\\_PM-Support\\MergePDF\\_TEST'

export class MergePdfError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

const assertEditable = (job: JobSummary | undefined, expectedVersion: number): JobSummary => {
  if (!job) throw new MergePdfError('Job not found', 404)
  if (job.ROW_VERSION !== expectedVersion) throw new MergePdfError('Job changed. Reload and try again', 409)
  if (job.STATUS === 'COMPLETING') throw new MergePdfError('Job is being completed', 409)
  return job
}

const sha256 = (bytes: Buffer): Buffer => createHash('sha256').update(bytes).digest()

const detail = async (jobId: number): Promise<JobDetail> => {
  const job = await repo.getJob(jobId)
  if (!job) throw new MergePdfError('Job not found', 404)
  const [documents, pages, publications] = await Promise.all([repo.getDocuments(jobId), repo.getPages(jobId), repo.getPublications(jobId)])
  return { job, documents, pages, publications }
}

const persistDocument = async (
  jobId: number,
  expectedVersion: number,
  categoryId: number,
  entryStatusCode: string | null,
  fileName: string,
  bytes: Buffer,
  normalized: NormalizedFile,
  classifications?: readonly PageClassification[]
): Promise<JobDetail> => {
  await MySQLExecute.withTransaction(async (conn) => {
    assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
    const uploadOrder = await repo.nextUploadOrder(conn, jobId)
    const firstOrder = await repo.nextPageOrder(conn, jobId)
    const documentId = await repo.insertDocument(conn, {
      jobId,
      categoryId,
      uploadOrder,
      fileName,
      sourceType: normalized.sourceType,
      sourceMime: normalized.sourceMime,
      original: bytes,
      normalized: normalized.pdfBytes,
      originalHash: sha256(bytes),
      normalizedHash: sha256(normalized.pdfBytes),
      pageCount: normalized.pageCount,
      entryStatusCode,
    })
    await repo.insertPages(conn, jobId, documentId, normalized.pageCount, firstOrder, classifications)
    const pages = await repo.getPages(jobId, conn)
    const added = pages.filter((page) => page.DOCUMENT_ID === documentId)
    const ordered = pages.filter((page) => page.DOCUMENT_ID !== documentId)
    for (const page of added) {
      const insertAfter = ordered.findLastIndex((existing) => existing.CATEGORY_ID <= page.CATEGORY_ID)
      ordered.splice(insertAfter + 1, 0, page)
    }
    await repo.reorderPages(
      conn,
      jobId,
      ordered.map((page) => page.PAGE_ID)
    )
    await repo.bumpJob(conn, jobId)
  })
  return detail(jobId)
}

export const MergePdfService = {
  list: (
    search: string,
    status: 'ALL' | 'DRAFT' | 'COMPLETED',
    page: number,
    pageSize: number,
    titleFilter: string,
    updateByFilter: string,
    sortBy: 'JOB_TITLE' | 'STATUS' | 'DOCUMENT_COUNT' | 'PAGE_COUNT' | 'UPDATE_DATE' | 'UPDATE_BY',
    sortDesc: boolean
  ) => repo.listJobs(search, status, page, pageSize, titleFilter, updateByFilter, sortBy, sortDesc),
  detail,

  create: async (title: string, reference: string | null): Promise<JobDetail> => {
    const jobId = await MySQLExecute.withTransaction((conn) => repo.insertJob(conn, randomUUID(), title, reference))
    return detail(jobId)
  },

  saveDraft: async (jobId: number, expectedVersion: number, title: string, reference: string | null): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      await repo.updateJob(conn, jobId, title, reference)
    })
    return detail(jobId)
  },

  addDocument: async (jobId: number, expectedVersion: number, categoryId: number, entryStatusCode: string | null, fileName: string, bytes: Buffer): Promise<JobDetail> => {
    if (categoryId !== 1 && entryStatusCode) throw new MergePdfError('Status applies only to import entry', 400)
    if (fileName.length < 1 || fileName.length > 255) throw new MergePdfError('File name is too long', 400)
    let normalized: Awaited<ReturnType<typeof normalizeFile>>
    try {
      normalized = await normalizeFile(fileName, bytes)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid document'
      throw new MergePdfError(message, message.startsWith('Excel conversion is unavailable') ? 503 : 400)
    }
    return persistDocument(jobId, expectedVersion, categoryId, entryStatusCode, fileName, bytes, normalized)
  },

  addCombinedDocument: async (jobId: number, expectedVersion: number, fileName: string, bytes: Buffer): Promise<JobDetail> => {
    if (fileName.length < 1 || fileName.length > 255) throw new MergePdfError('File name is too long', 400)
    if (path.extname(fileName).toLowerCase() !== '.pdf') throw new MergePdfError('Combined file must be a PDF', 400)
    assertEditable(await repo.getJob(jobId), expectedVersion)
    let normalized: NormalizedFile
    try {
      normalized = await normalizeFile(fileName, bytes)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid document'
      throw new MergePdfError(message, message.startsWith('Excel conversion is unavailable') ? 503 : 400)
    }
    const classifications: PageClassification[] = Array.from({ length: normalized.pageCount }, () => ({
      categoryId: 10,
      source: 'UNKNOWN',
      confidence: null,
    }))
    return persistDocument(jobId, expectedVersion, 10, null, fileName, bytes, normalized, classifications)
  },

  updatePageCategory: async (jobId: number, pageId: number, expectedVersion: number, categoryId: number): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if ((await repo.updatePageCategory(conn, jobId, pageId, categoryId)) !== 1) {
        throw new MergePdfError('Page not found', 404)
      }
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  rotatePage: async (jobId: number, pageId: number, expectedVersion: number, delta: 90 | 270): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if ((await repo.rotatePage(conn, jobId, pageId, delta)) !== 1) throw new MergePdfError('Page not found', 404)
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  removePage: async (jobId: number, pageId: number, expectedVersion: number): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      const documentId = await repo.softDeletePage(conn, jobId, pageId)
      if (documentId === undefined) throw new MergePdfError('Page not found', 404)
      if ((await repo.countActiveDocumentPages(conn, documentId)) === 0) {
        await repo.softDeleteDocument(conn, jobId, documentId)
      }
      const remaining = await repo.getPages(jobId, conn)
      await repo.reorderPages(
        conn,
        jobId,
        remaining.map((page) => page.PAGE_ID)
      )
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  removeDocument: async (jobId: number, documentId: number, expectedVersion: number): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if ((await repo.softDeleteDocument(conn, jobId, documentId)) !== 1) {
        throw new MergePdfError('Document not found', 404)
      }
      const pages = await repo.getPages(jobId, conn)
      await repo.reorderPages(
        conn,
        jobId,
        pages.map((page) => page.PAGE_ID)
      )
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  updateEntryStatus: async (jobId: number, documentId: number, expectedVersion: number, statusCode: string | null): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if ((await repo.updateEntryStatus(conn, jobId, documentId, statusCode)) !== 1) {
        throw new MergePdfError('Import entry not found', 404)
      }
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  reorder: async (jobId: number, expectedVersion: number, pageIds: readonly number[]): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      const pages = await repo.getPages(jobId, conn)
      const existing = new Set(pages.map((page) => page.PAGE_ID))
      if (pageIds.length !== pages.length || new Set(pageIds).size !== pages.length || pageIds.some((id) => !existing.has(id))) {
        throw new MergePdfError('Page order must include every page exactly once', 400)
      }
      await repo.reorderPages(conn, jobId, pageIds)
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },

  complete: async (jobId: number, expectedVersion: number): Promise<JobDetail> => {
    const current = await repo.getJob(jobId)
    if (!current) throw new MergePdfError('Job not found', 404)
    if (current.ROW_VERSION !== expectedVersion) throw new MergePdfError('Job changed. Reload and try again', 409)
    const pending = current.STATUS === 'COMPLETING' ? await repo.getPendingPublication(jobId) : undefined
    if (current.STATUS === 'COMPLETING' && !pending) {
      throw new MergePdfError('Completion is being reconciled. Reload and try again', 409)
    }
    const publication = pending
      ? {
          publicationId: pending.PUBLICATION_ID,
          pdf: pending.OUTPUT_PDF_BYTES,
          fileName: pending.OUTPUT_FILE_NAME,
        }
      : await MySQLExecute.withTransaction(async (conn) => {
          const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
          const documents = await repo.getDocuments(jobId, conn)
          const pages = await repo.getPages(jobId, conn)
          const requiredCategoryIds = await repo.getRequiredCategoryIds(conn)
          const blobs = await repo.getAllPdfBytes(conn, jobId)
          const version = await repo.nextPublicationVersion(conn, jobId)
          if (requiredCategoryIds.some((categoryId) => !pages.some((page) => page.CATEGORY_ID === categoryId))) {
            throw new MergePdfError('Import entry, Invoice and HAWB or AWB are required', 400)
          }
          const importEntryDocumentIds = new Set(pages.filter((page) => page.CATEGORY_ID === 1).map((page) => page.DOCUMENT_ID))
          const entries = documents.filter((document) => importEntryDocumentIds.has(document.DOCUMENT_ID))
          if (entries.some((entry) => entry.ENTRY_STATUS_CODE !== '04')) {
            throw new MergePdfError('Every import entry must have status 04', 400)
          }
          if (pages.length === 0) throw new MergePdfError('Add at least one page', 400)
          const pdf = await mergePages(
            pages.map((page) => ({
              documentId: page.DOCUMENT_ID,
              sourcePageNumber: page.SOURCE_PAGE_NUMBER,
              rotationDegrees: page.ROTATION_DEGREES,
            })),
            new Map(blobs.map((blob) => [blob.DOCUMENT_ID, blob.NORMALIZED_PDF_BYTES]))
          )
          const fileName = `${job.JOB_CODE}-v${version}.pdf`
          const publicationId = await repo.insertPublication(conn, jobId, version, fileName, pdf, sha256(pdf), pages.length)
          return { publicationId, pdf, fileName }
        })

    const finalPath = path.win32.join(getDevelopmentShare(), publication.fileName)
    const tempPath = `${finalPath}.${randomUUID()}.tmp`
    let publishedPath: string | null = null
    try {
      await writeFile(tempPath, publication.pdf, { flag: 'wx' })
      await rename(tempPath, finalPath)
      publishedPath = finalPath
    } catch {
      await unlink(tempPath).catch(() => undefined)
      const existing = await readFile(finalPath).catch(() => null)
      if (existing && sha256(existing).equals(sha256(publication.pdf))) publishedPath = finalPath
    }
    await MySQLExecute.withTransaction((conn) => repo.finishPublication(conn, jobId, publication.publicationId, publishedPath))
    if (!publishedPath) throw new MergePdfError('Could not write merged PDF to the development share', 503)
    return detail(jobId)
  },

  documentPdf: (documentId: number): Promise<Buffer | undefined> => repo.getDocumentPdf(documentId),
  pagePdf: async (jobId: number, pageId: number): Promise<Buffer | undefined> => {
    const source = await repo.getPagePdfSource(jobId, pageId)
    return source ? extractPage(source.NORMALIZED_PDF_BYTES, source.SOURCE_PAGE_NUMBER, source.ROTATION_DEGREES) : undefined
  },
  publicationPdf: (jobId: number, publicationId: number): Promise<{ bytes: Buffer; fileName: string } | undefined> =>
    repo.getPublicationPdf(jobId, publicationId).then((row) =>
      row
        ? {
            bytes: row.OUTPUT_PDF_BYTES,
            fileName: row.OUTPUT_FILE_NAME,
          }
        : undefined
    ),
}

import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { readFile, unlink } from 'node:fs/promises'

import { MySQLExecute } from '@src/businessData/dbExecute'
import { MergePdfDataService as repo } from '@src/_workspace/services/merge-pdf/MergePdfDataService'
import type { BatchPageAction, JobDetail, JobSummary, PageClassification } from '@src/_workspace/types/merge-pdf/MergePdf'

import { extractPage, mergePages, normalizeFile, type NormalizedFile } from './PdfEngine'
import { checkOutputDirectory, getOutputDirectory, publishPdf } from './PublicationStorage'
import { FileSequenceInactiveError, getImportPrefix, isImportCode } from './ImportFileName'
import { summarizeDocumentPages } from './DocumentStatus'
import { removePublishedPdfs } from './PublicationDeletion'
import { classifyCombinedPdf } from './CombinedPdfClassification'
import { detectEntryStatus04 } from './EntryStatusDetection'
import { applyEditorChanges, type PreparedEditorChanges } from './EditorChanges'
import { EmailDigestService } from '@src/_workspace/services/email-settings/EmailDigestService'

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
  return { job: { ...job, ...summarizeDocumentPages(pages) }, documents, pages, publications }
}

const persistDocument = async (
  jobId: number,
  expectedVersion: number,
  categoryId: number,
  entryStatusCode: string | null,
  fileName: string,
  bytes: Buffer,
  normalized: NormalizedFile,
  classifications?: readonly PageClassification[],
  description: string | null = null
): Promise<JobDetail> => {
  const hasOther = classifications ? classifications.some((page) => page.categoryId === 10) : categoryId === 10
  if (hasOther && !description?.trim()) throw new MergePdfError('Description is required before importing Other documents', 400)
  const entryPages = Array.from({ length: normalized.pageCount }, (_, index) => index + 1).filter((number) => (classifications?.[number - 1].categoryId ?? categoryId) === 1)
  const autoConfirmed = !entryStatusCode && normalized.sourceType === 'PDF' && (await detectEntryStatus04(normalized.pdfBytes, entryPages))
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
      entryStatusCode: entryStatusCode ?? (autoConfirmed ? '04' : null),
      entryStatusSource: autoConfirmed ? 'DOCUMENT' : 'USER',
      description: categoryId === 10 && hasOther ? description : null,
    })
    await repo.insertPages(conn, jobId, documentId, normalized.pageCount, firstOrder, classifications, description, categoryId)
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
  completeEditor: async (jobId: number, expectedVersion: number, changes: PreparedEditorChanges): Promise<JobDetail> => {
    let written: { directory: string; fileName: string; original: Buffer | null } | undefined
    try {
      await MySQLExecute.withTransaction(async (conn) => {
        const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
        await applyEditorChanges(conn, jobId, changes)
        const pages = await repo.getPages(jobId, conn)
        const documents = await repo.getDocuments(jobId, conn)
        const required = await repo.getRequiredCategoryIds(conn)
        if (!pages.length || required.some((id) => !pages.some((page) => page.CATEGORY_ID === id)))
          throw new MergePdfError('Import entry, Invoice and HAWB or AWB are required', 400)
        const entryIds = new Set(pages.filter((page) => page.CATEGORY_ID === 1).map((page) => page.DOCUMENT_ID))
        if (documents.some((doc) => entryIds.has(doc.DOCUMENT_ID) && doc.ENTRY_STATUS_CODE !== '04')) throw new MergePdfError('Every import entry must have status 04', 400)
        const previous = await repo.getLatestPublished(jobId, conn)
        if (previous && !isImportCode(job.JOB_CODE)) throw new MergePdfError('This document uses a legacy filename. Contact your administrator.', 409)
        const code = isImportCode(job.JOB_CODE) ? job.JOB_CODE : await repo.assignImportCode(conn, jobId, getImportPrefix())
        const fileName = `${code}.pdf`
        const directory = previous?.NETWORK_PATH ? path.dirname(previous.NETWORK_PATH) : getOutputDirectory()
        await checkOutputDirectory(directory)
        const blobs = await repo.getAllPdfBytes(conn, jobId)
        const pdf = await mergePages(
          pages.map((page) => ({ documentId: page.DOCUMENT_ID, sourcePageNumber: page.SOURCE_PAGE_NUMBER, rotationDegrees: page.ROTATION_DEGREES })),
          new Map(blobs.map((blob) => [blob.DOCUMENT_ID, blob.NORMALIZED_PDF_BYTES]))
        )
        const original = await readFile(path.join(directory, fileName)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        const publicationVersion = await repo.allocateNextPublicationVersion(conn, jobId)
        const publicationId = await repo.insertPublication(conn, jobId, publicationVersion, fileName, pdf, sha256(pdf), pages.length, path.join(directory, fileName))
        const savedPath = await publishPdf(directory, fileName, pdf, !!previous)
        written = { directory, fileName, original }
        await repo.finishPublication(conn, jobId, publicationId, savedPath)
        await EmailDigestService.enqueuePublishedPublication(conn, jobId, publicationId)
      })
    } catch (error) {
      if (written) {
        if (written.original) await publishPdf(written.directory, written.fileName, written.original)
        else await unlink(path.join(written.directory, written.fileName))
      }
      if (error instanceof MergePdfError) throw error
      throw new MergePdfError(error instanceof Error ? error.message : 'Could not save changes', 503)
    }
    return detail(jobId)
  },
  saveEditorDraft: async (jobId: number, expectedVersion: number, changes: PreparedEditorChanges): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if (job.STATUS !== 'DRAFT' || job.LAST_COMPLETED_AT) throw new MergePdfError('Use Save Changes for completed documents', 409)
      await applyEditorChanges(conn, jobId, changes)
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },
  nextCode: async (): Promise<string> => {
    const prefix = getImportPrefix()
    const row = await repo.getNextImportNumber(prefix)
    if (row && row.INUSE !== 1) throw new MergePdfError('Monthly file numbering is inactive. Contact your administrator.', 409)
    return prefix + String(row?.NEXT_VALUE ?? 1).padStart(2, '0')
  },
  batchPages: async (jobId: number, expectedVersion: number, pageIds: number[], action: BatchPageAction): Promise<JobDetail> => {
    if (!pageIds.length || pageIds.length > 500 || new Set(pageIds).size !== pageIds.length) throw new MergePdfError('Select distinct pages', 400)
    await MySQLExecute.withTransaction(async (conn) => {
      assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      const pages = await repo.getPages(jobId, conn)
      if (pageIds.some((id) => !pages.some((page) => page.PAGE_ID === id))) throw new MergePdfError('Selected page not found. Reload and try again', 404)
      const documents = new Set<number>()
      for (const pageId of pageIds) {
        if (action.kind === 'category') await repo.updatePageCategory(conn, jobId, pageId, action.categoryId)
        else if (action.kind === 'rotate') await repo.rotatePage(conn, jobId, pageId, action.delta)
        else {
          const documentId = await repo.softDeletePage(conn, jobId, pageId)
          if (documentId !== undefined) documents.add(documentId)
        }
      }
      if (action.kind === 'remove') {
        for (const documentId of documents) if ((await repo.countActiveDocumentPages(conn, documentId)) === 0) await repo.softDeleteDocument(conn, jobId, documentId)
        await repo.reorderPages(
          conn,
          jobId,
          pages.filter((page) => !pageIds.includes(page.PAGE_ID)).map((page) => page.PAGE_ID)
        )
      }
      await repo.bumpJob(conn, jobId)
    })
    return detail(jobId)
  },
  list: async (
    search: string,
    status: 'ALL' | 'DRAFT' | 'COMPLETED',
    page: number,
    pageSize: number,
    titleFilter: string,
    updateByFilter: string,
    sortBy: 'JOB_TITLE' | 'STATUS' | 'DOCUMENT_COUNT' | 'PAGE_COUNT' | 'UPDATE_DATE' | 'UPDATE_BY',
    sortDesc: boolean
  ) => {
    const result = await repo.listJobs(search, status, page, pageSize, titleFilter, updateByFilter, sortBy, sortDesc)
    const summaries = await repo.getDocumentStatuses(result.rows.map((job) => job.JOB_ID))
    return {
      ...result,
      rows: result.rows.map((job) => ({
        ...job,
        ...(summaries.get(job.JOB_ID) ?? { DOCUMENT_PAGE_COUNTS: {}, UNCLASSIFIED_PAGE_COUNT: 0 }),
      })),
    }
  },
  detail,

  create: async (_title: string, reference: string | null): Promise<JobDetail> => {
    const jobId = await MySQLExecute.withTransaction(async (conn) => {
      const id = await repo.insertJob(conn, randomUUID(), 'New document', reference)
      try {
        await repo.assignImportCode(conn, id, getImportPrefix())
      } catch (error) {
        if (error instanceof FileSequenceInactiveError) throw new MergePdfError(error.message, 409)
        throw error
      }
      return id
    })
    return detail(jobId)
  },

  saveDraft: async (jobId: number, expectedVersion: number, _title: string, reference: string | null): Promise<JobDetail> => {
    await MySQLExecute.withTransaction(async (conn) => {
      const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if (job.STATUS !== 'DRAFT' || job.LAST_COMPLETED_AT) throw new MergePdfError('Completed documents must be edited with Save Changes', 409)
      const code = isImportCode(job.JOB_CODE) ? job.JOB_CODE : await repo.assignImportCode(conn, jobId, getImportPrefix())
      await repo.updateJob(conn, jobId, code, reference)
    })
    return detail(jobId)
  },

  deleteDraft: async (jobId: number, expectedVersion: number): Promise<{ JOB_ID: number }> => {
    await MySQLExecute.withTransaction(async (conn) => {
      const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
      if (job.STATUS !== 'DRAFT' || job.LAST_COMPLETED_AT) throw new MergePdfError('Only Draft documents can be deleted', 409)
      await repo.softDeleteDraft(conn, jobId)
    })
    return { JOB_ID: jobId }
  },

  deleteJob: async (jobId: number, expectedVersion: number): Promise<{ JOB_ID: number }> => {
    let restore: (() => Promise<void>) | undefined
    try {
      await MySQLExecute.withTransaction(async (conn) => {
        assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
        restore = await removePublishedPdfs(await repo.getDeletionPublications(conn, jobId))
        await repo.softDeleteJob(conn, jobId)
        await EmailDigestService.cancelJobQueue(conn, jobId)
      })
    } catch (error) {
      if (restore) await restore()
      if (error instanceof MergePdfError) throw error
      throw new MergePdfError(error instanceof Error ? error.message : 'Could not delete the document and its shared PDF', 503)
    }
    return { JOB_ID: jobId }
  },

  addDocument: async (
    jobId: number,
    expectedVersion: number,
    categoryId: number,
    entryStatusCode: string | null,
    fileName: string,
    bytes: Buffer,
    description: string | null = null
  ): Promise<JobDetail> => {
    if (categoryId !== 1 && entryStatusCode) throw new MergePdfError('Status applies only to import entry', 400)
    if (fileName.length < 1 || fileName.length > 255) throw new MergePdfError('File name is too long', 400)
    let normalized: Awaited<ReturnType<typeof normalizeFile>>
    try {
      normalized = await normalizeFile(fileName, bytes)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid document'
      throw new MergePdfError(message, message.startsWith('Excel conversion is unavailable') ? 503 : 400)
    }
    return persistDocument(jobId, expectedVersion, categoryId, entryStatusCode, fileName, bytes, normalized, undefined, description)
  },

  addCombinedDocument: async (jobId: number, expectedVersion: number, fileName: string, bytes: Buffer, description: string | null = null): Promise<JobDetail> => {
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
    const classifications = await classifyCombinedPdf(normalized.pdfBytes, normalized.pageCount)
    return persistDocument(jobId, expectedVersion, 10, null, fileName, bytes, normalized, classifications, description)
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

  complete: async (jobId: number, expectedVersion: number, fields?: { title: string; reference: string | null }): Promise<JobDetail> => {
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
          directory: pending.NETWORK_PATH ? path.dirname(pending.NETWORK_PATH) : getOutputDirectory(),
          overwrite: !!current.LAST_COMPLETED_AT,
        }
      : await MySQLExecute.withTransaction(async (conn) => {
          const job = assertEditable(await repo.lockJob(conn, jobId), expectedVersion)
          const documents = await repo.getDocuments(jobId, conn)
          const pages = await repo.getPages(jobId, conn)
          const requiredCategoryIds = await repo.getRequiredCategoryIds(conn)
          const blobs = await repo.getAllPdfBytes(conn, jobId)
          const version = await repo.allocateNextPublicationVersion(conn, jobId)
          const previous = await repo.getLatestPublished(jobId, conn)
          const outputDirectory = previous?.NETWORK_PATH ? path.dirname(previous.NETWORK_PATH) : getOutputDirectory()
          if (requiredCategoryIds.some((categoryId) => !pages.some((page) => page.CATEGORY_ID === categoryId))) {
            throw new MergePdfError('Import entry, Invoice and HAWB or AWB are required', 400)
          }
          const importEntryDocumentIds = new Set(pages.filter((page) => page.CATEGORY_ID === 1).map((page) => page.DOCUMENT_ID))
          const entries = documents.filter((document) => importEntryDocumentIds.has(document.DOCUMENT_ID))
          if (entries.some((entry) => entry.ENTRY_STATUS_CODE !== '04')) {
            throw new MergePdfError('Every import entry must have status 04', 400)
          }
          if (pages.length === 0) throw new MergePdfError('Add at least one page', 400)
          try {
            await checkOutputDirectory(outputDirectory)
          } catch (error) {
            console.error('Merge PDF output check failed:', error)
            throw new MergePdfError(error instanceof Error ? error.message : 'PDF output folder is unavailable', 503)
          }
          const pdf = await mergePages(
            pages.map((page) => ({
              documentId: page.DOCUMENT_ID,
              sourcePageNumber: page.SOURCE_PAGE_NUMBER,
              rotationDegrees: page.ROTATION_DEGREES,
            })),
            new Map(blobs.map((blob) => [blob.DOCUMENT_ID, blob.NORMALIZED_PDF_BYTES]))
          )
          if (previous && !isImportCode(job.JOB_CODE)) {
            throw new MergePdfError('This document uses a legacy filename. Contact your administrator before saving changes.', 409)
          }
          let code = job.JOB_CODE
          if (!isImportCode(code)) {
            try {
              code = await repo.assignImportCode(conn, jobId, getImportPrefix())
            } catch (error) {
              if (error instanceof FileSequenceInactiveError) throw new MergePdfError(error.message, 409)
              throw error
            }
          }
          const fileName = `${code}.pdf`
          if (fields) await repo.updateJob(conn, jobId, code, fields.reference)
          const publicationId = await repo.insertPublication(conn, jobId, version, fileName, pdf, sha256(pdf), pages.length, path.join(outputDirectory, fileName))
          return { publicationId, pdf, fileName, directory: outputDirectory, overwrite: !!previous }
        })

    let publishedPath: string | null = null
    let failureMessage = 'Could not save merged PDF to the output folder'
    try {
      publishedPath = await publishPdf(publication.directory, publication.fileName, publication.pdf, publication.overwrite)
    } catch (error) {
      console.error('Merge PDF publication failed:', error)
      if (error instanceof Error) failureMessage = error.message
    }
    await MySQLExecute.withTransaction(async (conn) => {
      await repo.finishPublication(conn, jobId, publication.publicationId, publishedPath)
      if (publishedPath) await EmailDigestService.enqueuePublishedPublication(conn, jobId, publication.publicationId)
    })
    if (!publishedPath) throw new MergePdfError(failureMessage, 503)
    return detail(jobId)
  },

  documentPdf: (documentId: number): Promise<Buffer | undefined> => repo.getDocumentPdf(documentId),
  originalDocument: (jobId: number, documentId: number) => repo.getOriginalDocument(jobId, documentId),
  pagePdf: async (jobId: number, pageId: number, rotation?: number): Promise<Buffer | undefined> => {
    const source = await repo.getPagePdfSource(jobId, pageId)
    return source ? extractPage(source.NORMALIZED_PDF_BYTES, source.SOURCE_PAGE_NUMBER, rotation ?? source.ROTATION_DEGREES) : undefined
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

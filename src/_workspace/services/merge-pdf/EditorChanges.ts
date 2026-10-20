import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { z } from 'zod'

import { MergePdfDataService as repo } from '@src/_workspace/services/merge-pdf/MergePdfDataService'
import { normalizeFile } from './PdfEngine'
import { detectEntryStatus04 } from './EntryStatusDetection'

const identifier = z
  .number()
  .int()
  .refine((value) => value !== 0 && Number.isSafeInteger(value))
const description = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((value) => value || null)
export const editorChangesSchema = z
  .object({
    pages: z
      .array(
        z.object({
          PAGE_ID: identifier,
          DOCUMENT_ID: identifier,
          SOURCE_PAGE_NUMBER: z.number().int().positive(),
          CATEGORY_ID: z.number().int().min(1).max(10),
          ROTATION_DEGREES: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
          CLASSIFICATION_SOURCE: z.enum(['AUTO_TEXT', 'AUTO_OCR', 'FILENAME', 'UNKNOWN', 'USER']).nullable(),
          CLASSIFICATION_CONFIDENCE: z.number().min(0).max(1).nullable(),
          DESCRIPTION: description,
        })
      )
      .max(500),
    documents: z
      .array(
        z.object({
          DOCUMENT_ID: identifier,
          CATEGORY_ID: z.number().int().min(1).max(10),
          ENTRY_STATUS_CODE: z.literal('04').nullable(),
          ENTRY_STATUS_SOURCE: z.enum(['USER', 'DOCUMENT', 'SYSTEM']).nullable().optional(),
          DESCRIPTION: description,
          uploadIndex: z.number().int().nonnegative().optional(),
        })
      )
      .max(500),
  })
  .superRefine((changes, ctx) => {
    for (const [index, page] of changes.pages.entries()) {
      if (page.CATEGORY_ID === 10 && !page.DESCRIPTION)
        ctx.addIssue({ code: 'custom', path: ['pages', index, 'DESCRIPTION'], message: 'Description is required for every Other page' })
    }
    for (const [index, doc] of changes.documents.entries()) {
      if (doc.DOCUMENT_ID < 0 && changes.pages.some((page) => page.DOCUMENT_ID === doc.DOCUMENT_ID && page.CATEGORY_ID === 10) && !doc.DESCRIPTION)
        ctx.addIssue({ code: 'custom', path: ['documents', index, 'DESCRIPTION'], message: 'Import description is required for Other documents' })
    }
  })
export type EditorChanges = z.infer<typeof editorChangesSchema>
export type PreparedEditorChanges = EditorChanges & { uploads: Awaited<ReturnType<typeof prepareEditorUploads>> }

export const prepareEditorUploads = async (files: Express.Multer.File[]) =>
  Promise.all(
    files.map(async (file) => ({
      fileName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      bytes: file.buffer,
      normalized: await normalizeFile(file.originalname, file.buffer),
    }))
  )

export const applyEditorChanges = async (conn: PoolConnection, jobId: number, changes: PreparedEditorChanges): Promise<void> => {
  const existingDocuments = await repo.getDocuments(jobId, conn)
  const originalPages = await repo.getPages(jobId, conn)
  if (
    new Set(changes.pages.map((page) => page.PAGE_ID)).size !== changes.pages.length ||
    new Set(changes.documents.map((doc) => doc.DOCUMENT_ID)).size !== changes.documents.length
  )
    throw new Error('Duplicate editor records')
  const mappedDocuments = new Map<number, number>()
  const sourcePages = new Map<string, number>()
  const usedUploads = new Set<number>()
  for (const doc of changes.documents) {
    if (doc.DOCUMENT_ID > 0) {
      if (!existingDocuments.some((original) => original.DOCUMENT_ID === doc.DOCUMENT_ID) || doc.uploadIndex !== undefined)
        throw new Error('Source document changed. Reload and try again')
      mappedDocuments.set(doc.DOCUMENT_ID, doc.DOCUMENT_ID)
    } else {
      const upload = doc.uploadIndex === undefined ? undefined : changes.uploads[doc.uploadIndex]
      if (!upload || usedUploads.has(doc.uploadIndex!)) throw new Error('Missing or duplicate uploaded source')
      usedUploads.add(doc.uploadIndex!)
      const documentId = await repo.insertDocument(conn, {
        jobId,
        categoryId: doc.CATEGORY_ID,
        uploadOrder: await repo.nextUploadOrder(conn, jobId),
        fileName: upload.fileName,
        sourceType: upload.normalized.sourceType,
        sourceMime: upload.normalized.sourceMime,
        original: upload.bytes,
        normalized: upload.normalized.pdfBytes,
        originalHash: createHash('sha256').update(upload.bytes).digest(),
        normalizedHash: createHash('sha256').update(upload.normalized.pdfBytes).digest(),
        pageCount: upload.normalized.pageCount,
        entryStatusCode: null,
        description: doc.DESCRIPTION,
      })
      await repo.insertPages(conn, jobId, documentId, upload.normalized.pageCount, await repo.nextPageOrder(conn, jobId))
      mappedDocuments.set(doc.DOCUMENT_ID, documentId)
    }
  }
  if (usedUploads.size !== changes.uploads.length) throw new Error('Unexpected uploaded source')
  const allPages = await repo.getPages(jobId, conn)
  for (const page of allPages) sourcePages.set(`${page.DOCUMENT_ID}:${page.SOURCE_PAGE_NUMBER}`, page.PAGE_ID)
  const keep: number[] = []
  for (const page of changes.pages) {
    const documentId = mappedDocuments.get(page.DOCUMENT_ID)
    const pageId = documentId === undefined ? undefined : sourcePages.get(`${documentId}:${page.SOURCE_PAGE_NUMBER}`)
    if (!pageId || (page.PAGE_ID > 0 && pageId !== page.PAGE_ID) || (page.PAGE_ID < 0 && page.DOCUMENT_ID > 0) || keep.includes(pageId)) throw new Error('Invalid editor page')
    keep.push(pageId)
    const original = allPages.find((item) => item.PAGE_ID === pageId)!
    if (
      original.CATEGORY_ID !== page.CATEGORY_ID ||
      original.CLASSIFICATION_SOURCE !== page.CLASSIFICATION_SOURCE ||
      original.CLASSIFICATION_CONFIDENCE !== page.CLASSIFICATION_CONFIDENCE ||
      original.ROTATION_DEGREES !== page.ROTATION_DEGREES ||
      original.DESCRIPTION !== page.DESCRIPTION
    ) {
      await repo.updatePageDetails(conn, jobId, pageId, {
        CATEGORY_ID: page.CATEGORY_ID,
        CLASSIFICATION_SOURCE: page.CLASSIFICATION_SOURCE,
        CLASSIFICATION_CONFIDENCE: page.CLASSIFICATION_CONFIDENCE,
        ROTATION_DEGREES: page.ROTATION_DEGREES,
        DESCRIPTION: page.DESCRIPTION,
      })
    }
  }
  for (const page of allPages) if (!keep.includes(page.PAGE_ID)) await repo.softDeletePage(conn, jobId, page.PAGE_ID)
  for (const doc of existingDocuments)
    if (!mappedDocuments.has(doc.DOCUMENT_ID) || !(await repo.countActiveDocumentPages(conn, doc.DOCUMENT_ID))) await repo.softDeleteDocument(conn, jobId, doc.DOCUMENT_ID)
  for (const doc of changes.documents) {
    const documentId = mappedDocuments.get(doc.DOCUMENT_ID)!
    if (!(await repo.countActiveDocumentPages(conn, documentId))) {
      await repo.softDeleteDocument(conn, jobId, documentId)
      continue
    }
    const entryPages = changes.pages.filter((page) => page.DOCUMENT_ID === doc.DOCUMENT_ID && page.CATEGORY_ID === 1).map((page) => page.SOURCE_PAGE_NUMBER)
    const original = existingDocuments.find((item) => item.DOCUMENT_ID === doc.DOCUMENT_ID)
    const status = entryPages.length ? doc.ENTRY_STATUS_CODE : null
    let source: string | null = status ? 'USER' : null
    if (status && doc.ENTRY_STATUS_SOURCE === 'DOCUMENT') {
      const previouslyVerified =
        original?.ENTRY_STATUS_CODE === '04' &&
        original.ENTRY_STATUS_SOURCE === 'DOCUMENT' &&
        entryPages.every((number) => originalPages.some((page) => page.DOCUMENT_ID === doc.DOCUMENT_ID && page.SOURCE_PAGE_NUMBER === number && page.CATEGORY_ID === 1))
      const upload = doc.uploadIndex === undefined ? undefined : changes.uploads[doc.uploadIndex]
      const bytes = previouslyVerified ? undefined : (upload?.normalized.pdfBytes ?? (await repo.getDocumentPdf(documentId)))
      const pdfSource = upload?.normalized.sourceType ?? original?.SOURCE_TYPE
      if (!previouslyVerified && (pdfSource !== 'PDF' || !bytes || !(await detectEntryStatus04(bytes, entryPages))))
        throw new z.ZodError([{ code: 'custom', path: ['documents'], message: 'Status 04 could not be verified from this document. Please confirm it manually.' }])
      source = 'DOCUMENT'
    } else if (status && original?.ENTRY_STATUS_SOURCE === 'SYSTEM' && original.ENTRY_STATUS_CODE === status && doc.ENTRY_STATUS_SOURCE === 'SYSTEM') source = 'SYSTEM'
    if (!original || original.DESCRIPTION !== doc.DESCRIPTION || original.ENTRY_STATUS_CODE !== status || original.ENTRY_STATUS_SOURCE !== source)
      await repo.updateDocumentMetadata(conn, jobId, documentId, { DESCRIPTION: doc.DESCRIPTION, ENTRY_STATUS_CODE: status, ENTRY_STATUS_SOURCE: source })
  }
  await repo.reorderPages(conn, jobId, keep)
}

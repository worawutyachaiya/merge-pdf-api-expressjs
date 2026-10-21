import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { MergePdfError, MergePdfService } from '@src/_workspace/services/merge-pdf/MergePdfService'
import { getPageThumbnail, renderPdfThumbnails } from '@src/_workspace/services/merge-pdf/PageThumbnail'
import { normalizeFile, extractPage } from '@src/_workspace/services/merge-pdf/PdfEngine'
import { classifyCombinedPdf } from '@src/_workspace/services/merge-pdf/CombinedPdfClassification'
import { detectDocumentType } from '@src/_workspace/services/merge-pdf/DocumentTypeDetection'
import { detectEntryStatus04 } from '@src/_workspace/services/merge-pdf/EntryStatusDetection'
import { editorChangesSchema, prepareEditorUploads } from '@src/_workspace/services/merge-pdf/EditorChanges'
import { AuditActorError, withAuditActor } from '@src/_workspace/services/merge-pdf/AuditActor'
import {
  id,
  version,
  previewRotation,
  jobFields,
  editFields,
  versionFields,
  completeFields,
  reorderFields,
  batchFields,
  uploadFields,
  combinedUploadFields,
  pageCategoryFields,
  pageRotationFields,
  entryStatusFields,
} from '@src/_workspace/routes/merge-pdf/MergePdfValidation'

const respond = (res: Response, result: unknown, method: string, status = 200, total?: number): void => {
  res.status(status).json({
    Status: true,
    Message: 'Success',
    ResultOnDb: Array.isArray(result) ? result : [result],
    MethodOnDb: method,
    TotalCountOnDb: total ?? (Array.isArray(result) ? result.length : 1),
  })
}

type Handler = (req: Request, res: Response) => Promise<void>

const readOnlyMethods = new Set([
  'Preview next document code',
  'List Merge PDF jobs',
  'View Merge PDF job',
  'Preview Merge PDF document',
  'Preview Merge PDF page',
  'Thumbnail Merge PDF page',
  'Download merged PDF',
  'Download source document',
])

const safe =
  (method: string, handler: Handler) =>
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      if (readOnlyMethods.has(method)) await handler(req, res)
      else await withAuditActor(req.body?.UPDATE_BY, () => handler(req, res))
    } catch (error: unknown) {
      const status = error instanceof MergePdfError || error instanceof AuditActorError ? error.statusCode : error instanceof z.ZodError ? 400 : 500
      res.status(status).json({
        Status: false,
        Message: error instanceof MergePdfError || error instanceof AuditActorError || error instanceof z.ZodError ? error.message : 'Merge PDF operation failed',
        ResultOnDb: [],
        MethodOnDb: method,
        TotalCountOnDb: 0,
      })
    }
  }

export const MergePdfController = {
  detectDocumentType: async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ Status: false, Message: 'Select a file', ResultOnDb: [] })
      return
    }
    const name = typeof req.body.fileName === 'string' ? req.body.fileName : req.file.originalname
    respond(res, await detectDocumentType(name, req.file.buffer), 'Detect document type')
  },
  prepareFile: async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new Error('Select a file')
      const combined = req.body.combined === 'true'
      if (combined && !req.file.originalname.toLowerCase().endsWith('.pdf')) throw new Error('Combined file must be a PDF')
      const normalized = await normalizeFile(req.file.originalname, req.file.buffer)
      const classifications = combined ? await classifyCombinedPdf(normalized.pdfBytes, normalized.pageCount) : null
      const categoryId = z.coerce.number().int().min(1).max(10).default(10).parse(req.body.categoryId)
      const entryPages = Array.from({ length: normalized.pageCount }, (_, index) => index + 1).filter((number) => (classifications?.[number - 1].categoryId ?? categoryId) === 1)
      const confirmed = normalized.sourceType === 'PDF' && (await detectEntryStatus04(normalized.pdfBytes, entryPages))
      const images = await renderPdfThumbnails(normalized.pdfBytes, normalized.pageCount)
      res.json({
        Status: true,
        Message: 'Prepared',
        ResultOnDb: [
          {
            sourceType: normalized.sourceType,
            pageCount: normalized.pageCount,
            pdf: normalized.pdfBytes.toString('base64'),
            thumbnails: images.map((image) => image.toString('base64')),
            classifications,
            entryStatusCode: confirmed ? '04' : null,
            entryStatusSource: confirmed ? 'DOCUMENT' : null,
          },
        ],
      })
    } catch (error) {
      res.status(400).json({ Status: false, Message: error instanceof Error ? error.message : 'Invalid file' })
    }
  },
  preparedPagePreview: async (req: Request, res: Response) => {
    try {
      if (!req.file) throw new Error('Select a PDF')
      const bytes = await extractPage(
        req.file.buffer,
        z.coerce.number().int().positive().parse(req.body.page),
        z.coerce
          .number()
          .pipe(z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]))
          .parse(req.body.rotation)
      )
      res.type('pdf').send(bytes)
    } catch {
      res.status(400).json({ Status: false, Message: 'Invalid page preview' })
    }
  },
  saveEditor: safe('Save editor changes', async (req, res) => {
    const mode = z.enum(['draft', 'complete']).parse(req.params.mode)
    const payload = z.object({ rowVersion: version, changes: editorChangesSchema }).parse(JSON.parse(req.body.payload))
    const changes = { ...payload.changes, uploads: await prepareEditorUploads((req.files ?? []) as Express.Multer.File[]) }
    const jobId = id.parse(req.params.jobId)
    const result =
      mode === 'draft' ? await MergePdfService.saveEditorDraft(jobId, payload.rowVersion, changes) : await MergePdfService.completeEditor(jobId, payload.rowVersion, changes)
    respond(res, result, 'Save editor changes')
  }),
  search: safe('List Merge PDF jobs', async (req, res) => {
    const filters = z
      .object({
        search: z.string().max(100).default(''),
        status: z.enum(['ALL', 'DRAFT', 'COMPLETED']).default('ALL'),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(10),
        titleFilter: z.string().max(255).default(''),
        updateByFilter: z.string().max(100).default(''),
        sortBy: z.enum(['JOB_TITLE', 'STATUS', 'DOCUMENT_COUNT', 'PAGE_COUNT', 'UPDATE_DATE', 'UPDATE_BY']).default('UPDATE_DATE'),
        sortDesc: z.boolean().default(true),
      })
      .parse(req.body)
    const result = await MergePdfService.list(
      filters.search.trim(),
      filters.status,
      filters.page,
      filters.pageSize,
      filters.titleFilter.trim(),
      filters.updateByFilter.trim(),
      filters.sortBy,
      filters.sortDesc
    )
    respond(res, result.rows, 'List Merge PDF jobs', 200, result.total)
  }),
  create: safe('Create Merge PDF job', async (req, res) => {
    const fields = jobFields.parse(req.body)
    respond(res, await MergePdfService.create(fields.title, fields.reference), 'Create Merge PDF job', 201)
  }),
  nextCode: safe('Preview next document code', async (_req, res) => {
    respond(res, { code: await MergePdfService.nextCode() }, 'Preview next document code')
  }),
  batchPages: safe('Update selected pages', async (req, res) => {
    const fields = batchFields.parse(req.body)
    respond(res, await MergePdfService.batchPages(id.parse(req.params.jobId), fields.rowVersion, fields.pageIds, fields.action), 'Update selected pages')
  }),
  detail: safe('View Merge PDF job', async (req, res) => {
    respond(res, await MergePdfService.detail(id.parse(req.params.jobId)), 'View Merge PDF job')
  }),
  saveDraft: safe('Save Merge PDF draft', async (req, res) => {
    const fields = editFields.parse(req.body)
    respond(res, await MergePdfService.saveDraft(id.parse(req.params.jobId), fields.rowVersion, fields.title, fields.reference), 'Save Merge PDF draft')
  }),
  deleteDraft: safe('Delete Merge PDF draft', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.deleteDraft(id.parse(req.params.jobId), fields.rowVersion), 'Delete Merge PDF draft')
  }),
  deleteJob: safe('Delete Merge PDF job', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.deleteJob(id.parse(req.params.jobId), fields.rowVersion), 'Delete Merge PDF job')
  }),
  downloadSource: safe('Download source document', async (req, res) => {
    const file = await MergePdfService.originalDocument(id.parse(req.params.jobId), id.parse(req.params.documentId))
    if (!file) throw new MergePdfError('Source document not found', 404)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.ORIGINAL_FILE_NAME)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(file.ORIGINAL_BYTES)
  }),
  uploadDocument: safe('Upload Merge PDF document', async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) throw new MergePdfError('Select a file', 400)
    const fields = uploadFields.parse(req.body)
    respond(
      res,
      await MergePdfService.addDocument(
        id.parse(req.params.jobId),
        fields.rowVersion,
        fields.categoryId,
        fields.entryStatusCode ?? null,
        req.file.originalname,
        req.file.buffer,
        fields.description ?? null
      ),
      'Upload Merge PDF document',
      201
    )
  }),
  uploadCombinedDocument: safe('Upload combined Merge PDF document', async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) throw new MergePdfError('Select a file', 400)
    const fields = combinedUploadFields.parse(req.body)
    respond(
      res,
      await MergePdfService.addCombinedDocument(id.parse(req.params.jobId), fields.rowVersion, req.file.originalname, req.file.buffer, fields.description ?? null),
      'Upload combined Merge PDF document',
      201
    )
  }),
  updatePageCategory: safe('Classify Merge PDF page', async (req, res) => {
    const fields = pageCategoryFields.parse(req.body)
    respond(res, await MergePdfService.updatePageCategory(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion, fields.categoryId), 'Classify Merge PDF page')
  }),
  rotatePage: safe('Rotate Merge PDF page', async (req, res) => {
    const fields = pageRotationFields.parse(req.body)
    respond(res, await MergePdfService.rotatePage(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion, fields.delta), 'Rotate Merge PDF page')
  }),
  removePage: safe('Remove Merge PDF page', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.removePage(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion), 'Remove Merge PDF page')
  }),
  removeDocument: safe('Remove Merge PDF document', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.removeDocument(id.parse(req.params.jobId), id.parse(req.params.documentId), fields.rowVersion), 'Remove Merge PDF document')
  }),
  updateEntryStatus: safe('Update import entry status', async (req, res) => {
    const fields = entryStatusFields.parse(req.body)
    respond(
      res,
      await MergePdfService.updateEntryStatus(id.parse(req.params.jobId), id.parse(req.params.documentId), fields.rowVersion, fields.statusCode),
      'Update import entry status'
    )
  }),
  reorderPages: safe('Reorder Merge PDF pages', async (req, res) => {
    const fields = reorderFields.parse(req.body)
    respond(res, await MergePdfService.reorder(id.parse(req.params.jobId), fields.rowVersion, fields.pageIds), 'Reorder Merge PDF pages')
  }),
  complete: safe('Complete Merge PDF job', async (req, res) => {
    const fields = completeFields.parse(req.body)
    respond(res, await MergePdfService.complete(id.parse(req.params.jobId), fields.rowVersion, fields.fields), 'Complete Merge PDF job')
  }),
  previewDocument: safe('Preview Merge PDF document', async (req, res) => {
    const bytes = await MergePdfService.documentPdf(id.parse(req.params.documentId))
    if (!bytes) throw new MergePdfError('Document not found', 404)
    res.type('pdf').setHeader('Content-Disposition', 'inline; filename="preview.pdf"')
    res.send(bytes)
  }),
  previewPage: safe('Preview Merge PDF page', async (req, res) => {
    const bytes = await MergePdfService.pagePdf(id.parse(req.params.jobId), id.parse(req.params.pageId), previewRotation.parse(req.body?.rotation))
    if (!bytes) throw new MergePdfError('Page not found', 404)
    res.type('pdf').setHeader('Content-Disposition', 'inline; filename="page.pdf"')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  }),
  thumbnail: safe('Thumbnail Merge PDF page', async (req, res) => {
    const bytes = await getPageThumbnail(id.parse(req.params.jobId), id.parse(req.params.pageId), previewRotation.parse(req.body?.rotation))
    if (!bytes) throw new MergePdfError('Page not found', 404)
    res.type('png').setHeader('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  }),
  downloadPublication: safe('Download merged PDF', async (req, res) => {
    const result = await MergePdfService.publicationPdf(id.parse(req.params.jobId), id.parse(req.params.publicationId))
    if (!result) throw new MergePdfError('Merged PDF not found', 404)
    res.type('pdf').setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    res.send(result.bytes)
  }),
}

import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'

import { MergePdfError, MergePdfService } from '@src/_workspace/services/merge-pdf/MergePdfService'
import { getPageThumbnail } from '@src/_workspace/services/merge-pdf/PageThumbnail'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 20 * 1024 * 1024 } })
const id = z.coerce.number().int().positive().safe()
const version = z.number().int().positive()
const jobFields = z.object({
  title: z.string().trim().min(1).max(255),
  reference: z.string().trim().max(100).nullable(),
})
const editFields = jobFields.extend({ rowVersion: version })
const versionFields = z.object({ rowVersion: version })
const reorderFields = versionFields.extend({ pageIds: z.array(id).max(500) })
const uploadFields = z.object({
  rowVersion: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().min(1).max(10),
  entryStatusCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
})
const combinedUploadFields = z.object({ rowVersion: z.coerce.number().int().positive() })
const pageCategoryFields = versionFields.extend({ categoryId: z.number().int().min(1).max(10) })
const pageRotationFields = versionFields.extend({ delta: z.union([z.literal(90), z.literal(270)]) })
const entryStatusFields = versionFields.extend({
  statusCode: z
    .string()
    .regex(/^\d{2}$/)
    .nullable(),
})

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
const safe =
  (method: string, handler: Handler) =>
  async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      await handler(req, res)
    } catch (error: unknown) {
      const status = error instanceof MergePdfError ? error.statusCode : error instanceof z.ZodError ? 400 : 500
      res.status(status).json({
        Status: false,
        Message: error instanceof MergePdfError || error instanceof z.ZodError ? error.message : 'Merge PDF operation failed',
        ResultOnDb: [],
        MethodOnDb: method,
        TotalCountOnDb: 0,
      })
    }
  }

const receiveFile = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      res.status(400).json({ Status: false, Message: 'File exceeds 20 MiB or upload is invalid', ResultOnDb: [], MethodOnDb: 'Upload Merge PDF document', TotalCountOnDb: 0 })
      return
    }
    if (req.file) {
      const repaired = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      if (!repaired.includes('\uFFFD')) req.file.originalname = repaired
    }
    next()
  })
}

// The template API has no server authentication. Keep this feature local to development
// until the company's authenticated API middleware and permission mapping are supplied.
router.use((req, res, next) => {
  const remote = req.socket.remoteAddress
  if (process.env.NODE_ENV !== 'development' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')) {
    res.status(403).json({ Status: false, Message: 'Merge PDF is available only on local development', ResultOnDb: [], MethodOnDb: 'Merge PDF access', TotalCountOnDb: 0 })
    return
  }
  next()
})

router.post(
  '/jobs/search',
  safe('List Merge PDF jobs', async (req, res) => {
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
  })
)

router.post(
  '/jobs/create',
  safe('Create Merge PDF job', async (req, res) => {
    const fields = jobFields.parse(req.body)
    respond(res, await MergePdfService.create(fields.title, fields.reference), 'Create Merge PDF job', 201)
  })
)

router.post(
  '/jobs/:jobId/detail',
  safe('View Merge PDF job', async (req, res) => {
    respond(res, await MergePdfService.detail(id.parse(req.params.jobId)), 'View Merge PDF job')
  })
)

router.post(
  '/jobs/:jobId/save-draft',
  safe('Save Merge PDF draft', async (req, res) => {
    const fields = editFields.parse(req.body)
    respond(res, await MergePdfService.saveDraft(id.parse(req.params.jobId), fields.rowVersion, fields.title, fields.reference), 'Save Merge PDF draft')
  })
)

router.post(
  '/jobs/:jobId/delete-draft',
  safe('Delete Merge PDF draft', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.deleteDraft(id.parse(req.params.jobId), fields.rowVersion), 'Delete Merge PDF draft')
  })
)

router.post(
  '/jobs/:jobId/documents',
  receiveFile,
  safe('Upload Merge PDF document', async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) throw new MergePdfError('Select a file', 400)
    const fields = uploadFields.parse(req.body)
    respond(
      res,
      await MergePdfService.addDocument(id.parse(req.params.jobId), fields.rowVersion, fields.categoryId, fields.entryStatusCode ?? null, req.file.originalname, req.file.buffer),
      'Upload Merge PDF document',
      201
    )
  })
)

router.post(
  '/jobs/:jobId/combined-documents',
  receiveFile,
  safe('Upload combined Merge PDF document', async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) throw new MergePdfError('Select a file', 400)
    const fields = combinedUploadFields.parse(req.body)
    respond(
      res,
      await MergePdfService.addCombinedDocument(id.parse(req.params.jobId), fields.rowVersion, req.file.originalname, req.file.buffer),
      'Upload combined Merge PDF document',
      201
    )
  })
)

router.post(
  '/jobs/:jobId/pages/:pageId/category',
  safe('Classify Merge PDF page', async (req, res) => {
    const fields = pageCategoryFields.parse(req.body)
    respond(res, await MergePdfService.updatePageCategory(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion, fields.categoryId), 'Classify Merge PDF page')
  })
)

router.post(
  '/jobs/:jobId/pages/:pageId/rotation',
  safe('Rotate Merge PDF page', async (req, res) => {
    const fields = pageRotationFields.parse(req.body)
    respond(res, await MergePdfService.rotatePage(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion, fields.delta), 'Rotate Merge PDF page')
  })
)

router.post(
  '/jobs/:jobId/pages/:pageId/remove',
  safe('Remove Merge PDF page', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.removePage(id.parse(req.params.jobId), id.parse(req.params.pageId), fields.rowVersion), 'Remove Merge PDF page')
  })
)

router.post(
  '/jobs/:jobId/documents/:documentId/remove',
  safe('Remove Merge PDF document', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.removeDocument(id.parse(req.params.jobId), id.parse(req.params.documentId), fields.rowVersion), 'Remove Merge PDF document')
  })
)

router.post(
  '/jobs/:jobId/documents/:documentId/status',
  safe('Update import entry status', async (req, res) => {
    const fields = entryStatusFields.parse(req.body)
    respond(
      res,
      await MergePdfService.updateEntryStatus(id.parse(req.params.jobId), id.parse(req.params.documentId), fields.rowVersion, fields.statusCode),
      'Update import entry status'
    )
  })
)

router.post(
  '/jobs/:jobId/pages/reorder',
  safe('Reorder Merge PDF pages', async (req, res) => {
    const fields = reorderFields.parse(req.body)
    respond(res, await MergePdfService.reorder(id.parse(req.params.jobId), fields.rowVersion, fields.pageIds), 'Reorder Merge PDF pages')
  })
)

router.post(
  '/jobs/:jobId/complete',
  safe('Complete Merge PDF job', async (req, res) => {
    const fields = versionFields.parse(req.body)
    respond(res, await MergePdfService.complete(id.parse(req.params.jobId), fields.rowVersion), 'Complete Merge PDF job')
  })
)

router.post(
  '/documents/:documentId/preview',
  safe('Preview Merge PDF document', async (req, res) => {
    const bytes = await MergePdfService.documentPdf(id.parse(req.params.documentId))
    if (!bytes) throw new MergePdfError('Document not found', 404)
    res.type('pdf').setHeader('Content-Disposition', 'inline; filename="preview.pdf"')
    res.send(bytes)
  })
)

router.post(
  '/jobs/:jobId/pages/:pageId/preview',
  safe('Preview Merge PDF page', async (req, res) => {
    const bytes = await MergePdfService.pagePdf(id.parse(req.params.jobId), id.parse(req.params.pageId))
    if (!bytes) throw new MergePdfError('Page not found', 404)
    res.type('pdf').setHeader('Content-Disposition', 'inline; filename="page.pdf"')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  })
)

router.post(
  '/jobs/:jobId/pages/:pageId/thumbnail',
  safe('Thumbnail Merge PDF page', async (req, res) => {
    const bytes = await getPageThumbnail(id.parse(req.params.jobId), id.parse(req.params.pageId))
    if (!bytes) throw new MergePdfError('Page not found', 404)
    res.type('png').setHeader('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  })
)

router.post(
  '/jobs/:jobId/publications/:publicationId/pdf',
  safe('Download merged PDF', async (req, res) => {
    const result = await MergePdfService.publicationPdf(id.parse(req.params.jobId), id.parse(req.params.publicationId))
    if (!result) throw new MergePdfError('Merged PDF not found', 404)
    res.type('pdf').setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`)
    res.send(result.bytes)
  })
)

export default router

import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { MergePdfController } from '@src/_workspace/controllers/merge-pdf/MergePdfController'

const router = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 20 * 1024 * 1024 } })

const editorUpload = multer({ storage: multer.memoryStorage(), limits: { files: 20, fileSize: 20 * 1024 * 1024 } })

const receiveFile = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      res.status(400).json({
        Status: false,
        Message: 'File exceeds 20 MiB or upload is invalid',
        ResultOnDb: [],
        MethodOnDb: 'Upload Merge PDF document',
        TotalCountOnDb: 0,
      })
      return
    }
    if (req.file) {
      const repaired = Buffer.from(req.file.originalname, 'latin1').toString('utf8')
      if (!repaired.includes('\uFFFD')) req.file.originalname = repaired
    }
    next()
  })
}

router.post('/editor/prepare', multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 20 * 1024 * 1024 } }).single('file'), MergePdfController.prepareFile)
router.post('/editor/detect-document-type', receiveFile, MergePdfController.detectDocumentType)

router.post(
  '/editor/page-preview',
  multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 40 * 1024 * 1024 } }).single('file'),
  MergePdfController.preparedPagePreview
)

router.post('/jobs/:jobId/editor/:mode', editorUpload.array('files', 20), MergePdfController.saveEditor)

router.post('/jobs/search', MergePdfController.search)

router.post('/jobs/create', MergePdfController.create)

router.get('/jobs/next-code', MergePdfController.nextCode)

router.patch('/jobs/:jobId/pages/batch', MergePdfController.batchPages)

router.get('/jobs/:jobId/detail', MergePdfController.detail)

router.patch('/jobs/:jobId/save-draft', MergePdfController.saveDraft)

router.delete('/jobs/:jobId/delete-draft', MergePdfController.deleteDraft)

router.delete('/jobs/:jobId/delete', MergePdfController.deleteJob)

router.get('/jobs/:jobId/documents/:documentId/source', MergePdfController.downloadSource)

router.post('/jobs/:jobId/documents', receiveFile, MergePdfController.uploadDocument)

router.post('/jobs/:jobId/combined-documents', receiveFile, MergePdfController.uploadCombinedDocument)

router.patch('/jobs/:jobId/pages/:pageId/category', MergePdfController.updatePageCategory)

router.patch('/jobs/:jobId/pages/:pageId/rotation', MergePdfController.rotatePage)

router.delete('/jobs/:jobId/pages/:pageId/remove', MergePdfController.removePage)

router.delete('/jobs/:jobId/documents/:documentId/remove', MergePdfController.removeDocument)

router.patch('/jobs/:jobId/documents/:documentId/status', MergePdfController.updateEntryStatus)

router.patch('/jobs/:jobId/pages/reorder', MergePdfController.reorderPages)

router.post('/jobs/:jobId/complete', MergePdfController.complete)

router.get('/documents/:documentId/preview', MergePdfController.previewDocument)

router.post('/jobs/:jobId/pages/:pageId/preview', MergePdfController.previewPage)

router.post('/jobs/:jobId/pages/:pageId/thumbnail', MergePdfController.thumbnail)

router.get('/jobs/:jobId/publications/:publicationId/pdf', MergePdfController.downloadPublication)

export default router

import { Router } from 'express'
import { SettingsController } from '@src/_workspace/controllers/settings/SettingsController'

const router = Router()
router.post('/document-order/get', SettingsController.documentOrder)
router.post('/document-order/update', SettingsController.saveDocumentOrder)
export default router

import { Router } from 'express'
import { SettingsController } from '@src/_workspace/controllers/settings/SettingsController'

const router = Router()
router.get('/document-order/get', SettingsController.documentOrder)
router.patch('/document-order/update', SettingsController.saveDocumentOrder)
export default router

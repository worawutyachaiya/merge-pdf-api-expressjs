import { Router } from 'express'
import { EmailSettingsController } from '@src/_workspace/controllers/email-settings/EmailSettingsController'

const router = Router()
router.post('/get', EmailSettingsController.detail)
router.post('/accounting-people', EmailSettingsController.accountingPeople)
router.post('/update', EmailSettingsController.save)
export default router

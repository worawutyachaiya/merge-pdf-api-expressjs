import { Router } from 'express'
import { EmailSettingsController } from '@src/_workspace/controllers/email-settings/EmailSettingsController'

const router = Router()
router.get('/get', EmailSettingsController.detail)
router.get('/accounting-people', EmailSettingsController.accountingPeople)
router.patch('/update', EmailSettingsController.save)
export default router

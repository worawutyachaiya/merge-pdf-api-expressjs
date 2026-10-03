import { Router } from 'express'

import { CalDeMinimisController } from '@src/_workspace/controllers/trade-compliance/cal-de-minimis/CalDeMinimisController'
import { validate } from '@src/middlewares/validate'

import {
  calDeMinimisCalculateRequestSchema,
  calDeMinimisProductTypesRequestSchema,
  calDeMinimisSctRevisionsRequestSchema,
  calDeMinimisThresholdSettingsUpdateRequestSchema,
} from './CalDeMinimisValidation'

const calDeMinimisRoutes = Router()

calDeMinimisRoutes.get('/product-types', validate(calDeMinimisProductTypesRequestSchema), CalDeMinimisController.getProductTypes)
calDeMinimisRoutes.get('/sct-revisions', validate(calDeMinimisSctRevisionsRequestSchema), CalDeMinimisController.getSctRevisions)
calDeMinimisRoutes.get('/settings', CalDeMinimisController.getThresholdSettings)
calDeMinimisRoutes.patch('/settings', validate(calDeMinimisThresholdSettingsUpdateRequestSchema), CalDeMinimisController.updateThresholdSettings)
calDeMinimisRoutes.post('/calculate', validate(calDeMinimisCalculateRequestSchema), CalDeMinimisController.calculate)

export default calDeMinimisRoutes

import { EarStatusController } from '@src/_workspace/controllers/trade-compliance/ear-status/EarStatusController'
import { Router } from 'express'

const earstatusRoutes = Router()

earstatusRoutes.post('/search', EarStatusController.search)

export default earstatusRoutes

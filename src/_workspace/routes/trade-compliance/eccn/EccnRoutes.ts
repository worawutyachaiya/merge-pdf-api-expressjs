import { EccnController } from '@src/_workspace/controllers/trade-compliance/eccn/EccnController'
import { Router } from 'express'

const eccnRoutes = Router()

eccnRoutes.post('/search', EccnController.search)
eccnRoutes.post('/getHsCodeRelationsByEccnId', EccnController.getHsCodeRelationsByEccnId)

export default eccnRoutes

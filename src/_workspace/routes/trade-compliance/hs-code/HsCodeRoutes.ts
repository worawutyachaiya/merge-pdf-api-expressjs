import { HsCodeController } from '@src/_workspace/controllers/trade-compliance/hs-code/HsCodeController'
import { Router } from 'express'

const hscodeRoutes = Router()

hscodeRoutes.post('/search', HsCodeController.search)
hscodeRoutes.post('/getEccnRelationsByHsCodeId', HsCodeController.getEccnRelationsByHsCodeId)

export default hscodeRoutes

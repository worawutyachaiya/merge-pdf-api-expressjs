import { EarSurveyController } from '@src/_workspace/controllers/trade-compliance/EarSurveyController'
import { Router } from 'express'

const earSurveyRoutes = Router()

earSurveyRoutes.post('/search', EarSurveyController.search)
earSurveyRoutes.post('/searchPreTrade', EarSurveyController.searchPreTrade)
earSurveyRoutes.post('/getByEarSurveyHeaderId', EarSurveyController.getByEarSurveyHeaderId)
earSurveyRoutes.get('/manufacturing-item', EarSurveyController.getManufacturingItemByCode)
earSurveyRoutes.post('/createByImportFile', EarSurveyController.createByImportFile)
earSurveyRoutes.post('/createPreTradeByImportFile', EarSurveyController.createPreTradeByImportFile)
earSurveyRoutes.post('/cancelPreTrade', EarSurveyController.cancelPreTrade)
earSurveyRoutes.post('/activatePreTrade', EarSurveyController.activatePreTrade)

export default earSurveyRoutes

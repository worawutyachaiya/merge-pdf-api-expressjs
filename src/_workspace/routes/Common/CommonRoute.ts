import { CommonController } from '@src/_workspace/controllers/Common/CommonController'
import { Router } from 'express'

const commonRoutes = Router()

commonRoutes.post('/GetByLikeMonthShortNameEnglish', CommonController.GetByLikeMonthShortNameEnglish)
commonRoutes.post('/getImageFromUrl', CommonController.getImageFromUrl)
commonRoutes.post('/getImageArrayFromUrl', CommonController.getImageArrayFromUrl)
commonRoutes.get('/getYearNow', CommonController.GetYearNow)

commonRoutes.get('/getImageEmployeeFromUrl', CommonController.getImageEmployeeFromUrl)
commonRoutes.post('/getImageEmployeeFromUrl', CommonController.getImageEmployeeFromUrl)

export default commonRoutes

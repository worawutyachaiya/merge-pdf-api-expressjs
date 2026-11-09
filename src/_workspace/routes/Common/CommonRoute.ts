import { CommonController } from '@src/_workspace/controllers/Common/CommonController'
import { Router } from 'express'

const commonRoutes = Router()

commonRoutes.post('/GetByLikeMonthShortNameEnglish', CommonController.GetByLikeMonthShortNameEnglish)
commonRoutes.post('/getImageFromUrl', CommonController.getImageFromUrl)
commonRoutes.post('/getImageArrayFromUrl', CommonController.getImageArrayFromUrl)
commonRoutes.post('/getYearNow', CommonController.GetYearNow)

commonRoutes.post('/getImageEmployeeFromUrl', CommonController.getImageEmployeeFromUrl)

export default commonRoutes

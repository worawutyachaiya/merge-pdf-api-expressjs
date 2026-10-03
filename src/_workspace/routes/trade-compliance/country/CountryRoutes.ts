import { CountryController } from '@src/_workspace/controllers/trade-compliance/country/CountryController'
import { Router } from 'express'

const countryRoutes = Router()

countryRoutes.post('/search', CountryController.search)

export default countryRoutes

import { FecEccnController } from '@src/_workspace/controllers/trade-compliance/fec-eccn/FecEccnController'
import { Router } from 'express'

const fecEccnRoutes = Router()

fecEccnRoutes.post('/search', FecEccnController.search)
fecEccnRoutes.post('/create', FecEccnController.create)
fecEccnRoutes.patch('/update', FecEccnController.update)
fecEccnRoutes.delete('/delete', FecEccnController.delete)

export default fecEccnRoutes

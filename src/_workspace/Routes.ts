import { Router } from 'express'

import mergePdfRoutes from './routes/merge-pdf/MergePdfRoutes'

const Routers = Router()

Routers.use('/', mergePdfRoutes)

export default Routers

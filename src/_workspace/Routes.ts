import { Router } from 'express'

import mergePdfRoutes from './routes/merge-pdf/MergePdfRoutes'
import emailSettingsRoutes from './routes/email-settings/EmailSettingsRoutes'

const Routers = Router()

Routers.use('/email-settings', emailSettingsRoutes)
Routers.use('/merge-pdf', mergePdfRoutes)

export default Routers

import { Router } from 'express'

import mergePdfRoutes from './routes/merge-pdf/MergePdfRoutes'
import emailSettingsRoutes from './routes/email-settings/EmailSettingsRoutes'
import settingsRoutes from './routes/settings/SettingsRoutes'

const Routers = Router()

Routers.use('/settings', settingsRoutes)

Routers.use('/email-settings', emailSettingsRoutes)
Routers.use('/merge-pdf', mergePdfRoutes)

export default Routers

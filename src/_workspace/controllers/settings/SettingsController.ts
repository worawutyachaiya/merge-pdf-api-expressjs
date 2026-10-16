import type { Request, Response } from 'express'
import { z } from 'zod'
import { AuditActorError, withAuditActor } from '@src/_workspace/services/merge-pdf/AuditActor'
import { SettingsConflictError, SettingsService } from '@src/_workspace/services/settings/SettingsService'
import { documentOrderFields } from '@src/_workspace/routes/settings/SettingsValidation'

const handle =
  (method: string, mutation = false) =>
  async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const rows = mutation
        ? await withAuditActor(req.body?.UPDATE_BY, () => SettingsService.saveDocumentOrder(documentOrderFields.parse(req.body).order))
        : await SettingsService.documentOrder()
      res.json({ Status: true, Message: 'Success', ResultOnDb: rows, MethodOnDb: method, TotalCountOnDb: rows.length })
    } catch (error) {
      const status = error instanceof AuditActorError ? error.statusCode : error instanceof z.ZodError ? 400 : error instanceof SettingsConflictError ? 409 : 503
      if (status === 503) console.error('Settings operation failed:', method, error instanceof Error ? error.message : 'Unknown error')
      res.status(status).json({
        Status: false,
        Message: status === 503 ? 'Unable to load or save document order. Please try again.' : (error as Error).message,
        ResultOnDb: [],
        MethodOnDb: method,
        TotalCountOnDb: 0,
      })
    }
  }

export const SettingsController = {
  documentOrder: handle('Get document order'),
  saveDocumentOrder: handle('Save document order', true),
}

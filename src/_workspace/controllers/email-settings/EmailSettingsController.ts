import type { Request, Response } from 'express'
import { z } from 'zod'
import { AuditActorError, withAuditActor } from '@src/_workspace/services/merge-pdf/AuditActor'
import { EmailSettingsConfigurationError, EmailSettingsInputError, EmailSettingsService } from '@src/_workspace/services/email-settings/EmailSettingsService'
import { accountingPeopleFields, emailSettingsFields } from '@src/_workspace/routes/email-settings/EmailSettingsValidation'

type Handler = (req: Request) => Promise<unknown>
const handle =
  (method: string, handler: Handler, mutation = false) =>
  async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store')
    try {
      const result = mutation ? await withAuditActor(req.body?.UPDATE_BY, () => handler(req)) : await handler(req)
      const rows = Array.isArray(result) ? result : [result]
      res.json({ Status: true, Message: 'Success', ResultOnDb: rows, MethodOnDb: method, TotalCountOnDb: rows.length })
    } catch (error) {
      const inputError = error instanceof z.ZodError || error instanceof EmailSettingsInputError
      const status = error instanceof AuditActorError ? error.statusCode : inputError ? 400 : 503
      const message =
        inputError || error instanceof AuditActorError || error instanceof EmailSettingsConfigurationError
          ? error.message
          : 'Unable to load or save email settings. Check the database configuration and restart the API after changing env settings.'
      if (!inputError && !(error instanceof AuditActorError)) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'CONFIGURATION_ERROR'
        console.error('Email settings operation failed:', method, code)
      }
      res.status(status).json({ Status: false, Message: message, ResultOnDb: [], MethodOnDb: method, TotalCountOnDb: 0 })
    }
  }

export const EmailSettingsController = {
  detail: handle('Get email settings', () => EmailSettingsService.getSettings()),
  accountingPeople: handle('Search Accounting email recipients', (req) => {
    const { search } = accountingPeopleFields.parse(req.query)
    return EmailSettingsService.searchAccountingPeople(search)
  }),
  save: handle(
    'Save email settings',
    async (req) => {
      const fields = emailSettingsFields.parse(req.body)
      await EmailSettingsService.saveSettings(fields.scheduleTime, fields.employeeCodes)
      return EmailSettingsService.getSettings()
    },
    true
  ),
}

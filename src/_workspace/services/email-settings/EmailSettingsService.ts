import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { EmailSettingsRepository as repo } from '@src/_workspace/sql/email-settings/EmailSettingsRepository'
import type { AccountingPerson, EmailSettings } from '@src/_workspace/types/email-settings/EmailSettings'

export class EmailSettingsInputError extends Error {}
export class EmailSettingsConfigurationError extends Error {}

const databaseError = (scope: string, error: unknown): EmailSettingsConfigurationError => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'CONNECTION_FAILED'
  return new EmailSettingsConfigurationError(`${scope} database is unavailable (${code}). Check the environment configuration.`)
}

export const EmailSettingsService = {
  searchAccountingPeople: async (search: string, employeeCodes?: string[]): Promise<AccountingPerson[]> => {
    const required = ['PERSON_HOST', 'PERSON_USER_NAME', 'PERSON_DB', 'PERSON_PORT']
    const missing = required.filter((key) => !process.env[key]?.trim())
    if (process.env.PERSON_PASSWORD === undefined) missing.push('PERSON_PASSWORD')
    if (missing.length) throw new EmailSettingsConfigurationError(`Missing database configuration: ${missing.join(', ')}`)
    const port = Number(process.env.PERSON_PORT)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new EmailSettingsConfigurationError('PERSON_PORT must be a valid database port')
    const rows = await repo.accountingPeople(search.trim(), employeeCodes).catch((error) => {
      throw databaseError('Person', error)
    })
    return rows
      .map((row) => ({
        employeeCode: String(row.EMPLOYEE_CODE ?? '').trim(),
        name: String(row.EMPLOYEE_NAME ?? '').trim(),
        email: String(row.EMPLOYEE_EMAIL ?? '').trim(),
      }))
      .filter((person) => person.employeeCode && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))
  },
  getSettings: async (): Promise<EmailSettings> => {
    const settings = await repo.settings().catch((error) => {
      throw databaseError('Merge PDF', error)
    })
    const codes = (
      await repo.recipientCodes().catch((error) => {
        throw databaseError('Merge PDF', error)
      })
    ).map((row) => String(row.EMPLOYEE_CODE))
    // Validate the directory connection even if no recipients have been selected yet.
    const people = await EmailSettingsService.searchAccountingPeople('', codes.length ? codes : undefined)
    return { scheduleTime: settings[0]?.SCHEDULE_TIME ?? '17:00', recipients: codes.length ? people : [] }
  },
  saveSettings: async (scheduleTime: string, employeeCodes: string[]): Promise<void> => {
    const actor = getAuditEmployeeCode()
    const codes = [...new Set(employeeCodes.map((code) => code.trim()).filter(Boolean))]
    const people = await EmailSettingsService.searchAccountingPeople('', codes.length ? codes : undefined)
    if (codes.length && people.length !== codes.length) {
      throw new EmailSettingsInputError('Every selected recipient must be an active Accounting employee with a valid email address')
    }
    await repo.saveSettings(scheduleTime, codes, actor)
  },
}

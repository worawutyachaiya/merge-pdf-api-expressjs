import { z } from 'zod'

export const accountingPeopleFields = z.object({ search: z.string().trim().max(100).default('') })
export const emailSettingsFields = z.object({
  scheduleTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  employeeCodes: z.array(z.string().trim().min(1).max(30)).max(100),
})

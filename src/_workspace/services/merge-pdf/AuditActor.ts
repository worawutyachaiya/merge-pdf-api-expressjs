import { AsyncLocalStorage } from 'node:async_hooks'

const actors = new AsyncLocalStorage<string>()

export class AuditActorError extends Error {
  readonly statusCode = 401
}

export const withAuditActor = <T>(employeeCode: unknown, work: () => T): T => {
  if (typeof employeeCode !== 'string' || !employeeCode.trim() || employeeCode.trim().length > 30) {
    throw new AuditActorError('Employee code is missing or invalid. Please sign in again.')
  }
  return actors.run(employeeCode.trim(), work)
}

export const getAuditEmployeeCode = (): string => {
  const actor = actors.getStore()
  if (!actor) throw new AuditActorError('Employee code is required for this operation')
  return actor
}

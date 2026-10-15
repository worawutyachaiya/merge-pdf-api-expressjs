import type { PoolConnection } from 'mysql2/promise'
import { connection } from '@src/businessData/db'
import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { EmailSettingsRepository as repo } from '@src/_workspace/sql/email-settings/EmailSettingsRepository'
import type { DigestRow } from '@src/_workspace/types/email-settings/EmailSettings'
import { EmailSettingsService } from './EmailSettingsService'
import { sendDigestEmail } from './EmailDigestTemplate'

const bangkokClock = (timeZone: string): { date: string; time: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

const createDailyDigest = async (conn: PoolConnection, date: string, scheduleTime: string): Promise<void> => {
  await conn.beginTransaction()
  try {
    const existing = await repo.existingDigest(conn, date, scheduleTime)
    if (existing && existing.STATUS !== 'NO_RECIPIENTS') {
      await conn.commit()
      return
    }
    const queueCount = await repo.queuedItemCount(conn)
    const codes = (await repo.recipientCodes(conn)).map((row) => String(row.EMPLOYEE_CODE))
    const people = queueCount && codes.length ? await EmailSettingsService.searchAccountingPeople('', codes) : []
    const status = queueCount === 0 ? 'SENT' : people.length === 0 ? 'NO_RECIPIENTS' : 'PENDING'
    const digestId = existing?.DIGEST_ID ?? (await repo.insertDigest(conn, date, scheduleTime, status))
    if (status === 'PENDING') await repo.attachDigestItems(conn, digestId, people)
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  }
}

const processPendingDigest = async (conn: PoolConnection, digest: DigestRow): Promise<void> => {
  const items = await repo.digestItems(conn, digest.DIGEST_ID)
  if (!items.length) {
    await repo.cancelEmptyDigest(conn, digest.DIGEST_ID)
    return
  }
  const recipients = await repo.pendingRecipients(conn, digest.DIGEST_ID)
  let errors = 0
  for (const recipient of recipients) {
    let failure: string | null = null
    try {
      await sendDigestEmail(recipient, items, digest.DIGEST_DATE)
    } catch (error) {
      errors++
      failure = error instanceof Error ? error.message.slice(0, 1000) : 'Mail delivery failed'
    }
    // A database error after delivery must stop this run; it is not a mail failure.
    await repo.recordRecipientAttempt(conn, digest.DIGEST_ID, recipient.EMPLOYEE_CODE, failure)
  }
  if (recipients.length) await repo.recordDigestAttempt(conn, digest.DIGEST_ID, errors)
  await repo.finalizeDigest(conn, digest.DIGEST_ID)
}

export const EmailDigestService = {
  enqueuePublishedPublication: (conn: PoolConnection, jobId: number, publicationId: number) => repo.enqueuePublishedPublication(conn, jobId, publicationId, getAuditEmployeeCode()),
  cancelJobQueue: (conn: PoolConnection, jobId: number) => repo.cancelJobQueue(conn, jobId, getAuditEmployeeCode()),
  runDueDigest: async (): Promise<void> => {
    let conn: PoolConnection | undefined
    let locked = false
    let lockName = ''
    try {
      conn = await connection()
      // MySQL advisory locks are scoped to the server, so each database needs its own name.
      lockName = `merge_pdf_mail_${process.env.DB ?? ''}`.slice(0, 64)
      locked = await repo.acquireLock(conn, lockName)
      if (!locked) return
      const setting = (await repo.settings(conn))[0]
      if (!setting) return
      const { date, time } = bangkokClock(setting.TIME_ZONE)
      if (time < setting.SCHEDULE_TIME) return
      await createDailyDigest(conn, date, setting.SCHEDULE_TIME)
      for (const digest of await repo.pendingDigests(conn, date)) await processPendingDigest(conn, digest)
    } catch (error) {
      console.error('Merge PDF daily email digest failed:', error instanceof Error ? error.message : 'Unknown error')
    } finally {
      if (conn) {
        if (locked) await repo.releaseLock(conn, lockName).catch(() => undefined)
        conn.release()
      }
    }
  },
}

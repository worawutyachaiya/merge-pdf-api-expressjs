import { revisionSql } from '@src/_workspace/sql/merge-pdf/RecordRevisionSQL'
import { EmailSettingsSQL } from '@src/_workspace/sql/email-settings/EmailSettingsSQL'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { MySQLExecute } from '@src/businessData/dbExecute'
import { replaceActiveRecords } from '@src/_workspace/services/merge-pdf/RecordRevisionService'
import type { AccountingPerson, SettingRow, RecipientRow, DigestRow, DigestItemRow, DigestRecipientRow } from '@src/_workspace/types/email-settings/EmailSettings'

export const EmailSettingsDataService = {
  accountingPeople: (search: string, employeeCodes?: string[]) => {
    const params: unknown[] = []
    if (employeeCodes?.length) params.push(...employeeCodes)
    if (search) params.push(...Array(4).fill(`%${search}%`))
    return MySQLExecute.queryParams<RowDataPacket[]>(
      EmailSettingsSQL.accountingPeople(search, employeeCodes),
      [...params, employeeCodes?.length ? employeeCodes.length : 50],
      'PERSON'
    )
  },
  settings: async (conn?: PoolConnection) => {
    const sql = EmailSettingsSQL.settings()
    return conn ? (await conn.query<SettingRow[]>(sql))[0] : MySQLExecute.queryParams<SettingRow[]>(sql)
  },
  recipientCodes: async (conn?: PoolConnection) => {
    const sql = EmailSettingsSQL.recipientCodes()
    return conn ? (await conn.query<RecipientRow[]>(sql))[0] : MySQLExecute.queryParams<RecipientRow[]>(sql)
  },
  saveSettings: async (scheduleTime: string, codes: string[], actor: string) => {
    await MySQLExecute.withTransaction(async (conn) => {
      const changed = await replaceActiveRecords(
        conn,
        'MERGE_PDF_EMAIL_SETTING',
        EmailSettingsSQL.whereSetting(),
        [],
        { SCHEDULE_TIME: `${scheduleTime}:00`, TIME_ZONE: 'Asia/Bangkok' },
        actor
      )
      if (!changed) throw new Error('Active email settings not found')
      await conn.execute(EmailSettingsSQL.retireRecipients(), [actor])
      for (const code of codes) {
        await conn.execute(EmailSettingsSQL.insertRecipient(), [code, actor, actor, code])
      }
    })
  },
  enqueuePublishedPublication: async (conn: PoolConnection, jobId: number, publicationId: number, actor: string) => {
    // The shared file is overwritten on edit. Notify its latest saved version only.
    await conn.execute(EmailSettingsSQL.retireSupersededQueue(), [actor, jobId, publicationId])
    await conn.execute(EmailSettingsSQL.enqueuePublishedPublication(), [jobId, actor, actor, publicationId, jobId])
  },
  cancelJobQueue: async (conn: PoolConnection, jobId: number, actor: string) => {
    await conn.execute(EmailSettingsSQL.cancelJobQueue(), [actor, jobId])
  },
  acquireLock: async (conn: PoolConnection, lockName: string) => {
    const [rows] = await conn.query<RowDataPacket[]>(EmailSettingsSQL.acquireLock(), [lockName])
    return Number(rows[0]?.ACQUIRED ?? 0) === 1
  },
  releaseLock: (conn: PoolConnection, lockName: string) => conn.query(EmailSettingsSQL.releaseLock(), [lockName]),
  existingDigest: async (conn: PoolConnection, date: string, scheduleTime: string) => {
    const [rows] = await conn.query<DigestRow[]>(EmailSettingsSQL.existingDigest(), [date, `${scheduleTime}:00`])
    return rows[0]
  },
  queuedItemCount: async (conn: PoolConnection) => {
    const [rows] = await conn.query<RowDataPacket[]>(EmailSettingsSQL.queuedItemCount())
    return Number(rows[0]?.TOTAL ?? 0)
  },
  insertDigest: async (conn: PoolConnection, date: string, scheduleTime: string, status: DigestRow['STATUS']) => {
    const [result] = await conn.execute<ResultSetHeader>(EmailSettingsSQL.insertDigest(), [date, `${scheduleTime}:00`, status, status])
    return result.insertId
  },
  attachDigestItems: async (conn: PoolConnection, digestId: number, people: AccountingPerson[]) => {
    await conn.execute(EmailSettingsSQL.attachDigestItems(), [digestId])
    for (const person of people) {
      await conn.execute(EmailSettingsSQL.insertDigestRecipient(), [digestId, person.employeeCode, person.name, person.email])
    }
    await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', EmailSettingsSQL.whereDigest(), [digestId], { STATUS: 'PENDING' }, 'SYSTEM')
  },
  pendingDigests: async (conn: PoolConnection, date: string) => {
    const [rows] = await conn.query<DigestRow[]>(EmailSettingsSQL.pendingDigests(), [date])
    return rows
  },
  digestItems: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<DigestItemRow[]>(EmailSettingsSQL.digestItems(), [digestId])
    return rows
  },
  pendingRecipients: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<DigestRecipientRow[]>(EmailSettingsSQL.pendingRecipients(), [digestId])
    return rows
  },
  recordRecipientAttempt: async (conn: PoolConnection, digestId: number, employeeCode: string, error: string | null) => {
    await conn.beginTransaction()
    try {
      await replaceActiveRecords(
        conn,
        'MERGE_PDF_EMAIL_DIGEST_RECIPIENT',
        EmailSettingsSQL.wherePendingRecipient(),
        [digestId, employeeCode],
        {
          STATUS: error === null ? 'SENT' : 'PENDING',
          ATTEMPT_COUNT: revisionSql(EmailSettingsSQL.incrementAttempts()),
          LAST_ERROR: error,
          SENT_DATE: error === null ? revisionSql(EmailSettingsSQL.currentTimestamp()) : null,
        },
        'SYSTEM'
      )
      await conn.commit()
    } catch (failure) {
      await conn.rollback()
      throw failure
    }
  },
  recordDigestAttempt: async (conn: PoolConnection, digestId: number, errors: number) => {
    await conn.beginTransaction()
    try {
      const changes = { ATTEMPT_COUNT: revisionSql(EmailSettingsSQL.incrementAttempts()), LAST_ERROR: errors === 0 ? null : 'One or more recipient emails failed' }
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', EmailSettingsSQL.whereDigest(), [digestId], changes, 'SYSTEM')
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_QUEUE', EmailSettingsSQL.whereDigestQueue(), [digestId], changes, 'SYSTEM')
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
  finalizeDigest: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<RowDataPacket[]>(EmailSettingsSQL.recipientDeliveryCounts(), [digestId])
    if (Number(rows[0]?.TOTAL ?? 0) === 0 || Number(rows[0]?.PENDING ?? 0) !== 0) return
    await conn.beginTransaction()
    try {
      const changes = { STATUS: 'SENT', SENT_DATE: revisionSql(EmailSettingsSQL.currentTimestamp()), LAST_ERROR: null }
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', EmailSettingsSQL.whereDigest(), [digestId], changes, 'SYSTEM')
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_QUEUE', EmailSettingsSQL.whereDigestQueue(), [digestId], changes, 'SYSTEM')
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
  cancelEmptyDigest: async (conn: PoolConnection, digestId: number) => {
    await conn.beginTransaction()
    try {
      await conn.execute(EmailSettingsSQL.retireDigest(), [digestId])
      await conn.execute(EmailSettingsSQL.retireDigestItems(), [digestId])
      await conn.execute(EmailSettingsSQL.retireDigestRecipients(), [digestId])
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
}

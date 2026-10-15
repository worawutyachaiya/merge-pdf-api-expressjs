import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { MySQLExecute } from '@src/businessData/dbExecute'
import { replaceActiveRecords, revisionSql } from '@src/_workspace/sql/merge-pdf/RecordRevision'
import type { AccountingPerson, SettingRow, RecipientRow, DigestRow, DigestItemRow, DigestRecipientRow } from '@src/_workspace/types/email-settings/EmailSettings'

const eligibleQueue = `FROM MERGE_PDF_EMAIL_QUEUE Q
  JOIN MERGE_PDF_JOB J ON J.JOB_ID = Q.JOB_ID AND J.INUSE = 1
  JOIN MERGE_PDF_PUBLICATION P ON P.PUBLICATION_ID = Q.PUBLICATION_ID AND P.INUSE = 1 AND P.STATUS = 'PUBLISHED'
  WHERE Q.INUSE = 1 AND Q.STATUS = 'PENDING' AND P.NETWORK_PATH IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM MERGE_PDF_EMAIL_DIGEST_ITEM I WHERE I.QUEUE_ID = Q.QUEUE_ID)`

export const EmailSettingsRepository = {
  accountingPeople: (search: string, employeeCodes?: string[]) => {
    const codeCondition = employeeCodes?.length ? `AND CAST(empCode AS CHAR) IN (${employeeCodes.map(() => '?').join(',')})` : ''
    const searchCondition = search ? 'AND (empCode LIKE ? OR empName LIKE ? OR empSurname LIKE ? OR empEmail LIKE ?)' : ''
    const params: unknown[] = []
    if (employeeCodes?.length) params.push(...employeeCodes)
    if (search) params.push(...Array(4).fill(`%${search}%`))
    return MySQLExecute.queryParams<RowDataPacket[]>(
      `SELECT CAST(empCode AS CHAR) AS EMPLOYEE_CODE,
        TRIM(CONCAT(COALESCE(empName, ''), ' ', COALESCE(empSurname, ''))) AS EMPLOYEE_NAME,
        TRIM(empEmail) AS EMPLOYEE_EMAIL
       FROM MEMBER_FED
       WHERE UPPER(TRIM(empDept)) = 'ACCOUNTING'
         AND (empCode_resign IS NULL OR UPPER(TRIM(empCode_resign)) <> 'RESIGNED')
         AND TRIM(COALESCE(empEmail, '')) <> ''
         ${codeCondition} ${searchCondition}
       ORDER BY empName, empSurname, empCode LIMIT ?`,
      [...params, employeeCodes?.length ? employeeCodes.length : 50],
      'PERSON'
    )
  },
  settings: async (conn?: PoolConnection) => {
    const sql = "SELECT TIME_FORMAT(SCHEDULE_TIME, '%H:%i') AS SCHEDULE_TIME, TIME_ZONE FROM MERGE_PDF_EMAIL_SETTING WHERE SETTING_ID = 1 AND INUSE = 1"
    return conn ? (await conn.query<SettingRow[]>(sql))[0] : MySQLExecute.queryParams<SettingRow[]>(sql)
  },
  recipientCodes: async (conn?: PoolConnection) => {
    const sql = 'SELECT EMPLOYEE_CODE FROM MERGE_PDF_EMAIL_RECIPIENT WHERE INUSE = 1 ORDER BY EMPLOYEE_CODE'
    return conn ? (await conn.query<RecipientRow[]>(sql))[0] : MySQLExecute.queryParams<RecipientRow[]>(sql)
  },
  saveSettings: async (scheduleTime: string, codes: string[], actor: string) => {
    await MySQLExecute.withTransaction(async (conn) => {
      const changed = await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_SETTING', 'SETTING_ID = 1', [], { SCHEDULE_TIME: `${scheduleTime}:00`, TIME_ZONE: 'Asia/Bangkok' }, actor)
      if (!changed) throw new Error('Active email settings not found')
      await conn.execute('UPDATE MERGE_PDF_EMAIL_RECIPIENT SET INUSE = 0, UPDATE_BY = ? WHERE INUSE = 1', [actor])
      for (const code of codes) {
        await conn.execute(
          `INSERT INTO MERGE_PDF_EMAIL_RECIPIENT (EMPLOYEE_CODE, REVISION_NO, CREATE_BY, UPDATE_BY)
           SELECT ?, COALESCE(MAX(REVISION_NO), 0) + 1, ?, ? FROM MERGE_PDF_EMAIL_RECIPIENT WHERE EMPLOYEE_CODE = ?`,
          [code, actor, actor, code]
        )
      }
    })
  },
  enqueuePublishedPublication: async (conn: PoolConnection, jobId: number, publicationId: number, actor: string) => {
    // The shared file is overwritten on edit. Notify its latest saved version only.
    await conn.execute("UPDATE MERGE_PDF_EMAIL_QUEUE SET INUSE = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND PUBLICATION_ID <> ? AND STATUS = 'PENDING' AND INUSE = 1", [
      actor,
      jobId,
      publicationId,
    ])
    await conn.execute(
      `INSERT INTO MERGE_PDF_EMAIL_QUEUE (JOB_ID, PUBLICATION_ID, CREATE_BY, UPDATE_BY)
       SELECT ?, PUBLICATION_ID, ?, ? FROM MERGE_PDF_PUBLICATION
       WHERE PUBLICATION_ID = ? AND JOB_ID = ? AND STATUS = 'PUBLISHED' AND INUSE = 1 AND NETWORK_PATH IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM MERGE_PDF_EMAIL_QUEUE Q WHERE Q.PUBLICATION_ID = MERGE_PDF_PUBLICATION.PUBLICATION_ID)`,
      [jobId, actor, actor, publicationId, jobId]
    )
  },
  cancelJobQueue: async (conn: PoolConnection, jobId: number, actor: string) => {
    await conn.execute('UPDATE MERGE_PDF_EMAIL_QUEUE SET INUSE = 0, UPDATE_BY = ? WHERE JOB_ID = ? AND INUSE = 1', [actor, jobId])
  },
  acquireLock: async (conn: PoolConnection, lockName: string) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS ACQUIRED', [lockName])
    return Number(rows[0]?.ACQUIRED ?? 0) === 1
  },
  releaseLock: (conn: PoolConnection, lockName: string) => conn.query('SELECT RELEASE_LOCK(?)', [lockName]),
  existingDigest: async (conn: PoolConnection, date: string, scheduleTime: string) => {
    const [rows] = await conn.query<DigestRow[]>('SELECT DIGEST_ID, STATUS FROM MERGE_PDF_EMAIL_DIGEST WHERE DIGEST_DATE = ? AND SCHEDULE_TIME = ? AND INUSE = 1 FOR UPDATE', [
      date,
      `${scheduleTime}:00`,
    ])
    return rows[0]
  },
  queuedItemCount: async (conn: PoolConnection) => {
    const [rows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS TOTAL ${eligibleQueue}`)
    return Number(rows[0]?.TOTAL ?? 0)
  },
  insertDigest: async (conn: PoolConnection, date: string, scheduleTime: string, status: DigestRow['STATUS']) => {
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO MERGE_PDF_EMAIL_DIGEST (DIGEST_DATE, SCHEDULE_TIME, STATUS, SENT_DATE, CREATE_BY, UPDATE_BY)
       VALUES (?, ?, ?, IF(? = 'SENT', CURRENT_TIMESTAMP(3), NULL), 'SYSTEM', 'SYSTEM')`,
      [date, `${scheduleTime}:00`, status, status]
    )
    return result.insertId
  },
  attachDigestItems: async (conn: PoolConnection, digestId: number, people: AccountingPerson[]) => {
    await conn.execute(
      `INSERT INTO MERGE_PDF_EMAIL_DIGEST_ITEM (DIGEST_ID, QUEUE_ID, CREATE_BY, UPDATE_BY)
       SELECT ?, Q.QUEUE_ID, 'SYSTEM', 'SYSTEM' ${eligibleQueue} ORDER BY Q.QUEUE_ID`,
      [digestId]
    )
    for (const person of people) {
      await conn.execute(
        `INSERT INTO MERGE_PDF_EMAIL_DIGEST_RECIPIENT (DIGEST_ID, EMPLOYEE_CODE, RECIPIENT_NAME, RECIPIENT_EMAIL, CREATE_BY, UPDATE_BY)
         VALUES (?, ?, ?, ?, 'SYSTEM', 'SYSTEM')`,
        [digestId, person.employeeCode, person.name, person.email]
      )
    }
    await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', 'DIGEST_ID = ?', [digestId], { STATUS: 'PENDING' }, 'SYSTEM')
  },
  pendingDigests: async (conn: PoolConnection, date: string) => {
    const [rows] = await conn.query<DigestRow[]>(
      `SELECT DIGEST_ID, DATE_FORMAT(DIGEST_DATE, '%Y-%m-%d') AS DIGEST_DATE, STATUS
       FROM MERGE_PDF_EMAIL_DIGEST WHERE DIGEST_DATE <= ? AND STATUS = 'PENDING' AND INUSE = 1 ORDER BY DIGEST_DATE`,
      [date]
    )
    return rows
  },
  digestItems: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<DigestItemRow[]>(
      `SELECT J.JOB_CODE, P.OUTPUT_FILE_NAME, P.PUBLISHED_AT, P.NETWORK_PATH FROM MERGE_PDF_EMAIL_DIGEST_ITEM I
       JOIN MERGE_PDF_EMAIL_QUEUE Q ON Q.QUEUE_ID = I.QUEUE_ID AND Q.INUSE = 1
       JOIN MERGE_PDF_PUBLICATION P ON P.PUBLICATION_ID = Q.PUBLICATION_ID AND P.INUSE = 1
       JOIN MERGE_PDF_JOB J ON J.JOB_ID = Q.JOB_ID AND J.INUSE = 1
       WHERE I.DIGEST_ID = ? AND I.INUSE = 1 AND P.STATUS = 'PUBLISHED' AND P.NETWORK_PATH IS NOT NULL ORDER BY Q.QUEUE_ID`,
      [digestId]
    )
    return rows
  },
  pendingRecipients: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<DigestRecipientRow[]>(
      `SELECT EMPLOYEE_CODE, RECIPIENT_NAME, RECIPIENT_EMAIL FROM MERGE_PDF_EMAIL_DIGEST_RECIPIENT
       WHERE DIGEST_ID = ? AND STATUS = 'PENDING' AND INUSE = 1 ORDER BY EMPLOYEE_CODE`,
      [digestId]
    )
    return rows
  },
  recordRecipientAttempt: async (conn: PoolConnection, digestId: number, employeeCode: string, error: string | null) => {
    await conn.beginTransaction()
    try {
      await replaceActiveRecords(
        conn,
        'MERGE_PDF_EMAIL_DIGEST_RECIPIENT',
        "DIGEST_ID = ? AND EMPLOYEE_CODE = ? AND STATUS = 'PENDING'",
        [digestId, employeeCode],
        {
          STATUS: error === null ? 'SENT' : 'PENDING',
          ATTEMPT_COUNT: revisionSql('ATTEMPT_COUNT + 1'),
          LAST_ERROR: error,
          SENT_DATE: error === null ? revisionSql('CURRENT_TIMESTAMP(3)') : null,
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
      const changes = { ATTEMPT_COUNT: revisionSql('ATTEMPT_COUNT + 1'), LAST_ERROR: errors === 0 ? null : 'One or more recipient emails failed' }
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', 'DIGEST_ID = ?', [digestId], changes, 'SYSTEM')
      await replaceActiveRecords(
        conn,
        'MERGE_PDF_EMAIL_QUEUE',
        'QUEUE_ID IN (SELECT QUEUE_ID FROM MERGE_PDF_EMAIL_DIGEST_ITEM WHERE DIGEST_ID = ? AND INUSE = 1)',
        [digestId],
        changes,
        'SYSTEM'
      )
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
  finalizeDigest: async (conn: PoolConnection, digestId: number) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS TOTAL, SUM(CASE WHEN STATUS = 'PENDING' THEN 1 ELSE 0 END) AS PENDING
       FROM MERGE_PDF_EMAIL_DIGEST_RECIPIENT WHERE DIGEST_ID = ? AND INUSE = 1`,
      [digestId]
    )
    if (Number(rows[0]?.TOTAL ?? 0) === 0 || Number(rows[0]?.PENDING ?? 0) !== 0) return
    await conn.beginTransaction()
    try {
      const changes = { STATUS: 'SENT', SENT_DATE: revisionSql('CURRENT_TIMESTAMP(3)'), LAST_ERROR: null }
      await replaceActiveRecords(conn, 'MERGE_PDF_EMAIL_DIGEST', 'DIGEST_ID = ?', [digestId], changes, 'SYSTEM')
      await replaceActiveRecords(
        conn,
        'MERGE_PDF_EMAIL_QUEUE',
        'QUEUE_ID IN (SELECT QUEUE_ID FROM MERGE_PDF_EMAIL_DIGEST_ITEM WHERE DIGEST_ID = ? AND INUSE = 1)',
        [digestId],
        changes,
        'SYSTEM'
      )
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
  cancelEmptyDigest: async (conn: PoolConnection, digestId: number) => {
    await conn.beginTransaction()
    try {
      await conn.execute("UPDATE MERGE_PDF_EMAIL_DIGEST SET INUSE = 0, UPDATE_BY = 'SYSTEM' WHERE DIGEST_ID = ? AND INUSE = 1", [digestId])
      await conn.execute("UPDATE MERGE_PDF_EMAIL_DIGEST_ITEM SET INUSE = 0, UPDATE_BY = 'SYSTEM' WHERE DIGEST_ID = ? AND INUSE = 1", [digestId])
      await conn.execute("UPDATE MERGE_PDF_EMAIL_DIGEST_RECIPIENT SET INUSE = 0, UPDATE_BY = 'SYSTEM' WHERE DIGEST_ID = ? AND INUSE = 1", [digestId])
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    }
  },
}

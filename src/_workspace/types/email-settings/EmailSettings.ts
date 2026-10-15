import type { RowDataPacket } from 'mysql2/promise'

export interface AccountingPerson {
  employeeCode: string
  name: string
  email: string
}

export interface EmailSettings {
  revisionNo: number
  scheduleTime: string
  recipients: AccountingPerson[]
}

export interface SettingRow extends RowDataPacket {
  REVISION_NO: number
  SCHEDULE_TIME: string
  TIME_ZONE: string
}

export interface RecipientRow extends RowDataPacket {
  EMPLOYEE_CODE: string
}

export interface DigestRow extends RowDataPacket {
  DIGEST_ID: number
  DIGEST_DATE: string
  STATUS: 'PENDING' | 'SENT' | 'NO_RECIPIENTS'
}

export interface DigestRecipientRow extends RowDataPacket {
  EMPLOYEE_CODE: string
  RECIPIENT_NAME: string
  RECIPIENT_EMAIL: string
}

export interface DigestItemRow extends RowDataPacket {
  JOB_CODE: string
  OUTPUT_FILE_NAME: string
  PUBLISHED_AT: Date | string
  NETWORK_PATH: string
}

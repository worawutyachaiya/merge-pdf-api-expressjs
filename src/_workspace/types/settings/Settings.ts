import type { RowDataPacket } from 'mysql2/promise'

export interface DocumentOrderRow extends RowDataPacket {
  CATEGORY_ID: number
  CATEGORY_NAME: string
  SORT_ORDER: number
  REVISION_NO: number
  IS_ENABLED: number
  REQUIRED_FOR_COMPLETE: number
}

export type DocumentOrderItem =
  | { categoryId: number; revisionNo: number; name?: string; enabled?: boolean }
  | { categoryId: null; name: string; enabled: true }

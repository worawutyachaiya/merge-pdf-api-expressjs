import type { RowDataPacket } from 'mysql2/promise'

export interface DocumentOrderRow extends RowDataPacket {
  CATEGORY_ID: number
  CATEGORY_NAME: string
  SORT_ORDER: number
  REVISION_NO: number
}

export interface DocumentOrderItem {
  categoryId: number
  revisionNo: number
}

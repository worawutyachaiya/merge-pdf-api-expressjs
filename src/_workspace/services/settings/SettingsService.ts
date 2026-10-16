import { MySQLExecute } from '@src/businessData/dbExecute'
import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { replaceActiveRecords } from '@src/_workspace/services/merge-pdf/RecordRevisionService'
import { revisionSql } from '@src/_workspace/sql/merge-pdf/RecordRevisionSQL'
import { SettingsSQL } from '@src/_workspace/sql/settings/SettingsSQL'
import type { DocumentOrderItem, DocumentOrderRow } from '@src/_workspace/types/settings/Settings'

export class SettingsConflictError extends Error {}

export const SettingsService = {
  documentOrder: (): Promise<DocumentOrderRow[]> => MySQLExecute.queryParams<DocumentOrderRow[]>(SettingsSQL.documentOrder()),
  saveDocumentOrder: async (order: DocumentOrderItem[]): Promise<DocumentOrderRow[]> => {
    const actor = getAuditEmployeeCode()
    return MySQLExecute.withTransaction(async (conn) => {
      const [current] = await conn.query<DocumentOrderRow[]>(SettingsSQL.documentOrder(true))
      const byId = new Map(current.map((row) => [row.CATEGORY_ID, row]))
      if (
        current.length !== order.length ||
        new Set(order.map((item) => item.categoryId)).size !== order.length ||
        order.some((item) => byId.get(item.categoryId)?.REVISION_NO !== item.revisionNo)
      ) {
        throw new SettingsConflictError('Document order has changed. Reload the settings and try again.')
      }
      if (order.some((item, index) => byId.get(item.categoryId)!.SORT_ORDER !== index + 1)) {
        // Retire all categories together before replacing them; swaps must not
        // violate the unique current SORT_ORDER or overwrite the previous order.
        await replaceActiveRecords(
          conn,
          'MERGE_PDF_CATEGORY',
          SettingsSQL.whereCategories(order.length),
          order.map((item) => item.categoryId),
          { SORT_ORDER: revisionSql(SettingsSQL.categoryOrder(order.length), ...order.flatMap((item, index) => [item.categoryId, index + 1])) },
          actor
        )
      }
      const [saved] = await conn.query<DocumentOrderRow[]>(SettingsSQL.documentOrder())
      return saved
    })
  },
}

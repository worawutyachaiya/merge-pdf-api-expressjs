import { MySQLExecute } from '@src/businessData/dbExecute'
import { getAuditEmployeeCode } from '@src/_workspace/services/merge-pdf/AuditActor'
import { replaceActiveRecords } from '@src/_workspace/services/merge-pdf/RecordRevisionService'
import { revisionSql } from '@src/_workspace/sql/merge-pdf/RecordRevisionSQL'
import { SettingsSQL } from '@src/_workspace/sql/settings/SettingsSQL'
import type { DocumentOrderItem, DocumentOrderRow } from '@src/_workspace/types/settings/Settings'
import { z } from 'zod'

export class SettingsConflictError extends Error {}

export const SettingsService = {
  documentOrder: (): Promise<DocumentOrderRow[]> => MySQLExecute.queryParams<DocumentOrderRow[]>(SettingsSQL.documentOrder()),
  saveDocumentOrder: async (order: DocumentOrderItem[]): Promise<DocumentOrderRow[]> => {
    const actor = getAuditEmployeeCode()
    return MySQLExecute.withTransaction(async (conn) => {
      const [current] = await conn.query<DocumentOrderRow[]>(SettingsSQL.documentOrder(true))
      const byId = new Map(current.map((row) => [row.CATEGORY_ID, row]))
      const existing = order.filter((item): item is Extract<DocumentOrderItem, { categoryId: number }> => item.categoryId !== null)
      if (
        current.length !== existing.length ||
        new Set(existing.map((item) => item.categoryId)).size !== existing.length ||
        existing.some((item) => byId.get(item.categoryId)?.REVISION_NO !== item.revisionNo)
      ) {
        throw new SettingsConflictError('Document order has changed. Reload the settings and try again.')
      }
      const categories = order.map((item) => {
        if (item.categoryId === null) return item
        const saved = byId.get(item.categoryId)!
        return { ...item, name: item.name ?? saved.CATEGORY_NAME, enabled: item.enabled ?? saved.IS_ENABLED === 1 }
      })
      const issue = (message: string) => new z.ZodError([{ code: 'custom', path: ['order'], message }])
      if (!categories.find((item) => item.categoryId === 10)?.enabled) throw issue('The fallback document type must stay enabled')
      const names = categories.filter((item) => item.enabled).map((item) => item.name.toLowerCase())
      if (new Set(names).size !== names.length) throw issue('Enabled document types must have different names')
      const sorted = [...categories.filter((item) => item.enabled), ...categories.filter((item) => !item.enabled)]
      const withPositions = sorted.map((item, index) => ({ ...item, position: index + 1 }))
      const updated = withPositions.filter((item) => item.categoryId !== null)
      let nextId = Math.max(0, ...byId.keys()) + 1
      if (nextId + order.length - existing.length - 1 > 255) throw issue('The document type limit has been reached')
      if (updated.some((item) => {
        const row = byId.get(item.categoryId!)!
        return row.SORT_ORDER !== item.position || row.CATEGORY_NAME !== item.name || row.IS_ENABLED !== Number(item.enabled)
      })) {
        const valueByCategory = (value: (item: (typeof updated)[number]) => unknown) =>
          revisionSql(SettingsSQL.categoryValues(updated.length), ...updated.flatMap((item) => [item.categoryId, value(item)]))
        await replaceActiveRecords(
          conn,
          'MERGE_PDF_CATEGORY',
          SettingsSQL.whereCategories(updated.length),
          updated.map((item) => item.categoryId),
          {
            SORT_ORDER: valueByCategory((item) => item.position),
            CATEGORY_NAME: valueByCategory((item) => item.name),
            IS_ENABLED: valueByCategory((item) => Number(item.enabled)),
          },
          actor
        )
      }
      for (const item of withPositions) {
        if (item.categoryId !== null) continue
        const id = nextId++
        await conn.query(SettingsSQL.insertCategory(), [id, `CUSTOM_${id}`, item.name, item.position, actor, actor])
      }
      const [saved] = await conn.query<DocumentOrderRow[]>(SettingsSQL.documentOrder())
      return saved
    })
  },
}

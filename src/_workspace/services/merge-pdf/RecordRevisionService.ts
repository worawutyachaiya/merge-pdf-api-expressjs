import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { RecordRevisionSQL, type RevisionTable } from '@src/_workspace/sql/merge-pdf/RecordRevisionSQL'

// The caller owns the transaction and entity lock. Retire the selected group
// before inserting replacements so swaps preserve both history and uniqueness.
export const replaceActiveRecords = async (
  conn: PoolConnection,
  table: RevisionTable,
  where: string,
  params: readonly unknown[],
  changes: Record<string, unknown>,
  actor: string
): Promise<number> => {
  const [rows] = await conn.query<RowDataPacket[]>(RecordRevisionSQL.selectActive(table, where, changes), [...params])
  if (!rows.length) return 0
  const retire = RecordRevisionSQL.retire(table, rows, actor)
  await conn.query(retire.sql, retire.params)
  const replacement = RecordRevisionSQL.insertReplacement(table, rows, changes, actor)
  await conn.query(replacement.sql, replacement.params)
  return rows.length
}

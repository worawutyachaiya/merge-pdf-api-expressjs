import { MySQLExecute } from '@businessData/dbExecute'
import getSqlWhere_elysia from '@src/helpers/getSqlWhere_elysia'
import { HsCodeSQL } from '@src/_workspace/sql/trade-compliance/hs-code/HsCodeSQL'
import mysql, { RowDataPacket } from 'mysql2'

export const HsCodeService = {
  search: async (dataItem: any) => {
    const tableIds = [
      { table: 'hs', id: 'HS_CODE_ID', Fns: '=' },
      { table: 'hs', id: 'INUSE', Fns: '=' },
      { table: 'hs', id: 'HS_CODE', Fns: 'LIKE' },
      { table: 'hs', id: 'CREATE_DATE', Fns: '=' },
      { table: 'hs', id: 'CREATE_BY', Fns: 'LIKE' },
      { table: 'hs', id: 'UPDATE_DATE', Fns: '=' },
      { table: 'hs', id: 'UPDATE_BY', Fns: 'LIKE' },
    ]

    const rawStatus = dataItem.SearchFilters.find((filter: any) => filter?.id === 'STATUS')?.value
    const status = Number(rawStatus)
    const hasStatus = rawStatus !== '' && rawStatus !== null && rawStatus !== undefined && (status === 0 || status === 1)
    const includingCancelled = Boolean(dataItem.SearchFilters.find((filter: any) => filter?.id === 'INCLUDING_CANCELLED')?.value)

    getSqlWhere_elysia(dataItem, tableIds, 'HS_CODE')

    if (hasStatus) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ` AND hs.INUSE = ${mysql.escape(status)}` : ` WHERE hs.INUSE = ${mysql.escape(status)}`
    } else if (!includingCancelled) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ' AND hs.INUSE = 1' : ' WHERE hs.INUSE = 1'
    }

    dataItem.sqlLimit = `LIMIT ${dataItem.Start}, ${dataItem.Limit}`

    const sql = await HsCodeSQL.search(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
  getEccnRelationsByHsCodeId: async (hsCodeId: number) => {
    const sql = HsCodeSQL.getEccnRelationsByHsCodeId(hsCodeId)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
}

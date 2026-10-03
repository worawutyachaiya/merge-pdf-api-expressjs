import { MySQLExecute } from '@businessData/dbExecute'
import getSqlWhere_elysia from '@src/helpers/getSqlWhere_elysia'
import { EccnSQL } from '@src/_workspace/sql/trade-compliance/eccn/EccnSQL'
import mysql, { RowDataPacket } from 'mysql2'

export const EccnService = {
  search: async (dataItem: any) => {
    const tableIds = [
      { table: 'eccn', id: 'ECCN_ID', Fns: '=' },
      { table: 'eccn', id: 'INUSE', Fns: '=' },
      { table: 'eccn', id: 'ECCN_CODE', Fns: 'LIKE' },
      { table: 'eccn', id: 'ECCN_SUB_CODE', Fns: 'LIKE' },
      { table: 'eccn', id: 'ECCN_FULL_CODE', Fns: 'LIKE' },
      { table: 'eccn', id: 'CREATE_DATE', Fns: '=' },
      { table: 'eccn', id: 'CREATE_BY', Fns: 'LIKE' },
      { table: 'eccn', id: 'UPDATE_DATE', Fns: '=' },
      { table: 'eccn', id: 'UPDATE_BY', Fns: 'LIKE' },
    ]

    const rawStatus = dataItem.SearchFilters.find((filter: any) => filter?.id === 'STATUS')?.value
    const status = Number(rawStatus)
    const hasStatus = rawStatus !== '' && rawStatus !== null && rawStatus !== undefined && (status === 0 || status === 1)
    const includingCancelled = Boolean(dataItem.SearchFilters.find((filter: any) => filter?.id === 'INCLUDING_CANCELLED')?.value)

    getSqlWhere_elysia(dataItem, tableIds, 'ECCN_FULL_CODE')

    if (hasStatus) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ` AND eccn.INUSE = ${mysql.escape(status)}` : ` WHERE eccn.INUSE = ${mysql.escape(status)}`
    } else if (!includingCancelled) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ' AND eccn.INUSE = 1' : ' WHERE eccn.INUSE = 1'
    }

    dataItem.sqlLimit = `LIMIT ${dataItem.Start}, ${dataItem.Limit}`

    const sql = await EccnSQL.search(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
  getHsCodeRelationsByEccnId: async (eccnId: number) => {
    const sql = EccnSQL.getHsCodeRelationsByEccnId(eccnId)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
}

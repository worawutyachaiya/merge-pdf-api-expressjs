import { MySQLExecute } from '@businessData/dbExecute'
import getSqlWhere_elysia from '@src/helpers/getSqlWhere_elysia'
import { EarStatusSQL } from '@src/_workspace/sql/trade-compliance/ear-status/EarStatusSQL'
import mysql, { RowDataPacket } from 'mysql2'

export const EarStatusService = {
  search: async (dataItem: any) => {
    const tableIds = [
      { table: 'status', id: 'EAR_SURVEY_STATUS_ID', Fns: '=' },
      { table: 'status', id: 'INUSE', Fns: '=' },
      { table: 'status', id: 'EAR_SURVEY_STATUS_CODE', Fns: 'LIKE' },
      { table: 'status', id: 'EAR_SURVEY_STATUS_NAME', Fns: 'LIKE' },
      { table: 'status', id: 'CREATE_DATE', Fns: '=' },
      { table: 'status', id: 'CREATE_BY', Fns: 'LIKE' },
      { table: 'status', id: 'UPDATE_DATE', Fns: '=' },
      { table: 'status', id: 'UPDATE_BY', Fns: 'LIKE' },
    ]

    const rawStatus = dataItem.SearchFilters.find((filter: any) => filter?.id === 'STATUS')?.value
    const status = Number(rawStatus)
    const hasStatus = rawStatus !== '' && rawStatus !== null && rawStatus !== undefined && (status === 0 || status === 1)
    const includingCancelled = Boolean(dataItem.SearchFilters.find((filter: any) => filter?.id === 'INCLUDING_CANCELLED')?.value)

    getSqlWhere_elysia(dataItem, tableIds, 'EAR_SURVEY_STATUS_ID')

    if (hasStatus) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ` AND status.INUSE = ${mysql.escape(status)}` : ` WHERE status.INUSE = ${mysql.escape(status)}`
    } else if (!includingCancelled) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ' AND status.INUSE = 1' : ' WHERE status.INUSE = 1'
    }

    dataItem.sqlLimit = `LIMIT ${dataItem.Start}, ${dataItem.Limit}`

    const sql = await EarStatusSQL.search(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
}

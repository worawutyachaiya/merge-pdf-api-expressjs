import mysql, { RowDataPacket } from 'mysql2'

import { MySQLExecute } from '@businessData/dbExecute'
import getSqlWhere_elysia from '@src/helpers/getSqlWhere_elysia'
import { FecEccnSQL } from '@src/_workspace/sql/trade-compliance/fec-eccn/FecEccnSQL'

const FEC_COLUMN_MAP: Record<string, string> = {
  FEC_ECCN_CODE: 'ECCN_CODE',
  FEC_ECCN_SUB_CODE: 'ECCN_SUB_CODE',
  FEC_ECCN_FULL_CODE: 'ECCN_FULL_CODE'
}

const responseFailed = (message: string, methodOnDb: string) => ({
  Status: false,
  Message: message,
  ResultOnDb: [],
  MethodOnDb: methodOnDb,
  TotalCountOnDb: 0
})

const mapFecColumns = (dataItem: any) => {
  const mapFilter = (filter: any) => ({ ...filter, id: FEC_COLUMN_MAP[filter?.id] ?? filter?.id })

  dataItem.SearchFilters = dataItem.SearchFilters.map(mapFilter)
  dataItem.ColumnFilters = dataItem.ColumnFilters.map(mapFilter)
  dataItem.Order = dataItem.Order.map((item: any) => ({ ...item, id: FEC_COLUMN_MAP[item?.id] ?? item?.id }))
}

const normalizeFecEccn = (dataItem: any) => {
  const fullCode = String(dataItem?.FEC_ECCN_FULL_CODE ?? dataItem?.ECCN_FULL_CODE ?? '').trim()
  if (!fullCode) return null

  const separatorIndex = fullCode.indexOf('.')

  return {
    ...dataItem,
    ECCN_CODE: separatorIndex > 0 ? fullCode.slice(0, separatorIndex) : fullCode,
    ECCN_SUB_CODE: separatorIndex > 0 ? fullCode.slice(separatorIndex + 1) || null : null,
    ECCN_FULL_CODE: fullCode
  }
}

const getExistingById = async (dataItem: any) => {
  const result = (await MySQLExecute.search(await FecEccnSQL.getById(dataItem))) as RowDataPacket[]
  return result[0]
}

const ensureEccn = async (dataItem: any) => {
  const existing = (await MySQLExecute.search(await FecEccnSQL.getEccnByFullCode(dataItem))) as RowDataPacket[]
  if (existing.length > 0) {
    if (Number(existing[0].INUSE) !== 1) {
      await MySQLExecute.execute(await FecEccnSQL.reactivateEccn({ ...dataItem, ECCN_ID: existing[0].ECCN_ID }))
    }
    return Number(existing[0].ECCN_ID)
  }

  const result = (await MySQLExecute.execute(await FecEccnSQL.createEccn(dataItem))) as any
  return Number(result.insertId)
}

export const FecEccnService = {
  search: async (dataItem: any) => {
    const tableIds = [
      { table: 'fecEccn', id: 'ECCN_FEC_ID', Fns: '=' },
      { table: 'fecEccn', id: 'INUSE', Fns: '=' },
      { table: 'eccn', id: 'ECCN_CODE', Fns: 'LIKE' },
      { table: 'eccn', id: 'ECCN_SUB_CODE', Fns: 'LIKE' },
      { table: 'eccn', id: 'ECCN_FULL_CODE', Fns: 'LIKE' },
      { table: 'fecEccn', id: 'CREATE_DATE', Fns: '=' },
      { table: 'fecEccn', id: 'CREATE_BY', Fns: 'LIKE' },
      { table: 'fecEccn', id: 'UPDATE_DATE', Fns: '=' },
      { table: 'fecEccn', id: 'UPDATE_BY', Fns: 'LIKE' },
    ]

    mapFecColumns(dataItem)

    const rawStatus = dataItem.SearchFilters.find((filter: any) => filter?.id === 'STATUS')?.value
    const status = Number(rawStatus)
    const hasStatus = rawStatus !== '' && rawStatus !== null && rawStatus !== undefined && (status === 0 || status === 1)
    const includingCancelled = Boolean(dataItem.SearchFilters.find((filter: any) => filter?.id === 'INCLUDING_CANCELLED')?.value)

    getSqlWhere_elysia(dataItem, tableIds, 'ECCN_FULL_CODE')

    if (hasStatus) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE')
        ? ` AND fecEccn.INUSE = ${mysql.escape(status)}`
        : ` WHERE fecEccn.INUSE = ${mysql.escape(status)}`
    } else if (!includingCancelled) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ' AND fecEccn.INUSE = 1' : ' WHERE fecEccn.INUSE = 1'
    }

    dataItem.sqlLimit = `LIMIT ${dataItem.Start}, ${dataItem.Limit}`

    const sql = await FecEccnSQL.search(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },

  create: async (dataItem: any) => {
    const normalizedDataItem = normalizeFecEccn(dataItem)
    if (!normalizedDataItem) return responseFailed('FEC ECCN Full Code is required', 'Insert FEC ECCN Failed')

    const duplicate = (await MySQLExecute.search(await FecEccnSQL.getByFullCode(normalizedDataItem))) as RowDataPacket[]
    if (duplicate.length > 0) {
      return responseFailed('Duplicate FEC ECCN Full Code', 'Insert FEC ECCN Failed')
    }

    normalizedDataItem.ECCN_ID = await ensureEccn(normalizedDataItem)
    const result = (await MySQLExecute.execute(await FecEccnSQL.create(normalizedDataItem))) as RowDataPacket[]
    return {
      Status: true,
      Message: 'Data has been saved successfully',
      ResultOnDb: result,
      MethodOnDb: 'Insert FEC ECCN Success',
      TotalCountOnDb: result?.length ?? 0
    }
  },

  update: async (dataItem: any) => {
    const normalizedDataItem = normalizeFecEccn(dataItem)
    if (!normalizedDataItem) return responseFailed('FEC ECCN Full Code is required', 'Update FEC ECCN Failed')

    const current = await getExistingById(normalizedDataItem)
    if (!current) return responseFailed('FEC ECCN was not found', 'Update FEC ECCN Failed')
    if (Number(current.INUSE) !== 1) return responseFailed('Only Can use FEC ECCN can be edited', 'Update FEC ECCN Failed')

    const duplicate = (await MySQLExecute.search(await FecEccnSQL.getByFullCode(normalizedDataItem))) as RowDataPacket[]
    if (duplicate.some(item => Number(item.ECCN_FEC_ID) !== Number(normalizedDataItem.ECCN_FEC_ID))) {
      return responseFailed('Duplicate FEC ECCN Full Code', 'Update FEC ECCN Failed')
    }

    normalizedDataItem.ECCN_ID = await ensureEccn(normalizedDataItem)
    const result = (await MySQLExecute.execute(await FecEccnSQL.update(normalizedDataItem))) as RowDataPacket[]
    return {
      Status: true,
      Message: 'Data has been updated successfully',
      ResultOnDb: result,
      MethodOnDb: 'Update FEC ECCN Success',
      TotalCountOnDb: result?.length ?? 0
    }
  },

  delete: async (dataItem: any) => {
    const current = await getExistingById(dataItem)
    if (!current) return responseFailed('FEC ECCN was not found', 'Delete FEC ECCN Failed')
    if (Number(current.INUSE) !== 1) return responseFailed('Only Can use FEC ECCN can be cancelled', 'Delete FEC ECCN Failed')

    const result = (await MySQLExecute.execute(await FecEccnSQL.delete(dataItem))) as RowDataPacket[]
    return {
      Status: true,
      Message: 'Data has been cancelled successfully',
      ResultOnDb: result,
      MethodOnDb: 'Cancel FEC ECCN Success',
      TotalCountOnDb: result?.length ?? 0
    }
  }
}

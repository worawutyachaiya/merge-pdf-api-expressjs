import { MySQLExecute } from '@businessData/dbExecute'
import getSqlWhere_elysia from '@src/helpers/getSqlWhere_elysia'
import { EarSurveySQL, getManufacturingItemTable } from '@src/_workspace/sql/trade-compliance/EarSurveySQL'
import mysql, { RowDataPacket } from 'mysql2'

type SurveyStage = 'ACTIVE' | 'PRE_TRADE'

export const EarSurveyService = {
  search: async (dataItem: any, surveyStage: SurveyStage = 'ACTIVE') => {
    const tableIds = [
      { table: 'survey', id: 'EAR_SURVEY_HEADER_ID', Fns: '=' },
      { table: 'survey', id: 'INUSE', Fns: '=' },
      { table: 'survey', id: 'REQUEST_DATE', Fns: '=' },
      { table: 'survey', id: 'SUPPLIER_CODE', Fns: 'LIKE' },
      { table: 'survey', id: 'SUPPLIER_NAME', Fns: 'LIKE' },
      { table: 'survey', id: 'CONTACT_NAME', Fns: 'LIKE' },
      { table: 'survey', id: 'SURVEY_STAGE', Fns: '=' },
      { table: 'survey', id: 'REVISION_NO', Fns: '=' },
      { table: 'survey', id: 'REVISION_CODE', Fns: 'LIKE' },
      { table: 'survey', id: 'ITEM_COUNT', Fns: '=' },
      { table: 'survey', id: 'ECCN_COUNT', Fns: '=' },
      { table: 'survey', id: 'CREATE_BY', Fns: 'LIKE' },
      { table: 'survey', id: 'CREATE_DATE', Fns: '=' },
      { table: 'survey', id: 'UPDATE_BY', Fns: 'LIKE' },
      { table: 'survey', id: 'UPDATE_DATE', Fns: '=' },
    ]

    const requestDateFrom = `${dataItem.SearchFilters.find((filter: any) => filter?.id === 'REQUEST_DATE_FROM')?.value ?? ''}`.trim()
    const requestDateTo = `${dataItem.SearchFilters.find((filter: any) => filter?.id === 'REQUEST_DATE_TO')?.value ?? ''}`.trim()
    const itemCode = `${dataItem.SearchFilters.find((filter: any) => filter?.id === 'ITEM_CODE')?.value ?? ''}`.trim()
    const rawStatus = dataItem.SearchFilters.find((filter: any) => filter?.id === 'STATUS')?.value
    const status = Number(rawStatus)
    const hasStatus = rawStatus !== '' && rawStatus !== null && rawStatus !== undefined && (status === 0 || status === 1)
    const includingCancelled = Boolean(dataItem.SearchFilters.find((filter: any) => filter?.id === 'INCLUDING_CANCELLED')?.value)

    getSqlWhere_elysia(dataItem, tableIds, 'CREATE_DATE')

    dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE')
      ? ` AND survey.SURVEY_STAGE = ${mysql.escape(surveyStage)}`
      : ` WHERE survey.SURVEY_STAGE = ${mysql.escape(surveyStage)}`

    if (requestDateFrom) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE')
        ? ` AND survey.REQUEST_DATE >= ${mysql.escape(requestDateFrom)}`
        : ` WHERE survey.REQUEST_DATE >= ${mysql.escape(requestDateFrom)}`
    }

    if (requestDateTo) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE')
        ? ` AND survey.REQUEST_DATE <= ${mysql.escape(requestDateTo)}`
        : ` WHERE survey.REQUEST_DATE <= ${mysql.escape(requestDateTo)}`
    }

    if (itemCode) {
      const itemCodeWhere = `
        EXISTS (
          SELECT 1
          FROM EAR_SURVEY_ITEM item_filter
          LEFT JOIN ${getManufacturingItemTable()} im_filter
            ON im_filter.ITEM_MANUFACTURING_ID = item_filter.ITEM_MANUFACTURING_ID
          WHERE item_filter.EAR_SURVEY_HEADER_ID = survey.EAR_SURVEY_HEADER_ID
            AND item_filter.INUSE = 1
            AND COALESCE(im_filter.ITEM_CODE_FOR_SUPPORT_MES, item_filter.PRE_TRADE_REFERENCE_NO) LIKE ${mysql.escape(`%${itemCode}%`)}
        )
      `
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ` AND ${itemCodeWhere}` : ` WHERE ${itemCodeWhere}`
    }

    if (hasStatus) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ` AND survey.INUSE = ${mysql.escape(status)}` : ` WHERE survey.INUSE = ${mysql.escape(status)}`
    } else if (!includingCancelled) {
      dataItem.sqlWhere += dataItem.sqlWhere.includes('WHERE') ? ' AND survey.INUSE = 1' : ' WHERE survey.INUSE = 1'
    }

    dataItem.sqlLimit = `LIMIT ${dataItem.Start}, ${dataItem.Limit}`

    const sql = await EarSurveySQL.search(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
  getByEarSurveyHeaderId: async (earSurveyHeaderId: number) => {
    const results = (await MySQLExecute.searchList([
      EarSurveySQL.getHeaderById(earSurveyHeaderId),
      EarSurveySQL.getItemsByHeaderId(earSurveyHeaderId),
      EarSurveySQL.getControlsByHeaderId(earSurveyHeaderId),
    ])) as RowDataPacket[][][]

    const header = results[0]?.[0] as any
    if (!header) return null

    const controlsByItemId = new Map<number, any[]>()
    for (const control of (results[2] ?? []) as any[]) {
      const controls = controlsByItemId.get(Number(control.EAR_SURVEY_ITEM_ID)) ?? []
      controls.push(control)
      controlsByItemId.set(Number(control.EAR_SURVEY_ITEM_ID), controls)
    }

    return {
      ...header,
      ITEMS: ((results[1] ?? []) as any[]).map((item) => ({
        ...item,
        CONTROLS: controlsByItemId.get(Number(item.EAR_SURVEY_ITEM_ID)) ?? [],
      })),
    }
  },
  getManufacturingItemByCode: async (itemCode: string) => {
    const result = (await MySQLExecute.search(EarSurveySQL.getItemManufacturingByCodes([itemCode]))) as RowDataPacket[]
    return result
  },
}

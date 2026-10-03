import { MySQLExecute } from '@businessData/dbExecute'
import { CommonSQL } from '@src/_workspace/sql/common/CommonSQl'
import { RowDataPacket } from 'mysql2'

export const CommonService = {
  GetByLikeMonthShortNameEnglish: async (dataItem: any) => {
    const sql = await CommonSQL.GetByLikeMonthShortNameEnglish(dataItem)
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
  GetYearNow: async () => {
    const sql = await CommonSQL.GetYearNow()
    const resultData = (await MySQLExecute.search(sql)) as RowDataPacket[]
    return resultData
  },
}

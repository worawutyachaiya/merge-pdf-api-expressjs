export const CommonSQL = {
  GetByLikeMonthShortNameEnglish: async (dataItem: any) => {
    let sql = `  SELECT
                        MONTH_ID
                      , MONTH_FULL_NAME_THAI
                      , MONTH_SHORT_NAME_THAI
                      , MONTH_FULL_NAME_ENGLISH
                      , MONTH_SHORT_NAME_ENGLISH
                      FROM
                      MONTH
                      WHERE
                      MONTH_SHORT_NAME_ENGLISH LIKE '%dataItem.MONTH_SHORT_NAME_ENGLISH%' `

    sql = sql.replaceAll('dataItem.MONTH_SHORT_NAME_ENGLISH', dataItem['MONTH_SHORT_NAME_ENGLISH'])

    return sql
  },
  GetYearNow: async () => {
    let sql = ' SELECT YEAR(NOW()) as YEAR_NOW '
    return sql
  },
}

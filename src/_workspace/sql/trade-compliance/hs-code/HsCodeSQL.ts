import mysql from 'mysql2'

export const HsCodeSQL = {
  search: async (dataItem: any) => `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM HS_CODE hs
    ${dataItem.sqlWhere};

    SELECT
        hs.HS_CODE_ID, hs.HS_CODE
      , hs.CREATE_BY
      , DATE_FORMAT(hs.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , hs.UPDATE_BY
      , DATE_FORMAT(hs.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , hs.INUSE
    FROM HS_CODE hs
    ${dataItem.sqlWhere}
    ORDER BY ${dataItem.Order}
    ${dataItem.sqlLimit}
  `,

  getEccnRelationsByHsCodeId: (hsCodeId: number) => `
    SELECT DISTINCT
        eccn.ECCN_ID, eccn.ECCN_CODE, eccn.ECCN_SUB_CODE, eccn.ECCN_FULL_CODE
    FROM HS_CODE_ECCN relation
    JOIN ECCN eccn ON eccn.ECCN_ID = relation.ECCN_ID
    WHERE relation.HS_CODE_ID = ${mysql.escape(hsCodeId)}
      AND relation.INUSE = 1
      AND eccn.INUSE = 1
    ORDER BY eccn.ECCN_FULL_CODE
  `,
}

import mysql from 'mysql2'

export const EccnSQL = {
  search: async (dataItem: any) => `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM ECCN eccn
    ${dataItem.sqlWhere};

    SELECT
        eccn.ECCN_ID, eccn.ECCN_CODE, eccn.ECCN_SUB_CODE, eccn.ECCN_FULL_CODE
      , eccn.CREATE_BY
      , DATE_FORMAT(eccn.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , eccn.UPDATE_BY
      , DATE_FORMAT(eccn.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , eccn.INUSE
    FROM ECCN eccn
    ${dataItem.sqlWhere}
    ORDER BY ${dataItem.Order}
    ${dataItem.sqlLimit}
  `,

  getHsCodeRelationsByEccnId: (eccnId: number) => `
    SELECT DISTINCT hs.HS_CODE_ID, hs.HS_CODE
    FROM HS_CODE_ECCN relation
    JOIN HS_CODE hs ON hs.HS_CODE_ID = relation.HS_CODE_ID
    WHERE relation.ECCN_ID = ${mysql.escape(eccnId)}
      AND relation.INUSE = 1
      AND hs.INUSE = 1
    ORDER BY hs.HS_CODE
  `,
}

import mysql from 'mysql2'

const nullableValue = (value: unknown) => value === null || value === undefined || value === '' ? 'NULL' : mysql.escape(value as any)

export const FecEccnSQL = {
  search: async (dataItem: any) => `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM ECCN_FEC fecEccn
    JOIN ECCN eccn ON eccn.ECCN_ID = fecEccn.ECCN_ID
    ${dataItem.sqlWhere};

    SELECT
        fecEccn.ECCN_FEC_ID
      , eccn.ECCN_CODE AS FEC_ECCN_CODE
      , eccn.ECCN_SUB_CODE AS FEC_ECCN_SUB_CODE
      , eccn.ECCN_FULL_CODE AS FEC_ECCN_FULL_CODE
      , fecEccn.CREATE_BY
      , DATE_FORMAT(fecEccn.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , fecEccn.UPDATE_BY
      , DATE_FORMAT(fecEccn.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , fecEccn.INUSE
    FROM ECCN_FEC fecEccn
    JOIN ECCN eccn ON eccn.ECCN_ID = fecEccn.ECCN_ID
    ${dataItem.sqlWhere}
    ORDER BY ${dataItem.Order}
    ${dataItem.sqlLimit}
  `,

  getByFullCode: async (dataItem: any) => `
    SELECT
        fecEccn.ECCN_FEC_ID
      , fecEccn.ECCN_ID
      , eccn.ECCN_CODE
      , eccn.ECCN_SUB_CODE
      , eccn.ECCN_FULL_CODE
      , fecEccn.INUSE
    FROM ECCN_FEC fecEccn
    JOIN ECCN eccn ON eccn.ECCN_ID = fecEccn.ECCN_ID
    WHERE eccn.ECCN_FULL_CODE = ${mysql.escape(dataItem.ECCN_FULL_CODE)}
  `,

  getById: async (dataItem: any) => `
    SELECT
        fecEccn.ECCN_FEC_ID
      , fecEccn.ECCN_ID
      , eccn.ECCN_CODE
      , eccn.ECCN_SUB_CODE
      , eccn.ECCN_FULL_CODE
      , fecEccn.INUSE
    FROM ECCN_FEC fecEccn
    JOIN ECCN eccn ON eccn.ECCN_ID = fecEccn.ECCN_ID
    WHERE fecEccn.ECCN_FEC_ID = ${mysql.escape(dataItem.ECCN_FEC_ID)}
  `,

  getEccnByFullCode: async (dataItem: any) => `
    SELECT ECCN_ID, ECCN_CODE, ECCN_SUB_CODE, ECCN_FULL_CODE, INUSE
    FROM ECCN
    WHERE ECCN_FULL_CODE = ${mysql.escape(dataItem.ECCN_FULL_CODE)}
  `,

  createEccn: async (dataItem: any) => `
    INSERT INTO ECCN
    (
        ECCN_CODE
      , ECCN_SUB_CODE
      , ECCN_FULL_CODE
      , CREATE_BY
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    ) VALUES
    (
        ${mysql.escape(dataItem.ECCN_CODE)}
      , ${nullableValue(dataItem.ECCN_SUB_CODE)}
      , ${mysql.escape(dataItem.ECCN_FULL_CODE)}
      , ${mysql.escape(dataItem.CREATE_BY)}
      , ${mysql.escape(dataItem.UPDATE_BY ?? dataItem.CREATE_BY)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  reactivateEccn: async (dataItem: any) => `
    UPDATE ECCN
    SET
        INUSE = 1
      , UPDATE_BY = ${mysql.escape(dataItem.UPDATE_BY ?? dataItem.CREATE_BY)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE ECCN_ID = ${mysql.escape(dataItem.ECCN_ID)}
  `,

  create: async (dataItem: any) => `
    INSERT INTO ECCN_FEC
    (
        ECCN_ID
      , CREATE_BY
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    ) VALUES
    (
        ${mysql.escape(dataItem.ECCN_ID)}
      , ${mysql.escape(dataItem.CREATE_BY)}
      , ${mysql.escape(dataItem.UPDATE_BY ?? dataItem.CREATE_BY)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  update: async (dataItem: any) => `
    UPDATE ECCN_FEC
    SET
        ECCN_ID = ${mysql.escape(dataItem.ECCN_ID)}
      , UPDATE_BY = ${mysql.escape(dataItem.UPDATE_BY)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE ECCN_FEC_ID = ${mysql.escape(dataItem.ECCN_FEC_ID)}
      AND INUSE = 1
  `,

  delete: async (dataItem: any) => `
    UPDATE ECCN_FEC
    SET
        INUSE = 0
      , UPDATE_BY = ${mysql.escape(dataItem.UPDATE_BY)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE ECCN_FEC_ID = ${mysql.escape(dataItem.ECCN_FEC_ID)}
      AND INUSE = 1
  `
}

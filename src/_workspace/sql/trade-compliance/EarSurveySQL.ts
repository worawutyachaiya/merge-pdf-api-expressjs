import mysql from 'mysql2'

const escape = (value: unknown) => mysql.escape(value as Parameters<typeof mysql.escape>[0])

export const getManufacturingItemTable = (): string => {
  const database = process.env.MASTER_DATA_DB
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('MASTER_DATA_DB is not configured correctly')
  }
  return `\`${database}\`.ITEM_MANUFACTURING`
}

export const EarSurveySQL = {
  search: async (dataItem: any) => `
    SELECT COUNT(*) AS TOTAL_COUNT
    FROM (
      SELECT
          h.EAR_SURVEY_HEADER_ID
        , h.REQUEST_DATE
        , h.SUPPLIER_CODE
        , h.SUPPLIER_NAME
        , h.CONTACT_TEL
        , h.CONTACT_NAME
        , h.POSITION_NAME
        , h.DEPARTMENT_NAME
        , h.CONTACT_EMAIL
        , h.EAR_SURVEY_STAGE_ID
        , stage.EAR_SURVEY_STAGE_CODE AS SURVEY_STAGE
        , stage.EAR_SURVEY_STAGE_NAME AS SURVEY_STAGE_NAME
        , h.REVISION_NO
        , h.REVISION_CODE
        , h.IS_CURRENT
        , (
            SELECT COUNT(*)
            FROM EAR_SURVEY_ITEM i
            WHERE i.EAR_SURVEY_HEADER_ID = h.EAR_SURVEY_HEADER_ID
              AND i.INUSE = 1
          ) AS ITEM_COUNT
        , (
            SELECT COUNT(*)
            FROM EAR_SURVEY_ITEM i
            JOIN EAR_SURVEY_ITEM_CONTROL c
              ON c.EAR_SURVEY_ITEM_ID = i.EAR_SURVEY_ITEM_ID
             AND c.INUSE = 1
            WHERE i.EAR_SURVEY_HEADER_ID = h.EAR_SURVEY_HEADER_ID
              AND i.INUSE = 1
          ) AS ECCN_COUNT
        , h.CREATE_BY
        , h.CREATE_DATE
        , h.UPDATE_BY
        , h.UPDATE_DATE
        , h.INUSE
      FROM EAR_SURVEY_HEADER h
      JOIN EAR_SURVEY_STAGE stage
        ON stage.EAR_SURVEY_STAGE_ID = h.EAR_SURVEY_STAGE_ID
      WHERE 1 = 1
    ) survey
    ${dataItem.sqlWhere};

    SELECT
        survey.EAR_SURVEY_HEADER_ID
      , DATE_FORMAT(survey.REQUEST_DATE, '%Y-%m-%d') AS REQUEST_DATE
      , survey.SUPPLIER_CODE
      , survey.SUPPLIER_NAME
      , survey.CONTACT_TEL
      , survey.CONTACT_NAME
      , survey.POSITION_NAME
      , survey.DEPARTMENT_NAME
      , survey.CONTACT_EMAIL
      , survey.EAR_SURVEY_STAGE_ID
      , survey.SURVEY_STAGE
      , survey.SURVEY_STAGE_NAME
      , survey.REVISION_NO
      , survey.REVISION_CODE
      , survey.IS_CURRENT
      , survey.ITEM_COUNT
      , survey.ECCN_COUNT
      , survey.CREATE_BY
      , DATE_FORMAT(survey.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , survey.UPDATE_BY
      , DATE_FORMAT(survey.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , survey.INUSE
    FROM (
      SELECT
          h.EAR_SURVEY_HEADER_ID
        , h.REQUEST_DATE
        , h.SUPPLIER_CODE
        , h.SUPPLIER_NAME
        , h.CONTACT_TEL
        , h.CONTACT_NAME
        , h.POSITION_NAME
        , h.DEPARTMENT_NAME
        , h.CONTACT_EMAIL
        , h.EAR_SURVEY_STAGE_ID
        , stage.EAR_SURVEY_STAGE_CODE AS SURVEY_STAGE
        , stage.EAR_SURVEY_STAGE_NAME AS SURVEY_STAGE_NAME
        , h.REVISION_NO
        , h.REVISION_CODE
        , h.IS_CURRENT
        , (
            SELECT COUNT(*)
            FROM EAR_SURVEY_ITEM i
            WHERE i.EAR_SURVEY_HEADER_ID = h.EAR_SURVEY_HEADER_ID
              AND i.INUSE = 1
          ) AS ITEM_COUNT
        , (
            SELECT COUNT(*)
            FROM EAR_SURVEY_ITEM i
            JOIN EAR_SURVEY_ITEM_CONTROL c
              ON c.EAR_SURVEY_ITEM_ID = i.EAR_SURVEY_ITEM_ID
             AND c.INUSE = 1
            WHERE i.EAR_SURVEY_HEADER_ID = h.EAR_SURVEY_HEADER_ID
              AND i.INUSE = 1
          ) AS ECCN_COUNT
        , h.CREATE_BY
        , h.CREATE_DATE
        , h.UPDATE_BY
        , h.UPDATE_DATE
        , h.INUSE
      FROM EAR_SURVEY_HEADER h
      JOIN EAR_SURVEY_STAGE stage
        ON stage.EAR_SURVEY_STAGE_ID = h.EAR_SURVEY_STAGE_ID
      WHERE 1 = 1
    ) survey
    ${dataItem.sqlWhere}
    ORDER BY ${dataItem.Order}
    ${dataItem.sqlLimit}
  `,
  getHeaderById: (earSurveyHeaderId: number) => `
    SELECT
        h.EAR_SURVEY_HEADER_ID
      , DATE_FORMAT(h.REQUEST_DATE, '%Y-%m-%d') AS REQUEST_DATE
      , h.SUPPLIER_CODE
      , h.SUPPLIER_NAME
      , h.CONTACT_TEL
      , h.CONTACT_NAME
      , h.POSITION_NAME
      , h.DEPARTMENT_NAME
      , h.CONTACT_EMAIL
      , h.EAR_SURVEY_STAGE_ID
      , stage.EAR_SURVEY_STAGE_CODE AS SURVEY_STAGE
      , stage.EAR_SURVEY_STAGE_NAME AS SURVEY_STAGE_NAME
      , h.REVISION_NO
      , h.REVISION_CODE
      , h.IS_CURRENT
      , h.CREATE_BY
      , DATE_FORMAT(h.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , h.UPDATE_BY
      , DATE_FORMAT(h.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , h.INUSE
    FROM EAR_SURVEY_HEADER h
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = h.EAR_SURVEY_STAGE_ID
    WHERE h.EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
  `,

  getItemsByHeaderId: (earSurveyHeaderId: number) => `
    SELECT
        i.EAR_SURVEY_ITEM_ID
      , i.EAR_SURVEY_HEADER_ID
      , i.ITEM_MANUFACTURING_ID
      , i.PRE_TRADE_REFERENCE_NO
      , COALESCE(im.ITEM_CODE_FOR_SUPPORT_MES, i.PRE_TRADE_REFERENCE_NO) AS ITEM_CODE
      , i.DESCRIPTION
      , i.MODEL
      , i.REMARK
      , i.EAR_SURVEY_STATUS_ID
      , es.EAR_SURVEY_STATUS_CODE
      , es.EAR_SURVEY_STATUS_NAME
      , i.HS_CODE_ID
      , hs.HS_CODE
      , i.COUNTRY_ID
      , country.COUNTRY_NAME
      , i.CREATE_BY
      , DATE_FORMAT(i.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , i.UPDATE_BY
      , DATE_FORMAT(i.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , i.INUSE
    FROM EAR_SURVEY_ITEM i
    LEFT JOIN ${getManufacturingItemTable()} im
      ON im.ITEM_MANUFACTURING_ID = i.ITEM_MANUFACTURING_ID
    JOIN EAR_SURVEY_STATUS es
      ON es.EAR_SURVEY_STATUS_ID = i.EAR_SURVEY_STATUS_ID
    LEFT JOIN HS_CODE hs
      ON hs.HS_CODE_ID = i.HS_CODE_ID
    LEFT JOIN COUNTRY country
      ON country.COUNTRY_ID = i.COUNTRY_ID
    WHERE i.EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND i.INUSE = 1
    ORDER BY i.EAR_SURVEY_ITEM_ID
  `,

  getControlsByHeaderId: (earSurveyHeaderId: number) => `
    SELECT
        c.EAR_SURVEY_ITEM_CONTROL_ID
      , c.EAR_SURVEY_ITEM_ID
      , c.ECCN_ID
      , eccn.ECCN_CODE
      , eccn.ECCN_SUB_CODE
      , eccn.ECCN_FULL_CODE
      , COALESCE((
          SELECT GROUP_CONCAT(reason.REASON_FOR_CONTROL ORDER BY reason.EAR_SURVEY_ITEM_CONTROL_REASON_ID SEPARATOR ', ')
          FROM EAR_SURVEY_ITEM_CONTROL_REASON reason
          WHERE reason.EAR_SURVEY_ITEM_CONTROL_ID = c.EAR_SURVEY_ITEM_CONTROL_ID
            AND reason.INUSE = 1
        ), '') AS REASON_FOR_CONTROL
      , c.COMPONENT_OF_PRODUCT
      , c.REMARK
      , c.CREATE_BY
      , DATE_FORMAT(c.CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , c.UPDATE_BY
      , DATE_FORMAT(c.UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
      , c.INUSE
    FROM EAR_SURVEY_ITEM_CONTROL c
    JOIN EAR_SURVEY_ITEM i
      ON i.EAR_SURVEY_ITEM_ID = c.EAR_SURVEY_ITEM_ID
    JOIN ECCN eccn
      ON eccn.ECCN_ID = c.ECCN_ID
    WHERE i.EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND i.INUSE = 1
      AND c.INUSE = 1
    ORDER BY c.EAR_SURVEY_ITEM_ID, c.EAR_SURVEY_ITEM_CONTROL_ID
  `,

  getItemManufacturingByCodes: (itemCodes: string[]) => `
    SELECT ITEM_MANUFACTURING_ID, ITEM_CODE_FOR_SUPPORT_MES
    FROM ${getManufacturingItemTable()}
    WHERE ITEM_CODE_FOR_SUPPORT_MES IN (${itemCodes.map(escape).join(', ')})
      AND IS_CURRENT = 1
      AND INUSE = 1
    ORDER BY ITEM_CODE_FOR_SUPPORT_MES, ITEM_MANUFACTURING_ID
  `,

  getEarStatuses: () => `
    SELECT EAR_SURVEY_STATUS_ID, EAR_SURVEY_STATUS_CODE, EAR_SURVEY_STATUS_NAME
    FROM EAR_SURVEY_STATUS
    WHERE INUSE = 1
  `,

  getCountries: () => `
    SELECT COUNTRY_ID, COUNTRY_NAME, COUNTRY_ALPHA2, COUNTRY_ALPHA3
    FROM COUNTRY
    WHERE INUSE = 1
  `,

  upsertHsCode: (hsCode: string, createBy: string) => `
    INSERT INTO HS_CODE (
        HS_CODE
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        ${escape(hsCode)}
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
    ON DUPLICATE KEY UPDATE
        UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  upsertEccn: (eccn: { ECCN_CODE: string; ECCN_SUB_CODE: string | null; ECCN_FULL_CODE: string }, createBy: string) => `
    INSERT INTO ECCN (
        ECCN_CODE
      , ECCN_SUB_CODE
      , ECCN_FULL_CODE
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        ${escape(eccn.ECCN_CODE)}
      , ${escape(eccn.ECCN_SUB_CODE)}
      , ${escape(eccn.ECCN_FULL_CODE)}
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
    ON DUPLICATE KEY UPDATE
        UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  upsertHsCodeEccn: (hsCode: string, eccnFullCode: string, createBy: string) => `
    INSERT INTO HS_CODE_ECCN (
        HS_CODE_ID
      , ECCN_ID
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT
        hs.HS_CODE_ID
      , eccn.ECCN_ID
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM HS_CODE hs
    JOIN ECCN eccn ON eccn.ECCN_FULL_CODE = ${escape(eccnFullCode)} AND eccn.INUSE = 1
    WHERE hs.HS_CODE = ${escape(hsCode)}
      AND hs.INUSE = 1
    ON DUPLICATE KEY UPDATE
        UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  upsertItemManufacturingHsCode: (itemManufacturingId: number, hsCode: string, updateBy: string) => `
    INSERT INTO ITEM_MANUFACTURING_HS_CODE (
        ITEM_MANUFACTURING_ID
      , HS_CODE_ID
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT
        ${escape(itemManufacturingId)}
      , hs.HS_CODE_ID
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM HS_CODE hs
    WHERE hs.HS_CODE = ${escape(hsCode)}
      AND hs.INUSE = 1
    ON DUPLICATE KEY UPDATE
        HS_CODE_ID = VALUES(HS_CODE_ID)
      , UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  deactivateUnusedItemManufacturingEccns: (updateBy: string) => `
    UPDATE ITEM_MANUFACTURING_ECCN itemEccn
    SET itemEccn.INUSE = 0
      , itemEccn.UPDATE_BY = ${escape(updateBy)}
      , itemEccn.UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE itemEccn.INUSE = 1
      AND NOT EXISTS (
        SELECT 1
        FROM EAR_SURVEY_ITEM_CONTROL control
        JOIN EAR_SURVEY_ITEM item
          ON item.EAR_SURVEY_ITEM_ID = control.EAR_SURVEY_ITEM_ID
         AND item.INUSE = 1
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.INUSE = 1
         AND header.IS_CURRENT = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
         AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
        WHERE item.ITEM_MANUFACTURING_ID = itemEccn.ITEM_MANUFACTURING_ID
          AND control.ECCN_ID = itemEccn.ECCN_ID
          AND control.INUSE = 1
      )
  `,

  upsertCurrentItemManufacturingEccns: (updateBy: string) => `
    INSERT INTO ITEM_MANUFACTURING_ECCN (
        ITEM_MANUFACTURING_ID
      , ECCN_ID
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT DISTINCT
        item.ITEM_MANUFACTURING_ID
      , control.ECCN_ID
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM EAR_SURVEY_ITEM_CONTROL control
    JOIN EAR_SURVEY_ITEM item
      ON item.EAR_SURVEY_ITEM_ID = control.EAR_SURVEY_ITEM_ID
     AND item.INUSE = 1
     AND item.ITEM_MANUFACTURING_ID IS NOT NULL
    JOIN EAR_SURVEY_HEADER header
      ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
     AND header.INUSE = 1
     AND header.IS_CURRENT = 1
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
     AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
    WHERE control.INUSE = 1
    ON DUPLICATE KEY UPDATE
        UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  deactivateUnusedItemManufacturingCountries: (updateBy: string) => `
    UPDATE ITEM_MANUFACTURING_COUNTRY_OF_ORIGIN itemCountry
    SET itemCountry.INUSE = 0
      , itemCountry.UPDATE_BY = ${escape(updateBy)}
      , itemCountry.UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE itemCountry.INUSE = 1
      AND NOT EXISTS (
        SELECT 1
        FROM EAR_SURVEY_ITEM item
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.INUSE = 1
         AND header.IS_CURRENT = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
         AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
        WHERE item.ITEM_MANUFACTURING_ID = itemCountry.ITEM_MANUFACTURING_ID
          AND item.COUNTRY_ID = itemCountry.COUNTRY_ID
          AND item.INUSE = 1
      )
  `,

  upsertCurrentItemManufacturingCountries: (updateBy: string) => `
    INSERT INTO ITEM_MANUFACTURING_COUNTRY_OF_ORIGIN (
        ITEM_MANUFACTURING_ID
      , COUNTRY_ID
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT DISTINCT
        item.ITEM_MANUFACTURING_ID
      , item.COUNTRY_ID
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(updateBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM EAR_SURVEY_ITEM item
    JOIN EAR_SURVEY_HEADER header
      ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
     AND header.INUSE = 1
     AND header.IS_CURRENT = 1
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
     AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
    WHERE item.INUSE = 1
      AND item.ITEM_MANUFACTURING_ID IS NOT NULL
      AND item.COUNTRY_ID IS NOT NULL
    ON DUPLICATE KEY UPDATE
        UPDATE_BY = VALUES(UPDATE_BY)
      , UPDATE_DATE = CURRENT_TIMESTAMP()
      , INUSE = 1
  `,

  syncUnusedHsCodes: (updateBy: string) => `
    UPDATE HS_CODE hs
    SET INUSE = 0
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE hs.INUSE = 1
      AND NOT EXISTS (
        SELECT 1
        FROM EAR_SURVEY_ITEM item
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.INUSE = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
        WHERE item.HS_CODE_ID = hs.HS_CODE_ID
          AND item.INUSE = 1
          AND (
            (stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE' AND header.IS_CURRENT = 1)
            OR stage.EAR_SURVEY_STAGE_CODE = 'PRE_TRADE'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ITEM_MANUFACTURING_HS_CODE itemHs
        WHERE itemHs.HS_CODE_ID = hs.HS_CODE_ID
          AND itemHs.INUSE = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM HS_CODE_ECCN relation
        WHERE relation.HS_CODE_ID = hs.HS_CODE_ID
          AND relation.INUSE = 1
      )
  `,

  syncUnusedEccns: (updateBy: string) => `
    UPDATE ECCN eccn
    SET INUSE = 0
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE eccn.INUSE = 1
      AND NOT EXISTS (
        SELECT 1
        FROM EAR_SURVEY_ITEM_CONTROL control
        JOIN EAR_SURVEY_ITEM item
          ON item.EAR_SURVEY_ITEM_ID = control.EAR_SURVEY_ITEM_ID
         AND item.INUSE = 1
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.INUSE = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
        WHERE control.ECCN_ID = eccn.ECCN_ID
          AND control.INUSE = 1
          AND (
            (stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE' AND header.IS_CURRENT = 1)
            OR stage.EAR_SURVEY_STAGE_CODE = 'PRE_TRADE'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ECCN_FEC fecEccn
        WHERE fecEccn.ECCN_ID = eccn.ECCN_ID
          AND fecEccn.INUSE = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM HS_CODE_ECCN relation
        WHERE relation.ECCN_ID = eccn.ECCN_ID
          AND relation.INUSE = 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ITEM_MANUFACTURING_ECCN itemEccn
        WHERE itemEccn.ECCN_ID = eccn.ECCN_ID
          AND itemEccn.INUSE = 1
      )
  `,

  getActiveHeadersBySupplierCode: (supplierCode: string) => `
    SELECT
        header.EAR_SURVEY_HEADER_ID
      , header.REVISION_NO
      , header.REVISION_CODE
    FROM EAR_SURVEY_HEADER header
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
    WHERE UPPER(TRIM(header.SUPPLIER_CODE)) = UPPER(TRIM(${escape(supplierCode)}))
      AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
      AND header.IS_CURRENT = 1
      AND header.INUSE = 1
    ORDER BY header.REVISION_NO DESC, header.EAR_SURVEY_HEADER_ID DESC
  `,

  getNextRevisionNoBySupplierCode: (supplierCode: string) => `
    SELECT IFNULL(MAX(REVISION_NO), 0) + 1 AS REVISION_NO
    FROM EAR_SURVEY_HEADER header
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
    WHERE UPPER(TRIM(header.SUPPLIER_CODE)) = UPPER(TRIM(${escape(supplierCode)}))
      AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
  `,

  getItemManufacturingByIds: (itemManufacturingIds: number[]) => `
    SELECT ITEM_MANUFACTURING_ID, ITEM_CODE_FOR_SUPPORT_MES
    FROM ${getManufacturingItemTable()}
    WHERE ITEM_MANUFACTURING_ID IN (${itemManufacturingIds.map(escape).join(', ')})
      AND IS_CURRENT = 1
      AND INUSE = 1
    ORDER BY ITEM_MANUFACTURING_ID
  `,

  getCurrentActiveItemHsCodes: (itemManufacturingIds: number[], excludeEarSurveyHeaderId?: number | null) => `
    SELECT
        i.ITEM_MANUFACTURING_ID
      , im.ITEM_CODE_FOR_SUPPORT_MES AS ITEM_CODE
      , hs.HS_CODE
      , h.EAR_SURVEY_HEADER_ID
      , h.SUPPLIER_CODE
      , h.REVISION_CODE
    FROM EAR_SURVEY_HEADER h
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = h.EAR_SURVEY_STAGE_ID
    JOIN EAR_SURVEY_ITEM i
      ON i.EAR_SURVEY_HEADER_ID = h.EAR_SURVEY_HEADER_ID
     AND i.INUSE = 1
    JOIN ${getManufacturingItemTable()} im
      ON im.ITEM_MANUFACTURING_ID = i.ITEM_MANUFACTURING_ID
    JOIN HS_CODE hs
      ON hs.HS_CODE_ID = i.HS_CODE_ID
    WHERE stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
      AND h.IS_CURRENT = 1
      AND h.INUSE = 1
      AND i.HS_CODE_ID IS NOT NULL
      AND i.ITEM_MANUFACTURING_ID IN (${itemManufacturingIds.map(escape).join(', ')})
      ${excludeEarSurveyHeaderId ? `AND h.EAR_SURVEY_HEADER_ID <> ${escape(excludeEarSurveyHeaderId)}` : ''}
    ORDER BY i.ITEM_MANUFACTURING_ID, h.EAR_SURVEY_HEADER_ID
  `,

  getCurrentPreTradeHeadersBySupplierName: (supplierName: string) => `
    SELECT header.EAR_SURVEY_HEADER_ID
    FROM EAR_SURVEY_HEADER header
    JOIN EAR_SURVEY_STAGE stage
      ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
    WHERE UPPER(TRIM(header.SUPPLIER_NAME)) = UPPER(TRIM(${escape(supplierName)}))
      AND stage.EAR_SURVEY_STAGE_CODE = 'PRE_TRADE'
      AND header.INUSE = 1
    ORDER BY header.EAR_SURVEY_HEADER_ID DESC
  `,

  insertHeader: (
    header: {
      REQUEST_DATE: string
      SUPPLIER_CODE: string | null
      SUPPLIER_NAME: string
      CONTACT_TEL: string
      CONTACT_NAME: string
      POSITION_NAME: string
      DEPARTMENT_NAME: string
      CONTACT_EMAIL: string
      SURVEY_STAGE: 'ACTIVE' | 'PRE_TRADE'
      REVISION_NO: number | null
      REVISION_CODE: string | null
    },
    createBy: string
  ) => `
    INSERT INTO EAR_SURVEY_HEADER (
        REQUEST_DATE
      , SUPPLIER_CODE
      , SUPPLIER_NAME
      , CONTACT_TEL
      , CONTACT_NAME
      , POSITION_NAME
      , DEPARTMENT_NAME
      , CONTACT_EMAIL
      , EAR_SURVEY_STAGE_ID
      , REVISION_NO
      , REVISION_CODE
      , IS_CURRENT
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        ${escape(header.REQUEST_DATE)}
      , ${escape(header.SUPPLIER_CODE)}
      , ${escape(header.SUPPLIER_NAME)}
      , ${escape(header.CONTACT_TEL)}
      , ${escape(header.CONTACT_NAME)}
      , ${escape(header.POSITION_NAME)}
      , ${escape(header.DEPARTMENT_NAME)}
      , ${escape(header.CONTACT_EMAIL)}
      , (
          SELECT EAR_SURVEY_STAGE_ID
          FROM EAR_SURVEY_STAGE
          WHERE EAR_SURVEY_STAGE_CODE = ${escape(header.SURVEY_STAGE)}
            AND INUSE = 1
        )
      , ${escape(header.REVISION_NO)}
      , ${escape(header.REVISION_CODE)}
      , 1
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  setHeaderId: () => 'SET @EAR_SURVEY_HEADER_ID = LAST_INSERT_ID()',

  insertItem: (
    item: {
      ITEM_MANUFACTURING_ID: number | null
      PRE_TRADE_REFERENCE_NO: string | null
      DESCRIPTION: string | null
      MODEL: string | null
      REMARK: string | null
      EAR_SURVEY_STATUS_ID: number
      HS_CODE: string | null
      COUNTRY_ID: number | null
    },
    createBy: string,
    preTradeSequence: number | null
  ) => `
    INSERT INTO EAR_SURVEY_ITEM (
        EAR_SURVEY_HEADER_ID
      , ITEM_MANUFACTURING_ID
      , PRE_TRADE_REFERENCE_NO
      , DESCRIPTION
      , MODEL
      , REMARK
      , EAR_SURVEY_STATUS_ID
      , HS_CODE_ID
      , COUNTRY_ID
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        @EAR_SURVEY_HEADER_ID
      , ${escape(item.ITEM_MANUFACTURING_ID)}
      , ${
        item.PRE_TRADE_REFERENCE_NO
          ? escape(item.PRE_TRADE_REFERENCE_NO)
          : preTradeSequence
            ? `CONCAT('PTR-', @EAR_SURVEY_HEADER_ID, '-', LPAD(${escape(preTradeSequence)}, 3, '0'))`
            : 'NULL'
      }
      , ${escape(item.DESCRIPTION)}
      , ${escape(item.MODEL)}
      , ${escape(item.REMARK)}
      , ${escape(item.EAR_SURVEY_STATUS_ID)}
      , ${item.HS_CODE ? `(SELECT HS_CODE_ID FROM HS_CODE WHERE HS_CODE = ${escape(item.HS_CODE)} AND INUSE = 1)` : 'NULL'}
      , ${escape(item.COUNTRY_ID)}
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  setItemId: (itemIndex: number) => `SET @EAR_SURVEY_ITEM_ID_${itemIndex} = LAST_INSERT_ID()`,

  deactivateCurrentItemEarRevision: (itemManufacturingId: number, updateBy: string) => `
    UPDATE ITEM_MANUFACTURING_EAR_REVISION
    SET IS_CURRENT = 0
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE ITEM_MANUFACTURING_ID = ${escape(itemManufacturingId)}
      AND IS_CURRENT = 1
      AND INUSE = 1
  `,

  insertItemEarRevision: (itemIndex: number, itemManufacturingId: number, createBy: string) => `
    INSERT INTO ITEM_MANUFACTURING_EAR_REVISION (
        ITEM_MANUFACTURING_ID
      , REVISION_NO
      , EAR_SURVEY_ITEM_ID
      , IS_CURRENT
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT
        ${escape(itemManufacturingId)}
      , COALESCE(MAX(existing.REVISION_NO), 0) + 1
      , @EAR_SURVEY_ITEM_ID_${itemIndex}
      , 1
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM ITEM_MANUFACTURING_EAR_REVISION existing
    WHERE existing.ITEM_MANUFACTURING_ID = ${escape(itemManufacturingId)}
  `,

  insertItemEarRevisionForExistingSurveyItem: (earSurveyItemId: number, itemManufacturingId: number, createBy: string) => `
    INSERT INTO ITEM_MANUFACTURING_EAR_REVISION (
        ITEM_MANUFACTURING_ID
      , REVISION_NO
      , EAR_SURVEY_ITEM_ID
      , IS_CURRENT
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    SELECT
        ${escape(itemManufacturingId)}
      , COALESCE(MAX(existing.REVISION_NO), 0) + 1
      , ${escape(earSurveyItemId)}
      , 1
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    FROM ITEM_MANUFACTURING_EAR_REVISION existing
    WHERE existing.ITEM_MANUFACTURING_ID = ${escape(itemManufacturingId)}
  `,

  insertControl: (
    itemIndex: number,
    control: {
      ECCN_FULL_CODE: string
      COMPONENT_OF_PRODUCT: string
      REMARK: string | null
    },
    createBy: string
  ) => `
    INSERT INTO EAR_SURVEY_ITEM_CONTROL (
      EAR_SURVEY_ITEM_ID
      , ECCN_ID
      , COMPONENT_OF_PRODUCT
      , REMARK
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        @EAR_SURVEY_ITEM_ID_${itemIndex}
      , (
          SELECT ECCN_ID
          FROM ECCN
          WHERE ECCN_FULL_CODE = ${escape(control.ECCN_FULL_CODE)}
            AND INUSE = 1
        )
      , ${escape(control.COMPONENT_OF_PRODUCT)}
      , ${escape(control.REMARK)}
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  setControlId: (itemIndex: number, controlIndex: number) => `SET @EAR_SURVEY_ITEM_CONTROL_ID_${itemIndex}_${controlIndex} = LAST_INSERT_ID()`,

  insertControlReason: (itemIndex: number, controlIndex: number, reason: string, createBy: string) => `
    INSERT INTO EAR_SURVEY_ITEM_CONTROL_REASON (
        EAR_SURVEY_ITEM_CONTROL_ID
      , REASON_FOR_CONTROL
      , CREATE_BY
      , CREATE_DATE
      , UPDATE_BY
      , UPDATE_DATE
      , INUSE
    )
    VALUES (
        @EAR_SURVEY_ITEM_CONTROL_ID_${itemIndex}_${controlIndex}
      , ${escape(reason)}
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , ${escape(createBy)}
      , CURRENT_TIMESTAMP()
      , 1
    )
  `,

  setHeaderNotCurrent: (earSurveyHeaderId: number, updateBy: string) => `
    UPDATE EAR_SURVEY_HEADER
    SET IS_CURRENT = 0
      , INUSE = 0
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND EAR_SURVEY_STAGE_ID = (
        SELECT EAR_SURVEY_STAGE_ID
        FROM EAR_SURVEY_STAGE
        WHERE EAR_SURVEY_STAGE_CODE = 'ACTIVE'
      )
      AND IS_CURRENT = 1
      AND INUSE = 1
  `,

  updateItemRemark: (earSurveyItemId: number, remark: string | null, updateBy: string) => `
    UPDATE EAR_SURVEY_ITEM
    SET REMARK = ${escape(remark)}
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_ITEM_ID = ${escape(earSurveyItemId)}
      AND INUSE = 1
  `,

  updateControlRemark: (earSurveyItemControlId: number, remark: string | null, updateBy: string) => `
    UPDATE EAR_SURVEY_ITEM_CONTROL
    SET REMARK = ${escape(remark)}
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_ITEM_CONTROL_ID = ${escape(earSurveyItemControlId)}
      AND INUSE = 1
  `,

  activatePreTradeHeader: (earSurveyHeaderId: number, supplierCode: string, revisionNo: number, revisionCode: string, updateBy: string) => `
    UPDATE EAR_SURVEY_HEADER
    SET SUPPLIER_CODE = ${escape(supplierCode)}
      , EAR_SURVEY_STAGE_ID = (
          SELECT EAR_SURVEY_STAGE_ID
          FROM EAR_SURVEY_STAGE
          WHERE EAR_SURVEY_STAGE_CODE = 'ACTIVE'
            AND INUSE = 1
        )
      , REVISION_NO = ${escape(revisionNo)}
      , REVISION_CODE = ${escape(revisionCode)}
      , IS_CURRENT = 1
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND EAR_SURVEY_STAGE_ID = (
        SELECT EAR_SURVEY_STAGE_ID
        FROM EAR_SURVEY_STAGE
        WHERE EAR_SURVEY_STAGE_CODE = 'PRE_TRADE'
      )
      AND INUSE = 1
  `,

  updatePreTradeItemManufacturing: (earSurveyHeaderId: number, earSurveyItemId: number, itemManufacturingId: number, updateBy: string) => `
    UPDATE EAR_SURVEY_ITEM
    SET ITEM_MANUFACTURING_ID = ${escape(itemManufacturingId)}
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_ITEM_ID = ${escape(earSurveyItemId)}
      AND EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND INUSE = 1
  `,

  cancelPreTradeHeader: (earSurveyHeaderId: number, updateBy: string) => `
    UPDATE EAR_SURVEY_HEADER
    SET INUSE = 0
      , UPDATE_BY = ${escape(updateBy)}
      , UPDATE_DATE = CURRENT_TIMESTAMP()
    WHERE EAR_SURVEY_HEADER_ID = ${escape(earSurveyHeaderId)}
      AND EAR_SURVEY_STAGE_ID = (
        SELECT EAR_SURVEY_STAGE_ID
        FROM EAR_SURVEY_STAGE
        WHERE EAR_SURVEY_STAGE_CODE = 'PRE_TRADE'
      )
      AND INUSE = 1
  `,
}

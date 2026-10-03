import mysql from 'mysql2'

import type {
  CalDeMinimisCalculationRequest,
  CalDeMinimisThresholdSettingsUpdate,
} from '@src/_workspace/types/trade-compliance/CalDeMinimis'

const getDatabase = (environmentKey: 'MASTER_DATA_DB' | 'STANDARD_COST_DB'): string => {
  const database = process.env[environmentKey]

  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`${environmentKey} is not configured correctly`)
  }

  return `\`${database}\``
}

export const CalDeMinimisSQL = {
  getProductTypes: (search: string): string => {
    const masterDataDb = getDatabase('MASTER_DATA_DB')
    const standardCostDb = getDatabase('STANDARD_COST_DB')
    const normalizedSearch = search.trim()
    const searchCondition = normalizedSearch
      ? `
        AND (
          productType.PRODUCT_TYPE_CODE_FOR_SCT LIKE ${mysql.escape(`%${normalizedSearch}%`)}
          OR productType.PRODUCT_TYPE_NAME LIKE ${mysql.escape(`%${normalizedSearch}%`)}
        )`
      : ''

    return `
      SELECT DISTINCT
          productType.PRODUCT_TYPE_ID
        , productType.PRODUCT_TYPE_CODE_FOR_SCT AS PRODUCT_TYPE_CODE
        , productType.PRODUCT_TYPE_NAME
      FROM ${masterDataDb}.PRODUCT_TYPE productType
      JOIN ${masterDataDb}.PRODUCT_TYPE_ITEM_CATEGORY productTypeCategory
        ON productTypeCategory.PRODUCT_TYPE_ID = productType.PRODUCT_TYPE_ID
       AND productTypeCategory.ITEM_CATEGORY_ID = 1
       AND productTypeCategory.INUSE = 1
      JOIN ${standardCostDb}.SCT sct
        ON sct.PRODUCT_TYPE_ID = productType.PRODUCT_TYPE_ID
       AND sct.INUSE = 1
      JOIN ${standardCostDb}.SCT_PROGRESS_WORKING progress
        ON progress.SCT_ID = sct.SCT_ID
       AND progress.SCT_STATUS_PROGRESS_ID = 7
       AND progress.INUSE = 1
      JOIN ${standardCostDb}.SCT_TOTAL_COST totalCost
        ON totalCost.SCT_ID = sct.SCT_ID
       AND totalCost.INUSE = 1
      WHERE productType.INUSE = 1
        AND productType.PRODUCT_TYPE_IS_CURRENT = 1
        AND COALESCE(productType.PRODUCT_TYPE_CODE_FOR_SCT, '') <> ''
        AND CHAR_LENGTH(TRIM(productType.PRODUCT_TYPE_CODE_FOR_SCT)) = 8
        ${searchCondition}
      ORDER BY productType.PRODUCT_TYPE_CODE_FOR_SCT, productType.PRODUCT_TYPE_NAME
      LIMIT 50
    `
  },

  getSctRevisions: (productTypeId: number): string => {
    const masterDataDb = getDatabase('MASTER_DATA_DB')
    const standardCostDb = getDatabase('STANDARD_COST_DB')

    return `
      SELECT DISTINCT
          sct.SCT_ID
        , sct.SCT_REVISION_CODE
        , totalCost.SELLING_PRICE
      FROM ${standardCostDb}.SCT sct
      JOIN ${standardCostDb}.SCT_PROGRESS_WORKING progress
        ON progress.SCT_ID = sct.SCT_ID
       AND progress.SCT_STATUS_PROGRESS_ID = 7
       AND progress.INUSE = 1
      JOIN ${standardCostDb}.SCT_TOTAL_COST totalCost
        ON totalCost.SCT_ID = sct.SCT_ID
       AND totalCost.INUSE = 1
      JOIN ${masterDataDb}.PRODUCT_TYPE productType
        ON productType.PRODUCT_TYPE_ID = sct.PRODUCT_TYPE_ID
       AND productType.INUSE = 1
       AND productType.PRODUCT_TYPE_IS_CURRENT = 1
      JOIN ${masterDataDb}.PRODUCT_TYPE_ITEM_CATEGORY productTypeCategory
        ON productTypeCategory.PRODUCT_TYPE_ID = productType.PRODUCT_TYPE_ID
       AND productTypeCategory.ITEM_CATEGORY_ID = 1
       AND productTypeCategory.INUSE = 1
      WHERE sct.PRODUCT_TYPE_ID = ${mysql.escape(productTypeId)}
        AND sct.INUSE = 1
      ORDER BY sct.SCT_REVISION_CODE DESC
    `
  },

  getCalculationHeader: ({ PRODUCT_TYPE_ID, SCT_ID }: CalDeMinimisCalculationRequest): string => {
    const masterDataDb = getDatabase('MASTER_DATA_DB')
    const standardCostDb = getDatabase('STANDARD_COST_DB')

    return `
      SELECT
          sct.SCT_ID
        , sct.SCT_REVISION_CODE
        , productType.PRODUCT_TYPE_ID
        , productType.PRODUCT_TYPE_CODE_FOR_SCT AS PRODUCT_TYPE_CODE
        , productType.PRODUCT_TYPE_NAME
        , totalCost.SELLING_PRICE
      FROM ${standardCostDb}.SCT sct
      JOIN ${standardCostDb}.SCT_PROGRESS_WORKING progress
        ON progress.SCT_ID = sct.SCT_ID
       AND progress.SCT_STATUS_PROGRESS_ID = 7
       AND progress.INUSE = 1
      JOIN ${standardCostDb}.SCT_TOTAL_COST totalCost
        ON totalCost.SCT_ID = sct.SCT_ID
       AND totalCost.INUSE = 1
      JOIN ${masterDataDb}.PRODUCT_TYPE productType
        ON productType.PRODUCT_TYPE_ID = sct.PRODUCT_TYPE_ID
       AND productType.INUSE = 1
       AND productType.PRODUCT_TYPE_IS_CURRENT = 1
      JOIN ${masterDataDb}.PRODUCT_TYPE_ITEM_CATEGORY productTypeCategory
        ON productTypeCategory.PRODUCT_TYPE_ID = productType.PRODUCT_TYPE_ID
       AND productTypeCategory.ITEM_CATEGORY_ID = 1
       AND productTypeCategory.INUSE = 1
      WHERE sct.SCT_ID = ${mysql.escape(SCT_ID)}
        AND sct.PRODUCT_TYPE_ID = ${mysql.escape(PRODUCT_TYPE_ID)}
        AND sct.INUSE = 1
      LIMIT 1
    `
  },

  getProductTypeItems: (productTypeId: number): string => {
    const masterDataDb = getDatabase('MASTER_DATA_DB')

    return `
      SELECT DISTINCT
          itemManufacturing.ITEM_MANUFACTURING_ID
        , itemManufacturing.ITEM_CODE_FOR_SUPPORT_MES AS ITEM_CODE
      FROM ${masterDataDb}.ITEM_PRODUCT_DETAIL productDetail
      JOIN ${masterDataDb}.ITEM item
        ON item.ITEM_ID = productDetail.ITEM_ID
       AND item.ITEM_CATEGORY_ID = 1
       AND item.INUSE = 1
      JOIN ${masterDataDb}.ITEM_MANUFACTURING itemManufacturing
        ON itemManufacturing.ITEM_ID = item.ITEM_ID
       AND itemManufacturing.IS_CURRENT = 1
       AND itemManufacturing.INUSE = 1
      WHERE productDetail.PRODUCT_TYPE_ID = ${mysql.escape(productTypeId)}
        AND productDetail.INUSE = 1
      ORDER BY itemManufacturing.ITEM_CODE_FOR_SUPPORT_MES
    `
  },

  getBomRows: (sctId: string): string => {
    const masterDataDb = getDatabase('MASTER_DATA_DB')
    const standardCostDb = getDatabase('STANDARD_COST_DB')

    return `
      SELECT
          price.BOM_FLOW_PROCESS_ITEM_USAGE_ID
        , itemManufacturing.ITEM_MANUFACTURING_ID
        , itemManufacturing.ITEM_CODE_FOR_SUPPORT_MES AS ITEM_CODE
        , item.ITEM_CATEGORY_ID
        , itemCategory.ITEM_CATEGORY_NAME
        , usageItem.USAGE_QUANTITY
        , price.YIELD_ACCUMULATION
        , price.AMOUNT AS AMOUNT_WITH_IMPORT_FEE
        , COALESCE(
            materialPrice.ITEM_M_S_PRICE_WITHOUT_IMPORT_FEE_VALUE,
            materialPrice.ITEM_M_S_PRICE_VALUE / (1 + COALESCE(importFee.IMPORT_FEE_RATE, 0) / 100),
            originalPrice.PURCHASE_PRICE
              * (1 / NULLIF(exchangeRate.EXCHANGE_RATE_VALUE, 0))
              * (
                COALESCE(materialPrice.PURCHASE_UNIT_RATIO, itemManufacturing.PURCHASE_UNIT_RATIO)
                / NULLIF(COALESCE(materialPrice.USAGE_UNIT_RATIO, itemManufacturing.USAGE_UNIT_RATIO), 0)
              )
          ) AS PRICE_WITHOUT_IMPORT_FEE
        , originalPrice.PURCHASE_PRICE
        , purchaseCurrency.CURRENCY_SYMBOL AS PURCHASE_PRICE_CURRENCY
        , exchangeRate.EXCHANGE_RATE_VALUE
        , importFee.IMPORT_FEE_RATE
        , purchaseUnit.SYMBOL AS PURCHASE_UNIT
        , usageUnit.SYMBOL AS USAGE_UNIT
        , COALESCE(materialPrice.PURCHASE_UNIT_RATIO, itemManufacturing.PURCHASE_UNIT_RATIO) AS PURCHASE_UNIT_RATIO
        , COALESCE(materialPrice.USAGE_UNIT_RATIO, itemManufacturing.USAGE_UNIT_RATIO) AS USAGE_UNIT_RATIO
        , COALESCE(
            (
              SELECT adjustment.SCT_ID_SELECTION
              FROM ${standardCostDb}.SCT_BOM_FLOW_PROCESS_ITEM_USAGE_PRICE_ADJUST adjustment
              WHERE adjustment.SCT_ID = price.SCT_ID
                AND adjustment.BOM_FLOW_PROCESS_ITEM_USAGE_ID = price.BOM_FLOW_PROCESS_ITEM_USAGE_ID
                AND adjustment.IS_FROM_SCT_COPY <=> price.IS_FROM_SCT_COPY
                AND adjustment.SCT_ID_SELECTION IS NOT NULL
                AND adjustment.INUSE = 1
              ORDER BY adjustment.UPDATE_DATE DESC
              LIMIT 1
            ),
            (
              SELECT itemPriceSct.SCT_ID
              FROM ${masterDataDb}.ITEM_M_S_PRICE_SCT itemPriceSct
              WHERE itemPriceSct.ITEM_M_S_PRICE_ID = price.ITEM_M_S_PRICE_ID
                AND itemPriceSct.INUSE = 1
              ORDER BY itemPriceSct.UPDATE_DATE DESC
              LIMIT 1
            )
          ) AS CHILD_SCT_ID
        , childSct.SCT_REVISION_CODE AS CHILD_SCT_REVISION_CODE
      FROM ${standardCostDb}.SCT_BOM_FLOW_PROCESS_ITEM_USAGE_PRICE price
      JOIN ${masterDataDb}.BOM_FLOW_PROCESS_ITEM_USAGE usageItem
        ON usageItem.BOM_FLOW_PROCESS_ITEM_USAGE_ID = price.BOM_FLOW_PROCESS_ITEM_USAGE_ID
       AND usageItem.INUSE = 1
      JOIN ${masterDataDb}.ITEM item
        ON item.ITEM_ID = usageItem.ITEM_ID
       AND item.INUSE = 1
      JOIN ${masterDataDb}.ITEM_CATEGORY itemCategory
        ON itemCategory.ITEM_CATEGORY_ID = item.ITEM_CATEGORY_ID
       AND itemCategory.INUSE = 1
      LEFT JOIN ${masterDataDb}.ITEM_MANUFACTURING itemManufacturing
        ON itemManufacturing.ITEM_ID = item.ITEM_ID
       AND itemManufacturing.IS_CURRENT = 1
       AND itemManufacturing.INUSE = 1
      LEFT JOIN ${masterDataDb}.ITEM_M_S_PRICE materialPrice
        ON materialPrice.ITEM_M_S_PRICE_ID = price.ITEM_M_S_PRICE_ID
       AND materialPrice.INUSE = 1
      LEFT JOIN ${masterDataDb}.ITEM_M_O_PRICE originalPrice
        ON originalPrice.ITEM_M_O_PRICE_ID = materialPrice.ITEM_M_O_PRICE_ID
       AND originalPrice.INUSE = 1
      LEFT JOIN ${masterDataDb}.CURRENCY purchaseCurrency
        ON purchaseCurrency.CURRENCY_ID = originalPrice.PURCHASE_PRICE_CURRENCY_ID
       AND purchaseCurrency.INUSE = 1
      LEFT JOIN ${masterDataDb}.EXCHANGE_RATE exchangeRate
        ON exchangeRate.EXCHANGE_RATE_ID = materialPrice.EXCHANGE_RATE_ID
       AND exchangeRate.INUSE = 1
      LEFT JOIN ${masterDataDb}.IMPORT_FEE importFee
        ON importFee.IMPORT_FEE_ID = materialPrice.IMPORT_FEE_ID
       AND importFee.INUSE = 1
      LEFT JOIN ${masterDataDb}.UNIT_OF_MEASUREMENT purchaseUnit
        ON purchaseUnit.UNIT_OF_MEASUREMENT_ID = itemManufacturing.PURCHASE_UNIT_ID
       AND purchaseUnit.INUSE = 1
      LEFT JOIN ${masterDataDb}.UNIT_OF_MEASUREMENT usageUnit
        ON usageUnit.UNIT_OF_MEASUREMENT_ID = itemManufacturing.USAGE_UNIT_ID
       AND usageUnit.INUSE = 1
      LEFT JOIN ${standardCostDb}.SCT childSct
        ON childSct.SCT_ID = COALESCE(
          (
            SELECT adjustment.SCT_ID_SELECTION
            FROM ${standardCostDb}.SCT_BOM_FLOW_PROCESS_ITEM_USAGE_PRICE_ADJUST adjustment
            WHERE adjustment.SCT_ID = price.SCT_ID
              AND adjustment.BOM_FLOW_PROCESS_ITEM_USAGE_ID = price.BOM_FLOW_PROCESS_ITEM_USAGE_ID
              AND adjustment.IS_FROM_SCT_COPY <=> price.IS_FROM_SCT_COPY
              AND adjustment.SCT_ID_SELECTION IS NOT NULL
              AND adjustment.INUSE = 1
            ORDER BY adjustment.UPDATE_DATE DESC
            LIMIT 1
          ),
          (
            SELECT itemPriceSct.SCT_ID
            FROM ${masterDataDb}.ITEM_M_S_PRICE_SCT itemPriceSct
            WHERE itemPriceSct.ITEM_M_S_PRICE_ID = price.ITEM_M_S_PRICE_ID
              AND itemPriceSct.INUSE = 1
            ORDER BY itemPriceSct.UPDATE_DATE DESC
            LIMIT 1
          )
        )
       AND childSct.INUSE = 1
      WHERE price.SCT_ID = ${mysql.escape(sctId)}
        AND price.INUSE = 1
      ORDER BY usageItem.NO, price.BOM_FLOW_PROCESS_ITEM_USAGE_ID
    `
  },

  getClassifications: (itemManufacturingIds: number[]): string => {
    if (itemManufacturingIds.length === 0) return 'SELECT NULL WHERE FALSE'

    const ids = itemManufacturingIds.map((id) => mysql.escape(id)).join(', ')

    return `
      SELECT
          selectedItem.ITEM_MANUFACTURING_ID
        , country.COUNTRY_ID
        , country.COUNTRY_NAME
        , country.COUNTRY_ALPHA2
        , country.COUNTRY_ALPHA3
        , eccn.ECCN_ID
        , eccn.ECCN_FULL_CODE
        , itemEarStatus.EAR_SURVEY_STATUS_CODE
        , CASE WHEN fecEccn.ECCN_FEC_ID IS NULL THEN 0 ELSE 1 END AS IS_FEC_CONTROLLED
      FROM (
        SELECT ITEM_MANUFACTURING_ID
        FROM ITEM_MANUFACTURING_COUNTRY_OF_ORIGIN
        WHERE ITEM_MANUFACTURING_ID IN (${ids})
        UNION
        SELECT ITEM_MANUFACTURING_ID
        FROM ITEM_MANUFACTURING_ECCN
        WHERE ITEM_MANUFACTURING_ID IN (${ids})
        UNION
        SELECT item.ITEM_MANUFACTURING_ID
        FROM EAR_SURVEY_ITEM item
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.IS_CURRENT = 1
         AND header.INUSE = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
         AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
         AND stage.INUSE = 1
        WHERE item.ITEM_MANUFACTURING_ID IN (${ids})
          AND item.INUSE = 1
      ) selectedItem
      LEFT JOIN ITEM_MANUFACTURING_COUNTRY_OF_ORIGIN itemCountry
        ON itemCountry.ITEM_MANUFACTURING_ID = selectedItem.ITEM_MANUFACTURING_ID
       AND itemCountry.INUSE = 1
      LEFT JOIN COUNTRY country
        ON country.COUNTRY_ID = itemCountry.COUNTRY_ID
       AND country.INUSE = 1
      LEFT JOIN ITEM_MANUFACTURING_ECCN itemEccn
        ON itemEccn.ITEM_MANUFACTURING_ID = selectedItem.ITEM_MANUFACTURING_ID
       AND itemEccn.INUSE = 1
      LEFT JOIN ECCN eccn
        ON eccn.ECCN_ID = itemEccn.ECCN_ID
       AND eccn.INUSE = 1
      LEFT JOIN ECCN_FEC fecEccn
        ON fecEccn.ECCN_ID = eccn.ECCN_ID
       AND fecEccn.INUSE = 1
      LEFT JOIN (
        SELECT DISTINCT
            item.ITEM_MANUFACTURING_ID
          , status.EAR_SURVEY_STATUS_CODE
        FROM EAR_SURVEY_ITEM item
        JOIN EAR_SURVEY_HEADER header
          ON header.EAR_SURVEY_HEADER_ID = item.EAR_SURVEY_HEADER_ID
         AND header.IS_CURRENT = 1
         AND header.INUSE = 1
        JOIN EAR_SURVEY_STAGE stage
          ON stage.EAR_SURVEY_STAGE_ID = header.EAR_SURVEY_STAGE_ID
         AND stage.EAR_SURVEY_STAGE_CODE = 'ACTIVE'
         AND stage.INUSE = 1
        JOIN EAR_SURVEY_STATUS status
          ON status.EAR_SURVEY_STATUS_ID = item.EAR_SURVEY_STATUS_ID
         AND status.INUSE = 1
        WHERE item.ITEM_MANUFACTURING_ID IN (${ids})
          AND item.INUSE = 1
      ) itemEarStatus
        ON itemEarStatus.ITEM_MANUFACTURING_ID = selectedItem.ITEM_MANUFACTURING_ID
      ORDER BY selectedItem.ITEM_MANUFACTURING_ID, country.COUNTRY_NAME, eccn.ECCN_FULL_CODE
    `
  },

  getThresholdSettings: (): string => `
    SELECT
        CAL_DE_MINIMIS_SETTING_ID
      , SETTING_CODE
      , US_ORIGIN_THRESHOLD_PERCENT
      , FEC_CONTROLLED_THRESHOLD_PERCENT
      , CREATE_BY
      , DATE_FORMAT(CREATE_DATE, '%d-%b-%Y %H:%i:%s') AS CREATE_DATE
      , UPDATE_BY
      , DATE_FORMAT(UPDATE_DATE, '%d-%b-%Y %H:%i:%s') AS UPDATE_DATE
    FROM CAL_DE_MINIMIS_SETTING
    WHERE SETTING_CODE = 'DEFAULT'
      AND INUSE = 1
    LIMIT 1
  `,

  updateThresholdSettings: ({
    US_ORIGIN_THRESHOLD_PERCENT,
    FEC_CONTROLLED_THRESHOLD_PERCENT,
    UPDATE_BY,
  }: CalDeMinimisThresholdSettingsUpdate): string => `
    UPDATE CAL_DE_MINIMIS_SETTING
    SET US_ORIGIN_THRESHOLD_PERCENT = ${mysql.escape(US_ORIGIN_THRESHOLD_PERCENT)}
      , FEC_CONTROLLED_THRESHOLD_PERCENT = ${mysql.escape(FEC_CONTROLLED_THRESHOLD_PERCENT)}
      , UPDATE_BY = ${mysql.escape(UPDATE_BY)}
      , UPDATE_DATE = CURRENT_TIMESTAMP
    WHERE SETTING_CODE = 'DEFAULT'
      AND INUSE = 1
  `,
}

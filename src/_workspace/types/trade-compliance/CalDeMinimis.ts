export type DeMinimisLayerResultStatus = 'PASS' | 'FAIL'
export type DeMinimisOverallResultStatus = 'NOT_CONCERN' | 'CONCERN_EAR'
export type DeMinimisResultStatus = DeMinimisLayerResultStatus

export interface CalDeMinimisProductTypeOption {
  PRODUCT_TYPE_ID: number
  PRODUCT_TYPE_CODE: string
  PRODUCT_TYPE_NAME: string
}

export interface CalDeMinimisSctOption {
  SCT_ID: string
  SCT_REVISION_CODE: string
  SELLING_PRICE: number
}

export interface CalDeMinimisCalculationRequest {
  PRODUCT_TYPE_ID: number
  SCT_ID: string
}

export interface CalDeMinimisThresholdSettings {
  CAL_DE_MINIMIS_SETTING_ID: number
  SETTING_CODE: string
  US_ORIGIN_THRESHOLD_PERCENT: number
  FEC_CONTROLLED_THRESHOLD_PERCENT: number
  CREATE_BY: string
  CREATE_DATE: string
  UPDATE_BY: string
  UPDATE_DATE: string
}

export interface CalDeMinimisThresholdSettingsUpdate {
  US_ORIGIN_THRESHOLD_PERCENT: number
  FEC_CONTROLLED_THRESHOLD_PERCENT: number
  UPDATE_BY: string
}

export interface CalDeMinimisLayerResult {
  MATERIAL_VALUE: number
  RATIO_PERCENT: number
  THRESHOLD_PERCENT: number
  RESULT: DeMinimisLayerResultStatus
}

export interface CalDeMinimisBomDetail {
  ITEM_MANUFACTURING_ID: number
  ITEM_CODE: string
  ITEM_CATEGORY_ID: 4 | 6
  ITEM_CATEGORY_NAME: string
  COUNTRY_OF_ORIGINS: string[]
  ECCN_CODES: string[]
  EAR_STATUS_CODES: string[]
  FEC_ECCN_CODES: string[]
  PRICE_WITHOUT_IMPORT_FEE: number
  AMOUNT_WITHOUT_IMPORT_FEE: number
  AMOUNT_WITH_IMPORT_FEE: number | null
  PURCHASE_PRICE: number | null
  PURCHASE_PRICE_CURRENCY: string | null
  EXCHANGE_RATE_VALUE: number | null
  IMPORT_FEE_RATE: number | null
  PURCHASE_UNIT: string | null
  USAGE_UNIT: string | null
  PURCHASE_UNIT_RATIO: number | null
  USAGE_UNIT_RATIO: number | null
  USAGE_QUANTITY: number
  EFFECTIVE_USAGE_QUANTITY: number
  YIELD_ACCUMULATION: number | null
  IS_US_ORIGIN: boolean
  IS_FEC_CONTROLLED: boolean
  BOM_LEVEL: number
  BOM_PATHS: string[]
}

export interface CalDeMinimisCalculationResult {
  PRODUCT_TYPE_ID: number
  PRODUCT_TYPE_CODE: string
  PRODUCT_TYPE_NAME: string
  SCT_ID: string
  SCT_REVISION_CODE: string
  FINISHED_GOOD_PRICE: number | null
  TOTAL_MATERIAL_VALUE: number
  LAYER_1_US_ORIGIN: CalDeMinimisLayerResult
  LAYER_2_FEC_CONTROLLED: CalDeMinimisLayerResult
  OVERALL_RESULT: DeMinimisOverallResultStatus
  BOM_DETAILS: CalDeMinimisBomDetail[]
}

export interface CalDeMinimisResponse<T> {
  Status: boolean
  Message: string
  ResultOnDb: T[]
  MethodOnDb: string
  TotalCountOnDb: number
}

export interface CalDeMinimisHeaderRow {
  SCT_ID: string
  SCT_REVISION_CODE: string
  PRODUCT_TYPE_ID: number
  PRODUCT_TYPE_CODE: string
  PRODUCT_TYPE_NAME: string
  SELLING_PRICE: number | null
}

export interface CalDeMinimisProductItemRow {
  ITEM_MANUFACTURING_ID: number
  ITEM_CODE: string | null
}

export interface CalDeMinimisBomPriceRow {
  BOM_FLOW_PROCESS_ITEM_USAGE_ID: number
  ITEM_MANUFACTURING_ID: number | null
  ITEM_CODE: string | null
  ITEM_CATEGORY_ID: number
  ITEM_CATEGORY_NAME: string
  USAGE_QUANTITY: number
  YIELD_ACCUMULATION: number | null
  AMOUNT_WITH_IMPORT_FEE: number | null
  PRICE_WITHOUT_IMPORT_FEE: number | null
  PURCHASE_PRICE: number | null
  PURCHASE_PRICE_CURRENCY: string | null
  EXCHANGE_RATE_VALUE: number | null
  IMPORT_FEE_RATE: number | null
  PURCHASE_UNIT: string | null
  USAGE_UNIT: string | null
  PURCHASE_UNIT_RATIO: number | null
  USAGE_UNIT_RATIO: number | null
  CHILD_SCT_ID: string | null
  CHILD_SCT_REVISION_CODE: string | null
}

export interface CalDeMinimisClassificationRow {
  ITEM_MANUFACTURING_ID: number
  COUNTRY_ID: number | null
  COUNTRY_NAME: string | null
  COUNTRY_ALPHA2: string | null
  COUNTRY_ALPHA3: string | null
  ECCN_ID: number | null
  ECCN_FULL_CODE: string | null
  EAR_SURVEY_STATUS_CODE: string | null
  IS_FEC_CONTROLLED: number
}

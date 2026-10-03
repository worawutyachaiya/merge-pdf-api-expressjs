import { MySQLExecute } from '@businessData/dbExecute'
import { EarSurveySQL } from '@src/_workspace/sql/trade-compliance/EarSurveySQL'
import { RowDataPacket } from 'mysql2'

type SurveyStage = 'ACTIVE' | 'PRE_TRADE'

type CountryRow = RowDataPacket & {
  COUNTRY_ID: number
  COUNTRY_NAME: string
  COUNTRY_ALPHA2: string | null
  COUNTRY_ALPHA3: string | null
}

type EarSurveyHeaderImport = {
  REQUEST_DATE: string
  SUPPLIER_CODE?: string | null
  SUPPLIER_NAME: string
  CONTACT_TEL: string
  CONTACT_NAME: string
  POSITION_NAME: string
  DEPARTMENT_NAME: string
  CONTACT_EMAIL: string
}

type EarSurveyRowImport = {
  EXCEL_ROW_NO: number
  SURVEY_ITEM_NO?: string | null
  ITEM_CODE?: string | null
  DESCRIPTION?: string | null
  MODEL?: string | null
  EAR_SURVEY_STATUS_NAME: string
  ECCN_FULL_CODE?: string | null
  REASON_FOR_CONTROL?: string | null
  COUNTRY_NAME?: string | null
  HS_CODE?: string | null
  COMPONENT_OF_PRODUCT?: string | null
  REMARK?: string | null
}

type EarSurveyImportPayload = {
  HEADER: EarSurveyHeaderImport
  ROWS: EarSurveyRowImport[]
  CREATE_BY: string
}

type ActivatePreTradePayload = {
  EAR_SURVEY_HEADER_ID: number
  SUPPLIER_CODE: string
  ITEM_MAPPINGS: Array<{
    EAR_SURVEY_ITEM_ID: number
    ITEM_MANUFACTURING_ID: number
  }>
  UPDATE_BY: string
}

type CancelPreTradePayload = {
  EAR_SURVEY_HEADER_ID: number
  UPDATE_BY: string
}

type ImportValidationError = {
  ROW_NO: number | null
  FIELD: string
  MESSAGE: string
}

type NormalizedEccn = {
  ECCN_CODE: string
  ECCN_SUB_CODE: string | null
  ECCN_FULL_CODE: string
}

type NormalizedRow = {
  EXCEL_ROW_NO: number
  SURVEY_ITEM_NO: string
  ITEM_KEY: string
  ITEM_CODE: string
  DESCRIPTION: string
  MODEL: string
  EAR_SURVEY_STATUS_NAME: string
  ECCN: NormalizedEccn | null
  REASON_FOR_CONTROL: string
  COUNTRY_NAME: string
  HS_CODE: string
  COMPONENT_OF_PRODUCT: string
  REMARK: string
}

type PreparedControl = {
  EAR_SURVEY_ITEM_CONTROL_ID?: number
  ECCN: NormalizedEccn
  REASONS: string[]
  COMPONENT_OF_PRODUCT: string
  REMARK: string | null
}

type PreparedItem = {
  EAR_SURVEY_ITEM_ID?: number
  EXCEL_ROW_NO?: number | null
  ITEM_KEY: string
  ITEM_CODE: string | null
  ITEM_MANUFACTURING_ID: number | null
  PRE_TRADE_REFERENCE_NO: string | null
  DESCRIPTION: string | null
  MODEL: string | null
  REMARK: string | null
  EAR_SURVEY_STATUS_ID: number
  HS_CODE: string | null
  COUNTRY_ID: number | null
  CONTROLS: PreparedControl[]
}

type PreparedHeader = EarSurveyHeaderImport & {
  SUPPLIER_CODE: string | null
  SURVEY_STAGE: SurveyStage
  REVISION_NO: number | null
  REVISION_CODE: string | null
}

const normalizeText = (value: unknown) => `${value ?? ''}`.trim()
const normalizeLookupKey = (value: unknown) => normalizeText(value).replace(/\s+/g, ' ').toUpperCase()
const parseReasons = (value: unknown) => {
  const reasons = new Map<string, string>()

  for (const reason of normalizeText(value).split(',')) {
    const normalizedReason = normalizeText(reason)
    if (normalizedReason) reasons.set(normalizeLookupKey(normalizedReason), normalizedReason)
  }

  return Array.from(reasons.values())
}
const normalizeCountryKey = (value: unknown) =>
  normalizeLookupKey(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[.'\u2019]/g, '')
    .replace(/\s*&\s*/g, ' AND ')
    .replace(/\s+/g, ' ')

const parseEccn = (value: unknown): NormalizedEccn | null => {
  const normalized = normalizeText(value).replace(/\s+/g, '')

  if (!normalized) return null

  const match = normalized.match(/^([0-9][A-Z][0-9]{3}|EAR99)(?:\.([A-Z0-9]+(?:\.[A-Z0-9]+)*))?$/i)

  if (!match) return null

  const eccnCode = match[1].toUpperCase()
  const eccnSubCode = match[2]?.toLowerCase() ?? null

  return {
    ECCN_CODE: eccnCode,
    ECCN_SUB_CODE: eccnSubCode,
    ECCN_FULL_CODE: eccnSubCode ? `${eccnCode}.${eccnSubCode}` : eccnCode,
  }
}

const pushError = (errors: ImportValidationError[], rowNo: number | null, field: string, message: string) => {
  errors.push({ ROW_NO: rowNo, FIELD: field, MESSAGE: message })
}

const validationFailure = (errors: ImportValidationError[], message = 'Validation failed. No data was imported.') => ({
  Status: false,
  ResultOnDb: errors,
  TotalCountOnDb: errors.length,
  Message: message,
})

const normalizeHeader = (header: EarSurveyHeaderImport, stage: SurveyStage): PreparedHeader => ({
  REQUEST_DATE: normalizeText(header?.REQUEST_DATE),
  SUPPLIER_CODE: stage === 'PRE_TRADE' ? null : normalizeText(header?.SUPPLIER_CODE) || null,
  SUPPLIER_NAME: normalizeText(header?.SUPPLIER_NAME),
  CONTACT_TEL: normalizeText(header?.CONTACT_TEL),
  CONTACT_NAME: normalizeText(header?.CONTACT_NAME),
  POSITION_NAME: normalizeText(header?.POSITION_NAME),
  DEPARTMENT_NAME: normalizeText(header?.DEPARTMENT_NAME),
  CONTACT_EMAIL: normalizeText(header?.CONTACT_EMAIL),
  SURVEY_STAGE: stage,
  REVISION_NO: null,
  REVISION_CODE: null,
})

const validateHeader = (header: PreparedHeader, sourceHeader: EarSurveyHeaderImport, stage: SurveyStage, errors: ImportValidationError[]) => {
  const requiredFields: Array<keyof EarSurveyHeaderImport> = ['REQUEST_DATE', 'SUPPLIER_NAME', 'CONTACT_TEL', 'CONTACT_NAME', 'POSITION_NAME', 'DEPARTMENT_NAME', 'CONTACT_EMAIL']

  if (stage === 'ACTIVE') requiredFields.splice(1, 0, 'SUPPLIER_CODE')

  for (const field of requiredFields) {
    if (!normalizeText(header[field])) pushError(errors, null, field, `${field} is required`)
  }

  const sourceSupplierCode = normalizeText(sourceHeader?.SUPPLIER_CODE)
  if (stage === 'PRE_TRADE' && sourceSupplierCode !== '-') {
    pushError(errors, null, 'SUPPLIER_CODE', 'Supplier Code must be - for EAR Survey Pre-Trade')
  }
  if (stage === 'ACTIVE' && sourceSupplierCode === '-') {
    pushError(errors, null, 'SUPPLIER_CODE', 'Supplier Code must be an actual Supplier Code for EAR Survey')
  }

  if (header.REQUEST_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(header.REQUEST_DATE)) {
    pushError(errors, null, 'REQUEST_DATE', 'Request Date must be in YYYY-MM-DD format')
  }

  if (header.CONTACT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(header.CONTACT_EMAIL)) {
    pushError(errors, null, 'CONTACT_EMAIL', 'Contact Email is invalid')
  }
}

const normalizeRows = (rows: EarSurveyRowImport[], stage: SurveyStage, errors: ImportValidationError[]) => {
  const normalizedRows: NormalizedRow[] = []

  for (const row of rows ?? []) {
    const rowNo = Number(row?.EXCEL_ROW_NO)
    const surveyItemNo = normalizeText(row?.SURVEY_ITEM_NO)
    const itemCode = normalizeText(row?.ITEM_CODE)
    const itemKey = stage === 'ACTIVE' ? itemCode : surveyItemNo

    if (!itemCode && !surveyItemNo && !normalizeText(row?.EAR_SURVEY_STATUS_NAME)) continue

    if (!itemKey) {
      const itemCodeField = stage === 'ACTIVE' ? 'ITEM_CODE' : 'SURVEY_ITEM_NO'
      pushError(errors, Number.isInteger(rowNo) && rowNo > 0 ? rowNo : null, itemCodeField, `${itemCodeField} is required`)
    }

    if (stage === 'PRE_TRADE' && itemCode !== '-') {
      pushError(errors, rowNo, 'ITEM_CODE', 'M-Code must be - for EAR Survey Pre-Trade')
    }
    if (stage === 'ACTIVE' && itemCode === '-') {
      pushError(errors, rowNo, 'ITEM_CODE', 'Item Code must be an actual Manufacturing Item Code for EAR Survey')
    }

    const eccnText = normalizeText(row?.ECCN_FULL_CODE)
    const eccn = parseEccn(eccnText)

    if (!Number.isInteger(rowNo) || rowNo <= 0) pushError(errors, null, 'EXCEL_ROW_NO', 'Excel row number is invalid')
    if (!normalizeText(row?.EAR_SURVEY_STATUS_NAME)) pushError(errors, rowNo, 'EAR_SURVEY_STATUS_NAME', 'EAR Status is required')
    if (eccnText && !eccn) pushError(errors, rowNo, 'ECCN_FULL_CODE', `ECCN "${eccnText}" is invalid`)

    normalizedRows.push({
      EXCEL_ROW_NO: rowNo,
      SURVEY_ITEM_NO: surveyItemNo,
      ITEM_KEY: itemKey,
      ITEM_CODE: itemCode,
      DESCRIPTION: normalizeText(row?.DESCRIPTION),
      MODEL: normalizeText(row?.MODEL),
      EAR_SURVEY_STATUS_NAME: normalizeText(row?.EAR_SURVEY_STATUS_NAME),
      ECCN: eccn,
      REASON_FOR_CONTROL: normalizeText(row?.REASON_FOR_CONTROL),
      COUNTRY_NAME: normalizeText(row?.COUNTRY_NAME),
      HS_CODE: normalizeText(row?.HS_CODE),
      COMPONENT_OF_PRODUCT: normalizeText(row?.COMPONENT_OF_PRODUCT),
      REMARK: normalizeText(row?.REMARK),
    })
  }

  if (normalizedRows.length === 0) pushError(errors, null, 'ROWS', 'No survey item was found in the Excel file')

  return normalizedRows
}

const getDistinctValues = (rows: NormalizedRow[], field: keyof NormalizedRow) =>
  Array.from(
    new Set(
      rows
        .map((row) => normalizeText(row[field]))
        .filter(Boolean)
        .map(normalizeLookupKey)
    )
  )

const validateGroupRows = (itemKey: string, rows: NormalizedRow[], errors: ImportValidationError[]) => {
  // Country consistency is checked by COUNTRY_ID after resolving names and codes.
  const sharedFields: Array<keyof NormalizedRow> = ['DESCRIPTION', 'MODEL', 'EAR_SURVEY_STATUS_NAME', 'HS_CODE']

  for (const field of sharedFields) {
    if (getDistinctValues(rows, field).length > 1) {
      for (const row of rows) pushError(errors, row.EXCEL_ROW_NO, String(field), `${String(field)} must be the same for Item ${itemKey}`)
    }
  }

  const statusKey = normalizeLookupKey(rows[0]?.EAR_SURVEY_STATUS_NAME)
  const isApplicable = statusKey === 'APPLICABLE'
  const isNotApplicable = statusKey === 'NOT APPLICABLE'

  if (!isApplicable && !isNotApplicable) {
    for (const row of rows) pushError(errors, row.EXCEL_ROW_NO, 'EAR_SURVEY_STATUS_NAME', 'EAR Status must be Applicable or Not Applicable')
    return
  }

  if (isNotApplicable && rows.length > 1) {
    const rowNumbers = rows.map((row) => row.EXCEL_ROW_NO)
    for (const rowNo of rowNumbers) {
      const duplicateField = rows[0].SURVEY_ITEM_NO ? 'SURVEY_ITEM_NO' : 'ITEM_CODE'
      pushError(errors, rowNo, duplicateField, `Not Applicable Item ${itemKey} must appear only once; duplicated on rows ${rowNumbers.join(', ')}`)
    }
  }

  const duplicateEccn = new Map<string, number[]>()

  for (const row of rows) {
    if (!row.COUNTRY_NAME) pushError(errors, row.EXCEL_ROW_NO, 'COUNTRY_NAME', 'COUNTRY_NAME is required')

    if (isApplicable) {
      const requiredValues = [
        ['ECCN_FULL_CODE', row.ECCN?.ECCN_FULL_CODE],
        ['REASON_FOR_CONTROL', parseReasons(row.REASON_FOR_CONTROL).length],
        ['HS_CODE', row.HS_CODE],
        ['COMPONENT_OF_PRODUCT', row.COMPONENT_OF_PRODUCT],
      ] as const

      for (const [field, value] of requiredValues) {
        if (!value) pushError(errors, row.EXCEL_ROW_NO, field, `${field} is required when EAR Status is Applicable`)
      }

      if (row.ECCN) {
        const rowNumbers = duplicateEccn.get(row.ECCN.ECCN_FULL_CODE) ?? []
        rowNumbers.push(row.EXCEL_ROW_NO)
        duplicateEccn.set(row.ECCN.ECCN_FULL_CODE, rowNumbers)
      }
    } else {
      const conditionalValues = [
        ['ECCN_FULL_CODE', row.ECCN?.ECCN_FULL_CODE],
        ['REASON_FOR_CONTROL', row.REASON_FOR_CONTROL],
        ['HS_CODE', row.HS_CODE],
        ['COMPONENT_OF_PRODUCT', row.COMPONENT_OF_PRODUCT],
      ] as const

      for (const [field, value] of conditionalValues) {
        if (value) pushError(errors, row.EXCEL_ROW_NO, field, `${field} must be blank when EAR Status is Not Applicable`)
      }
    }
  }

  for (const [eccn, rowNumbers] of duplicateEccn) {
    if (rowNumbers.length > 1) {
      for (const rowNo of rowNumbers) {
        pushError(errors, rowNo, 'ECCN_FULL_CODE', `ECCN ${eccn} is duplicated for Item ${itemKey} on rows ${rowNumbers.join(', ')}`)
      }
    }
  }
}

const groupRows = (rows: NormalizedRow[]) => {
  const rowsByItemKey = new Map<string, NormalizedRow[]>()

  for (const row of rows) {
    const key = normalizeLookupKey(row.ITEM_KEY)
    const groupedRows = rowsByItemKey.get(key) ?? []
    groupedRows.push(row)
    rowsByItemKey.set(key, groupedRows)
  }

  return rowsByItemKey
}

const prepareItems = async (rowsByItemKey: Map<string, NormalizedRow[]>, stage: SurveyStage, errors: ImportValidationError[]): Promise<PreparedItem[]> => {
  const itemCodes = stage === 'ACTIVE' ? Array.from(rowsByItemKey.values()).map((rows) => rows[0].ITEM_CODE) : []
  const lookupSql =
    stage === 'ACTIVE'
      ? [EarSurveySQL.getItemManufacturingByCodes(itemCodes), EarSurveySQL.getEarStatuses(), EarSurveySQL.getCountries()]
      : [EarSurveySQL.getEarStatuses(), EarSurveySQL.getCountries()]
  const lookupResults = (await MySQLExecute.searchList(lookupSql)) as RowDataPacket[][]
  const itemManufacturingRows = stage === 'ACTIVE' ? (lookupResults[0] ?? []) : []
  const earStatusRows = stage === 'ACTIVE' ? (lookupResults[1] ?? []) : (lookupResults[0] ?? [])
  const countryRows = stage === 'ACTIVE' ? (lookupResults[2] ?? []) : (lookupResults[1] ?? [])
  const itemMap = new Map<string, any[]>()

  for (const item of itemManufacturingRows as any[]) {
    const key = normalizeLookupKey(item.ITEM_CODE_FOR_SUPPORT_MES)
    itemMap.set(key, [...(itemMap.get(key) ?? []), item])
  }

  const statusMap = new Map<string, any>()
  for (const status of earStatusRows as any[]) statusMap.set(normalizeLookupKey(status.EAR_SURVEY_STATUS_NAME), status)

  const countryMap = new Map<string, CountryRow | null>()
  for (const country of countryRows as CountryRow[]) {
    for (const value of [country.COUNTRY_NAME, country.COUNTRY_ALPHA2, country.COUNTRY_ALPHA3]) {
      const key = normalizeCountryKey(value)
      if (!key) continue
      const existing = countryMap.get(key)
      countryMap.set(key, existing !== undefined && existing?.COUNTRY_ID !== country.COUNTRY_ID ? null : country)
    }
  }

  const preparedItems: PreparedItem[] = []

  for (const groupedRows of rowsByItemKey.values()) {
    const firstRow = groupedRows[0]
    const itemCandidates = stage === 'ACTIVE' ? (itemMap.get(normalizeLookupKey(firstRow.ITEM_CODE)) ?? []) : []
    const status = statusMap.get(normalizeLookupKey(firstRow.EAR_SURVEY_STATUS_NAME))
    const isApplicable = status?.EAR_SURVEY_STATUS_CODE === 'APPLICABLE'
    const countries = groupedRows.map((row) => {
      const key = normalizeCountryKey(row.COUNTRY_NAME)
      const country = countryMap.get(key)
      if (!country) {
        pushError(
          errors,
          row.EXCEL_ROW_NO,
          'COUNTRY_NAME',
          countryMap.has(key) ? `Country ${row.COUNTRY_NAME} matches more than one country` : `Country name or code ${row.COUNTRY_NAME} was not found in active COUNTRY`
        )
      }
      return country
    })
    const country = countries[0]
    const hasCountryConflict = new Set(countries.filter((value): value is CountryRow => Boolean(value)).map((value) => value.COUNTRY_ID)).size > 1
    if (hasCountryConflict) {
      for (const row of groupedRows) pushError(errors, row.EXCEL_ROW_NO, 'COUNTRY_NAME', `Country must be the same for Item ${firstRow.ITEM_KEY}`)
    }

    if (stage === 'ACTIVE' && itemCandidates.length === 0) {
      pushError(errors, firstRow.EXCEL_ROW_NO, 'ITEM_CODE', `Item Code ${firstRow.ITEM_CODE} was not found in current active Manufacturing Item`)
    } else if (stage === 'ACTIVE' && itemCandidates.length > 1) {
      pushError(errors, firstRow.EXCEL_ROW_NO, 'ITEM_CODE', `Item Code ${firstRow.ITEM_CODE} has more than one current active Manufacturing Item`)
    }

    if (!status) pushError(errors, firstRow.EXCEL_ROW_NO, 'EAR_SURVEY_STATUS_NAME', `EAR Status ${firstRow.EAR_SURVEY_STATUS_NAME} was not found in EAR_SURVEY_STATUS`)
    if ((stage === 'ACTIVE' && itemCandidates.length !== 1) || !status || !country || countries.some((value) => !value) || hasCountryConflict) continue

    preparedItems.push({
      EXCEL_ROW_NO: firstRow.EXCEL_ROW_NO,
      ITEM_KEY: normalizeLookupKey(firstRow.ITEM_KEY),
      ITEM_CODE: stage === 'ACTIVE' ? firstRow.ITEM_CODE : null,
      ITEM_MANUFACTURING_ID: stage === 'ACTIVE' ? Number(itemCandidates[0].ITEM_MANUFACTURING_ID) : null,
      PRE_TRADE_REFERENCE_NO: null,
      DESCRIPTION: firstRow.DESCRIPTION || null,
      MODEL: firstRow.MODEL || null,
      REMARK: isApplicable ? null : firstRow.REMARK || null,
      EAR_SURVEY_STATUS_ID: Number(status.EAR_SURVEY_STATUS_ID),
      HS_CODE: isApplicable ? firstRow.HS_CODE : null,
      COUNTRY_ID: Number(country.COUNTRY_ID),
      CONTROLS: isApplicable
        ? groupedRows.map((row) => ({
            ECCN: row.ECCN!,
            REASONS: parseReasons(row.REASON_FOR_CONTROL),
            COMPONENT_OF_PRODUCT: row.COMPONENT_OF_PRODUCT,
            REMARK: row.REMARK || null,
          }))
        : [],
    })
  }

  return preparedItems
}

const getSurveyDetail = async (earSurveyHeaderId: number) => {
  const results = (await MySQLExecute.searchList([
    EarSurveySQL.getHeaderById(earSurveyHeaderId),
    EarSurveySQL.getItemsByHeaderId(earSurveyHeaderId),
    EarSurveySQL.getControlsByHeaderId(earSurveyHeaderId),
  ])) as RowDataPacket[][][]
  const header = results[0]?.[0] as any

  if (!header) return null

  const controlsByItemId = new Map<number, any[]>()
  for (const control of (results[2] ?? []) as any[]) {
    const itemId = Number(control.EAR_SURVEY_ITEM_ID)
    controlsByItemId.set(itemId, [...(controlsByItemId.get(itemId) ?? []), control])
  }

  const items: PreparedItem[] = ((results[1] ?? []) as any[]).map((item) => ({
    EAR_SURVEY_ITEM_ID: Number(item.EAR_SURVEY_ITEM_ID),
    EXCEL_ROW_NO: null,
    ITEM_KEY: normalizeLookupKey(item.ITEM_CODE),
    ITEM_CODE: item.ITEM_MANUFACTURING_ID == null ? null : normalizeText(item.ITEM_CODE),
    ITEM_MANUFACTURING_ID: item.ITEM_MANUFACTURING_ID == null ? null : Number(item.ITEM_MANUFACTURING_ID),
    PRE_TRADE_REFERENCE_NO: normalizeText(item.PRE_TRADE_REFERENCE_NO) || null,
    DESCRIPTION: normalizeText(item.DESCRIPTION) || null,
    MODEL: normalizeText(item.MODEL) || null,
    REMARK: normalizeText(item.REMARK) || null,
    EAR_SURVEY_STATUS_ID: Number(item.EAR_SURVEY_STATUS_ID),
    HS_CODE: normalizeText(item.HS_CODE) || null,
    COUNTRY_ID: item.COUNTRY_ID == null ? null : Number(item.COUNTRY_ID),
    CONTROLS: (controlsByItemId.get(Number(item.EAR_SURVEY_ITEM_ID)) ?? []).map((control) => ({
      EAR_SURVEY_ITEM_CONTROL_ID: Number(control.EAR_SURVEY_ITEM_CONTROL_ID),
      ECCN: parseEccn(control.ECCN_FULL_CODE)!,
      REASONS: parseReasons(control.REASON_FOR_CONTROL),
      COMPONENT_OF_PRODUCT: normalizeText(control.COMPONENT_OF_PRODUCT),
      REMARK: normalizeText(control.REMARK) || null,
    })),
  }))

  return { header, items }
}

const mergeItems = (currentItems: PreparedItem[], importedItems: PreparedItem[]) => {
  const merged = new Map<string, PreparedItem>()
  for (const item of currentItems) merged.set(item.ITEM_KEY, item)
  for (const item of importedItems) merged.set(item.ITEM_KEY, item)
  return Array.from(merged.values())
}

const businessHeaderSignature = (header: PreparedHeader | Record<string, any>) =>
  JSON.stringify({
    REQUEST_DATE: normalizeText(header.REQUEST_DATE),
    SUPPLIER_CODE: normalizeLookupKey(header.SUPPLIER_CODE),
    SUPPLIER_NAME: normalizeText(header.SUPPLIER_NAME),
    CONTACT_TEL: normalizeText(header.CONTACT_TEL),
    CONTACT_NAME: normalizeText(header.CONTACT_NAME),
    POSITION_NAME: normalizeText(header.POSITION_NAME),
    DEPARTMENT_NAME: normalizeText(header.DEPARTMENT_NAME),
    CONTACT_EMAIL: normalizeText(header.CONTACT_EMAIL),
    SURVEY_STAGE: normalizeLookupKey(header.SURVEY_STAGE),
  })

const sortedControls = (controls: PreparedControl[]) =>
  [...controls].sort(
    (left, right) =>
      left.ECCN.ECCN_FULL_CODE.localeCompare(right.ECCN.ECCN_FULL_CODE) ||
      left.REASONS.join('|').localeCompare(right.REASONS.join('|')) ||
      left.COMPONENT_OF_PRODUCT.localeCompare(right.COMPONENT_OF_PRODUCT)
  )

const businessItemSignature = (item: PreparedItem) =>
  JSON.stringify({
    ITEM_KEY: item.ITEM_KEY,
    ITEM_MANUFACTURING_ID: item.ITEM_MANUFACTURING_ID,
    DESCRIPTION: normalizeText(item.DESCRIPTION),
    MODEL: normalizeText(item.MODEL),
    EAR_SURVEY_STATUS_ID: item.EAR_SURVEY_STATUS_ID,
    HS_CODE: normalizeLookupKey(item.HS_CODE),
    COUNTRY_ID: item.COUNTRY_ID,
    CONTROLS: sortedControls(item.CONTROLS).map((control) => ({
      ECCN_FULL_CODE: normalizeLookupKey(control.ECCN.ECCN_FULL_CODE),
      REASONS: [...control.REASONS].map(normalizeText).sort(),
      COMPONENT_OF_PRODUCT: normalizeText(control.COMPONENT_OF_PRODUCT),
    })),
  })

const businessItemsSignature = (items: PreparedItem[]) =>
  JSON.stringify(
    [...items]
      .sort((left, right) => left.ITEM_KEY.localeCompare(right.ITEM_KEY))
      .map(businessItemSignature)
  )

const remarkItemsSignature = (items: PreparedItem[]) =>
  JSON.stringify(
    [...items]
      .sort((left, right) => left.ITEM_KEY.localeCompare(right.ITEM_KEY))
      .map((item) => ({
        ITEM_KEY: item.ITEM_KEY,
        REMARK: normalizeText(item.REMARK),
        CONTROLS: sortedControls(item.CONTROLS).map((control) => ({
          ECCN_FULL_CODE: normalizeLookupKey(control.ECCN.ECCN_FULL_CODE),
          REMARK: normalizeText(control.REMARK),
        })),
      }))
  )

const getNextRevisionNo = async (supplierCode: string) => {
  const result = (await MySQLExecute.search(EarSurveySQL.getNextRevisionNoBySupplierCode(supplierCode))) as any[]
  return Math.max(Number(result?.[0]?.REVISION_NO) || 1, 1)
}

const buildRevisionCode = (supplierCode: string, revisionNo: number) => {
  const bangkokYear = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).format(new Date())
  return `EAR-${bangkokYear.slice(-2)}-${normalizeText(supplierCode)}-${`${revisionNo}`.padStart(3, '0')}`
}

const validateCurrentActiveItemHsCodes = async (items: PreparedItem[], errors: ImportValidationError[], excludeEarSurveyHeaderId?: number | null) => {
  const itemsWithHsCode = items.filter((item) => Number.isInteger(item.ITEM_MANUFACTURING_ID) && Number(item.ITEM_MANUFACTURING_ID) > 0 && Boolean(item.HS_CODE))
  if (itemsWithHsCode.length === 0) return

  const itemsByManufacturingId = new Map<number, PreparedItem[]>()
  for (const item of itemsWithHsCode) {
    const itemManufacturingId = Number(item.ITEM_MANUFACTURING_ID)
    itemsByManufacturingId.set(itemManufacturingId, [...(itemsByManufacturingId.get(itemManufacturingId) ?? []), item])
  }

  for (const groupedItems of itemsByManufacturingId.values()) {
    const requestedHsCodes = new Set(groupedItems.map((item) => normalizeLookupKey(item.HS_CODE)))
    if (requestedHsCodes.size <= 1) continue

    for (const item of groupedItems) {
      pushError(
        errors,
        item.EXCEL_ROW_NO ?? null,
        'HS_CODE',
        `Item Code ${item.ITEM_CODE ?? item.PRE_TRADE_REFERENCE_NO ?? item.ITEM_KEY} has more than one HS Code in the resulting EAR Survey`
      )
    }
  }

  const itemManufacturingIds = Array.from(itemsByManufacturingId.keys())
  const currentRows = (await MySQLExecute.search(EarSurveySQL.getCurrentActiveItemHsCodes(itemManufacturingIds, excludeEarSurveyHeaderId))) as any[]
  const currentRowsByManufacturingId = new Map<number, any[]>()

  for (const row of currentRows) {
    const itemManufacturingId = Number(row.ITEM_MANUFACTURING_ID)
    currentRowsByManufacturingId.set(itemManufacturingId, [...(currentRowsByManufacturingId.get(itemManufacturingId) ?? []), row])
  }

  for (const item of itemsWithHsCode) {
    const currentItemRows = currentRowsByManufacturingId.get(Number(item.ITEM_MANUFACTURING_ID)) ?? []
    const conflicts = currentItemRows.filter((row) => normalizeLookupKey(row.HS_CODE) !== normalizeLookupKey(item.HS_CODE))
    if (conflicts.length === 0) continue

    const currentHsCodes = Array.from(new Set(conflicts.map((row) => normalizeText(row.HS_CODE)))).join(', ')
    const currentRevisions = Array.from(new Set(conflicts.map((row) => normalizeText(row.REVISION_CODE) || `Header ${row.EAR_SURVEY_HEADER_ID}`))).join(', ')
    pushError(
      errors,
      item.EXCEL_ROW_NO ?? null,
      'HS_CODE',
      `Item Code ${item.ITEM_CODE ?? item.PRE_TRADE_REFERENCE_NO ?? item.ITEM_KEY} already uses HS Code ${currentHsCodes} in current ACTIVE EAR Survey ${currentRevisions}`
    )
  }
}

const buildInsertSql = (
  header: PreparedHeader,
  items: PreparedItem[],
  createBy: string,
  previousHeaderId?: number,
  earRevisionItemKeys?: ReadonlySet<string>
) => {
  const sqlList: string[] = []
  const hsCodes = Array.from(new Set(items.map((item) => item.HS_CODE).filter((value): value is string => Boolean(value))))
  const eccnMap = new Map<string, NormalizedEccn>()

  for (const item of items) {
    for (const control of item.CONTROLS) eccnMap.set(control.ECCN.ECCN_FULL_CODE, control.ECCN)
  }

  for (const hsCode of hsCodes) sqlList.push(EarSurveySQL.upsertHsCode(hsCode, createBy))
  for (const eccn of eccnMap.values()) sqlList.push(EarSurveySQL.upsertEccn(eccn, createBy))
  for (const item of items) {
    if (item.HS_CODE) {
      for (const control of item.CONTROLS) {
        sqlList.push(EarSurveySQL.upsertHsCodeEccn(item.HS_CODE, control.ECCN.ECCN_FULL_CODE, createBy))
      }
      if (Number.isInteger(item.ITEM_MANUFACTURING_ID) && Number(item.ITEM_MANUFACTURING_ID) > 0) {
        sqlList.push(EarSurveySQL.upsertItemManufacturingHsCode(Number(item.ITEM_MANUFACTURING_ID), item.HS_CODE, createBy))
      }
    }
  }
  if (previousHeaderId) sqlList.push(EarSurveySQL.setHeaderNotCurrent(previousHeaderId, createBy))

  sqlList.push(EarSurveySQL.insertHeader(header, createBy))
  sqlList.push(EarSurveySQL.setHeaderId())

  items.forEach((item, itemIndex) => {
    sqlList.push(EarSurveySQL.insertItem(item, createBy, header.SURVEY_STAGE === 'PRE_TRADE' ? itemIndex + 1 : null))
    sqlList.push(EarSurveySQL.setItemId(itemIndex))
    if (
      header.SURVEY_STAGE === 'ACTIVE' &&
      item.ITEM_MANUFACTURING_ID &&
      (!earRevisionItemKeys || earRevisionItemKeys.has(item.ITEM_KEY))
    ) {
      sqlList.push(EarSurveySQL.deactivateCurrentItemEarRevision(item.ITEM_MANUFACTURING_ID, createBy))
      sqlList.push(EarSurveySQL.insertItemEarRevision(itemIndex, item.ITEM_MANUFACTURING_ID, createBy))
    }
    item.CONTROLS.forEach((control, controlIndex) => {
      sqlList.push(
        EarSurveySQL.insertControl(
          itemIndex,
          {
            ECCN_FULL_CODE: control.ECCN.ECCN_FULL_CODE,
            COMPONENT_OF_PRODUCT: control.COMPONENT_OF_PRODUCT,
            REMARK: control.REMARK,
          },
          createBy
        )
      )
      sqlList.push(EarSurveySQL.setControlId(itemIndex, controlIndex))
      for (const reason of control.REASONS) {
        sqlList.push(EarSurveySQL.insertControlReason(itemIndex, controlIndex, reason, createBy))
      }
    })
  })

  return sqlList
}

const prepareImport = async (payload: EarSurveyImportPayload, stage: SurveyStage) => {
  const errors: ImportValidationError[] = []
  const createBy = normalizeText(payload?.CREATE_BY) || 'SYSTEM'
  const header = normalizeHeader(payload?.HEADER ?? ({} as EarSurveyHeaderImport), stage)
  validateHeader(header, payload?.HEADER ?? ({} as EarSurveyHeaderImport), stage, errors)

  const rows = normalizeRows(payload?.ROWS ?? [], stage, errors)
  const rowsByItemKey = groupRows(rows)
  for (const [itemKey, groupedRows] of rowsByItemKey) validateGroupRows(itemKey, groupedRows, errors)

  if (errors.length > 0) return { errors, createBy, header, items: [] as PreparedItem[] }

  const items = await prepareItems(rowsByItemKey, stage, errors)
  return { errors, createBy, header, items }
}

const createActiveByImportFile = async (payload: EarSurveyImportPayload) => {
  const prepared = await prepareImport(payload, 'ACTIVE')
  if (prepared.errors.length > 0) return validationFailure(prepared.errors, 'Reference validation failed. No data was imported.')

  const supplierCode = prepared.header.SUPPLIER_CODE!
  const activeHeaders = (await MySQLExecute.search(EarSurveySQL.getActiveHeadersBySupplierCode(supplierCode))) as any[]

  if (activeHeaders.length > 1) {
    return validationFailure(
      [{ ROW_NO: null, FIELD: 'SUPPLIER_CODE', MESSAGE: `Supplier Code ${supplierCode} has more than one current ACTIVE EAR Survey` }],
      'Current revision data is invalid. No data was imported.'
    )
  }

  const currentHeaderId = activeHeaders.length === 1 ? Number(activeHeaders[0].EAR_SURVEY_HEADER_ID) : null
  const currentDetail = currentHeaderId ? await getSurveyDetail(currentHeaderId) : null
  const mergedItems = mergeItems(currentDetail?.items ?? [], prepared.items)
  const currentItemsByKey = new Map((currentDetail?.items ?? []).map((item) => [item.ITEM_KEY, item]))
  const changedItemKeys = new Set(
    mergedItems
      .filter((item) => {
        const currentItem = currentItemsByKey.get(item.ITEM_KEY)
        return !currentItem || businessItemSignature(currentItem) !== businessItemSignature(item)
      })
      .map((item) => item.ITEM_KEY)
  )

  if (currentDetail) {
    const businessIsSame =
      businessHeaderSignature(currentDetail.header) === businessHeaderSignature(prepared.header) &&
      businessItemsSignature(currentDetail.items) === businessItemsSignature(mergedItems)

    if (businessIsSame) {
      const remarksAreSame = remarkItemsSignature(currentDetail.items) === remarkItemsSignature(mergedItems)

      if (remarksAreSame) {
        return {
          Status: false,
          ResultOnDb: [
            {
              ROW_NO: null,
              FIELD: 'DUPLICATE_LATEST_REVISION',
              MESSAGE: 'Data is identical to the latest EAR Survey revision.',
              EAR_SURVEY_HEADER_ID: currentHeaderId,
              REVISION_NO: currentDetail.header.REVISION_NO,
              REVISION_CODE: currentDetail.header.REVISION_CODE,
              REASON: 'DUPLICATE_LATEST_REVISION',
            },
          ],
          TotalCountOnDb: 1,
          Message: 'Data is identical to the latest EAR Survey revision. No data was imported.',
        }
      }

      const currentByItemKey = new Map(currentDetail.items.map((item) => [item.ITEM_KEY, item]))
      const remarkSqlList: string[] = []

      for (const mergedItem of mergedItems) {
        const currentItem = currentByItemKey.get(mergedItem.ITEM_KEY)
        if (!currentItem?.EAR_SURVEY_ITEM_ID) continue

        if (normalizeText(currentItem.REMARK) !== normalizeText(mergedItem.REMARK)) {
          remarkSqlList.push(EarSurveySQL.updateItemRemark(currentItem.EAR_SURVEY_ITEM_ID, mergedItem.REMARK, prepared.createBy))
        }

        const currentControlByEccn = new Map(currentItem.CONTROLS.map((control) => [normalizeLookupKey(control.ECCN.ECCN_FULL_CODE), control]))
        for (const mergedControl of mergedItem.CONTROLS) {
          const currentControl = currentControlByEccn.get(normalizeLookupKey(mergedControl.ECCN.ECCN_FULL_CODE))
          if (currentControl?.EAR_SURVEY_ITEM_CONTROL_ID && normalizeText(currentControl.REMARK) !== normalizeText(mergedControl.REMARK)) {
            remarkSqlList.push(EarSurveySQL.updateControlRemark(currentControl.EAR_SURVEY_ITEM_CONTROL_ID, mergedControl.REMARK, prepared.createBy))
          }
        }
      }

      if (remarkSqlList.length > 0) await MySQLExecute.executeList(remarkSqlList)

      return {
        Status: true,
        ResultOnDb: [
          {
            EAR_SURVEY_HEADER_ID: currentHeaderId,
            REVISION_NO: currentDetail.header.REVISION_NO,
            REVISION_CODE: currentDetail.header.REVISION_CODE,
            REMARK_UPDATED: true,
          },
        ],
        TotalCountOnDb: remarkSqlList.length,
        Message: 'Remarks were updated on the latest EAR Survey revision.',
      }
    }
  }

  const hsCodeErrors: ImportValidationError[] = []
  await validateCurrentActiveItemHsCodes(mergedItems, hsCodeErrors, currentHeaderId)
  if (hsCodeErrors.length > 0) {
    return validationFailure(hsCodeErrors, 'HS Code conflicts with current ACTIVE EAR Survey. No data was imported.')
  }

  const revisionNo = await getNextRevisionNo(supplierCode)
  prepared.header.REVISION_NO = revisionNo
  prepared.header.REVISION_CODE = buildRevisionCode(supplierCode, revisionNo)
  await MySQLExecute.executeList([
    ...buildInsertSql(prepared.header, mergedItems, prepared.createBy, currentHeaderId ?? undefined, changedItemKeys),
    EarSurveySQL.deactivateUnusedItemManufacturingEccns(prepared.createBy),
    EarSurveySQL.upsertCurrentItemManufacturingEccns(prepared.createBy),
    EarSurveySQL.deactivateUnusedItemManufacturingCountries(prepared.createBy),
    EarSurveySQL.upsertCurrentItemManufacturingCountries(prepared.createBy),
    EarSurveySQL.syncUnusedHsCodes(prepared.createBy),
    EarSurveySQL.syncUnusedEccns(prepared.createBy),
  ])

  return {
    Status: true,
    ResultOnDb: [
      {
        REVISION_NO: revisionNo,
        REVISION_CODE: prepared.header.REVISION_CODE,
        ITEM_COUNT: mergedItems.length,
        ECCN_COUNT: mergedItems.reduce((total, item) => total + item.CONTROLS.length, 0),
      },
    ],
    TotalCountOnDb: mergedItems.length,
    Message: 'Successfully imported EAR Survey',
  }
}

const createPreTradeByImportFile = async (payload: EarSurveyImportPayload) => {
  const prepared = await prepareImport(payload, 'PRE_TRADE')
  if (prepared.errors.length > 0) return validationFailure(prepared.errors, 'Reference validation failed. No data was imported.')

  const currentHeaders = (await MySQLExecute.search(EarSurveySQL.getCurrentPreTradeHeadersBySupplierName(prepared.header.SUPPLIER_NAME))) as any[]
  if (currentHeaders.length > 0) {
    return validationFailure(
      [
        {
          ROW_NO: null,
          FIELD: 'SUPPLIER_NAME',
          MESSAGE: 'Supplier Name ' + prepared.header.SUPPLIER_NAME + ' already has a current PRE_TRADE EAR Survey. Cancel it before importing a new file.',
        },
      ],
      'Supplier Name already has a current PRE_TRADE EAR Survey. Cancel it before importing a new file.'
    )
  }

  prepared.header.REVISION_NO = null
  prepared.header.REVISION_CODE = null
  await MySQLExecute.executeList([
    ...buildInsertSql(prepared.header, prepared.items, prepared.createBy),
    EarSurveySQL.syncUnusedHsCodes(prepared.createBy),
    EarSurveySQL.syncUnusedEccns(prepared.createBy),
  ])

  return {
    Status: true,
    ResultOnDb: [
      {
        SURVEY_STAGE: 'PRE_TRADE',
        ITEM_COUNT: prepared.items.length,
        ECCN_COUNT: prepared.items.reduce((total, item) => total + item.CONTROLS.length, 0),
      },
    ],
    TotalCountOnDb: prepared.items.length,
    Message: 'Successfully imported pre-trade EAR Survey',
  }
}

const cancelPreTrade = async (payload: CancelPreTradePayload) => {
  const earSurveyHeaderId = Number(payload?.EAR_SURVEY_HEADER_ID)
  const updateBy = normalizeText(payload?.UPDATE_BY) || 'SYSTEM'

  if (!Number.isInteger(earSurveyHeaderId) || earSurveyHeaderId <= 0) {
    return validationFailure([{ ROW_NO: null, FIELD: 'EAR_SURVEY_HEADER_ID', MESSAGE: 'EAR_SURVEY_HEADER_ID is invalid' }])
  }

  const currentDetail = await getSurveyDetail(earSurveyHeaderId)
  if (!currentDetail || currentDetail.header.SURVEY_STAGE !== 'PRE_TRADE' || Number(currentDetail.header.INUSE) !== 1) {
    return validationFailure([
      {
        ROW_NO: null,
        FIELD: 'EAR_SURVEY_HEADER_ID',
        MESSAGE: 'Current PRE_TRADE EAR Survey was not found',
      },
    ])
  }

  await MySQLExecute.executeList([EarSurveySQL.cancelPreTradeHeader(earSurveyHeaderId, updateBy), EarSurveySQL.syncUnusedHsCodes(updateBy), EarSurveySQL.syncUnusedEccns(updateBy)])
  return {
    Status: true,
    ResultOnDb: [{ EAR_SURVEY_HEADER_ID: earSurveyHeaderId, INUSE: 0 }],
    TotalCountOnDb: 1,
    Message: 'PRE_TRADE EAR Survey was cancelled successfully.',
  }
}

const activatePreTrade = async (payload: ActivatePreTradePayload) => {
  const errors: ImportValidationError[] = []
  const earSurveyHeaderId = Number(payload?.EAR_SURVEY_HEADER_ID)
  const supplierCode = normalizeText(payload?.SUPPLIER_CODE)
  const updateBy = normalizeText(payload?.UPDATE_BY) || 'SYSTEM'
  const itemMappings = Array.isArray(payload?.ITEM_MAPPINGS) ? payload.ITEM_MAPPINGS : []

  if (!Number.isInteger(earSurveyHeaderId) || earSurveyHeaderId <= 0) pushError(errors, null, 'EAR_SURVEY_HEADER_ID', 'EAR_SURVEY_HEADER_ID is invalid')
  if (!supplierCode) pushError(errors, null, 'SUPPLIER_CODE', 'SUPPLIER_CODE is required')
  if (itemMappings.length === 0) pushError(errors, null, 'ITEM_MAPPINGS', 'ITEM_MAPPINGS is required')
  if (errors.length > 0) return validationFailure(errors)

  const detail = await getSurveyDetail(earSurveyHeaderId)
  if (!detail || detail.header.SURVEY_STAGE !== 'PRE_TRADE' || Number(detail.header.INUSE) !== 1) {
    return validationFailure([{ ROW_NO: null, FIELD: 'EAR_SURVEY_HEADER_ID', MESSAGE: 'Current PRE_TRADE EAR Survey was not found' }])
  }

  const expectedItemIds = new Set(detail.items.map((item) => Number(item.EAR_SURVEY_ITEM_ID)))
  const mappedItemIds = new Set<number>()
  const mappedManufacturingIds = new Set<number>()

  for (const mapping of itemMappings) {
    const itemId = Number(mapping?.EAR_SURVEY_ITEM_ID)
    const manufacturingId = Number(mapping?.ITEM_MANUFACTURING_ID)

    if (!Number.isInteger(itemId) || !expectedItemIds.has(itemId)) {
      pushError(errors, null, 'EAR_SURVEY_ITEM_ID', `EAR_SURVEY_ITEM_ID ${mapping?.EAR_SURVEY_ITEM_ID} does not belong to this PRE_TRADE survey`)
    } else if (mappedItemIds.has(itemId)) {
      pushError(errors, null, 'EAR_SURVEY_ITEM_ID', `EAR_SURVEY_ITEM_ID ${itemId} is duplicated in ITEM_MAPPINGS`)
    }

    if (!Number.isInteger(manufacturingId) || manufacturingId <= 0) {
      pushError(errors, null, 'ITEM_MANUFACTURING_ID', `ITEM_MANUFACTURING_ID ${mapping?.ITEM_MANUFACTURING_ID} is invalid`)
    } else if (mappedManufacturingIds.has(manufacturingId)) {
      pushError(errors, null, 'ITEM_MANUFACTURING_ID', `ITEM_MANUFACTURING_ID ${manufacturingId} is mapped more than once`)
    }

    mappedItemIds.add(itemId)
    mappedManufacturingIds.add(manufacturingId)
  }

  for (const expectedItemId of expectedItemIds) {
    if (!mappedItemIds.has(expectedItemId)) pushError(errors, null, 'ITEM_MAPPINGS', `EAR_SURVEY_ITEM_ID ${expectedItemId} has no Manufacturing Item mapping`)
  }

  if (errors.length > 0) return validationFailure(errors)

  const activeHeaders = (await MySQLExecute.search(EarSurveySQL.getActiveHeadersBySupplierCode(supplierCode))) as any[]
  if (activeHeaders.length > 0) {
    return validationFailure([{ ROW_NO: null, FIELD: 'SUPPLIER_CODE', MESSAGE: `Supplier Code ${supplierCode} already has a current ACTIVE EAR Survey` }])
  }

  const manufacturingIds = Array.from(mappedManufacturingIds)
  const manufacturingRows = (await MySQLExecute.search(EarSurveySQL.getItemManufacturingByIds(manufacturingIds))) as any[]
  const validManufacturingIds = new Set(manufacturingRows.map((item) => Number(item.ITEM_MANUFACTURING_ID)))

  for (const manufacturingId of manufacturingIds) {
    if (!validManufacturingIds.has(manufacturingId)) {
      pushError(errors, null, 'ITEM_MANUFACTURING_ID', `ITEM_MANUFACTURING_ID ${manufacturingId} was not found in current active Manufacturing Item`)
    }
  }

  if (errors.length > 0) return validationFailure(errors, 'Reference validation failed. PRE_TRADE survey was not activated.')

  const manufacturingById = new Map(manufacturingRows.map((item) => [Number(item.ITEM_MANUFACTURING_ID), normalizeText(item.ITEM_CODE_FOR_SUPPORT_MES)]))
  const manufacturingIdByItemId = new Map(itemMappings.map((mapping) => [Number(mapping.EAR_SURVEY_ITEM_ID), Number(mapping.ITEM_MANUFACTURING_ID)]))
  const activatedItems = detail.items.map((item) => {
    const itemManufacturingId = manufacturingIdByItemId.get(Number(item.EAR_SURVEY_ITEM_ID))!
    return {
      ...item,
      ITEM_MANUFACTURING_ID: itemManufacturingId,
      ITEM_CODE: manufacturingById.get(itemManufacturingId) ?? item.PRE_TRADE_REFERENCE_NO,
      EXCEL_ROW_NO: null,
    }
  })
  await validateCurrentActiveItemHsCodes(activatedItems, errors, earSurveyHeaderId)
  if (errors.length > 0) {
    return validationFailure(errors, 'HS Code conflicts with current ACTIVE EAR Survey. PRE_TRADE survey was not activated.')
  }

  const revisionNo = await getNextRevisionNo(supplierCode)
  const revisionCode = buildRevisionCode(supplierCode, revisionNo)
  const sqlList = [EarSurveySQL.activatePreTradeHeader(earSurveyHeaderId, supplierCode, revisionNo, revisionCode, updateBy)]

  for (const mapping of itemMappings) {
    sqlList.push(EarSurveySQL.updatePreTradeItemManufacturing(earSurveyHeaderId, Number(mapping.EAR_SURVEY_ITEM_ID), Number(mapping.ITEM_MANUFACTURING_ID), updateBy))
    sqlList.push(EarSurveySQL.deactivateCurrentItemEarRevision(Number(mapping.ITEM_MANUFACTURING_ID), updateBy))
    sqlList.push(
      EarSurveySQL.insertItemEarRevisionForExistingSurveyItem(
        Number(mapping.EAR_SURVEY_ITEM_ID),
        Number(mapping.ITEM_MANUFACTURING_ID),
        updateBy
      )
    )
    const item = detail.items.find((detailItem) => Number(detailItem.EAR_SURVEY_ITEM_ID) === Number(mapping.EAR_SURVEY_ITEM_ID))
    if (item?.HS_CODE) {
      sqlList.push(EarSurveySQL.upsertItemManufacturingHsCode(Number(mapping.ITEM_MANUFACTURING_ID), item.HS_CODE, updateBy))
    }
  }

  sqlList.push(EarSurveySQL.syncUnusedHsCodes(updateBy))
  sqlList.push(EarSurveySQL.deactivateUnusedItemManufacturingEccns(updateBy))
  sqlList.push(EarSurveySQL.upsertCurrentItemManufacturingEccns(updateBy))
  sqlList.push(EarSurveySQL.deactivateUnusedItemManufacturingCountries(updateBy))
  sqlList.push(EarSurveySQL.upsertCurrentItemManufacturingCountries(updateBy))
  sqlList.push(EarSurveySQL.syncUnusedEccns(updateBy))
  await MySQLExecute.executeList(sqlList)

  return {
    Status: true,
    ResultOnDb: [
      {
        EAR_SURVEY_HEADER_ID: earSurveyHeaderId,
        SURVEY_STAGE: 'ACTIVE',
        REVISION_NO: revisionNo,
        REVISION_CODE: revisionCode,
      },
    ],
    TotalCountOnDb: itemMappings.length,
    Message: 'PRE_TRADE EAR Survey was activated successfully.',
  }
}

export const EarSurveyImportService = {
  createByImportFile: createActiveByImportFile,
  createPreTradeByImportFile,
  cancelPreTrade,
  activatePreTrade,
}

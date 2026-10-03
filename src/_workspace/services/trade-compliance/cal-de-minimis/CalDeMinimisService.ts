import { MySQLExecute } from '@businessData/dbExecute'
import { CalDeMinimisSQL } from '@src/_workspace/sql/trade-compliance/cal-de-minimis/CalDeMinimisSQL'
import type {
  CalDeMinimisBomDetail,
  CalDeMinimisBomPriceRow,
  CalDeMinimisCalculationRequest,
  CalDeMinimisCalculationResult,
  CalDeMinimisClassificationRow,
  CalDeMinimisHeaderRow,
  CalDeMinimisProductItemRow,
  CalDeMinimisProductTypeOption,
  CalDeMinimisResponse,
  CalDeMinimisSctOption,
  CalDeMinimisThresholdSettings,
  CalDeMinimisThresholdSettingsUpdate,
} from '@src/_workspace/types/trade-compliance/CalDeMinimis'

const SEMI_FINISHED_GOODS_CATEGORY_ID = 2
const SUB_ASSY_CATEGORY_ID = 3
const RAW_MATERIAL_CATEGORY_ID = 4
const PACKING_CATEGORY_ID = 6
const MAX_BOM_DEPTH = 50

interface Classification {
  countries: Map<number, { name: string; alpha2: string | null; alpha3: string | null }>
  eccnCodes: Set<string>
  earStatusCodes: Set<string>
  fecEccnCodes: Set<string>
}

interface ExpandedLeaf {
  itemManufacturingId: number
  itemCode: string
  itemCategoryId: 4 | 6
  itemCategoryName: string
  priceWithoutImportFee: number
  amountWithoutImportFee: number
  amountWithImportFee: number | null
  purchasePrice: number | null
  purchasePriceCurrency: string | null
  exchangeRateValue: number | null
  importFeeRate: number | null
  purchaseUnit: string | null
  usageUnit: string | null
  purchaseUnitRatio: number | null
  usageUnitRatio: number | null
  usageQuantity: number
  effectiveUsageQuantity: number
  yieldAccumulation: number
  bomLevel: number
  bomPath: string
}

class DeMinimisBusinessError extends Error {}

const successResponse = <T>(result: T[], method: string): CalDeMinimisResponse<T> => ({
  Status: true,
  Message: 'Success',
  ResultOnDb: result,
  MethodOnDb: method,
  TotalCountOnDb: result.length,
})

const failedResponse = <T>(message: string, method: string): CalDeMinimisResponse<T> => ({
  Status: false,
  Message: message,
  ResultOnDb: [],
  MethodOnDb: method,
  TotalCountOnDb: 0,
})

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

const displayItemCode = (itemCode: string | null, itemManufacturingId: number | null): string =>
  itemCode?.trim() || (itemManufacturingId ? `ITEM_MANUFACTURING_ID ${itemManufacturingId}` : 'Unknown Item')

const loadClassifications = async (itemManufacturingIds: number[]): Promise<Map<number, Classification>> => {
  const uniqueIds = [...new Set(itemManufacturingIds)]
  const rows = (await MySQLExecute.search(CalDeMinimisSQL.getClassifications(uniqueIds))) as CalDeMinimisClassificationRow[]
  const result = new Map<number, Classification>()

  for (const id of uniqueIds) {
    result.set(id, { countries: new Map(), eccnCodes: new Set(), earStatusCodes: new Set(), fecEccnCodes: new Set() })
  }

  for (const row of rows) {
    const classification = result.get(Number(row.ITEM_MANUFACTURING_ID))
    if (!classification) continue

    if (row.COUNTRY_ID !== null && row.COUNTRY_NAME) {
      classification.countries.set(Number(row.COUNTRY_ID), {
        name: row.COUNTRY_NAME,
        alpha2: row.COUNTRY_ALPHA2,
        alpha3: row.COUNTRY_ALPHA3,
      })
    }

    if (row.ECCN_FULL_CODE) {
      classification.eccnCodes.add(row.ECCN_FULL_CODE)
      if (Number(row.IS_FEC_CONTROLLED) === 1) classification.fecEccnCodes.add(row.ECCN_FULL_CODE)
    }
    if (row.EAR_SURVEY_STATUS_CODE) classification.earStatusCodes.add(row.EAR_SURVEY_STATUS_CODE)
  }

  return result
}

const isUnitedStatesOrigin = (classification: Classification): boolean =>
  [...classification.countries.values()].some((country) => country.alpha2?.toUpperCase() === 'US' || country.alpha3?.toUpperCase() === 'USA')

const isExplicitNotApplicable = (classification: Classification): boolean =>
  classification.earStatusCodes.size > 0 && [...classification.earStatusCodes].every((status) => status === 'NOT_APPLICABLE')

const expandBom = async (rootSctId: string): Promise<ExpandedLeaf[]> => {
  const rowsBySctId = new Map<string, Promise<CalDeMinimisBomPriceRow[]>>()
  const getRows = (sctId: string): Promise<CalDeMinimisBomPriceRow[]> => {
    const cached = rowsBySctId.get(sctId)
    if (cached) return cached

    const pending = MySQLExecute.search(CalDeMinimisSQL.getBomRows(sctId)) as Promise<CalDeMinimisBomPriceRow[]>
    rowsBySctId.set(sctId, pending)
    return pending
  }

  const walk = async (sctId: string, multiplier: number, level: number, path: string[], activeSctIds: Set<string>): Promise<ExpandedLeaf[]> => {
    if (level > MAX_BOM_DEPTH) {
      throw new DeMinimisBusinessError(`BOM exceeds the supported depth of ${MAX_BOM_DEPTH} levels`)
    }
    if (activeSctIds.has(sctId)) {
      throw new DeMinimisBusinessError(`BOM cycle detected at SCT ${sctId}`)
    }

    const nextActiveSctIds = new Set(activeSctIds)
    nextActiveSctIds.add(sctId)
    const rows = await getRows(sctId)
    const leaves: ExpandedLeaf[] = []

    for (const row of rows) {
      const itemCode = displayItemCode(row.ITEM_CODE, row.ITEM_MANUFACTURING_ID)
      const nextPath = [...path, itemCode]

      if (row.ITEM_CATEGORY_ID === RAW_MATERIAL_CATEGORY_ID || row.ITEM_CATEGORY_ID === PACKING_CATEGORY_ID) {
        if (!row.ITEM_MANUFACTURING_ID) {
          throw new DeMinimisBusinessError(`Manufacturing Item was not found for BOM Item ${itemCode}`)
        }
        const priceWithoutImportFee = Number(row.PRICE_WITHOUT_IMPORT_FEE)
        const usageQuantity = Number(row.USAGE_QUANTITY)
        const yieldAccumulation = Number(row.YIELD_ACCUMULATION)
        if (!Number.isFinite(priceWithoutImportFee)) {
          throw new DeMinimisBusinessError(`Standard Price without Import Fee was not found for Item Code ${itemCode}`)
        }
        if (!Number.isFinite(usageQuantity) || !Number.isFinite(yieldAccumulation) || yieldAccumulation <= 0) {
          throw new DeMinimisBusinessError(`Quantity or Yield was not found for Item Code ${itemCode}`)
        }

        const effectiveUsageQuantity = usageQuantity * multiplier
        const amountWithoutImportFee = (effectiveUsageQuantity * priceWithoutImportFee) / (yieldAccumulation / 100)
        if (!Number.isFinite(amountWithoutImportFee)) {
          throw new DeMinimisBusinessError(`Material amount without Import Fee could not be calculated for Item Code ${itemCode}`)
        }

        leaves.push({
          itemManufacturingId: Number(row.ITEM_MANUFACTURING_ID),
          itemCode,
          itemCategoryId: row.ITEM_CATEGORY_ID,
          itemCategoryName: row.ITEM_CATEGORY_NAME,
          priceWithoutImportFee,
          amountWithoutImportFee,
          amountWithImportFee: row.AMOUNT_WITH_IMPORT_FEE === null ? null : Number(row.AMOUNT_WITH_IMPORT_FEE) * multiplier,
          purchasePrice: row.PURCHASE_PRICE === null ? null : Number(row.PURCHASE_PRICE),
          purchasePriceCurrency: row.PURCHASE_PRICE_CURRENCY,
          exchangeRateValue: row.EXCHANGE_RATE_VALUE === null ? null : Number(row.EXCHANGE_RATE_VALUE),
          importFeeRate: row.IMPORT_FEE_RATE === null ? null : Number(row.IMPORT_FEE_RATE),
          purchaseUnit: row.PURCHASE_UNIT,
          usageUnit: row.USAGE_UNIT,
          purchaseUnitRatio: row.PURCHASE_UNIT_RATIO === null ? null : Number(row.PURCHASE_UNIT_RATIO),
          usageUnitRatio: row.USAGE_UNIT_RATIO === null ? null : Number(row.USAGE_UNIT_RATIO),
          usageQuantity,
          effectiveUsageQuantity,
          yieldAccumulation,
          bomLevel: level,
          bomPath: nextPath.join(' > '),
        })
        continue
      }

      if (row.ITEM_CATEGORY_ID !== SEMI_FINISHED_GOODS_CATEGORY_ID && row.ITEM_CATEGORY_ID !== SUB_ASSY_CATEGORY_ID) {
        continue
      }
      if (!row.CHILD_SCT_ID) {
        throw new DeMinimisBusinessError(`Can use child SCT was not found for Item Code ${itemCode}`)
      }

      const yieldAccumulation = Number(row.YIELD_ACCUMULATION)
      const usageQuantity = Number(row.USAGE_QUANTITY)
      if (!Number.isFinite(yieldAccumulation) || yieldAccumulation <= 0 || !Number.isFinite(usageQuantity)) {
        throw new DeMinimisBusinessError(`Quantity or Yield was not found for Item Code ${itemCode}`)
      }

      const childMultiplier = multiplier * usageQuantity * (100 / yieldAccumulation)
      leaves.push(...(await walk(row.CHILD_SCT_ID, childMultiplier, level + 1, nextPath, nextActiveSctIds)))
    }

    return leaves
  }

  return walk(rootSctId, 1, 1, [], new Set())
}

const aggregateLeaves = (leaves: ExpandedLeaf[], classifications: Map<number, Classification>): CalDeMinimisBomDetail[] => {
  const aggregated = new Map<number, CalDeMinimisBomDetail>()

  for (const leaf of leaves) {
    const classification: Classification = classifications.get(leaf.itemManufacturingId) ?? {
      countries: new Map<number, { name: string; alpha2: string | null; alpha3: string | null }>(),
      eccnCodes: new Set(),
      earStatusCodes: new Set(),
      fecEccnCodes: new Set(),
    }
    const existing = aggregated.get(leaf.itemManufacturingId)

    if (existing) {
      existing.AMOUNT_WITHOUT_IMPORT_FEE += leaf.amountWithoutImportFee
      existing.AMOUNT_WITH_IMPORT_FEE =
        existing.AMOUNT_WITH_IMPORT_FEE === null || leaf.amountWithImportFee === null
          ? null
          : existing.AMOUNT_WITH_IMPORT_FEE + leaf.amountWithImportFee
      existing.USAGE_QUANTITY += leaf.usageQuantity
      existing.EFFECTIVE_USAGE_QUANTITY += leaf.effectiveUsageQuantity
      if (existing.YIELD_ACCUMULATION !== leaf.yieldAccumulation) existing.YIELD_ACCUMULATION = null
      existing.BOM_LEVEL = Math.min(existing.BOM_LEVEL, leaf.bomLevel)
      if (!existing.BOM_PATHS.includes(leaf.bomPath)) existing.BOM_PATHS.push(leaf.bomPath)
      continue
    }

    aggregated.set(leaf.itemManufacturingId, {
      ITEM_MANUFACTURING_ID: leaf.itemManufacturingId,
      ITEM_CODE: leaf.itemCode,
      ITEM_CATEGORY_ID: leaf.itemCategoryId,
      ITEM_CATEGORY_NAME: leaf.itemCategoryName,
      COUNTRY_OF_ORIGINS: [...classification.countries.values()].map((country) => country.name).sort(),
      ECCN_CODES: [...classification.eccnCodes].sort(),
      EAR_STATUS_CODES: [...classification.earStatusCodes].sort(),
      FEC_ECCN_CODES: [...classification.fecEccnCodes].sort(),
      PRICE_WITHOUT_IMPORT_FEE: leaf.priceWithoutImportFee,
      AMOUNT_WITHOUT_IMPORT_FEE: leaf.amountWithoutImportFee,
      AMOUNT_WITH_IMPORT_FEE: leaf.amountWithImportFee,
      PURCHASE_PRICE: leaf.purchasePrice,
      PURCHASE_PRICE_CURRENCY: leaf.purchasePriceCurrency,
      EXCHANGE_RATE_VALUE: leaf.exchangeRateValue,
      IMPORT_FEE_RATE: leaf.importFeeRate,
      PURCHASE_UNIT: leaf.purchaseUnit,
      USAGE_UNIT: leaf.usageUnit,
      PURCHASE_UNIT_RATIO: leaf.purchaseUnitRatio,
      USAGE_UNIT_RATIO: leaf.usageUnitRatio,
      USAGE_QUANTITY: leaf.usageQuantity,
      EFFECTIVE_USAGE_QUANTITY: leaf.effectiveUsageQuantity,
      YIELD_ACCUMULATION: leaf.yieldAccumulation,
      IS_US_ORIGIN: isUnitedStatesOrigin(classification),
      IS_FEC_CONTROLLED: classification.fecEccnCodes.size > 0,
      BOM_LEVEL: leaf.bomLevel,
      BOM_PATHS: [leaf.bomPath],
    })
  }

  return [...aggregated.values()]
    .map((detail) => ({
      ...detail,
      PRICE_WITHOUT_IMPORT_FEE: round(detail.PRICE_WITHOUT_IMPORT_FEE, 6),
      AMOUNT_WITHOUT_IMPORT_FEE: round(detail.AMOUNT_WITHOUT_IMPORT_FEE, 6),
      AMOUNT_WITH_IMPORT_FEE: detail.AMOUNT_WITH_IMPORT_FEE === null ? null : round(detail.AMOUNT_WITH_IMPORT_FEE, 6),
      USAGE_QUANTITY: round(detail.USAGE_QUANTITY, 6),
      EFFECTIVE_USAGE_QUANTITY: round(detail.EFFECTIVE_USAGE_QUANTITY, 6),
      YIELD_ACCUMULATION: detail.YIELD_ACCUMULATION === null ? null : round(detail.YIELD_ACCUMULATION, 6),
    }))
    .sort((left, right) => left.ITEM_CATEGORY_ID - right.ITEM_CATEGORY_ID || left.ITEM_CODE.localeCompare(right.ITEM_CODE))
}

export const CalDeMinimisService = {
  getProductTypes: async (search: string): Promise<CalDeMinimisResponse<CalDeMinimisProductTypeOption>> => {
    const rows = (await MySQLExecute.search(CalDeMinimisSQL.getProductTypes(search))) as CalDeMinimisProductTypeOption[]
    return successResponse(rows, 'Get De-minimis Product Types')
  },

  getSctRevisions: async (productTypeId: number): Promise<CalDeMinimisResponse<CalDeMinimisSctOption>> => {
    const rows = (await MySQLExecute.search(CalDeMinimisSQL.getSctRevisions(productTypeId))) as CalDeMinimisSctOption[]
    return successResponse(rows, 'Get De-minimis SCT Revisions')
  },

  getThresholdSettings: async (): Promise<CalDeMinimisResponse<CalDeMinimisThresholdSettings>> => {
    const rows = (await MySQLExecute.search(CalDeMinimisSQL.getThresholdSettings())) as CalDeMinimisThresholdSettings[]
    const settings = rows[0]

    if (!settings) return failedResponse('De-minimis threshold settings were not found', 'Get De-minimis Settings')

    return successResponse(
      [
        {
          ...settings,
          CAL_DE_MINIMIS_SETTING_ID: Number(settings.CAL_DE_MINIMIS_SETTING_ID),
          US_ORIGIN_THRESHOLD_PERCENT: Number(settings.US_ORIGIN_THRESHOLD_PERCENT),
          FEC_CONTROLLED_THRESHOLD_PERCENT: Number(settings.FEC_CONTROLLED_THRESHOLD_PERCENT),
        },
      ],
      'Get De-minimis Settings'
    )
  },

  updateThresholdSettings: async (
    request: CalDeMinimisThresholdSettingsUpdate
  ): Promise<CalDeMinimisResponse<CalDeMinimisThresholdSettings>> => {
    await MySQLExecute.execute(CalDeMinimisSQL.updateThresholdSettings(request))
    return CalDeMinimisService.getThresholdSettings()
  },

  calculate: async (request: CalDeMinimisCalculationRequest): Promise<CalDeMinimisResponse<CalDeMinimisCalculationResult>> => {
    const method = 'Calculate De-minimis'

    try {
      const headerRows = (await MySQLExecute.search(CalDeMinimisSQL.getCalculationHeader(request))) as CalDeMinimisHeaderRow[]
      const header = headerRows[0]
      if (!header) {
        return failedResponse('Selected SCT must be a Can use Finished Goods revision', method)
      }

      const thresholdRows = (await MySQLExecute.search(CalDeMinimisSQL.getThresholdSettings())) as CalDeMinimisThresholdSettings[]
      const thresholdSettings = thresholdRows[0]
      if (!thresholdSettings) {
        return failedResponse('De-minimis threshold settings were not found', method)
      }

      const usOriginThresholdPercent = Number(thresholdSettings.US_ORIGIN_THRESHOLD_PERCENT)
      const fecControlledThresholdPercent = Number(thresholdSettings.FEC_CONTROLLED_THRESHOLD_PERCENT)
      if (
        !Number.isFinite(usOriginThresholdPercent) ||
        !Number.isFinite(fecControlledThresholdPercent) ||
        usOriginThresholdPercent < 0 ||
        usOriginThresholdPercent > 100 ||
        fecControlledThresholdPercent < 0 ||
        fecControlledThresholdPercent > 100
      ) {
        return failedResponse('De-minimis threshold settings are invalid', method)
      }

      const finishedGoodPrice = header.SELLING_PRICE === null ? null : Number(header.SELLING_PRICE)
      if (finishedGoodPrice !== null && (!Number.isFinite(finishedGoodPrice) || finishedGoodPrice < 0)) {
        return failedResponse(`Finished Good price was invalid for SCT ${header.SCT_REVISION_CODE}`, method)
      }

      const productItems = (await MySQLExecute.search(CalDeMinimisSQL.getProductTypeItems(request.PRODUCT_TYPE_ID))) as CalDeMinimisProductItemRow[]
      if (productItems.length === 0) {
        return failedResponse(`Finished Good Item Code was not found for Product Type ${header.PRODUCT_TYPE_CODE}`, method)
      }

      const leaves = await expandBom(request.SCT_ID)
      if (leaves.length === 0) {
        return failedResponse(`Raw Material or Packing was not found in SCT ${header.SCT_REVISION_CODE}`, method)
      }

      const allItemIds = [...productItems.map((item) => Number(item.ITEM_MANUFACTURING_ID)), ...leaves.map((leaf) => leaf.itemManufacturingId)]
      const classifications = await loadClassifications(allItemIds)
      const missingProductItems = productItems.filter((item) => (classifications.get(Number(item.ITEM_MANUFACTURING_ID))?.countries.size ?? 0) === 0)
      const missingBomItemCodes = [
        ...new Set(leaves.filter((leaf) => (classifications.get(leaf.itemManufacturingId)?.countries.size ?? 0) === 0).map((leaf) => leaf.itemCode)),
      ].sort()

      if (missingProductItems.length > 0 || missingBomItemCodes.length > 0) {
        const missingParts: string[] = []
        if (missingProductItems.length > 0) {
          const itemCodes = missingProductItems.map((item) => displayItemCode(item.ITEM_CODE, item.ITEM_MANUFACTURING_ID)).join(', ')
          missingParts.push(`Product Type ${header.PRODUCT_TYPE_CODE} (${itemCodes})`)
        }
        if (missingBomItemCodes.length > 0) missingParts.push(`Item Code: ${missingBomItemCodes.join(', ')}`)

        return failedResponse(`ยังไม่มีข้อมูล Country of Origin สำหรับ ${missingParts.join('; ')}`, method)
      }

      const missingUsClassificationItemCodes = [
        ...new Set(
          leaves
            .filter((leaf) => {
              const classification = classifications.get(leaf.itemManufacturingId)
              return classification !== undefined && isUnitedStatesOrigin(classification) && classification.eccnCodes.size === 0 && !isExplicitNotApplicable(classification)
            })
            .map((leaf) => leaf.itemCode)
        ),
      ].sort()

      if (missingUsClassificationItemCodes.length > 0) {
        return failedResponse(`ยังไม่มีข้อมูล ECCN หรือ EAR Status Not Applicable สำหรับ Item Code จากสหรัฐฯ: ${missingUsClassificationItemCodes.join(', ')}`, method)
      }

      const details = aggregateLeaves(leaves, classifications)
      const eligibleUsDetails = details.filter(
        (detail) => detail.IS_US_ORIGIN && !(detail.EAR_STATUS_CODES.length > 0 && detail.EAR_STATUS_CODES.every((status) => status === 'NOT_APPLICABLE'))
      )
      const totalMaterialValue = details.reduce((sum, detail) => sum + detail.AMOUNT_WITHOUT_IMPORT_FEE, 0)
      if (!Number.isFinite(totalMaterialValue) || totalMaterialValue <= 0) {
        return failedResponse('Total Raw Material and Packing price without Import Fee was not found', method)
      }

      const usOriginValue = eligibleUsDetails.reduce((sum, detail) => sum + detail.AMOUNT_WITHOUT_IMPORT_FEE, 0)
      const fecControlledValue = eligibleUsDetails
        .filter((detail) => detail.IS_FEC_CONTROLLED)
        .reduce((sum, detail) => sum + detail.AMOUNT_WITHOUT_IMPORT_FEE, 0)
      const usOriginRatio = (usOriginValue / totalMaterialValue) * 100
      const fecControlledRatio = (fecControlledValue / totalMaterialValue) * 100
      const layer1Result = usOriginRatio <= usOriginThresholdPercent ? 'PASS' : 'FAIL'
      const layer2Result = fecControlledRatio <= fecControlledThresholdPercent ? 'PASS' : 'FAIL'

      const result: CalDeMinimisCalculationResult = {
        PRODUCT_TYPE_ID: Number(header.PRODUCT_TYPE_ID),
        PRODUCT_TYPE_CODE: header.PRODUCT_TYPE_CODE,
        PRODUCT_TYPE_NAME: header.PRODUCT_TYPE_NAME,
        SCT_ID: header.SCT_ID,
        SCT_REVISION_CODE: header.SCT_REVISION_CODE,
        FINISHED_GOOD_PRICE: finishedGoodPrice === null ? null : round(finishedGoodPrice, 6),
        TOTAL_MATERIAL_VALUE: round(totalMaterialValue, 6),
        LAYER_1_US_ORIGIN: {
          MATERIAL_VALUE: round(usOriginValue, 6),
          RATIO_PERCENT: round(usOriginRatio, 4),
          THRESHOLD_PERCENT: usOriginThresholdPercent,
          RESULT: layer1Result,
        },
        LAYER_2_FEC_CONTROLLED: {
          MATERIAL_VALUE: round(fecControlledValue, 6),
          RATIO_PERCENT: round(fecControlledRatio, 4),
          THRESHOLD_PERCENT: fecControlledThresholdPercent,
          RESULT: layer2Result,
        },
        OVERALL_RESULT: layer1Result === 'FAIL' && layer2Result === 'FAIL' ? 'CONCERN_EAR' : 'NOT_CONCERN',
        BOM_DETAILS: details,
      }

      return successResponse([result], method)
    } catch (error: unknown) {
      if (error instanceof DeMinimisBusinessError) return failedResponse(error.message, method)
      throw error
    }
  },
}

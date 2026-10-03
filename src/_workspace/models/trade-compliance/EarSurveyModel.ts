import { EarSurveyImportService } from '@src/_workspace/services/trade-compliance/EarSurveyImportService'
import { EarSurveyService } from '@src/_workspace/services/trade-compliance/EarSurveyService'

export const EarSurveyModel = {
  search: async (query: any) => EarSurveyService.search(query),
  searchPreTrade: async (query: any) => EarSurveyService.search(query, 'PRE_TRADE'),
  getByEarSurveyHeaderId: async (earSurveyHeaderId: number) => EarSurveyService.getByEarSurveyHeaderId(earSurveyHeaderId),
  getManufacturingItemByCode: (itemCode: string) => EarSurveyService.getManufacturingItemByCode(itemCode),
  createByImportFile: async (dataItem: any) => EarSurveyImportService.createByImportFile(dataItem),
  createPreTradeByImportFile: async (dataItem: any) => EarSurveyImportService.createPreTradeByImportFile(dataItem),
  cancelPreTrade: async (dataItem: any) => EarSurveyImportService.cancelPreTrade(dataItem),
  activatePreTrade: async (dataItem: any) => EarSurveyImportService.activatePreTrade(dataItem),
}

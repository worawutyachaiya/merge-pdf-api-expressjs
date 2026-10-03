import { CalDeMinimisService } from '@src/_workspace/services/trade-compliance/cal-de-minimis/CalDeMinimisService'
import type {
  CalDeMinimisCalculationRequest,
  CalDeMinimisThresholdSettingsUpdate,
} from '@src/_workspace/types/trade-compliance/CalDeMinimis'

export const CalDeMinimisModel = {
  getProductTypes: (search: string) => CalDeMinimisService.getProductTypes(search),
  getSctRevisions: (productTypeId: number) => CalDeMinimisService.getSctRevisions(productTypeId),
  getThresholdSettings: () => CalDeMinimisService.getThresholdSettings(),
  updateThresholdSettings: (request: CalDeMinimisThresholdSettingsUpdate) => CalDeMinimisService.updateThresholdSettings(request),
  calculate: (request: CalDeMinimisCalculationRequest) => CalDeMinimisService.calculate(request),
}

import { EarStatusService } from '@src/_workspace/services/trade-compliance/ear-status/EarStatusService'

export const EarStatusModel = {
  search: async (query: any) => EarStatusService.search(query),
}

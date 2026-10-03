import { EccnService } from '@src/_workspace/services/trade-compliance/eccn/EccnService'

export const EccnModel = {
  search: async (query: any) => EccnService.search(query),
  getHsCodeRelationsByEccnId: async (eccnId: number) => EccnService.getHsCodeRelationsByEccnId(eccnId),
}

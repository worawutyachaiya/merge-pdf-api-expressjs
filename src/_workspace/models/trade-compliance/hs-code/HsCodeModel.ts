import { HsCodeService } from '@src/_workspace/services/trade-compliance/hs-code/HsCodeService'

export const HsCodeModel = {
  search: async (query: any) => HsCodeService.search(query),
  getEccnRelationsByHsCodeId: async (hsCodeId: number) => HsCodeService.getEccnRelationsByHsCodeId(hsCodeId),
}

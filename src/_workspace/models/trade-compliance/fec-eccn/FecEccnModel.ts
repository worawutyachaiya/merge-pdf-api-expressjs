import { FecEccnService } from '@src/_workspace/services/trade-compliance/fec-eccn/FecEccnService'

export const FecEccnModel = {
  search: async (query: any) => FecEccnService.search(query),
  create: async (query: any) => FecEccnService.create(query),
  update: async (query: any) => FecEccnService.update(query),
  delete: async (query: any) => FecEccnService.delete(query)
}

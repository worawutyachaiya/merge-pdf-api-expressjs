import { CountryService } from '@src/_workspace/services/trade-compliance/country/CountryService'

export const CountryModel = {
  search: async (query: any) => CountryService.search(query),
}

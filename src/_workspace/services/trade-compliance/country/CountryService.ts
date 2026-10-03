import { MySQLExecute } from '@businessData/dbExecute'
import { CountrySQL } from '@src/_workspace/sql/trade-compliance/country/CountrySQL'
import { countrySearchSchema } from '@src/_workspace/types/trade-compliance/CountrySearch'
import { RowDataPacket } from 'mysql2'

export const CountryService = {
  search: (input: unknown): Promise<RowDataPacket[][]> => {
    const query = countrySearchSchema.parse(input)
    return MySQLExecute.search(CountrySQL.search(query))
  },
}

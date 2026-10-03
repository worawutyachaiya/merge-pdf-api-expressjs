import { z } from 'zod'

export const countryColumns = ['COUNTRY_ID', 'COUNTRY_NAME', 'COUNTRY_ALPHA2', 'COUNTRY_ALPHA3', 'INUSE', 'CREATE_DATE', 'CREATE_BY', 'UPDATE_DATE', 'UPDATE_BY'] as const
const scalar = z.union([z.string(), z.number(), z.boolean()])

export const countrySearchSchema = z.object({
  SearchFilters: z.array(z.object({ id: z.enum([...countryColumns, 'STATUS', 'INCLUDING_CANCELLED']), value: scalar.nullable() })).default([]),
  ColumnFilters: z
    .array(
      z.object({
        column: z.enum(countryColumns),
        columnFns: z
          .enum([
            'contains',
            'startsWith',
            'endsWith',
            'equals',
            'notEquals',
            'greaterThan',
            'greaterThanOrEqualTo',
            'lessThan',
            'lessThanOrEqualTo',
            'empty',
            'notEmpty',
            'between',
            'betweenInclusive',
            'arrIncludesSome',
          ])
          .default('contains'),
        value: z.union([scalar, z.array(scalar), z.null()]),
      })
    )
    .default([]),
  Order: z.array(z.object({ id: z.enum(countryColumns), desc: z.boolean() })).default([]),
  Start: z.coerce.number().int().min(0).max(1000000).default(0),
  Limit: z.coerce.number().int().min(1).max(1000).default(10),
})

export type CountrySearchInput = z.infer<typeof countrySearchSchema>

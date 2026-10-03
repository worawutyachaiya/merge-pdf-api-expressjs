import { z } from 'zod'

const positiveInteger = z.coerce.number().int().positive()

export const calDeMinimisProductTypesRequestSchema = z.object({
  query: z.object({
    SEARCH: z.string().trim().max(100).optional().default(''),
  }),
})

export const calDeMinimisSctRevisionsRequestSchema = z.object({
  query: z.object({
    PRODUCT_TYPE_ID: positiveInteger,
  }),
})

export const calDeMinimisCalculateRequestSchema = z.object({
  body: z
    .object({
      PRODUCT_TYPE_ID: positiveInteger,
      SCT_ID: z.string().uuid(),
    })
    .strict(),
})

const percentage = z.coerce.number().finite().min(0).max(100)

export const calDeMinimisThresholdSettingsUpdateRequestSchema = z.object({
  body: z
    .object({
      US_ORIGIN_THRESHOLD_PERCENT: percentage,
      FEC_CONTROLLED_THRESHOLD_PERCENT: percentage,
      UPDATE_BY: z.string().trim().min(1).max(30),
    })
    .strict(),
})

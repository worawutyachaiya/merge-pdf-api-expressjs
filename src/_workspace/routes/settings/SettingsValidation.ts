import { z } from 'zod'

export const documentOrderFields = z.object({
  order: z
    .array(z.object({ categoryId: z.number().int().positive(), revisionNo: z.number().int().positive() }))
    .min(1)
    .max(255),
})

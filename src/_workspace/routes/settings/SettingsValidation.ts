import { z } from 'zod'

const category = z.object({ name: z.string().trim().min(1).max(100), enabled: z.boolean() })

export const documentOrderFields = z.object({
  order: z
    .array(z.union([
      category.partial().extend({ categoryId: z.number().int().min(1).max(255), revisionNo: z.number().int().positive() }),
      category.extend({ categoryId: z.null(), enabled: z.literal(true) }),
    ]))
    .min(1)
    .max(255),
})

import { z } from 'zod'

export const id = z.coerce.number().int().positive().safe()

export const version = z.number().int().positive()

export const previewRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional()

export const jobFields = z.object({
  title: z.string().trim().max(255).default(''),
  reference: z.string().trim().max(100).nullable(),
})

export const editFields = jobFields.extend({ rowVersion: version })

export const versionFields = z.object({ rowVersion: version })

export const completeFields = versionFields.extend({ fields: jobFields.optional() })

export const reorderFields = versionFields.extend({ pageIds: z.array(id).max(500) })

export const batchFields = versionFields.extend({
  pageIds: z
    .array(id)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate page IDs'),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('category'), categoryId: z.number().int().min(1).max(10) }),
    z.object({ kind: z.literal('rotate'), delta: z.union([z.literal(90), z.literal(270)]) }),
    z.object({ kind: z.literal('remove') }),
  ]),
})

export const uploadFields = z.object({
  rowVersion: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().min(1).max(10),
  entryStatusCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
})

export const combinedUploadFields = z.object({ rowVersion: z.coerce.number().int().positive() })

export const pageCategoryFields = versionFields.extend({ categoryId: z.number().int().min(1).max(10) })

export const pageRotationFields = versionFields.extend({ delta: z.union([z.literal(90), z.literal(270)]) })

export const entryStatusFields = versionFields.extend({
  statusCode: z
    .string()
    .regex(/^\d{2}$/)
    .nullable(),
})

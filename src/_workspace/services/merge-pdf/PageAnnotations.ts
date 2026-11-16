import { z } from 'zod'
import sharp from 'sharp'

const placement = {
  id: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
}

export const pageAnnotationsSchema = z.array(z.discriminatedUnion('kind', [
  z.object({
    ...placement, kind: z.literal('remark'), text: z.string().max(2000),
    fontSize: z.number().min(6).max(72).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  z.object({
    ...placement, kind: z.literal('estamp'),
    image: z.string().max(2_800_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/),
  }),
])).max(50).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate page annotation' })
  items.forEach((item, index) => {
    if (item.x + item.width > 1.000001 || item.y + item.height > 1.000001)
      ctx.addIssue({ code: 'custom', path: [index], message: 'Annotation must stay inside the page' })
  })
})

export type PageAnnotation = z.infer<typeof pageAnnotationsSchema>[number]

export const validatePageAnnotations = async (pages: readonly { EDITOR_ANNOTATIONS?: PageAnnotation[] | null }[]) => {
  let total = 0
  const checked = new Set<string>()
  for (const page of pages) for (const item of page.EDITOR_ANNOTATIONS ?? []) {
    if (item.kind !== 'estamp') continue
    total += item.image.length
    if (total > 12 * 1024 * 1024) throw new Error('E-stamp images exceed the 12 MB document limit')
    if (checked.has(item.image)) continue
    const bytes = Buffer.from(item.image.slice(item.image.indexOf(',') + 1), 'base64')
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Each E-stamp image must be at most 2 MB')
    const meta = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata()
    if (!['png', 'jpeg'].includes(meta.format ?? '') || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) !== 1)
      throw new Error('E-stamp must be a single PNG or JPEG image up to 4096 × 4096 pixels')
    if (!item.image.startsWith(`data:image/${meta.format};base64,`)) throw new Error('E-stamp image format does not match its contents')
    checked.add(item.image)
  }
}

import { z } from 'zod'

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const systemFontFamilies = ['tahoma', 'ms-gothic', 'comic-sans-ms', 'angsana-new', 'times-new-roman'] as const
export type SystemFontFamily = (typeof systemFontFamilies)[number]
export const isSystemFont = (family: string): family is SystemFontFamily => systemFontFamilies.some(id => id === family)

export const textFormatting = {
  fontFamily: z.enum([
    'sans', 'serif', 'mono', 'inter', 'roboto-condensed', 'montserrat', 'source-sans-3', 'lora', 'ibm-plex-mono', 'sarabun',
    ...systemFontFamilies,
  ]).optional(),
  color: hexColor.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
}

export const textStyleSchema = z.object(textFormatting)
export type TextStyle = z.infer<typeof textStyleSchema>

export const isStandardFont = (family: NonNullable<TextStyle['fontFamily']>): family is 'sans' | 'serif' | 'mono' =>
  family === 'sans' || family === 'serif' || family === 'mono'

import { isStandardFont, isSystemFont, type TextStyle } from './TextFormatting'

export interface StampCoordinates {
  x: number
  y: number
  fontSize?: number
  style?: TextStyle
}

export const STAMP_COORDINATE_MIN = -1
export const STAMP_COORDINATE_MAX = 2
export const DEFAULT_STAMP_FONT_SIZE = 25
export const stampVerticalMetrics = (size: number, style: TextStyle) => {
  const family = style.fontFamily ?? 'sans'
  const standard = isStandardFont(family)
  const system = isSystemFont(family)
  const baseline = size * (standard ? 0.74 : 0.8)
  const height = size * (standard ? (style.underline ? 0.84 : 0.76) : (style.underline ? 0.90 : system ? 0.86 : 0.83))
  return { baseline, height }
}

// Keep the original 0..1 positions and use the outer intervals for the margins.
export const stampOffset = (position: number, travel: number, nearInset: number, farInset: number): number => {
  const start = Math.min(travel, nearInset)
  const end = Math.max(start, travel - farInset)
  if (position < 0) return start * (1 + position)
  if (position > 1) return end + (travel - end) * (position - 1)
  return start + (end - start) * position
}

export const jobStampCoordinates = (job: {
  STAMP_X?: number | null
  STAMP_Y?: number | null
  STAMP_FONT_SIZE?: number | null
  STAMP_STYLE?: TextStyle | null
}): StampCoordinates => ({
  x: job.STAMP_X ?? 1,
  y: job.STAMP_Y ?? 0,
  fontSize: job.STAMP_FONT_SIZE ?? DEFAULT_STAMP_FONT_SIZE,
  style: job.STAMP_STYLE ?? undefined,
})

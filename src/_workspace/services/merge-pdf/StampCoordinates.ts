export interface StampCoordinates {
  x: number
  y: number
  fontSize?: number
}

export const jobStampCoordinates = (job: { STAMP_X?: number | null; STAMP_Y?: number | null; STAMP_FONT_SIZE?: number | null }): StampCoordinates => ({
  x: job.STAMP_X ?? 1,
  y: job.STAMP_Y ?? 0,
  fontSize: job.STAMP_FONT_SIZE ?? 10,
})

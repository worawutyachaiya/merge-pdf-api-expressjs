import { createCanvas } from '@napi-rs/canvas'
import sharp from 'sharp'

import { MergePdfRepository as repo } from '@src/_workspace/sql/merge-pdf/MergePdfRepository'
import { loadPdfJs } from './PdfJs'

const cache = new Map<number, Promise<Buffer[]>>()
const MAX_CACHED_DOCUMENTS = 5

const renderDocument = async (documentId: number, pageCount: number): Promise<Buffer[]> => {
  const bytes = await repo.getDocumentPdf(documentId)
  if (!bytes) throw new Error('Source document not found')
  return renderPdfThumbnails(bytes, pageCount)
}

export const renderPdfThumbnails = async (bytes: Buffer, pageCount: number): Promise<Buffer[]> => {
  const loadingTask = await loadPdfJs(bytes)
  try {
    const pdf = await loadingTask.promise
    if (pdf.numPages !== pageCount || pageCount < 1 || pageCount > 500) throw new Error('Invalid PDF page count')
    const images: Buffer[] = []
    for (let index = 1; index <= pageCount; index++) {
      const page = await pdf.getPage(index)
      const original = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: 240 / original.width })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
        images.push(canvas.toBuffer('image/png'))
      } finally {
        page.cleanup()
      }
    }
    return images
  } finally {
    await loadingTask.destroy()
  }
}

const cachedDocument = (documentId: number, pageCount: number): Promise<Buffer[]> => {
  const existing = cache.get(documentId)
  if (existing) return existing
  const pending = renderDocument(documentId, pageCount).catch((error) => {
    cache.delete(documentId)
    throw error
  })
  cache.set(documentId, pending)
  if (cache.size > MAX_CACHED_DOCUMENTS) cache.delete(cache.keys().next().value!)
  return pending
}

export const getPageThumbnail = async (jobId: number, pageId: number, rotation?: number): Promise<Buffer | undefined> => {
  const page = await repo.getPageThumbnailSource(jobId, pageId)
  if (!page) return undefined
  const images = await cachedDocument(page.DOCUMENT_ID, page.PDF_PAGE_COUNT)
  const image = images[page.SOURCE_PAGE_NUMBER - 1]
  if (!image) throw new Error('Thumbnail page missing')
  return sharp(image)
    .rotate(rotation ?? page.ROTATION_DEGREES)
    .png()
    .toBuffer()
}

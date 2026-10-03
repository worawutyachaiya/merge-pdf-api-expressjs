import path from 'node:path'

import { PDFDocument, degrees } from 'pdf-lib'
import sharp from 'sharp'

import type { SourceType } from '@src/_workspace/types/merge-pdf/MergePdf'

const MAX_PAGES = 500
// The development database max_allowed_packet is 64 MiB. The repository writes
// each PDF BLOB separately so the base64 transfer stays under that limit.
const MAX_PDF_BYTES = 40 * 1024 * 1024

export interface NormalizedFile {
  sourceType: SourceType
  sourceMime: string
  pdfBytes: Buffer
  pageCount: number
}

const detectSource = (fileName: string, bytes: Buffer): { type: SourceType; mime: string } => {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { type: 'PDF', mime: 'application/pdf' }
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'].includes(extension)) {
    return { type: 'IMAGE', mime: 'image/' + extension.replace('.', '') }
  }
  if (['.xlsx', '.xls'].includes(extension)) {
    const zip = bytes.subarray(0, 2).toString('ascii') === 'PK'
    const ole = bytes.subarray(0, 8).equals(Buffer.from('D0CF11E0A1B11AE1', 'hex'))
    if ((extension === '.xlsx' && zip) || (extension === '.xls' && ole)) {
      return { type: 'EXCEL', mime: extension === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.ms-excel' }
    }
  }
  throw new Error('Unsupported file format or invalid file signature')
}

export const normalizeFile = async (fileName: string, bytes: Buffer): Promise<NormalizedFile> => {
  const source = detectSource(fileName, bytes)
  let pdfBytes: Buffer

  if (source.type === 'PDF') {
    pdfBytes = bytes
  } else if (source.type === 'EXCEL') {
    throw new Error('Excel conversion is unavailable until a company-approved converter is provided')
  } else {
    const metadata = await sharp(bytes, { limitInputPixels: 60_000_000 }).metadata()
    if (!['jpeg', 'png', 'webp', 'tiff'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
      throw new Error('Unsupported or multipage image')
    }
    const imageBytes = await sharp(bytes).rotate().png().toBuffer()
    const pdf = await PDFDocument.create()
    const image = await pdf.embedPng(imageBytes)
    const scale = Math.min(1, 595 / image.width, 842 / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const page = pdf.addPage([width, height])
    page.drawImage(image, { x: 0, y: 0, width, height })
    pdfBytes = Buffer.from(await pdf.save())
  }

  let pageCount: number
  try {
    pageCount = (await PDFDocument.load(pdfBytes)).getPageCount()
  } catch {
    throw new Error('PDF is damaged, encrypted or unsupported')
  }
  if (pageCount < 1 || pageCount > MAX_PAGES || pdfBytes.length > MAX_PDF_BYTES) {
    throw new Error('Document exceeds the page or size limit')
  }
  return { sourceType: source.type, sourceMime: source.mime, pdfBytes, pageCount }
}

const applyRotation = (page: import('pdf-lib').PDFPage, rotationDegrees: number): void => {
  if (![0, 90, 180, 270].includes(rotationDegrees)) throw new Error('Invalid page rotation')
  page.setRotation(degrees((page.getRotation().angle + rotationDegrees) % 360))
}

export const extractPage = async (bytes: Buffer, sourcePageNumber: number, rotationDegrees: number): Promise<Buffer> => {
  const source = await PDFDocument.load(bytes)
  if (sourcePageNumber < 1 || sourcePageNumber > source.getPageCount()) throw new Error('Invalid source page number')
  const output = await PDFDocument.create()
  const [page] = await output.copyPages(source, [sourcePageNumber - 1])
  applyRotation(page, rotationDegrees)
  output.addPage(page)
  return Buffer.from(await output.save())
}

export const mergePages = async (
  pages: readonly { documentId: number; sourcePageNumber: number; rotationDegrees: number }[],
  documents: ReadonlyMap<number, Buffer>
): Promise<Buffer> => {
  if (pages.length < 1 || pages.length > MAX_PAGES) throw new Error('Invalid merged page count')
  const output = await PDFDocument.create()
  const loaded = new Map<number, PDFDocument>()
  for (const page of pages) {
    let source = loaded.get(page.documentId)
    if (!source) {
      const bytes = documents.get(page.documentId)
      if (!bytes) throw new Error('Missing source document')
      source = await PDFDocument.load(bytes)
      loaded.set(page.documentId, source)
    }
    if (page.sourcePageNumber < 1 || page.sourcePageNumber > source.getPageCount()) {
      throw new Error('Invalid source page number')
    }
    const [copied] = await output.copyPages(source, [page.sourcePageNumber - 1])
    applyRotation(copied, page.rotationDegrees)
    output.addPage(copied)
  }
  const result = Buffer.from(await output.save())
  if (result.length > MAX_PDF_BYTES) throw new Error('Merged PDF exceeds the size limit')
  return result
}

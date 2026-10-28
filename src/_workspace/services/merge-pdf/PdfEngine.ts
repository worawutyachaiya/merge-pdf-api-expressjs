import path from 'node:path'

import { PDFDocument, degrees, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import sharp from 'sharp'

import type { SourceType } from '@src/_workspace/types/merge-pdf/MergePdf'
import { convertExcelToPdf } from './ExcelPdf'

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
  // Some PDF producers prepend text before the PDF header. The parser below
  // still validates the document after the prefix is removed.
  if (extension === '.pdf' && bytes.subarray(0, 1024).indexOf('%PDF-') !== -1) {
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
    pdfBytes = await convertExcelToPdf(fileName, bytes)
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

// Rotate page content around the centre while keeping the page size and vector content.
const applyDeskew = (page: import('pdf-lib').PDFPage, angle: number): void => {
  if (!Number.isFinite(angle) || Math.abs(angle) > 15) throw new Error('Invalid deskew angle')
  if (!angle) return
  const { x, y, width, height } = page.getCropBox()
  const cx = x + width / 2, cy = y + height / 2
  const radians = angle * Math.PI / 180
  const cos = Math.cos(radians), sin = Math.sin(radians)
  page.node.normalize()
  const start = page.doc.context.register(page.doc.context.contentStream([
    pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)
  ]))
  const end = page.doc.context.register(page.doc.context.contentStream([popGraphicsState()]))
  page.node.wrapContentStreams(start, end)
}

export const extractPage = async (bytes: Buffer, sourcePageNumber: number, rotationDegrees: number, deskewDegrees = 0): Promise<Buffer> => {
  const source = await PDFDocument.load(bytes)
  if (sourcePageNumber < 1 || sourcePageNumber > source.getPageCount()) throw new Error('Invalid source page number')
  const output = await PDFDocument.create()
  const [page] = await output.copyPages(source, [sourcePageNumber - 1])
  applyDeskew(page, deskewDegrees)
  applyRotation(page, rotationDegrees)
  output.addPage(page)
  return Buffer.from(await output.save())
}

export const mergePages = async (
  pages: readonly { documentId: number; sourcePageNumber: number; rotationDegrees: number; deskewDegrees?: number }[],
  documents: ReadonlyMap<number, Buffer>,
  documentName?: string
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
    applyDeskew(copied, page.deskewDegrees ?? 0)
    applyRotation(copied, page.rotationDegrees)
    output.addPage(copied)
  }
  if (documentName) await drawDocumentName(output, documentName)
  const result = Buffer.from(await output.save())
  if (result.length > MAX_PDF_BYTES) throw new Error('Merged PDF exceeds the size limit')
  return result
}

const drawDocumentName = async (pdf: PDFDocument, name: string) => {
  const page = pdf.getPage(0)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const size = 10
  const width = font.widthOfTextAtSize(name, size)
  const box = page.getCropBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const margin = 18
  const positions: Record<number, { x: number; y: number }> = {
    0: { x: box.x + box.width - margin - width, y: box.y + box.height - margin - size },
    90: { x: box.x + box.width - margin - size, y: box.y + margin + width },
    180: { x: box.x + margin + width, y: box.y + margin + size },
    270: { x: box.x + margin + size, y: box.y + box.height - margin - width }
  }
  page.drawText(name, { ...positions[rotation], size, font, color: rgb(0, 0, 0), rotate: degrees(rotation) })
}
export const stampDocumentName = async (bytes: Buffer, name: string): Promise<Buffer> => {
  const pdf = await PDFDocument.load(bytes)
  await drawDocumentName(pdf, name)
  return Buffer.from(await pdf.save())
}

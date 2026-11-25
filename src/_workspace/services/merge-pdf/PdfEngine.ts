import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { createCanvas } from '@napi-rs/canvas'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFNumber, degrees, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, type PDFPage, type PDFImage } from 'pdf-lib'
import sharp from 'sharp'
import { STAMP_COORDINATE_MAX, STAMP_COORDINATE_MIN, stampVerticalMetrics, stampOffset, type StampCoordinates } from './StampCoordinates'
import type { PageAnnotation, PageCover } from './PageAnnotations'
import { loadPdfJs } from './PdfJs'
import { isStandardFont, isSystemFont, type TextStyle } from './TextFormatting'
import { loadSystemIndexFont } from './SystemIndexFonts'

import type { PageClassification, SourceType } from '@src/_workspace/types/merge-pdf/MergePdf'
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
  pageClassifications?: PageClassification[]
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
  let pageClassifications: PageClassification[] | undefined

  if (source.type === 'PDF') {
    pdfBytes = bytes
  } else if (source.type === 'EXCEL') {
    const converted = await convertExcelToPdf(fileName, bytes)
    pdfBytes = converted.pdfBytes
    pageClassifications = converted.pageClassifications
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
  return { sourceType: source.type, sourceMime: source.mime, pdfBytes, pageCount, pageClassifications }
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
  const cx = x + width / 2,
    cy = y + height / 2
  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians),
    sin = Math.sin(radians)
  page.node.normalize()
  const start = page.doc.context.register(
    page.doc.context.contentStream([pushGraphicsState(), concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy)])
  )
  const end = page.doc.context.register(page.doc.context.contentStream([popGraphicsState()]))
  page.node.wrapContentStreams(start, end)
}

const copyEditedPage = async (output: PDFDocument, source: PDFDocument, sourcePageNumber: number, rotationDegrees: number, deskewDegrees = 0) => {
  if (sourcePageNumber < 1 || sourcePageNumber > source.getPageCount()) throw new Error('Invalid source page number')
  const [page] = await output.copyPages(source, [sourcePageNumber - 1])
  applyDeskew(page, deskewDegrees)
  applyRotation(page, rotationDegrees)
  output.addPage(page)
  return page
}

export const extractPage = async (bytes: Buffer, sourcePageNumber: number, rotationDegrees: number, deskewDegrees = 0): Promise<Buffer> => {
  const source = await PDFDocument.load(bytes)
  const output = await PDFDocument.create()
  await copyEditedPage(output, source, sourcePageNumber, rotationDegrees, deskewDegrees)
  return Buffer.from(await output.save())
}

// Paint the covers before embedding the image. Never copy the covered page's source resources into the output.
const addCoveredPage = async (output: PDFDocument, bytes: Buffer, covers: readonly PageCover[]): Promise<PDFPage> => {
  const task = await loadPdfJs(bytes)
  try {
    const source = await (await task.promise).getPage(1)
    const natural = source.getViewport({ scale: 1 })
    const density = Math.min(2.5, Math.sqrt(16_000_000 / (natural.width * natural.height)), 8192 / Math.max(natural.width, natural.height))
    const viewport = source.getViewport({ scale: density })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    await source.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
    }).promise
    context.resetTransform()
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    for (const cover of covers) {
      const x = Math.floor(cover.x * canvas.width)
      const y = Math.floor(cover.y * canvas.height)
      const right = Math.ceil((cover.x + cover.width) * canvas.width)
      const bottom = Math.ceil((cover.y + cover.height) * canvas.height)
      context.fillStyle = cover.color
      context.fillRect(x, y, right - x, bottom - y)
    }
    const width = natural.width / source.userUnit
    const height = natural.height / source.userUnit
    const image = await output.embedPng(canvas.toBuffer('image/png'))
    const page = output.addPage([width, height])
    if (source.userUnit !== 1) page.node.set(PDFName.of('UserUnit'), PDFNumber.of(source.userUnit))
    page.drawImage(image, { x: 0, y: 0, width, height })
    return page
  } finally {
    await task.destroy()
  }
}

export const mergePages = async (
  pages: readonly { documentId: number; sourcePageNumber: number; rotationDegrees: number; deskewDegrees?: number; annotations?: readonly PageAnnotation[] }[],
  documents: ReadonlyMap<number, Buffer>,
  documentName?: string,
  stampCoordinates: StampCoordinates = { x: 1, y: 0 }
): Promise<Buffer> => {
  if (pages.length < 1 || pages.length > MAX_PAGES) throw new Error('Invalid merged page count')
  const output = await PDFDocument.create()
  const loaded = new Map<number, PDFDocument>()
  const images = new Map<string, PDFImage>()
  for (const page of pages) {
    let source = loaded.get(page.documentId)
    if (!source) {
      const bytes = documents.get(page.documentId)
      if (!bytes) throw new Error('Missing source document')
      source = await PDFDocument.load(bytes)
      loaded.set(page.documentId, source)
    }
    const annotations = page.annotations ?? []
    const covers = annotations.filter((item): item is PageCover => item.kind === 'cover')
    const target = covers.length ? await PDFDocument.create() : output
    const edited = await copyEditedPage(target, source, page.sourcePageNumber, page.rotationDegrees, page.deskewDegrees)
    const exported = covers.length ? await addCoveredPage(output, Buffer.from(await target.save()), covers) : edited
    await drawEStamps(output, exported, annotations, images)
  }
  if (documentName) await drawDocumentName(output, documentName, stampCoordinates)
  const result = Buffer.from(await output.save())
  if (result.length > MAX_PDF_BYTES) throw new Error('Merged PDF exceeds the size limit')
  return result
}

// Remarks are editor metadata only; never turn them into PDF annotations or text.
const drawEStamps = async (pdf: PDFDocument, page: PDFPage, annotations: readonly PageAnnotation[], images: Map<string, PDFImage>) => {
  const { width: visualWidth, height: visualHeight, rotation, toPdf } = visualPageGeometry(page)
  for (const item of annotations) {
    if (item.kind !== 'estamp') continue
    let image = images.get(item.image)
    if (!image) {
      const bytes = Buffer.from(item.image.slice(item.image.indexOf(',') + 1), 'base64')
      image = item.image.startsWith('data:image/png;') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
      images.set(item.image, image)
    }
    // Match object-fit: contain in the editor, including the page's intrinsic rotation.
    const boundsWidth = item.width * visualWidth, boundsHeight = item.height * visualHeight
    const fit = Math.min(boundsWidth / image.width, boundsHeight / image.height)
    const width = image.width * fit, height = image.height * fit
    const vx = item.x * visualWidth + (boundsWidth - width) / 2
    const vy = visualHeight - item.y * visualHeight - (boundsHeight + height) / 2
    page.drawImage(image, { ...toPdf(vx, vy), width, height, rotate: degrees(rotation) })
  }
}

const visiblePageBox = (page: PDFPage) => {
  const media = page.getMediaBox()
  const crop = page.getCropBox()
  const x = Math.max(media.x, crop.x)
  const y = Math.max(media.y, crop.y)
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : media
}

const visualPageGeometry = (page: PDFPage) => {
  const box = visiblePageBox(page)
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const sideways = rotation === 90 || rotation === 270
  const toPdf = (x: number, y: number) => {
    if (rotation === 90) return { x: box.x + box.width - y, y: box.y + x }
    if (rotation === 180) return { x: box.x + box.width - x, y: box.y + box.height - y }
    if (rotation === 270) return { x: box.x + y, y: box.y + box.height - x }
    return { x: box.x + x, y: box.y + y }
  }
  return { width: sideways ? box.height : box.width, height: sideways ? box.width : box.height, rotation, toPdf }
}

const indexFonts = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
}

const indexFontBytes = new Map<string, Promise<Buffer>>()

const embedIndexFont = async (pdf: PDFDocument, style: TextStyle) => {
  const family = style.fontFamily ?? 'sans'
  const variant = Number(!!style.bold) + 2 * Number(!!style.italic)
  const features = { kern: false, liga: false }
  if (isStandardFont(family)) {
    return pdf.embedFont(indexFonts[family][variant])
  }
  if (isSystemFont(family)) {
    const { bytes, font } = await loadSystemIndexFont(family, variant)
    // A TTC may contain several unrelated faces. Embed only the chosen face.
    pdf.registerFontkit({ create: () => font })
    return pdf.embedFont(bytes, { subset: true, features })
  }

  const file = `${family}-latin-${style.bold ? 700 : 400}-${style.italic ? 'italic' : 'normal'}.woff`
  let bytes = indexFontBytes.get(file)
  if (!bytes) {
    bytes = readFile(require.resolve(`@fontsource/${family}/files/${file}`)).catch(error => {
      indexFontBytes.delete(file)
      throw error
    })
    indexFontBytes.set(file, bytes)
  }
  pdf.registerFontkit(fontkit)
  // Match the editor's canvas measurements and keep the saved index as searchable text.
  return pdf.embedFont(await bytes, { subset: true, features })
}

const textColor = (hex = '#000000') => {
  const value = parseInt(hex.slice(1), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

const drawDocumentName = async (pdf: PDFDocument, name: string, position: StampCoordinates = { x: 1, y: 0 }) => {
  const page = pdf.getPage(0)
  const style = position.style ?? {}
  const font = await embedIndexFont(pdf, style)
  const size = position.fontSize ?? 10
  if (!Number.isFinite(size) || size < 6 || size > 48) throw new Error('Stamp size must be between 6 and 48 pt')
  const width = font.widthOfTextAtSize(name, size)
  const { width: visualWidth, height: visualHeight, rotation, toPdf } = visualPageGeometry(page)
  const margin = 18
  const { x, y } = position
  if (![x, y].every((value) => Number.isFinite(value) && value >= STAMP_COORDINATE_MIN && value <= STAMP_COORDINATE_MAX))
    throw new Error('Invalid stamp coordinates')
  const { baseline, height } = stampVerticalMetrics(size, style)
  const vx = stampOffset(x, Math.max(0, visualWidth - width), margin, margin)
  const top = stampOffset(y, Math.max(0, visualHeight - height), margin + size - baseline, margin + baseline - height)
  const vy = visualHeight - top - baseline
  const color = textColor(style.color)
  page.drawText(name, { ...toPdf(vx, vy), size, font, color, rotate: degrees(rotation) })
  const drawDecoration = (y: number) => {
    page.drawLine({ start: toPdf(vx, y), end: toPdf(vx + width, y), thickness: size * 0.045, color })
  }
  if (style.underline) drawDecoration(vy - size * 0.065)
  if (style.strikethrough) drawDecoration(vy + size * 0.28)
}
export const stampDocumentName = async (bytes: Buffer, name: string, position: StampCoordinates = { x: 1, y: 0 }): Promise<Buffer> => {
  const pdf = await PDFDocument.load(bytes)
  await drawDocumentName(pdf, name, position)
  return Buffer.from(await pdf.save())
}

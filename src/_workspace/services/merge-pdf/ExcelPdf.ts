import { existsSync } from 'node:fs'
import path from 'node:path'

import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import * as XLSX from 'xlsx'

import type { PageClassification } from '@src/_workspace/types/merge-pdf/MergePdf'
import { classifyDocumentHeadings } from './CombinedPdfClassification'

const DPI = 144
const MAX_CELLS = 20_000
const MAX_PAGES = 100
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
function unsupported(feature: string): never {
  throw new Error(`Excel ${feature} is not supported by this converter. Export this workbook to PDF from Excel before importing.`)
}
type Segment = { index: number; start: number; size: number }
type ImageData = { x: number; y: number; width: number; height: number; uri: string }
type TextData = { uri: string; width: number; height: number }

const hexColor = (color: Partial<ExcelJS.Color> | undefined, fallback: string): string => {
  const value = color?.argb?.slice(-6)
  return value && /^[\da-f]{6}$/i.test(value) ? `#${value}` : fallback
}

const segments = (indices: number[], size: (index: number) => number): Segment[] => {
  let offset = 0
  return indices.map((index) => {
    const result = { index, start: offset, size: size(index) }
    offset += result.size
    return result
  })
}
const total = (items: Segment[]) => items.reduce((sum, item) => sum + item.size, 0)

const partition = (items: Segment[], capacity: number, breaks: number[] = []): Segment[][] => {
  const result: Segment[][] = []
  let group: Segment[] = []
  let used = 0
  for (const item of items) {
    if (item.size > capacity + 0.01) unsupported('row/column larger than a printed page')
    const previous = group.at(-1)
    const manualBreak = previous && breaks.some((breakAfter) => previous.index <= breakAfter && breakAfter < item.index)
    if (previous && (used + item.size > capacity + 0.01 || manualBreak)) {
      result.push(group)
      group = []
      used = 0
    }
    group.push(item)
    used += item.size
  }
  if (group.length) result.push(group)
  return result
}

const legacyWorkbook = (source: XLSX.WorkBook): ExcelJS.Workbook => {
  const result = new ExcelJS.Workbook()
  source.SheetNames.forEach((name, index) => {
    const data = source.Sheets[name]
    const sheet = result.addWorksheet(name)
    sheet.state = source.Workbook?.Sheets?.[index]?.Hidden ? 'hidden' : 'visible'
    sheet.pageSetup = { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    for (const [address, cell] of Object.entries(data)) {
      if (address.startsWith('!') || !cell || typeof cell !== 'object' || !('t' in cell)) continue
      const value = cell as XLSX.CellObject
      if (value.f && value.v === undefined) unsupported('formula without a saved result')
      sheet.getCell(address).value = value.w ?? (value.v instanceof Date ? value.v.toLocaleDateString('en-GB') : String(value.v ?? ''))
    }
    data['!merges']?.forEach((range) => sheet.mergeCells(range.s.r + 1, range.s.c + 1, range.e.r + 1, range.e.c + 1))
    data['!cols']?.forEach((column, col) => {
      sheet.getColumn(col + 1).width = column.wch ?? ((column.wpx ?? 64) - 5) / 7
      sheet.getColumn(col + 1).hidden = !!column.hidden
    })
    data['!rows']?.forEach((row, num) => {
      sheet.getRow(num + 1).height = row.hpt ?? (row.hpx ? row.hpx * 0.75 : 15)
      sheet.getRow(num + 1).hidden = !!row.hidden
    })
  })
  return result
}

const isInvisibleShape = (shape: string): boolean => {
  if (/<(?:[\w.-]+:)?txBody\b|\btextlink\s*=\s*["'][^"']+/i.test(shape)) return false
  const properties = shape.match(/<(?:[\w.-]+:)?spPr\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?spPr\s*>/)?.[1]
  if (!properties) return false
  const transform = properties.match(/<(?:[\w.-]+:)?xfrm\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?xfrm\s*>/)?.[1]
  const extent = transform?.match(/<(?:[\w.-]+:)?ext\b[^>]*>/)?.[0]
  if (extent && /\bcx=["']0["']/.test(extent) && /\bcy=["']0["']/.test(extent)) return true

  // Ignore the empty text-box placeholder when both its fill and outline are disabled.
  const appearance = properties.split(/<(?:[\w.-]+:)?extLst\b/)[0]
  const line = appearance.match(/<(?:[\w.-]+:)?ln\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?ln\s*>/)?.[0]
  const noFill = /<(?:[\w.-]+:)?noFill\b[^>]*\/>/
  return !!line && noFill.test(line) && noFill.test(appearance.replace(line, '')) && !/<(?:[\w.-]+:)?(?:effectLst|effectDag|scene3d|sp3d)\b/.test(appearance)
}

type ArchiveEntry = { content?: Uint8Array; data?: string | Uint8Array; asNodeBuffer?: () => Buffer }
const readEntry = (entry: ArchiveEntry | undefined): string => (entry?.asNodeBuffer ? entry.asNodeBuffer() : Buffer.from(entry?.content ?? entry?.data ?? '')).toString('utf8')

const validateArchive = (files: Record<string, ArchiveEntry> | undefined): void => {
  for (const [fileName, file] of Object.entries(files ?? {})) {
    const name = fileName.replace(/^\/+/, '')
    if (/^xl\/(charts|embeddings)\//i.test(name)) unsupported('charts or embedded objects')
    if (/^xl\/drawings\/drawing.*\.xml$/i.test(name)) {
      const drawing = readEntry(file)
      const shapes = /<(?:[\w.-]+:)?sp(?=[\s/>])[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?sp\s*>/g
      const remaining = drawing.replace(shapes, (shape) => (isInvisibleShape(shape) ? '' : shape))
      if (/<(?:[\w.-]+:)?(?:sp|cxnSp|graphicFrame|grpSp)(?=[\s/>])/.test(remaining)) unsupported('visible shapes or text boxes')
    }
    if (/^xl\/worksheets\/sheet.*\.xml$/i.test(name)) {
      if (/<(?:\w+:)?conditionalFormatting\b/.test(readEntry(file))) unsupported('conditional formatting')
    }
  }
}

const xmlAttribute = (tag: string, name: string): string | undefined =>
  tag
    .match(new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`))
    ?.slice(1)
    .find((value) => value !== undefined)

const worksheetXmlByName = (book: XLSX.WorkBook, files: Record<string, ArchiveEntry> | undefined) => {
  const relationships = readEntry(files?.['xl/_rels/workbook.xml.rels'])
  const targets = new Map<string, string>()
  for (const relationship of relationships.match(/<(?:[\w.-]+:)?Relationship\s[^>]+>/g) ?? []) {
    const id = xmlAttribute(relationship, 'Id')
    const target = xmlAttribute(relationship, 'Target')
    if (!id || !target || !xmlAttribute(relationship, 'Type')?.endsWith('/worksheet')) continue
    const filename = target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target)
    targets.set(id, filename)
  }
  return new Map(
    (book.Workbook?.Sheets ?? []).map((sheet) => {
      const { id } = sheet as typeof sheet & { id?: string }
      const target = id ? targets.get(id) : undefined
      return [sheet.name, target ? readEntry(files?.[target]) : '']
    })
  )
}

const excelFont = () => {
  const systemDirs = [
    process.env.MERGE_PDF_SYSTEM_FONT_DIR?.trim(),
    process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:/Windows', 'Fonts') : undefined,
  ]
  for (const systemDir of systemDirs) {
    if (!systemDir) continue
    const regular = path.resolve(systemDir, 'tahoma.ttf')
    const bold = path.resolve(systemDir, 'tahomabd.ttf')
    if (existsSync(regular) && existsSync(bold)) return { family: 'Tahoma', regular, bold, italic: regular, boldItalic: bold }
  }

  const bundledDir = path.resolve(__dirname, '../../../../assets/excel-fonts')
  const regular = path.join(bundledDir, 'Sarabun-Regular.ttf')
  const bold = path.join(bundledDir, 'Sarabun-Bold.ttf')
  const italic = path.join(bundledDir, 'Sarabun-Italic.ttf')
  const boldItalic = path.join(bundledDir, 'Sarabun-BoldItalic.ttf')
  if (![regular, bold, italic, boldItalic].every(existsSync)) throw new Error('Excel conversion is unavailable: bundled Sarabun fonts are missing')
  return { family: 'Sarabun', regular, bold, italic, boldItalic }
}

const renderPageText = async (value: string | undefined, scale: number, font: ReturnType<typeof excelFont>) => {
  const sections = { L: '', C: '', R: '' }
  let section: keyof typeof sections = 'C'
  let fontFamily = font.family
  let fontSize = 11
  let fontStyle = ''
  for (const token of (value ?? '').match(/&"[^"]*"|&\d+|&[A-Za-z&]|[^&]+|&/g) ?? []) {
    if (token === '&L' || token === '&C' || token === '&R') {
      section = token[1] as keyof typeof sections
      fontFamily = font.family
      fontSize = 11
      fontStyle = ''
    } else if (token.startsWith('&"')) {
      const [family, style] = token
        .slice(2, -1)
        .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .split(',')
      if (font.family === 'Tahoma') fontFamily = family || font.family
      fontStyle = (style?.match(/bold|italic/gi) ?? []).join(' ')
    } else if (/^&\d/.test(token)) {
      fontSize = Math.min(72, Math.max(5, Number(token.slice(1))))
    } else if (token === '&&' || !token.startsWith('&')) {
      const content = token === '&&' ? '&' : token
      const size = Math.round(fontSize * scale * 1024)
      sections[section] += '<span font_desc="' + xml([fontFamily, fontStyle].filter(Boolean).join(' ')) + '" size="' + size + '">' + xml(content) + '</span>'
    } else {
      unsupported('header or footer fields')
    }
  }
  return Promise.all(
    (Object.keys(sections) as (keyof typeof sections)[]).map(async (align) => {
      const markup = sections[align]
      if (!markup.replace(/<[^>]+>/g, '').trim()) return null
      const { data: png, info } = await sharp({
        text: {
          text: markup,
          font: font.family,
          fontfile: font.regular,
          dpi: DPI,
          rgba: true,
          align: align === 'C' ? 'centre' : align === 'R' ? 'right' : 'left',
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true })
      return { align, uri: 'data:image/png;base64,' + png.toString('base64'), width: (info.width * 72) / DPI, height: (info.height * 72) / DPI }
    })
  )
}

export const convertExcelToPdf = async (fileName: string, bytes: Buffer): Promise<{ pdfBytes: Buffer; pageClassifications: PageClassification[] }> => {
  // Read cached display values. No workbook macros, external links or formulas execute.
  const data = XLSX.read(bytes, { type: 'buffer', cellStyles: true, cellNF: true, cellText: true, bookFiles: true })
  const files = (data as XLSX.WorkBook & { files?: Record<string, ArchiveEntry> }).files
  validateArchive(files)
  const worksheetXml = worksheetXmlByName(data, files)
  const workbook = path.extname(fileName).toLowerCase() === '.xlsx' ? new ExcelJS.Workbook() : legacyWorkbook(data)
  if (path.extname(fileName).toLowerCase() === '.xlsx') await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  if (workbook.worksheets.length > 30) throw new Error('Excel exceeds 30 worksheets')
  const renderFont = excelFont()
  const pdf = await PDFDocument.create()
  const pageClassifications: PageClassification[] = []
  const textCache = new Map<string, Promise<TextData>>()
  let cellCount = 0

  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue
    const source = data.Sheets[sheet.name]
    if (!sheet.actualRowCount && !sheet.getImages().length) continue
    const headerFooter = sheet.headerFooter
    if (headerFooter?.differentFirst || headerFooter?.differentOddEven) unsupported('first-page or even-page headers or footers')
    const sheetXml = worksheetXml.get(sheet.name) ?? ''
    const headerSettings = sheetXml.match(/<(?:[\w.-]+:)?headerFooter\b[^>]*>/)?.[0] ?? ''
    const scaleHeaderFooter = !['0', 'false'].includes(xmlAttribute(headerSettings, 'scaleWithDoc') ?? '')
    const alignHeaderFooter = !['0', 'false'].includes(xmlAttribute(headerSettings, 'alignWithMargins') ?? '')
    const colBreaks: number[] = []
    const columnBreaksXml = sheetXml.match(/<(?:[\w.-]+:)?colBreaks\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?colBreaks\s*>/)?.[1]
    for (const columnBreak of columnBreaksXml?.match(/<(?:[\w.-]+:)?brk\b[^>]*>/g) ?? []) {
      if (!['1', 'true'].includes(xmlAttribute(columnBreak, 'man') ?? '')) continue
      const id = Number(xmlAttribute(columnBreak, 'id'))
      if (Number.isInteger(id) && id > 0) colBreaks.push(id)
    }
    if (sheet.pageSetup.printTitlesRow || sheet.pageSetup.printTitlesColumn) unsupported('repeated print titles')
    const ranges = sheet.pageSetup.printArea ? sheet.pageSetup.printArea.split('&&') : []
    const rowSize = (index: number) => (sheet.getRow(index).hidden ? 0 : sheet.getRow(index).height || sheet.properties.defaultRowHeight || 15)
    const colSize = (index: number) => (sheet.getColumn(index).hidden ? 0 : ((sheet.getColumn(index).width || sheet.properties.defaultColWidth || 8.43) * 7 + 5) * 0.75)
    const imageData: ImageData[] = []
    for (const image of sheet.getImages()) {
      if (imageData.length >= 50) throw new Error('Excel exceeds 50 images per worksheet')
      const media = workbook.getImage(Number(image.imageId))
      if (!media.buffer) unsupported('image without embedded data')
      const png = await sharp(Buffer.from(media.buffer), { limitInputPixels: 60_000_000 }).png().toBuffer()
      const range = image.range as unknown as { tl: ExcelJS.Anchor; br?: ExcelJS.Anchor; ext?: { width: number; height: number } }
      const coordinate = (anchor: ExcelJS.Anchor, axis: 'row' | 'col') => {
        const index = axis === 'row' ? anchor.nativeRow : anchor.nativeCol
        const offset = axis === 'row' ? anchor.nativeRowOff : anchor.nativeColOff
        const size = axis === 'row' ? rowSize : colSize
        return Array.from({ length: index }, (_, n) => size(n + 1)).reduce((a, b) => a + b, 0) + offset / 12700
      }
      const x = coordinate(range.tl, 'col'),
        y = coordinate(range.tl, 'row')
      const width = range.br ? coordinate(range.br, 'col') - x : (range.ext?.width ?? 0) * 0.75
      const height = range.br ? coordinate(range.br, 'row') - y : (range.ext?.height ?? 0) * 0.75
      if (width <= 0 || height <= 0) unsupported('image position')
      imageData.push({ x, y, width, height, uri: `data:image/png;base64,${png.toString('base64')}` })
    }

    if (!ranges.length) {
      const area = XLSX.utils.decode_range(source?.['!ref'] ?? 'A1:A1')
      const lastIndex = (coordinate: number, size: (index: number) => number, limit: number): number => {
        let used = 0
        for (let index = 1; index <= limit; index++) {
          used += size(index)
          if (used >= coordinate) return index - 1
        }
        throw new Error('Excel image exceeds the supported print area')
      }
      for (const image of imageData) {
        area.s = { r: 0, c: 0 }
        area.e.c = Math.max(area.e.c, lastIndex(image.x + image.width, colSize, 200))
        area.e.r = Math.max(area.e.r, lastIndex(image.y + image.height, rowSize, 2000))
      }
      ranges.push(XLSX.utils.encode_range(area))
    }

    for (const printArea of ranges) {
      const area = XLSX.utils.decode_range(printArea.replace(/\$/g, ''))
      if (area.e.r >= 2000 || area.e.c >= 200) throw new Error('Excel print area exceeds 2000 rows or 200 columns')
      const rows = segments(
        Array.from({ length: area.e.r - area.s.r + 1 }, (_, i) => area.s.r + i + 1),
        rowSize
      ).filter((item) => item.size > 0)
      const columns = segments(
        Array.from({ length: area.e.c - area.s.c + 1 }, (_, i) => area.s.c + i + 1),
        colSize
      ).filter((item) => item.size > 0)
      if (!rows.length || !columns.length) continue
      cellCount += rows.length * columns.length
      if (cellCount > MAX_CELLS) throw new Error('Excel exceeds 20000 printable cells')
      const sizes: Record<number, [number, number]> = { 1: [612, 792], 5: [612, 1008], 8: [842, 1191], 9: [595.28, 841.89], 11: [419.53, 595.28] }
      const paperSize = sheet.pageSetup.paperSize || 9
      if (!sizes[paperSize]) unsupported(`paper size ${paperSize}`)
      let [width, height] = sizes[paperSize]
      if (sheet.pageSetup.orientation === 'landscape') [width, height] = [height, width]
      const margins = sheet.pageSetup.margins
      const left = (margins?.left ?? 0.5) * 72
      const right = (margins?.right ?? 0.5) * 72
      const usableWidth = width - left - right
      const top = (margins?.top ?? 0.5) * 72
      const usableHeight = height - top - (margins?.bottom ?? 0.5) * 72
      const headerY = (margins?.header ?? 0.3) * 72
      const footerY = height - (margins?.footer ?? 0.3) * 72
      if (usableWidth <= 0 || usableHeight <= 0) throw new Error('Excel page margins leave no printable area')
      let scale = Math.min(4, Math.max(0.1, (sheet.pageSetup.scale || 100) / 100))
      if (sheet.pageSetup.fitToPage) {
        scale = Math.min(
          1,
          sheet.pageSetup.fitToWidth ? (usableWidth * sheet.pageSetup.fitToWidth) / total(columns) : 1,
          sheet.pageSetup.fitToHeight ? (usableHeight * sheet.pageSetup.fitToHeight) / total(rows) : 1
        )
      }
      if (scale < 0.1) unsupported('print scale below 10%')
      const [header, footer] = await Promise.all([
        renderPageText(headerFooter?.oddHeader, scaleHeaderFooter ? scale : 1, renderFont),
        renderPageText(headerFooter?.oddFooter, scaleHeaderFooter ? scale : 1, renderFont),
      ])
      const pageText = [...header, ...footer]
        .map((item, index) => {
          if (!item) return ''
          const textLeft = alignHeaderFooter ? left : 0
          const textRight = alignHeaderFooter ? width - right : width
          const x = item.align === 'L' ? textLeft : item.align === 'R' ? textRight - item.width : (textLeft + textRight - item.width) / 2
          const y = index < header.length ? headerY : footerY - item.height
          return '<image x="' + x + '" y="' + y + '" width="' + item.width + '" height="' + item.height + '" href="' + item.uri + '"/>'
        })
        .join('')
      const rowGroups = partition(
        rows,
        usableHeight / scale,
        sheet.model.rowBreaks?.map((item) => item.id)
      )
      const colGroups = partition(columns, usableWidth / scale, sheet.pageSetup.fitToPage ? undefined : colBreaks)
      const pages =
        sheet.pageSetup.pageOrder === 'overThenDown'
          ? rowGroups.flatMap((row) => colGroups.map((col) => ({ row, col })))
          : colGroups.flatMap((col) => rowGroups.map((row) => ({ row, col })))
      if (pages.length + pdf.getPageCount() > MAX_PAGES) throw new Error('Excel conversion exceeds 100 pages')
      const merges = source?.['!merges'] ?? []
      const sourceX = Array.from({ length: area.s.c }, (_, i) => colSize(i + 1)).reduce((a, b) => a + b, 0)
      const sourceY = Array.from({ length: area.s.r }, (_, i) => rowSize(i + 1)).reduce((a, b) => a + b, 0)
      const previousTypeByColumn = new Map<Segment[], PageClassification>()

      for (const { row, col } of pages) {
        const shapes: string[] = []
        const images: string[] = []
        const headingCells: string[] = []
        const drawn = new Set<string>()
        const offsetX = col[0].start,
          offsetY = row[0].start
        const bounds = (list: Segment[], start: number, end: number) => {
          const first = list.find((item) => item.index >= start),
            last = [...list].reverse().find((item) => item.index <= end)
          return first && last ? { start: first.start, size: last.start + last.size - first.start } : null
        }
        for (const r of row)
          for (const c of col) {
            const cell = sheet.getCell(r.index, c.index)
            const master = cell.isMerged ? cell.master : cell
            if (drawn.has(master.address)) continue
            drawn.add(master.address)
            const merge = merges.find((item) => item.s.r + 1 === Number(master.row) && item.s.c + 1 === Number(master.col))
            const bx = merge ? bounds(columns, merge.s.c + 1, merge.e.c + 1) : { start: c.start, size: c.size }
            const by = merge ? bounds(rows, merge.s.r + 1, merge.e.r + 1) : { start: r.start, size: r.size }
            if (!bx || !by) continue
            const x = bx.start - offsetX,
              y = by.start - offsetY,
              w = bx.size,
              h = by.size
            const fill = master.fill
            if (fill?.type === 'gradient') unsupported('gradient fills')
            if (fill?.type === 'pattern' && fill.pattern !== 'none' && fill.pattern !== 'solid') unsupported('pattern fills')
            if (fill?.type === 'pattern' && fill.pattern === 'solid')
              shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${hexColor(fill.fgColor, '#FFFFFF')}"/>`)
            const border = master.border ?? {}
            if (border.diagonal?.style) unsupported('diagonal borders')
            for (const side of ['top', 'bottom', 'left', 'right'] as const) {
              const line = border[side]
              if (!line?.style && !sheet.pageSetup.showGridLines) continue
              const x1 = side === 'right' ? x + w : x,
                y1 = side === 'bottom' ? y + h : y
              const x2 = side === 'left' || side === 'right' ? x1 : x + w,
                y2 = side === 'top' || side === 'bottom' ? y1 : y + h
              const strokeWidth = line?.style === 'thick' ? 2 : line?.style?.startsWith('medium') ? 1.2 : 0.5
              const dash = line?.style?.toLowerCase().includes('dash') || line?.style === 'dotted' ? ' stroke-dasharray="2,2"' : ''
              shapes.push(
                `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                  stroke="${hexColor(line?.color, line?.style ? '#000000' : '#DDDDDD')}" stroke-width="${strokeWidth}"${dash}/>`
              )
            }
            const cached = source?.[master.address] as XLSX.CellObject | undefined
            const cellValue = master.value
            // ExcelJS omits some cached values (including numeric zero) that SheetJS retains.
            if (cellValue && typeof cellValue === 'object' && ('formula' in cellValue || 'sharedFormula' in cellValue) && cached?.v === undefined && cellValue.result === undefined)
              unsupported('formula without a saved result')
            if (cached?.f && cached.v === undefined) unsupported('formula without a saved result')
            const value = cached?.w ?? master.text
            if (!value.trim()) continue
            if (x >= 0 && y >= 0 && y * scale + top <= height * 0.35) headingCells.push(value)
            const alignment = master.alignment ?? {}
            if (alignment.textRotation) unsupported('rotated cell text')
            const font = master.font ?? {}
            const fontSize = Math.min(72, Math.max(5, font.size || 11))
            const textWidth = Math.max(1, Math.ceil(((w - 4) * DPI) / 72))
            const horizontal = alignment.horizontal ?? (cached?.t === 'n' ? 'right' : 'left')
            const face = font.bold ? (font.italic ? renderFont.boldItalic : renderFont.bold) : (font.italic ? renderFont.italic : renderFont.regular)
            const decoration = `${font.underline ? ' underline="single"' : ''}${font.strike ? ' strikethrough="true"' : ''}`
            const markup = `<span foreground="${hexColor(font.color, '#000000')}"${decoration}>${xml(value)}</span>`
            const textKey = JSON.stringify([markup, fontSize, font.bold, font.italic, textWidth, alignment.wrapText, horizontal])
            if (!textCache.has(textKey))
              textCache.set(
                textKey,
                (async () => {
                  const { data: png, info } = await sharp({
                    text: {
                      text: markup,
                      font: `${renderFont.family} ${font.bold ? 'Bold ' : ''}${font.italic ? 'Italic ' : ''}${fontSize}`,
                      fontfile: face,
                      width: textWidth,
                      wrap: alignment.wrapText ? 'word-char' : 'none',
                      align: horizontal === 'center' ? 'centre' : horizontal === 'right' ? 'right' : 'left',
                      dpi: DPI,
                      rgba: true,
                    },
                  })
                    .png()
                    .toBuffer({ resolveWithObject: true })
                  return { uri: `data:image/png;base64,${png.toString('base64')}`, width: (info.width * 72) / DPI, height: (info.height * 72) / DPI }
                })()
              )
            const text = await textCache.get(textKey)!
            const textX = horizontal === 'center' ? x + (w - text.width) / 2 : horizontal === 'right' ? x + w - text.width - 2 : x + 2
            const textY = alignment.vertical === 'top' ? y + 1 : alignment.vertical === 'middle' ? y + (h - text.height) / 2 : y + h - text.height - 1
            const clip = `cell${drawn.size}`
            shapes.push(
              `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>
                <image x="${textX}" y="${textY}" width="${text.width}" height="${text.height}" href="${text.uri}" clip-path="url(#${clip})"/>`
            )
          }
        for (const image of imageData)
          images.push(`<image x="${image.x - sourceX - offsetX}" y="${image.y - sourceY - offsetY}" width="${image.width}" height="${image.height}" href="${image.uri}"/>`)
        const drawWidth = total(col) * scale,
          drawHeight = total(row) * scale
        const px = left + (sheet.pageSetup.horizontalCentered ? (usableWidth - drawWidth) / 2 : 0)
        const py = top + (sheet.pageSetup.verticalCentered ? (usableHeight - drawHeight) / 2 : 0)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg"
          width="${(width * DPI) / 72}" height="${(height * DPI) / 72}" viewBox="0 0 ${width} ${height}">
          <rect width="100%" height="100%" fill="white"/>
          <defs><clipPath id="page">
            <rect x="${px}" y="${py}" width="${Math.min(usableWidth, drawWidth)}" height="${Math.min(usableHeight, drawHeight)}"/>
          </clipPath></defs><g clip-path="url(#page)">
            <g transform="translate(${px} ${py}) scale(${scale})">${shapes.join('')}${images.join('')}</g>
          </g>${pageText}</svg>`
        let render = sharp(Buffer.from(svg), { limitInputPixels: 60_000_000 })
        if (sheet.pageSetup.blackAndWhite) render = render.grayscale()
        const image = await pdf.embedPng(await render.png().toBuffer())
        const page = pdf.addPage([width, height])
        page.drawImage(image, { x: 0, y: 0, width, height })
        // With no new heading, retain the preceding page's type in this print column.
        const classification = classifyDocumentHeadings(headingCells, previousTypeByColumn.get(col))
        previousTypeByColumn.set(col, classification)
        pageClassifications.push(classification)
      }
    }
  }
  if (!pdf.getPageCount()) throw new Error('Excel workbook has no visible printable worksheets')
  return { pdfBytes: Buffer.from(await pdf.save()), pageClassifications }
}

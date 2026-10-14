import { existsSync } from 'node:fs'
import path from 'node:path'

import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import * as XLSX from 'xlsx'

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

const partition = (items: Segment[], capacity: number, breaks = new Set<number>()): Segment[][] => {
  const result: Segment[][] = []
  let group: Segment[] = []
  let used = 0
  for (const item of items) {
    if (item.size > capacity + 0.01) unsupported('row/column larger than a printed page')
    if (group.length && (used + item.size > capacity + 0.01 || breaks.has(item.index - 1))) {
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

const validateArchive = (book: XLSX.WorkBook): void => {
  const files = (book as XLSX.WorkBook & { files?: Record<string, { content?: Uint8Array; data?: string | Uint8Array; asNodeBuffer?: () => Buffer }> }).files
  for (const [fileName, file] of Object.entries(files ?? {})) {
    const name = fileName.replace(/^\/+/, '')
    const text = () => (file.asNodeBuffer ? file.asNodeBuffer() : Buffer.from(file.content ?? file.data ?? '')).toString('utf8')
    if (/^xl\/(charts|embeddings)\//i.test(name)) unsupported('charts or embedded objects')
    if (/^xl\/drawings\/drawing.*\.xml$/i.test(name)) {
      if (/<(?:\w+:)?(?:sp|cxnSp|graphicFrame|grpSp)\b/.test(text())) unsupported('shapes or text boxes')
    }
    if (/^xl\/worksheets\/sheet.*\.xml$/i.test(name)) {
      if (/<(?:\w+:)?conditionalFormatting\b/.test(text())) unsupported('conditional formatting')
    }
  }
}

const fontPath = (bold: boolean): string => {
  const font = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', bold ? 'tahomabd.ttf' : 'tahoma.ttf')
  if (!existsSync(font)) throw new Error('Excel conversion is unavailable: the existing Windows Tahoma font is missing')
  return font
}

export const convertExcelToPdf = async (fileName: string, bytes: Buffer): Promise<Buffer> => {
  // Read cached display values. No workbook macros, external links or formulas execute.
  const data = XLSX.read(bytes, { type: 'buffer', cellStyles: true, cellNF: true, cellText: true, bookFiles: true })
  validateArchive(data)
  const workbook = path.extname(fileName).toLowerCase() === '.xlsx' ? new ExcelJS.Workbook() : legacyWorkbook(data)
  if (path.extname(fileName).toLowerCase() === '.xlsx') await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  if (workbook.worksheets.length > 30) throw new Error('Excel exceeds 30 worksheets')
  const pdf = await PDFDocument.create()
  const textCache = new Map<string, Promise<TextData>>()
  let cellCount = 0

  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue
    const source = data.Sheets[sheet.name]
    if (!sheet.actualRowCount && !sheet.getImages().length) continue
    if (Object.values(sheet.headerFooter ?? {}).some((value) => typeof value === 'string' && value.length)) unsupported('headers or footers')
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
      const left = (margins?.left ?? 0.5) * 72,
        top = (margins?.top ?? 0.5) * 72
      const usableWidth = width - left - (margins?.right ?? 0.5) * 72
      const usableHeight = height - top - (margins?.bottom ?? 0.5) * 72
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
      const rowGroups = partition(rows, usableHeight / scale, new Set(sheet.model.rowBreaks?.map((item) => item.id)))
      const colGroups = partition(columns, usableWidth / scale)
      const pages =
        sheet.pageSetup.pageOrder === 'overThenDown'
          ? rowGroups.flatMap((row) => colGroups.map((col) => ({ row, col })))
          : colGroups.flatMap((col) => rowGroups.map((row) => ({ row, col })))
      if (pages.length + pdf.getPageCount() > MAX_PAGES) throw new Error('Excel conversion exceeds 100 pages')
      const merges = source?.['!merges'] ?? []
      const sourceX = Array.from({ length: area.s.c }, (_, i) => colSize(i + 1)).reduce((a, b) => a + b, 0)
      const sourceY = Array.from({ length: area.s.r }, (_, i) => rowSize(i + 1)).reduce((a, b) => a + b, 0)

      for (const { row, col } of pages) {
        const shapes: string[] = []
        const images: string[] = []
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
            if (cellValue && typeof cellValue === 'object' && ('formula' in cellValue || 'sharedFormula' in cellValue) && cellValue.result === undefined)
              unsupported('formula without a saved result')
            if (cached?.f && cached.v === undefined) unsupported('formula without a saved result')
            const value = cached?.w ?? master.text
            if (!value) continue
            const alignment = master.alignment ?? {}
            if (alignment.textRotation) unsupported('rotated cell text')
            const font = master.font ?? {}
            const fontSize = Math.min(72, Math.max(5, font.size || 11))
            const textWidth = Math.max(1, Math.ceil(((w - 4) * DPI) / 72))
            const horizontal = alignment.horizontal ?? (cached?.t === 'n' ? 'right' : 'left')
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
                      font: `Tahoma ${font.bold ? 'Bold ' : ''}${font.italic ? 'Italic ' : ''}${fontSize}`,
                      fontfile: fontPath(!!font.bold),
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
          </g></svg>`
        let render = sharp(Buffer.from(svg), { limitInputPixels: 60_000_000 })
        if (sheet.pageSetup.blackAndWhite) render = render.grayscale()
        const image = await pdf.embedPng(await render.png().toBuffer())
        const page = pdf.addPage([width, height])
        page.drawImage(image, { x: 0, y: 0, width, height })
      }
    }
  }
  if (!pdf.getPageCount()) throw new Error('Excel workbook has no visible printable worksheets')
  return Buffer.from(await pdf.save())
}

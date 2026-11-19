import type { PDFPageProxy } from 'pdfjs-dist'
import { getPdfJs, loadPdfJs } from './PdfJs'

// Some customs PDF fonts duplicate marks or drop the ท while retaining the marks in ที่.
const label = new RegExp(
  Array.from('ใบตราสงเลข').join('[\\p{M}\\s]*') + '(?:[\\p{M}\\s]*ท\\p{M}*|\\s*[ี่]+)',
  'u',
)
const value = /^[\s:：=]*[A-Za-z\p{N}\s./-]{0,80}\(([^()\r\n]{1,1000})\)/u

interface TextBlock {
  x: number
  right: number
  text: string
}

interface TextLine {
  y: number
  blocks: TextBlock[]
}

const normalize = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[\u001C-\u001F]/g, ' ') // Certain PDF fonts emit field separators in place of spaces.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')

const parenthesizedValue = (text: string): string | null => value.exec(text)?.[1].trim() || null

const joinNearbyBlocks = (items: TextBlock[]): TextBlock[] => {
  const blocks: TextBlock[] = []
  for (const item of items.sort((a, b) => a.x - b.x)) {
    const previous = blocks.at(-1)
    if (previous && item.x - previous.right <= 10) {
      previous.text += (item.x - previous.right > 1 ? ' ' : '') + item.text
      previous.right = Math.max(previous.right, item.right)
    } else {
      blocks.push({ ...item })
    }
  }
  return blocks
}

const hawbFromLines = (lines: TextLine[]): string | null => {
  for (const [index, line] of lines.entries()) {
    for (const [blockIndex, block] of line.blocks.entries()) {
      const match = label.exec(block.text)
      if (!match) continue
      const tail = block.text.slice(match.index + match[0].length)
      const inline = parenthesizedValue(tail)
      if (inline) return inline

      const adjacent = line.blocks[blockIndex + 1]
      if (adjacent && adjacent.x - block.right <= 24) {
        const beside = parenthesizedValue(`${tail} ${adjacent.text}`)
        if (beside) return beside
      }

      // Labels in neighboring columns can sit on different baselines.
      const right = Math.min(adjacent?.x ?? Infinity, block.right + 24)
      for (let next = index + 1; next < lines.length && lines[next].y - line.y <= 24; next++) {
        const below = lines[next].blocks.find(item => item.x >= block.x - 4 && item.x < right)
        if (!below) continue
        const found = parenthesizedValue(`${tail} ${below.text}`)
        if (found) return found
        break
      }
    }
  }
  return null
}

interface VerticalRule {
  x: number
  top: number
  bottom: number
}

// PDF.js encodes painted paths as coordinate arrays in getOperatorList().
const pathCoordinates = [2, 2, 6, 4, 0] // moveTo, lineTo, curveTo, quadraticCurveTo, closePath

const verticalRules = async (page: PDFPageProxy): Promise<VerticalRule[]> => {
  const { OPS, Util } = await getPdfJs()
  const viewport = page.getViewport({ scale: 1 })
  const { fnArray, argsArray } = await page.getOperatorList()
  let matrix = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  const rules: VerticalRule[] = []
  for (const [index, operator] of fnArray.entries()) {
    const args = argsArray[index]
    if (operator === OPS.save || operator === OPS.paintFormXObjectBegin) stack.push(matrix)
    if (operator === OPS.restore || operator === OPS.paintFormXObjectEnd) matrix = stack.pop() ?? matrix
    if (operator === OPS.transform) matrix = Util.transform(matrix, args)
    if (operator === OPS.paintFormXObjectBegin && args[0]) matrix = Util.transform(matrix, args[0])
    if (operator !== OPS.constructPath) continue
    const [paint, [path]] = args as [number, [Float32Array | undefined]]
    if (!path || ![OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.fill, OPS.eoFill].includes(paint)) continue
    let previous: number[] | undefined
    let start: number[] | undefined
    for (let offset = 0; offset < path.length;) {
      const command = path[offset++]
      const count = pathCoordinates[command]
      if (count === undefined) break
      const point = count ? [path[offset + count - 2], path[offset + count - 1]] : start
      if (count && point) {
        Util.applyTransform(point, matrix)
        const [x, y] = viewport.convertToViewportPoint(point[0], point[1])
        point[0] = x / page.userUnit
        point[1] = y / page.userUnit
      }
      if (command === 0) start = point
      if ((command === 1 || command === 4) && previous && point && Math.abs(previous[0] - point[0]) <= 0.5) {
        const top = Math.min(previous[1], point[1])
        const bottom = Math.max(previous[1], point[1])
        if (bottom - top >= 5) rules.push({ x: point[0], top, bottom })
      }
      previous = point
      offset += count
    }
  }
  return rules
}

const hawbFromSplitField = async (page: PDFPageProxy, lines: TextLine[]): Promise<string | null> => {
  let rules: VerticalRule[] | undefined
  for (const [index, line] of lines.entries()) {
    for (const heading of line.blocks.filter(block => label.test(block.text))) {
      for (let next = index + 1; next < lines.length && lines[next].y - line.y <= 24; next++) {
        const row = lines[next]
        const bill = row.blocks.find(block => Math.abs(block.x - heading.x) <= 6 && /^\d[\d-]{5,}$/.test(block.text.trim()))
        if (!bill) continue
        const candidates = row.blocks.filter(block =>
          block.x > bill.right && /^(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{5,}$/.test(block.text.trim())
        )
        if (!candidates.length) break
        rules ??= await verticalRules(page)
        const borders = rules.filter(rule => rule.top <= line.y + 2 && rule.bottom >= row.y - 2)
        const left = Math.max(-Infinity, ...borders.filter(rule => rule.x <= Math.min(heading.x, bill.x)).map(rule => rule.x))
        const right = Math.min(Infinity, ...borders.filter(rule => rule.x >= Math.max(heading.x, bill.x)).map(rule => rule.x))
        if (Number.isFinite(left) && Number.isFinite(right) && bill.right < right) {
          const inCell = candidates.filter(block => block.right <= right)
          if (inCell.length === 1) return inCell[0].text.trim()
        }
        break
      }
    }
  }
  return null
}

export const detectHawb = async (bytes: Buffer, pageNumber: number): Promise<string | null> => {
  let task: Awaited<ReturnType<typeof loadPdfJs>> | undefined
  try {
    task = await loadPdfJs(bytes)
    const page = await (await task.promise).getPage(pageNumber)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })
    const lines: TextLine[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [screenX, screenY] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      const x = screenX / page.userUnit
      const y = screenY / page.userUnit
      let line = lines.find((entry) => Math.abs(entry.y - y) < 3)
      if (!line) {
        line = { y, blocks: [] }
        lines.push(line)
      }
      line.blocks.push({ x, right: x + item.width, text: normalize(item.str) })
    }
    const sortedLines = lines.sort((a, b) => a.y - b.y).map(line => ({ ...line, blocks: joinNearbyBlocks(line.blocks) }))
    return hawbFromLines(sortedLines) ?? await hawbFromSplitField(page, sortedLines)
  } catch {
    return null
  } finally {
    await task?.destroy().catch(() => undefined)
  }
}

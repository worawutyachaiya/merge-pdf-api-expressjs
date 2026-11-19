import { loadPdfJs } from './PdfJs'

// Some customs PDF fonts duplicate or drop combining marks in this label.
const label = new RegExp(Array.from('ใบตราสงเลขท').join('[\\p{M}\\s]*') + '\\p{M}*', 'u')
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
    return hawbFromLines(lines.sort((a, b) => a.y - b.y).map((line) => ({ ...line, blocks: joinNearbyBlocks(line.blocks) })))
  } catch {
    return null
  } finally {
    await task?.destroy().catch(() => undefined)
  }
}

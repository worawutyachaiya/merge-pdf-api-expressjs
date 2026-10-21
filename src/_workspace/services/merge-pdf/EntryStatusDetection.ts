import { loadPdfJs } from './PdfJs'

// Require a labelled current-status field, never a bare "04" or a reference number.
const label = '(?:(?:IMPORT |CUSTOMS )?DECLARATION STATUS|ENTRY STATUS|CUSTOMS STATUS|STATUS(?: CODE)?|สถานะ(?:ใบขน(?:สินค้า)?|เอกสาร)?)'
const statusField = new RegExp(`^${label}\\s*[:：=\\-]?\\s*(\\d{2})\\d*(?:\\s*\\([^()\\d]*\\)|\\s*[-–]\\s*[^:\\d]+)?$`, 'u')
const statusLabel = new RegExp(`^${label}\\s*[:：=\\-]?\\s*$`, 'u')
const statusPrefix = new RegExp(`^${label}(?:\\s|[:：=\\-]|$)`, 'u')
const statusValue = /^(\d{2})\d*(?:\s*\([^\d]*\))?$/u

export const hasConfirmedStatus04 = (lines: readonly string[]): boolean => {
  const normalized = lines
    .map((line) =>
      line
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)
  const statuses = new Set<string>()
  for (let index = 0; index < normalized.length; index++) {
    const line = normalized[index]
    const match = statusField.exec(line)
    if (match) statuses.add(match[1])
    else if (statusLabel.test(line)) {
      const next = statusValue.exec(normalized[index + 1] ?? '')
      if (!next) return false
      statuses.add(next[1])
    } else if (statusPrefix.test(line)) return false
  }
  return statuses.size === 1 && statuses.has('04')
}

export const detectEntryStatus04 = async (bytes: Buffer, pageNumbers: readonly number[]): Promise<boolean> => {
  if (!pageNumbers.length || pageNumbers.length > 500) return false
  let task: Awaited<ReturnType<typeof loadPdfJs>> | undefined
  try {
    task = await loadPdfJs(bytes)
    const pdf = await task.promise
    for (const number of new Set(pageNumbers)) {
      if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) return false
      const page = await pdf.getPage(number)
      try {
        const content = await page.getTextContent()
        const lines: { y: number; items: { x: number; text: string }[] }[] = []
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue
          const y = item.transform[5]
          let line = lines.find((candidate) => Math.abs(candidate.y - y) < 3)
          if (!line) {
            line = { y, items: [] }
            lines.push(line)
          }
          line.items.push({ x: item.transform[4], text: item.str })
        }
        const text = lines
          .sort((a, b) => b.y - a.y)
          .map((line) =>
            line.items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(' ')
          )
        if (!hasConfirmedStatus04(text)) return false
      } finally {
        page.cleanup()
      }
    }
    return true
  } catch {
    return false
  } finally {
    await task?.destroy().catch(() => undefined)
  }
}

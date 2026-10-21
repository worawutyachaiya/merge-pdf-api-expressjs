import type { PageClassification } from '@src/_workspace/types/merge-pdf/MergePdf'

import { loadPdfJs } from './PdfJs'

const unknown = (): PageClassification => ({ categoryId: 10, source: 'UNKNOWN', confidence: null })

// Match document headings, not references such as "Invoice No." in another form.
const headings: { categoryId: number; pattern: RegExp }[] = [
  { categoryId: 1, pattern: /^(?:IMPORT (?:ENTRY|DECLARATION)|CUSTOMS IMPORT DECLARATION|ใบขนสินค้าขาเข้า(?:$|พร้อม|และ|\s))/ },
  { categoryId: 2, pattern: /^(?:(?:(?:COMMERCIAL|TAX|PROFORMA|PRO FORMA|CUSTOMS) )?INVOICE|.*\bINVOICE\s*#)$/ },
  { categoryId: 3, pattern: /^(?:PACKING LIST|PACKING SLIP)$/ },
  { categoryId: 4, pattern: /^(?:(?:HOUSE )?AIR WAYBILL|(?:HOUSE )?AIR WAY BILL|HAWB|AWB)$/ },
  { categoryId: 5, pattern: /^(?:MASTER AIR WAY ?BILL|MAWB)$/ },
  { categoryId: 6, pattern: /^(?:TISI (?:IMPORT )?(?:PERMIT|LICENSE)|(?:IMPORT )?(?:PERMIT|LICENSE) TISI|ใบอนุญาตนำเข้าผลิตภัณฑ์อุตสาหกรรม)$/ },
  { categoryId: 6, pattern: /^หลกฐานการรบ.{0,30}ผลตภณฑอตสาหกรรม/ },
  { categoryId: 7, pattern: /^(?:CUSTOMS (?:RECEIPT|PAYMENT RECEIPT)|ใบเสร็จรับเงินกรมศุลกากร|ใบเสร็จศุลกากร)$/ },
  { categoryId: 8, pattern: /^DELIVERY ORDER$/ },
  { categoryId: 9, pattern: /^DELIVERY NOTE$/ },
]

export const classifyDocumentHeadings = (lines: readonly string[]): PageClassification => {
  const matches = new Set<number>()
  for (const line of lines) {
    const text = line
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[-\u2013\u2014_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase()
    const thaiBaseText = text.replace(/[\uE000-\uF8FF]/g, '').replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '')
    for (const heading of headings) {
      if (heading.pattern.test(text) || heading.pattern.test(thaiBaseText)) matches.add(heading.categoryId)
    }
  }
  return matches.size === 1 ? { categoryId: [...matches][0], source: 'AUTO_TEXT', confidence: 0.95 } : unknown()
}

export const classifyCombinedPdfWithText = async (
  bytes: Buffer,
  pageCount?: number
): Promise<{ pages: PageClassification[]; hasExtractableText: boolean }> => {
  const results = Array.from({ length: pageCount ?? 0 }, unknown)
  let hasExtractableText = false
  let task: Awaited<ReturnType<typeof loadPdfJs>> | undefined
  try {
    task = await loadPdfJs(bytes)
    const pdf = await task.promise
    if (pageCount !== undefined && pdf.numPages !== pageCount) return { pages: results, hasExtractableText }
    const count = pageCount ?? Math.min(pdf.numPages, 500)
    if (pageCount === undefined) results.push(...Array.from({ length: count }, unknown))
    for (let index = 0; index < count; index++) {
      const page = await pdf.getPage(index + 1)
      try {
        const viewport = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        hasExtractableText ||= content.items.some((item) => 'str' in item && item.str.trim().length > 0)
        const lines: { y: number; items: { x: number; text: string }[] }[] = []
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue
          const [a, b, c, d, e, f] = viewport.transform
          const x = a * item.transform[4] + c * item.transform[5] + e
          const y = b * item.transform[4] + d * item.transform[5] + f
          if (y < 0 || y > viewport.height * 0.35) continue
          let line = lines.find((candidate) => Math.abs(candidate.y - y) < 3)
          if (!line) {
            line = { y, items: [] }
            lines.push(line)
          }
          line.items.push({ x, text: item.str })
        }
        results[index] = classifyDocumentHeadings(
          lines.map((line) =>
            line.items
              .sort((left, right) => left.x - right.x)
              .map((item) => item.text)
              .join(' ')
          )
        )
      } catch {
        // Text extraction failure leaves this page available for manual classification.
        results[index] = unknown()
      } finally {
        page.cleanup()
      }
    }
  } catch {
    return { pages: results, hasExtractableText }
  } finally {
    await task?.destroy()
  }
  return { pages: results, hasExtractableText }
}

export const classifyCombinedPdf = async (bytes: Buffer, pageCount?: number): Promise<PageClassification[]> =>
  (await classifyCombinedPdfWithText(bytes, pageCount)).pages

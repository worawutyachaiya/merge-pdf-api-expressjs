import * as XLSX from 'xlsx'
import type { PageClassification } from '@src/_workspace/types/merge-pdf/MergePdf'
import { classifyCombinedPdfWithText, classifyDocumentHeadings } from './CombinedPdfClassification'

const other = (): PageClassification => ({ categoryId: 10, source: 'UNKNOWN', confidence: null })

export const detectDocumentFileName = (fileName: string): PageClassification => {
  const name = fileName
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[._()\[\]–—-]/g, ' ')
    .replace(/([A-Z])(\d)|(\d)([A-Z])/g, '$1$3 $2$4')
    .replace(/\s+/g, ' ')
    .trim()
  const patterns: [number, RegExp][] = [
    [1, /\b(?:IMPORT ENTRY|IMPORT DECLARATION|CUSTOMS IMPORT DECLARATION)\b|ใบขน/],
    [2, /\b(?:INVOICE|INV)\b/],
    [3, /\b(?:PACKING\s*(?:LIST|SLIP)|PL|P L)\b/],
    [4, /\b(?:HAWB|AWB|(?:HOUSE\s*)?AIR\s*WAY\s*BILL)\b/],
    [5, /\b(?:MAWB|MASTER\s*AIR\s*WAY\s*BILL)\b/],
    [6, /\bTISI\b|มอก|ใบอนุญาตนำเข้าผลิตภัณฑ์อุตสาหกรรม/],
    [7, /\b(?:CUSTOMS RECEIPT|CUSTOMS PAYMENT RECEIPT|RECEIPT)\b|ใบเสร็จ/],
    [8, /\b(?:DELIVERY ORDER|DO|D O)\b/],
    [9, /\b(?:DELIVERY NOTE|DN|D N)\b/],
  ]
  const matches = new Set(patterns.filter(([, pattern]) => pattern.test(name)).map(([id]) => id))
  if (matches.has(5) && !/\b(?:HAWB|AWB|HOUSE)\b/.test(name)) matches.delete(4)
  return matches.size === 1 ? { categoryId: [...matches][0], source: 'FILENAME', confidence: 0.95 } : other()
}

export const detectDocumentType = async (fileName: string, bytes: Buffer): Promise<PageClassification> => {
  const named = detectDocumentFileName(fileName)
  try {
    if (/\.pdf$/i.test(fileName)) {
      const classified = await classifyCombinedPdfWithText(bytes)
      const types = new Set(classified.pages.filter((page) => page.source === 'AUTO_TEXT').map((page) => page.categoryId))
      if (types.size === 1) return { categoryId: [...types][0], source: 'AUTO_TEXT', confidence: 0.95 }
      if (types.size > 1 || classified.hasExtractableText) return other()
      return named.source === 'FILENAME' ? named : other()
    }
    if (named.source === 'FILENAME') return named
    if (/\.xlsx?$/i.test(fileName)) {
      const workbook = XLSX.read(bytes, { type: 'buffer', sheetRows: 40, cellFormula: false, cellHTML: false })
      const lines = workbook.SheetNames.slice(0, 10).flatMap((name) => {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false })
        return [name, ...rows.flatMap((row) => [row.map(String).join(' '), ...(row.filter((value) => typeof value === 'string') as string[])])]
      })
      return classifyDocumentHeadings(lines)
    }
  } catch {
    // Scans, ambiguous headings and unreadable content need a manual choice, never Import entry by default.
  }
  return other()
}

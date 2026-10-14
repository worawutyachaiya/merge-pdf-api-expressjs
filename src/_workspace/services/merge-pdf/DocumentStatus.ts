import type { DocumentStatusSummary, PageSummary } from '@src/_workspace/types/merge-pdf/MergePdf'

export const summarizeDocumentPages = (pages: readonly PageSummary[]): DocumentStatusSummary => {
  const summary: DocumentStatusSummary = { DOCUMENT_PAGE_COUNTS: {}, UNCLASSIFIED_PAGE_COUNT: 0 }
  for (const page of pages) {
    if (page.CLASSIFICATION_SOURCE === 'UNKNOWN') {
      summary.UNCLASSIFIED_PAGE_COUNT += 1
    } else {
      summary.DOCUMENT_PAGE_COUNTS[page.CATEGORY_ID] = (summary.DOCUMENT_PAGE_COUNTS[page.CATEGORY_ID] ?? 0) + 1
    }
  }
  return summary
}

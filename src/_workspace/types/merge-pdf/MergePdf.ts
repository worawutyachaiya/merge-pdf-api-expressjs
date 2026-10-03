export type SourceType = 'PDF' | 'IMAGE' | 'EXCEL'
export type ClassificationSource = 'AUTO_TEXT' | 'AUTO_OCR' | 'FILENAME' | 'UNKNOWN' | 'USER'

export interface PageClassification {
  categoryId: number
  source: ClassificationSource
  confidence: number | null
}

export interface JobSummary {
  JOB_ID: number
  INUSE: number
  JOB_CODE: string
  JOB_TITLE: string
  JOB_REFERENCE: string | null
  STATUS: 'DRAFT' | 'COMPLETING' | 'COMPLETED'
  ROW_VERSION: number
  UPDATE_DATE: string
  UPDATE_BY: string
  DOCUMENT_COUNT: number
  PAGE_COUNT: number
}

export interface DocumentSummary {
  DOCUMENT_ID: number
  JOB_ID: number
  CATEGORY_ID: number
  CATEGORY_NAME: string
  ORIGINAL_FILE_NAME: string
  SOURCE_TYPE: SourceType
  PDF_PAGE_COUNT: number
  ENTRY_STATUS_CODE: string | null
  ENTRY_STATUS_SOURCE: string | null
  UPLOAD_ORDER: number
}

export interface PageSummary {
  PAGE_ID: number
  DOCUMENT_ID: number
  SOURCE_PAGE_NUMBER: number
  ROTATION_DEGREES: number
  SORT_ORDER: number
  CATEGORY_ID: number
  CLASSIFICATION_SOURCE: ClassificationSource | null
  CLASSIFICATION_CONFIDENCE: number | null
}

export interface PublicationSummary {
  PUBLICATION_ID: number
  PUBLICATION_VERSION: number
  STATUS: 'PENDING' | 'PUBLISHED' | 'FAILED'
  OUTPUT_FILE_NAME: string
  NETWORK_PATH: string | null
  PUBLISHED_AT: string | null
}

export interface JobDetail {
  job: JobSummary
  documents: DocumentSummary[]
  pages: PageSummary[]
  publications: PublicationSummary[]
}

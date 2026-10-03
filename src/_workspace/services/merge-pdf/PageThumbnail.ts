import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import sharp from 'sharp'

import { MergePdfRepository as repo } from '@src/_workspace/sql/merge-pdf/MergePdfRepository'

const execFileAsync = promisify(execFile)
const cache = new Map<number, Promise<Buffer[]>>()
const MAX_CACHED_DOCUMENTS = 5

const renderDocument = async (documentId: number, pageCount: number): Promise<Buffer[]> => {
  if (process.platform !== 'win32') throw new Error('Page thumbnails require Windows PDF rendering')
  const bytes = await repo.getDocumentPdf(documentId)
  if (!bytes) throw new Error('Source document not found')
  const tempRoot = path.resolve(os.tmpdir())
  const tempDir = await mkdtemp(path.join(tempRoot, 'merge-pdf-thumbs-'))
  try {
    const inputPath = path.join(tempDir, 'source.pdf')
    await writeFile(inputPath, bytes)
    const script = await readFile(path.join(__dirname, 'RenderPdfThumbnails.ps1'), 'utf8')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, MERGE_PDF_THUMB_INPUT: inputPath, MERGE_PDF_THUMB_OUTPUT: tempDir },
    })
    return Promise.all(Array.from({ length: pageCount }, (_, index) => readFile(path.join(tempDir, `page-${index + 1}.png`))))
  } finally {
    if (path.dirname(path.resolve(tempDir)) !== tempRoot || !path.basename(tempDir).startsWith('merge-pdf-thumbs-')) {
      throw new Error('Unsafe thumbnail temporary directory')
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

const cachedDocument = (documentId: number, pageCount: number): Promise<Buffer[]> => {
  const existing = cache.get(documentId)
  if (existing) return existing
  const pending = renderDocument(documentId, pageCount).catch((error) => {
    cache.delete(documentId)
    throw error
  })
  cache.set(documentId, pending)
  if (cache.size > MAX_CACHED_DOCUMENTS) cache.delete(cache.keys().next().value!)
  return pending
}

export const getPageThumbnail = async (jobId: number, pageId: number): Promise<Buffer | undefined> => {
  const page = await repo.getPageThumbnailSource(jobId, pageId)
  if (!page) return undefined
  const images = await cachedDocument(page.DOCUMENT_ID, page.PDF_PAGE_COUNT)
  const image = images[page.SOURCE_PAGE_NUMBER - 1]
  if (!image) throw new Error('Thumbnail page missing')
  return sharp(image).rotate(page.ROTATION_DEGREES).png().toBuffer()
}

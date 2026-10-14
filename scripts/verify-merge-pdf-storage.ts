import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { PDFDocument } from 'pdf-lib'
import type { PoolConnection } from 'mysql2/promise'

import { MySQLExecute } from '../src/businessData/dbExecute'
import { MergePdfRepository as repo } from '../src/_workspace/sql/merge-pdf/MergePdfRepository'
import { MergePdfError, MergePdfService } from '../src/_workspace/services/merge-pdf/MergePdfService'
import { checkOutputDirectory, getOutputDirectory } from '../src/_workspace/services/merge-pdf/PublicationStorage'
import type { JobSummary, PublicationSummary } from '../src/_workspace/types/merge-pdf/MergePdf'

async function verify() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'merge-pdf-storage-'))
  const originalDirectory = process.env.MERGE_PDF_OUTPUT_DIR
  const originalShare = process.env.MERGE_PDF_DEVELOPMENT_SHARE
  const originalRepo = { ...repo }
  const originalTransaction = MySQLExecute.withTransaction
  const originalConsoleError = console.error
  const job: JobSummary = {
    JOB_ID: 1,
    INUSE: 1,
    JOB_CODE: 'storage-verification',
    JOB_TITLE: 'Storage verification',
    JOB_REFERENCE: null,
    STATUS: 'DRAFT',
    ROW_VERSION: 1,
    UPDATE_DATE: new Date().toISOString(),
    UPDATE_BY: 'TEST',
    DOCUMENT_COUNT: 3,
    PAGE_COUNT: 3,
  }
  const publications: PublicationSummary[] = []
  let pending: { PUBLICATION_ID: number; OUTPUT_FILE_NAME: string; OUTPUT_PDF_BYTES: Buffer } | undefined
  try {
    delete process.env.MERGE_PDF_OUTPUT_DIR
    process.env.MERGE_PDF_DEVELOPMENT_SHARE = directory
    assert.equal(getOutputDirectory(), directory)
    process.env.MERGE_PDF_OUTPUT_DIR = path.join(directory, 'missing')
    assert.equal(getOutputDirectory(), path.join(directory, 'missing'))
    const source = await PDFDocument.create()
    source.addPage([300, 400]).drawText('Storage verification')
    const pdf = Buffer.from(await source.save())
    Object.assign(repo, {
      getJob: async () => ({ ...job }),
      lockJob: async () => ({ ...job }),
      getDocuments: async () => [1, 2, 4].map((id) => ({ DOCUMENT_ID: id, ENTRY_STATUS_CODE: '04' })),
      getPages: async () => [1, 2, 4].map((id) => ({ DOCUMENT_ID: id, CATEGORY_ID: id, SOURCE_PAGE_NUMBER: 1, ROTATION_DEGREES: 0 })),
      getRequiredCategoryIds: async () => [1, 2, 4],
      getAllPdfBytes: async () => [1, 2, 4].map((id) => ({ DOCUMENT_ID: id, NORMALIZED_PDF_BYTES: pdf })),
      nextPublicationVersion: async () => publications.length + 1,
      insertPublication: async (_conn: PoolConnection, _jobId: number, version: number, fileName: string, bytes: Buffer) => {
        publications.push({
          PUBLICATION_ID: version,
          PUBLICATION_VERSION: version,
          STATUS: 'PENDING',
          OUTPUT_FILE_NAME: fileName,
          NETWORK_PATH: null,
          PUBLISHED_AT: null,
        })
        pending = { PUBLICATION_ID: version, OUTPUT_FILE_NAME: fileName, OUTPUT_PDF_BYTES: bytes }
        job.STATUS = 'COMPLETING'
        return version
      },
      finishPublication: async (_conn: PoolConnection, _jobId: number, publicationId: number, outputPath: string | null) => {
        const publication = publications[publicationId - 1]
        publication.STATUS = outputPath ? 'PUBLISHED' : 'FAILED'
        publication.NETWORK_PATH = outputPath
        job.STATUS = outputPath ? 'COMPLETED' : 'DRAFT'
        job.ROW_VERSION += 1
      },
      getPublications: async () => publications,
      getPendingPublication: async () => pending,
    })
    MySQLExecute.withTransaction = async (work) => work({} as PoolConnection)
    console.error = () => undefined // Expected storage errors are asserted below.
    const rejectsWithStorageError = (error: unknown) => error instanceof MergePdfError && error.statusCode === 503
    await assert.rejects(MergePdfService.complete(1, 1), rejectsWithStorageError)
    assert.equal(publications.length, 0)
    assert.equal(job.ROW_VERSION, 1)
    assert.equal(job.STATUS, 'DRAFT')
    console.log('PASS: missing output folder does not create a publication or change the job version')

    process.env.MERGE_PDF_OUTPUT_DIR = directory
    await checkOutputDirectory()
    assert.deepEqual(await readdir(directory), [])
    await MergePdfService.complete(1, 1)
    assert.equal(job.STATUS, 'COMPLETED')
    assert.equal(publications[0].STATUS, 'PUBLISHED')
    assert.equal((await PDFDocument.load(await readFile(publications[0].NETWORK_PATH!))).getPageCount(), 3)
    console.log('PASS: Save & Complete merges three required categories and publishes a readable PDF')

    // Simulate a filesystem failure after the access probe has already succeeded.
    const collision = path.join(directory, 'storage-verification-v2.pdf')
    await mkdir(collision)
    await assert.rejects(MergePdfService.complete(1, 2), rejectsWithStorageError)
    assert.equal(publications[1].STATUS, 'FAILED')
    assert.equal(job.STATUS, 'DRAFT')
    assert.equal(job.ROW_VERSION, 3)
    assert.ok((await readdir(directory)).every((name) => !name.endsWith('.tmp') && !name.endsWith('.verified')))
    await rmdir(collision)
    await assert.rejects(MergePdfService.complete(1, 2), (error) => error instanceof MergePdfError && error.statusCode === 409)
    await MergePdfService.complete(1, 3)
    assert.equal(publications[2].STATUS, 'PUBLISHED')
    assert.equal(job.STATUS, 'COMPLETED')
    console.log('PASS: publication failure cleans temporary files; retry with refreshed version succeeds')

    job.STATUS = 'COMPLETING'
    await MergePdfService.complete(1, job.ROW_VERSION)
    assert.equal(publications.length, 3)
    assert.equal(job.STATUS, 'COMPLETED')
    console.log('PASS: a pending publication resumes without creating another publication')
  } finally {
    Object.assign(repo, originalRepo)
    MySQLExecute.withTransaction = originalTransaction
    console.error = originalConsoleError
    if (originalDirectory === undefined) delete process.env.MERGE_PDF_OUTPUT_DIR
    else process.env.MERGE_PDF_OUTPUT_DIR = originalDirectory
    if (originalShare === undefined) delete process.env.MERGE_PDF_DEVELOPMENT_SHARE
    else process.env.MERGE_PDF_DEVELOPMENT_SHARE = originalShare
    // Only remove the directory created by mkdtemp for this verification.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('merge-pdf-storage-'))
    await rm(directory, { recursive: true, force: true })
  }
}

verify().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

import express from 'express'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

import router from '../src/_workspace/routes/merge-pdf/MergePdfRoutes'
import { MergePdfService } from '../src/_workspace/services/merge-pdf/MergePdfService'
import { MergePdfRepository } from '../src/_workspace/sql/merge-pdf/MergePdfRepository'
import type { JobDetail } from '../src/_workspace/types/merge-pdf/MergePdf'

async function verify() {
  assert.equal(process.env.NODE_ENV, 'development')
  const document = await PDFDocument.create()
  document.addPage([300, 400]).drawText('POST preview verification')
  const pdf = Buffer.from(await document.save())
  const fixture: JobDetail = {
    job: {
      JOB_ID: 1,
      INUSE: 1,
      JOB_CODE: 'verification',
      JOB_TITLE: 'POST test',
      JOB_REFERENCE: null,
      STATUS: 'DRAFT',
      ROW_VERSION: 1,
      UPDATE_DATE: new Date().toISOString(),
      UPDATE_BY: 'DEV_LOCAL',
      DOCUMENT_COUNT: 1,
      PAGE_COUNT: 1,
    },
    documents: [],
    pages: [],
    publications: [],
  }
  const originalService = { ...MergePdfService }
  const originalRepository = { ...MergePdfRepository }
  // Only request parsing and routing are under test. No real job or database is used.
  Object.assign(MergePdfService, {
    list: async (...args: unknown[]) => {
      assert.equal(args[0], 'POST test')
      assert.equal(args[3], 10)
      assert.equal(args[7], false)
      return { rows: [fixture.job], total: 1 }
    },
    create: async (title: string) => {
      assert.equal(title, fixture.job.JOB_TITLE)
      return fixture
    },
    deleteDraft: async (jobId: number, version: number) => {
      assert.equal(jobId, 1)
      assert.equal(version, 1)
      return { JOB_ID: 1 }
    },
    ...Object.fromEntries(
      [
        'detail',
        'saveDraft',
        'addDocument',
        'addCombinedDocument',
        'updatePageCategory',
        'rotatePage',
        'removePage',
        'removeDocument',
        'updateEntryStatus',
        'reorder',
        'complete',
      ].map((name) => [
        name,
        async (jobId: number) => {
          assert.equal(jobId, 1)
          return fixture
        },
      ])
    ),
    documentPdf: async () => pdf,
    pagePdf: async () => pdf,
    publicationPdf: async () => ({ bytes: pdf, fileName: 'verification.pdf' }),
  })
  Object.assign(MergePdfRepository, {
    getPageThumbnailSource: async () => ({ DOCUMENT_ID: 1, SOURCE_PAGE_NUMBER: 1, ROTATION_DEGREES: 0, PDF_PAGE_COUNT: 1 }),
    getDocumentPdf: async () => pdf,
  })

  const app = express()
  app.use(express.json())
  app.use('/api/merge-pdf', router)
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merge-pdf`
    const post = (path: string, data: unknown = {}) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    const actions: [string, unknown][] = [
      ['/jobs/search', { search: 'POST test', page: 1, pageSize: 10, sortDesc: false }],
      ['/jobs/create', { title: 'POST test', reference: null }],
      ['/jobs/1/detail', {}],
      ['/jobs/1/save-draft', { title: 'POST test', reference: null, rowVersion: 1 }],
      ['/jobs/1/delete-draft', { rowVersion: 1 }],
      ['/jobs/1/pages/1/category', { rowVersion: 1, categoryId: 2 }],
      ['/jobs/1/pages/1/rotation', { rowVersion: 1, delta: 90 }],
      ['/jobs/1/pages/1/remove', { rowVersion: 1 }],
      ['/jobs/1/documents/1/remove', { rowVersion: 1 }],
      ['/jobs/1/documents/1/status', { rowVersion: 1, statusCode: '04' }],
      ['/jobs/1/pages/reorder', { rowVersion: 1, pageIds: [1] }],
      ['/jobs/1/complete', { rowVersion: 1 }],
    ]
    for (const [path, data] of actions) {
      const response = await post(path, data)
      assert.ok(response.ok, `${path}: ${response.status}`)
      assert.equal((await response.json()).Status, true)
    }
    assert.equal((await post('/jobs/search', { sortDesc: 'false' })).status, 400)
    assert.equal((await post('/jobs/1/delete-draft', { rowVersion: 0 })).status, 400)
    for (const path of ['/jobs/1/documents', '/jobs/1/combined-documents']) {
      const form = new FormData()
      form.append('rowVersion', '1')
      form.append('categoryId', '2')
      form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'verification.pdf')
      const response = await fetch(`${base}${path}`, { method: 'POST', body: form })
      assert.equal(response.status, 201)
      assert.equal((await response.json()).Status, true)
    }
    const binaryPaths = ['/documents/1/preview', '/jobs/1/pages/1/preview', '/jobs/1/publications/1/pdf', '/jobs/1/pages/1/thumbnail']
    for (const path of binaryPaths) {
      const response = await post(path)
      assert.equal(response.status, 200, path)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (path.endsWith('/thumbnail')) {
        assert.match(response.headers.get('content-type') ?? '', /image\/png/)
        const metadata = await sharp(bytes).metadata()
        assert.ok(metadata.width && metadata.height)
      } else {
        assert.match(response.headers.get('content-type') ?? '', /application\/pdf/)
        assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1)
      }
    }
    for (const path of [...actions.map(([path]) => path), ...binaryPaths, '/jobs/1/documents', '/jobs/1/combined-documents']) {
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${base}${path}`, { method })
        assert.equal(response.status, 404, `${method} ${path} must not route`)
        await response.arrayBuffer()
      }
    }
    console.log('PASS: all 18 API operations use POST; JSON filters, multipart uploads, one-page PDFs and PNG thumbnails work')
    console.log('PASS: invalid bodies are rejected; GET/PUT/PATCH/DELETE cannot invoke these routes; no database records changed')
  } finally {
    Object.assign(MergePdfService, originalService)
    Object.assign(MergePdfRepository, originalRepository)
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

verify().catch((error) => {
  console.error('POST API verification failed:', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})

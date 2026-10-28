const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const Module = require('node:module')
const ts = require('typescript')
const { PDFDocument } = require('pdf-lib')

// Run the real editor, PDF and filesystem code with a transactional repository
// double. No shared database, network share or mail service is accessed.
async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-pdf-save-test-'))
  const previousDirectory = process.env.MERGE_PDF_OUTPUT_DIR
  process.env.MERGE_PDF_OUTPUT_DIR = directory
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800]).drawText('Save test', { x: 100, y: 400 })
  const bytes = Buffer.from(await pdf.save())
  let state = {
    job: { JOB_ID: 1, JOB_CODE: 'I26-0101', JOB_TITLE: 'I26-0101', STATUS: 'DRAFT', ROW_VERSION: 1, LAST_COMPLETED_AT: null },
    documents: [1, 2, 4, 10].map(id => ({ DOCUMENT_ID: id, CATEGORY_ID: id, PDF_PAGE_COUNT: 1,
      SOURCE_TYPE: 'PDF', DESCRIPTION: id === 10 ? 'Other document' : null,
      ENTRY_STATUS_CODE: id === 1 ? '04' : null, ENTRY_STATUS_SOURCE: id === 1 ? 'USER' : null })),
    pages: [1, 2, 4, 10].map((id, index) => ({ PAGE_ID: id, DOCUMENT_ID: id, SOURCE_PAGE_NUMBER: 1,
      CATEGORY_ID: id, ROTATION_DEGREES: 0, DESKEW_DEGREES: 0, SORT_ORDER: index + 1,
      CLASSIFICATION_SOURCE: 'USER', CLASSIFICATION_CONFIDENCE: null, DESCRIPTION: id === 10 ? 'Other document' : null })),
    publications: [],
    queue: [],
  }
  let failQueue = false
  const snapshot = () => structuredClone(state)
  const repo = {
    getJob: async () => ({ ...state.job }),
    lockJob: async () => ({ ...state.job }),
    getDocuments: async () => state.documents.map(row => ({ ...row })),
    getPages: async () => state.pages.map(row => ({ ...row })),
    getPublications: async () => state.publications.map(row => ({ ...row })),
    updatePageDetails: async (_conn, _jobId, id, changes) => Object.assign(state.pages.find(row => row.PAGE_ID === id), changes),
    softDeletePage: async (_conn, _jobId, id) => { state.pages = state.pages.filter(row => row.PAGE_ID !== id) },
    softDeleteDocument: async (_conn, _jobId, id) => { state.documents = state.documents.filter(row => row.DOCUMENT_ID !== id) },
    countActiveDocumentPages: async (_conn, id) => state.pages.filter(row => row.DOCUMENT_ID === id).length,
    updateDocumentMetadata: async (_conn, _jobId, id, changes) => Object.assign(state.documents.find(row => row.DOCUMENT_ID === id), changes),
    reorderPages: async (_conn, _jobId, ids) => { state.pages = ids.map((id, index) => ({ ...state.pages.find(row => row.PAGE_ID === id), SORT_ORDER: index + 1 })) },
    bumpJob: async () => { state.job.ROW_VERSION++ },
    getRequiredCategoryIds: async () => [1, 2, 4],
    getAllPdfBytes: async () => state.documents.map(row => ({ DOCUMENT_ID: row.DOCUMENT_ID, NORMALIZED_PDF_BYTES: bytes })),
    getLatestPublished: async () => state.publications.find(row => row.STATUS === 'PUBLISHED'),
    allocateNextPublicationVersion: async () => state.publications.length + 1,
    insertPublication: async (_conn, _jobId, version, fileName, output, hash, count, target) => {
      const id = state.publications.length + 1
      state.publications.unshift({ PUBLICATION_ID: id, PUBLICATION_VERSION: version, OUTPUT_FILE_NAME: fileName,
        OUTPUT_PDF_BYTES: output, OUTPUT_SHA256: hash, OUTPUT_PAGE_COUNT: count, NETWORK_PATH: target, STATUS: 'PENDING' })
      state.job.STATUS = 'COMPLETING'
      return id
    },
    finishPublication: async (_conn, _jobId, id, savedPath) => {
      for (const row of state.publications) {
        if (row.PUBLICATION_ID === id) Object.assign(row, { STATUS: 'PUBLISHED', NETWORK_PATH: savedPath })
        else row.STATUS = 'RETIRED'
      }
      Object.assign(state.job, { STATUS: 'COMPLETED', LAST_COMPLETED_AT: new Date(), ROW_VERSION: state.job.ROW_VERSION + 1 })
    },
  }
  const overrides = {
    '@src/businessData/dbExecute': { MySQLExecute: { withTransaction: async work => {
      const before = snapshot()
      try { return await work({}) } catch (error) { state = before; throw error }
    } } },
    '@src/_workspace/services/merge-pdf/MergePdfDataService': { MergePdfDataService: repo },
    '@src/_workspace/services/email-settings/EmailDigestService': { EmailDigestService: { enqueuePublishedPublication: async (_conn, jobId, publicationId) => {
      if (failQueue) throw new Error('Simulated queue failure')
      state.queue.push({ jobId, publicationId })
    } } },
  }
  const loaded = new Map()
  const src = path.resolve(__dirname, '../src')
  function load(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports
    const mod = new Module(filename, module)
    loaded.set(filename, mod)
    mod.filename = filename
    mod.paths = Module._nodeModulePaths(path.dirname(filename))
    const nativeRequire = mod.require.bind(mod)
    mod.require = name => {
      if (overrides[name]) return overrides[name]
      if (name.startsWith('@src/')) return load(path.join(src, name.slice(5)) + '.ts')
      if (name.startsWith('.')) {
        const candidate = path.resolve(path.dirname(filename), name) + '.ts'
        if (fs.existsSync(candidate)) return load(candidate)
      }
      return nativeRequire(name)
    }
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, filename)
    return mod.exports
  }
  const service = load(path.join(src, '_workspace/services/merge-pdf/MergePdfService.ts')).MergePdfService
  const schema = load(path.join(src, '_workspace/services/merge-pdf/EditorChanges.ts')).editorChangesSchema
  const changes = () => ({ ...schema.parse(snapshot()), uploads: [] })
  const save = async (mode, edits, expectedVersion = state.job.ROW_VERSION) => service[mode](1, expectedVersion, edits)
  return {
    directory, snapshot, changes, save,
    failQueue: () => { failQueue = true },
    cleanup: () => {
      if (previousDirectory === undefined) delete process.env.MERGE_PDF_OUTPUT_DIR
      else process.env.MERGE_PDF_OUTPUT_DIR = previousDirectory
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('Save draft retains deskew, rotation, page order, descriptions and removals on repeated saves', async () => {
  const f = await fixture()
  try {
    const edits = f.changes()
    edits.pages[0].DESKEW_DEGREES = -2.5
    edits.pages[0].ROTATION_DEGREES = 90
    edits.pages[1].CATEGORY_ID = 3
    edits.pages = [edits.pages[2], edits.pages[0], edits.pages[1]]
    const saved = await f.save('saveEditorDraft', edits)
    assert.deepEqual(saved.pages.map(row => row.PAGE_ID), [4, 1, 2])
    assert.equal(saved.pages[1].DESKEW_DEGREES, -2.5)
    assert.equal(saved.pages[1].ROTATION_DEGREES, 90)
    assert.equal(saved.pages[2].CATEGORY_ID, 3)
    assert.equal(saved.documents.length, 3)
    const again = await f.save('saveEditorDraft', f.changes())
    assert.deepEqual(again.pages, saved.pages)
    assert.deepEqual(fs.readdirSync(f.directory), [])
  } finally { f.cleanup() }
})

test('Save & Complete and subsequent Save Changes write the edited PDF and publication hash', async () => {
  const f = await fixture()
  try {
    const edits = f.changes()
    edits.pages[0].DESKEW_DEGREES = 2
    edits.pages[0].ROTATION_DEGREES = 90
    const saved = await f.save('completeEditor', edits)
    assert.equal(saved.job.STATUS, 'COMPLETED')
    const target = path.join(f.directory, 'I26-0101.pdf')
    const first = fs.readFileSync(target)
    const pdf = await PDFDocument.load(first)
    assert.equal(pdf.getPageCount(), 4)
    assert.equal(pdf.getPage(0).getRotation().angle, 90)
    assert.deepEqual(createHash('sha256').update(first).digest(), saved.publications[0].OUTPUT_SHA256)
    const next = f.changes()
    next.pages[0].DESKEW_DEGREES = -3
    next.pages[3].DESCRIPTION = 'Updated description'
    const updated = await f.save('completeEditor', next)
    assert.equal(updated.publications[0].PUBLICATION_VERSION, 2)
    assert.equal(updated.pages[0].DESKEW_DEGREES, -3)
    assert.equal(updated.pages[3].DESCRIPTION, 'Updated description')
    assert.ok(!first.equals(fs.readFileSync(target)))
    assert.equal(f.snapshot().queue.length, 2)
  } finally { f.cleanup() }
})

test('failure after publishing restores both database state and the original PDF', async () => {
  const f = await fixture()
  try {
    await f.save('completeEditor', f.changes())
    const before = f.snapshot()
    const target = path.join(f.directory, 'I26-0101.pdf')
    const original = fs.readFileSync(target)
    f.failQueue()
    const edits = f.changes()
    edits.pages[0].DESKEW_DEGREES = 5
    await assert.rejects(f.save('completeEditor', edits), /Simulated queue failure/)
    assert.deepEqual(f.snapshot(), before)
    assert.deepEqual(fs.readFileSync(target), original)
  } finally { f.cleanup() }
})

test('failed first completion leaves no published PDF or saved page changes', async () => {
  const f = await fixture()
  try {
    const before = f.snapshot()
    f.failQueue()
    const edits = f.changes()
    edits.pages[0].DESKEW_DEGREES = 5
    await assert.rejects(f.save('completeEditor', edits), /Simulated queue failure/)
    assert.deepEqual(f.snapshot(), before)
    assert.deepEqual(fs.readdirSync(f.directory), [])
  } finally { f.cleanup() }
})

test('missing required pages or unconfirmed import entries reject completion without changes', async () => {
  const f = await fixture()
  try {
    const before = f.snapshot()
    const missing = f.changes()
    missing.pages = missing.pages.filter(page => page.CATEGORY_ID !== 2)
    await assert.rejects(f.save('completeEditor', missing), /are required/)
    assert.deepEqual(f.snapshot(), before)
    const unconfirmed = f.changes()
    unconfirmed.documents[0].ENTRY_STATUS_CODE = null
    await assert.rejects(f.save('completeEditor', unconfirmed), /status 04/)
    assert.deepEqual(f.snapshot(), before)
    assert.deepEqual(fs.readdirSync(f.directory), [])
  } finally { f.cleanup() }
})

test('stale versions cannot save, and completed documents cannot use Save draft', async () => {
  const f = await fixture()
  try {
    const initialVersion = f.snapshot().job.ROW_VERSION
    await f.save('saveEditorDraft', f.changes())
    const before = f.snapshot()
    await assert.rejects(f.save('saveEditorDraft', f.changes(), initialVersion), /Job changed/)
    assert.deepEqual(f.snapshot(), before)
    await f.save('completeEditor', f.changes())
    const completed = f.snapshot()
    await assert.rejects(f.save('saveEditorDraft', f.changes()), /Use Save Changes/)
    assert.deepEqual(f.snapshot(), completed)
  } finally { f.cleanup() }
})

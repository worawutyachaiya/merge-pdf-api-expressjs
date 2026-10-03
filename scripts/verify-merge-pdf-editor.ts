import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

import dotenv from 'dotenv'
import mysql, { type PoolConnection, type RowDataPacket } from 'mysql2/promise'

import { movePagesToPosition } from '../../App/src/_workspace/pages/merge-pdf/pageOrder'
import { MySQLExecute } from '../src/businessData/dbExecute'
import { MergePdfRepository as repo } from '../src/_workspace/sql/merge-pdf/MergePdfRepository'
import { MergePdfError, MergePdfService } from '../src/_workspace/services/merge-pdf/MergePdfService'

async function verify() {
  const pages = Array.from({ length: 96 }, (_, index) => index + 1)
  assert.deepEqual(movePagesToPosition(pages, [1], 96), [...pages.slice(1), 1])
  assert.deepEqual(movePagesToPosition(pages, [96], 1), [96, ...pages.slice(0, -1)])
  const moved = movePagesToPosition(pages, [26, 24, 25], 70)
  assert.deepEqual(moved.slice(69, 72), [24, 25, 26])
  assert.deepEqual(
    [...moved].sort((a, b) => a - b),
    pages
  )
  assert.deepEqual(
    pages,
    Array.from({ length: 96 }, (_, index) => index + 1)
  )
  // Exercise all destinations for every nonempty subset of a small document.
  const small = [1, 2, 3, 4, 5, 6]
  for (let mask = 1; mask < 64; mask++) {
    const selected = small.filter((_, index) => mask & (1 << index))
    for (let position = 1; position <= small.length - selected.length + 1; position++) {
      const result = movePagesToPosition(small, [...selected].reverse(), position)
      assert.deepEqual(result.slice(position - 1, position - 1 + selected.length), selected)
      assert.deepEqual(
        result.filter((id) => !selected.includes(id)),
        small.filter((id) => !selected.includes(id))
      )
      assert.deepEqual(
        [...result].sort((a, b) => a - b),
        small
      )
    }
  }
  for (const [selected, position] of [
    [[], 1],
    [[999], 1],
    [[1], 0],
    [[1], 97],
    [[1], 1.5],
  ] as const) {
    assert.throws(() => movePagesToPosition(pages, selected, position))
  }
  console.log('PASS: page moves across former pagination, groups, all destinations and invalid positions')

  dotenv.config({ path: '.env.development' })
  assert.equal(process.env.NODE_ENV, 'development', 'Development only')
  assert.equal(process.env.DB, '_sit_merge_pdf_worawut_2026_09_30', 'Dedicated Merge PDF database only')
  const pool = mysql.createPool({
    host: process.env.HOST,
    user: process.env.USER_NAME,
    password: process.env.PASSWORD,
    database: process.env.DB,
    port: Number(process.env.DB_PORT || 3308),
    connectTimeout: 10000,
    connectionLimit: 1,
  })
  const originalTransaction = MySQLExecute.withTransaction
  let conn: PoolConnection | undefined
  try {
    conn = await pool.getConnection()
    const [database] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS DB_NAME')
    assert.equal(database[0].DB_NAME, '_sit_merge_pdf_worawut_2026_09_30')
    await conn.beginTransaction()
    // Execute the real service/repository on an uncommitted fixture transaction.
    MySQLExecute.withTransaction = async (work) => work(conn!)
    const jobId = await repo.insertJob(conn, randomUUID(), 'Rollback-only editor verification', null)
    const bytes = Buffer.from('%PDF-1.4 synthetic retained bytes')
    const hash = createHash('sha256').update(bytes).digest()
    const documentId = await repo.insertDocument(conn, {
      jobId,
      categoryId: 2,
      uploadOrder: 1,
      fileName: 'verification.pdf',
      sourceType: 'PDF',
      sourceMime: 'application/pdf',
      original: bytes,
      normalized: bytes,
      originalHash: hash,
      normalizedHash: hash,
      pageCount: 2,
      entryStatusCode: null,
    })
    await repo.insertPages(conn, jobId, documentId, 2, 1)
    await repo.insertPublication(conn, jobId, 1, 'verification-output.pdf', bytes, hash, 2)
    const version = (await repo.getJob(jobId, conn))!.ROW_VERSION
    const rejectsWith = (status: number) => (error: unknown) => error instanceof MergePdfError && error.statusCode === status
    await assert.rejects(MergePdfService.deleteDraft(jobId, version), rejectsWith(409)) // Completing
    await conn.query("UPDATE MERGE_PDF_JOB SET STATUS = 'COMPLETED' WHERE JOB_ID = ?", [jobId])
    await assert.rejects(MergePdfService.deleteDraft(jobId, version), rejectsWith(409))
    await assert.rejects(repo.softDeleteDraft(conn, jobId), /Active draft not found/)
    assert.equal((await repo.getPages(jobId, conn)).length, 2)
    await conn.query("UPDATE MERGE_PDF_JOB SET STATUS = 'DRAFT' WHERE JOB_ID = ?", [jobId])
    await assert.rejects(MergePdfService.deleteDraft(jobId, version + 1), rejectsWith(409))
    assert.deepEqual(await MergePdfService.deleteDraft(jobId, version), { JOB_ID: jobId })
    for (const table of ['MERGE_PDF_JOB', 'MERGE_PDF_DOCUMENT', 'MERGE_PDF_PAGE', 'MERGE_PDF_PUBLICATION']) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT INUSE, CREATE_BY, UPDATE_BY, UPDATE_DATE FROM ${table} WHERE JOB_ID = ?`, [jobId])
      assert.ok(rows.length > 0)
      assert.ok(rows.every((row) => row.INUSE === 0 && row.CREATE_BY === 'DEV_LOCAL' && row.UPDATE_BY === 'DEV_LOCAL' && row.UPDATE_DATE))
    }
    const [documents] = await conn.query<RowDataPacket[]>('SELECT ORIGINAL_BYTES, NORMALIZED_PDF_BYTES FROM MERGE_PDF_DOCUMENT WHERE JOB_ID = ?', [jobId])
    assert.deepEqual(documents[0].ORIGINAL_BYTES, bytes)
    assert.deepEqual(documents[0].NORMALIZED_PDF_BYTES, bytes)
    const [publications] = await conn.query<RowDataPacket[]>('SELECT OUTPUT_PDF_BYTES FROM MERGE_PDF_PUBLICATION WHERE JOB_ID = ?', [jobId])
    assert.deepEqual(publications[0].OUTPUT_PDF_BYTES, bytes)
    const [pageRows] = await conn.query<RowDataPacket[]>('SELECT SORT_ORDER FROM MERGE_PDF_PAGE WHERE JOB_ID = ?', [jobId])
    assert.ok(pageRows.every((row) => row.SORT_ORDER === null))
    assert.equal(await repo.getJob(jobId, conn), undefined)
    assert.equal((await repo.getDocuments(jobId, conn)).length, 0)
    assert.equal((await repo.getPages(jobId, conn)).length, 0)
    await assert.rejects(MergePdfService.deleteDraft(jobId, version), rejectsWith(404))
    console.log('PASS: Draft soft delete retains binary/audit data; stale versions, Completed and Completing are rejected')
  } finally {
    MySQLExecute.withTransaction = originalTransaction
    if (conn) {
      await conn.rollback()
      conn.release()
    }
    await pool.end()
    console.log('Verification fixture transaction rolled back')
  }
}

verify().catch((error) => {
  console.error('Editor verification failed:', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})

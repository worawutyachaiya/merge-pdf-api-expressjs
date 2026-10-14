import assert from 'node:assert/strict'
import { readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import mysql, { type PoolConnection, type QueryResult, type RowDataPacket } from 'mysql2/promise'
import { PDFDocument } from 'pdf-lib'

import { loadEnvironmentVariables } from '../src/config/env'
import { MySQLExecute } from '../src/businessData/dbExecute'
import { MergePdfService } from '../src/_workspace/services/merge-pdf/MergePdfService'
import { checkOutputDirectory, getOutputDirectory } from '../src/_workspace/services/merge-pdf/PublicationStorage'

async function verify() {
  loadEnvironmentVariables()
  assert.equal(process.env.NODE_ENV, 'development', 'Development only')
  assert.equal(process.env.DB, '_sit_merge_pdf_worawut_2026_09_30', 'Dedicated Merge PDF test database only')
  const directory = getOutputDirectory()
  await checkOutputDirectory(directory)
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
  const originalQuery = MySQLExecute.queryParams
  let conn: PoolConnection | undefined
  let ownedOutput: string | undefined
  try {
    conn = await pool.getConnection()
    const [database] = await conn.query<RowDataPacket[]>('SELECT DATABASE() AS DB_NAME')
    assert.equal(database[0].DB_NAME, '_sit_merge_pdf_worawut_2026_09_30')
    await conn.beginTransaction()
    // All real repository reads and writes share one transaction, rolled back below.
    MySQLExecute.withTransaction = async (work) => work(conn!)
    MySQLExecute.queryParams = async <T extends QueryResult>(sql: string, values: readonly unknown[] = []): Promise<T> =>
      (await conn!.query<T>(sql, [...values]))[0]
    let detail = await MergePdfService.create('Rollback-only network storage verification', null)
    const source = await PDFDocument.create()
    source.addPage([300, 400]).drawText('Merge PDF storage verification')
    const bytes = Buffer.from(await source.save())
    for (const category of [1, 2, 4]) {
      detail = await MergePdfService.addDocument(
        detail.job.JOB_ID,
        detail.job.ROW_VERSION,
        category,
        category === 1 ? '04' : null,
        'storage-check.pdf',
        bytes
      )
    }
    const expectedOutput = path.join(directory, `${detail.job.JOB_CODE}-v1.pdf`)
    await assert.rejects(stat(expectedOutput), (error) => (error as NodeJS.ErrnoException).code === 'ENOENT')
    detail = await MergePdfService.complete(detail.job.JOB_ID, detail.job.ROW_VERSION)
    assert.equal(detail.job.STATUS, 'COMPLETED')
    assert.equal(detail.publications[0].STATUS, 'PUBLISHED')
    assert.equal(detail.publications[0].NETWORK_PATH, expectedOutput)
    ownedOutput = expectedOutput
    const output = await readFile(expectedOutput)
    assert.equal((await PDFDocument.load(output)).getPageCount(), 3)
    const downloaded = await MergePdfService.publicationPdf(detail.job.JOB_ID, detail.publications[0].PUBLICATION_ID)
    assert.deepEqual(downloaded?.bytes, output)
    console.log('PASS: real database + Save & Complete + network PDF + download; merged PDF has three pages')
  } finally {
    MySQLExecute.withTransaction = originalTransaction
    MySQLExecute.queryParams = originalQuery
    if (conn) {
      await conn.rollback()
      conn.release()
    }
    await pool.end()
    if (ownedOutput) {
      assert.equal(path.dirname(ownedOutput), path.normalize(directory))
      await unlink(ownedOutput)
    }
    console.log('Test records rolled back; the generated test PDF was removed')
  }
}

verify().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

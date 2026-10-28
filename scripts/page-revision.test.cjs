const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')

const source = path.resolve(__dirname, '../src/_workspace/sql/merge-pdf/RecordRevisionSQL.ts')
const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'require', 'module', compiled)(loaded.exports, require, loaded)
const { RecordRevisionSQL } = loaded.exports

const page = [{ PAGE_ID: 7, REVISION_NO: 3 }]

test('saving editor page details accepts and writes the deskew angle', () => {
  const changes = {
    CATEGORY_ID: 1,
    CLASSIFICATION_SOURCE: 'USER',
    CLASSIFICATION_CONFIDENCE: null,
    ROTATION_DEGREES: 90,
    DESKEW_DEGREES: -2.5,
    DESCRIPTION: null,
  }
  assert.doesNotThrow(() => RecordRevisionSQL.selectActive('MERGE_PDF_PAGE', 'PAGE_ID = ?', changes))
  const replacement = RecordRevisionSQL.insertReplacement('MERGE_PDF_PAGE', page, changes, 'TEST')
  assert.match(replacement.sql, /ROTATION_DEGREES, DESKEW_DEGREES, SORT_ORDER/)
  assert.ok(replacement.params.includes(-2.5))
})

test('reordering or recategorizing a page preserves its existing deskew angle', () => {
  for (const changes of [{ SORT_ORDER: 2 }, { CATEGORY_ID: 4 }]) {
    const replacement = RecordRevisionSQL.insertReplacement('MERGE_PDF_PAGE', page, changes, 'TEST')
    assert.match(replacement.sql, /SELECT .*ROTATION_DEGREES, DESKEW_DEGREES,/)
  }
})

test('unknown page fields remain rejected', () => {
  assert.throws(
    () => RecordRevisionSQL.selectActive('MERGE_PDF_PAGE', 'PAGE_ID = ?', { UNKNOWN_FIELD: 1 }),
    /Cannot revise MERGE_PDF_PAGE.UNKNOWN_FIELD/
  )
})

test('every revision table preserves all columns declared in the schema', () => {
  const schema = readFileSync(path.resolve(__dirname, '../src/_workspace/sql/merge-pdf/schema.sql'), 'utf8')
  const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (MERGE_PDF_\w+) \(([\s\S]*?)\) ENGINE/g)]
  assert.equal(tables.length, 12)
  for (const [, table, definition] of tables) {
    const fields = [...definition.matchAll(/^\s{2}(\w+)\s+(?:TINYINT|SMALLINT|INT|BIGINT|CHAR|VARCHAR|DATE|DATETIME|TIME|DOUBLE|DECIMAL|BINARY|LONGBLOB)\b/gm)]
      .map(match => match[1])
      .filter(field => field !== 'CREATE_DATE' && field !== 'UPDATE_DATE')
    const replacement = RecordRevisionSQL.insertReplacement(table, [{}], {}, 'TEST')
    const copied = replacement.sql.match(/INSERT INTO \w+ \(([^)]+)\)/)[1].split(', ')
    assert.deepEqual([...copied].sort(), fields.sort(), `${table} has missing or unknown revision fields`)
  }
})

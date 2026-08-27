const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const resolver = compile('stockActionResolver.ts')
const subject = compile('stockActionSeal.ts', { './db': {}, './stockActionResolver': resolver })
const sqlite = new Database(':memory:')
sqlite.exec(`CREATE TABLE import_job_rows (
  job_id TEXT NOT NULL, phase TEXT NOT NULL, row_number INTEGER NOT NULL,
  result_json TEXT NOT NULL, PRIMARY KEY(job_id, phase, row_number)
)`)

const db = {
  prepare(sql) {
    return {
      run(params) { const info = sqlite.prepare(sql).run(params); return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }) },
      get(params) { return Promise.resolve(sqlite.prepare(sql).get(params)) },
    }
  },
}
const insert = sqlite.prepare(`INSERT INTO import_job_rows VALUES (@job, 'analyze', @row, @json)`)
function add(row, identityKey, costPriceUsd, batchLabel, warnings = []) {
  insert.run({
    job: 'job-1', row,
    json: JSON.stringify({
      rowNumber: row, action: 'update', identifier: identityKey, existingId: 1,
      message: warnings.length ? warnings.map((warning) => warning.message).join(' ') : null,
      warnings, changes: {}, data: { identityKey, costPriceUsd, batchLabel, conflicts: [] },
    }),
  })
}

// Identity A represents rows classified in different queue windows: only the
// final persisted seal can see both batch+cost combinations.
add(2, 'product:A', 5, 'AUG')
add(302, 'product:A', 6, 'SEP')
// Different costs but one batch: explicitly not ambiguous.
add(3, 'product:B', 5, 'AUG')
add(303, 'product:B', 6, 'AUG')
// Already warned inside one window: final seal must be idempotent.
const warning = { kind: 'stock_action_conflict', message: resolver.COST_BATCH_CONFLICT_MESSAGE }
add(4, 'product:C', 5, 'AUG', [warning])
add(5, 'product:C', 6, 'SEP', [warning])

;(async () => {
  assert.strictEqual(await subject.sealUnifiedStockAnalyzeConflicts(db, 'job-1'), 2)
  assert.strictEqual(await subject.countUnifiedStockConfirmationRows(db, 'job-1'), 4)
  assert.strictEqual(await subject.sealUnifiedStockAnalyzeConflicts(db, 'job-1'), 0, 'retry must not duplicate warnings')

  const rows = sqlite.prepare(`SELECT row_number, result_json FROM import_job_rows ORDER BY row_number`).all()
  const parsed = new Map(rows.map((row) => [row.row_number, JSON.parse(row.result_json)]))
  assert.strictEqual(parsed.get(2).warnings.length, 1)
  assert.strictEqual(parsed.get(302).warnings.length, 1)
  assert.strictEqual(parsed.get(3).warnings.length, 0)
  assert.strictEqual(parsed.get(4).warnings.length, 1)
  assert.ok(parsed.get(2).data.conflicts.includes(resolver.COST_BATCH_CONFLICT_MESSAGE))
  console.log('PASS stock-action final seal catches cross-window cost/batch conflicts once and leaves safe identities untouched')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

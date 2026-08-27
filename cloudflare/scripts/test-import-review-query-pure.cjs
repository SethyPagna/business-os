const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const file = path.join(__dirname, '..', 'src', 'lib', 'importReviewQuery.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
const { buildImportReviewWhere } = mod.exports

const basic = buildImportReviewWhere({ jobId: 'job-1' })
assert.match(basic.sql, /job_id = @id/)
assert.deepStrictEqual(basic.params, { id: 'job-1' })

const filtered = buildImportReviewWhere({
  jobId: 'job-2', action: 'error', query: `50%_off\\' OR 1=1 --`,
  warningKinds: ['name_match', 'stock_action_conflict', 'name_match'],
})
assert.match(filtered.sql, /action = @action/)
assert.match(filtered.sql, /LIKE @query ESCAPE/)
assert.match(filtered.sql, /IN \(@warning0, @warning1\)/)
assert.ok(!filtered.sql.includes('OR 1=1'), 'raw search text never enters SQL')
assert.strictEqual(filtered.params.action, 'error')
assert.strictEqual(filtered.params.query, `%50\\%\\_off\\\\' or 1=1 --%`)
assert.strictEqual(filtered.params.warning0, 'name_match')
assert.strictEqual(filtered.params.warning1, 'stock_action_conflict')

const capped = buildImportReviewWhere({
  jobId: 'job-3', warningKinds: Array.from({ length: 20 }, (_, index) => `kind-${index}`),
})
assert.strictEqual(Object.keys(capped.params).filter((key) => key.startsWith('warning')).length, 8)

const sqlite = new Database(':memory:')
sqlite.exec(`CREATE TABLE import_job_rows (
  job_id TEXT, phase TEXT, row_number INTEGER, action TEXT, identifier TEXT, result_json TEXT,
  PRIMARY KEY(job_id, phase, row_number)
)`)
const insert = sqlite.prepare(`INSERT INTO import_job_rows VALUES (?, 'analyze', ?, ?, ?, ?)`)
insert.run('job-sql', 2, 'update', '50%_Off Serum', JSON.stringify({ warnings: [{ kind: 'stock_action_conflict', message: 'review' }] }))
insert.run('job-sql', 3, 'error', 'Ordinary', JSON.stringify({ warnings: [{ kind: 'name_match', message: 'review' }] }))
insert.run('job-sql', 4, 'update', '50XXOff Serum', JSON.stringify({ warnings: [{ kind: 'stock_action_conflict', message: 'review' }] }))
const sqlWhere = buildImportReviewWhere({ jobId: 'job-sql', action: 'update', query: '50%_off', warningKinds: ['stock_action_conflict'] })
const matched = sqlite.prepare(`SELECT row_number FROM import_job_rows WHERE ${sqlWhere.sql} ORDER BY row_number LIMIT @limit OFFSET @offset`)
  .all({ ...sqlWhere.params, limit: 50, offset: 0 })
assert.deepStrictEqual(matched.map((row) => row.row_number), [2], 'SQLite executes the bound filters and treats %/_ as literal search text')

console.log('PASS import review query keeps filtering/pagination in D1 with bound, escaped inputs')

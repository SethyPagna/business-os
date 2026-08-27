const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const file = path.join(__dirname, '..', 'src', 'lib', 'importReviewQuery.ts')
const routeFile = path.join(__dirname, '..', 'src', 'routes', 'importJobs.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
const { buildImportReviewOrder, buildImportReviewWhere, buildUnresolvedContactReviewWhere } = mod.exports

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

assert.strictEqual(buildImportReviewOrder('row_desc'), 'row_number DESC')
assert.strictEqual(buildImportReviewOrder('name_asc'), `LOWER(COALESCE(identifier, '')) ASC, row_number ASC`)
assert.strictEqual(buildImportReviewOrder('name_desc'), `LOWER(COALESCE(identifier, '')) DESC, row_number ASC`)
assert.strictEqual(buildImportReviewOrder(`name_asc; DROP TABLE import_job_rows`), 'row_number ASC', 'unknown sort input must fail closed to a fixed fragment')

const sqlite = new Database(':memory:')
sqlite.exec(`CREATE TABLE import_job_rows (
  job_id TEXT, phase TEXT, row_number INTEGER, action TEXT, identifier TEXT, result_json TEXT,
  PRIMARY KEY(job_id, phase, row_number)
)`)
const insert = sqlite.prepare(`INSERT INTO import_job_rows VALUES (?, 'analyze', ?, ?, ?, ?)`)
insert.run('job-sql', 2, 'update', '50%_Off Serum', JSON.stringify({ warnings: [{ kind: 'stock_action_conflict', message: 'review' }] }))
insert.run('job-sql', 3, 'error', 'Ordinary', JSON.stringify({ data: { phone: '012-50%_off' }, warnings: [{ kind: 'name_match', message: 'review' }] }))
insert.run('job-sql', 4, 'update', '50XXOff Serum', JSON.stringify({ warnings: [{ kind: 'stock_action_conflict', message: 'review' }] }))
const sqlWhere = buildImportReviewWhere({ jobId: 'job-sql', action: 'update', query: '50%_off', warningKinds: ['stock_action_conflict'] })
const matched = sqlite.prepare(`SELECT row_number FROM import_job_rows WHERE ${sqlWhere.sql} ORDER BY row_number LIMIT @limit OFFSET @offset`)
  .all({ ...sqlWhere.params, limit: 50, offset: 0 })
assert.deepStrictEqual(matched.map((row) => row.row_number), [2], 'SQLite executes the bound filters and treats %/_ as literal search text')
const nestedSearchWhere = buildImportReviewWhere({ jobId: 'job-sql', query: '012-50%_off' })
const nestedMatched = sqlite.prepare(`SELECT row_number FROM import_job_rows WHERE ${nestedSearchWhere.sql}`)
  .all(nestedSearchWhere.params)
assert.deepStrictEqual(nestedMatched.map((row) => row.row_number), [3], 'review search includes nested contact fields while treating wildcard characters literally')

insert.run('job-sort', 2, 'update', 'Zulu', JSON.stringify({ warnings: [] }))
insert.run('job-sort', 3, 'update', 'alpha', JSON.stringify({ warnings: [] }))
insert.run('job-sort', 4, 'update', 'Alpha', JSON.stringify({ warnings: [] }))
const sortWhere = buildImportReviewWhere({ jobId: 'job-sort' })
const sorted = sqlite.prepare(`SELECT row_number FROM import_job_rows WHERE ${sortWhere.sql} ORDER BY ${buildImportReviewOrder('name_asc')}`)
  .all(sortWhere.params)
assert.deepStrictEqual(sorted.map((row) => row.row_number), [3, 4, 2], 'alphabetical review order is case-insensitive and stable by row number')

insert.run('job-contact', 2, 'update', 'Sokha', JSON.stringify({ warnings: [{ kind: 'name_match', message: 'review' }] }))
insert.run('job-contact', 3, 'update', 'Dara', JSON.stringify({ warnings: [{ kind: 'membership_phone_conflict', message: 'review' }] }))
insert.run('job-contact', 4, 'update', 'Clean', JSON.stringify({ warnings: [] }))
const unresolvedWhere = buildUnresolvedContactReviewWhere('job-contact', JSON.stringify({ 2: { action: 'apply' } }))
const unresolved = sqlite.prepare(`SELECT COUNT(*) AS n FROM import_job_rows WHERE ${unresolvedWhere.sql}`).get(unresolvedWhere.params)
assert.strictEqual(unresolved.n, 1, 'only contact-conflict rows without a durable row decision block approval')

const routeSource = fs.readFileSync(routeFile, 'utf8')
assert.match(routeSource, /buildImportReviewOrder\(c\.req\.query\('sort'\)\)/, 'review route must parse sort through the fixed whitelist')
assert.match(routeSource, /ORDER BY \$\{orderBy\}/, 'review route must apply the whitelisted order fragment')
assert.match(routeSource, /code: 'contact_conflicts_unresolved'/, 'contact approval must fail closed while any conflict lacks a durable decision')
assert.match(routeSource, /unresolvedContactConflicts/, 'review response exposes the server-wide unresolved count for paginated confirmation UI')

console.log('PASS import review query keeps filtering/pagination in D1 with bound, escaped inputs')

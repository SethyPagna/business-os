// The exchange precondition looks a replacement sale up by client_request_id OR receipt_number. Without the predicate of the
// partial unique index idx_sales_client_request_unique_pg the planner could not use it and scanned every sale. This pins the
// plan (an index seek on both sides) and that the answer is the same as the unguarded query for every kind of row.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/returnCreateAction.ts'), 'utf8')
const output = buildSync({ stdin: { contents: source, resolveDir: path.join(root, 'src/lib'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' }).outputFiles[0].text
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)

const sql = moduleObj.exports.returnCreatePreconditionSql({ authorityPredicate: '1=1', lineageCondition: '1=1', effectGuardPredicate: null })
const match = /SELECT 1 FROM sales WHERE [^\n]*client_request_id[^\n]*receipt_number=@replacementReceiptNumber/.exec(sql)
assert(match, 'the replacement lookup is still in the precondition')
const lookup = match[0]

const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
const insert = db.prepare('INSERT INTO sales(id,receipt_number,client_request_id) VALUES(?,?,?)')
insert.run(1, 'S-1', 'req-1')
insert.run(2, 'S-2', null)
insert.run(3, 'S-3', '')
insert.run(4, 'S-4', '')
const named = (text) => text.replace(/@replacementClientRequestId/g, '@c').replace(/@replacementReceiptNumber/g, '@r')

const plan = db.prepare(`EXPLAIN QUERY PLAN ${named(lookup)}`).all({ c: 'return-replacement:x', r: 'S-none' }).map((row) => row.detail).join(' | ')
assert(!/\bSCAN\b/.test(plan), `the replacement lookup must not scan sales: ${plan}`)
assert.match(plan, /idx_sales_client_request_unique_pg/)
assert.match(plan, /idx_sales_receipt_number/)

const exists = (clientRequestId, receipt) => db.prepare(`SELECT EXISTS(${named(lookup)}) AS found`).get({ c: clientRequestId, r: receipt }).found
assert.equal(exists('req-1', 'S-none'), 1, 'a client request id match is found')
assert.equal(exists('return-replacement:x', 'S-2'), 1, 'a receipt number match is found')
assert.equal(exists('return-replacement:x', 'S-none'), 0, 'no match')
assert.equal(exists('return-replacement:x', 'S-3'), 1, 'a row with an empty request id is found by its receipt number')
console.log('return create precondition plan: ok')

'use strict'
// Count tasks, round 8c (review finding F6): issuing a task from a FILTER never ranks the whole scope, whatever catalog_ranked_scope says (it is ON in production). On Free a broad filter used to cost
// 83 ms of JavaScript at 3,000 products and 209 ms at 6,000 against Free's 10 ms, because the ranked reader ranked every product before cutting its first page. An issue needs the ids of the scope, never an order.
//   I1  a filter that holds exactly the Free cap (100) issues, ranked ON.
//   I2  a filter that holds one more (101) is refused after the FIRST page, and says "at least 101" (before: a second full page was read and the total said 200).
//   I3  a filter over a large catalogue (3,000) is refused after the first page with the families the reader counted ("at least 3,000"), with the same number of D1 calls ranked ON and OFF (before: ranked ON ran
//       6 more and ranked the scope): the cost does not grow with the catalogue and does not depend on the switch.
//   I4  the ranked branch of the products reader is closed to idsOnly in the source.
// Run (under the native-test lock): node scripts/test-inventory-check-issue-filter-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runIssue } = require('./measure-inventory-check-issue-cpu.cjs')

const failures = []
let passed = 0
async function check(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 5).join('\n     ')}`) } }

async function main() {
  await runIssue('free', 20, 'ranked', 0)
  await check('I1 a filter of exactly the Free cap (100 products) issues with catalog_ranked_scope ON', async () => {
    const r = await runIssue('free', 100, 'ranked', 1)
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300))
  })
  await check('I2 a filter of 101 products is refused after the first page: "at least 101", ranked ON', async () => {
    const r = await runIssue('free', 101, 'ranked', 1)
    assert.equal(r.status, 400); assert.equal(r.body.code, 'inventory_check_task_too_many')
    assert.equal(r.body.limit, 100); assert.equal(r.body.total, 101, 'the least the reader knows'); assert.equal(r.body.atLeast, true)
  })
  await check('I3 a filter over 3,000 products costs the same D1 calls ranked ON and OFF, and refuses after one page', async () => {
    const on = await runIssue('free', 3000, 'ranked', 1), off = await runIssue('free', 3000, 'page', 1)
    for (const r of [on, off]) { assert.equal(r.status, 400); assert.equal(r.body.code, 'inventory_check_task_too_many'); assert.equal(r.body.atLeast, true); assert.equal(r.body.total, 3000, 'the families the first page counted') }
    assert.equal(on.calls, off.calls, `D1 calls ranked ON ${on.calls} and OFF ${off.calls}`)
    assert.equal(on.statements, off.statements, 'statements')
    assert.ok(on.calls <= 18, `${on.calls} D1 calls (Free allows 50)`)
  })
  await check('I4 the ranked branch of the products reader is closed to idsOnly, and the issue passes idsOnly to it', async () => {
    const products = fs.readFileSync(path.join(__dirname, '..', 'src/routes/products.ts'), 'utf8'), checks = fs.readFileSync(path.join(__dirname, '..', 'src/routes/inventoryChecks.ts'), 'utf8')
    assert.ok(/if \(options\.grouping \|\| \(!options\.idsOnly && /.test(products), 'the ranked branch tests !options.idsOnly')
    assert.ok(/\.\.\.\(extra\.idsOnly \? \{ idsOnly: true \} : \{\}\)/.test(checks), 'readListPage passes idsOnly on')
  })
  console.log(`${passed} checks passed${failures.length ? `, ${failures.length} FAILED` : ''}`)
  process.exit(failures.length ? 1 : 0)
}
main().catch((error) => { console.error(error); process.exit(1) })

// MERGE-UNBLOCK part C: a 5xx on the merge / Resolve routes writes ONE structured
// log line with the route, the product ids and the error text, so the next
// occurrence of the owner's unexplained "request not finished" is diagnosable.
// Names, barcodes, prices and user details must never reach it.
//
// Pure helpers, then the real products router (full migration chain, SQLite)
// with a fault injected into the fold, reading what console.error received.
//
// Run (from cloudflare/): node scripts/test-merge-route-failure-log-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'mergeRouteLog.ts'), 'utf8')
const mod = { exports: {} }
new Function('module', 'exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports, require)
const { collectMergeProductIds, describeMergeFailure, MERGE_FAILURE_LOG_EVENT } = mod.exports

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

async function captureLogs(run) {
  const lines = []
  const original = console.error
  console.error = (...args) => { lines.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ')) }
  try { await run() } finally { console.error = original }
  return lines
}

async function main() {
  await check('ids come only from the named merge keys, deduplicated and capped', () => {
    assert.deepEqual(collectMergeProductIds('/merge', {}, { keepId: 5, mergeId: 9, resolve: { steps: [{ mergeId: 9 }, { mergeId: 11 }] }, name: 'Secret Name', price: 42 }), [5, 9, 11])
    assert.deepEqual(collectMergeProductIds('/possible-duplicates/merge-preview', { keepId: '3', mergeId: '4', groupIds: '3,4,6' }, null), [3, 4, 6])
    assert.deepEqual(collectMergeProductIds('/77', {}, null), [77], 'PUT /:id names the edited product')
    assert.deepEqual(collectMergeProductIds('/merge-batch', {}, { cases: [{ keep_id: 1, merge_id: 2, case_key: 'x' }], groups: [{ keeper_id: 8, member_ids: [8, 9] }] }), [1, 2, 8, 9])
    assert.equal(collectMergeProductIds('/x', {}, { keepId: Array.from({ length: 500 }, (_, i) => i + 1) }).length, 40)
    assert.deepEqual(collectMergeProductIds('/x', {}, { keepId: -4, mergeId: 'abc', steps: 'nope' }), [], 'junk is ignored, not logged')
  })

  await check('the line is one JSON object with route, ids, status and the error text, and nothing else', () => {
    const line = describeMergeFailure({ method: 'POST', path: '/api/products/possible-duplicates/merge', status: 500, productIds: [5, 9], error: new TypeError('D1_ERROR: no such table: x') })
    assert.deepEqual(JSON.parse(line), {
      event: MERGE_FAILURE_LOG_EVENT, method: 'POST', route: '/api/products/possible-duplicates/merge', status: 500,
      productIds: [5, 9], errorName: 'TypeError', error: 'D1_ERROR: no such table: x',
    })
    const long = JSON.parse(describeMergeFailure({ method: 'POST', path: '/p', status: 503, productIds: [], error: new Error('x'.repeat(1000)) }))
    assert.equal(long.error.length, 300, 'a huge message cannot flood the log')
    assert.equal(JSON.parse(describeMergeFailure({ method: 'POST', path: '/p', status: 500, productIds: [], error: undefined })).error, 'returned a 5xx without a thrown error')
  })

  await check('DISCRIMINATING: a real 5xx on the pair merge route logs its structured line; a 4xx and another route log nothing', async () => {
    const h = createProductsRouteHarness({ user: ADMIN })
    h.setUser(ADMIN)
    h.raw.db.exec(`
      INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
      INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES
        (1, 'Gloss One', '8850000000011', 2, 5, 0, 1), (2, 'Gloss One', '8850000000011', 3, 5, 0, 1);
    `)
    const refused = await captureLogs(async () => {
      const res = await h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 1 })
      assert.equal(res.status, 400)
      const missing = await h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 999 })
      assert.equal(missing.status, 404)
    })
    assert.deepEqual(refused.filter((line) => line.includes(MERGE_FAILURE_LOG_EVENT)), [], 'a definite refusal is not a fault')

    h.raw.db.exec('DROP TABLE stock_session_members')
    const lines = await captureLogs(async () => {
      const res = await h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(res.status, 409)
      assert.equal(res.json.code, 'merge_failed', 'a rolled-back fold is a definite refusal the browser can read, not a raw 500')
    })
    const logged = lines.filter((line) => line.startsWith('{') && line.includes(MERGE_FAILURE_LOG_EVENT))
    assert.equal(logged.length, 1, `exactly one structured line, got ${JSON.stringify(lines)}`)
    const entry = JSON.parse(logged[0])
    assert.equal(entry.route, '/possible-duplicates/merge')
    assert.equal(entry.method, 'POST')
    assert.equal(entry.status, 409)
    assert.match(entry.errorId, /^[0-9a-f-]{36}$/, 'the line carries the errorId the operator was shown')
    assert.deepEqual(entry.productIds, [1, 2])
    assert.match(entry.error, /stock_session_members/, 'the real error text, so the cause is findable')
    assert.ok(!logged[0].includes('Gloss One') && !logged[0].includes('8850000000011'), 'no product name or barcode in the line')

    const other = await captureLogs(async () => { await h.request('GET', '/zero-quantity-candidates') })
    assert.deepEqual(other.filter((line) => line.includes(MERGE_FAILURE_LOG_EVENT)), [], 'routes outside merge/resolve are not logged here')
  })

  await check('DISCRIMINATING: the bulk preview and finalize POSTs still reach their own body guard (the log middleware must not consume the stream first)', async () => {
    const h = createProductsRouteHarness({ user: ADMIN })
    h.setUser(ADMIN)
    const logged = []
    const lines = await captureLogs(async () => {
      for (const path of ['/possible-duplicates/merge-batch/preview', '/possible-duplicates/merge-batch/reviews/review-1/finalize']) {
        const res = await h.request('POST', path, { manifest_version: 1, resolution_version: 2 })
        assert.notEqual(res.status, 500, `${path} answered 500: ${JSON.stringify(res.json)}`)
        assert.ok(res.status >= 400 && res.status < 500, `${path}: a body with no groups is a definite refusal, got ${res.status}`)
        logged.push(res.status)
      }
      const big = await h.request('POST', '/possible-duplicates/merge-batch/preview', { merge_groups: [], filler: 'x'.repeat(4 * 1024 * 1024 + 10) })
      assert.equal(big.status, 413, 'the bounded-body guard still runs and still counts the bytes')
      assert.equal(big.json.code, 'request_body_too_large')
    })
    assert.deepEqual(lines.filter((line) => line.includes(MERGE_FAILURE_LOG_EVENT)), [], 'no 5xx line was written')
    assert.equal(logged.length, 2)
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

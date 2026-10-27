'use strict'
// Free plan, from 30 Oct 2026: once the account reaches D1's daily row cap (5M read / 100k written, UTC day), EVERY D1
// call fails until 00:00 UTC with Cloudflare's text (D1 changelog, 1 Sep 2026):
//   "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow
//    (midnight UTC) to continue."          (or "... daily row write limit ...")
// The Worker must answer with ONE stable 503 the app can show a single banner for -- { success:false,
// code:'d1_daily_limit', limit:'read'|'write', resetsAt:<next 00:00 UTC> } -- never the raw message, and must not retry.
//
// Runs the real lib/d1DailyLimit.ts and the real lib/db.ts retry kernel; the app.onError wiring in src/index.ts is
// pinned in source (it cannot be imported without the whole Worker).
//
// Run: node scripts/test-d1-daily-limit-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, requireFor = require) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, requireFor, mod, filename, path.dirname(filename))
  return mod.exports
}
const limit = load('lib/d1DailyLimit.ts')
const db = load('lib/db.ts', (id) => id === './importMaintenanceFence' ? { getImportFencedDb() {}, withImportMaintenanceWriteFence() {}, isImportMaintenanceFenceError: () => false, ImportMaintenanceFenceError: class extends Error {} } : require(id))

const READ = "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
const WRITE = "Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('the read-limit message maps to limit "read", with or without the D1_ERROR prefix D1 adds', () => {
  assert.equal(limit.d1DailyLimitOf(new Error(READ)), 'read')
  assert.equal(limit.d1DailyLimitOf(new Error(`D1_ERROR: ${READ}: SQLITE_ERROR`)), 'read')
})
check('the write-limit message maps to limit "write"', () => {
  assert.equal(limit.d1DailyLimitOf(new Error(WRITE)), 'write')
  assert.equal(limit.d1DailyLimitOf(new Error(`D1_ERROR: ${WRITE}`)), 'write')
})
check('a wrapped cause is found, and a bare string error too', () => {
  assert.equal(limit.d1DailyLimitOf(new Error('Failed query', { cause: new Error(WRITE) })), 'write')
  assert.equal(limit.d1DailyLimitOf(READ), 'read')
})
check('unrelated errors do not match: other quota text, SQL errors, overload, nothing', () => {
  for (const other of [
    new Error("D1_ERROR: Your account has exceeded D1's maximum account storage limit"),
    new Error('D1_ERROR: no such table: sales: SQLITE_ERROR'),
    new Error('D1 DB is overloaded. Requests queued for too long.'),
    new Error('Network connection lost'),
    new Error('daily row read limit'),
    null, undefined, {}, 42,
  ]) assert.equal(limit.d1DailyLimitOf(other), null, String(other && other.message || other))
  assert.equal(limit.d1DailyLimitBody(new Error('boom')), null)
})
check('the body is exactly { success:false, code, limit, resetsAt }; resetsAt is the next 00:00 UTC; the raw message never appears', () => {
  const body = limit.d1DailyLimitBody(new Error(`D1_ERROR: ${READ}`), new Date('2026-10-30T17:45:12.345Z'))
  assert.deepEqual(body, { success: false, code: 'd1_daily_limit', limit: 'read', resetsAt: '2026-10-31T00:00:00.000Z' })
  assert.ok(!JSON.stringify(body).includes('Upgrade'))
  assert.equal(limit.nextUtcMidnight(new Date('2026-12-31T23:59:59.999Z')), '2027-01-01T00:00:00.000Z')
  assert.equal(limit.nextUtcMidnight(new Date('2026-10-30T00:00:00.000Z')), '2026-10-31T00:00:00.000Z')
})
check('fail fast: lib/db.ts does not retry either message (a retry only spends rows against an account that is already over)', () => {
  assert.equal(db.isRetryableD1Error(new Error(`D1_ERROR: ${READ}`)), false)
  assert.equal(db.isRetryableD1Error(new Error(`D1_ERROR: ${WRITE}`)), false)
  assert.equal(db.isRetryableD1Error(new Error('D1_ERROR: network connection lost')), true, 'control: a transient error still retries')
})
check('wiring: app.onError answers it before the generic 500, with 503, from the mapped body, without the error message', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
  // right after the stock-transaction refusal (other tests pin the first two statements of the handler)
  const handler = source.slice(source.indexOf('const dailyLimit'), source.indexOf('const stockRefusal'))
  assert.match(handler, /const dailyLimit = d1DailyLimitBody\(error\)/)
  assert.match(handler, /return c\.json\(\{ \.\.\.dailyLimit, error: '[^']+' \}, 503/)
  assert.ok(!/error\.message|String\(error/.test(handler), 'the raw message is never echoed')
  assert.match(source, /import \{ d1DailyLimitBody \} from '\.\/lib\/d1DailyLimit'/)
})
console.log(`${passed} checks passed`)

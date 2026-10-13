// Regression test for lib/clientTimestamp.ts -- bounded trust for a
// client-supplied sale timestamp. Offline selling was cancelled (26 Sep 2026),
// so a sale's created_at is honored only inside a short window around the
// server clock; anything else gets the server clock (null), never an error,
// and the claim is reported back so it can be audited (security audit B1: a
// POS user could back-date a paid sale to a closed business day and hide the
// cash from today's shift). Behavior + the wiring source-locks.
//
// Run: node scripts/test-client-timestamp-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const srcPath = path.join(cloudflareRoot, 'src', 'lib', 'clientTimestamp.ts')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-timestamp-'))
const tsPath = path.join(tmpDir, 'clientTimestamp.ts')
fs.writeFileSync(tsPath, fs.readFileSync(srcPath, 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const lib = require(path.join(tmpDir, 'clientTimestamp.js'))
const { sanitizeClientCreatedAt, resolveClientCreatedAt, CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS } = lib

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const NOW = Date.parse('2026-08-31T10:00:00Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const DAY = 24 * 60 * MINUTE
const at = offsetMs => new Date(NOW + offsetMs).toISOString()

check('a valid ISO stamp inside the window normalizes to CURRENT_TIMESTAMP shape (space, UTC, no ms)', () => {
  assert.equal(sanitizeClientCreatedAt('2026-08-31T09:55:12.345Z', NOW), '2026-08-31 09:55:12')
})

check('the normalized shape sorts lexicographically with CURRENT_TIMESTAMP rows', () => {
  // "T" (0x54) > " " (0x20): a raw ISO string would pin after every
  // same-day server row. The sanitizer must never emit a "T".
  const out = sanitizeClientCreatedAt('2026-08-31T09:52:00Z', NOW)
  assert.ok(!out.includes('T'))
  assert.ok(out < '2026-08-31 09:53:00' && out > '2026-08-31 09:51:59')
})

check('an offset timestamp converts to UTC', () => {
  // 16:55 at UTC+7 = 09:55 UTC
  assert.equal(sanitizeClientCreatedAt('2026-08-31T16:55:00+07:00', NOW), '2026-08-31 09:55:00')
})

check('30 days ago falls back to the server clock (null)', () => {
  assert.equal(sanitizeClientCreatedAt(at(-30 * DAY), NOW), null)
  assert.equal(sanitizeClientCreatedAt('2026-08-01T09:00:00Z', NOW), null)
})

check('5 minutes ago is kept', () => {
  assert.equal(sanitizeClientCreatedAt(at(-5 * MINUTE), NOW), '2026-08-31 09:55:00')
})

check('1 hour ahead falls back to the server clock (null)', () => {
  assert.equal(sanitizeClientCreatedAt(at(60 * MINUTE), NOW), null)
})

check('the window is [now - 10 min, now + 2 min], edges included', () => {
  assert.equal(sanitizeClientCreatedAt(at(-10 * MINUTE), NOW), '2026-08-31 09:50:00')
  assert.equal(sanitizeClientCreatedAt(at(-10 * MINUTE - SECOND), NOW), null)
  assert.equal(sanitizeClientCreatedAt(at(2 * MINUTE), NOW), '2026-08-31 10:02:00')
  assert.equal(sanitizeClientCreatedAt(at(2 * MINUTE + SECOND), NOW), null)
  assert.equal(sanitizeClientCreatedAt(at(0), NOW), '2026-08-31 10:00:00')
})

check('the default clock is injectable: a stamp is judged against the nowMs it is given', () => {
  assert.equal(sanitizeClientCreatedAt('2026-08-31T09:55:00Z', NOW + 30 * DAY), null)
  assert.equal(sanitizeClientCreatedAt('2026-08-31T09:55:00Z', NOW), '2026-08-31 09:55:00')
  assert.ok(sanitizeClientCreatedAt(new Date(Date.now() - MINUTE).toISOString()), 'without nowMs the live clock is used')
})

check('garbage, empty and non-string values fall back to the server clock', () => {
  for (const bad of ['', '   ', 'not-a-date', 12345, null, undefined, {}, ['2026-08-30'], '0000-00-00', '99999999-01-01']) {
    assert.equal(sanitizeClientCreatedAt(bad, NOW), null, `expected null for ${JSON.stringify(bad)}`)
  }
})

check('the shift-close clock tolerance keeps its own 5-minute constant', () => {
  assert.equal(CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS, 5 * MINUTE)
})

check('resolve: an accepted claim is not adjusted and echoes the stored value', () => {
  assert.deepEqual(resolveClientCreatedAt(at(-3 * MINUTE), { nowMs: NOW }),
    { value: '2026-08-31 09:57:00', adjusted: false, claimed: '2026-08-31 09:57:00', tooOld: false })
})

check('resolve: a rejected claim yields no value and keeps what was claimed for audit', () => {
  assert.deepEqual(resolveClientCreatedAt(at(-30 * DAY), { nowMs: NOW }),
    { value: null, adjusted: true, claimed: '2026-08-01 10:00:00', tooOld: true })
  assert.deepEqual(resolveClientCreatedAt(at(60 * MINUTE), { nowMs: NOW }),
    { value: null, adjusted: true, claimed: '2026-08-31 11:00:00', tooOld: false })
  assert.deepEqual(resolveClientCreatedAt('2026-08-01T16:30:00+07:00', { nowMs: NOW }),
    { value: null, adjusted: true, claimed: '2026-08-01 09:30:00', tooOld: true })
})

check('tooOld is set only for a parsed claim earlier than the window; a future or unparseable claim is never tooOld', () => {
  assert.equal(resolveClientCreatedAt(at(-10 * MINUTE), { nowMs: NOW }).tooOld, false, 'the past edge is inside the window')
  assert.equal(resolveClientCreatedAt(at(-10 * MINUTE - SECOND), { nowMs: NOW }).tooOld, true)
  assert.equal(resolveClientCreatedAt(at(-11 * MINUTE), { nowMs: NOW }).value, null)
  assert.equal(resolveClientCreatedAt(at(2 * MINUTE + SECOND), { nowMs: NOW }).tooOld, false)
  assert.equal(resolveClientCreatedAt(at(60 * MINUTE), { nowMs: NOW }).tooOld, false)
  assert.equal(resolveClientCreatedAt('+275760-09-13T00:00:00.000Z', { nowMs: NOW }).tooOld, false)
  assert.deepEqual(resolveClientCreatedAt('0001-01-01T00:00:00Z', { nowMs: NOW }), { value: null, adjusted: true, claimed: null, tooOld: true })
  for (const bad of ['not-a-date', 12345, {}, ['2026-08-30'], '', '   ', null, undefined]) {
    assert.equal(resolveClientCreatedAt(bad, { nowMs: NOW }).tooOld, false, JSON.stringify(bad))
  }
})

check('resolve: no claim at all is not an adjustment', () => {
  for (const none of [undefined, null, '', '   ']) {
    assert.deepEqual(resolveClientCreatedAt(none, { nowMs: NOW }), { value: null, adjusted: false, claimed: null, tooOld: false }, JSON.stringify(none))
  }
})

check('resolve: an unparseable claim is an adjustment with nothing to echo', () => {
  for (const bad of ['not-a-date', 12345, {}, ['2026-08-30'], '99999999-01-01']) {
    assert.deepEqual(resolveClientCreatedAt(bad, { nowMs: NOW }), { value: null, adjusted: true, claimed: null, tooOld: false }, JSON.stringify(bad))
  }
})

check('a caller that needs an older client time must opt in with maxPastMs; the default never widens', () => {
  const old = at(-30 * DAY)
  assert.equal(resolveClientCreatedAt(old, { nowMs: NOW }).value, null)
  assert.deepEqual(resolveClientCreatedAt(old, { nowMs: NOW, maxPastMs: 60 * DAY }),
    { value: '2026-08-01 10:00:00', adjusted: false, claimed: '2026-08-01 10:00:00', tooOld: false })
  assert.equal(resolveClientCreatedAt(at(-61 * DAY), { nowMs: NOW, maxPastMs: 60 * DAY }).value, null)
  assert.equal(resolveClientCreatedAt(at(-61 * DAY), { nowMs: NOW, maxPastMs: 60 * DAY }).tooOld, true)
  assert.equal(resolveClientCreatedAt(at(10 * MINUTE), { nowMs: NOW, maxPastMs: 60 * DAY }).value, null, 'the future bound does not move with maxPastMs')
  assert.equal(resolveClientCreatedAt('not-a-date', { nowMs: NOW, maxPastMs: 60 * DAY }).value, null)
})

check('wiring: the sales INSERT COALESCEs the sanitized client stamp, updated_at stays server-clock', () => {
  const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(salesRoute, /resolveClientCreatedAt\(body\.created_at\)/)
  assert.match(salesRoute, /const clientCreatedAt = clientTime\.value/)
  assert.match(salesRoute, /COALESCE\(@created_at, CURRENT_TIMESTAMP\), CURRENT_TIMESTAMP\s+WHERE @customer_guard_id/)
})

check('wiring: an old claim is refused after the owner fence, the duplicate lookup and the precision check, before any other work', () => {
  const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
  const create = salesRoute.slice(salesRoute.indexOf("app.post('/', async (c) => {"))
  const at = needle => { const index = create.indexOf(needle); assert.ok(index > 0, 'missing ' + needle); return index }
  const owner = at('offlineSaleOwnerError(body.offline_owner, offlineOwner)')
  const duplicate = at('duplicate: true, offline_owner: offlineOwner')
  const precision = at("code: 'money_precision_review_needed'")
  const refusal = at("code: 'sale_created_at_too_old'")
  const schema = at('await saleMoneySchemaReady(db)')
  assert.ok(owner < duplicate && duplicate < precision && precision < refusal && refusal < schema, 'refusal sits after the owner, duplicate and precision checks and before the schema probe and every write')
  assert.match(create.slice(refusal - 260, refusal), /if \(clientTime\.tooOld\) return c\.json\(/)
  assert.match(create.slice(refusal, refusal + 120), /claimed_created_at: clientTime\.claimed/)
  assert.match(create, /\.\.\.\(clientTime\.adjusted \? \{ claimed_created_at: clientTime\.claimed, received_at: snapshotRecordedAt, created_at_adjusted: true \} : \{\}\)/)
  const message = create.slice(refusal - 200, refusal)
  assert.doesNotMatch(message, /network|abort|timed out|server is offline|server unavailable/i, 'the refusal text must not look like a retryable network error to the till')
})

check('wiring: online-only sales do not mint offline timestamps; manual recovery still sends the original stamp, which the Worker no longer trusts', () => {
  const saleWrite = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'api', 'saleWriteTransport.ts'), 'utf8')
  assert.doesNotMatch(saleWrite, /queueOfflineSale|salePayload\.created_at\s*=/)
  assert.match(saleWrite, /options\.manualRecovery !== true/)
  assert.match(saleWrite, /const payload = \{ \.\.\.\(\(row\.payload as SalePayload\) \|\| \{\}\) \}/)
  assert.match(saleWrite, /await createSaleWithoutWriteDedupe\(payload\)/)
  const ts = require('typescript')
  const ast = ts.createSourceFile('sale.ts', saleWrite, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createSaleWithoutWriteDedupe')
  assert.ok(node, 'actual recovery dispatch function exists')
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let sent
  const dispatch = new Function('apiFetch', `${code}; return createSaleWithoutWriteDedupe`)((method, url, payload) => { sent = { method, url, payload }; return Promise.resolve({}) })
  const original = { client_request_id: 'original-request', created_at: '2026-08-01T09:00:00Z', offline_owner: { actor_id: 71 } }
  dispatch(structuredClone(original))
  assert.deepEqual(sent, { method: 'POST', url: '/api/sales', payload: original }, 'recovery sends the exact historical timestamp, not retry time')
  assert.equal(sanitizeClientCreatedAt(sent.payload.created_at, NOW), null, 'the default window refuses a month-old stamp')
  assert.equal(resolveClientCreatedAt(sent.payload.created_at, { nowMs: NOW, maxPastMs: 60 * DAY }).value, '2026-08-01 09:00:00', 'only an explicit maxPastMs drain keeps it')
})

if (failed > 0) process.exitCode = 1

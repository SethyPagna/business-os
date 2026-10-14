// lib/clientTimestamp.ts: what the Worker does with a client-supplied sale time.
// It never stores one: every sale takes the server clock (offline selling is
// cancelled and no queued sale exists). The claim is only read, so the route can
// refuse a claim older than 10 minutes (tooOld, 409) and record any other claim
// on the creation audit row (adjusted, with what was claimed). A claim without a
// zone is UTC whatever the host's zone. The business-day cases pin the reason:
// a stored claim moved a sale across Phnom Penh midnight. The wiring checks pin
// how routes/sales.ts uses the result.
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
const { resolveClientCreatedAt, CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS, SALE_CREATED_AT_MAX_PAST_MS } = lib

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
const resolve = (raw, nowMs = NOW) => resolveClientCreatedAt(raw, { nowMs })
const phnomPenhDay = ms => new Date(ms + 7 * 60 * MINUTE).toISOString().slice(0, 10)
const claimedMs = out => Date.parse(`${out.claimed.replace(' ', 'T')}Z`)

check('the resolution carries no stored time: a claim never becomes the sale time', () => {
  for (const claim of [at(-3 * MINUTE), at(0), at(MINUTE), at(60 * MINUTE), at(-30 * DAY), 'not-a-date', undefined]) {
    assert.deepEqual(Object.keys(resolve(claim)).sort(), ['adjusted', 'claimed', 'tooOld'], String(claim))
  }
})

check('a claim inside the window is adjusted (the server clock is used) and echoed in the stored shape', () => {
  assert.deepEqual(resolve(at(-3 * MINUTE)), { adjusted: true, claimed: '2026-08-31 09:57:00', tooOld: false })
  assert.deepEqual(resolve('2026-08-31T09:55:12.345Z'), { adjusted: true, claimed: '2026-08-31 09:55:12', tooOld: false })
  assert.deepEqual(resolve('2026-08-31T16:55:00+07:00'), { adjusted: true, claimed: '2026-08-31 09:55:00', tooOld: false })
})

check('a future claim is adjusted, never refused, and echoed', () => {
  assert.deepEqual(resolve(at(60 * MINUTE)), { adjusted: true, claimed: '2026-08-31 11:00:00', tooOld: false })
  assert.deepEqual(resolve(at(2 * MINUTE + SECOND)), { adjusted: true, claimed: '2026-08-31 10:02:01', tooOld: false })
  assert.deepEqual(resolve('+275760-09-13T00:00:00.000Z'), { adjusted: true, claimed: null, tooOld: false })
})

check('a claim older than 10 minutes is tooOld and echoed for the audit row', () => {
  assert.equal(SALE_CREATED_AT_MAX_PAST_MS, 10 * MINUTE)
  assert.deepEqual(resolve(at(-30 * DAY)), { adjusted: true, claimed: '2026-08-01 10:00:00', tooOld: true })
  assert.deepEqual(resolve('2026-08-01T16:30:00+07:00'), { adjusted: true, claimed: '2026-08-01 09:30:00', tooOld: true })
  assert.deepEqual(resolve('0001-01-01T00:00:00Z'), { adjusted: true, claimed: null, tooOld: true })
})

check('tooOld has its edge at exactly 10 minutes: the edge is not too old, one second earlier is', () => {
  assert.equal(resolve(at(-10 * MINUTE)).tooOld, false)
  assert.equal(resolve(at(-10 * MINUTE - SECOND)).tooOld, true)
  assert.equal(resolve(at(-11 * MINUTE)).tooOld, true)
})

check('the default clock is injectable: a stamp is judged against the nowMs it is given', () => {
  assert.equal(resolve('2026-08-31T09:55:00Z', NOW + 30 * DAY).tooOld, true)
  assert.equal(resolve('2026-08-31T09:55:00Z', NOW).tooOld, false)
  assert.equal(resolveClientCreatedAt(new Date(Date.now() - MINUTE).toISOString()).tooOld, false, 'without nowMs the live clock is used')
})

check('no claim at all is not an adjustment', () => {
  for (const none of [undefined, null, '', '   ']) {
    assert.deepEqual(resolve(none), { adjusted: false, claimed: null, tooOld: false }, JSON.stringify(none))
  }
})

check('an unparseable or non-string claim is an adjustment with nothing to echo, never tooOld', () => {
  for (const bad of ['not-a-date', 12345, {}, ['2026-08-30'], '99999999-01-01', '0000-00-00']) {
    assert.deepEqual(resolve(bad), { adjusted: true, claimed: null, tooOld: false }, JSON.stringify(bad))
  }
})

check('the old maxPastMs option no longer widens the window', () => {
  assert.equal(resolveClientCreatedAt(at(-30 * DAY), { nowMs: NOW, maxPastMs: 60 * DAY }).tooOld, true)
  assert.equal(lib.SALE_CREATED_AT_MAX_PAST_CEILING_MS, undefined)
})

check('the shift-close clock tolerance keeps its own 5-minute constant', () => {
  assert.equal(CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS, 5 * MINUTE)
})

check('a claim without a zone is UTC in every host time zone', () => {
  const saved = process.env.TZ
  try {
    for (const zone of ['UTC', 'Asia/Phnom_Penh', 'Asia/Hong_Kong', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone
      for (const claim of ['2026-08-31 09:55:00', '2026-08-31T09:55:00', '2026-08-31T09:55', '2026-08-31 09:55:00.250', '  2026-08-31 09:55:00  ']) {
        assert.deepEqual(resolve(claim), { adjusted: true, claimed: '2026-08-31 09:55:00', tooOld: false }, zone + ' ' + JSON.stringify(claim))
      }
      assert.equal(resolve('2026-08-31 17:00:00').claimed, '2026-08-31 17:00:00', zone + ': a Phnom Penh wall clock is echoed as read, seven hours ahead')
      assert.equal(resolve('2026-08-31 09:30:00').tooOld, true, zone)
      assert.equal(resolve('2026-08-31T16:55:00+07:00').claimed, '2026-08-31 09:55:00', zone + ': an explicit offset is converted')
      assert.equal(resolve('2026-08-31T09:55:00Z').claimed, '2026-08-31 09:55:00', zone + ': an explicit Z is unchanged')
    }
  } finally {
    if (saved === undefined) delete process.env.TZ
    else process.env.TZ = saved
  }
})

check('business day: a backward claim at 00:05 Phnom Penh cannot move the sale to the previous day', () => {
  const now = Date.parse('2026-10-13T17:05:00Z')
  assert.equal(phnomPenhDay(now), '2026-10-14')
  const out = resolve(new Date(now - 10 * MINUTE).toISOString(), now)
  assert.equal(phnomPenhDay(claimedMs(out)), '2026-10-13', 'the claim itself is on the previous day (storing it moved the sale there)')
  assert.equal('value' in out, false, 'nothing is returned to store: the sale keeps the server day')
  assert.equal(out.tooOld, false)
})

check('business day: a forward claim at 23:58:30 Phnom Penh cannot move the sale to the next day', () => {
  const now = Date.parse('2026-10-13T16:58:30Z')
  assert.equal(phnomPenhDay(now), '2026-10-13')
  for (const ahead of [90 * SECOND, 2 * MINUTE]) {
    const out = resolve(new Date(now + ahead).toISOString(), now)
    assert.equal(phnomPenhDay(claimedMs(out)), '2026-10-14', 'the claim itself is on the next day (storing it moved the sale there)')
    assert.equal('value' in out, false, 'nothing is returned to store: the sale keeps the server day')
    assert.equal(out.adjusted, true)
  }
})

check('wiring: the sales INSERT stamps the server clock and binds no client created_at', () => {
  const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(salesRoute, /resolveClientCreatedAt\(body\.created_at\)/)
  assert.doesNotMatch(salesRoute, /clientCreatedAt|clientTime\.value/)
  assert.match(salesRoute, /@creation_snapshot_json, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP\s+WHERE @customer_guard_id/)
  assert.doesNotMatch(salesRoute, /COALESCE\(@created_at, CURRENT_TIMESTAMP\)/)
  assert.doesNotMatch(salesRoute, /^\s+created_at: client/m, 'the sale insert binds no created_at parameter')
  assert.doesNotMatch(salesRoute, /origin: [^,\n]*offline_replay/)
  assert.match(salesRoute, /origin: 'pos'/)
})

check('wiring: an old claim is refused after the owner fence, the duplicate lookup and the precision check, before any other work, and leaves one audit row', () => {
  const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
  const create = salesRoute.slice(salesRoute.indexOf("app.post('/', async (c) => {"))
  const at = needle => { const index = create.indexOf(needle); assert.ok(index > 0, 'missing ' + needle); return index }
  const owner = at('offlineSaleOwnerError(body.offline_owner, offlineOwner)')
  const duplicate = at('duplicate: true, offline_owner: offlineOwner')
  const precision = at("code: 'money_precision_review_needed'")
  const block = at('if (clientTime.tooOld) {')
  const auditCall = at("'sale_refused', 'sale_creation', null")
  const refusal = at("code: 'sale_created_at_too_old'")
  const schema = at('await saleMoneySchemaReady(db)')
  assert.ok(owner < duplicate && duplicate < precision && precision < block && block < auditCall && auditCall < refusal && refusal < schema, 'refusal sits after the owner, duplicate and precision checks and before the schema probe and every write')
  const refusalBlock = create.slice(block, schema)
  assert.match(refusalBlock, /await audit\(c\.env, user\?\.id \?\? null, actorSnapshot\(user\), 'sale_refused'/)
  assert.match(refusalBlock, /client_request_id: clientRequestId \|\| null/)
  assert.match(refusalBlock, /claimed_created_at: clientTime\.claimed, received_at: new Date\(\)\.toISOString\(\)/)
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
  assert.equal(resolve(sent.payload.created_at).tooOld, true, 'the window refuses a month-old stamp, and nothing widens it')
})

if (failed > 0) process.exitCode = 1

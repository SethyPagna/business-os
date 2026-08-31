// Regression test for lib/clientTimestamp.ts -- bounded trust for an
// offline replay's client-supplied sale timestamp (the Part-77 "offline
// sale timestamps recorded at sync time" finding). Behavior + the wiring
// source-locks: the sales INSERT COALESCEs the sanitized value, and the
// offline queue stamps payload.created_at at queue time.
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
const { sanitizeClientCreatedAt, CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS } = require(path.join(tmpDir, 'clientTimestamp.js'))

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

check('a valid ISO stamp normalizes to CURRENT_TIMESTAMP shape (space, UTC, no ms)', () => {
  assert.equal(sanitizeClientCreatedAt('2026-08-30T23:50:12.345Z', NOW), '2026-08-30 23:50:12')
})

check('the normalized shape sorts lexicographically with CURRENT_TIMESTAMP rows', () => {
  // "T" (0x54) > " " (0x20): a raw ISO string would pin after every
  // same-day server row. The sanitizer must never emit a "T".
  const out = sanitizeClientCreatedAt('2026-08-30T01:00:00Z', NOW)
  assert.ok(!out.includes('T'))
  assert.ok(out < '2026-08-30 02:00:00' && out > '2026-08-30 00:59:59')
})

check('an offset timestamp converts to UTC', () => {
  // 23:50 at UTC+7 = 16:50 UTC
  assert.equal(sanitizeClientCreatedAt('2026-08-30T23:50:00+07:00', NOW), '2026-08-30 16:50:00')
})

check('future beyond the skew allowance falls back to the server clock (null)', () => {
  const past = new Date(NOW - 1000).toISOString()
  const nearFuture = new Date(NOW + CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS - 1000).toISOString()
  const farFuture = new Date(NOW + CLIENT_TIMESTAMP_MAX_FUTURE_SKEW_MS + 60_000).toISOString()
  assert.ok(sanitizeClientCreatedAt(past, NOW))
  assert.ok(sanitizeClientCreatedAt(nearFuture, NOW))
  assert.equal(sanitizeClientCreatedAt(farFuture, NOW), null)
})

check('no lower bound: a device offline for days keeps its sale moment', () => {
  assert.equal(sanitizeClientCreatedAt('2026-08-01T09:00:00Z', NOW), '2026-08-01 09:00:00')
})

check('garbage, empty and non-string values fall back to the server clock', () => {
  for (const bad of ['', '   ', 'not-a-date', 12345, null, undefined, {}, ['2026-08-30']]) {
    assert.equal(sanitizeClientCreatedAt(bad, NOW), null, `expected null for ${JSON.stringify(bad)}`)
  }
})

check('wiring: the sales INSERT COALESCEs the sanitized client stamp, updated_at stays server-clock', () => {
  const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(salesRoute, /sanitizeClientCreatedAt\(body\.created_at\)/)
  assert.match(salesRoute, /COALESCE\(@created_at, CURRENT_TIMESTAMP\), CURRENT_TIMESTAMP\)/)
})

check('wiring: the offline queue stamps payload.created_at at queue time', () => {
  const saleWrite = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'api', 'saleWriteTransport.ts'), 'utf8')
  assert.match(saleWrite, /salePayload\.created_at = asText\(salePayload\.created_at\) \|\| now/)
})

if (failed > 0) process.exitCode = 1

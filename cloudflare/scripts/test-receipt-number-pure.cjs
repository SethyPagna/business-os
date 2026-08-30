// Regression test for lib/receiptNumber.ts -- the RCP-/RET-/SRET- id
// generator (user, Aug 30 2026: receipt ids encode the sale's own
// date+time as YYYYMMDD-HHMMSS, 24-hour, Phnom Penh wall clock; that
// compact form is ONLY for identifiers, never for displayed dates).
//
// Run: node scripts/test-receipt-number-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const srcPath = path.join(cloudflareRoot, 'src', 'lib', 'receiptNumber.ts')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-number-'))
const tsPath = path.join(tmpDir, 'receiptNumber.ts')
fs.writeFileSync(tsPath, fs.readFileSync(srcPath, 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { businessDateTimeId, uniqueBusinessDateTimeNumber } = require(path.join(tmpDir, 'receiptNumber.js'))

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
async function checkAsync(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('encodes Phnom Penh wall clock (UTC+7), 24-hour, zero-padded', () => {
  // 07:35:12 UTC = 14:35:12 in Asia/Phnom_Penh
  assert.equal(businessDateTimeId(new Date('2026-08-30T07:35:12Z')), '20260830-143512')
  // single-digit month/day/hour components pad
  assert.equal(businessDateTimeId(new Date('2026-01-05T02:04:09Z')), '20260105-090409')
})

check('UTC evening rolls into the NEXT Phnom Penh calendar day, midnight is 00 not 24', () => {
  assert.equal(businessDateTimeId(new Date('2026-08-30T17:00:00Z')), '20260831-000000')
  // year boundary
  assert.equal(businessDateTimeId(new Date('2026-12-31T17:00:00Z')), '20270101-000000')
})

check('bare call uses the current clock and matches the id shape', () => {
  assert.match(businessDateTimeId(), /^\d{8}-\d{6}$/)
})

;(async () => {
  await checkAsync('no collision keeps the bare timestamp id', async () => {
    const id = await uniqueBusinessDateTimeNumber('RCP', async () => false)
    assert.match(id, /^RCP-\d{8}-\d{6}$/)
  })

  await checkAsync('same-second collisions take -2, -3, ... suffixes', async () => {
    const taken = new Set()
    const first = await uniqueBusinessDateTimeNumber('RCP', async (c) => taken.has(c))
    taken.add(first)
    const second = await uniqueBusinessDateTimeNumber('RCP', async (c) => taken.has(c))
    taken.add(second)
    const third = await uniqueBusinessDateTimeNumber('RCP', async (c) => taken.has(c))
    assert.equal(second, `${first}-2`)
    assert.equal(third, `${first}-3`)
  })

  await checkAsync('a pathological burst falls back to a random suffix instead of looping', async () => {
    const id = await uniqueBusinessDateTimeNumber('RCP', async (c) => !/-[A-Z0-9]{4}$/.test(c))
    assert.match(id, /^RCP-\d{8}-\d{6}-[A-Z0-9]{4}$/)
  })

  await checkAsync('routes actually use the generator (sales RCP, returns RET/SRET), old Date.now ids gone', async () => {
    const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
    const returnsRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'returns.ts'), 'utf8')
    assert.match(salesRoute, /await uniqueBusinessDateTimeNumber\(\s*'RCP',/)
    assert.match(returnsRoute, /await uniqueBusinessDateTimeNumber\(\s*'RET',/)
    assert.match(returnsRoute, /await uniqueBusinessDateTimeNumber\(\s*'SRET',/)
    assert.doesNotMatch(salesRoute, /RCP-\$\{Date\.now\(\)\}/)
    assert.doesNotMatch(returnsRoute, /RET-\$\{Date\.now\(\)\}/)
  })

  if (failed > 0) process.exitCode = 1
})()

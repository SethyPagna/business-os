// Regression test for lib/receiptNumber.ts -- the receipt/return id
// generator (user, Aug 30 2026: receipt ids encode the sale's own
// date+time as YYYYMMDD-HHMMSS, 24-hour, Phnom Penh wall clock; that
// compact form is ONLY for identifiers, never for displayed dates.
// Aug 31 2026: "Receipt no need RCP" -- sales mint the BARE id with an
// EMPTY prefix; returns keep RET-/SRET- so they stay distinguishable).
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
  await checkAsync('an EMPTY prefix mints the bare timestamp id -- no leading dash, no RCP', async () => {
    const id = await uniqueBusinessDateTimeNumber('', async () => [])
    assert.match(id, /^\d{8}-\d{6}$/)
  })

  await checkAsync('a named prefix (returns) still prepends with one dash', async () => {
    const id = await uniqueBusinessDateTimeNumber('RET', async () => [])
    assert.match(id, /^RET-\d{8}-\d{6}$/)
  })

  // J7 (W3 Slice A): the mint reads which of its candidates are taken in ONE call; it no longer probes one candidate at a time.
  const takenIn = (taken) => async (candidates) => candidates.filter((c) => taken.has(c))

  await checkAsync('same-second collisions take -2, -3, ... suffixes (bare id too)', async () => {
    const taken = new Set()
    const first = await uniqueBusinessDateTimeNumber('', takenIn(taken))
    taken.add(first)
    const second = await uniqueBusinessDateTimeNumber('', takenIn(taken))
    taken.add(second)
    const third = await uniqueBusinessDateTimeNumber('', takenIn(taken))
    assert.equal(second, `${first}-2`)
    assert.equal(third, `${first}-3`)
  })

  await checkAsync('a pathological burst falls back to a random suffix instead of looping', async () => {
    const id = await uniqueBusinessDateTimeNumber('', async (candidates) => candidates.filter((c) => !/-[A-Z0-9]{4}$/.test(c)))
    assert.match(id, /^\d{8}-\d{6}-[A-Z0-9]{4}$/)
  })

  // The probe loop this replaced, kept here as the oracle: probe base, base-2 ... base-10 one at a time, then a random suffix.
  async function oldProbe(prefix, exists, moment) {
    const stamp = businessDateTimeId(moment)
    const base = prefix ? `${prefix}-${stamp}` : stamp
    let candidate = base
    for (let n = 2; await exists(candidate); n++) {
      if (n > 10) return `${base}-RANDOM`
      candidate = `${base}-${n}`
    }
    return candidate
  }
  await checkAsync('J7: ONE read of ten ordered candidates, and the same number as the old probe order for 0..11 taken (leading, gapped and full sets)', async () => {
    const moment = new Date('2026-09-27T05:33:00Z')
    const stamp = businessDateTimeId(moment)
    for (const prefix of ['', 'RET', 'SRET']) {
      const base = prefix ? `${prefix}-${stamp}` : stamp
      const ladder = [base, ...Array.from({ length: 9 }, (_, i) => `${base}-${i + 2}`)]
      const sets = []
      for (let taken = 0; taken <= 11; taken++) sets.push(new Set(ladder.slice(0, taken)))          // leading run of 0..11 taken
      sets.push(new Set([ladder[1], ladder[2]]), new Set([ladder[0], ladder[2], ladder[4]]))      // gapped: the first free one wins
      sets.push(new Set([`${base}-11`, `${base}-ABCD`]))                                         // numbers outside the ladder do not count
      for (const taken of sets) {
        let reads = 0, seen = null
        const got = await uniqueBusinessDateTimeNumber(prefix, async (candidates) => { reads += 1; seen = candidates; return candidates.filter((c) => taken.has(c)) }, moment)
        assert.equal(reads, 1, 'one read, however many candidates are taken')
        assert.deepEqual(seen, ladder, 'the ten candidates in probe order')
        const want = await oldProbe(prefix, async (c) => taken.has(c), moment)
        if (want.endsWith('-RANDOM')) assert.match(got, new RegExp(`^${base}-[A-Z0-9]{4}$`), 'ladder full: the same random-suffix fallback')
        else assert.equal(got, want, `prefix "${prefix}" taken [${[...taken].map((c) => c.slice(base.length) || 'base').join(',')}]`)
      }
    }
  })

  await checkAsync('routes actually use the generator (sales BARE id, returns RET/SRET), old Date.now ids gone', async () => {
    const salesRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')
    const returnsRoute = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'returns.ts'), 'utf8')
    assert.match(salesRoute, /await uniqueBusinessDateTimeNumber\(\s*'',/)
    assert.doesNotMatch(salesRoute, /uniqueBusinessDateTimeNumber\(\s*'RCP'/)
    assert.match(returnsRoute, /await uniqueBusinessDateTimeNumber\(\s*'RET',/)
    assert.match(returnsRoute, /await uniqueBusinessDateTimeNumber\(\s*'SRET',/)
    assert.doesNotMatch(salesRoute, /RCP-\$\{Date\.now\(\)\}/)
    assert.doesNotMatch(returnsRoute, /RET-\$\{Date\.now\(\)\}/)
  })

  if (failed > 0) process.exitCode = 1
})()

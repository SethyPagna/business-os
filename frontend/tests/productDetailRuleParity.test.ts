// Guard: the product identity rule must be byte-identical in both packages.
//
// `frontend/` and `cloudflare/` are separate npm projects with no shared
// package, so the rule that decides "are these two rows the same product?"
// physically exists twice. That is exactly how it drifted the first time:
// the backend matched on name+cost+selling+barcode, the frontend compared
// every field minus a seven-item ignore list, and a third copy in
// productIdentity.ts compared columns that were always zero. Three
// implementations, three different answers, no test that could see it.
//
// One copy is authoritative (cloudflare/src/lib/productDetailRule.ts); the
// other is a verbatim duplicate. This test fails the moment they differ, so
// a change to one is forced to be a change to both. The module is
// deliberately dependency-free precisely so a plain copy is valid.
//
// If this fails: copy cloudflare/src/lib/productDetailRule.ts over
// frontend/src/utils/productDetailRule.ts (or vice versa, whichever holds
// the intended change) -- do not "fix" it by editing one side to merely
// behave the same.
//
// Run: node tests/productDetailRuleParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

const backendPath = path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productDetailRule.ts')
const frontendPath = path.join(repoRoot, 'frontend', 'src', 'utils', 'productDetailRule.ts')

// Line endings only -- this repo is checked out on Windows with autocrlf, so
// one copy can legitimately be CRLF and the other LF. Nothing else is
// normalized away: whitespace and comments must match too, since the
// comments are where the rule is actually explained.
const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd()

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  console.log('PASS', name)
  passed++
}

check('both packages exist', () => {
  assert.ok(fs.existsSync(backendPath), `missing ${backendPath}`)
  assert.ok(fs.existsSync(frontendPath), `missing ${frontendPath}`)
})

check('the product identity rule is identical in cloudflare/ and frontend/', () => {
  assert.equal(
    read(frontendPath), read(backendPath),
    'productDetailRule.ts has diverged between the two packages -- copy the intended version over the other',
  )
})

check('the rule module stays dependency-free, so copying it remains valid', () => {
  const text = read(backendPath)
  assert.ok(!/^\s*import\s/m.test(text), 'productDetailRule.ts must not import anything -- it is duplicated verbatim across packages')
})

check('the rule still says the barcode is the only detail, and says how cost and price merge', () => {
  const text = read(backendPath)
  // Guards the decisions most likely to be silently reverted. Read the
  // signature's own body, not the whole file: cost, selling price and
  // special price all still appear in the module -- they are merged there
  // rather than split on, which is exactly the distinction being pinned.
  const sigBody = text.slice(text.indexOf('export function productDetailSignature'), text.indexOf('export function productIdentitySignature'))
  assert.ok(/barcode/.test(sigBody), 'barcode must be part of the detail signature')
  assert.ok(!/cost_price/.test(sigBody), 'cost must NOT be part of the detail signature -- since Sep 4 2026 differing costs merge')
  assert.ok(!/selling_price/.test(sigBody), 'selling price must NOT be part of the detail signature')
  assert.ok(!/special_price/.test(sigBody), 'special price must NOT be part of the detail signature')
  assert.ok(/export function resolveMergedCost/.test(text), 'cost must still be reconciled on merge -- by averaging, in resolveMergedCost')
  assert.ok(/Math\.ceil/.test(text), 'the averaged cost must round UP, never down: rounding down overstates profit')
  assert.ok(/value > best/.test(text), 'merged pricing must resolve to the HIGHEST value')
})

console.log(`\n${passed} check(s) passed.`)

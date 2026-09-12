// Guard: the rule is identical except the native-Node frontend import suffix.
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
// limited to the byte-identical portable money kernel in each package.
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
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as frontendRule from '../src/utils/productDetailRule.ts'

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
    read(frontendPath).replace("from './moneyPrecision.ts'", "from './moneyPrecision'"), read(backendPath),
    'productDetailRule.ts has diverged between the two packages -- copy the intended version over the other',
  )
})

check('only the exact portable money dependency is permitted', () => {
  assert.deepEqual(read(backendPath).match(/^import .+$/gm), ["import { roundMoney4, meanMoney4 } from './moneyPrecision'"])
  assert.deepEqual(read(frontendPath).match(/^import .+$/gm), ["import { roundMoney4, meanMoney4 } from './moneyPrecision.ts'"])
  assert.equal(read(path.join(repoRoot, 'frontend/src/utils/moneyPrecision.ts')), read(path.join(repoRoot, 'cloudflare/src/lib/moneyPrecision.ts')))
})

check('the rule still says the barcode is the only detail, and says how cost and price merge', () => {
  const text = read(backendPath)
  // Guards the decisions most likely to be silently reverted. Read the
  // signature's own body, not the whole file: cost, selling price and
  // wholesale price all still appear in the module -- they are merged there
  // rather than split on, which is exactly the distinction being pinned.
  const sigBody = text.slice(text.indexOf('export function productDetailSignature'), text.indexOf('export function productIdentitySignature'))
  assert.ok(/barcode/.test(sigBody), 'barcode must be part of the detail signature')
  assert.ok(!/cost_price/.test(sigBody), 'cost must NOT be part of the detail signature -- since Sep 4 2026 differing costs merge')
  assert.ok(!/selling_price/.test(sigBody), 'selling price must NOT be part of the detail signature')
  assert.ok(!/wholesale_price/.test(sigBody), 'the wholesale price must NOT be part of the detail signature')
  assert.ok(!/special_price/.test(sigBody), 'nor the retired special_price_* pair it replaced')
  assert.ok(/export function resolveMergedCost/.test(text), 'cost must still be reconciled on merge -- by averaging, in resolveMergedCost')
  assert.ok(/merged\[field\] = meanMoney4\(values\)/.test(text), 'new means must use exact nearest4, not upward bias')
  assert.ok(/value > best/.test(text), 'merged pricing must resolve to the HIGHEST value')
  // S4-32: the merge rule must MERGE the live wholesale tier, not the zeroed
  // ballast migration 0111 left behind. Pointing this list back at
  // special_price_* resolves max(0, 0) and drops the tier silently.
  assert.ok(/'wholesale_price_usd', 'wholesale_price_khr'/.test(text),
    "resolveMergedPricing must merge wholesale_price_usd/khr -- special_price_* was zeroed by migration 0111")
  assert.ok(!/special_price_usd\?/.test(text),
    'MergeablePricing must not declare the retired special_price_* fields')
})

check('both actual rule modules compute nearest4 over raw distinct costs', () => {
  const require = createRequire(import.meta.url)
  const mod = { exports: {} as typeof frontendRule }
  const output = ts.transpileModule(read(backendPath), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('module', 'exports', 'require', output)(mod, mod.exports, (name: string) => {
    assert.equal(name, './moneyPrecision', 'no unreviewed backend dependency')
    return require(path.join(repoRoot, 'cloudflare/src/lib/moneyPrecision.ts'))
  })
  for (const rule of [frontendRule, mod.exports]) {
    assert.equal(rule.roundCost4(1.00001), 1)
    assert.equal(rule.roundCost4(1.00005), 1.0001)
    assert.equal(rule.roundCost4(-1.00005), -1.0001)
    assert.equal(rule.resolveMergedCost([1, 1.0001, 1.0003].map(cost_price_usd => ({ cost_price_usd }))).cost_price_usd, 1.0001)
    assert.equal(rule.resolveMergedCost([1.00001, 1.00004, 1.00009].map(cost_price_usd => ({ cost_price_usd }))).cost_price_usd, 1, 'distinct before rounding; no pre-rounded duplicate collapse')
    assert.equal(rule.resolveMergedCost([{ cost_price_usd: null }]).cost_price_usd, undefined)
    assert.equal(rule.resolveMergedCost([{ cost_price_usd: 0 }]).cost_price_usd, 0)
  }
})

console.log(`\n${passed} check(s) passed.`)

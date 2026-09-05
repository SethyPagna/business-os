// S4-2: the admin-only, lock-gated "Don't touch stock" option on a sale
// status change, and the confirmation dialog that carries it.
//
// WHY THIS IS PINNED. On 2026-09-03 a bulk status flip of 7 migrated
// old-system sales (awaiting_payment -> completed) deducted 9 units that the
// 2026-09-02 physical recount had ALREADY accounted for. Two things made it
// possible: the bulk buttons applied instantly with no confirmation at all,
// and there was no way to say "this sale's stock is already counted".
//
// The user (2026-09-03): "for the sales status in particular when
// save/update or actions will ask confirmation and in the confirmation also
// option to Don't Touch Stock but with a lock, needs unlock.... for other
// users this doesn't appear and for the returns no need as it is latest."
//
// Run: node tests/saleStatusSkipStock.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (...parts: string[]): string => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const sales = read('src', 'components', 'sales', 'Sales.tsx')
const modal = read('src', 'components', 'sales', 'SaleStatusConfirmModal.tsx')

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('a single status change goes through the dialog, not window.confirm', () => {
  assert.ok(
    !/window\.confirm\([^)]*confirm_sale_status_change/.test(sales),
    'the status change must no longer be a bare window.confirm -- it has to show before/after and the lock',
  )
  assert.match(sales, /if \(recordHistory && !extra && !confirmed\) \{[\s\S]{0,600}setStatusPrompt\(\{\s*\n\s*mode: 'single'/,
    'the first entry opens the confirmation and returns; the dialog calls back with confirmed=true')
  assert.match(sales, /<SaleStatusConfirmModal/, 'Sales.tsx renders the confirmation modal')
})

runTest('a BULK status change also confirms first -- the shape of the Sep-3 incident', () => {
  assert.match(sales, /if \(!confirmed && !extra\) \{[\s\S]{0,900}setStatusPrompt\(\{\s*\n\s*mode: 'bulk'/,
    'handleBulkStatusUpdate must open the same confirmation before applying anything')
  assert.match(sales, /handleBulkStatusUpdate = async \(nextStatus: string, extra[^)]*, confirmed = false\)/,
    'the bulk handler takes the confirmed flag the dialog sets')
})

runTest('the confirmation states the old status, the new one, and the stock effect', () => {
  for (const key of ['sale_status_confirm_from', 'sale_status_confirm_to', 'sale_status_confirm_stock_moves', 'sale_status_confirm_stock_frozen']) {
    assert.ok(modal.includes(key), `the dialog must render ${key}`)
  }
  assert.match(sales, /fromLabel: getStatusLabel\(previousStatus, t\)/, 'the OLD status is passed in, not just the new one')
  assert.match(sales, /toLabel=\{getStatusLabel\(/, 'the NEW status is shown as its shopper-facing label')
})

runTest('the skip option is admin-only and behind an explicit unlock', () => {
  assert.match(sales, /canSkipStock=\{isAdmin\}/, 'the option renders only for an administrator')
  assert.match(modal, /\{canSkipStock && !alreadySkipped \?/, 'a non-admin never sees the control at all')
  assert.match(modal, /const \[unlocked, setUnlocked\] = useState\(false\)/, 'it starts locked')
  assert.match(modal, /\{unlocked \?[\s\S]{0,900}checked=\{skipStock\}/, 'the toggle only exists after the unlock')
  assert.match(modal, /setUnlocked\(false\)\s*\n\s*setSkipStock\(false\)/, 'a new target resets both the lock and the toggle')
})

runTest('skip_stock is only sent when the admin actually ticked it', () => {
  assert.match(sales, /const skipExtra = skipStock \? \{ skip_stock: true \} : null/,
    'the flag leaves the client only on an explicit tick -- never by default')
  assert.ok(!/skip_stock: true/.test(sales.replace('const skipExtra = skipStock ? { skip_stock: true } : null', '')),
    'skip_stock must be set in exactly one place')
})

runTest('an already-skipped sale is stated as such instead of promising a deduction', () => {
  assert.match(sales, /alreadySkipped: Number\(previousSale\?\.stock_skipped \|\| 0\) === 1/, 'the single dialog reads the persisted flag')
  assert.match(sales, /alreadySkipped: selectedSales\.length > 0 && selectedSales\.every\(\(sale\) => Number\(sale\.stock_skipped \|\| 0\) === 1\)/,
    'a bulk batch counts as skipped only when EVERY selected sale is')
  assert.match(modal, /sale_status_already_skipped/, 'the dialog says so')
})

runTest('returns are untouched -- explicitly out of scope', () => {
  const returnsFiles = fs.readdirSync(path.join(ROOT, 'src', 'components', 'returns'))
  for (const file of returnsFiles) {
    if (!/\.tsx?$/.test(file)) continue
    const source = read('src', 'components', 'returns', file)
    assert.ok(!source.includes('skip_stock'), `returns/${file} must not carry the skip flag ("for the returns no need as it is latest")`)
  }
})

runTest('both language packs carry every string the dialog renders', () => {
  type Pack = Record<string, unknown>
  const flatten = (input: unknown, target: Record<string, string> = {}): Record<string, string> => {
    if (!input || typeof input !== 'object') return target
    for (const [key, value] of Object.entries(input as Pack)) {
      if (value == null || Array.isArray(value)) continue
      if (typeof value === 'object') { flatten(value, target); continue }
      target[key] = String(value)
    }
    return target
  }
  const en = flatten(JSON.parse(read('src', 'lang', 'en.json')))
  const km = flatten(JSON.parse(read('src', 'lang', 'km.json')))
  const keys = [
    'sale_status_confirm_title', 'sale_status_confirm_from', 'sale_status_confirm_to',
    'sale_status_confirm_count', 'sale_status_confirm_mixed',
    'sale_status_confirm_stock_moves', 'sale_status_confirm_stock_frozen',
    'sale_status_already_skipped', 'dont_touch_stock', 'dont_touch_stock_locked',
    'dont_touch_stock_hint', 'dont_touch_stock_warning', 'admin_only', 'unlock',
  ]
  for (const key of keys) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `km.json "${key}" is still the English string`)
  }
  assert.ok(en.sale_status_confirm_count.includes('{n}') && km.sale_status_confirm_count.includes('{n}'), 'the count string keeps its placeholder in both packs')
})

if (failed) {
  console.error(`${failed} sale status skip-stock test(s) failed`)
  process.exit(1)
}
console.log('All sale status skip-stock frontend tests passed')
// Keep related integration suites reachable without exceeding Windows' command-line limit.
import './saleBulkStatus.test.ts'
import './membershipDefaults20260905.test.cjs'

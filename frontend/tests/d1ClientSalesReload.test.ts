// D1 client lane (C3): the Sales page merges its refresh signals into one reload, cancels a superseded stats read and
// keeps the list and the header totals on one search value.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  SALES_PAGE_SYNC_SOURCE,
  createSalesReloadCoalescer,
  type SalesReloadPlan,
} from '../src/components/sales/salesReloadCoalescer.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')

type Test = () => void | Promise<void>
let failed = 0
async function test(name: string, fn: Test): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

function fakeClock() {
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    host: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => { timers.set(++id, { at: now + ms, fn }); return id },
      clearTimeout: (timer: number) => { timers.delete(timer) },
    },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); now = due[1].at; due[1].fn()
      }
      now = end
    },
  }
}
const EIGHT = ['sales', 'returns', 'fees', 'customers', 'deliveryContacts', 'users', 'products', 'settings']

function salesRig() {
  const clock = fakeClock()
  const plans: Array<{ at: number; plan: SalesReloadPlan }> = []
  const coalescer = createSalesReloadCoalescer(clock.host, (plan) => plans.push({ at: clock.host.now(), plan }), 150, 1_500)
  return {
    note: (channel: string, source: string | null = null) => coalescer.note({ channel, source }),
    advance: (ms: number) => clock.advance(ms),
    plans,
  }
}

await test('eight signals in one burst reload the list, totals and strip once (base: eight times)', () => {
  const rig = salesRig()
  for (const channel of EIGHT) rig.note(channel)
  rig.advance(400)
  assert.equal(rig.plans.length, 1, 'base reloaded list+stats+strip once per event: 8')
  assert.deepEqual(rig.plans[0].plan, { rowsAndTotals: true, strip: true, userOptions: true })
})

await test('trailing edge: the reload starts after the last event, never before it', () => {
  const rig = salesRig()
  rig.note('sales'); rig.advance(100)
  rig.note('fees'); rig.advance(100)
  rig.note('customers'); rig.advance(100)
  assert.equal(rig.plans.length, 0, 'events 100 ms apart keep pushing the reload back')
  rig.advance(100)
  assert.equal(rig.plans.length, 1)
  assert.equal(rig.plans[0].at, 350, '150 ms after the last event at 200')
  rig.note('sales'); rig.advance(200)
  assert.equal(rig.plans.length, 2, 'an event after a reload gets its own reload')
})

await test('a steady stream still reloads once per maximum wait, not never', () => {
  const rig = salesRig()
  for (let i = 0; i < 40; i++) { rig.note('sales'); rig.advance(100) }
  assert.ok(rig.plans.length >= 2 && rig.plans.length <= 4, `reloads: ${rig.plans.length}`)
})

await test("this page's own echoes reload only the strip; any other event brings the list back", () => {
  const own = salesRig()
  for (const channel of ['inventory', 'products', 'sales', 'returns']) own.note(channel, SALES_PAGE_SYNC_SOURCE)
  own.advance(300)
  assert.deepEqual(own.plans.map((p) => p.plan), [{ rowsAndTotals: false, strip: true, userOptions: false }])
  const mixed = salesRig()
  mixed.note('sales', SALES_PAGE_SYNC_SOURCE); mixed.note('returns', null)
  mixed.advance(300)
  assert.deepEqual(mixed.plans.map((p) => p.plan.rowsAndTotals), [true], 'a return from another device never hides behind an own echo')
})

await test('channels the page does not show never reload it', () => {
  const rig = salesRig()
  rig.note('inventory'); rig.note('dashboard'); rig.advance(400)
  assert.equal(rig.plans.length, 0)
})

await test('own writes still reload the list and totals at once, ahead of any event', () => {
  const sales = read('../src/components/sales/Sales.tsx')
  const lines = sales.split('\n')
  const sites = lines.map((line, i) => (line.includes("emitOwnSalesSync('sales')") ? i : -1)).filter((i) => i >= 0)
  assert.ok(sites.length >= 6, `own sale/payment/return/status sites: ${sites.length}`)
  for (const index of sites) {
    const before = lines.slice(Math.max(0, index - 14), index).join('\n')
    assert.match(before, /void loadSalesStats\(\)/, `own write at line ${index + 1} reloads the totals directly, not through the sync event`)
  }
})

await test('the stats read is cancelled when superseded and searches share one minimum-length rule with the list', () => {
  const sales = read('../src/components/sales/Sales.tsx')
  assert.match(sales, /salesStatsAbortRef\.current\?\.abort\(\)\n\s+const controller = new AbortController\(\)/)
  assert.match(sales, /fetchSalesStats\(salesStatsParams, \{ signal: controller\.signal \}\)/)
  assert.match(sales, /effectiveSalesSearch \? \{ search: effectiveSalesSearch \}/, 'list and totals both take their search from the same value')
  assert.doesNotMatch(sales, /debouncedSearch \? \{ search: debouncedSearch \}/)
  assert.doesNotMatch(sales, /includes\(syncChannel\.channel\)\) \{\n\s+if \(syncChannel\.channel === 'users'\)/, 'the per-event reload of all three reads is gone')
})

if (failed) { console.error(`${failed} failed`); process.exit(1) }
console.log('PASS d1 client sales reload')

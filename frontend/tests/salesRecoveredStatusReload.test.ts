// B1 (REVIEW-wave1-B): a status change whose answer was lost and is later PROVED by recovery patched the row in place and
// told the page about it with a page-tagged 'sales' echo. The coalescer reloads only the strip for a page-tagged burst, so
// the list was never re-filtered: a sale recovered into Cancelled stayed in a "Completed" list until the next reload.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SALES_PAGE_SYNC_SOURCE, createSalesReloadCoalescer, type SalesReloadPlan } from '../src/components/sales/salesReloadCoalescer.ts'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

test('the coalescer never re-reads the list for the page\'s own echoes, so recovery has to reload it itself', () => {
  let now = 0
  const timers: Array<(() => void) | null> = []
  const plans: SalesReloadPlan[] = []
  const coalescer = createSalesReloadCoalescer(
    { now: () => now, setTimeout: (fn) => { timers[0] = fn; return 1 }, clearTimeout: () => { timers[0] = null } },
    (plan) => plans.push(plan), 10, 100,
  )
  coalescer.note({ channel: 'sales', source: SALES_PAGE_SYNC_SOURCE })
  coalescer.note({ channel: 'inventory', source: SALES_PAGE_SYNC_SOURCE })
  now += 10
  timers[0]?.()
  assert.deepEqual(plans, [{ rowsAndTotals: false, strip: true, userOptions: false }])
})

// Sales.tsx (a 3,000-line page) cannot be mounted in the test harness, so the recovered branch is checked as source: the
// text is compared with every run of whitespace removed, so reformatting or re-wrapping a line cannot break it, only
// removing the reload can.
const squash = (text: string): string => text.replace(/s+/g, '')

test('the recovered branch of reconcilePendingStatus reloads the list (loadSales(true)) before announcing', () => {
  const source = squash(read('../src/components/sales/Sales.tsx'))
  const start = source.indexOf("if(result.state==='recovered'){")
  assert.ok(start > 0, 'the recovered branch exists')
  const block = source.slice(start, source.indexOf("emitOwnSalesSync('inventory')", start))
  assert.ok(block.includes('voidloadSales(true)'), 'the recovered branch calls loadSales(true)')
  assert.ok(block.indexOf('loadSales(true)') < block.indexOf("emitOwnSalesSync('sales')"), 'the reload comes before the announcement')
  assert.ok(source.includes('},[savePendingDirectStatus,loadSales,loadSalesStats,actionHistory])'), 'the callback depends on loadSales')
})

if (failed > 0) process.exitCode = 1

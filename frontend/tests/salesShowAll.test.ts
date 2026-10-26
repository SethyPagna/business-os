// S4R6-2#422: the Sales page's "Show all" reads every matching sale in bounded pages, and FX-forward-only#264 /
// Currency-forward-only#388: a neutral "new rate applies to new sales only" line sits beside the exchange-rate editor.
//
// Run: node tests/salesShowAll.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadAllSalesPages, SHOW_ALL_MAX_PAGES, SHOW_ALL_PAGE_SIZE } from '../src/utils/salesShowAll.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// A fake endpoint that serves `total` rows by offset, like GET /api/sales?page=&limit=.
function endpoint(total: number, onCall?: (page: number, limit: number) => void) {
  const calls: Array<[number, number]> = []
  return {
    calls,
    fetchPage: async (page: number, limit: number) => {
      calls.push([page, limit]); onCall?.(page, limit)
      const start = (page - 1) * limit
      return Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => ({ id: start + i + 1 }))
    },
  }
}

await test('Show all loads every row across pages, in page-sized requests', async () => {
  const api = endpoint(250)
  const result = await loadAllSalesPages(api.fetchPage)
  assert.equal(result.rows.length, 250)
  assert.equal(result.truncated, false)
  assert.deepEqual(api.calls, [[1, SHOW_ALL_PAGE_SIZE], [2, SHOW_ALL_PAGE_SIZE], [3, SHOW_ALL_PAGE_SIZE]])
  assert.ok(SHOW_ALL_PAGE_SIZE <= 200, 'never above the Worker list cap')
})

await test('an exact multiple of the page size ends on one empty page, a short list on one request', async () => {
  const exact = endpoint(200); assert.equal((await loadAllSalesPages(exact.fetchPage)).rows.length, 200); assert.equal(exact.calls.length, 3)
  const few = endpoint(7); assert.equal((await loadAllSalesPages(few.fetchPage)).rows.length, 7); assert.equal(few.calls.length, 1)
  const none = endpoint(0); assert.deepEqual((await loadAllSalesPages(none.fetchPage)).rows, [])
})

await test('the walk is bounded: a list longer than the cap stops and says it is truncated', async () => {
  const api = endpoint(10_000_000)
  const result = await loadAllSalesPages(api.fetchPage)
  assert.equal(api.calls.length, SHOW_ALL_MAX_PAGES)
  assert.equal(result.rows.length, SHOW_ALL_MAX_PAGES * SHOW_ALL_PAGE_SIZE)
  assert.equal(result.truncated, true)
})

await test('a row repeated by offset drift is kept once', async () => {
  let call = 0
  const result = await loadAllSalesPages(async () => {
    call += 1
    return call === 1 ? [{ id: 3 }, { id: 2 }] : call === 2 ? [{ id: 2 }, { id: 1 }] : []
  }, { pageSize: 2 })
  assert.deepEqual(result.rows.map((row) => row.id), [3, 2, 1])
})

await test('a cancelled walk stops before the next request', async () => {
  let cancelled = false
  const api = endpoint(1000, (page) => { if (page === 2) cancelled = true })
  const result = await loadAllSalesPages(api.fetchPage, { isCancelled: () => cancelled })
  assert.equal(api.calls.length, 2)
  assert.equal(result.truncated, false)
})

await test('a failing page rejects instead of returning a partial list as complete', async () => {
  let call = 0
  await assert.rejects(loadAllSalesPages(async () => { call += 1; if (call === 2) throw new Error('page failed'); return Array.from({ length: 100 }, (_, i) => ({ id: call * 1000 + i })) }), /page failed/)
})

await test('the Sales page wires Show all through the paged helper with a translated icon-only toggle', () => {
  const sales = read('../src/components/sales/Sales.tsx')
  assert.match(sales, /loadAllSalesPages<SaleRecord>\(/)
  assert.match(sales, /if \(showAllSales\) \{[\s\S]*?\{ \.\.\.filters, page, limit \}/, 'show-all requests carry the same filters, one bounded page at a time')
  assert.match(sales, /data-testid="sales-show-all-toggle"[\s\S]*?aria-pressed=\{showAllSales\}[\s\S]*?title=\{showAllSales \? translateOr\('sales_show_pages'/)
  assert.match(sales, /pageSize=\{pagerPageSize\}/); assert.match(sales, /pageSize=\{pagerPageSize\} totalItems/)
  assert.match(sales, /showAllSales \? Math\.max\(salesPageSize, totalSalesCount, allVisibleSales\.length\)/)
  assert.match(sales, /sales-show-all-truncated/)
  assert.ok(!/limit: *(Infinity|99999|[0-9]{4,})/.test(sales), 'no unbounded list request')
})

await test('exchange-rate note: the line sits under the rate editor, neutral, no behaviour attached', () => {
  const settings = read('../src/components/utils-settings/Settings.tsx')
  const rate = settings.indexOf("field('exchange_rate', t('exchange_rate')")
  const note = settings.indexOf("t('exchange_rate_forward_only_note')")
  const tax = settings.indexOf("t('tax_enabled') ||")
  assert.ok(rate > 0 && note > rate && note < tax, 'rendered after the rate fields, in the same section')
  assert.match(settings, /<p data-testid="exchange-rate-forward-only-note"[^>]*>\{t\('exchange_rate_forward_only_note'\)\}<\/p>/)
})

await test('every new string exists in both packs, Khmer is Khmer', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['exchange_rate_forward_only_note', 'sales_show_all', 'sales_show_pages', 'sales_show_all_truncated']) {
    assert.ok(en[key] && km[key] && en[key] !== km[key] && /[ក-៿]/.test(km[key]), key)
  }
  assert.match(en.exchange_rate_forward_only_note, /new sales only/i)
})

if (failed) { console.error(`${failed} failure(s)`); process.exit(1) }
console.log('sales show-all and forward-only note tests passed')

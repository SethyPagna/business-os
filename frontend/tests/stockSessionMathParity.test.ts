// UI-STOCK 5.3-5.5 / 11.4: the stock session's money rules run twice -- in the
// browser (the Payment step's items total, auto-adjust and review estimate)
// and in the Worker (the commit route's supplier-total check and the receipt
// kernels' effective cost). This test holds the two copies to one behaviour:
// the shared code must be the same text, and every case below must give the
// same answer from both.
//
// Run: node tests/stockSessionMathParity.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const frontendSource = readFileSync(new URL('../src/utils/stockSessionMath.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('../../cloudflare/src/lib/stockSessionMath.ts', import.meta.url), 'utf8')
const workerMoneySource = readFileSync(new URL('../../cloudflare/src/lib/moneyPrecision.ts', import.meta.url), 'utf8')
const BROWSER_ONLY = '// ---- browser only below this line ----'

// ------------------------------------------------------------ 1. same text
const code = (source: string) => source
  .replace(/\r\n/g, '\n')
  .replace(/\/\*\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line) && !/^import /.test(line) && line.trim())
  .join('\n')
assert.ok(frontendSource.includes(BROWSER_ONLY), 'the browser-only estimate sits below the marker')
assert.equal(code(frontendSource.slice(0, frontendSource.indexOf(BROWSER_ONLY))), code(workerSource), 'the shared functions are the same code in both packages')
assert.doesNotMatch(workerSource, /estimateCatalogCostAfter/, 'the estimate is browser only; the server recompute is authoritative')
console.log('PASS the browser and Worker copies are the same code')

// ------------------------------------------------------------ 2. same answers
const browser = await import('../src/utils/stockSessionMath.ts')
const load = (source: string, deps: Record<string, unknown>) => {
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', out)((name: string) => deps[name], mod, mod.exports)
  return mod.exports
}
const worker = load(workerSource, { './moneyPrecision': load(workerMoneySource, {}) })

const both = (label: string, run: (impl: any) => unknown, expected: unknown) => {
  const fromBrowser = run(browser)
  const fromWorker = run(worker)
  assert.deepEqual(fromBrowser, fromWorker, `${label}: browser and Worker agree`)
  assert.deepEqual(fromBrowser, expected, label)
}
const decimals = (value: number) => (String(value).split('.')[1] || '').length

// Free units spread the paid money over every unit (owner Q2: yes).
both('10 paid at $3.50 + 2 free = 12 units at $2.9167', (m) => m.effectiveUnitCost(10, 2, 3.5), 2.9167)
both('no free units keep the typed cost, at 4 dp', (m) => m.effectiveUnitCost(4, 0, 1.23456), 1.2346)
both('a fully free line (qty 0 + free) costs 0', (m) => m.effectiveUnitCost(0, 5, 3.5), 0)
both('free units change the lot cost, not the money', (m) => m.paidItemsTotal([{ qty: 10, unitCost: 2.9167 }]), 29.167)

// The supplier is paid for the paid quantity only.
both('items total = sum of qty x cost', (m) => m.paidItemsTotal([{ qty: 10, unitCost: 3.5 }, { qty: 6, unitCost: 12.09 }, { qty: 0, unitCost: 9 }]), 107.54)

// Half a cent either way is a match; more is not.
both('exactly half a cent over matches', (m) => m.supplierTotalMatches(100, 100.005), true)
both('half a cent under matches', (m) => m.supplierTotalMatches(100, 99.995), true)
both('0.006 over does not match', (m) => m.supplierTotalMatches(100, 100.006), false)

// Auto-adjust: every cost 4 dp, the total within the tolerance.
const invoice = [{ qty: 10, unitCost: 3.5 }, { qty: 6, unitCost: 12.09 }]
for (const paid of [107.09, 110, 100.01, 107.54]) {
  const fromBrowser = browser.matchCostsToPaid(invoice, paid)
  assert.deepEqual(fromBrowser, worker.matchCostsToPaid(invoice, paid), `paid ${paid}: browser and Worker agree`)
  assert.ok(fromBrowser.ok)
  const adjusted = invoice.map((line, index) => ({ qty: line.qty, unitCost: fromBrowser.costs[index] }))
  assert.ok(browser.supplierTotalMatches(browser.paidItemsTotal(adjusted), paid), `paid ${paid}: the adjusted items total matches (${browser.paidItemsTotal(adjusted)})`)
  for (const cost of fromBrowser.costs) assert.ok(decimals(cost) <= 4, `paid ${paid}: ${cost} has at most 4 decimals`)
}
both('a total already equal to the paid amount changes nothing', (m) => m.matchCostsToPaid(invoice, 107.54), { ok: true, costs: [3.5, 12.09] })
// 1000 units cannot move by less than $0.10 at 4 dp; the one-unit line absorbs the rest.
// Adding the residual to the largest line alone would stay $0.0301 off.
both('the leftover moves on to a line with fewer units', (m) => m.matchCostsToPaid([{ qty: 1000, unitCost: 1.2345 }, { qty: 1, unitCost: 2 }], 1236.57), { ok: true, costs: [1.2346, 1.97] })
both('a declared-free line stays free', (m) => m.matchCostsToPaid([{ qty: 5, unitCost: 0 }, { qty: 2, unitCost: 10 }], 21), { ok: true, costs: [0, 10.5] })
both('nothing to spread a payment over', (m) => m.matchCostsToPaid([{ qty: 3, unitCost: 0 }], 12), { ok: false, code: 'items_total_zero' })
both('a zero payment against priced items: use Free instead', (m) => m.matchCostsToPaid(invoice, 0), { ok: false, code: 'paid_zero' })
console.log('PASS the browser and Worker give the same money answers')

// ------------------------------------------------------------ 3. the review estimate (browser only)
assert.equal(browser.estimateCatalogCostAfter(2, 12, 8, 12.5), 12.4, '2 on hand at $12 + 8 at $12.50 = $12.40 (quantity-weighted, the 25 Sep rule)')
assert.equal(browser.estimateCatalogCostAfter(0, 12, 5, 10), 10, 'nothing on hand: the new lot sets the cost')
assert.equal(browser.estimateCatalogCostAfter(4, 12, 6, 0), 12, 'a $0 (free) lot is not a recorded cost and does not lower the average')
assert.equal(browser.estimateCatalogCostAfter(10, 0, 5, 3), 3, 'an unrecorded current cost takes no part')
assert.equal(browser.estimateCatalogCostAfter(3, 1.0001, 3, 1.0002), 1.0002, 'a tie rounds half up, like the server')
console.log('PASS the review estimate follows the catalog cost rule')

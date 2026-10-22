'use strict'
// 6.0.952 parity: the prices the returns screen DEFAULTS a replacement to (frontend/src/components/returns/helpers/replacementPricing.ts) and the
// floor the Worker holds a caller without the POS price grant to (cloudflare/src/lib/returnReplacementPrice.ts) are one rule written twice. This
// bundles both and checks, over a grid of returns and replacements, that
//   - every default the screen posts is accepted by the Worker (a caller with only Returns is never refused what the screen offered), and
//   - the defaults are the TIGHTEST the Worker accepts: a cent (or one riel) off any part is refused, so the screen never charges more than it must;
//   - the old default -- every unit of a swapped row at the sold price -- is refused as soon as the row takes more units than were returned.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const frontend = path.resolve(root, '..', 'frontend')

async function load() {
  const entry = `
    export { firstDisallowedReplacementPrice } from './src/lib/returnReplacementPrice.ts'
    export { recordedSoldPriceForReplacement, returnedUnitsForReplacement } from './src/lib/returnsStock.ts'
    export { planReplacementParts, replacementPartsTotalUsd } from '${frontend.replaceAll('\\', '/')}/src/components/returns/helpers/replacementPricing.ts'`
  const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs',
    target: 'es2022', logLevel: 'silent', external: ['node:*', 'cloudflare:*'] })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}

// A database that has no promotions and no products: the Worker's promotion read finds nothing to lower the floor with.
const noPromotions = { prepare: () => ({ all: async () => [], get: async () => null }) }

async function main() {
  const k = await load()
  const RATE = 4000
  const catalog = { 1: { usd: 5, khr: 20000 }, 2: { usd: 4, khr: 16000 } }
  // The original sale: product 1 sold at $3 (the import left no riel price) and again at $3 / 12500 riel recorded; product 2 at $1.
  const saleLines = [
    { id: 11, product_id: 1, applied_price_usd: 3, applied_price_khr: null },
    { id: 12, product_id: 1, applied_price_usd: 3, applied_price_khr: 12500 },
    { id: 13, product_id: 2, applied_price_usd: 1, applied_price_khr: 4000 },
  ]
  const scenarios = []
  const returnSets = {
    'one of product 1 (no riel price recorded)': [{ sale_item_id: 11, product_id: 1, quantity: 1 }],
    'three of product 1 over both lines': [{ sale_item_id: 11, product_id: 1, quantity: 2 }, { sale_item_id: 12, product_id: 1, quantity: 1 }],
    'one of product 1 and one of product 2': [{ sale_item_id: 11, product_id: 1, quantity: 1 }, { sale_item_id: 13, product_id: 2, quantity: 1 }],
  }
  const rowSets = {
    'same product, 1': [[1, 1]], 'same product, 2': [[1, 2]], 'same product, 10': [[1, 10]], 'same product, 3': [[1, 3]],
    'other product, 1': [[2, 1]], 'other product, 10': [[2, 10]],
    'swap and extra product': [[1, 1], [2, 10]],
    'one product on two rows': [[1, 1], [1, 9]], 'three rows, one product': [[1, 2], [1, 2], [1, 6]],
  }
  for (const [returnLabel, returnItems] of Object.entries(returnSets)) {
    for (const [rowLabel, rows] of Object.entries(rowSets)) scenarios.push({ label: `${returnLabel} / ${rowLabel}`, returnItems, rows })
  }
  const toWorkerLines = (scenario, plan) => scenario.rows.flatMap(([productId, quantity], index) => {
    const sold = k.recordedSoldPriceForReplacement(saleLines, scenario.returnItems, productId, RATE)
    const common = { productId, catalogUsd: catalog[productId].usd, catalogKhr: catalog[productId].khr, soldUsd: sold.usd, soldKhr: sold.khr,
      returnedQuantity: k.returnedUnitsForReplacement(saleLines, scenario.returnItems, productId) }
    return plan.get(`row${index}`).map(part => ({ ...common, quantity: part.quantity, priceUsd: part.priceUsd, priceKhr: part.priceKhr ?? catalog[productId].khr }))
  })
  const screenPlan = scenario => k.planReplacementParts(
    scenario.rows.map(([productId, quantity], index) => ({ key: `row${index}`, productId, quantity, catalogUsd: catalog[productId].usd, catalogKhr: catalog[productId].khr })),
    scenario.returnItems.map(item => {
      const line = saleLines.find(candidate => candidate.id === item.sale_item_id)
      return { productId: item.product_id, quantity: item.quantity, soldUsd: line.applied_price_usd, soldKhr: line.applied_price_khr }
    }), RATE)
  const refused = async lines => (await k.firstDisallowedReplacementPrice(noPromotions, lines, RATE)) != null

  let checked = 0
  for (const scenario of scenarios) {
    const plan = screenPlan(scenario)
    const lines = toWorkerLines(scenario, plan)
    // Every unit is accounted for, whatever the split.
    scenario.rows.forEach(([, quantity], index) => {
      assert.equal(plan.get(`row${index}`).reduce((sum, part) => sum + part.quantity, 0), quantity, `${scenario.label}: row ${index} keeps its quantity`)
    })
    assert.equal(await refused(lines), false, `${scenario.label}: the Worker accepts the screen's defaults`)
    // Tightest: a cent off any one part's dollars, or one riel off its riel price, is refused.
    for (const [index, line] of lines.entries()) {
      if (line.priceUsd >= 0.01) assert.equal(await refused(lines.map((other, at) => at === index ? { ...other, priceUsd: other.priceUsd - 0.01 } : other)), true, `${scenario.label}: part ${index} a cent lower is refused`)
      if (line.priceKhr >= 1) assert.equal(await refused(lines.map((other, at) => at === index ? { ...other, priceKhr: other.priceKhr - 1 } : other)), true, `${scenario.label}: part ${index} one riel lower is refused`)
    }
    checked += 1 + lines.length * 2
  }
  // The old default: every unit at the price the sale recorded, where there is one. Refused exactly when some product with a sold price goes out in
  // more units than were returned of it.
  for (const scenario of scenarios) {
    const lines = scenario.rows.map(([id, q]) => {
      const sold = k.recordedSoldPriceForReplacement(saleLines, scenario.returnItems, id, RATE)
      return { productId: id, quantity: q, priceUsd: sold.usd ?? catalog[id].usd, priceKhr: sold.khr ?? catalog[id].khr, catalogUsd: catalog[id].usd, catalogKhr: catalog[id].khr,
        soldUsd: sold.usd, soldKhr: sold.khr, returnedQuantity: k.returnedUnitsForReplacement(saleLines, scenario.returnItems, id) }
    })
    const over = [...new Set(lines.map(line => line.productId))].filter(id => {
      const mine = lines.filter(line => line.productId === id)
      return mine[0].soldUsd != null && mine.reduce((sum, line) => sum + line.quantity, 0) > mine[0].returnedQuantity
    })
    assert.equal(await refused(lines), over.length > 0, `${scenario.label}: every unit at the sold price is refused iff a product goes out in more units than were returned (${over})`)
    checked += 1
  }
  console.log(`test-return-replacement-defaults-parity-pure: ok (${scenarios.length} scenarios, ${checked} assertions)`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })

'use strict'
// 6.0.952 parity: the prices the returns screen DEFAULTS a replacement to (frontend/src/components/returns/helpers/replacementPricing.ts) and the
// floor the Worker holds a caller without the POS price grant to (cloudflare/src/lib/returnReplacementPrice.ts) are one rule written twice. This
// bundles both and checks, over a grid of returns and replacements, that
//   - every default the screen posts is accepted by the Worker (a caller with only Returns is never refused what the screen offered), and
//   - the defaults are the TIGHTEST the Worker accepts: a cent (or one riel) off any part is refused, so the screen never charges more than it must;
//   - the old default -- every unit of a swapped row at the sold price -- is refused as soon as the row takes more units than were returned.
// 6.0.960 (release review c2f27dce6, P1-1): a product can sit on several returned lines at DIFFERENT recorded prices (a buy-2-get-1 line at $0 beside
// two at $5). Each returned unit was paid at its own line's price, so the covered units pair with their own lines, highest recorded price first --
// never one pooled lowest price. The grid carries such lines, and an independent oracle (plain arithmetic, no shared code) decides what the Worker
// must refuse for the pooled-price, highest-price and catalog-price defaults too.
const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const frontend = path.resolve(root, '..', 'frontend')

async function load() {
  const entry = `
    export { firstDisallowedReplacementPrice } from './src/lib/returnReplacementPrice.ts'
    export { recordedSoldLinesForReplacement } from './src/lib/returnsStock.ts'
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
  const catalog = { 1: { usd: 5, khr: 20000 }, 2: { usd: 4, khr: 16000 }, 3: { usd: 6, khr: 24000 } }
  // The original sale: product 1 sold at $3 (the import left no riel price), again at $3 / 12500 riel recorded, and at $2 (no riel price); product 2 at $1
  // and once at $6, above its $4 catalog price today (the catalog fell since); product 3 on three lines at different prices -- two at $5, two at $4.50
  // and one free (a buy-2-get-1 shape).
  const saleLines = [
    { id: 11, product_id: 1, applied_price_usd: 3, applied_price_khr: null },
    { id: 12, product_id: 1, applied_price_usd: 3, applied_price_khr: 12500 },
    { id: 13, product_id: 2, applied_price_usd: 1, applied_price_khr: 4000 },
    { id: 14, product_id: 1, applied_price_usd: 2, applied_price_khr: null },
    { id: 15, product_id: 2, applied_price_usd: 6, applied_price_khr: 24000 },
    { id: 21, product_id: 3, applied_price_usd: 5, applied_price_khr: 20000 },
    { id: 22, product_id: 3, applied_price_usd: 4.5, applied_price_khr: 18000 },
    { id: 23, product_id: 3, applied_price_usd: 0, applied_price_khr: 0 },
  ]
  const scenarios = []
  const returnSets = {
    'one of product 1 (no riel price recorded)': [{ sale_item_id: 11, product_id: 1, quantity: 1 }],
    'three of product 1 over both lines': [{ sale_item_id: 11, product_id: 1, quantity: 2 }, { sale_item_id: 12, product_id: 1, quantity: 1 }],
    'one of product 1 and one of product 2': [{ sale_item_id: 11, product_id: 1, quantity: 1 }, { sale_item_id: 13, product_id: 2, quantity: 1 }],
    'product 1 at $3 (two) and $2 (one)': [{ sale_item_id: 12, product_id: 1, quantity: 2 }, { sale_item_id: 14, product_id: 1, quantity: 1 }],
    'product 3, two at $5 and one at $0': [{ sale_item_id: 21, product_id: 3, quantity: 2 }, { sale_item_id: 23, product_id: 3, quantity: 1 }],
    'product 3, two at $5 and two at $4.50': [{ sale_item_id: 21, product_id: 3, quantity: 2 }, { sale_item_id: 22, product_id: 3, quantity: 2 }],
    'product 3, the free unit alone': [{ sale_item_id: 23, product_id: 3, quantity: 1 }],
    'product 2 sold at $6, above its $4 catalog': [{ sale_item_id: 15, product_id: 2, quantity: 1 }],
    'product 2 at $6 and $1': [{ sale_item_id: 15, product_id: 2, quantity: 1 }, { sale_item_id: 13, product_id: 2, quantity: 1 }],
    'product 3, the lines listed cheapest first': [{ sale_item_id: 23, product_id: 3, quantity: 1 }, { sale_item_id: 22, product_id: 3, quantity: 1 }, { sale_item_id: 21, product_id: 3, quantity: 1 }],
  }
  const rowSets = {
    'same product, 1': [[1, 1]], 'same product, 2': [[1, 2]], 'same product, 10': [[1, 10]], 'same product, 3': [[1, 3]],
    'other product, 1': [[2, 1]], 'other product, 10': [[2, 10]],
    'swap and extra product': [[1, 1], [2, 10]],
    'one product on two rows': [[1, 1], [1, 9]], 'three rows, one product': [[1, 2], [1, 2], [1, 6]],
    'product 3, 1': [[3, 1]], 'product 3, 2': [[3, 2]], 'product 3, 3': [[3, 3]], 'product 3, 4': [[3, 4]], 'product 3, 7': [[3, 7]],
    'product 3 on two rows (2 + 1)': [[3, 2], [3, 1]], 'product 3 on three rows (1 + 1 + 3)': [[3, 1], [3, 1], [3, 3]],
  }
  for (const [returnLabel, returnItems] of Object.entries(returnSets)) {
    for (const [rowLabel, rows] of Object.entries(rowSets)) scenarios.push({ label: `${returnLabel} / ${rowLabel}`, returnItems, rows })
  }
  const returnedOf = (scenario, productId) => k.recordedSoldLinesForReplacement(saleLines, scenario.returnItems, productId, RATE)
  const toWorkerLines = (scenario, plan) => scenario.rows.flatMap(([productId], index) => {
    const common = { productId, catalogUsd: catalog[productId].usd, catalogKhr: catalog[productId].khr, returned: returnedOf(scenario, productId) }
    return plan.get(`row${index}`).map(part => ({ ...common, quantity: part.quantity, priceUsd: part.priceUsd, priceKhr: part.priceKhr ?? catalog[productId].khr }))
  })
  const screenPlan = scenario => k.planReplacementParts(
    scenario.rows.map(([productId, quantity], index) => ({ key: `row${index}`, productId, quantity, catalogUsd: catalog[productId].usd, catalogKhr: catalog[productId].khr })),
    scenario.returnItems.map(item => {
      const line = saleLines.find(candidate => candidate.id === item.sale_item_id)
      return { productId: item.product_id, quantity: item.quantity, soldUsd: line.applied_price_usd, soldKhr: line.applied_price_khr }
    }), RATE)
  const refused = async lines => (await k.firstDisallowedReplacementPrice(noPromotions, lines, RATE)) != null

  // The rule stated independently, in plain arithmetic (nothing from the code under test): the returned units of a product, highest recorded price first,
  // cover that many of its replacement units, each worth the lower of the catalog price and the price of the line it came from; every other unit is
  // worth the catalog price. A caller without the POS grant is refused when it posts less than that in either currency (money has four places).
  const oracleRefuses = (scenario, lines) => ['usd', 'khr'].some(leg => [...new Set(lines.map(line => line.productId))].some(productId => {
    const mine = lines.filter(line => line.productId === productId)
    const units = mine.reduce((sum, line) => sum + line.quantity, 0)
    const base = catalog[productId][leg]
    const prices = scenario.returnItems.flatMap(item => {
      const line = saleLines.find(candidate => candidate.id === item.sale_item_id)
      if (line.product_id !== productId) return []
      const usd = line.applied_price_usd
      const khr = line.applied_price_khr ?? Math.floor(usd * RATE + 1e-6)
      return Array.from({ length: item.quantity }, () => ({ usd, khr }))
    }).sort((a, b) => b.usd - a.usd || b.khr - a.khr).map(unit => unit[leg])
    let floor = 0
    for (let unit = 0; unit < units; unit += 1) floor += unit < prices.length ? Math.min(base, prices[unit]) : base
    const posted = mine.reduce((sum, line) => sum + line.quantity * (leg === 'usd' ? line.priceUsd : line.priceKhr), 0)
    return posted < floor - 0.00005 * units
  }))

  let checked = 0
  for (const scenario of scenarios) {
    const plan = screenPlan(scenario)
    const lines = toWorkerLines(scenario, plan)
    // Every unit is accounted for, whatever the split.
    scenario.rows.forEach(([, quantity], index) => {
      assert.equal(plan.get(`row${index}`).reduce((sum, part) => sum + part.quantity, 0), quantity, `${scenario.label}: row ${index} keeps its quantity`)
    })
    assert.equal(await refused(lines), false, `${scenario.label}: the Worker accepts the screen's defaults`)
    // Tightest: a cent off any one part's dollars, or one riel off its riel price, is refused. (Unless a part is priced ABOVE today's catalog -- a line
    // sold dearer than the catalog is now. The floor of that unit is the catalog price, so the excess is slack the other parts could spend.)
    const slack = lines.some(line => line.priceUsd > line.catalogUsd || line.priceKhr > line.catalogKhr)
    for (const [index, line] of slack ? [] : lines.entries()) {
      if (line.priceUsd >= 0.01) assert.equal(await refused(lines.map((other, at) => at === index ? { ...other, priceUsd: other.priceUsd - 0.01 } : other)), true, `${scenario.label}: part ${index} a cent lower is refused`)
      if (line.priceKhr >= 1) assert.equal(await refused(lines.map((other, at) => at === index ? { ...other, priceKhr: other.priceKhr - 1 } : other)), true, `${scenario.label}: part ${index} one riel lower is refused`)
    }
    checked += 1 + (slack ? 0 : lines.length * 2)
  }

  // The older defaults, each decided by the independent oracle rather than by the code under test. For every scenario and every replaced product:
  //   pooled  -- every unit at the LOWEST recorded price of its returned lines (the 6.0.952 rule that undercharged a two-price sale);
  //   highest -- every unit at the HIGHEST recorded price of its returned lines;
  //   sold    -- the recorded price of the first returned line only;
  //   catalog -- every unit at the catalog price (always acceptable).
  for (const scenario of scenarios) {
    const strategies = {
      pooled: sold => Math.min(...sold),
      highest: sold => Math.max(...sold),
      first: sold => sold[0],
      catalog: () => null,
    }
    for (const [name, choose] of Object.entries(strategies)) {
      const lines = scenario.rows.map(([id, q]) => {
        const returned = returnedOf(scenario, id)
        const usd = returned.length ? choose(returned.map(line => line.usd)) : null
        const khr = returned.length ? choose(returned.map(line => line.khr)) : null
        return { productId: id, quantity: q, priceUsd: usd ?? catalog[id].usd, priceKhr: khr ?? catalog[id].khr, catalogUsd: catalog[id].usd, catalogKhr: catalog[id].khr, returned }
      })
      assert.equal(await refused(lines), oracleRefuses(scenario, lines), `${scenario.label}: the '${name}' default is refused exactly when the independent floor says so`)
      if (name === 'catalog') assert.equal(await refused(lines), false, `${scenario.label}: the catalog price is never refused`)
      checked += 1
    }
  }

  // The review's two probes, as literal numbers. A sale with 2 x $5 and 1 x $0 of product 3 (catalog $6) is returned whole and swapped for the same
  // product: the customer was refunded $10, so the replacement may not cost less than $10 -- the pooled rule let it go out for $0.
  const free = { sale_item_id: 23, product_id: 3, quantity: 1 }
  const five = { sale_item_id: 21, product_id: 3, quantity: 2 }
  const cheaper = { sale_item_id: 22, product_id: 3, quantity: 2 }
  const swap = (returnItems, replacement) => refused(replacement.map(([quantity, usd, khr]) => ({
    productId: 3, quantity, priceUsd: usd, priceKhr: khr ?? usd * RATE, catalogUsd: 6, catalogKhr: 24000, returned: k.recordedSoldLinesForReplacement(saleLines, returnItems, 3, RATE) })))
  assert.equal(await swap([five, free], [[3, 0]]), true, '2@$5 + 1@$0 back, all three out free: refused')
  assert.equal(await swap([five, free], [[1, 0], [2, 0]]), true, '... however the free units are split into lines')
  assert.equal(await swap([five, free], [[2, 5], [1, 0]]), false, '... the true per-unit swap is accepted')
  assert.equal(await swap([five, free], [[3, 3.33]]), true, '... $9.99 for the three is under the $10 floor')
  assert.equal(await swap([five, free], [[3, 3.3334]]), false, '... $10.0002 for the three is accepted')
  assert.equal(await swap([five, free], [[2, 2.5]]), true, '... two out for $5: the two units paid $5 cover them, so the floor is $10, not $5')
  assert.equal(await swap([five, free], [[2, 5]]), false, '... two out at $5 each is accepted')
  assert.equal(await swap([five, free], [[4, 4]]), false, '... a fourth unit is a purchase at the catalog $6: $10 + $6 = $16')
  assert.equal(await swap([five, free], [[4, 3.99]]), true, '... four for $15.96 is under $16')
  assert.equal(await swap([five, cheaper], [[4, 4.5]]), true, '2@$5 + 2@$4.50 back, four out at $4.50 each ($18 against $19): refused')
  assert.equal(await swap([five, cheaper], [[4, 4.75]]), false, '... $19 is accepted')
  assert.equal(await swap([five, cheaper], [[2, 5], [2, 4.5]]), false, '... and so is 2@$5 + 2@$4.50')
  assert.equal(await swap([free], [[1, 0]]), false, 'only the free unit back, one out free: accepted -- that unit was paid $0')
  assert.equal(await swap([free], [[2, 0]]), true, '... a second free unit is a purchase at the catalog price: refused')
  checked += 14
  console.log(`test-return-replacement-defaults-parity-pure: ok (${scenarios.length} scenarios, ${checked} assertions)`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })

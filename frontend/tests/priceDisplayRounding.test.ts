// A SELLING / WHOLESALE / PROMOTION / UNIT PRICE rounds UP wherever it is shown; an AMOUNT rounds to the nearest cent (owner, 24 Sep 2026).
// Lane MONEY-1 review fix B2, 4 Nov 2026.
//
// After 6.0.1148 the shared fmtUSD / fmtKHR round to the NEAREST cent, but the product card, the product sheets, promotions, returns
// and the rest printed a stored selling price of $2.161 through fmtUSD -- "$2.16" -- while the till charges sellingPriceCeilCent, $2.17
// (a 4-decimal selling price is writable: Resolve keeps four places). priceText(fmt, price) is the ONE way to show a price: round UP with
// the till's rule, then print. This test pins (1) the figures, (2) that the card, the cart and the receipt agree for 2.161 / 2.165 /
// 2.1601, and (3) by a source scan that no price field reaches fmtUSD / fmtKHR directly any more.
// DISCRIMINATING: the nearest-cent formatter gives $2.16 for 2.161 and 2.1601 (the card would disagree with the cart by a cent);
// the "price" rows below are red when any listed surface goes back to fmtUSD(price).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { priceText, normalizePriceValue } from '../src/utils/pricing.ts'
import { roundDisplayMoney } from '../src/utils/displayMoney.ts'
import { resolveCartPriceValues } from '../src/components/pos/posCore.ts'
import { receiptLineFigures } from '../src/utils/receiptLineMath.ts'
import { multiplyMoney4 } from '../src/utils/moneyPrecision.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '../src')
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// The real fmtUSD / fmtKHR, taken from the AppContext source text.
const appContext = fs.readFileSync(path.join(srcRoot, 'AppContext.tsx'), 'utf8').replace(/\r\n/g, '\n')
function realFormatters() {
  const start = appContext.indexOf('const fmtUSD = useCallback')
  const end = appContext.indexOf('const formatPrice = useCallback')
  assert.ok(start > 0 && end > start, 'fmtUSD and formatPrice are found in AppContext.tsx')
  const js = transformSync(`function build(useCallback: any, roundDisplayMoney: any, usdSymbol: string, khrSymbol: string) {\n${appContext.slice(start, end)}\nreturn { fmtUSD, fmtKHR }\n}`, { loader: 'ts', format: 'cjs' }).code
  const build = new Function('module', `${js}\nreturn build`)({}) as (...args: unknown[]) => { fmtUSD: (n: unknown) => string; fmtKHR: (n: unknown) => string }
  return build((fn: unknown) => fn, roundDisplayMoney, '$', '៛')
}
const { fmtUSD, fmtKHR } = realFormatters()

runTest('a price shows rounded UP, an amount rounds to the nearest cent: the same 2.161 reads $2.17 as a price and $2.16 as an amount', () => {
  for (const [stored, asPrice, asAmount] of [[2.161, '$2.17', '$2.16'], [2.165, '$2.17', '$2.17'], [2.1601, '$2.17', '$2.16'], [2.111, '$2.12', '$2.11'], [9.9901, '$10.00', '$9.99'], [4.75, '$4.75', '$4.75']] as const) {
    assert.equal(priceText(fmtUSD, stored), asPrice, `price ${stored}`)
    assert.equal(fmtUSD(stored), asAmount, `amount ${stored}`)
  }
  assert.equal(priceText(fmtKHR, 19000.004), '19,000.01៛', 'a riel price rounds up with the same rule')
  assert.equal(priceText(fmtUSD, null), '$0.00')
  assert.equal(priceText(fmtUSD, 'abc'), '$0.00')
})

runTest('the card, the cart and the receipt agree for a stored price of 2.161, 2.165 and 2.1601', () => {
  for (const stored of [2.161, 2.165, 2.1601]) {
    const card = priceText(fmtUSD, stored)
    // The till charges the price rounded UP to the cent (resolveCartPriceValues -> sellingPriceCeilCent, money v1).
    const cart = resolveCartPriceValues({ id: 1, selling_price_usd: stored, selling_price_khr: 0 } as never, 'selling', 4000, {}, [], 1)
    assert.equal(cart.applied_price_usd, 2.17, `the cart charges 2.17 for ${stored}`)
    const cartUnit = priceText(fmtUSD, cart.applied_price_usd)
    const cartLine = fmtUSD(multiplyMoney4(cart.applied_price_usd, 1)) // the line AMOUNT for one unit
    // The receipt prints the sale line's recorded unit price (the charged 2.17) in its Price column and the line amount beside it.
    const figures = receiptLineFigures({ quantity: 1, applied_price_usd: cart.applied_price_usd, applied_price_khr: cart.applied_price_khr, base_price_usd: 0 } as never, true, 4000, 0)
    const receiptUnit = priceText(fmtUSD, figures.sellingUnitUsd)
    const receiptLine = fmtUSD(figures.lineUsd)
    assert.deepEqual([card, cartUnit, cartLine, receiptUnit, receiptLine], ['$2.17', '$2.17', '$2.17', '$2.17', '$2.17'], `for ${stored}`)
    // The wrong implementation: the card on the nearest-cent formatter disagrees with what it rings up.
    if (stored !== 2.165) assert.notEqual(fmtUSD(stored), cartUnit, `fmtUSD on a price ${stored} reads a cent below the cart`)
  }
})

runTest('a price is never printed below what it is charged at, for any four-decimal stored price', () => {
  for (let ten = 2000; ten <= 2200; ten += 7) {
    const stored = ten / 10000 + 2
    const charged = normalizePriceValue(stored)
    assert.equal(priceText(fmtUSD, stored), fmtUSD(charged))
    assert.ok(charged >= stored - 1e-9 && charged - stored < 0.01 + 1e-9, `${stored} -> ${charged}`)
  }
})

// ---- the source scan: no price field goes straight to fmtUSD / fmtKHR --------------------------------------------------------------------
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !full.includes(`${path.sep}lang${path.sep}`) ? [full] : []
  })
}
const PRICE_TOKEN = /(selling_price|wholesale_price|applied_price|unit_price|unitPrice|sellingPrice|wholesalePrice|sellingUsd|wholesaleUsd|sellingKhr|wholesaleKhr|price_usd|price_khr|priceUsd|priceKhr)/
function callArguments(text: string, from: number): string {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return text.slice(from + 1, i) }
  }
  return ''
}
runTest('no selling / wholesale / promotion / unit price reaches fmtUSD or fmtKHR without priceText (amounts and costs are the only ones that do)', () => {
  const direct: string[] = []
  for (const file of sourceFiles(srcRoot)) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const match of text.matchAll(/\b(fmtUSD|fmtKHR)\(/g)) {
      const argument = callArguments(text, match.index! + match[1].length)
      if (!PRICE_TOKEN.test(argument)) continue
      // A line AMOUNT (a price times a quantity, a quoted total) and a COST are not prices: they keep the nearest-cent formatter.
      if (/[*]/.test(argument) || /(multiplyMoney4|total_|cost)/.test(argument)) continue
      direct.push(`${path.relative(srcRoot, file).replaceAll('\\', '/')}: ${match[1]}(${argument.slice(0, 80)})`)
    }
  }
  assert.deepEqual(direct, [], `a price is printed through the amount formatter (use priceText(fmtUSD, price)):\n${direct.join('\n')}`)
})

runTest('every surface that shows a price calls priceText: card, sheets, product lists, promotions, returns, receipt, records, variant pills', () => {
  const must: Array<[string, RegExp]> = [
    ['components/pos/ProductCard.tsx', /priceText\(fmtUSD, groupProduct \?/],
    ['components/pos/ProductDetailSheet.tsx', /priceText\(fmtUSD, asNumber\(product\.selling_price_usd\)\)/],
    ['components/products/Products.tsx', /priceText\(fmtUSD, sellingUsd\)/],
    ['components/products/ProductsImageOnlyView.tsx', /priceText\(fmtUSD, product\.selling_price_usd\)/],
    ['components/products/surfaces/ProductDetailModal.tsx', /priceText\(fmtUSD, sellingUsd\)/],
    ['components/inventory/ProductDetailModal.tsx', /priceText\(fmtUSD, sellingPriceUsd\)/],
    ['components/promotions/PromotionsPage.tsx', /priceText\(fmtUSD, Number\(product\.selling_price_usd\) \|\| 0\)/],
    ['components/returns/NewReturnModal.tsx', /priceText\(fmtUSD, toNumber\(lead\?\.selling_price_usd\)\)/],
    ['components/returns/EditReturnModal.tsx', /priceText\(fmtUSD, item\.applied_price_usd \|\| 0\)/],
    ['components/receipt/Receipt.tsx', /priceText\(fmtUSD, unitUsd\)/],
    ['components/sales/saleRecordValue.ts', /priceText\(fmtUSD, unitPrice\)/],
    ['components/sales/SaleDetailModal.tsx', /priceText\(fmtUSD, line\.unitPriceUsd\)/],
    ['components/pos/posCore.ts', /label = priceText\(formatPrice, price\)/],
    ['components/catalog/CatalogPage.tsx', /const usdValue = normalizePriceValue\(usd \|\| 0\)/],
    ['components/catalog/CatalogSecondaryTabs.tsx', /normalizePriceValue\(servedPrice\)\.toFixed\(2\)/],
    ['components/products/forms/ProductForm.tsx', /normalizePriceValue\(Number\(form\.selling_price_usd \|\| 0\)\)\.toFixed\(2\)/],
    ['components/products/MergeStockChoiceDialog.tsx', /normalizePriceValue\(amount\)\.toFixed\(2\)/],
  ]
  for (const [file, pattern] of must) {
    const text = fs.readFileSync(path.join(srcRoot, file), 'utf8').replace(/\r\n/g, '\n')
    assert.match(text, pattern, `${file} shows its price through the price rule`)
  }
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }

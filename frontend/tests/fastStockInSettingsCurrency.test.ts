import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Owner, 24 Sep 2026: everything in Settings -- the currency included --
// must actually apply. The product form that fast stock-in opens for an
// unknown barcode was handed a hard-coded 4100 rate and "$" / "៛" symbols,
// so a shop with another rate or symbol saw the wrong KHR conversions and
// labels there, and the modal's own cost totals printed "$" regardless.
//
// No DOM renderer can reach that form here (it sits behind internal
// createBarcode state, inside a portal), so this proves the chain in two
// parts: the app context really turns Settings into these three values
// (evaluated, with a non-default rate and custom symbols), and the modal
// takes exactly those context values -- no literal of its own.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const appContext = read('../src/AppContext.tsx')
const modal = read('../src/components/inventory/FastStockInModal.tsx')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('Settings become the context rate and symbols (a non-default rate and custom symbols)', () => {
  const lines = ['exchangeRate', 'usdSymbol', 'khrSymbol'].map((name) => {
    const match = appContext.match(new RegExp(`const ${name}\\s*= (.+)`))
    assert.ok(match, `AppContext derives ${name}`)
    return `const ${name} = ${match[1].trim()}`
  })
  const derive = new Function('settings', `${lines.join('\n')}\nreturn { exchangeRate, usdSymbol, khrSymbol }`) as
    (settings: Record<string, unknown>) => { exchangeRate: number; usdSymbol: string; khrSymbol: string }
  assert.deepEqual(derive({ exchange_rate: '4250', currency_usd_symbol: 'US$', currency_khr_symbol: 'KHR ' }),
    { exchangeRate: 4250, usdSymbol: 'US$', khrSymbol: 'KHR ' })
})

runTest('the modal reads the rate and both symbols from the app context', () => {
  assert.match(modal, /const app = useApp\(\) as \{ user: any; exchangeRate: number; usdSymbol: string; khrSymbol: string \}/)
  assert.match(modal, /const \{ user, usdSymbol, khrSymbol \} = app/)
  assert.match(modal, /const exchangeRate = exchangeRateOverride \?\? app\.exchangeRate/)
})

runTest('the product form opened from fast stock-in gets those values, not literals', () => {
  const start = modal.indexOf('<ProductForm')
  const form = modal.slice(start, modal.indexOf('/>', start))
  assert.match(form, /usdSymbol=\{usdSymbol\}/)
  assert.match(form, /khrSymbol=\{khrSymbol\}/)
  assert.match(form, /exchangeRate=\{exchangeRate\}/)
})

runTest('no hard-coded rate or currency symbol is left for the form or the line and pending-commit totals', () => {
  assert.doesNotMatch(modal, /exchangeRate = 4100/, 'no private default rate')
  assert.doesNotMatch(modal, /usdSymbol="|khrSymbol="/, 'no literal symbol props')
  assert.doesNotMatch(modal, /value: `\$\$\{pendingCommit/, 'the pending-commit total uses the Settings symbol')
  assert.match(modal, /value: `\$\{usdSymbol\}\$\{pendingCommit\.reduce/)
  assert.match(modal, /\{tr\('total_cost', 'Total cost'\)\}: \{usdSymbol\}\{\(Math\.max\(0, Number\(quantity\)/, 'the in-progress line total uses the Settings symbol')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All fastStockInSettingsCurrency tests passed')
}

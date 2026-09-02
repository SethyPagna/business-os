import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

const css = read('styles/main.css')
const stockChanges = read('components/products/StockChangeSection.tsx')
const stockSessions = read('components/products/StockInSessionsSection.tsx')
const returns = read('components/returns/ReturnsListSurface.tsx')

for (const token of ['.compact-action-row', '.dense-data-shell', '.dense-data-table', '.dense-day-row', '.dense-cell-truncate', '.dense-id', '.desktop-dense-only', '.mobile-cards-only']) {
  assert.ok(css.includes(token), `shared compact data contract is missing ${token}`)
}
assert.match(css, /@media \(min-width:768px\)[\s\S]*\.mobile-cards-only \{ display:none !important; \}/,
  'desktop tables must replace, not duplicate, mobile cards on large screens')
assert.match(css, /@media \(max-width:767px\)[\s\S]*\.desktop-dense-only \{ display:none !important; \}/,
  'dense desktop tables must not create narrow-screen overflow')

for (const [name, source] of [['Stock Changes', stockChanges], ['Stock-in Sessions', stockSessions]] as const) {
  assert.match(source, /desktop-dense-only dense-data-shell/, `${name} needs a compact desktop table`)
  assert.match(source, /className="dense-data-table/, `${name} must reuse the shared table contract`)
  assert.match(source, /mobile-cards-only/, `${name} must preserve a dedicated mobile fallback`)
  assert.match(source, /data-clickable="true"/, `${name} desktop rows must open their detail view`)
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/, `${name} clickable rows must be keyboard accessible`)
}

assert.match(stockChanges, /data-tone="blue"/, 'stock-change product header needs a restrained semantic cue')
assert.match(stockChanges, /data-tone="emerald"/, 'stock-change quantity header needs a restrained semantic cue')
assert.match(stockSessions, /dense-id font-semibold/, 'stock receipt/session identifiers must use compact monospace treatment')
assert.match(stockSessions, /compact-action-row border-t/, 'stock-session modal actions must remain on one compact rail')

assert.match(returns, /matchMedia\('\(max-width: 767px\)'\)/, 'Returns must keep cards through the tablet-safe 767px breakpoint')
assert.match(returns, /desktop-dense-only dense-data-shell/, 'Returns needs the shared compact desktop table shell')
assert.match(returns, /className="dense-data-table min-w-\[720px\]"/, 'Returns desktop table must use the dense table contract')
assert.match(returns, /mobile-cards-only space-y-2/, 'Returns must preserve a responsive card fallback')
assert.match(returns, /data-clickable="true"/, 'Returns desktop rows must expose their clickable contract')
assert.match(returns, /event\.key !== 'Enter' && event\.key !== ' '/, 'Returns rows must open from keyboard activation')

console.log('PASS dense desktop tables with responsive card fallbacks and compact action rails')

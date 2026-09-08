import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const css = read('src/components/sales/reports/reports-surface.css')
const hub = read('src/components/sales/ReportsHub.tsx')
const frame = read('src/components/sales/reports/ReportFrame.tsx')
const options = read('src/components/sales/reports/ReportOptionsFold.tsx')

function ruleBody(selector: string, start = 0): string {
  const at = css.indexOf(selector, start)
  assert.ok(at >= 0, `missing CSS selector ${selector}`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const hubBase = ruleBody('\n[data-reports-hub] {')
assert.match(hubBase, /padding-inline:\s*max\(12px, env\(safe-area-inset-left, 0px\)\)\s+max\(12px, env\(safe-area-inset-right, 0px\)\)/)
for (const [media, gutter] of [
  ['@media (min-width: 768px)', 'clamp(12px, 2vw, 24px)'],
  ['@media (min-width: 1024px)', 'clamp(28px, 3.5vw, 56px)'],
  ['@media (min-width: 1280px)', 'clamp(40px, 4vw, 64px)'],
  ['@media (min-width: 1536px)', 'clamp(56px, 4vw, 80px)'],
] as const) {
  const body = ruleBody('\n  [data-reports-hub] {', css.indexOf(media))
  assert.ok(body.includes(gutter), `${media} keeps its centered gutter`)
  assert.match(body, /env\(safe-area-inset-left, 0px\)/)
  assert.match(body, /env\(safe-area-inset-right, 0px\)/)
}

const desktop = ruleBody('\n  [data-reports-hub] {', css.indexOf('@media (min-width: 1024px)'))
assert.match(desktop, /max-width:\s*74rem/)
assert.match(desktop, /margin-inline:\s*auto/)

const segment = ruleBody('.report-segment')
assert.match(segment, /border:\s*1px solid var\(--ui-line\)/)
assert.match(segment, /padding:\s*5px 7px/)
assert.match(frame, /report-segment min-w-0/)
assert.match(hub, /reports-desktop-controls report-segment/)

assert.match(options, /className="reports-fold-panel reports-filter-fold"/)
assert.match(options, /data-reports-fold=""/)
assert.match(options, /data-reports-filter=""/)
assert.match(css, /\.reports-filter-trigger\s*\{[^}]*background:\s*var\(--ui-surface\)[^}]*color:\s*var\(--ui-ink\)/, 'the report filter trigger keeps a high-contrast surface')
assert.match(css, /body\.lang-km \.reports-fold-panel/)
assert.match(css, /body\.lang-km \[data-reports-fold\]/)
assert.match(css, /--ui-km-boost:\s*1\.2/)
assert.match(css, /--ui-receipt-lh:\s*calc\(var\(--ui-size-body\) \* 1\.62\)/)

for (const file of [
  'OverviewReport.tsx', 'PeriodReport.tsx', 'GroupedReport.tsx',
  'SalesListReport.tsx', 'ReturnsReport.tsx', 'ExpensesReport.tsx',
]) {
  const source = read(`src/components/sales/reports/${file}`)
  if (source.includes('<Fold')) assert.match(source, /className="reports-fold-panel"/, `${file} scopes portalled report folds`)
}

console.log('PASS report document surface: centered gutters, four-sided segments, readable Khmer fold scope')

import assert from 'node:assert/strict'
import fs from 'node:fs'

// P11-15: "we made them same fixed row card length but the details in the
// card did not update and get corrected with the change, still previous
// fixed content."
//
// The P6-7 fix (commit 310f4f00) stretched every card in a dashboard row to
// the same height via CSS grid items-stretch, but the Analytics chart card's
// hand-rolled SVG plot always rendered at a fixed 178/196px height regardless
// of how tall the stretched row actually was -- so a short chart left dead
// blank space below it whenever a taller sibling (e.g. Recent Sales with a
// long list) stretched the row. LineChart/BarChart must measure their own
// (flex-1) container height and grow the plot to fill it, and the Dashboard
// card must give them a flex-1 wrapper to grow into.
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const lineChart = fs.readFileSync(new URL('../src/components/dashboard/charts/LineChart.tsx', import.meta.url), 'utf8')
const barChart = fs.readFileSync(new URL('../src/components/dashboard/charts/BarChart.tsx', import.meta.url), 'utf8')

for (const [name, src] of [['LineChart', lineChart], ['BarChart', barChart]] as const) {
  assert.match(src, /useState\(0\)/, `${name} tracks a measured chart height, not just width`)
  assert.match(
    src,
    /const H = Math\.max\(defaultH, Math\.min\(340, chartHeight \|\| defaultH\)\)/,
    `${name}'s SVG height grows with its measured container instead of staying fixed`,
  )
  assert.match(src, /<div ref=\{chartRef\} className="relative h-full">/, `${name}'s container can stretch to fill its flex-1 parent`)
}

// The Dashboard wraps each chart branch (revenue/profit/volume) in a flex-1
// container so the measured height above has real room to grow into,
// instead of the old fixed h-52 placeholders.
const chartCardMatch = dashboard.match(/<div className="flex flex-1 flex-col">[\s\S]*?<\/div>\s*<\/div>\s*\n\s*<RecentSalesCard/)
assert.ok(chartCardMatch, 'the Analytics card wraps its chart states in a flex-1 column so they can stretch')
const chartCardBody = chartCardMatch![0]
assert.doesNotMatch(chartCardBody, /"h-52 animate-pulse/, 'the loading placeholder is no longer a bare fixed h-52 (it must also carry flex-1)')
assert.ok(
  (chartCardBody.match(/flex-1 min-h-\[13rem\]/g) || []).length >= 5,
  'every chart-card state (pending/unavailable/empty/revenue/profit/volume) gets a flex-1 min-h wrapper',
)

console.log('PASS dashboard chart plot fills its stretched row (P11-15)')

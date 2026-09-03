import assert from 'node:assert/strict'
import fs from 'node:fs'

// Reports redesign + layered sections (Sep 3 2026, lane fx/reports-redesign).
//
// Two invariants this pins, both of which a future edit could silently undo:
//
//  1. Reports must never grow a SECOND revenue definition. The Overview
//     reads the same endpoint the Sales list reads, and the breakdown views
//     read routes that hand straight off to the salesAnalytics kernel. The
//     day someone "optimises" one of these into a bespoke query, the figures
//     start disagreeing with the Sales list and nobody notices for weeks.
//
//  2. Layered mode must default OFF and must pop exactly one layer per back
//     gesture without changing the pathname -- a pathname change would make
//     the app's page router treat a layer as a page navigation.

const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const overview = read('src/components/sales/ReportsOverviewSection.tsx')
const breakdown = read('src/components/sales/ReportsBreakdownSection.tsx')
const hub = read('src/components/sales/ReportsHub.tsx')
const layers = read('src/components/shared/HubLayers.tsx')
const settings = read('src/components/utils-settings/Settings.tsx')
const appContext = read('src/AppContext.tsx')
const transport = read('src/api/salesTransport.ts')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

// ---- 1. one revenue definition ------------------------------------------

// The Overview's figures ARE the Sales list's figures: same transport call.
assert.match(overview, /getSalesStatsStrip/, 'Overview reads the same stats-strip endpoint the Sales list reads')
assert.ok(
  !/\brevenue_usd\s*[-+*/]/.test(overview) && !/[-+*/]\s*revenue_usd/.test(overview),
  'Overview must not do arithmetic on revenue -- it renders what the kernel returned',
)
// Margin is the one derived figure, and only as a ratio of two kernel fields.
assert.match(overview, /profit_usd \/ totals\.revenue_usd/, 'margin is profit over revenue, both from the kernel')

// The breakdown views go through the kernel-backed routes, not a bespoke one.
assert.match(breakdown, /getSalesGroupedTotals/, 'breakdown uses the grouped-totals route')
assert.match(breakdown, /getProductSalesRanking/, 'breakdown uses the product-ranking route')
assert.match(transport, /\/api\/sales\/grouped-totals/, 'the grouped-totals transport targets the sales route')
assert.match(transport, /\/api\/sales\/product-ranking/, 'the product-ranking transport targets the sales route')

// Reconciliation is VISIBLE: the kernel's own total for the same filters is
// rendered beside the rows, and the mismatch case has its own message.
assert.match(breakdown, /totals\.revenue_usd/, 'the breakdown renders the kernel total row')
assert.match(breakdown, /summedRevenue - totals\.revenue_usd/, 'the breakdown compares its rows against that total')
assert.match(breakdown, /reports_rows_capped/, 'a capped list says so rather than looking like a drift')

// Admin-only figures stay ABSENT rather than becoming a misleading zero.
for (const [name, src] of [['Overview', overview], ['Breakdown', breakdown]]) {
  assert.match(src, /'cost_usd' in r/, `${name} keeps cost_usd absent when the server omitted it`)
  assert.match(src, /'profit_usd' in r/, `${name} keeps profit_usd absent when the server omitted it`)
}
assert.match(overview, /totals\.profit_usd != null \? \[\{/, 'the profit tile is dropped, not zeroed, for a non-admin')

// The hub still honours the contracts earlier parts pinned.
assert.match(hub, /titleNode=\{titleNode\}/, 'ReportsHub passes the title into each section')
assert.match(hub, /fmtMoney=\{fmtMoney\}/, 'ReportsHub passes fmtMoney to the sections')

// ---- 2. layered sections -------------------------------------------------

// Default is the layout the app has always had.
assert.match(layers, /'layered' \? 'layered' : 'stacked'/, 'anything but an explicit "layered" normalises to stacked')
assert.equal(
  (layers.match(/=== 'layered'/g) || []).length >= 1, true,
  'layered mode is opt-in by explicit value',
)

// A layer is a hash move, never a pathname move: the app's page router keys
// off the pathname, so changing it would make a layer look like a page.
assert.match(layers, /window\.location\.pathname\}\$\{window\.location\.search\}\$\{hash\}/, 'pushState keeps the pathname and search, moving only the hash')
assert.ok(!/pushState\([^)]*`\/[a-z]/.test(layers), 'a layer never pushes a new path')

// Back pops exactly one layer, and delegates to history so the on-screen
// chevron and the device gesture behave identically.
assert.match(layers, /window\.history\.back\(\)/, 'the back affordance delegates to browser history')
assert.match(layers, /next < current\.length \? current\.slice\(0, next\) : current/, 'popstate trims to the depth that history entry recorded')

// Leaving layered mode must not strand the user inside a layer.
assert.match(layers, /if \(!active\) setStack\(\[\]\)/, 'turning layered mode off resets the stack')

// Layered only applies to small screens.
assert.match(layers, /max-width: \$\{maxWidth - 1\}px/, 'layered mode is gated on a small-screen media query')

// The hub keeps range + branch ABOVE the layers, so collapsing one cannot
// lose them.
const layerBranch = hub.slice(hub.indexOf('if (layered)'))
assert.match(layerBranch, /DateTimeRangePicker value=\{range\} onChange=\{setRange\}/, 'the range control survives inside a layer')
assert.ok(
  hub.indexOf('const [range, setRange]') < hub.indexOf('if (layered)'),
  'range state is owned by the hub, above the layer switch',
)

// ---- 3. the preference ---------------------------------------------------

// Persisted the way every other appearance preference on this base is:
// device-local, so a phone and a desktop can differ and no admin forces one.
assert.match(appContext, /'ui_section_layout',/, 'the preference is registered as a device-local setting')
const deviceSet = appContext.slice(appContext.indexOf('DEVICE_LOCAL_SETTING_KEYS'), appContext.indexOf('SESSION_ONLY_STORAGE_KEYS'))
assert.match(deviceSet, /ui_section_layout/, 'ui_section_layout sits inside DEVICE_LOCAL_SETTING_KEYS')

// Surfaced in Settings -> Appearance.
assert.match(settings, /SECTION_LAYOUT_OPTION_KEYS/, 'Settings declares the section-layout options')
assert.match(settings, /setValue\('ui_section_layout', layoutValue\)/, 'the Settings control writes the preference')
assert.match(settings, /\|\| 'stacked'\) === layoutValue/, 'the Settings control treats stacked as the default')

// ---- 4. both language packs ---------------------------------------------

const NEW_KEYS = [
  'breakdown', 'pending_credit', 'collected', 'line_sales', 'break_down_by',
  'by_customer', 'by_cashier', 'by_payment_method', 'by_hour', 'by_weekday', 'by_branch', 'by_product',
  'reports_hint_revenue', 'reports_same_as_sales_list', 'reports_line_sales_note',
  'reports_rows_reconcile', 'reports_rows_capped',
  'sectionLayoutTitle', 'sectionLayoutHint', 'sectionLayoutStacked', 'sectionLayoutLayered',
]
for (const key of NEW_KEYS) {
  assert.ok(en[key], `en.json defines ${key}`)
  assert.ok(km[key], `km.json defines ${key}`)
  assert.notEqual(km[key], en[key], `km.json must translate ${key}, not repeat the English`)
  // Khmer text, not a romanised placeholder.
  assert.match(km[key], /[ក-៿]/, `km.json uses Khmer script for ${key}`)
}

// NOTE for whoever picks up the Khmer naming pass: km "margin" currently
// reads "ប្រាក់ចំណូល" (= revenue), which is the opposite of what the label
// means, and this lane now surfaces that label in the Reports overview.
// Deliberately NOT corrected here -- every EXISTING Khmer value belongs to
// the Khmer naming lane, and a two-session tug-of-war over one string is
// worse than the string. Reported to the coordinator instead.

console.log('reportsRedesign: ok')

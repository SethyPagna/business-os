import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { STATS_PRESETS, activeStatsPreset, statsPresetRange } from '../src/components/shared/statsStripPresets.ts'
import { railEdges, railRevealTarget } from '../src/components/shared/kit/chipRailMath.ts'
import { DRAG_SCROLL_SELECTOR } from '../src/runtime/horizontalDragScroll.ts'

// R1 (owner, 2 Nov 2026): "the options available and presets (horizontal scrollability) are
// different", and the Reports "Overview" option button carried a dropdown arrow nobody needed.
//
// ChipRail + RailChip are the ONE row of choices now. This file pins, each with the plausible wrong
// shape beside it:
//   - the chips select exclusively and expose the right state to assistive tech;
//   - the keyboard walks the chips (skipping a disabled one, never wrapping) and leaves other keys
//     and other controls alone;
//   - the edge fade shows only on a side that still has content, and the open chip is revealed;
//   - the CSS: no scrollbar, a vertical swipe still scrolls the page (the old `pan-x` stole it),
//     one chip height with a larger touch height, one selected state, and enough contrast;
//   - AppSelect (the Reports "Overview" button and every option picker) has no arrow;
//   - every row listed in MIGRATED uses the shared component, and no source file hand-rolls an
//     overflow-x-auto row of toggle buttons any more.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
const mounted: MountedSurface[] = []
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  } finally {
    for (const surface of mounted.splice(0)) await surface.unmount()
  }
}

const harness = await createHarness()
const words: Record<string, string> = { quick_range: 'Quick range', date_time_range: 'Date and time range' }
for (const preset of STATS_PRESETS) words[preset.key] = preset.fallback
const t = (key: string) => words[key]
const chipsOf = (root: MemoryNode) => root.querySelectorAll('.chip-rail-item')
const pressed = (chip: MemoryNode) => chip.getAttribute('aria-pressed')

async function mountPresetRow(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ range: unknown; source: unknown }> = []
  const surface = await harness.mount({
    component: 'components/shared/StatsRangeRow.tsx',
    props: { range: statsPresetRange('today'), onRangeChange: (range: unknown, source: unknown) => calls.push({ range, source }), t, showTime: true, ...overrides },
    app: {},
    doubles: {},
  })
  mounted.push(surface)
  return { surface, calls }
}

await runTest('the date presets are one ChipRail: every preset in the standard order, exactly the active one pressed', async () => {
  const { surface } = await mountPresetRow()
  const rail = surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
  assert.equal(rail.getAttribute('role'), 'group')
  assert.equal(rail.getAttribute('aria-label'), 'Quick range', 'the row has an accessible name')
  assert.ok(rail.getAttribute('class')?.split(' ').includes('chip-rail'), 'it is the shared rail, not a hand-rolled row')
  const chips = chipsOf(rail)
  assert.deepEqual(chips.map((chip) => chip.textContent), STATS_PRESETS.map((preset) => preset.fallback))
  const active = chips.filter((chip) => pressed(chip) === 'true')
  assert.equal(active.length, 1, 'a wrong implementation marks every chip, or none, as chosen')
  assert.equal(active[0].textContent, 'Today')
  assert.ok(chips.every((chip) => chip.getAttribute('type') === 'button'))
})

await runTest('choosing a preset hands over that preset range and its id, for every preset', async () => {
  const { surface, calls } = await mountPresetRow()
  const rail = surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
  for (const preset of STATS_PRESETS) {
    const chip = chipsOf(rail).find((candidate) => candidate.textContent === preset.fallback)
    assert.ok(chip, preset.fallback)
    await surface.click(chip)
    const last = calls[calls.length - 1]
    assert.equal(last.source, preset.id)
    assert.deepEqual(last.range, statsPresetRange(preset.id))
  }
})

await runTest('a date-only host never receives times from a preset; a disabled row is inert', async () => {
  const dateOnly = await mountPresetRow({ showTime: false })
  const rail = dateOnly.surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
  await dateOnly.surface.click(chipsOf(rail).find((chip) => chip.textContent === 'Yesterday') as MemoryNode)
  const range = dateOnly.calls[0].range as { startTime: string; endTime: string }
  assert.deepEqual([range.startTime, range.endTime], ['', ''])
  await dateOnly.surface.unmount()
  const inert = await mountPresetRow({ disabled: true })
  const inertRail = inert.surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
  assert.ok(chipsOf(inertRail).every((chip) => chip.hasAttribute('disabled')))
})

await runTest('the active preset follows the range, including all-time and a custom range', async () => {
  for (const [range, expected] of [[statsPresetRange('7d'), 'Last 7 days'], [statsPresetRange('all'), 'All time']] as const) {
    const { surface } = await mountPresetRow({ range })
    const rail = surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
    assert.equal(chipsOf(rail).filter((chip) => pressed(chip) === 'true').map((chip) => chip.textContent).join(), expected)
    await surface.unmount()
  }
  const custom = { startDate: '2026-01-03', endDate: '2026-01-05', startTime: '', endTime: '' }
  assert.equal(activeStatsPreset(custom), null)
  const { surface } = await mountPresetRow({ range: custom })
  const rail = surface.find((node) => node.hasAttribute('data-date-presets'), 'the preset rail')
  assert.equal(chipsOf(rail).filter((chip) => pressed(chip) === 'true').length, 0, 'a custom range selects no preset')
})

await runTest('the scrolling layout makes the whole control row one rail, presets included', async () => {
  const { surface } = await mountPresetRow({ layout: 'scroll', showTime: false })
  const rail = surface.find((node) => node.hasAttribute('data-stats-range-controls'), 'the control rail')
  assert.ok(rail.getAttribute('class')?.split(' ').includes('chip-rail'))
  const presets = surface.find((node) => node.hasAttribute('data-date-presets'), 'the presets')
  assert.equal(chipsOf(presets).length, STATS_PRESETS.length)
  assert.ok(!presets.getAttribute('class')?.split(' ').includes('chip-rail'), 'presets are not a second, nested scroller')
  assert.ok(rail.getAttribute('class')?.split(' ').includes('[--chip-rail-h:2.5rem]'),
    'beside the 40px picker and Stats button the presets take the same 40px, on a mouse as on a finger')
})

async function mountRailChip(props: Record<string, unknown>, children = 'Chip') {
  const surface = await harness.mount({ component: 'components/shared/kit/ChipRail.tsx', exportName: 'RailChip', props: { ...props, children }, app: {}, doubles: {} })
  mounted.push(surface)
  return surface
}

await runTest('RailChip state: pressed for a toggle, aria-selected for a tab, nothing for a plain action', async () => {
  const states: Array<[Record<string, unknown>, Record<string, string | null>]> = [
    [{ selected: true }, { 'aria-pressed': 'true', role: null, 'aria-selected': null }],
    [{ selected: false }, { 'aria-pressed': 'false', role: null, 'aria-selected': null }],
    [{}, { 'aria-pressed': null, role: null, 'aria-selected': null }],
    [{ tab: true, selected: true }, { 'aria-pressed': null, role: 'tab', 'aria-selected': 'true' }],
    [{ tab: true }, { 'aria-pressed': null, role: 'tab', 'aria-selected': 'false' }],
  ]
  for (const [props, expected] of states) {
    const surface = await mountRailChip(props)
    const chip = surface.find((node) => node.tagName === 'BUTTON', 'the chip')
    for (const [attribute, value] of Object.entries(expected)) assert.equal(chip.getAttribute(attribute), value, `${JSON.stringify(props)} ${attribute}`)
    assert.equal(chip.getAttribute('type'), 'button', 'a chip never submits a form')
    await surface.unmount()
  }
})

await runTest('RailChip renders icon and badge around the label, takes a caller class, and clicks', async () => {
  let clicks = 0
  const surface = await mountRailChip({
    icon: React.createElement('i', { 'data-icon': '' }), badge: React.createElement('b', { 'data-badge': '' }, '3'),
    className: 'shrink-0', onClick: () => { clicks += 1 }, title: 'Tip',
  }, 'Label')
  const chip = surface.find((node) => node.tagName === 'BUTTON', 'the chip')
  assert.deepEqual(chip.childNodes.map((node) => node.nodeName.toLowerCase()), ['i', '#text', 'b'], 'icon, label, badge in that order')
  assert.ok(chip.getAttribute('class')?.split(' ').includes('chip-rail-item'))
  assert.ok(chip.getAttribute('class')?.split(' ').includes('shrink-0'))
  assert.equal(chip.getAttribute('title'), 'Tip')
  await surface.click(chip)
  assert.equal(clicks, 1)
})

function plainChip(label: string, extra: Record<string, unknown> = {}) {
  return React.createElement('button', { key: label, type: 'button', className: 'chip-rail-item', ...extra }, label)
}

async function mountRail(extra: Record<string, unknown> = {}) {
  const surface = await harness.mount({
    component: 'components/shared/kit/ChipRail.tsx',
    props: { label: 'Choices', children: [plainChip('A'), plainChip('B', { disabled: true }), plainChip('C'), plainChip('D'), React.createElement('input', { key: 'q', type: 'text' })], ...extra },
    app: {},
    doubles: {},
  })
  mounted.push(surface)
  const rail = surface.find((node) => node.hasAttribute('data-chip-rail'), 'the rail')
  const chip = (label: string) => chipsOf(rail).find((node) => node.textContent === label) as MemoryNode
  return { surface, rail, chip }
}

async function press(surface: MountedSurface, rail: MemoryNode, from: MemoryNode, key: string): Promise<boolean> {
  let prevented = false
  await surface.call(rail, 'onKeyDown', [{ key, target: from, defaultPrevented: false, preventDefault: () => { prevented = true } }])
  return prevented
}

const focused = () => (globalThis as unknown as { document: { activeElement: MemoryNode | null } }).document.activeElement?.textContent

await runTest('ChipRail keyboard: arrows and Home/End walk the chips, skip a disabled one and never wrap', async () => {
  const { surface, rail, chip } = await mountRail()
  assert.equal(rail.getAttribute('role'), 'group')
  assert.equal(rail.getAttribute('aria-label'), 'Choices')
  assert.equal(await press(surface, rail, chip('A'), 'ArrowRight'), true)
  assert.equal(focused(), 'C', 'B is disabled, so the arrow lands on C')
  await press(surface, rail, chip('C'), 'ArrowLeft')
  assert.equal(focused(), 'A')
  await press(surface, rail, chip('A'), 'ArrowLeft')
  assert.equal(focused(), 'A', 'no wrap past the first chip')
  await press(surface, rail, chip('D'), 'ArrowRight')
  assert.equal(focused(), 'D', 'no wrap past the last chip')
  await press(surface, rail, chip('A'), 'End')
  assert.equal(focused(), 'D')
  await press(surface, rail, chip('D'), 'Home')
  assert.equal(focused(), 'A')
})

await runTest('ChipRail keyboard leaves other keys, other controls and a caller handler alone', async () => {
  const seen: string[] = []
  const { surface, rail, chip } = await mountRail({ onKeyDown: (event: { key: string }) => seen.push(event.key), role: 'tablist' })
  assert.equal(rail.getAttribute('role'), 'tablist')
  assert.equal(await press(surface, rail, chip('A'), 'a'), false, 'a letter is not swallowed')
  assert.equal(await press(surface, rail, chip('A'), 'Enter'), false, 'Enter still activates the focused chip')
  const input = rail.querySelector('input') as MemoryNode
  assert.equal(await press(surface, rail, input, 'ArrowRight'), false, 'an arrow inside a text field belongs to the field')
  assert.deepEqual(seen, ['a', 'Enter', 'ArrowRight'], 'the caller handler still sees every key')
})

await runTest('ChipRail with stretch carries the equal-share modifier', async () => {
  const plain = await mountRail()
  assert.ok(!plain.rail.getAttribute('class')?.split(' ').includes('chip-rail-stretch'))
  await plain.surface.unmount()
  const stretched = await mountRail({ stretch: true, className: 'lg:hidden' })
  assert.deepEqual(stretched.rail.getAttribute('class')?.split(' '), ['chip-rail', 'chip-rail-stretch', 'lg:hidden'])
})

await runTest('edge fade: only on a side that still has content', () => {
  assert.deepEqual(railEdges(0, 300, 300), { start: false, end: false }, 'a row that fits fades nowhere (the wrong shape fades both always)')
  assert.deepEqual(railEdges(0, 301, 300), { start: false, end: false }, 'a sub-slack overflow is not worth a fade')
  assert.deepEqual(railEdges(0, 600, 300), { start: false, end: true }, 'at the start the content continues to the right only')
  assert.deepEqual(railEdges(150, 600, 300), { start: true, end: true })
  assert.deepEqual(railEdges(300, 600, 300), { start: true, end: false }, 'at the end the content continues to the left only')
  assert.deepEqual(railEdges(299, 600, 300), { start: true, end: false }, 'sub-pixel scroll positions count as the end')
  assert.deepEqual(railEdges(0, Number.NaN, Number.NaN), { start: false, end: false }, 'an unmeasured row (no layout) draws no fade')
})

await runTest('revealing the open chip scrolls just enough, clear of the fade, and never when already visible', () => {
  const fade = 24
  assert.equal(railRevealTarget(0, 300, 40, 60, fade), 0, 'already visible: untouched (a user scroll is not fought)')
  assert.equal(railRevealTarget(0, 300, 280, 80, fade), 80 + 280 - 300 + fade, 'off the right edge: its right side lands just inside the fade')
  assert.equal(railRevealTarget(500, 300, 100, 60, fade), 76, 'off the left edge: its left side lands just inside the fade')
  assert.equal(railRevealTarget(40, 300, 0, 60, fade), 0, 'the first chip never scrolls below zero')
  assert.equal(railRevealTarget(100, 300, 110, 60, fade), 86, 'inside the fade margin counts as hidden under the fade')
})

await runTest('the mouse can drag a ChipRail like every other shared scroller', () => {
  assert.match(DRAG_SCROLL_SELECTOR, /\.chip-rail\b/)
})

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} rule exists`)
  return css.slice(start, css.indexOf('}', start))
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
function flat(rule: string, token: string): string {
  const found = rule.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, 'i'))
  assert.ok(found, `${token} has a flat hex value ahead of any color-mix()`)
  return found[1]
}

await runTest('CSS: one row geometry with no scrollbar, a swipe that still scrolls the page, and an edge fade', () => {
  const css = src('styles/main.css')
  const rail = block(css, ':where(.chip-rail)')
  assert.match(rail, /overflow-x:\s*auto/)
  assert.match(rail, /scrollbar-width:\s*none/)
  assert.match(rail, /-ms-overflow-style:\s*none/)
  assert.match(rail, /overscroll-behavior-inline:\s*contain/)
  assert.match(rail, /flex-wrap:\s*nowrap/)
  assert.match(rail, /touch-action:\s*manipulation/, 'touch panning stays native and pinch-zoom survives')
  assert.doesNotMatch(rail, /touch-action:\s*pan-x\b(?!\s+pan-y)/, 'pan-x alone stopped a vertical swipe that started on the row from scrolling the page')
  assert.match(block(css, '.chip-rail::-webkit-scrollbar'), /display:\s*none/)
  assert.match(css, /\.chip-rail\[data-fade-start='true'\]\s*\{\s*mask-image:\s*linear-gradient\(to right/)
  assert.match(css, /\.chip-rail\[data-fade-end='true'\]\s*\{\s*mask-image:\s*linear-gradient\(to left/)
  assert.match(css, /\[data-fade-start='true'\]\[data-fade-end='true'\]\s*\{\s*mask-image:[^;]*calc\(100% - var\(--chip-rail-fade\)\)/, 'both edges fade together')
  assert.match(css, /@media \(pointer: coarse\)\s*\{\s*:where\(\.chip-rail\)\s*\{\s*--chip-rail-h:\s*2\.5rem/, 'a larger target on touch')
})

await runTest('CSS: one chip, one selected state for toggles and tabs, a visible focus ring, a Khmer line-height floor', () => {
  const css = src('styles/main.css')
  const item = block(css, '.chip-rail-item')
  assert.match(item, /min-height:\s*var\(--chip-rail-h/)
  assert.match(item, /white-space:\s*nowrap/)
  assert.match(item, /flex:\s*0 0 auto/, 'a chip keeps its width; the row scrolls instead of squeezing a label')
  assert.match(item, /font-size:\s*var\(--ui-chip-size, 12px\)/)
  assert.match(css, /\.chip-rail-item\[aria-pressed='true'\],\s*\.chip-rail-item\[aria-selected='true'\]\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 0/, 'the open chip carries a rule as well as a colour')
  assert.match(css, /\.chip-rail-item:focus-visible\s*\{[^}]*outline:\s*2px solid[^}]*outline-offset:\s*-2px/, 'the ring sits inside the box, so the row clipping cannot cut it')
  assert.match(css, /body\.lang-km \.chip-rail-item\s*\{\s*line-height:\s*var\(--km-line-height/)
  assert.match(css, /\.chip-rail-stretch > \.chip-rail-item\s*\{\s*flex:\s*1 0 auto/)
  assert.match(css, /:where\(\.chip-rail\)\s*\{/, 'the base rule has zero specificity so a caller layout utility still wins')
})

await runTest('CSS: contrast of resting and open chips, light and dark, is at least 4.5:1', () => {
  const css = src('styles/main.css')
  const light = block(css, ':where(.chip-rail)')
  const dark = block(css, '.dark .chip-rail')
  const pairs: Array<[string, string, string, string]> = [
    ['light resting', flat(light, '--chip-ink'), flat(light, '--chip-ground'), ''],
    ['light open', flat(light, '--chip-open-ink'), flat(light, '--chip-open-ground'), ''],
    ['light hover', flat(light, '--chip-hover-ink'), flat(light, '--chip-hover-ground'), ''],
    ['dark resting', flat(dark, '--chip-ink'), flat(dark, '--chip-ground'), ''],
    ['dark open', flat(dark, '--chip-open-ink'), flat(dark, '--chip-open-ground'), ''],
    ['dark hover', flat(dark, '--chip-hover-ink'), flat(dark, '--chip-hover-ground'), ''],
  ]
  for (const [label, ink, ground] of pairs) assert.ok(contrast(ink, ground) >= 4.5, `${label}: ${ink} on ${ground} is ${contrast(ink, ground).toFixed(2)}:1`)
  const openLight = contrast(flat(light, '--chip-open-ink'), flat(light, '--chip-ground'))
  assert.ok(openLight >= 3, 'the open chip text also reads on the resting tint')
})

await runTest('AppSelect (the Reports "Overview" button and every option picker) draws no dropdown arrow', () => {
  const select = src('components/shared/AppSelect.tsx')
  assert.doesNotMatch(select, /chevron-down|ChevronDown|showChevron/i, 'the arrow icon and its prop are gone')
  assert.match(select, /aria-haspopup="listbox"[\s\S]*aria-expanded=\{open\}/, 'it still announces itself as a popup picker')
  assert.match(select, /aria-expanded:ring-2/, 'the open state is shown on the field itself')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(here, '..', 'src', dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(relative)
      else if (/\.(tsx|ts)$/.test(entry.name) && /showChevron/.test(src(relative))) offenders.push(relative)
    }
  }
  walk('components')
  assert.deepEqual(offenders, [], 'no caller still passes the removed prop')
  const hub = src('components/sales/ReportsHub.tsx')
  assert.match(hub, /const viewPicker = \(\s*<span className="reports-view-picker"[\s\S]*?<AppSelect[\s\S]*?\/>\s*<\/span>/)
})

// Every row the owner's two complaints cover. Each must reach the shared component; the second
// list is what each one used to hand-roll and must be gone.
const MIGRATED: Array<{ file: string; rails: number; stale: RegExp[] }> = [
  { file: 'components/shared/StatsRangeRow.tsx', rails: 2, stale: [/stats-date-presets/, /h-10 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs/, /bg-slate-800 text-white/] },
  { file: 'components/sales/ReportsHub.tsx', rails: 1, stale: [/reports-mobile-preset/] },
  { file: 'components/shared/DateTimeRangePicker.tsx', rails: 1, stale: [/hover:border-blue-300 hover:text-blue-700/] },
  { file: 'components/shared/HubSectionNav.tsx', rails: 1, stale: [/hub-section-pill\b/, /bos-nav-chrome hub-section-pills/, /useActivePillScroll/, /md:inline-flex/] },
  { file: 'components/products/Products.tsx', rails: 1, stale: [/hub-section-pill\b/, /bos-nav-chrome hub-section-pills/, /useActivePillScroll/, /sectionPillsRef/] },
  { file: 'components/contacts/CustomersTab.tsx', rails: 1, stale: [/inline-flex flex-nowrap rounded-xl bg-gray-100 p-0\.5/] },
  { file: 'components/contacts/SuppliersTab.tsx', rails: 1, stale: [/inline-flex flex-nowrap rounded-xl bg-gray-100 p-0\.5/] },
  { file: 'components/contacts/SupplierInvoicesSection.tsx', rails: 1, stale: [/inline-flex flex-nowrap rounded-xl bg-gray-100 p-0\.5/, /activeColor/] },
  { file: 'components/branches/Branches.tsx', rails: 1, stale: [/-mb-px border-b-2 px-4 py-2 text-sm font-medium/] },
  { file: 'components/inventory/Inventory.tsx', rails: 1, stale: [/border-b-2 transition-colors -mb-px/] },
  { file: 'components/inventory/StockConditionTagRow.tsx', rails: 1, stale: [/SEGMENT_BASE/, /SEGMENT_ON/, /overflow-x-auto/] },
  { file: 'components/review/ReviewQueue.tsx', rails: 2, stale: [/scrollbar-none py-1/, /bg-blue-600 text-white/] },
  { file: 'components/utils-settings/AuditLog.tsx', rails: 1, stale: [/overscroll-x-contain pb-1" data-audit-scope-chips/] },
  { file: 'components/products/ProductDataGapsSection.tsx', rails: 1, stale: [/bg-amber-100 text-amber-900/, /\[scrollbar-width:none\]/] },
  { file: 'components/products/ProductsImageOnlyControls.tsx', rails: 1, stale: [/stats-date-presets/] },
  { file: 'components/products/StockChangeSection.tsx', rails: 1, stale: [/inline-flex rounded-xl bg-gray-100 p-0\.5/] },
  { file: 'components/products/surfaces/ProductDetailReport.tsx', rails: 1, stale: [/mb-1\.5 inline-flex rounded-lg bg-gray-100 p-0\.5/] },
  { file: 'components/receipt-settings/ReceiptSettings.tsx', rails: 1, stale: [/whitespace-nowrap rounded-lg px-2\.5 py-1\.5 text-xs font-medium transition-colors sm:px-3/] },
  { file: 'components/products/forms/ProductForm.tsx', rails: 1, stale: [/-mb-px min-h-11 shrink-0 border-b-2/] },
  { file: 'components/users/UserProfileModal.tsx', rails: 1, stale: [/ProfileSectionButton/, /\[scrollbar-width:thin\]">\s*<ProfileSection/] },
  { file: 'components/catalog/CatalogEditorSurface.tsx', rails: 1, stale: [/rounded-full px-3 py-2 text-xs font-semibold transition/] },
  { file: 'components/sales/SaleStatusWorkflow.tsx', rails: 1, stale: [/min-h-11 shrink-0 whitespace-nowrap rounded-lg border border-gray-300/] },
  { file: 'components/dashboard/Dashboard.tsx', rails: 3, stale: [/role="tablist" aria-label=\{t\('dashboard'\) \|\| 'Dashboard'\}>\s*\{MOBILE_SECTIONS/, /inline-flex w-full max-w-full rounded-lg bg-slate-100 p-0\.5/, /inline-flex min-w-max rounded-lg bg-slate-100 p-0\.5/] },
]

await runTest('every migrated row uses ChipRail and none of its old hand-rolled markup is left', () => {
  for (const { file, rails, stale } of MIGRATED) {
    const source = src(file)
    assert.match(source, /import ChipRail(, \{ RailChip \})? from '(\.\.\/)+(shared\/)?kit\/ChipRail\.tsx'|import ChipRail(, \{ RailChip \})? from '\.\/kit\/ChipRail\.tsx'/, `${file} imports the shared rail`)
    assert.equal((source.match(/<ChipRail\b/g) || []).length, rails, `${file} renders exactly ${rails} shared row(s): a row swapped back to a hand-rolled div is a red`)
    assert.equal((source.match(/<\/ChipRail>/g) || []).length, (source.match(/<ChipRail\b/g) || []).length - (source.match(/<ChipRail\b[^>]*\/>/g) || []).length, `${file}: every rail is closed as a ChipRail`)
    for (const pattern of stale) assert.doesNotMatch(source, pattern, `${file} still holds ${pattern}`)
  }
})

await runTest('the retired preset and hub-pill code is gone everywhere', () => {
  const css = src('styles/main.css')
  assert.doesNotMatch(css, /\.stats-date-presets/, 'the old preset-rail class (touch-action: pan-x) is retired')
  assert.doesNotMatch(src('components/sales/reports/reports-surface.css'), /reports-mobile-preset/)
  const chrome = src('components/navigation/nav-chrome.css')
  assert.doesNotMatch(chrome, /\.hub-section-pill\b|\.hub-section-pills\s*\{/, 'the brass well and pill rules moved into the shared chip')
  assert.match(chrome, /\.hub-section-rule\s*\{/, 'the rule under the hub row stays chrome-owned')
  assert.equal(fs.existsSync(path.join(here, '..', 'src/components/shared/useActivePillScroll.ts')), false, 'ChipRail reveals the open chip itself')
  const leftovers: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(here, '..', 'src', dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(relative)
      else if (/\.(tsx|ts|css)$/.test(entry.name) && /stats-date-presets|reports-mobile-preset|useActivePillScroll/.test(src(relative))) leftovers.push(relative)
    }
  }
  walk('components')
  walk('styles')
  assert.deepEqual(leftovers, [])
})

// A scrolling row of toggle buttons is a ChipRail. These rows keep their own markup on purpose:
// the toggle-looking buttons in them are not choices (a card's own action, a modal's equal-width
// grid, the public storefront's own design system).
const AD_HOC_ROW_EXEMPT = new Set<string>([
  'components/catalog/CatalogPreviewSurface.tsx',
  'components/catalog/CatalogProductsSection.tsx',
  'components/catalog/PortalSocialRow.tsx',
  'components/shared/FilterMenu.tsx',
])

await runTest('no source file hand-rolls an overflow-x-auto row of aria-pressed / tab buttons any more', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(here, '..', 'src', dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) { walk(relative); continue }
      if (!/\.tsx$/.test(entry.name) || AD_HOC_ROW_EXEMPT.has(relative)) continue
      const lines = src(relative).split('\n')
      lines.forEach((line, index) => {
        if (!/overflow-x-auto/.test(line) || /^\s*(\/\/|\*|\{\/\*)/.test(line)) return
        const body = lines.slice(index, index + 14).join('\n')
        if (/aria-pressed=\{|role="tab"/.test(body)) offenders.push(`${relative}:${index + 1}`)
      })
    }
  }
  walk('components')
  assert.deepEqual(offenders, [], 'migrate these to ChipRail/RailChip or add them, with the reason, to AD_HOC_ROW_EXEMPT')
})

await harness.close()
if (failed) {
  console.error(`${failed} chipRail test(s) failed`)
  process.exit(1)
}
console.log('chipRail tests passed')

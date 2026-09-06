// The Reports surface as a DOCUMENT (owner, 2026-09-06 07:00 UTC):
//
//   "For reports, in small and large screens move them more to the
//    center...compact them, use borders for all segments like up down, left
//    and right, so see line borders... ios pwa seems very left edged, meaning
//    no margins properly... and make the khmer text larger, as it is report,
//    and has so much space."
//
// Four properties, pinned here because all four are pure CSS/markup shape and
// none of them can be caught by a behavioural test:
//
//   1. CENTERED, WITH REAL GUTTERS, on every width.
//      ROOT CAUSE of the "very left edged" iOS PWA render: ReportsHub.tsx
//      rendered `embedded ? 'space-y-2' : 'space-y-2 p-2 sm:p-3'`, and
//      SalesHubPage.tsx is the ONLY mount point -- it always passes
//      `embedded`. So the padded branch was dead code and the hub carried
//      ZERO horizontal padding below 768px (reports-surface.css only starts
//      padding at `@media (min-width: 768px)`). The app shell's own
//      `pl-[env(safe-area-inset-left)]` on <main> (App.tsx) is 0px in
//      portrait -- which is exactly how an iPhone holds a PWA -- so nothing
//      at all stood between the report and the display edge. The gutter is
//      now owned by reports-surface.css, unconditionally, with the safe-area
//      inset as a FLOOR (max(), not +, so it cannot double-count the shell's
//      inset in landscape).
//
//   2. COMPACT: the segment inset is a hairline, not room to fill.
//
//   3. BORDERS ON ALL FOUR SIDES of every segment, through ONE shared
//      `.report-segment` class -- not per-file border soup -- including the
//      md+ layouts that used to drop them (ReceiptSheet's
//      `md:border-0 md:bg-transparent`).
//
//   4. KHMER LARGER inside the report surface only. Driven by a single
//      `--ui-km-boost` multiplier that every size token in the surface is
//      expressed against, so the boost survives the desktop tier's own
//      larger sizes instead of being overwritten by them -- and the row
//      height / receipt line box are derived from the boosted body size, so
//      the Aug-31 clipping root cause (a short line box under an
//      `overflow:hidden` ancestor shears Khmer ascenders/descenders) cannot
//      come back at the larger size.
//
// Run: node tests/reportDocumentSurface.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// This checkout is core.autocrlf=true, so every source file arrives with CRLF
// on disk. Normalise once here: these are shape assertions about declarations,
// never about line endings.
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

const css = read('src/components/sales/reports/reports-surface.css')
const hub = read('src/components/sales/ReportsHub.tsx')
const hubPage = read('src/components/sales/SalesHubPage.tsx')
const frame = read('src/components/sales/reports/ReportFrame.tsx')
const sheet = read('src/components/sales/reports/ReceiptSheet.tsx')
const optionsFold = read('src/components/sales/reports/ReportOptionsFold.tsx')
const denseTable = read('src/components/shared/kit/DenseTable.tsx')
// Comments in these files deliberately quote the retired class names -- that is
// where the root cause is recorded -- so shape checks read the CODE only.
const stripComments = (source: string) => source.replace(/^[ \t]*\/\/.*$/gm, '')
const hubCode = stripComments(hub)
const sheetCode = stripComments(sheet)

const VIEWS = ['OverviewReport', 'PeriodReport', 'GroupedReport', 'SalesListReport', 'ReturnsReport', 'ExpensesReport'] as const
const viewSource = Object.fromEntries(VIEWS.map((v) => [v, read(`src/components/sales/reports/${v}.tsx`)])) as Record<string, string>

/** The declaration block of the FIRST rule whose selector list matches exactly. */
function ruleBody(source: string, selector: string, from = 0): string {
  // Tolerates the two-space indent a rule picks up inside a @media block, and
  // finds that rule's own closing brace at the same indent.
  const escaped = selector
    .split('\n')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\n[ \\t]*')
  const found = new RegExp('\\n([ \\t]*)' + escaped + ' \\{').exec(source.slice(from))
  assert.ok(found, `reports-surface.css declares a \`${selector}\` rule`)
  const open = from + found!.index + found![0].length
  const close = source.indexOf(`\n${found![1]}}`, open)
  assert.ok(close > open, `\`${selector}\` rule is closed`)
  return source.slice(open, close)
}

// ---------------------------------------------------------------------------
// 1a. The unconditional gutter, with the safe-area inset as a floor.
// ---------------------------------------------------------------------------
const base = ruleBody(css, '[data-reports-hub]')
assert.match(
  base,
  /padding-inline:\s*max\(12px,\s*env\(safe-area-inset-left,\s*0px\)\)\s+max\(12px,\s*env\(safe-area-inset-right,\s*0px\)\)\s*;/,
  'the hub carries a side gutter at EVERY width, floored by the safe-area inset -- this is the fix for the left-edged iOS PWA render',
)
// `max()`, never `+`: <main> in App.tsx already pads by the physical inset
// below md, so adding it a second time would double-count it in landscape.
assert.doesNotMatch(base, /padding-inline:[^;]*calc\([^;]*env\(safe-area-inset/, 'the gutter must not ADD the inset on top of the shell inset -- it floors it')
// Every env() in this file keeps its 0px fallback: a bare env() is an invalid
// declaration on a browser without the feature, which would silently drop the
// whole padding-inline and reproduce the bug on desktop Firefox.
const cssDeclarations = css.replace(/\/\*[\s\S]*?\*\//g, '')
for (const call of cssDeclarations.match(/env\([^)]*\)/g) || []) {
  assert.match(call, /,\s*0px\)$/, `${call} must carry its 0px fallback`)
}
// No horizontal page scroll at 375: the gutter is padding inside a clipped,
// max-width-bounded box, and every wide table owns its own scroller.
assert.match(base, /overflow-x:\s*clip/, 'the hub still clips rather than scrolling the page sideways')
assert.match(denseTable, /overflow-x-auto rounded-\[var\(--ui-radius\)\] border border-\[var\(--ui-line\)\]/, 'wide tables scroll inside their own bordered frame, never the page')

// ---------------------------------------------------------------------------
// 1b. The dead `embedded` padding fork is gone (root cause, not a patch).
// ---------------------------------------------------------------------------
assert.doesNotMatch(hubCode, /embedded \? 'space-y-2' : 'space-y-2 p-2 sm:p-3'/, 'the padding fork that never ran is removed')
// Code only -- the comment above the signature deliberately still names the
// retired prop, because that is where the root cause is recorded.
assert.doesNotMatch(hubCode, /\bembedded\b/, 'ReportsHub no longer takes a prop it cannot act on')
assert.match(hubCode, /export default function ReportsHub\(\) \{/, 'the hub takes no layout props at all')
assert.doesNotMatch(hubPage, /<ReportsSection embedded \/>/, 'the only mount point stops passing the retired prop')
assert.match(hubPage, /<ReportsSection \/>/, 'the Reports section still mounts')
assert.match(hub, /className="space-y-2" data-reports-hub/, 'the hub root keeps one constant class list; the gutter lives in CSS')

// ---------------------------------------------------------------------------
// 1c. A centred document column on large screens, from the FIRST desktop tier.
// ---------------------------------------------------------------------------
// Superseded contract: the earlier lane capped at 96rem (1536px) and only from
// 1536px up, so at 1280-1535 the report ran the full content width and at 1920
// it was still a 1536px slab. The owner asked for it "more to the center" and
// "compact"; 74rem (1184px) is a reading width that still fits the widest
// report table's columns, and capping from 1024px means every desktop tier is
// centred rather than only the widest one.
const desktop = ruleBody(css, '[data-reports-hub]', css.indexOf('@media (min-width: 1024px)'))
assert.match(desktop, /width:\s*100%;/, 'an explicit width, so the auto margins centre the cap instead of collapsing the flex item to fit-content (CSS Flexbox 9.6)')
assert.match(desktop, /max-width:\s*74rem;/, 'the document column is capped at a reading width')
assert.match(desktop, /margin-inline:\s*auto;/, 'and centred')
assert.doesNotMatch(css, /max-width:\s*96rem/, 'the old 1536-only 96rem slab is gone')
// The cap must come from the 1024 tier, not a wider one, or 1024-1535 stays
// uncentred.
assert.ok(css.indexOf('max-width: 74rem') < css.indexOf('@media (min-width: 1280px)'), 'the cap is declared in the 1024 tier, so every desktop width is centred')
// The existing gutter ladder is untouched: wider screens keep winning.
const ladder = ['@media (min-width: 768px)', '@media (min-width: 1024px)', '@media (min-width: 1280px)', '@media (min-width: 1536px)']
for (let i = 1; i < ladder.length; i += 1) {
  assert.ok(css.indexOf(ladder[i - 1]) < css.indexOf(ladder[i]), `${ladder[i - 1]} must precede ${ladder[i]}`)
}

// ---------------------------------------------------------------------------
// 2 + 3. One shared segment class: four visible sides, hairline inset.
// ---------------------------------------------------------------------------
const segment = ruleBody(css, '.report-segment')
assert.match(segment, /border:\s*1px solid var\(--ui-line\);/, 'one border shorthand -- top, right, bottom AND left, in the surface line token')
assert.match(segment, /background:\s*var\(--ui-surface\);/, 'a segment reads as a sheet, so its border is visible against the ground')
assert.match(segment, /border-radius:\s*var\(--ui-radius-lg\);/)
// Compact: the inset exists only so the hairline never touches ink.
const padding = segment.match(/\n\s*padding:\s*([^;]+);/)
assert.ok(padding, '.report-segment states its inset explicitly')
for (const px of padding![1].trim().split(/\s+/)) {
  const n = Number(px.replace('px', ''))
  assert.ok(/^\d+px$/.test(px) && n <= 8, `.report-segment inset ${px} stays a hairline gutter (<=8px); the extra room goes to margins and type, never inside the card`)
}

// Every report VIEW is a segment, and it is a segment exactly once: they all
// render through ReportFrame, so the class goes there and nowhere else.
assert.match(frame, /className=\{\['report-segment min-w-0 space-y-1\.5', className\]/, 'ReportFrame -- the one shell every view renders inside -- is the segment')
for (const view of VIEWS) {
  assert.match(viewSource[view], /<ReportFrame/, `${view} renders inside ReportFrame, so it inherits the segment border`)
  assert.doesNotMatch(viewSource[view], /report-segment/, `${view} must not re-declare the border itself (one shared class, not per-file border soup)`)
}

// The hub's own segments.
assert.match(hub, /className="reports-desktop-controls report-segment"/, 'the desktop control row is bordered like every other segment (it had no border at all)')
assert.match(ruleBody(css, '.reports-mobile-controls'), /border:\s*1px solid var\(--ui-line\);/, 'the compact control card keeps its four sides')
assert.match(hub, /<section className="report-segment flex min-w-0 flex-wrap/, 'the shift-history block uses the shared segment instead of its own gray-200 border')
assert.doesNotMatch(hubCode, /rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900/, 'the hand-rolled border is gone')

// The options fold's groups.
assert.match(optionsFold, /<div className="report-segment space-y-1">/, 'each options group is its own bordered segment')

// ReceiptSheet: the md+ layout used to drop the frame entirely.
assert.doesNotMatch(sheetCode, /md:border-0/, 'the receipt sheet keeps its frame at md+ -- the owner wants the lines visible')
assert.doesNotMatch(sheetCode, /md:bg-transparent/)
assert.doesNotMatch(sheetCode, /md:p-0/)
assert.doesNotMatch(sheetCode, /border-dashed/, 'blocks are bordered cards on all four sides, not separated by a single dashed rule')
assert.match(sheet, /'report-segment'/, 'every receipt card is the shared segment, at every width (not only md+)')
assert.doesNotMatch(sheetCode, /md:rounded-\[var\(--ui-radius\)\] md:border md:border-solid/, 'the md-only card treatment is replaced by the always-on segment')
// A bordered card supplies its own inset, so the old negative-margin bleed
// (-mx-1) that used to reach outside the tape must not survive it.
assert.doesNotMatch(sheetCode, /-mx-1/, 'no negative margins pulling a card back out through its own border')

// A segment that paints its own background creates an ORDER hazard for the
// two state tints: a `bg-[var(--ui-*-soft)]` utility is 0-1-0, exactly like
// `.report-segment`, and this file ships in the lazily loaded ReportsHub CSS
// chunk whose <link> lands after the utility sheet -- so the plain segment
// background would win and paint the tints out. The awaiting-payment tint is
// load-bearing (S4R3-6). Both states are decided by specificity instead.
assert.match(ruleBody(css, '.report-segment[data-segment-highlight=\'true\']'), /background:\s*var\(--ui-warn-soft\);/, 'the highlight tint outranks the segment background')
assert.match(ruleBody(css, '.report-segment[data-segment-highlight=\'true\']'), /border-color:\s*var\(--ui-warn-line\);/, 'and so does its border colour')
assert.match(ruleBody(css, '.report-segment[data-segment-selected=\'true\']'), /background:\s*var\(--ui-accent-soft\);/, 'the selected tint outranks it too')
assert.doesNotMatch(sheetCode, /bg-\[var\(--ui-warn-soft\)\]|bg-\[var\(--ui-accent-soft\)\]/, 'neither state may go back to an equal-specificity background utility')
assert.match(sheetCode, /'data-segment-selected': block\.selected \? 'true' : undefined/, 'the block states its selected state as data')
assert.match(sheetCode, /'data-segment-highlight': block\.highlight \? 'true' : undefined/, 'and its highlight state')
// Hover is fine as a utility: `.hover\:bg-...:hover` is already 0-2-0.
assert.match(sheetCode, /hover:bg-\[var\(--ui-surface-2\)\]/, 'the hover tint stays a utility -- a pseudo-class already outranks the segment')

// ---------------------------------------------------------------------------
// 4. Khmer type is larger inside the report surface only.
// ---------------------------------------------------------------------------
const scoped = ruleBody(css, '[data-reports-hub],\n[data-reports-fold]')
assert.match(scoped, /--ui-km-boost:\s*1;/, 'the surface declares a neutral boost so English is untouched')
assert.match(scoped, /--ui-size-body:\s*calc\(12px \* var\(--ui-km-boost, 1\)\);/, 'every size token is expressed against the boost')
assert.match(scoped, /--ui-size-meta:\s*calc\(11px \* var\(--ui-km-boost, 1\)\);/)
// The kit's heading tokens were never declared ANYWHERE on this line, so
// `text-[length:var(--ui-size-h2)]` was invalid at computed-value time and
// every report section title silently inherited body size. Declaring them
// here (scoped, so no other kit caller changes) is what makes a report title
// read as a title -- and lets Khmer scale it with everything else.
assert.match(scoped, /--ui-size-h2:\s*calc\(15px \* var\(--ui-km-boost, 1\)\);/, 'the section-title token exists at all')
assert.match(scoped, /--ui-size-h3:\s*calc\(14px \* var\(--ui-km-boost, 1\)\);/)
assert.match(scoped, /--ui-lh-heading:/)
assert.match(scoped, /--ui-font-display:/)
assert.doesNotMatch(ruleBody(css, ':root'), /--ui-size-h[123]/, 'the heading tokens stay scoped to this surface; other kit callers keep whatever they had')

// The desktop tier keeps the boost -- this is the assertion that separates a
// real fix from a boost that a later, equally specific rule silently erases.
assert.match(desktop, /--ui-size-body:\s*calc\(14px \* var\(--ui-km-boost, 1\)\);/, 'the 1024 tier multiplies the boost too, instead of overwriting the Khmer size with a flat px')
assert.match(desktop, /--ui-size-meta:\s*calc\(13px \* var\(--ui-km-boost, 1\)\);/)
assert.doesNotMatch(desktop, /--ui-size-body:\s*\d+px;/, 'no flat px size may reach the desktop tier; it would cancel the Khmer boost')

const km = ruleBody(css, 'body.lang-km [data-reports-hub],\nbody.lang-km [data-reports-fold]')
const boost = km.match(/--ui-km-boost:\s*([\d.]+);/)
assert.ok(boost, 'the Khmer block raises the boost')
assert.ok(Number(boost![1]) >= 1.15, `Khmer type must be materially larger, not a rounding nudge (found ${boost![1]})`)
// Clipping: the line box and the row must be derived from the BOOSTED body
// size, not from a frozen px value that was chosen for the smaller type.
assert.match(km, /--ui-receipt-lh:\s*calc\(var\(--ui-size-body\) \* 1\.62\);/, 'the receipt line box tracks the boosted size at 1.62em, the Khmer cluster ink extent')
assert.match(km, /--ui-row-h:\s*calc\(36px \* var\(--ui-km-boost, 1\)\);/, 'the table row grows with the type, or the taller line box clips inside it')
assert.doesNotMatch(km, /--ui-receipt-lh:\s*\d+px;/, 'a frozen 20px line box would shear the ascenders off the larger Khmer type')
assert.doesNotMatch(km, /--ui-row-h:\s*\d+px;/)
// And the Aug-31 line-height floor this surface already owns is untouched.
assert.match(css, /body\.lang-km \[data-reports-hub\] \.text-xs,[\s\S]{0,120}line-height: 1\.62 !important;/, 'the Khmer line-box floor for .text-xs survives')
assert.match(css, /body\.lang-km \[data-reports-hub\] \.text-sm,[\s\S]{0,120}line-height: 1\.6 !important;/, 'and for .text-sm')

// The receipt sheet's two hard-coded pixel sizes were the one place Khmer
// could not follow the boost (10px/11px inside a 1.62em box is unreadable).
assert.doesNotMatch(sheetCode, /text-\[11px\]/, 'the block meta size follows the surface token, so Khmer scales it')
assert.doesNotMatch(sheetCode, /text-\[10px\]/, 'and so does the line note')

// English is unchanged: nothing outside `body.lang-km` raises a size.
assert.equal((css.match(/--ui-km-boost:\s*1;/g) || []).length, 1, 'exactly one neutral boost declaration')

console.log('PASS report document surface: centred column with safe-area-floored gutters, four-sided segments through one shared class, boosted Khmer type that cannot clip')

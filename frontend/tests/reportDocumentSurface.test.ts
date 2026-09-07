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
const currentShift = read('src/components/shifts/CurrentShiftSummary.tsx')
const shiftSummary = read('src/components/shifts/ShiftSummary.tsx')
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
// 1a-bis. THE SAFE-AREA FLOOR HAS TO SURVIVE EVERY TIER.
//
// The base rule floors its gutter with the inset, but each wider tier
// RE-DECLARES `padding-inline` -- and re-declared it as a bare `clamp()`, which
// drops the inset again from 768px up. That is not a theoretical width: <main>
// (App.tsx:1943) carries `pl-[env(safe-area-inset-left)]
// pr-[env(safe-area-inset-right)] ... md:pl-0 md:pr-0`, so the SHELL stops
// paying the inset at exactly the same 768px breakpoint, and every modern
// iPhone in landscape -- the orientation in which the left/right inset is
// non-zero at all -- is >=812px wide. From md up NOTHING paid the inset and the
// report went back under the notch: the very defect the base rule exists to fix,
// restated one media query higher.
//
// Each tier is therefore `max(clamp(...), env(..., 0px))`: the design gutter
// normally, the physical inset when that is larger. Still a floor, never a sum
// -- below md the shell pays the inset and a `+` would double-count it.
// ---------------------------------------------------------------------------
const GUTTER_TIERS: Array<[string, string]> = [
  ['@media (min-width: 768px)', 'clamp(12px, 2vw, 24px)'],
  ['@media (min-width: 1024px)', 'clamp(28px, 3.5vw, 56px)'],
  ['@media (min-width: 1280px)', 'clamp(40px, 4vw, 64px)'],
  ['@media (min-width: 1536px)', 'clamp(56px, 4vw, 80px)'],
]
for (const [tierAt, gutter] of GUTTER_TIERS) {
  const tier = ruleBody(css, '[data-reports-hub]', css.indexOf(tierAt))
  assert.match(
    tier,
    /padding-inline:\s*max\(clamp\([^)]*\),\s*env\(safe-area-inset-left, 0px\)\)\s+max\(clamp\([^)]*\),\s*env\(safe-area-inset-right, 0px\)\)/,
    `${tierAt}: the gutter keeps the safe-area inset as a floor -- <main> stops paying it at md, and an iPhone in landscape is >=812px`,
  )
  assert.ok(tier.includes(gutter), `${tierAt} keeps its design gutter ${gutter} inside the max()`)
  assert.doesNotMatch(tier, /padding-inline:\s*clamp\(/, `${tierAt} must not re-declare a bare clamp(); that is what drops the inset the base rule established`)
  assert.doesNotMatch(tier, /padding-inline:[^;]*calc\([^;]*env\(safe-area-inset/, `${tierAt} floors the inset, never adds it`)
}

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
// 1d. SIBLING PARITY: every view's detail Fold joins the boosted scope --
//     and it joins it at the PANEL ROOT, not at the fold body.
//
// A `Fold` is PORTALLED to document.body, so it lands outside
// `[data-reports-hub]` and inherits none of this surface's tokens. Only the
// options fold carried the hook, which left the six report views' own
// detail/breakdown folds reading at the app-wide compacted size while the
// report behind them read at the boosted one -- exactly the sibling drift this
// lane exists to remove.
//
// Putting the hook on the div each view passes as CHILDREN fixed six sevenths
// of that and left the seventh in place, one level up: the panel's own header
// `<h3>` (Fold.tsx, both branches, `text-[length:var(--ui-size-h3)]`) is
// rendered by Fold, not by the caller, so it stayed OUTSIDE the scope. That
// title then had an undeclared `--ui-size-h3` (invalid at computed-value time
// -> inherited body size), no Khmer boost and none of the 1.62 line-height
// floor, sitting directly above body content that had all three. A report's
// own title reading smaller and tighter than the numbers under it is the same
// compaction/clipping drift this surface exists to remove.
//
// So the hook moves UP, onto the panel root, behind an OPT-IN `surface` flag
// -- Fold is the kit's level-2 container for the whole app and must not gain a
// report surface everywhere. Moving it cannot disturb the panel's geometry,
// and that is a property of the CSS rather than a hope: nothing scoped to
// `[data-reports-fold]` sets layout. Asserted, not trusted, at the end of this
// section.
//
// Split on the tag rather than a fixed character window: two of the seven
// folds (GroupedReport's grouped-row fold, PeriodReport's period fold) carry a
// multi-line `actions` prop, so their body starts ~480 chars past `<Fold`. The
// split form is also strictly stronger -- it proves the flag is on THAT fold,
// not merely nearby in the file.
// ---------------------------------------------------------------------------
const fold = read('src/components/shared/kit/Fold.tsx')
assert.match(fold, /surface\?: boolean/, 'Fold declares the opt-in flag; a caller cannot reach the panel root any other way')

// The opening tag ends at the first `>` OUTSIDE any `{...}` expression --
// `onClose={() => setOpen(null)}` puts a bare `>` inside the tag on almost
// every one of these call sites, so a plain indexOf('>') would cut the tag in
// half and the assertion below would read only part of the props.
const openingTag = (afterTag: string): string => {
  let depth = 0
  for (let i = 0; i < afterTag.length; i += 1) {
    const ch = afterTag[i]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) return afterTag.slice(0, i)
  }
  throw new Error('unterminated <Fold opening tag')
}
const CARRIES_FLAG = /(^|\s)surface(\s|$)/

const panels = fold.split('role="dialog"').slice(1)
assert.equal(panels.length, 2, 'Fold has exactly two panel roots -- the mobile bottom sheet and the desktop floating panel')
for (const [i, panel] of panels.entries()) {
  const attrs = panel.slice(0, panel.indexOf('className={'))
  assert.match(
    attrs,
    /data-reports-fold=\{surface \? '' : undefined\}/,
    `Fold panel root ${i + 1} of 2 must carry the hook, or that branch's header title renders outside the report surface`,
  )
}
assert.doesNotMatch(fold, /data-reports-fold=""/, 'and never unconditionally -- every non-report Fold in the app stays exactly as it was')

let foldTags = 0
for (const view of VIEWS) {
  const parts = viewSource[view].split(/<Fold[\s>]/).slice(1)
  assert.ok(parts.length > 0, `${view} opens at least one detail Fold`)
  for (const part of parts) {
    assert.match(
      openingTag(part),
      CARRIES_FLAG,
      `${view}: this Fold must be opened with \`surface\`, or its header title reads at the app-wide compacted size directly above boosted body content`,
    )
    foldTags += 1
  }
}
assert.equal(foldTags, 7, 'all seven view folds are accounted for (GroupedReport has two)')
assert.match(openingTag(optionsFold.split(/<Fold[\s>]/)[1]), CARRIES_FLAG, 'and the options fold, whose Group titles are the same shape, opts in too')

// The move is safe BY CONSTRUCTION, and this is the construction: no rule
// scoped to `[data-reports-fold]` may lay anything out. If a later change ever
// adds a width, a margin, an inline padding or a display to that scope, it
// would silently re-shape every report fold's panel -- so it fails here first.
//
// The budget splits on WHERE the attribute sits in the selector, because the
// two halves are not the same risk:
//   * a part that ENDS at `[data-reports-fold]` styles the panel root itself,
//     the element the hook was hoisted onto -- custom properties and
//     `line-height` only, exactly the budget it had before the hoist;
//   * a part with a descendant after it styles content the panel already
//     contained either way, so it may additionally carry `padding-block` --
//     the Khmer anti-clip relief, a text-box property that cannot move the
//     panel. Nothing else is allowed on that side either.
// `/* ... *​/` comments inside these blocks carry prose with semicolons and
// colons in it, so they are stripped before the declarations are split.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')
const cssRules = [...cssCode.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }))
const selectorList = (selector: string) => selector.split(',').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean)
const declaredProps = (body: string) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.slice(0, d.indexOf(':')).trim())
const foldScopedRules = cssRules.filter((rule) => selectorList(rule.selector).some((part) => part.includes('[data-reports-fold]')))
assert.ok(foldScopedRules.length >= 4, 'the fold scope is real (base tokens, the >=1024 tier and the Khmer rules)')
for (const rule of foldScopedRules) {
  const targetsPanelRoot = selectorList(rule.selector).some((part) => part.endsWith('[data-reports-fold]'))
  const alsoAllowed = targetsPanelRoot ? ['line-height'] : ['line-height', 'padding-block']
  for (const prop of declaredProps(rule.body)) {
    assert.ok(
      prop.startsWith('--') || alsoAllowed.includes(prop),
      targetsPanelRoot
        ? `[data-reports-fold] itself may only declare custom properties and line-height, so hoisting the hook to the panel root cannot move the panel -- found "${prop}"`
        : `inside [data-reports-fold] only custom properties, line-height and the padding-block clip relief may be declared -- found "${prop}" in "${selectorList(rule.selector).join(', ')}"`,
    )
  }
}

// The DESKTOP tier has to name the fold too, or a fold opened at >=1024 falls
// back to the 12px/11px root tokens while the hub behind it is at 14px/13px.
// DECISION: the 1024 tier is SPLIT in two. The SIZE half is shared with
// `[data-reports-fold]`; the LAYOUT half (gutter ladder, 74rem cap, auto
// margins) stays hub-only, because a floating panel with a 74rem cap, auto
// margins and a 56px gutter is not a document column -- it is a broken menu.
const desktopTokens = ruleBody(css, '[data-reports-hub],\n[data-reports-fold]', css.indexOf('@media (min-width: 1024px)'))
assert.match(desktopTokens, /--ui-size-body:\s*calc\(14px \* var\(--ui-km-boost, 1\)\);/, 'the desktop size tier covers the portalled fold as well as the hub')
assert.doesNotMatch(desktop, /--ui-size-/, 'the hub-only half of the 1024 tier carries layout, not sizes')
assert.doesNotMatch(desktopTokens, /max-width|margin-inline|padding-inline/, 'and the shared half carries sizes, not the document-column layout')
// DISCLOSED ENGLISH CHANGE, pinned so it cannot drift silently either way.
//
// At 6e3abfea only ReportOptionsFold.tsx carried `data-reports-fold`; the six
// views' detail Folds carried no scope at all and read the :root tokens
// (12px/11px) at every width, because the base 1024 tier named
// `[data-reports-hub]` alone. Naming the fold here moves ENGLISH fold type at
// >=1024: body 12px -> 14px, meta 11px -> 13px. That is deliberate -- a detail
// fold opened over a 14px report is a sibling of that report, not of the phone
// layout -- but it is a Latin-side change in a lane whose ask was Khmer size,
// so the exact intended numbers are asserted rather than left to drift.
assert.match(desktopTokens, /--ui-size-meta:\s*calc\(13px \* var\(--ui-km-boost, 1\)\);/, 'English fold/hub meta is 13px from 1024 up -- change this only with the owner')
assert.match(desktopTokens, /--ui-size-h2:\s*calc\(17px \* var\(--ui-km-boost, 1\)\);/, 'English section titles are 17px from 1024 up')
assert.match(desktopTokens, /--ui-size-h3:\s*calc\(15px \* var\(--ui-km-boost, 1\)\);/, 'English sub-titles are 15px from 1024 up')
// The multiplier is what makes those numbers Latin-only: at 1.0 they ARE the
// English sizes, and only the km block moves them.
assert.match(ruleBody(css, '[data-reports-hub],\n[data-reports-fold]'), /--ui-km-boost:\s*1;/, 'the boost is 1 for Latin, so every size above is literally the English size')

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

// ...AND the live-shift block, which was the one block inside [data-reports-hub]
// that never joined the segment system.
//
// VERIFIER DEFECT. `<CurrentShiftSummary showHistory={false} />` sat bare in the
// hub. It renders ShiftSummary, whose own class string is the IDENTICAL
// `rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700
// dark:bg-zinc-900` soup this lane deleted one line below -- so the report
// still showed a card bordered in gray-200 at a 12px inset where a --ui-line
// hairline belongs; and the block's other three states (loading <p>, failed
// <div>, no-shift <p>) plus the always-on live note carried no border at all,
// so the same block was a card or nothing depending on the network.
//
// ShiftSummary is also mounted by FeesPage, Sales and ShiftHistoryModal, so its
// own class string is NOT the place to fix this. The frame is supplied once by
// the wrapping segment and stripped from the inner card at the CALL.
assert.match(
  hubCode,
  /<section className="report-segment"[^>]*>\s*<CurrentShiftSummary\b/,
  'the live-shift block is wrapped in the shared segment, so it reads as exactly one bordered rectangle in every state',
)
assert.match(
  hubCode,
  /<CurrentShiftSummary showHistory=\{false\} summaryClassName="report-shift-plain"/,
  'and the hub strips the inner card\'s private frame, so the segment is not two nested rectangles',
)
for (const soup of ['border-gray-200', 'dark:border-zinc-700']) {
  assert.ok(!hubCode.includes(soup), `no second hand-rolled frame in the hub -- found "${soup}"`)
}
// The prop has to actually reach ShiftSummary. CurrentShiftSummary already
// accepted `className` and spent it on its own wrapper <div>, which is why the
// inner card was unreachable from the call site in the first place.
assert.match(currentShift, /summaryClassName\?: string/, 'CurrentShiftSummary takes the inner-card class explicitly')
assert.match(currentShift, /<ShiftSummary shift=\{state\.shift\} className=\{summaryClassName\} \/>/, 'and forwards it -- a prop that stops at the wrapper cannot strip the card')
// ...and it forwards it from INSIDE a wrapper of its own. That wrapper is the
// whole reason `summaryClassName` had to exist (`className` is spent on it) and
// it is also what makes `.report-shift-plain` a GRANDCHILD of the segment:
//
//   <section class="report-segment">              ReportsHub.tsx:458
//     <div class="space-y-2 ">                     CurrentShiftSummary.tsx:65 -- always rendered
//       <section class="... report-shift-plain">   ShiftSummary.tsx:42
//
// so a CHILD combinator between the segment and the stripped card matches
// nothing, and the gray-200 card goes on painting inside the --ui-line
// hairline. The DOM level and the selector are asserted together on purpose:
// greping the rule and greping the prop as two independent strings is exactly
// what let a rule that can never match ship as a fix.
assert.match(
  currentShift,
  /<div className=\{`space-y-2 \$\{className\}`\}>/,
  'CurrentShiftSummary always interposes a wrapper div between the segment and the card',
)
// The shared component is untouched: three non-report callers still want the card.
assert.match(shiftSummary, /className=\{`min-w-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 \$\{className\}`\}/, 'ShiftSummary keeps its own frame for FeesPage / Sales / ShiftHistoryModal')
// Stripping it is done by SPECIFICITY (0-3-0), not by utility order. The
// Tailwind utilities on that element are 0-1-0 and their dark: variants 0-2-0,
// and which of two equal-specificity rules paints depends on chunk order --
// the same argument .report-segment[data-segment-*] already makes above.
const shiftPlain = ruleBody(css, '[data-reports-hub] .report-segment .report-shift-plain')
assert.doesNotMatch(
  css,
  /\.report-segment\s*>\s*\.report-shift-plain/,
  'the stripped card is a grandchild of the segment: CurrentShiftSummary interposes its own wrapper div, so a child combinator here is dead',
)
assert.match(shiftPlain, /border:\s*0;/, 'the inner card gives up its border to the segment')
assert.match(shiftPlain, /background:\s*transparent;/, 'and its white fill, or the segment shows a sheet on a sheet')
assert.match(shiftPlain, /padding:\s*0;/, 'and its 12px inset -- compactness is not spent here')
assert.match(shiftPlain, /border-radius:\s*0;/, 'and its own radius, which would print a second corner inside the segment corner')

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

// ...and the sheet's own WRAPPER is a layout container, not a third frame.
//
// VERIFIER DEFECT (compactness). Making every receipt block a `.report-segment`
// (bordered, padded, on a surface) at the same time as giving the sheet wrapper
// a border/background/padding of its own produced THREE nested rectangles for
// one list: ReportFrame's segment, the sheet wrapper, then each card. The
// wrapper's `px-2 py-1.5` is also the most expensive padding in the layout --
// at 375px it took the receipt grid from 359px down to 301px, spending
// compactness on a rectangle that carries no information.
//
// The owner asked for line borders on every SEGMENT, and after this lane every
// segment has them on all four sides at every width: the view's ReportFrame
// outside the sheet, and each block's own card inside it. The wrapper between
// them is pure layout -- the centred 420px statement column, and the md+ card
// grid -- so it keeps only its width and grid classes.
assert.doesNotMatch(sheetCode, /max-w-\[(26rem|420px)\][^'\n]*\bborder\b/, 'the sheet wrapper must not add a third border between ReportFrame and the cards')
assert.doesNotMatch(sheetCode, /max-w-\[(26rem|420px)\][^'\n]*px-2 py-1\.5/, 'nor a third inset -- at 375px that padding cost the receipt grid 18px of content width')
assert.doesNotMatch(sheetCode, /max-w-\[(26rem|420px)\][^'\n]*bg-\[var\(--ui-surface\)\]/, 'nor a third surface fill')
assert.match(sheetCode, /\? 'mx-auto w-full max-w-\[420px\]'/, 'the centred statement wrapper is width + centring only')
assert.match(sheetCode, /: 'w-full max-w-\[26rem\] md:max-w-none md:grid md:grid-cols-2 md:gap-1\.5 xl:grid-cols-3'/, 'the tape/grid wrapper is width + grid only')

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
assert.match(desktopTokens, /--ui-size-body:\s*calc\(14px \* var\(--ui-km-boost, 1\)\);/, 'the 1024 tier multiplies the boost too, instead of overwriting the Khmer size with a flat px')
assert.match(desktopTokens, /--ui-size-meta:\s*calc\(13px \* var\(--ui-km-boost, 1\)\);/)
assert.doesNotMatch(desktopTokens, /--ui-size-body:\s*\d+px;/, 'no flat px size may reach the desktop tier; it would cancel the Khmer boost')

// 4c. WHERE THE BOOST IS OBSERVABLE -- the probe target, pinned.
//
// VERIFIER DEFECT (measurement). The lane's browser plan measured the Khmer
// boost as `getComputedStyle(document.querySelector('[data-reports-hub]'))
// .fontSize`. That reads the HUB ELEMENT, and this surface never sets
// `font-size` on it: the boost travels as `--ui-size-body`, which only the
// CONSUMERS of the token spend. So the probe returned the inherited <body>
// size in both languages -- the same number in en and km -- and a total loss
// of the boost would still have read as "expected".
//
// Two halves, pinned together so the plan's probe target cannot drift out
// from under the next reader: (a) the hub element is NOT a font-size source,
// and (b) the two elements the plan measures instead really do read the token.
for (const rule of cssRules) {
  for (const part of selectorList(rule.selector)) {
    if (!part.endsWith('[data-reports-hub]')) continue
    assert.ok(
      !declaredProps(rule.body).includes('font-size'),
      `"${part}" must not set font-size: this surface sizes text through --ui-size-body on its consumers, so a font-size on the hub would be a second, competing source of truth -- measure a consumer, not the hub`,
    )
  }
}
assert.match(denseTable, /text-\[length:var\(--ui-size-body\)\]/, 'DenseTable spends --ui-size-body -- `[data-reports-hub] table` is the probe target for every table view')
assert.match(sheetCode, /text-\[length:var\(--ui-size-body,12px\)\]/, 'and the receipt wrapper spends it too -- the probe target for receipt style')

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

// ...and the clip RELIEF has to cover every scope the boost covers.
//
// VERIFIER DEFECT. `Fold.tsx` portals its panel to `document.body`, so nothing
// rendered inside a report fold is a descendant of `[data-reports-hub]`. A
// relief rule scoped to the hub alone therefore skips every truncating cell in
// the seven `<Fold surface>` panels -- ReportTable's `max-w-[200px] truncate`
// text columns and ReceiptSheet's `min-w-0 truncate` labels -- which are
// exactly the cells the 1.2x boost pushes past their line box.
//
// Derived, not grepped for two literals: read the scopes OUT of the rule that
// raises the boost, then require each of them to appear in a truncate
// padding-block rule. Adding a third boosted scope later fails this too.
const boostScopes = cssRules
  .filter((rule) => Number((rule.body.match(/--ui-km-boost:\s*([\d.]+)\s*;/) || [])[1] ?? 1) > 1)
  .flatMap((rule) => selectorList(rule.selector))
assert.ok(boostScopes.length >= 2, `the Khmer boost must reach the portalled fold as well as the hub (found: ${boostScopes.join(' | ') || 'no boosted scope at all'})`)
const clipReliefScopes = new Set(
  cssRules
    .filter((rule) => /\.truncate/.test(rule.selector) && /padding-block/.test(rule.body))
    .flatMap((rule) => selectorList(rule.selector).map((part) => part.replace(/ (?:[a-z]+)?\.truncate$/, ''))),
)
for (const scope of boostScopes) {
  assert.ok(clipReliefScopes.has(scope), `a scope that boosts Khmer must also relieve its clip site -- \`${scope}\` has no \`.truncate { padding-block }\` rule (relieved: ${[...clipReliefScopes].join(' | ') || 'none'})`)
}

// ...and the boost REACHES only what carries one of those two hooks. Every
// other popover this surface portals to document.body leaves both scopes.
//
// VERIFIER DEFECT (undisclosed coverage gap). `Fold` was given an opt-in
// `surface` flag so its panel root carries `data-reports-fold`; four other
// components mounted inside the report portal their popup to document.body
// with NEITHER attribute on it, so their Khmer renders at the app-wide
// compacted size beside boosted report text:
//
//   AppSelect      the hub's view / range pickers   (ReportsHub.tsx:26)
//   ColumnChooser  the table column checklist       (ReportTable.tsx:210,:245)
//   InfoHint       the section-header help bubble   (ReportFrame.tsx:34)
//   PortalMenu     OverflowMenu's action menu       (kit/OverflowMenu.tsx)
//
// That is a deliberate, disclosed gap (lane not_done): all four are chrome
// -- a checklist, a tooltip, a dropdown, an action menu -- not the document
// the owner asked to enlarge, and each is a whole-app primitive whose other
// callers would have to be considered. What must NOT happen is the set
// growing in silence, so the set is DERIVED from the imports rather than
// asserted as four names: walk the reports surface's own imports, follow a
// barrel only for the names actually imported through it (or every kit
// component would count as "mounted"), and classify each file that calls
// `createPortal(..., document.body)` by whether it carries a surface hook.
const resolveImport = (from: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(from), spec)
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}
const relPath = (abs: string) => path.relative(root, abs).split(path.sep).join('/')
const sourceOf = (abs: string) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
// The import head may not contain a quote: `import './x.css'` has no head at
// all, and a greedy pairing would hand that statement the NEXT import's names.
const mountedBy = (file: string): string[] => {
  const out: string[] = []
  for (const statement of sourceOf(file).matchAll(/import\s+([^'"]*?)\s*from\s*'(\.[^']+)'/g)) {
    const target = resolveImport(file, statement[2])
    if (!target) continue
    if (!/index\.tsx?$/.test(target)) { out.push(target); continue }
    const barrel = sourceOf(target).split('\n')
    for (const name of [...statement[1].matchAll(/[{,]\s*(?:type\s+)?([A-Za-z0-9_]+)/g)].map((m) => m[1])) {
      for (const line of barrel) {
        if (!new RegExp(`\\b${name}\\b`).test(line)) continue
        const via = /from '(\.[^']+)'/.exec(line)
        const reExported = via && resolveImport(target, via[1])
        if (reExported) out.push(reExported)
      }
    }
  }
  return out
}
const reportsDir = path.join(root, 'src/components/sales/reports')
const mounted = new Set<string>([
  path.join(root, 'src/components/sales/ReportsHub.tsx'),
  ...fs.readdirSync(reportsDir).filter((f) => f.endsWith('.tsx')).map((f) => path.join(reportsDir, f)),
])
for (let frontier = [...mounted]; frontier.length; ) {
  const next: string[] = []
  for (const file of frontier) for (const target of mountedBy(file)) {
    if (mounted.has(target)) continue
    const rel = relPath(target)
    // The reports region plus the shared primitives it mounts. Other feature
    // areas (a shift-history modal opened FROM the report, say) are their own
    // surface and are out of scope here.
    if (!rel.startsWith('src/components/shared/') && !rel.startsWith('src/components/sales/reports/')) continue
    mounted.add(target)
    next.push(target)
  }
  frontier = next
}
const portalled = [...mounted]
  .filter((f) => /createPortal\(/.test(sourceOf(f)) && /document\.body/.test(sourceOf(f)))
  .map(relPath)
  .sort()
const boostedPortals = portalled.filter((f) => /data-reports-(hub|fold)/.test(read(f)))
assert.deepEqual(
  boostedPortals,
  ['src/components/shared/kit/Fold.tsx'],
  'the fold is the one portalled component that opts into the report surface',
)
assert.deepEqual(
  portalled.filter((f) => !boostedPortals.includes(f)),
  [
    'src/components/shared/AppSelect.tsx',
    'src/components/shared/ColumnChooser.tsx',
    'src/components/shared/InfoHint.tsx',
    'src/components/shared/PortalMenu.tsx',
  ],
  'these four popovers portal out of both boosted scopes -- a DISCLOSED gap (lane not_done). A new name here means a new portal was mounted inside the report and its Khmer silently reverted to the app-wide compacted size: either give it the `surface` opt-in Fold uses, or disclose it too',
)

// The receipt sheet's two hard-coded pixel sizes were the one place Khmer
// could not follow the boost (10px/11px inside a 1.62em box is unreadable).
assert.doesNotMatch(sheetCode, /text-\[11px\]/, 'the block meta size follows the surface token, so Khmer scales it')
assert.doesNotMatch(sheetCode, /text-\[10px\]/, 'and so does the line note')

// ...but following the boost is NOT the same as following `--ui-size-meta`.
//
// VERIFIER DEFECT. Replacing the receipt's hard-coded `text-[11px]` /
// `text-[10px]` with `text-[length:var(--ui-size-meta)]` did make Khmer scale
// -- and silently changed ENGLISH too, because `--ui-size-meta` is 11px at the
// root but 13px from 1024px up. English block meta went 11px -> 13px and the
// English line note went 10px -> 13px at every desktop width, in a lane whose
// only typographic mandate was "make the KHMER text larger".
//
// The receipt's two smallest sizes therefore get their OWN tokens, expressed
// against the boost and declared exactly once (in the root-scoped block, never
// re-declared by the 1024 tier). English is then 11px/10px at every width, as
// it was at 6e3abfea, while Khmer reads 13.2px/12px.
assert.match(scoped, /--ui-size-receipt-meta:\s*calc\(11px \* var\(--ui-km-boost, 1\)\);/, "the receipt block meta keeps its own 11px base, so the desktop tier's 13px meta cannot inflate English")
assert.match(scoped, /--ui-size-note:\s*calc\(10px \* var\(--ui-km-boost, 1\)\);/, 'and the line note keeps its own 10px base')
assert.doesNotMatch(desktopTokens, /--ui-size-receipt-meta|--ui-size-note/, 'neither token may be re-declared at 1024: that is exactly how English drifted from 11/10 to 13/13')
assert.match(sheetCode, /text-\[length:var\(--ui-size-receipt-meta,11px\)\]/, 'the block meta reads its own token')
assert.match(sheetCode, /text-\[length:var\(--ui-size-note,10px\)\]/, 'and so does the line note')
assert.doesNotMatch(sheetCode, /shrink-0 text-\[length:var\(--ui-size-meta\)\]/, 'the block meta must not borrow the surface-wide meta token, which is 13px on desktop')
assert.doesNotMatch(sheetCode, /leading-snug text-\[length:var\(--ui-size-meta\)\]/, 'nor may the note')

// English is unchanged: nothing outside `body.lang-km` raises a size.
assert.equal((css.match(/--ui-km-boost:\s*1;/g) || []).length, 1, 'exactly one neutral boost declaration')

console.log('PASS report document surface: centred column with safe-area-floored gutters, four-sided segments through one shared class, boosted Khmer type that cannot clip')

// The storefront pager row, after the owner's Sep 6 2026 screenshot of it.
//
// What the screenshot marks: a red X through the separate "50 v" page-size
// box sitting at the end of the row, and a red arrow from it into the EMPTY
// highlighted gap between "< back" and "1 / 72  next >". So: the page size
// must not be a control of its own on that row, and the row must carry no
// dead space.
//
// Both defects had structural causes in PaginationControls' `centered`
// branch, and this file pins the causes rather than the appearance:
//
//   * the box: a <PageSizeSelect> mounted as a sibling AFTER the Next button,
//     with the boxed default chrome (border + white background + its own
//     radius). The first attempt at this only removed the CHROME: the count
//     "/ 72" became the trigger, unstyled and caret-less. That is the same
//     control in a third disguise -- still a tap target on the row, and on
//     the one element that looks static. The owner struck the CONTROL off
//     the row, so there is now none: the count is text, and the chooser is a
//     field in the Filters panel.
//   * the gap: a fixed `w-9` page input (36px of box around a one-character
//     page number), `gap-1` + `px-1` around it, and a `pr-1` on the pill
//     reserving room for the box. The input is now sized from its own digit
//     count and the pill has no reserved trailing padding.
//   * while here: 32px (h-8/h-7) hit areas on the only navigation control of
//     a phone-first shopping page, under the 40px floor.
//
// Discriminating: every assertion in the three "row" tests below fails at
// 4e58891f, where the branch is [< Back][page / total][Next >][50 v].
//
// Run: node tests/storefrontPagerRow.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { pagerState } from '../src/utils/pagerState.ts'

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

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

const pagination = read('../src/components/shared/PaginationControls.tsx')
const pageSizeSelect = read('../src/components/shared/PageSizeSelect.tsx')
const catalogPagination = read('../src/components/catalog/catalogPagination.tsx')
const catalogProducts = read('../src/components/catalog/CatalogProductsSection.tsx')

// Only the storefront branch. Comments are stripped so an assertion that says
// "`pr-1` is gone" cannot be satisfied or broken by the comment explaining
// why it went.
function centeredBranch(): string {
  const start = pagination.indexOf("if (layout === 'centered')")
  assert.ok(start > 0, "PaginationControls must carry an opt-in `layout === 'centered'` branch")
  const rest = pagination.slice(start)
  const end = rest.indexOf('\n  if (compact')
  const branch = end > 0 ? rest.slice(0, end) : rest
  return branch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// The shared filter body -- one source, rendered into the sub-`lg` Filters
// popover AND the `lg` rail. This is where the per-page chooser went when it
// came off the pager row. Comments stripped for the same reason.
function filterFieldsBody(): string {
  const start = catalogProducts.indexOf('const renderFilterFields = () => (')
  assert.ok(start > 0, 'CatalogProductsSection must still share one filter body between its two filter surfaces')
  const rest = catalogProducts.slice(start)
  const end = rest.indexOf('\n  return (\n    <SectionShell')
  assert.ok(end > 0, 'the filter body should end where the component starts rendering')
  return rest.slice(0, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// ---------------------------------------------------------------------------
// 1. No separate page-size box on the row
// ---------------------------------------------------------------------------

runTest('the row carries no page-size control, in any disguise', () => {
  const branch = centeredBranch()
  const nextAt = branch.indexOf('aria-label={nextLabel}')
  assert.ok(nextAt > 0, 'the Next button must still be findable')
  // Not after Next (where the struck-out "50 v" box sat), and not anywhere
  // else on the row either -- hanging the menu off the count moved the box,
  // it did not remove the control.
  assert.doesNotMatch(branch, /<PageSizeSelect/, 'no page-size control may be mounted on the storefront pager row at all')
  const afterNext = branch.slice(nextAt)
  assert.doesNotMatch(afterNext.replace(/aria-label=\{nextLabel\}/, ''), /<(button|input|select)\b/, 'Next must be the last interactive element in the pill')
})

runTest('the count is plain text -- the row has exactly two tap targets', () => {
  const branch = centeredBranch()
  assert.match(branch, /<span className=\{countClass\}>\/ \{totalPages\}<\/span>/, 'the count must render as a span, unconditionally')
  assert.doesNotMatch(branch, /buttonContent=/, 'a buttonContent count is a trigger wearing the count')
  assert.doesNotMatch(branch, /hideCaret/, 'hiding a caret is what a disguised control needs; a span needs nothing')
  // Back and Next are the only buttons; the page field is the only input.
  assert.equal((branch.match(/<button\b/g) || []).length, 2, 'Back and Next, and nothing else')
  assert.equal((branch.match(/<input\b/g) || []).length, 1, 'the editable page number is the only field on the row')
})

runTest('PageSizeSelect kept no seam that only the removed row-control needed', () => {
  // The first attempt gave PageSizeSelect an `unstyled` variant so the count
  // could be a trigger without looking like one. With the control off the row
  // nothing consumes it, and a styling escape hatch with no caller is the
  // next reader's invitation to put the box back.
  assert.doesNotMatch(pageSizeSelect, /unstyled/, 'the unstyled seam must go with the control it existed for')
  const paginationCode = pagination.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(paginationCode, /\bunstyled\b/, 'and no caller may still ask for it')
})

// ---------------------------------------------------------------------------
// 2. No dead space
// ---------------------------------------------------------------------------

runTest('the page box is sized from its own digits, not a fixed column', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /\bw-9\b/, 'a fixed 36px box around a one-character page number IS the highlighted gap')
  assert.match(branch, /const pageDigits = Math\.max\(1, String\(editablePageInput \? pageDraft : safePage\)\.length\)/,
    'the width must be derived from what the field actually prints')
  // The exact expression is pinned in section 4 (it also has to carry a
  // 40px floor now); here only the unit matters.
  assert.match(branch, /width: `[^`]*calc\(\$\{pageDigits\}ch \+ 0\.5rem\)/, 'ch is the width of a digit -- the right unit for a numeric field')
})

runTest('the pill reserves no room for the control that was removed', () => {
  const branch = centeredBranch()
  const pillAt = branch.indexOf('inline-flex max-w-full items-center rounded-full')
  assert.ok(pillAt > 0, 'the pill wrapper must still be findable')
  const pill = branch.slice(pillAt, branch.indexOf('>', pillAt))
  assert.doesNotMatch(pill, /\bpr-1\b/, 'the trailing padding existed to seat the "50 v" box and is dead space without it')
  assert.doesNotMatch(branch, /shrink items-center gap-1 px-1/, 'the gap+padding around the page number were the rest of the highlighted space')
})

runTest('the row reads as words at 375px, and still cannot wrap', () => {
  const branch = centeredBranch()
  assert.doesNotMatch(branch, /flex-wrap/, 'a pill that wraps is two rows, not one')
  // This case used to REQUIRE `hidden sm:inline` on both labels -- i.e. it
  // pinned the defect. Tailwind's `sm` is 640px, so the phone the owner
  // photographed showed two bare chevrons: the widest screen that hides the
  // words is wider than any phone. The words are visible at every width now.
  assert.doesNotMatch(branch, /hidden sm:inline">\{(?:back|next)Label\}/, 'the Back/Next words must be visible at 375px, not only from 640px up')
  assert.doesNotMatch(branch, /\bhidden sm:inline\b/, '...and nothing else on this row may hide below sm either')
  assert.equal((branch.match(/\{backLabel\}/g) || []).length, 2, 'backLabel is both the visible word and the aria-label')
  assert.equal((branch.match(/\{nextLabel\}/g) || []).length, 2, 'and so is nextLabel')
  assert.equal((branch.match(/shrink-0/g) || []).length >= 2, true, 'the arrows must not be squeezed')
  // Every text run on the row is nowrap, so a longer word (Khmer's Back/Next
  // are wider than the English) lengthens the pill instead of breaking it.
  assert.equal((branch.match(/whitespace-nowrap/g) || []).length >= 3, true, 'the count and both labels must be nowrap')
})

// ---------------------------------------------------------------------------
// 3. Focus -- resolved through the class constants, not grepped
// ---------------------------------------------------------------------------

// The row builds its classes from `const arrowButtonClass = ...` and friends,
// so a grep for a utility next to `<button` finds nothing whether the style
// is there or not -- which is how this branch shipped with no focus style at
// all. Substitute the constants first, then read each opening tag.
function resolvedCenteredBranch(): string {
  const branch = centeredBranch()
  const consts: Record<string, string> = {}
  const declaration = /const (\w+) = ['`]([^'`\n]*)['`]/g
  let found: RegExpExecArray | null
  while ((found = declaration.exec(branch)) !== null) consts[found[1]] = found[2]
  assert.ok(Object.keys(consts).length >= 2, 'the branch should still hoist its shared classes into constants')
  let resolved = branch
  // A constant may be built from another (arrowButtonClass embeds the ring),
  // so substitute to a fixed point rather than once.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = resolved.replace(/\$\{(\w+)\}/g, (whole, name) => (consts[name] === undefined ? whole : consts[name]))
    if (next === resolved) break
    resolved = next
  }
  assert.doesNotMatch(resolved, /\$\{arrowButtonClass\}/, 'the resolver must actually have inlined the shared button class')
  return resolved
}

// Each focusable opening TAG. Sliced to the next `<` rather than to the next
// `>`, because these attributes hold arrow functions and the `=>` in one would
// end the tag three attributes early.
function focusableTags(source: string): Array<{ tag: string; text: string }> {
  const tags: Array<{ tag: string; text: string }> = []
  const opener = /<(button|input)\b/g
  let found: RegExpExecArray | null
  while ((found = opener.exec(source)) !== null) {
    const nextTag = source.indexOf('<', found.index + 1)
    tags.push({ tag: found[1], text: source.slice(found.index, nextTag < 0 ? source.length : nextTag) })
  }
  return tags
}

runTest('the focus reader can tell a ringed control from a bare one (positive control)', () => {
  // An instrument that reports every case the same way is indistinguishable
  // from a broken one, so hand it a fixture holding one of each: a control
  // whose ring arrives through a constant, and one that kills the outline and
  // puts nothing back -- which is what the page field used to do.
  const fixture = [
    "  const ringed = \'h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500\'",
    "  const bare = \'h-10 outline-none\'",
    "  <button className={`${ringed}`} onClick={() => go()}>",
    "    <Icon />",
    "  <input className={`${bare}`} onChange={(event) => set(event)} />",
  ].join('\n')
  const consts: Record<string, string> = {}
  const declaration = /const (\w+) = ['`]([^'`\n]*)['`]/g
  let found: RegExpExecArray | null
  while ((found = declaration.exec(fixture)) !== null) consts[found[1]] = found[2]
  const resolved = fixture.replace(/\$\{(\w+)\}/g, (whole, name) => (consts[name] === undefined ? whole : consts[name]))
  const tags = focusableTags(resolved)
  assert.equal(tags.length, 2, 'the reader must find both controls despite the arrow functions in their attributes')
  assert.match(tags[0].text, /focus-visible:ring-2/, 'and see the ring that arrived through a constant')
  assert.doesNotMatch(tags[1].text, /focus-visible:ring-2/, 'and see that the bare one has none')
  assert.match(tags[1].text, /outline-none/, 'while still seeing that it suppresses the UA outline -- the exact defect shape')
})

runTest('every focusable control on the pager row shows a focus ring', () => {
  const resolved = resolvedCenteredBranch()
  const tags = focusableTags(resolved)
  assert.equal(tags.length, 3, 'Back, Next and the page field are the three focusable controls on this row')
  for (const { tag, text } of tags) {
    assert.match(
      text,
      /focus-visible:ring-2/,
      `a <${tag}> on the storefront pager has no focus indicator. This is the only navigation control on the page the whole catalogue is browsed through, so keyboard paging would be invisible.`,
    )
    assert.match(text, /focus-visible:ring-inset/, 'an outset ring is clipped by the rounded-full pill edge')
  }
})

runTest('nothing on the row kills the UA outline without replacing it', () => {
  for (const { tag, text } of focusableTags(resolvedCenteredBranch())) {
    if (!/outline-none/.test(text)) continue
    assert.match(
      text,
      /focus-visible:ring/,
      `a <${tag}> suppresses the browser focus outline and puts nothing back, which is strictly worse than leaving the UA default alone.`,
    )
  }
})

// ---------------------------------------------------------------------------
// 4. Tap targets -- computed, not eyeballed
// ---------------------------------------------------------------------------

// Tailwind's spacing scale: h-N is N * 0.25rem, and this app pins html to
// 16px (styles/main.css `html { font-size: 16px }`), so h-N is N * 4 px.
function tailwindHeightPx(token: string): number {
  const match = /^h-(\d+)$/.exec(token)
  return match ? Number(match[1]) * 4 : Number.NaN
}

runTest('every hit area in the storefront pill is at least 40px', () => {
  assert.equal(tailwindHeightPx('h-10'), 40)
  assert.equal(tailwindHeightPx('h-8'), 32)
  const branch = centeredBranch()
  const heights = [...new Set(branch.match(/\bh-\d+\b/g) || [])]
  assert.ok(heights.length > 0, 'the branch must declare its row height explicitly')
  for (const token of heights) {
    // h-4 is the chevron GLYPH inside a button, not a hit area of its own.
    if (token === 'h-4') continue
    assert.ok(
      tailwindHeightPx(token) >= 40,
      `${token} = ${tailwindHeightPx(token)}px is under the 40px tap-target floor, on the only navigation control of a phone-first catalogue`,
    )
  }
})

// The page field is the third hit area on this row and the only one whose
// WIDTH is not a class: it comes from an inline `style`, so the `h-\d+` sweep
// above cannot see it. That sweep therefore passes a field one pixel wide and
// forty tall -- which is close to what "size it from its own digits" shipped:
// at text-xs a `ch` is roughly 6-7px, so `calc(1ch + 0.5rem)` on a
// single-digit page is about 15px of tap target, on the storefront's ONLY
// page-jump control, and narrower than the `w-9` (36px) box it replaced.
// Growth from the digit count is right; growing from zero is not.
function pageFieldTag(): string {
  const branch = centeredBranch()
  const at = branch.indexOf('<input')
  assert.ok(at > 0, 'the editable page field must still be on the row')
  const next = branch.indexOf('<', at + 1)
  return branch.slice(at, next < 0 ? branch.length : next)
}

// The floor a width expression guarantees, in px, or NaN when it guarantees
// none. Only a `max(<length>, ...)` is a floor; a bare `calc(...)` of
// content-relative units is not.
function widthFloorPx(expression: string): number {
  const floor = /max\(\s*([\d.]+)(rem|px)\b/.exec(expression)
  if (!floor) return Number.NaN
  const value = Number(floor[1])
  return floor[2] === 'rem' ? value * 16 : value
}

runTest('the width-floor reader tells a floored expression from a bare one (positive control)', () => {
  // Same rule as the focus reader above: an instrument that answers every
  // input the same way is indistinguishable from a broken one.
  assert.ok(Number.isNaN(widthFloorPx('calc(${pageDigits}ch + 0.5rem)')), 'a bare calc of ch units guarantees nothing')
  assert.equal(widthFloorPx('max(2.5rem, calc(${pageDigits}ch + 0.5rem))'), 40)
  assert.equal(widthFloorPx('max(40px, calc(${pageDigits}ch + 0.5rem))'), 40)
  assert.equal(widthFloorPx('max(1rem, calc(${pageDigits}ch + 0.5rem))'), 16, 'and it must report a TOO-SMALL floor as small, not merely as present')
})

runTest('the page field keeps its digit-driven growth but cannot shrink under 40px', () => {
  const tag = pageFieldTag()
  const width = /style=\{\{ width: `([^`]+)`/.exec(tag)
  assert.ok(width, 'the field must still take its width from an inline expression')
  const expression = width ? width[1] : ''
  assert.match(expression, /\$\{pageDigits\}ch/, 'the digit-driven growth is the fix for the gap and must stay')
  const floor = widthFloorPx(expression)
  assert.ok(
    floor >= 40,
    `the page field's width expression \`${expression}\` has no >= 40px floor. At text-xs a ch is ~6-7px, so a one-digit page gives ~15px of tap target on the only page-jump control of a phone-first catalogue.`,
  )
  // `min-w-0` is what lets a flex child collapse below its own content. On
  // the one control that must not, it is the opposite of the rule.
  assert.doesNotMatch(tag, /\bmin-w-0\b/, 'the page field must not opt out of its own minimum width')
})

// ---------------------------------------------------------------------------
// 5. A pager with nothing to page is not a pager
// ---------------------------------------------------------------------------

runTest('the storefront pill does not render on a single-page result', () => {
  const branch = centeredBranch()
  const guardAt = branch.search(/if \(totalPages <= 1\) return null/)
  assert.ok(
    guardAt > 0,
    'an 8-product result renders [< Back disabled][1][/ 1][Next > disabled] twice -- above and below the grid -- a control with nothing it can do',
  )
  const returnAt = branch.indexOf('return (')
  assert.ok(returnAt > guardAt, 'the guard must precede the row it suppresses')
})

runTest("that guard is the centred layout's alone -- the admin render gate is untouched", () => {
  // The admin `rangeAsPageSize` pill still carries the per-page chooser
  // inside itself, so hiding it on one page takes away the only control that
  // can change how many rows a page holds. `visible` therefore stays "there
  // is something to page", and the new rule is per-layout.
  const one = pagerState(1, 8, 20)
  assert.equal(one.totalPages, 1, 'eight products at 20 per page is one page')
  assert.equal(one.visible, true, 'and the admin pill must still render on it')
  assert.equal(pagerState(1, 0, 20).visible, false, 'nothing to page is still nothing to render')
  assert.equal(pagerState(1, 21, 20).totalPages, 2, 'and two pages still page')
  const kernel = read('../src/utils/pagerState.ts')
  assert.match(kernel, /visible: total > 0/, 'the kernel rule itself must not change')
  const visibleAt = kernel.indexOf('visible: boolean')
  const docAt = kernel.lastIndexOf('/**', visibleAt)
  assert.ok(visibleAt > 0 && docAt > 0, 'the `visible` field must still document itself')
  const doc = kernel.slice(docAt, visibleAt)
  assert.doesNotMatch(
    doc,
    /the pill also carries the per-page chooser/,
    'that justification stopped being true when the storefront chooser moved to the Filters panel; a comment explaining a rule with a fact that is no longer true is worse than no comment',
  )
  assert.match(doc, /per-layout/, 'the doc must say the render decision is now per-layout, and why')
})

// ---------------------------------------------------------------------------
// 6. The pager is a landmark, and it says where it went
// ---------------------------------------------------------------------------

runTest('the centred pager is a labelled navigation landmark', () => {
  const branch = centeredBranch()
  const body = branch.slice(branch.indexOf('return ('))
  const first = /<(\w+)/.exec(body)
  assert.ok(first, 'the branch must render something')
  assert.equal(
    first ? first[1] : '',
    'nav',
    "the pager is the storefront's navigation between pages of the catalogue; as a bare <div> it is in no landmark list, so it cannot be jumped to",
  )
  const navAt = body.indexOf('<nav')
  const navTag = body.slice(navAt, body.indexOf('<', navAt + 1))
  assert.match(navTag, /aria-label=\{/, 'an unnamed landmark is indistinguishable from every other <nav> on the page')
  assert.doesNotMatch(navTag, /portal_pager_/, '`page` is already translated in all 17 portal language packs; no key needs inventing for this')
})

runTest('pressing Next announces the page it landed on', () => {
  const branch = centeredBranch()
  const live = branch.match(/aria-live=/g) || []
  assert.equal(live.length, 1, 'exactly one live region -- two would announce the same move twice')
  assert.match(branch, /aria-live="polite"/, 'polite: paging is not an interruption')
  const at = branch.indexOf('aria-live')
  const tagStart = branch.lastIndexOf('<', at)
  const region = branch.slice(tagStart, branch.indexOf('</span>', at))
  assert.match(region, /sr-only/, 'the announcement must add no chrome to a row the owner asked to keep bare')
  assert.match(region, /\{safePage\}/, 'it must carry the page that was moved to')
  assert.match(region, /\{totalPages\}/, 'and the total, so "next" has a destination')
})

// ---------------------------------------------------------------------------
// 6b. ONE name per landmark, ONE announcement per move
//
// The landmark fix above put the same `<nav aria-label={pageLabel}>` on BOTH
// storefront mounts -- above the grid and below it -- so a screen reader's
// landmark list showed two entries called "Page" / "ទំព័រ" with nothing to
// tell them apart, and `pageLabel` is also the page <input>'s own aria-label,
// so one string named three different things inside one region. And both
// mounts carried a live region, so a single Next fired two announcements.
//
// Discriminating: at 4fe515f5 the nav's label expression IS `pageLabel`, both
// mounts pass no name at all, and the live region is unconditional.
// ---------------------------------------------------------------------------

// Every <CatalogPaginationControls .../> mount in a source string, with the
// comments stripped -- a mount whose comment explains why it does NOT opt into
// the announcement must not read as one that does.
function pagerMounts(source: string): string[] {
  const found: string[] = []
  let at = source.indexOf('<CatalogPaginationControls')
  while (at >= 0) {
    const end = source.indexOf('/>', at)
    if (end < 0) break
    found.push(source.slice(at, end + 2).replace(/^\s*\/\/.*$/gm, ''))
    at = source.indexOf('<CatalogPaginationControls', end)
  }
  return found
}

// The reader under test: the accessible names the storefront's pager mounts
// ask for. An empty string means the mount asked for no name of its own and
// so inherits whatever the component defaults to -- which is how two
// identically-named landmarks happen.
function pagerNames(source: string): string[] {
  return pagerMounts(source).map((mount) => {
    const match = /pagerName=\{([\s\S]*?)\}\n/.exec(mount)
    return match ? match[1].trim() : ''
  })
}

function mountsAnnouncing(source: string): number {
  return pagerMounts(source).filter((mount) => /announcePage/.test(mount)).length
}

// The state this round fixes, written out as a fixture, so a reader that
// cannot see the defect is caught here rather than by the next verifier.
const DUPLICATE_NAME_FIXTURE = `
      {showPager ? (
        <CatalogPaginationControls
          className="mb-4"
          pagerName={copy('page', 'Page')}
          announcePage
          onPageChange={updatePage}
        />
      ) : null}
      {showPager ? (
        <CatalogPaginationControls
          className="mt-4"
          pagerName={copy('page', 'Page')}
          announcePage
          onPageChange={updatePage}
        />
      ) : null}
`

runTest('the name reader can tell two identical landmarks from two distinct ones (positive control)', () => {
  const names = pagerNames(DUPLICATE_NAME_FIXTURE)
  assert.equal(names.length, 2, 'the fixture has two mounts')
  assert.equal(new Set(names).size, 1, 'and the reader must report them as sharing one name -- otherwise it proves nothing below')
  assert.equal(mountsAnnouncing(DUPLICATE_NAME_FIXTURE), 2, 'and must see both fixture mounts announcing')
})

runTest('the two pager landmarks are not called the same thing', () => {
  const names = pagerNames(catalogProducts)
  assert.equal(names.length, 2, 'the storefront mounts the pager above and below the grid')
  assert.ok(names.every((name) => name.length > 0), 'each mount must ask for its own accessible name')
  assert.equal(new Set(names).size, 2, 'two landmarks with one name are two landmarks a reader cannot choose between')
})

runTest('the landmark is not named with the same string as the page field', () => {
  const branch = centeredBranch()
  const body = branch.slice(branch.indexOf('return ('))
  const navAt = body.indexOf('<nav')
  const navTag = body.slice(navAt, body.indexOf('<', navAt + 1))
  const label = /aria-label=\{([^}]*)\}/.exec(navTag)
  assert.ok(label, 'the landmark must still be named')
  assert.notEqual(
    label ? label[1].trim() : '',
    'pageLabel',
    "`pageLabel` is the page <input>'s own aria-label; naming the landmark with it makes one string mean three things in one region",
  )
  // The input keeps that string -- this is about the landmark, not a rename.
  assert.match(body, /aria-label=\{pageLabel\}/, 'the page field itself still says "Page"')
})

runTest('exactly one mount announces a page change', () => {
  const branch = centeredBranch()
  const live = branch.match(/aria-live=/g) || []
  assert.equal(live.length, 1, 'the component declares one live region')
  const at = branch.indexOf('aria-live')
  const tagStart = branch.lastIndexOf('<', at)
  const before = branch.slice(Math.max(0, tagStart - 120), tagStart)
  assert.match(
    before,
    /\?|&&/,
    'the live region must be rendered under a condition -- unconditional, both mounts announce the same move twice',
  )
  assert.equal(
    mountsAnnouncing(catalogProducts),
    1,
    'only one storefront mount opts in; the bottom pager scrolls the shopper away from itself anyway',
  )
})

runTest('the names the mounts ask for exist in every portal language pack', () => {
  const packs = read('../src/components/catalog/portalLanguagePacks.ts')
  const nextEntries = packs.match(/^\s*next: /gm) || []
  const topEntries = packs.match(/^\s*pagerTop: /gm) || []
  const bottomEntries = packs.match(/^\s*pagerBottom: /gm) || []
  assert.ok(nextEntries.length >= 17, 'sanity: the packs still carry the pager vocabulary')
  assert.equal(topEntries.length, nextEntries.length, 'a name in 2 of 18 packs is English in the other 16')
  assert.equal(bottomEntries.length, nextEntries.length, 'same for the bottom pager')
  assert.match(packs, /pagerTop: 'ទំព័រ \(ខាងលើ\)'/, 'real Khmer, matching the packs own ខាងលើ / ខាងក្រោម vocabulary')
  assert.match(packs, /pagerBottom: 'ទំព័រ \(ខាងក្រោម\)'/)
})

// ---------------------------------------------------------------------------
// 7. Behaviour that must NOT change
// ---------------------------------------------------------------------------

runTest('the chosen page size is written by exactly the same two calls, from its new home', () => {
  // Moving the control must not move the WRITE. `updatePageSize` +
  // `updatePage(1)` is what persists portalProductPageSize, and it is now
  // called once, from the shared filter body.
  const writes = catalogProducts.match(/updatePageSize\?\.\(size\)\n\s*updatePage\?\.\(1\)/g) || []
  assert.equal(writes.length, 1, 'one chooser, one write path -- two would be two ways to persist the same fact')
  const fields = filterFieldsBody()
  assert.match(fields, /updatePageSize\?\.\(size\)\n\s*updatePage\?\.\(1\)/, 'and it must be the Filters field that calls it')
  assert.match(fields, /<PageSizeSelect/, 'the chooser itself lives in the shared filter body')
  assert.match(fields, /options=\{CATALOG_PAGE_SIZE_OPTIONS\}/, 'it offers the storefront presets, not a second list')
  assert.match(fields, /allowCustom=\{false\}/, 'and keeps the storefront\'s fixed 20/50/100, as editablePageSizeInput={false} used to')
  // The pager row no longer has a per-page prop for anyone to pass. Comments
  // stripped: catalogPagination.tsx explains in prose why the prop is gone,
  // and naming a removed prop must not read as still declaring it.
  const wrapperCode = catalogPagination.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(wrapperCode, /onPageSizeChange/, 'the storefront wrapper must not offer a prop whose only use is re-growing the box')
  assert.doesNotMatch(wrapperCode, /editablePageSizeInput/, 'nor the flag that configured it')
  assert.match(catalogPagination, /layout="centered"/, 'and must keep opting into the centred layout')
})

runTest('both breakpoints get the chooser from that one mount', () => {
  // renderFilterFields is called twice: the popover below `lg`, and the
  // permanent rail at `lg` and up. If the chooser had gone into either call
  // site instead of the shared body, one breakpoint would silently lose the
  // only control that can undo a 100-per-page choice.
  const calls = catalogProducts.match(/\{renderFilterFields\(\)\}/g) || []
  assert.equal(calls.length, 2, 'the filter body must still be rendered at both breakpoints')
  const railAt = catalogProducts.indexOf('<aside className="hidden min-w-0 lg:sticky')
  const popoverAt = catalogProducts.indexOf('role="dialog"')
  assert.ok(railAt > 0 && popoverAt > railAt, 'one call is the lg rail, the other the sub-lg Filters dialog')
})

runTest('the arrows are still dead exactly at the bounds', () => {
  const branch = centeredBranch()
  assert.match(branch, /disabled=\{backDisabled\}/)
  assert.match(branch, /disabled=\{nextDisabled\}/)
  const first = pagerState(1, 3555, 20)
  assert.equal(first.backDisabled, true)
  assert.equal(first.nextDisabled, false)
  assert.equal(first.totalPages, 178)
  const last = pagerState(178, 3555, 20)
  assert.equal(last.backDisabled, false)
  assert.equal(last.nextDisabled, true)
  // The screenshot's own numbers: 72 pages, sitting on the first.
  const shot = pagerState(1, 1436, 20)
  assert.equal(shot.totalPages, 72, 'the count the trigger prints is totalPages, unchanged by folding the menu into it')
})

if (failed > 0) {
  console.error(`\n${failed} storefront pager-row check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront pager-row checks passed')

// The public storefront must have exactly ONE owner of vertical scroll: the
// document. (Owner, Sep 6 2026: "fix scrollability in public website".)
//
// storefrontScrollRoot.test.ts already pins the *spellings* that went wrong
// before. This file asks the question that actually decides the behaviour:
// given the overflow values each public wrapper DECLARES, is that wrapper a
// scroll container? A wrapper that is one becomes the nearest scrollport for
// every `position: sticky` descendant, and since these wrappers are
// `height: auto` (only a min-height) they grow with the catalog and never
// scroll -- so the sticky section nav and the sticky products search row are
// pinned to a box that never moves, i.e. they simply scroll away, and on iOS
// a `-webkit-overflow-scrolling: touch` scrollport with nothing to scroll can
// swallow the gesture instead of passing it to the page.
//
// The kernel below is the CSS rule that makes this non-obvious: `visible`
// beside a non-`visible`, non-`clip` value computes to `auto`. That is why
// `overflow-visible` sitting next to an inline `overflowY: 'auto'` produced a
// TWO-axis scrollport, and why `overflow-x: clip` is the one containment that
// leaves the vertical axis alone.
//
// Discriminating: at 4e58891f the shell declares (x: clip, y: auto), so
// isScrollContainer is true and the second assertion below fails.
//
// Run: node tests/storefrontScrollOwner.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

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

// ---------------------------------------------------------------------------
// The kernel: declared overflow -> computed overflow -> "is this a scrollport"
// ---------------------------------------------------------------------------

type OverflowPair = { x: string; y: string }

// CSS Overflow Module: if one axis is `visible` and the other is neither
// `visible` nor `clip`, the `visible` one computes to `auto`. `clip` is the
// only containment value that leaves its partner alone.
function computeOverflow(declared: OverflowPair): OverflowPair {
  const settle = (self: string, other: string) => (
    self === 'visible' && other !== 'visible' && other !== 'clip' ? 'auto' : self
  )
  return { x: settle(declared.x, declared.y), y: settle(declared.y, declared.x) }
}

// `auto` / `scroll` / `hidden` all establish a scroll container (a scrollport)
// and therefore capture `position: sticky`. `clip` and `visible` do not.
const SCROLLPORT_VALUES = new Set(['auto', 'scroll', 'hidden', 'overlay'])

function isScrollContainer(declared: OverflowPair): boolean {
  const computed = computeOverflow(declared)
  return SCROLLPORT_VALUES.has(computed.x) || SCROLLPORT_VALUES.has(computed.y)
}

runTest('the overflow kernel reproduces the CSS rule that made this invisible', () => {
  // visible beside auto is rewritten -- the two-axis scrollport bug.
  assert.deepEqual(computeOverflow({ x: 'visible', y: 'auto' }), { x: 'auto', y: 'auto' })
  // clip beside visible is the one pair CSS leaves alone.
  assert.deepEqual(computeOverflow({ x: 'clip', y: 'visible' }), { x: 'clip', y: 'visible' })
  assert.equal(isScrollContainer({ x: 'clip', y: 'visible' }), false)
  // and the shape the storefront shell used to declare.
  assert.equal(isScrollContainer({ x: 'clip', y: 'auto' }), true)
  assert.equal(isScrollContainer({ x: 'visible', y: 'auto' }), true)
  assert.equal(isScrollContainer({ x: 'hidden', y: 'visible' }), true)
})

// ---------------------------------------------------------------------------
// Reading the declared values back out of the source
// ---------------------------------------------------------------------------

const OVERFLOW_VALUE = /^(visible|hidden|clip|auto|scroll)$/

// Each wrapper is `<div data-portal-root="true" ... className={...} style={{
// ... background: portalBackground }}>`. Slice from the marker to the
// background line so both the class list and the inline style are in view.
function portalRootBlocks(source: string): string[] {
  const blocks: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf('data-portal-root="true"', from)
    if (start < 0) break
    const end = source.indexOf('background: portalBackground', start)
    assert.ok(end > start, 'every data-portal-root wrapper should still declare its background inline')
    blocks.push(source.slice(start, end))
    from = end
  }
  return blocks
}

// `publicView ? 'a b c' : 'x'` -- take the branch that actually ships to
// customers, not the admin one beside it.
function publicViewClasses(block: string): string {
  const ternary = /publicView \? '([^']*)' : '([^']*)'/.exec(block)
  if (ternary) return ternary[1]
  const plain = /className="([^"]*)"/.exec(block)
  return plain ? plain[1] : ''
}

function publicViewInlineStyle(block: string): string {
  const ternary = /\.\.\.\(publicView \? \{([^}]*)\}/.exec(block)
  return ternary ? ternary[1] : block
}

function declaredOverflow(block: string): OverflowPair {
  const classes = publicViewClasses(block)
  const inline = publicViewInlineStyle(block)
  const inlineX = /overflowX:\s*'([a-z]+)'/.exec(inline)?.[1]
  const inlineY = /overflowY:\s*'([a-z]+)'/.exec(inline)?.[1]
  const bothAxes = /(?:^|\s)overflow-(visible|hidden|clip|auto|scroll)(?:\s|$)/.exec(classes)?.[1]
  const classX = /(?:^|\s)overflow-x-(\w+)/.exec(classes)?.[1] || bothAxes
  const classY = /(?:^|\s)overflow-y-(\w+)/.exec(classes)?.[1] || bothAxes
  const x = inlineX || classX || 'visible'
  const y = inlineY || classY || 'visible'
  assert.match(x, OVERFLOW_VALUE, `unrecognised overflow-x "${x}" -- the parser, not the source, is what needs fixing`)
  assert.match(y, OVERFLOW_VALUE, `unrecognised overflow-y "${y}"`)
  return { x, y }
}

const previewSurface = read('../src/components/catalog/CatalogPreviewSurface.tsx')
const catalogPage = read('../src/components/catalog/CatalogPage.tsx')
const publicPage = read('../src/components/catalog/PublicCatalogPage.tsx')
const publicRoot = read('../src/PublicCatalogRoot.tsx')
const entry = read('../src/index.tsx')
const mainCss = read('../src/styles/main.css')

runTest('the parser reads a real scroll container back out of this repo (positive control)', () => {
  // The admin editor's own wrapper is the known-opposite case: it is SUPPOSED
  // to be a scroll container. If this stops reporting one, every "is not a
  // scroll container" assertion below is vacuous.
  const adminBlock = portalRootBlocks(catalogPage).find((block) => block.includes('page-scroll flex-1 overflow-y-auto') && !block.includes('publicView ?'))
  assert.ok(adminBlock, "the admin editor's .page-scroll wrapper must still exist")
  assert.deepEqual(declaredOverflow(adminBlock), { x: 'visible', y: 'auto' })
  assert.equal(isScrollContainer(declaredOverflow(adminBlock)), true, 'the admin preview owns its own inner scroller and keeps it')
})

runTest('no public wrapper is a scroll container -- the document owns vertical scroll', () => {
  const wrappers: Array<[string, string]> = []
  for (const block of portalRootBlocks(previewSurface)) wrappers.push(['CatalogPreviewSurface', block])
  for (const block of portalRootBlocks(catalogPage)) {
    if (block.includes('publicView ?')) wrappers.push(['CatalogPage', block])
  }
  assert.ok(wrappers.length >= 3, `expected the storefront shell plus CatalogPage's two publicView wrappers, found ${wrappers.length}`)
  for (const [file, block] of wrappers) {
    const declared = declaredOverflow(block)
    assert.equal(
      isScrollContainer(declared),
      false,
      `${file}: a public wrapper declaring overflow ${JSON.stringify(declared)} is a scrollport. It has height:auto so it can never scroll, and it steals the scrollport from every sticky descendant (the section nav and the products search row).`,
    )
  }
})

runTest('the storefront shell still clips its horizontal axis', () => {
  const shell = portalRootBlocks(previewSurface)[0]
  const declared = declaredOverflow(shell)
  assert.equal(declared.x, 'clip', 'horizontal containment must survive the vertical fix -- `clip` is what does it without a scrollport')
  assert.equal(computeOverflow(declared).y, 'visible', 'and the vertical axis must stay visible so the page scrolls as one document')
  assert.match(shell, /min-h-screen/, 'the shell still fills at least the viewport')
})

runTest('every sticky surface on the public route, and the shell it sits in', () => {
  // The surfaces whose scrollport this whole file is about. Naming them
  // here is not the assertion -- the assertion is the ANCESTOR chain below
  // and in the CSS section: a sticky element is only as good as the nearest
  // scrollport above it, and both the shell AND <body> are in that chain.
  assert.match(previewSurface, /publicView \? 'sticky top-1 z-40 sm:top-2' : ''/, 'the public section nav is sticky-positioned')
  const products = read('../src/components/catalog/CatalogProductsSection.tsx')
  assert.match(products, /sticky top-16 z-20/, 'the products search/filter row is sticky-positioned')
  assert.match(products, /lg:sticky lg:top-20/, 'the desktop filter rail is sticky-positioned')
  // ...and the live storefront never arms the JS pinning fallback, so CSS
  // sticky is the ONLY mechanism holding any of them in place there.
  assert.match(publicPage, /publicPortalNavPinned=\{false\}/, "the live storefront relies on CSS sticky, not the admin preview's JS pin")
  // Ancestor 1 of 2: the shell.
  assert.equal(isScrollContainer(declaredOverflow(portalRootBlocks(previewSurface)[0])), false)
  // Ancestor 2 of 2 is <body>, and it is CSS, not JSX -- see
  // "the marker leaves <body> out of the scroll chain" below. Asserting only
  // the shell here is what let this check pass while the claim was false.
})

// ---------------------------------------------------------------------------
// The document marker, on the entry customers actually load
// ---------------------------------------------------------------------------

runTest('the shipped storefront entry is PublicCatalogPage, not CatalogPage', () => {
  assert.match(entry, /publicCatalogMode \? PublicCatalogRoot : AdminRoot/, 'index.tsx picks the root by path')
  assert.match(entry, /isPublicCatalogPath\(window\.location\.pathname\)/)
  assert.match(publicRoot, /<PublicCatalogPage \/>/, 'PublicCatalogRoot mounts PublicCatalogPage directly')
  assert.match(publicPage, /^\s*<CatalogPreviewSurface$/m, 'PublicCatalogPage mounts the preview surface itself')
  assert.doesNotMatch(publicPage, /^\s*<CatalogPage\b/m, '...so it cannot inherit any CatalogPage effect, including the document marker')
})

runTest('the live entry sets the data-public-portal marker on BOTH html and body', () => {
  assert.match(publicPage, /html\.setAttribute\('data-public-portal', 'true'\)/, 'html carries the marker (main.css keys the scroll unlock off html AND body)')
  assert.match(publicPage, /body\.setAttribute\('data-public-portal', 'true'\)/, 'body carries the marker (every public-portal.css rule keys off body)')
})

runTest('the marker is restored, not blindly removed, on unmount', () => {
  for (const [file, source] of [['PublicCatalogPage', publicPage], ['CatalogPage', catalogPage]] as const) {
    assert.match(source, /const previousHtmlMarker = html\.getAttribute\('data-public-portal'\)/, `${file} must capture the prior html marker`)
    assert.match(source, /const previousBodyMarker = body\.getAttribute\('data-public-portal'\)/, `${file} must capture the prior body marker`)
    assert.match(source, /if \(previousHtmlMarker === null\) html\.removeAttribute\('data-public-portal'\)/, `${file} cleanup must restore an absent prior html value`)
    assert.match(source, /else html\.setAttribute\('data-public-portal', previousHtmlMarker\)/, `${file} cleanup must restore a present prior html value`)
    assert.match(source, /if \(previousBodyMarker === null\) body\.removeAttribute\('data-public-portal'\)/, `${file} cleanup must restore an absent prior body value`)
    assert.match(source, /else body\.setAttribute\('data-public-portal', previousBodyMarker\)/, `${file} cleanup must restore a present prior body value`)
  }
})

runTest('the marker still has something to unlock', () => {
  assert.match(
    mainCss,
    /html\[data-public-portal='true'\] \{[^}]*?overflow-y: auto !important;/,
    'the CSS the marker exists to switch on must still be there -- otherwise setting it is cargo cult',
  )
  const portalCss = read('../src/styles/public-portal.css')
  assert.match(portalCss, /body\[data-public-portal='true'\] \{\n  top: 0 !important;/, "the Google-Translate banner's downward shove of <body> is undone only under the marker")
})

runTest('the body marker is what gives a portalled overlay its 44px touch floor', () => {
  // The second thing the missing marker cost, found while auditing tap
  // targets. public-portal.css sizes every public control to 44px on a coarse
  // pointer under TWO selectors: `body[data-public-portal='true']` and
  // `[data-public-media-protection='true']`. The shipped shop's root carries
  // the media-protection attribute (PublicCatalogPage.tsx:1827), so its own
  // buttons -- the h-7 cart quantity steppers, the h-7 wishlist remove -- were
  // always 44px on a phone despite their class, and are NOT a defect. But that
  // is a descendant selector, and a menu rendered with
  // createPortal(..., document.body) is not a descendant of anything in the
  // page. PageSizeSelect's option list is exactly that, and it is what the
  // storefront pager's per-page menu opens. With the body marker never set,
  // its options had no touch floor at all on the shipped storefront.
  //
  // So this is not a second fix; it is the rest of the first one. The chain is
  // pinned here so dropping the marker again cannot look free.
  const portalCss = read('../src/styles/public-portal.css')
  assert.match(
    portalCss,
    /@media \(pointer: coarse\) \{\n  body\[data-public-portal='true'\] button,[\s\S]*?min-height: 44px;/,
    'the coarse-pointer floor must still be reachable through the body marker',
  )
  const pageSizeSelect = read('../src/components/shared/PageSizeSelect.tsx')
  assert.match(pageSizeSelect, /createPortal\(/, 'the per-page menu is portalled out of the page')
  assert.match(pageSizeSelect, /document\.body,/, '...straight onto document.body, past every descendant selector but the marker')
})

// ---------------------------------------------------------------------------
// The other half of the chain: the CSS the marker switches on
// ---------------------------------------------------------------------------
//
// Setting `data-public-portal` on <html> and <body> is only half a fix. What
// the marker SWITCHES ON decides whether <body> is a scrollport, and <body>
// sits between every sticky storefront surface and the viewport. This lane is
// the first thing that ever activates these rules on the live shop, so a
// scrollport here is a defect this lane would have SHIPPED.
//
// The two rules that make it non-obvious:
//   * root propagation: overflow declared on <html> moves to the viewport and
//     <html>'s own used value becomes `visible`, so <html> is never the
//     scrollport itself.
//   * body propagation is only a FALLBACK, and only when the root's own
//     overflow is `visible`. main.css declares `html { overflow-x: hidden }`,
//     so it never fires -- a non-visible overflow on <body> applies to
//     <body>, and `height: auto` makes that a scrollport that can never
//     scroll: the exact shape this lane removed from the shell.

// main.css is one file, and the declarations that reach <html>/<body> under
// the marker all live inside its `@layer base` block. Slice that block by
// brace matching rather than by line number, so the parser survives edits
// above it -- after stripping comments, because this stylesheet explains
// itself in prose that quotes CSS, and a brace inside a comment desynchronises
// both the brace matcher and the rule reader. (Found the hard way: with the
// comments left in, the reader silently reported <html> as having no overflow
// at all.)
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function layerBaseBlock(rawCss: string): string {
  const css = stripCssComments(rawCss)
  const open = css.indexOf('@layer base {')
  assert.ok(open >= 0, 'main.css must still declare its base layer')
  let depth = 0
  for (let i = css.indexOf(String.fromCharCode(123), open); i < css.length; i += 1) {
    const ch = css[i]
    if (ch === String.fromCharCode(123)) depth += 1
    else if (ch === String.fromCharCode(125)) {
      depth -= 1
      if (depth === 0) return css.slice(open, i + 1)
    }
  }
  throw new Error('unbalanced braces in main.css @layer base')
}

type Decl = { prop: string; value: string; important: boolean; specificity: number; order: number }

// Which selectors reach `<html data-public-portal='true'>` /
// `<body data-public-portal='true'>`, and how specific each is. Type selector
// = 1, type + attribute = 10 (an attribute selector outranks any number of
// type selectors, which is the whole reason the marker rules win).
function selectorSpecificity(selector: string, element: string): number | null {
  const sel = selector.trim()
  if (sel === element) return 1
  if (sel === `${element}[data-public-portal='true']`) return 10
  return null
}

// Cascade the declarations that reach one element and return the winners.
// Longhands only: `overflow: X` is expanded, since that is how the browser
// resolves it against a competing `overflow-x`.
function cascade(rawCss: string, element: string): Record<string, string> {
  const css = stripCssComments(rawCss)
  const decls: Decl[] = []
  let order = 0
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = ruleRe.exec(css)) !== null) {
    const selectors = match[1].split(',')
    const body = match[2]
    for (const selector of selectors) {
      const specificity = selectorSpecificity(selector, element)
      if (specificity === null) continue
      for (const raw of body.split(';')) {
        const colon = raw.indexOf(':')
        if (colon < 0) continue
        const prop = raw.slice(0, colon).trim()
        let value = raw.slice(colon + 1).trim()
        const important = /!important$/.test(value)
        if (important) value = value.replace(/!important$/, '').trim()
        order += 1
        if (prop === 'overflow') {
          decls.push({ prop: 'overflow-x', value, important, specificity, order })
          decls.push({ prop: 'overflow-y', value, important, specificity, order })
        } else {
          decls.push({ prop, value, important, specificity, order })
        }
      }
    }
  }
  const winners: Record<string, Decl> = {}
  for (const decl of decls) {
    const held = winners[decl.prop]
    if (!held) { winners[decl.prop] = decl; continue }
    const beats = decl.important !== held.important
      ? decl.important
      : decl.specificity !== held.specificity
        ? decl.specificity > held.specificity
        : decl.order > held.order
    if (beats) winners[decl.prop] = decl
  }
  const flat: Record<string, string> = {}
  for (const [prop, decl] of Object.entries(winners)) flat[prop] = decl.value
  return flat
}

function cascadedOverflow(css: string, element: string): OverflowPair {
  const won = cascade(css, element)
  return { x: won['overflow-x'] || 'visible', y: won['overflow-y'] || 'visible' }
}

runTest('the cascade reader reproduces the defect it is here to catch (positive control)', () => {
  // The exact shape main.css shipped before this fix: ONE selector list for
  // html and body. If the reader below cannot report THAT as a body
  // scrollport, its all-clear on the real file means nothing.
  const before = [
    '@layer base {',
    '  html { overflow-x: hidden; }',
    '  body { overflow-x: hidden; }',
    "  html[data-public-portal='true'],",
    "  body[data-public-portal='true'] {",
    '    height: auto;',
    '    overflow-y: auto !important;',
    '    overflow-x: hidden;',
    '  }',
    '}',
  ].join('\n')
  assert.deepEqual(cascadedOverflow(before, 'body'), { x: 'hidden', y: 'auto' })
  assert.equal(isScrollContainer(cascadedOverflow(before, 'body')), true, 'the reader must SEE the old body scrollport')
  // ...and the fixed shape, read by the same code, must come back clean.
  const after = [
    '@layer base {',
    '  html { overflow-x: hidden; }',
    '  body { overflow-x: hidden; }',
    "  html[data-public-portal='true'] { overflow-y: auto !important; overflow-x: hidden; }",
    "  body[data-public-portal='true'] { overflow: visible; }",
    '}',
  ].join('\n')
  assert.deepEqual(cascadedOverflow(after, 'body'), { x: 'visible', y: 'visible' })
  assert.equal(isScrollContainer(cascadedOverflow(after, 'body')), false)
})

runTest('the marker leaves <body> out of the scroll chain', () => {
  const base = layerBaseBlock(mainCss)
  const body = cascadedOverflow(base, 'body')
  assert.equal(
    isScrollContainer(body),
    false,
    `main.css gives <body data-public-portal> overflow ${JSON.stringify(body)}. <html> already propagates its own overflow to the viewport, so body-to-viewport propagation does not fire and this applies to <body> itself: a height:auto scrollport that can never scroll, and the nearest scrollport for the sticky section nav, the sticky products search row and the sticky desktop filter rail.`,
  )
})

runTest('...while <html> keeps the unlock and the horizontal containment', () => {
  const base = layerBaseBlock(mainCss)
  const html = cascadedOverflow(base, 'html')
  assert.equal(html.y, 'auto', 'the vertical unlock must stay on the root, which propagates it to the viewport')
  assert.equal(html.x, 'hidden', 'and horizontal containment with it -- this is what body no longer has to carry')
  // Root propagation is the reason this is not the same defect one level up:
  // the root's own used overflow becomes `visible`, so <html> is not itself
  // the scrollport. Pinned as the rule, so a future reader can check it.
  assert.equal(isScrollContainer({ x: 'visible', y: 'visible' }), false)
})

runTest('nothing re-declares html/body overflow outside the base layer', () => {
  // The cascade above reads only `@layer base`. That is only sound while no
  // later rule targets these two elements, so check the claim instead of
  // assuming it -- in main.css outside the block, and in public-portal.css,
  // which is where every other marker rule lives.
  const outside = stripCssComments(mainCss).replace(layerBaseBlock(mainCss), "")
  const portalCss = read('../src/styles/public-portal.css')
  for (const [name, css] of [['main.css (outside @layer base)', outside], ['public-portal.css', portalCss]] as const) {
    for (const element of ['html', 'body'] as const) {
      const declared = cascadedOverflow(css, element)
      assert.deepEqual(
        declared, { x: 'visible', y: 'visible' },
        `${name} declares overflow on ${element} -- the reader above would miss it`,
      )
    }
  }
})

if (failed > 0) {
  console.error(`\n${failed} storefront scroll-owner check(s) failed`)
  process.exit(1)
}
console.log('\nAll storefront scroll-owner checks passed')

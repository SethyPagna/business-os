// Public storefront accessibility -- N45: "make the site accessible, add alt
// text, check color contrast, and make forms keyboard friendly. Use clear
// button labels". The colour half lives in tests/portalContrast.test.ts; this
// file covers images, forms, keyboard operation, accessible names and page
// structure.
//
// These are SOURCE-SHAPE assertions, deliberately: there is no DOM in this
// suite, and a rendering test that mounted the storefront would need the whole
// portal bootstrap. Every assertion below names the exact markup the fix
// installs, and every one of them fails on 4e58891f -- see the header comment
// on each section for what the base tree actually contains.
//
// Run: node tests/portalAccessibility.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTAL_CONTRAST_PAIRS } from '../src/components/catalog/portalContrast.ts'

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

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')
const catalogDir = path.join(frontend, 'src', 'components', 'catalog')
const read = (file: string): string => fs.readFileSync(path.join(catalogDir, file), 'utf8')
const readFrontend = (...parts: string[]): string => fs.readFileSync(path.join(frontend, ...parts), 'utf8')

/** Every file that renders on the public storefront route. */
const PUBLIC_STOREFRONT_FILES = [
  'PublicCatalogPage.tsx',
  'CatalogPreviewSurface.tsx',
  'CatalogProductsSection.tsx',
  'CatalogSecondaryTabs.tsx',
  'ProductDetailFlyout.tsx',
  'CatalogAccountSection.tsx',
  'PortalFilterCombobox.tsx',
  'PortalPromoStrip.tsx',
  'PortalPromotionsBanner.tsx',
  'PortalNoPaymentNotice.tsx',
  'catalogUi.tsx',
  'catalogImages.tsx',
]

// ---------------------------------------------------------------------------
// 1. IMAGES
// ---------------------------------------------------------------------------

runTest('every <img> on the public route declares an alt', () => {
  const failures: string[] = []
  for (const file of PUBLIC_STOREFRONT_FILES) {
    const source = read(file)
    // Each <img ...> element, however many lines it spans.
    for (const match of source.matchAll(/<img\b[\s\S]*?\/>/g)) {
      if (!/\balt=/.test(match[0])) failures.push(`${file}: ${match[0].replace(/\s+/g, ' ').slice(0, 100)}`)
    }
  }
  assert.deepEqual(failures, [])
})

runTest('a decorative image is taken OUT of the accessibility tree, not just alt=""', () => {
  // catalogImages renders every storefront product photo. Its `alt` defaults
  // to '' and the flyout's thumbnail strip passes '' deliberately -- on the
  // base tree that produced a nameless <img> the reader still walks into.
  const images = read('catalogImages.tsx')
  assert.match(images, /aria-hidden=\{alt \? undefined : true\}/, 'an empty alt hides the image from the reader')
  // The empty-state placeholder block is already hidden; keep it that way.
  assert.match(images, /aria-hidden="true"\s*\r?\n\s*className=\{`bg-gray-100/, 'the broken/missing-image placeholder stays hidden')
  // The two ShoppingBag "no photo" placeholders on the public route.
  const flyout = read('ProductDetailFlyout.tsx')
  assert.match(flyout, /text-slate-300" aria-hidden="true">\s*\r?\n\s*<ShoppingBag/, 'the product sheet placeholder is decorative')
  const products = read('CatalogProductsSection.tsx')
  assert.match(products, /text-slate-300" aria-hidden="true">\s*\r?\n\s*<ShoppingBag/, 'the product card placeholder is decorative')
})

runTest('a product image is described by the product, never by the word "Products"', () => {
  const products = read('CatalogProductsSection.tsx')
  assert.doesNotMatch(
    products,
    /alt=\{product\.name \|\| copy\('products', 'Products'\)\}/,
    'an unnamed product announced the literal section name as its photo',
  )
  assert.match(
    products,
    /alt=\{\[product\.name, product\.brand\]\.filter\(Boolean\)\.join\(' - '\)\}/,
    'the card photo carries the product name plus its brand',
  )
  const flyout = read('ProductDetailFlyout.tsx')
  assert.match(flyout, /const galleryImageAlt = \[product\.name, brandValues\[0\]\]/, 'the sheet photo does the same')
  assert.match(flyout, /alt=\{galleryImageAlt\}/)
})

runTest('the logo and cover images name the business or hide themselves', () => {
  const secondary = read('CatalogSecondaryTabs.tsx')
  // The cover is a backdrop; the logo IS the business identity.
  assert.match(secondary, /src=\{versionedBusinessCover\}\s*\r?\n\s*alt=""\s*\r?\n\s*aria-hidden="true"/, 'the cover backdrop is decorative')
  assert.match(secondary, /alt=\{previewConfig\.businessName \|\| copy\('logoImage', 'Logo image'\)\}/, 'the logo names the business')
})

// ---------------------------------------------------------------------------
// 2. ACCESSIBLE NAMES -- no icon-only control without one.
// ---------------------------------------------------------------------------

runTest('the product-sheet thumbnail strip names each thumbnail', () => {
  const flyout = read('ProductDetailFlyout.tsx')
  // On the base tree each thumbnail button contained only an alt="" image,
  // so a reader announced a row of bare "button".
  assert.match(flyout, /aria-label=\{imageLabel\(index\)\}/, 'each thumbnail says which image it is')
  assert.match(flyout, /aria-current=\{index === activeIndex \? 'true' : undefined\}/, 'and which one is showing')
  assert.match(flyout, /const imageLabel = \(index: number\) => copy\('dotsLabel'/, 'the label is translated, not hardcoded')
})

runTest('the promotion image opens with a named control', () => {
  const products = read('CatalogProductsSection.tsx')
  assert.match(products, /aria-label=\{`\$\{copy\('viewImages', 'View images'\)\}\$\{item\.title \? `: \$\{item\.title\}` : ''\}`\}/)
})

runTest('every storefront button that renders only icons carries a name', () => {
  // Scan each <button ...> opening tag plus its body up to the closing tag,
  // and flag any whose entire content is Lucide icons / spans of icons with
  // no text node and no aria-label / aria-labelledby / title.
  const failures: string[] = []
  for (const file of PUBLIC_STOREFRONT_FILES) {
    const source = read(file)
    for (const match of source.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)) {
      const [, attrs, body] = match
      if (/aria-label|aria-labelledby|\btitle=/.test(attrs)) continue
      // Strip comments, then every self-closing element (icons, spans) and
      // JSX expression containers; whatever is left is the literal text.
      const text = body
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/<[A-Za-z][^>]*\/>/g, '')
        .replace(/\{[^{}]*\}/g, '')
        .replace(/<\/?[A-Za-z][^>]*>/g, '')
        .trim()
      // A JSX expression container may itself be the label (copy('close')),
      // so only flag buttons whose body has no expression AND no text.
      if (text.length === 0 && !/\{[^{}]*copy\(/.test(body) && !/\{[^{}]*label/i.test(body)) {
        failures.push(`${file}: <button ${attrs.replace(/\s+/g, ' ').trim().slice(0, 90)}>`)
      }
    }
  }
  assert.deepEqual(failures, [])
})

runTest('toggle controls report their state, not just their name', () => {
  const account = read('CatalogAccountSection.tsx')
  assert.match(account, /aria-pressed=\{mode === 'signin'\}/, 'the sign in / sign up switch is a pressed pair')
  assert.match(account, /aria-pressed=\{mode === 'signup'\}/)
  const combobox = read('PortalFilterCombobox.tsx')
  assert.match(combobox, /aria-expanded=\{open\}/, 'the filter trigger says whether the list is open')
})

// ---------------------------------------------------------------------------
// 3. FORMS -- labels, focus, errors, keyboard.
// ---------------------------------------------------------------------------

runTest('every account-form input is labelled through a real for/id pair', () => {
  const account = read('CatalogAccountSection.tsx')
  // Base tree: <Field> wrapped its children in a bare <label>, which labels
  // an input implicitly but leaves the hint unlinked and makes the field
  // impossible to reference from an error message.
  assert.match(account, /htmlFor=\{fieldId\}/, 'the visible label points at the control')
  assert.match(account, /id=\{fieldId\}/, 'the control carries that id')
  const inputs = [...account.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0])
  // Six literal <input> elements: sign-in takes identifier + phone, sign-up
  // takes name + phone + membership id, and the single shared PasswordField
  // renders the one password control both forms mount.
  assert.ok(inputs.length >= 6, `expected the sign-in and sign-up inputs, found ${inputs.length}`)
  for (const input of inputs) {
    assert.match(input, /\bid=\{/, `every input carries an id: ${input.replace(/\s+/g, ' ').slice(0, 80)}`)
  }
})

runTest('a field hint and a field error are linked with aria-describedby', () => {
  const account = read('CatalogAccountSection.tsx')
  assert.match(account, /aria-describedby=\{describedBy\}/, 'the input points at its hint / error')
  assert.match(account, /id=\{`\$\{fieldId\}-hint`\}/, 'the hint has the id it is pointed at')
})

runTest('the form error is announced, not just painted red', () => {
  const account = read('CatalogAccountSection.tsx')
  assert.match(account, /role="alert"/, 'the error alert announces itself when it appears')
  assert.match(account, /aria-live="assertive"/)
})

runTest('phone fields open a phone keypad', () => {
  const account = read('CatalogAccountSection.tsx')
  const telInputs = [...account.matchAll(/<input\b[\s\S]*?type="tel"[\s\S]*?\/>/g)].map((m) => m[0])
  assert.equal(telInputs.length, 2, 'sign-in and sign-up both take a phone number')
  for (const input of telInputs) assert.match(input, /inputMode="tel"/)
})

runTest('the password field has a labelled show / hide control', () => {
  const account = read('CatalogAccountSection.tsx')
  assert.match(account, /portal_a11y_show_password/, 'the reveal control is named from the packs')
  assert.match(account, /portal_a11y_hide_password/)
  assert.match(account, /aria-pressed=\{visible\}/, 'and it reports whether the password is showing')
  assert.match(account, /type=\{visible \? 'text' : 'password'\}/, 'and actually toggles the field')
})

/**
 * The set of inks this project has actually MEASURED at >= 3:1 against a
 * storefront ground (WCAG 1.4.11 for a UI component). A focus indicator is
 * only a focus indicator if it is painted in one of them.
 */
const MEASURED_UI_INKS = new Set(
  PORTAL_CONTRAST_PAIRS.filter((pair) => pair.kind === 'ui').map((pair) => pair.foreground.toLowerCase()),
)

/**
 * Does this class string replace the outline it just removed?
 *
 * The previous version of this sweep accepted a bare `focus:ring-*` or
 * `focus:border-*` as the replacement, and that escape hatch is precisely what
 * let the storefront's only real form through: CatalogAccountSection's fields
 * carried `outline-none focus:border-emerald-400`, which is 1.75:1, and the
 * filter menu's search field carried `focus:ring-blue-100`, which is 1.16:1 on
 * white. A tint that the eye cannot separate from the resting state is not an
 * indicator. So: an actual outline utility, or a ring in a colour that appears
 * in PORTAL_CONTRAST_PAIRS at kind 'ui' -- nothing else counts.
 */
function paintsAMeasuredFocusIndicator(line: string): boolean {
  const inks = [...line.matchAll(/focus-visible:(?:outline|ring)-\[(#[0-9a-fA-F]{6})\]/g)].map((m) => m[1].toLowerCase())
  if (!inks.length) return false
  if (!inks.every((ink) => MEASURED_UI_INKS.has(ink))) return false
  // A colour on its own is not a ring: the style has to be turned on too.
  return /focus-visible:outline\b/.test(line) || /focus-visible:ring-\d/.test(line)
}

runTest('no storefront control kills its focus outline without replacing it', () => {
  // `outline-none` is fine ONLY when the same element paints a MEASURED ring
  // of its own, or when it sits inside a root the portal stylesheet's
  // :focus-visible rule actually reaches. Both halves matter: the stylesheet
  // rule shipped scoped to two roots the live customer route does not carry,
  // so "the stylesheet covers everything" was false for every drawer on the
  // real shop -- see the root-parity test above.
  const css = readFrontend('src', 'styles', 'public-portal.css')
  assert.match(css, /:focus-visible \{\s*\r?\n\s*outline: 3px solid/, 'the portal paints one focus ring for everything inside it')
  const failures: string[] = []
  for (const file of PUBLIC_STOREFRONT_FILES) {
    const source = read(file)
    const lines = source.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!/\boutline-none\b/.test(line)) return
      // A comment that NAMES the utility is not the utility.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (paintsAMeasuredFocusIndicator(line)) return
      // Two legitimate shapes the same-line check cannot see:
      //  - the indicator is painted by the WRAPPER (a bordered field shell
      //    with focus-within:ring around a transparent input), which is the
      //    portal search field;
      //  - the element is tabIndex={-1}, i.e. focused only programmatically
      //    when a popup opens, so it is never a Tab stop that needs a ring.
      const window = lines.slice(Math.max(0, index - 8), index + 4).join('\n')
      if (/focus-within:ring|focus-within:border/.test(window)) return
      if (/tabIndex=\{-1\}/.test(window)) return
      failures.push(`${file}: ${line.trim().slice(0, 110)}`)
    })
  }
  assert.deepEqual(failures, [])
})

runTest('the portal stylesheet scopes focus, touch targets and reduced motion to the SAME roots', () => {
  // The rule that nearly sank this lane: there are THREE portal root markers
  // and the live customer route carries only one of them. CatalogPage (the
  // admin preview) stamps body[data-public-portal] and wraps its surfaces in
  // [data-portal-root]; PublicCatalogPage -- the actual shop -- marks its own
  // outermost <div> with data-public-media-protection and neither of the other
  // two. A :focus-visible rule scoped to the first two roots therefore painted
  // nothing on the real storefront's drawers, while the pointer:coarse block
  // right above it already listed the live root and worked. Any block that
  // claims to cover "the portal" must name the same set, or it silently covers
  // a different site than the block beside it.
  const css = readFrontend('src', 'styles', 'public-portal.css')
  const MARKERS = ['data-public-media-protection', 'data-portal-root', 'data-public-portal']
  const rootsIn = (text: string): string[] => MARKERS.filter((marker) => text.includes(marker)).sort()

  const focusList = /\n((?:[^\n{]*:focus-visible,\s*\n)*[^\n{]*:focus-visible) \{\s*\r?\n\s*outline: 3px solid/.exec(css)
  assert.ok(focusList, 'the :focus-visible ring rule must exist')
  const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)
  assert.ok(coarse, 'the coarse-pointer block must exist')
  const motion = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)
  assert.ok(motion, 'the reduced-motion block must exist')

  assert.deepEqual(rootsIn(focusList[1]), MARKERS.slice().sort(), 'the focus ring must reach all three portal roots')
  assert.deepEqual(rootsIn(motion[1]), rootsIn(focusList[1]), 'reduced motion and the focus ring must name the same roots')
  // The touch-target block is deliberately NARROWER, and only in this one
  // direction: [data-portal-root] is also stamped on CatalogPage's !publicView
  // return, i.e. around the ADMIN portal editor, so putting it in a rule that
  // raises every button to 44px would rewrite that editor's density on a
  // tablet -- a change to an admin surface this lane does not own. A focus
  // ring and a reduced-motion switch carry no such cost, so they take the
  // wider set. What must never happen is the reverse: a root that gets touch
  // targets but no focus ring is a portal surface the ring forgot.
  const coarseRoots = rootsIn(coarse[1])
  assert.ok(coarseRoots.length > 0, 'the coarse block must still name portal roots')
  for (const root of coarseRoots) {
    assert.ok(rootsIn(focusList[1]).includes(root), `${root} gets touch targets but no focus ring`)
    assert.ok(rootsIn(motion[1]).includes(root), `${root} gets touch targets but no reduced-motion guard`)
  }
  assert.ok(coarseRoots.includes('data-public-media-protection'), 'the live customer route is in the touch-target block')

  // And the marker the live route actually carries is really the one on it.
  const publicPage = read('PublicCatalogPage.tsx')
  assert.match(publicPage, /data-public-media-protection="true"/, 'the customer route root carries the live marker')
  assert.doesNotMatch(publicPage, /data-portal-root="true"/, 'and not the preview-only one -- so the CSS cannot rely on it')
})

runTest('the storefront controls no portal-scoped CSS can reach carry their own ring', () => {
  // shared/PortalMenu.tsx createPortal()s its popup to document.body, so the
  // filter menu's search field and the language-menu search field sit OUTSIDE
  // every portal root: no descendant selector in public-portal.css can ever
  // match them. Their base-tree indicator was focus:ring-blue-100 (#dbeafe on
  // white = 1.16:1). They need the ring in their own class string.
  for (const file of ['PortalFilterCombobox.tsx', 'CatalogPreviewSurface.tsx']) {
    const source = read(file)
    assert.match(source, /focus-visible:outline-\[#0369a1\]/, `${file}: the popup search field paints its own focus outline`)
    assert.match(source, /dark:focus-visible:outline-\[#fcd34d\]/, `${file}: and the dark-mode counterpart`)
  }
  // The account drawer renders as a sibling of <CatalogPreviewSurface> and is
  // the storefront's only real form, so it does not get to depend on a
  // stylesheet rule either.
  const account = read('CatalogAccountSection.tsx')
  const inputClass = /const inputClass = '([^']+)'/.exec(account)
  assert.ok(inputClass, 'inputClass must still be a single class string')
  assert.match(inputClass[1], /focus-visible:outline-\[#0369a1\]/, 'every account field paints its own focus outline')
  assert.match(inputClass[1], /focus-visible:outline-\[3px\]/, 'three solid pixels, matching the stylesheet ring')
})

runTest('the product search field has a name, not just a placeholder', () => {
  const products = read('CatalogProductsSection.tsx')
  // Base tree: <label> wrapped the input but contained only the magnifier
  // icon, so the computed accessible name was empty.
  assert.match(products, /htmlFor="portal-product-search"/, 'the label points at the field')
  assert.match(products, /<span className="sr-only">\{copy\('searchPlaceholder', 'Search products'\)\}<\/span>/, 'and carries real label text')
})

// ---------------------------------------------------------------------------
// 4. KEYBOARD -- the combobox pattern, the dialog, the card.
// ---------------------------------------------------------------------------

runTest('the filter combobox follows the WAI-ARIA combobox pattern', () => {
  const combobox = read('PortalFilterCombobox.tsx')
  assert.match(combobox, /role="combobox"/, 'the text field is the combobox')
  assert.match(combobox, /aria-expanded=\{open\}/)
  assert.match(combobox, /aria-controls=\{listboxId\}/)
  assert.match(combobox, /aria-activedescendant=/, 'the active option is reported without moving focus')
  assert.match(combobox, /aria-autocomplete="list"/)
  assert.match(combobox, /id=\{listboxId\}/, 'the listbox has the id the combobox points at')
  // Arrow keys / Home / End / Enter / Escape.
  assert.match(combobox, /case 'ArrowDown'/)
  assert.match(combobox, /case 'ArrowUp'/)
  assert.match(combobox, /case 'Enter'/)
  assert.match(combobox, /case 'Escape'/)
  assert.match(combobox, /case 'Home'/)
  assert.match(combobox, /case 'End'/)
})

runTest('every row inside the combobox listbox is an option, and nothing else is', () => {
  const combobox = read('PortalFilterCombobox.tsx')
  // Base tree: the "All" button and the group wrapper <div>s were direct
  // children of role="listbox" without being options, which makes the whole
  // listbox invalid to a reader.
  assert.match(combobox, /role="option"\s*\r?\n\s*aria-selected=\{!selected\.length\}/, 'the "All" row is an option too')
  assert.match(combobox, /role="group"/, 'a category group is a group of options, not a bare div')
  assert.match(combobox, /aria-label=\{group\.mainLabel\}/)
})

runTest('the combobox search field and the chip removers are named from the packs', () => {
  const combobox = read('PortalFilterCombobox.tsx')
  assert.doesNotMatch(combobox, /`\$\{label\}: \$\{selected\.length \? `\$\{selected\.length\} selected`/, 'the trigger name was hardcoded English')
  assert.doesNotMatch(combobox, /aria-label=\{`Remove \$\{/, 'the chip remover was hardcoded English')
  assert.match(combobox, /portal_a11y_selected_count/, 'the selection count comes from the packs')
  assert.match(combobox, /portal_a11y_remove_filter/, 'so does the chip remover')
  assert.match(combobox, /searchLabel/, 'the search field is labelled, not placeholder-only')
})

runTest('the product sheet is a real modal dialog', () => {
  const flyout = read('ProductDetailFlyout.tsx')
  assert.match(flyout, /role="dialog"/)
  assert.match(flyout, /aria-modal="true"/)
  assert.match(flyout, /aria-labelledby=\{titleId\}/, 'the dialog is named by its own visible heading')
  // Base tree: no Escape handler, no focus move-in, no trap, no return.
  assert.match(flyout, /if \(event\.key === 'Escape'\)/, 'Escape closes it')
  assert.match(flyout, /if \(event\.key !== 'Tab'\) return/, 'Tab is trapped inside it')
  assert.match(flyout, /previouslyFocusedRef/, 'focus goes back where it came from on close')
  assert.match(flyout, /dialogRef\.current\?\.focus\(\)|closeButtonRef\.current\?\.focus\(\)/, 'focus moves in on open')
})

runTest('the backdrop click-to-close has a keyboard equivalent', () => {
  const flyout = read('ProductDetailFlyout.tsx')
  // A bare <div onClick={onClose}> backdrop is unreachable by keyboard; the
  // Escape handler above is the equivalent, and the backdrop itself must not
  // pretend to be a control.
  assert.match(flyout, /aria-hidden="true"[\s\S]{0,400}onClick=\{onClose\}|onClick=\{onClose\}[\s\S]{0,200}aria-hidden="true"/, 'the backdrop is presentational')
})

runTest('a product card can be opened from the keyboard', () => {
  const products = read('CatalogProductsSection.tsx')
  // Base tree: <article onClick={...}> with no tabIndex, no role and no key
  // handler -- the storefront's primary action was mouse-only.
  //
  // The <article> itself CANNOT become the button: it already contains the
  // wishlist and add-to-list buttons, and role="button" must not contain
  // interactive descendants. So the product NAME is the control -- a real
  // <button>, which brings Enter/Space, a tab stop and a name for free, and
  // which a reader announces with the product's own words.
  assert.match(
    products,
    /<button\s*\r?\n\s*type="button"\s*\r?\n\s*onClick=\{\(event\) => \{ event\.stopPropagation\(\); openProductDetail\(product\) \}\}/,
    'the product name is a real button that opens the sheet',
  )
  assert.match(products, /openProductDetail \? \(\s*\r?\n\s*<button/, 'and stays a plain name when there is no sheet to open')
  // The photo opens the gallery -- a separate action. The first attempt put
  // role="button" on the WRAPPER, which was wrong: that wrapper also holds
  // the absolutely-positioned promotion badges and the StatusPill, so the
  // badges and the stock status became content of a control whose aria-label
  // overrides its contents -- announced as nothing at all. The opener has to
  // be a sibling of those layers, not their parent.
  assert.doesNotMatch(products, /role=\{gallery\.length \? 'button' : undefined\}/, 'the badge/status wrapper is not itself the control')
  const opener = /<button\b[^>]*\bdata-gallery-open="true"[\s\S]*?\/>/.exec(products)
  assert.ok(opener, 'the gallery opener is a standalone overlay button')
  assert.doesNotMatch(opener[0], /<StatusPill/, 'the stock pill is not inside the control')
  assert.doesNotMatch(opener[0], /highlightBadges\.map/, 'nor are the promotion badges')
  assert.match(opener[0], /aria-label=\{`\$\{copy\('viewImages', 'View images'\)\}: \$\{product\.name\}`\}/, 'named by the product it shows')
  assert.match(opener[0], /className="absolute inset-0 /, 'and it covers the whole photo')
  // The badges and the status pill still render, just no longer swallowed.
  assert.match(products, /highlightBadges\.map/, 'the badges are still painted')
  assert.match(products, /<StatusPill copy=\{copy\} status=\{status\} \/>/, 'and so is the stock status')
})

runTest('storefront heading levels run in order under the one h1', () => {
  const products = read('CatalogProductsSection.tsx')
  // The products section is a SectionShell, whose title is the h2. Base tree:
  // the promotions group title was a styled <div> while each promotion card
  // inside it was an <h3>, so heading navigation entered the offers with no
  // heading naming the run of them.
  assert.match(products, /<h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">\{promotionsTitle/, 'the promotions group is a heading')
  assert.match(products, /<h4 className="text-2xl font-semibold leading-tight">\{item\.title\}<\/h4>/, 'and each offer sits one level below it')
  const ui = read('catalogUi.tsx')
  assert.match(ui, /<h2 className="text-lg font-semibold[^"]*">\{title\}<\/h2>/, 'every portal section title is the h2 under the storefront h1')
  // No level may be skipped anywhere on the public route.
  for (const file of PUBLIC_STOREFRONT_FILES) {
    const levels = [...read(file).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]))
    for (const level of levels) {
      assert.ok(level <= 4, `${file}: h${level} is below the storefront's h1/h2/h3/h4 ladder`)
    }
  }
})

// ---------------------------------------------------------------------------
// 5. STRUCTURE -- landmarks, headings, language, zoom, skip link.
// ---------------------------------------------------------------------------

runTest('the storefront declares header / nav / main landmarks', () => {
  const surface = read('CatalogPreviewSurface.tsx')
  assert.match(surface, /<header\b/, 'the business-name row is a banner')
  assert.match(surface, /<nav\b/, 'the section tab row is navigation')
  assert.match(surface, /aria-label=\{copy\('publicNavigation', 'Section navigation'\)\}/, 'and the nav is named')
  assert.match(surface, /<main\b/, 'the tab content is the main landmark')
  assert.match(surface, /id="portal-main-content"/, 'which the skip link targets')
})

runTest('there is exactly one h1, and it is the storefront title', () => {
  const surface = read('CatalogPreviewSurface.tsx')
  const headings = [...surface.matchAll(/<(h[1-6])\b/g)].map((m) => m[1])
  assert.equal(headings.filter((h) => h === 'h1').length, 1, `expected one h1, found ${headings.filter((h) => h === 'h1').length}`)
  assert.match(surface, /<h1\b[\s\S]{0,600}\{previewTitle \|\| displayConfig\.businessName/, 'the h1 is the shop name')
  // Nothing else on the public route may claim an h1.
  for (const file of PUBLIC_STOREFRONT_FILES.filter((f) => f !== 'CatalogPreviewSurface.tsx')) {
    assert.doesNotMatch(read(file), /<h1\b/, `${file} must not add a second h1`)
  }
})

runTest('the section tabs report which one is showing', () => {
  const surface = read('CatalogPreviewSurface.tsx')
  assert.match(surface, /aria-current=\{selected \? 'page' : undefined\}/)
})

runTest('the page language follows the chosen storefront language', () => {
  const publicPage = read('PublicCatalogPage.tsx')
  // Base tree: the <html lang> stayed on whatever the admin app set, so a
  // Khmer storefront was announced to a screen reader as English.
  assert.match(publicPage, /document\.documentElement\.lang = /, 'the document language is set')
  assert.match(publicPage, /portalDocumentLanguage/, 'from the resolved storefront language, not a constant')
})

runTest('the storefront offers a skip-to-content link', () => {
  const surface = read('CatalogPreviewSurface.tsx')
  assert.match(surface, /className="portal-skip-link"/)
  assert.match(surface, /href="#portal-main-content"/)
  assert.match(surface, /portal_a11y_skip_to_content/, 'named from the packs')
  const css = readFrontend('src', 'styles', 'public-portal.css')
  assert.match(css, /\.portal-skip-link \{[\s\S]*?left: -9999px/, 'off-screen until focused')
  assert.match(css, /\.portal-skip-link:focus/, 'and visible once it is')
})

runTest('pinch zoom is not disabled', () => {
  // WCAG 1.4.4: the app shipped `maximum-scale=1, user-scalable=no`, which
  // stops a low-vision visitor enlarging the storefront at all.
  const html = readFrontend('index.html')
  const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html)
  assert.ok(viewport, 'the viewport meta must exist')
  assert.doesNotMatch(viewport[1], /user-scalable\s*=\s*no/)
  assert.doesNotMatch(viewport[1], /maximum-scale\s*=\s*1\b/)
  assert.match(viewport[1], /width=device-width/)
})

runTest('stock status is not carried by colour alone', () => {
  const ui = read('catalogUi.tsx')
  // The dot is colour; the text beside it is what actually says the status.
  assert.match(ui, /\{copy\(labelKey, fallback\)\}/, 'the badge prints its status in words')
  assert.match(ui, /aria-hidden="true"/, 'and the colour dot is decorative')
})

runTest('touch targets on the storefront stay at least 40px on coarse pointers', () => {
  const css = readFrontend('src', 'styles', 'public-portal.css')
  const block = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)
  assert.ok(block, 'the coarse-pointer block must exist')
  const sizes = [...block[1].matchAll(/min-(?:width|height): (\d+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length > 0, 'it must actually set sizes')
  assert.ok(Math.min(...sizes) >= 40, `smallest target is ${Math.min(...sizes)}px`)
})

runTest('reduced motion is honoured by both halves of the promo strip', () => {
  const css = readFrontend('src', 'styles', 'public-portal.css')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  const strip = read('PortalPromoStrip.tsx')
  assert.match(strip, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
})

// ---------------------------------------------------------------------------
// 6. i18n -- every new name is in BOTH packs, under this lane's namespace.
// ---------------------------------------------------------------------------

runTest('every portal_a11y_* key exists in both packs and is used', () => {
  const en = JSON.parse(readFrontend('src', 'lang', 'en.json')) as Record<string, string>
  const km = JSON.parse(readFrontend('src', 'lang', 'km.json')) as Record<string, string>
  const enKeys = Object.keys(en).filter((k) => k.startsWith('portal_a11y_'))
  assert.ok(enKeys.length >= 6, `expected the lane's keys in en.json, found ${enKeys.length}`)
  for (const key of enKeys) {
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `${key} must be real Khmer, not the English string`)
    assert.ok(/[ក-៿]/.test(km[key]), `${key} must be written in Khmer script`)
  }
  const kmKeys = Object.keys(km).filter((k) => k.startsWith('portal_a11y_'))
  assert.deepEqual(kmKeys.sort(), enKeys.sort(), 'the two packs carry the same portal_a11y_ keys')
  // Nothing dead: every key is referenced from the storefront.
  const allSource = PUBLIC_STOREFRONT_FILES.map(read).join('\n')
  for (const key of enKeys) {
    assert.ok(allSource.includes(key), `${key} is in the packs but nothing renders it`)
  }
})

runTest('the storefront copy() can actually reach a portal_a11y_ pack key', () => {
  const publicPage = read('PublicCatalogPage.tsx')
  // copy() prefixes every key with `portalEditor.`, so a bare pack key was
  // unreachable and the entry would have been dead weight.
  assert.match(publicPage, /key\.startsWith\('portal_a11y_'\)/, 'the lane namespace resolves against the flat pack')
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nportalAccessibility: all green')

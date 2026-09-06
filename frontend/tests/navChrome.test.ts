// The mobile two-layer navigation chrome (N35).
//
// Three reports, one surface (owner, Sep 6 2026, on a phone):
//   GAP    "it didn't merge the line with the topbar... there is a
//           considerable gap between the open pages and top bar"
//   STALE  "it still shows the page i back from"
//   DESIGN "the color contrast ... it all seems to just use grey, and
//           background white, text and icon black... looks very old"
//
// Every case below is written so that the shipped code and the fixed code
// disagree on it -- not merely so that it passes now. The three that pin a
// changed decision carry their pre-fix answer inline as a negative control,
// so the assertion still means something if the module is ever rewritten.
//
// Run: node tests/navChrome.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  APP_UPDATE_BAR_HEIGHT_REM,
  MOBILE_HEADER_HEIGHT_REM,
  mobileChromeContentOffset,
  mobileChromeViewportOffset,
  navLayerToggle,
} from '../src/utils/mobileNavChrome.ts'
import { resolveChromeSection, resolveHubSection } from '../src/components/shared/hubNavigation.ts'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const sidebar = read('components/navigation/Sidebar.tsx')
const app = read('App.tsx')
const css = read('components/navigation/nav-chrome.css')
/** The opening of the layer's own JSX block. `{moreOpen ? (` on its own also
 *  matches the Back control's aria-label expression higher up the file. */
const LAYER_ANCHOR = '{moreOpen ? (\n        <>'

// ---------------------------------------------------------------- GAP -----

runTest('the chrome offset answers all four (update bar x auto-hidden header) states', () => {
  assert.equal(MOBILE_HEADER_HEIGHT_REM, 4)
  assert.equal(APP_UPDATE_BAR_HEIGHT_REM, 3)
  const v = (headerVisible: boolean, appUpdateVisible: boolean) =>
    mobileChromeViewportOffset({ headerVisible, appUpdateVisible })
  assert.equal(v(true, false), 'calc(4rem + env(safe-area-inset-top))')
  assert.equal(v(true, true), 'calc(7rem + env(safe-area-inset-top))')
  assert.equal(v(false, true), 'calc(3rem + env(safe-area-inset-top))')
  // Both bars gone: the layer still clears the notch, and only the notch.
  assert.equal(v(false, false), 'env(safe-area-inset-top)')
})

runTest('viewport offset and content offset differ by exactly the update bar', () => {
  // #app-root already carries `pt-[calc(3rem+env(safe-area-inset-top))]` when
  // an update is waiting, so <main> must not count that band a second time
  // while a fixed overlay must count it once. Getting this backwards is the
  // classic way a "flush" bar lands 3rem off, so state the relationship.
  for (const headerVisible of [true, false]) {
    const viewport = mobileChromeViewportOffset({ headerVisible, appUpdateVisible: true })
    const content = mobileChromeContentOffset({ headerVisible, appUpdateVisible: true })
    const bars = headerVisible ? MOBILE_HEADER_HEIGHT_REM : 0
    assert.equal(viewport, `calc(${bars + APP_UPDATE_BAR_HEIGHT_REM}rem + env(safe-area-inset-top))`)
    assert.equal(content, bars > 0 ? `${bars}rem` : '0px')
    // With no update bar the two projections coincide.
    assert.equal(
      mobileChromeViewportOffset({ headerVisible, appUpdateVisible: false }),
      mobileChromeContentOffset({ headerVisible, appUpdateVisible: false }),
    )
  }
})

runTest('the kernel agrees with the padding App.tsx actually ships on <main>', () => {
  // The drift this catches: someone changes the header height in App.tsx's
  // class chain and the layer keeps anchoring to the old one, reopening the
  // band. The kernel is only an authority if it matches the shipped chain.
  const main = app.slice(app.indexOf('<main'), app.indexOf('<PullToRefreshIndicator'))
  assert.ok(main.includes('pt-'), 'located the <main> element and its padding chain')
  const expected: Array<[boolean, boolean, string]> = [
    [true, true, 'pt-16'],
    [true, false, 'pt-[calc(4rem+env(safe-area-inset-top))]'],
    [false, true, 'pt-0'],
    [false, false, 'pt-[env(safe-area-inset-top)]'],
  ]
  for (const [headerVisible, appUpdateVisible, tailwind] of expected) {
    assert.ok(main.includes(tailwind), `<main> still ships ${tailwind}`)
    const offset = mobileChromeContentOffset({ headerVisible, appUpdateVisible })
    const asTailwind = offset === '0px'
      ? 'pt-0'
      : offset === '4rem'
        ? 'pt-16'
        : `pt-[${offset.replace(/\s+/g, '')}]`
    assert.equal(asTailwind, tailwind, `content offset for header=${headerVisible} update=${appUpdateVisible}`)
  }
})

runTest('the pages layer is anchored to the chrome, not to the bottom of the viewport', () => {
  const layer = sidebar.slice(sidebar.indexOf(LAYER_ANCHOR))
  assert.match(sidebar, /const navLayerTop = mobileChromeViewportOffset\(\{ headerVisible: mobileHeaderVisible, appUpdateVisible \}\)/,
    'the layer offset comes from the shared kernel, in both auto-hide states')
  assert.match(layer, /style=\{inline \? \{ top: navLayerTop \} : undefined\}/,
    'pages mode pins the layer top to that offset')
  // The pre-fix shape, kept as a negative control: a bottom-anchored sheet
  // capped at 70vh cannot be flush with a top-anchored bar, and the band it
  // leaves is where the page you backed out of showed through.
  assert.doesNotMatch(layer, /inline \? '[^']*max-h-\[70vh\]/, 'pages mode must not cap the layer at 70vh')
  assert.match(layer, /\$\{inline \? 'bos-nav-chrome bos-nav-layer' : 'max-h-\[70vh\][^']*'\}/,
    'only the legacy sections-mode sheet keeps the 70vh cap')
  assert.match(layer, /\{inline \? null : <div className="fixed inset-0 z-30 bg-black\/40 md:hidden"/,
    'an opaque full-height layer needs no scrim; the legacy sheet still gets one')
  assert.match(css, /\.bos-nav-layer \{[^}]*background-color: var\(--nav-ground\)/,
    'and the layer paints an opaque ground so nothing shows through it')
})

runTest('the Back control is a toggle, because the layer now covers its own dismissal', () => {
  assert.deepEqual(navLayerToggle({ open: false, expanded: null }, 'products', true), { open: true, expanded: 'products' })
  assert.deepEqual(navLayerToggle({ open: false, expanded: null }, 'dashboard', false), { open: true, expanded: null })
  // The half the shipped `setMoreOpen(true)` could not do: close again.
  assert.deepEqual(navLayerToggle({ open: true, expanded: 'products' }, 'products', true), { open: false, expanded: null })
  assert.deepEqual(navLayerToggle({ open: true, expanded: null }, 'sales', true), { open: false, expanded: null })
  assert.match(sidebar, /navLayerToggle\(\{ open: moreOpen, expanded: expandedGroup \}, page, currentSections\.length > 0\)/,
    'the header control routes through that kernel')
  assert.match(sidebar, /aria-expanded=\{moreOpen\}\s*\n\s*aria-controls="mobile-nav-layer"/,
    'and announces the layer it controls')
  assert.match(sidebar, /id="mobile-nav-layer"/, 'which is the layer that exists')
})

// -------------------------------------------------------------- STALE -----

runTest('chrome section follows the committed route and claims nothing when the route is silent', () => {
  const products = ['products', 'stock_changes', 'stock_in_sessions', 'duplicates']
  assert.equal(resolveChromeSection('products', '/products', '#hub:products:stock_changes', products), 'stock_changes')
  assert.equal(resolveChromeSection('products', '/products', '', products), '')
  // Another page's anchor is not this page's section.
  assert.equal(resolveChromeSection('products', '/products', '#hub:sales:returns', products), '')
  // A section the current permissions do not grant is not claimable either.
  assert.equal(resolveChromeSection('products', '/products', '#hub:products:duplicates', ['products']), '')
  // Non-hub anchors (a Settings field, a notification target) keep their own
  // meaning and must not be read as a section.
  assert.equal(resolveChromeSection('settings', '/settings', '#business-identity', ['settings', 'users']), '')
  // Legacy routes still name their section, so an old bookmark titles right.
  assert.equal(resolveChromeSection('sales', '/returns', '', ['sales', 'returns']), 'returns')
  assert.equal(resolveChromeSection('sales', '/Returns/', '', ['sales', 'returns']), 'returns')
})

runTest('the chrome no longer guesses the last-visited section the body is not showing', () => {
  // The exact reported state: /products entered with no anchor (cold PWA
  // launch, bookmark, or a page tap that cleared a foreign hub hash) while
  // `bos:hub:products:active` still says stock_changes. Products.tsx's host
  // hook seeds itself from a FIXED 'products' default, not from that key --
  //   useHubSection<...>('products', 'products', productSectionIds, navigateTo)
  // -- so the body renders Products while the bar used to title itself
  // "Stock Changes": the page you backed out of, still showing.
  const products = ['products', 'stock_changes', 'stock_in_sessions', 'duplicates']
  const remembered = 'stock_changes'
  const hostDefault = 'products'
  // Negative control -- what the chrome computed before, spelled out:
  assert.equal(resolveHubSection('products', '/products', '', products, remembered), 'stock_changes')
  // What the body computes for the same location:
  assert.equal(resolveHubSection('products', '/products', '', products, hostDefault), 'products')
  // The chrome now asks a question that cannot disagree with the body.
  assert.equal(resolveChromeSection('products', '/products', '', products), '')
  assert.doesNotMatch(sidebar, /localStorage\.getItem\(`bos:hub:/,
    'the chrome must not read the remembered-section key at all')
  assert.doesNotMatch(sidebar, /page === 'branches' \? 'overview'/,
    'nor carry a per-page fallback of its own')
  assert.match(sidebar, /resolveChromeSection\(page, location\.pathname, location\.hash, currentSections\.map\(\(section\) => section\.id\)\)/,
    'the title and the layer both resolve the committed section')
  // Same input, same answer, for every hub the layer offers.
  for (const [page, ids] of [
    ['sales', ['sales', 'returns', 'fees', 'reports']],
    ['branches', ['overview', 'products', 'transfers', 'rfid']],
    ['contacts', ['customers', 'suppliers', 'delivery', 'duplicates']],
    ['promotions', ['rules', 'discounts', 'loyalty']],
    ['settings', ['settings', 'users', 'backup']],
    ['review', ['review', 'audit', 'deleted']],
  ] as Array<[string, string[]]>) {
    assert.equal(resolveChromeSection(page, `/${page}`, '', ids), '', `${page}: no anchor claims no section`)
    for (const id of ids) {
      assert.equal(resolveChromeSection(page, `/${page}`, `#hub:${page}:${id}`, ids), id, `${page}:${id} follows the route`)
    }
  }
})

runTest('resolveHubSection is unchanged for the hosts that own a fallback', () => {
  // The refactor that produced resolveChromeSection must not move the host
  // hook's own answer -- sectionNavigation.test.ts drives the real thing.
  const allowed = ['sales', 'returns', 'fees', 'reports']
  assert.equal(resolveHubSection('sales', '/sales', '#hub:sales:fees', allowed, 'sales'), 'fees')
  assert.equal(resolveHubSection('sales', '/sales', '', allowed, 'fees'), 'fees')
  assert.equal(resolveHubSection('sales', '/sales', '', allowed, 'nope'), 'sales')
  assert.equal(resolveHubSection('sales', '/sales', '', [], 'sales'), '')
  assert.equal(resolveHubSection('sales', '/returns', '', allowed, 'sales'), 'returns')
})

runTest('the open section is marked from the route, and marked visibly', () => {
  assert.match(sidebar, /const isOpenSection = page === entry\.ownerId && currentSectionId === section\.id/,
    'active is a route comparison, computed once')
  assert.match(sidebar, /aria-current=\{isOpenSection \? 'page' : undefined\}/)
  assert.match(sidebar, /bos-nav-section[^`]*\$\{isOpenSection \? 'is-active' : ''\}/,
    'and it drives a real class, not only an aria attribute')
  // Negative control: the shipped section button had ONE className for both
  // states, so the section you were in was indistinguishable from the rest.
  assert.doesNotMatch(sidebar, /className="min-h-11 min-w-0 break-words rounded-lg border border-gray-200 bg-white/,
    'the state-less section button must be gone')
  assert.match(css, /\.bos-nav-section\.is-active \{[\s\S]*?font-weight: 600/,
    'the open section differs by weight as well as colour')
  assert.match(css, /\.bos-nav-section\.is-active \{[\s\S]*?box-shadow: inset 3px 0 0 0 var\(--nav-accent\)/,
    'and by a non-colour cue -- the gold rule on its leading edge')
})

// ------------------------------------------------------------- DESIGN -----

const srgbToLinear = (channel: number): number => {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const clean = hex.replace('#', '')
  return 0.2126 * srgbToLinear(parseInt(clean.slice(0, 2), 16))
    + 0.7152 * srgbToLinear(parseInt(clean.slice(2, 4), 16))
    + 0.0722 * srgbToLinear(parseInt(clean.slice(4, 6), 16))
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** The LAST declaration of a token inside a block wins in CSS, but the flat
 *  hex fallback is deliberately the FIRST -- so read that one: it is both the
 *  no-color-mix rendering and the measurable value. */
const token = (block: string, name: string): string => {
  const found = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(found, `nav-chrome.css declares a flat hex for --${name}`)
  return (found as RegExpMatchArray)[1]
}

runTest('the chrome palette is ivory / charcoal / muted gold, and legible in both themes', () => {
  const light = css.slice(css.indexOf('.bos-nav-chrome {'), css.indexOf(':root.dark .bos-nav-chrome'))
  const dark = css.slice(css.indexOf(':root.dark .bos-nav-chrome'), css.indexOf('body.lang-km .bos-nav-chrome'))
  for (const [name, block] of [['light', light], ['dark', dark]] as Array<[string, string]>) {
    const surface = name === 'light' ? token(block, 'nav-surface') : '#141414'
    const ink = name === 'light' ? token(block, 'nav-ink') : '#fafafa'
    const ink2 = name === 'light' ? token(block, 'nav-ink-2') : '#d4d4d4'
    const soft = token(block, 'nav-accent-soft')
    const strong = token(block, 'nav-accent-strong')
    assert.ok(contrast(ink, surface) >= 12, `${name}: body ink on the bar (${contrast(ink, surface).toFixed(2)}:1)`)
    // The reported failure was "grey": secondary ink has to stay well clear
    // of AA, not scrape it.
    assert.ok(contrast(ink2, surface) >= 6, `${name}: resting section ink (${contrast(ink2, surface).toFixed(2)}:1)`)
    assert.ok(contrast(strong, soft) >= 4.5, `${name}: open section ink on its gold ground (${contrast(strong, soft).toFixed(2)}:1)`)
    // Open vs resting differ on independent axes. The GROUND carries the
    // measurable share of it (the inks are close in luminance by design --
    // both have to stay legible on their own ground), so it is the ground
    // that has to be a real step, not a tint you cannot see.
    assert.notEqual(strong, ink2, `${name}: open ink differs from resting ink`)
    assert.ok(contrast(soft, surface) >= 1.15, `${name}: open ground is a visible step off the resting one (${contrast(soft, surface).toFixed(3)}:1)`)
  }
  // The accent is the app's existing token, themed, not a second palette.
  assert.match(css, /--nav-accent: var\(--ui-accent, #9c7a3c\)/)
  assert.match(read('styles/main.css'), /--ui-accent: #9c7a3c/, 'that global token is the muted gold this builds on')
})

runTest('every color-mix value ships a flat hex fallback ahead of it', () => {
  const mixes = [...css.matchAll(/^\s*(--[a-z-]+):\s*color-mix\(/gm)].map((m) => m[1])
  assert.ok(mixes.length >= 8, `expected the mixed tokens, found ${mixes.length}`)
  for (const name of mixes) {
    const flat = new RegExp(`${name}:\\s*#[0-9a-fA-F]{6};\\s*\\n\\s*${name}:\\s*color-mix\\(`)
    assert.match(css, flat, `${name} is preceded by its flat equivalent`)
  }
})

runTest('the bar, the tiles and the title carry the design language, not grey utilities', () => {
  const header = sidebar.slice(sidebar.indexOf('data-bos-mobile-header'), sidebar.indexOf('{!inline ? ('))
  assert.match(header, /bos-nav-chrome bos-nav-topbar fixed left-0 right-0 z-40/,
    'the top bar is a chrome surface')
  assert.doesNotMatch(header, /border-b border-gray-200 bg-white/, 'and no longer a grey-on-white box')
  assert.match(header, /className="bos-nav-title min-w-0 flex-1 truncate text-sm font-semibold"/,
    'the title uses the display face')
  assert.match(css, /\.bos-nav-title \{[\s\S]*?font-family: var\(--nav-display-font\)/)
  assert.match(css, /body\.lang-km \.bos-nav-chrome \{[\s\S]*?--nav-display-font: var\(--ui-khmer-font-family/,
    'Khmer falls back to the Khmer stack, never a Latin serif')
  assert.match(sidebar, /bos-nav-tile relative flex min-h-16/, 'tiles are chrome surfaces')
  assert.doesNotMatch(sidebar, /expanded \? 'bg-blue-50 text-blue-600 dark:bg-blue-900\/30 dark:text-blue-400' : 'bg-gray-50 dark:bg-gray-800'/,
    'the old blue-on-grey tile states are gone')
  assert.match(sidebar, /\$\{expanded \? 'is-open' : ''\}/, 'the unfolded tile is a state, styled once in CSS')
})

runTest('compact density and touch targets survive the restyle', () => {
  assert.match(sidebar, /bos-nav-section min-h-11 min-w-0 break-words rounded-lg px-2\.5 py-2 text-left text-\[13px\]/,
    'section rows are 13px and at least 44px tall')
  assert.match(sidebar, /bos-nav-tile relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1\.5 rounded-xl px-2 py-3 text-\[13px\]/,
    'tiles are 13px and comfortably above the touch minimum')
  assert.match(css, /--nav-row-h: 32px/, 'the compact row height is declared')
  assert.match(css, /\.bos-nav-section \{[\s\S]*?min-height: max\(44px, var\(--nav-row-h\)\)/,
    'and can never drop a touch target below 44px')
  // No horizontal overflow at 375: everything in the layer wraps.
  assert.match(sidebar, /grid grid-cols-2 gap-2 px-3 pb-4 pt-3/)
  assert.match(sidebar, /col-span-2 grid min-w-0 grid-cols-2/)
  assert.doesNotMatch(sidebar.slice(sidebar.indexOf(LAYER_ANCHOR)), /overflow-x-auto|whitespace-nowrap/,
    'the layer must not scroll sideways at 375')
})

runTest('large screens keep the merged single row -- the earlier rule is not regressed', () => {
  assert.match(sidebar, /<aside className={`sticky top-0 hidden h-full w-\[220px\]/, 'the desktop rail is unchanged')
  assert.match(sidebar, /md:hidden/, 'the mobile chrome stays mobile-only')
  const header = sidebar.slice(sidebar.indexOf('data-bos-mobile-header'), sidebar.indexOf('{!inline ? ('))
  assert.ok(header.includes('md:hidden'), 'the top bar never appears at md+')
  const layer = sidebar.slice(sidebar.indexOf(LAYER_ANCHOR), sidebar.indexOf('{profileOpen ? ('))
  assert.ok(layer.includes('md:hidden'), 'nor does the layer')
  assert.doesNotMatch(app, /<header[^>]*className="[^"]*h-14/, 'App.tsx still has no standalone desktop top bar')
})

// ----------------------------------------------- HUB CHIP ROW (parity) -----
//
// The second layer of the same two-layer navigation: the chips a hub renders
// in its own body. Large screens show it INSTEAD of the compact top bar (the
// "merge into one row" rule), and compact "sections" mode shows it too -- so
// it has to carry the same language as the bar, on every hub.

/** Every page that renders the shared row, enumerated so a new hub cannot
 *  quietly opt out of the chrome. Products is handled separately below: it
 *  renders its own copy of the same row. */
const HUB_PAGES: Array<[string, string]> = [
  ['SalesHubPage', 'components/sales/SalesHubPage.tsx'],
  ['BranchesHubPage', 'components/branches/BranchesHubPage.tsx'],
  ['Contacts', 'components/contacts/Contacts.tsx'],
  ['PromotionsPage', 'components/promotions/PromotionsPage.tsx'],
  ['ReviewLogsPage', 'components/review/ReviewLogsPage.tsx'],
  ['SettingsHubPage', 'components/utils-settings/SettingsHubPage.tsx'],
]

const hubNav = read('components/shared/HubSectionNav.tsx')
const products = read('components/products/Products.tsx')

runTest('every hub reaches the chip row through the one shared component', () => {
  for (const [label, rel] of HUB_PAGES) {
    assert.match(read(rel), /<HubSectionNav/, `${label} renders the shared row`)
  }
  // Two implementations of one row is the standing exception, and it is
  // styled by the same rules rather than forked: both carry the same classes.
  assert.match(products, /bos-nav-chrome hub-section-pills flex max-w-full flex-wrap/,
    'the Products copy is the same row, and a chrome surface')
  assert.match(hubNav, /bos-nav-chrome hub-section-pills flex max-w-full flex-wrap/,
    'so is the shared one')
})

runTest('the chip row wears the chrome, not grey-on-white with a per-hub hue', () => {
  for (const [label, source] of [['HubSectionNav', hubNav], ['Products', products]] as Array<[string, string]>) {
    // Negative controls -- exactly what each row shipped.
    assert.doesNotMatch(source, /hub-section-pills[^"'`]*bg-gray-100/, `${label}: the grey well is gone`)
    assert.doesNotMatch(source, /hub-section-pill[^"'`]*text-gray-500/, `${label}: the grey resting ink is gone`)
    assert.doesNotMatch(source, /hub-section-pill[^"'`]*bg-white/, `${label}: the white active chip is gone`)
    // The state is carried by aria-pressed alone, which the stylesheet reads,
    // so the accessible state and the visible state cannot come apart.
    assert.match(source, /aria-pressed=\{isActive\}/, `${label}: state is announced`)
  }
  assert.doesNotMatch(hubNav, /section\.tone/, 'the per-hub active ink is gone from the row')
  assert.doesNotMatch(hubNav, /tone\?: string/, 'and from HubSectionDef')
  for (const [label, rel] of HUB_PAGES) {
    assert.doesNotMatch(read(rel), /icon: [^,\n]+, tone:/, `${label} no longer hands the row a tone`)
  }
  assert.match(css, /\.hub-section-pill\[aria-pressed='true'\] \{[\s\S]*?box-shadow: inset 0 -2px 0 0 var\(--nav-accent\)/,
    'the open chip carries the gold underline')
  assert.match(css, /\.hub-section-rule \{[\s\S]*?border-bottom: 2px solid var\(--nav-line\)/,
    'and the rule under the row is the chrome line, not gray-200')
  assert.doesNotMatch(hubNav, /border-b-2 border-gray-200/, 'that grey rule is gone from the source')
})

runTest('the chip row is legible in both themes, resting and open', () => {
  const light = css.slice(css.indexOf('.bos-nav-chrome {'), css.indexOf(':root.dark .bos-nav-chrome'))
  const dark = css.slice(css.indexOf(':root.dark .bos-nav-chrome'), css.indexOf('body.lang-km .bos-nav-chrome'))
  for (const [name, block] of [['light', light], ['dark', dark]] as Array<[string, string]>) {
    // Dark's ink-2 is a `var(--dm-*)` ref; its documented fallback is what a
    // theme-less render shows, so measure that.
    const well = token(block, 'nav-panel')
    const chip = token(block, 'nav-chip-open')
    const resting = name === 'light' ? token(block, 'nav-ink-2') : '#d4d4d4'
    const open = token(block, 'nav-accent-strong')
    assert.ok(contrast(resting, well) >= 5.5, `${name}: resting chip ink on the well (${contrast(resting, well).toFixed(2)}:1)`)
    assert.ok(contrast(open, chip) >= 4.5, `${name}: open chip ink on its ground (${contrast(open, chip).toFixed(2)}:1)`)
    // Open vs resting is a real step, not a tint: a different ink AND a
    // ground that lifts the chip off the well it sits in.
    assert.notEqual(open, resting, `${name}: the open chip's ink differs`)
    // The lift has to be REAL in both themes. --nav-surface used for both gave
    // dark a 1.07:1 step -- a state you cannot see -- which is why the open
    // chip's ground is its own token rather than the bar's.
    assert.ok(contrast(chip, well) >= 1.15, `${name}: the open chip's ground lifts off the well (${contrast(chip, well).toFixed(3)}:1)`)
    assert.match(css, /\.hub-section-pill\[aria-pressed='true'\] \{[\s\S]*?background-color: var\(--nav-chip-open\)/,
      'the open chip paints that token')
  }
})

runTest('the chip row stays compact and touch-safe on every screen it appears on', () => {
  for (const [label, source] of [['HubSectionNav', hubNav], ['Products', products]] as Array<[string, string]>) {
    assert.match(source, /hub-section-pill inline-flex min-h-11/, `${label}: 44px touch target when it wraps`)
    assert.match(source, /text-\[13px\] font-semibold/, `${label}: 13px compact type`)
    assert.match(source, /md:h-8 md:min-h-0/, `${label}: 32px compact row at md+`)
    // No horizontal overflow at 375: the row wraps, it never scrolls.
    assert.match(source, /hub-section-pills flex max-w-full flex-wrap/, `${label}: wraps inside the viewport`)
    assert.doesNotMatch(source, /hub-section-pills[^"'`]*overflow-x-auto/, `${label}: never scrolls sideways`)
  }
})

if (failed > 0) process.exitCode = 1

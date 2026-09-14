// iOS PWA layout/shell guards -- owner rule, 2026-09-14: "for iOS PWA, I just
// want to make it more foolproof as iOS seems to be very bad for PWA".
//
// Locks the five fixes in the fix/ios-layout lane (D5, D3, D4, D7+D8, D9).
// Two of them are executed, not pattern-matched: the --kb-inset hook is run
// against a fake visualViewport, and every assertion below says in a comment
// which WRONG code it catches, because a guard that passes for both the fixed
// and the broken version measures nothing.
//
// Siblings that already pin part of this ground, deliberately not duplicated:
//   tests/mobileViewportGuard.test.ts   the viewport meta + portal touch-action
//   tests/sheetSafeArea.test.ts         bottom sheets clearing the home indicator
//   tests/startupResilience.test.ts     theme-bootstrap's light default + keys
//
// Run: node tests/iosLayoutGuards.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.join(import.meta.dirname, '..')
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const indexHtml = read('index.html')
const mainCss = read('src/styles/main.css')
const portalCss = read('src/styles/public-portal.css')
const hookSource = read('src/utils/useVisualViewportInset.ts')
const modalSource = read('src/components/shared/Modal.tsx')
const themeBootstrapSource = read('src/public-runtime/theme-bootstrap.ts')

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

// ---------------------------------------------------------------------------
// D3 -- the 16px focus-zoom floor
// ---------------------------------------------------------------------------

/** The one `@media (max-width: 767px)` block that carries the font floor. */
function focusZoomFloorBlock(): string {
  const match = /@media \(max-width: 767px\) \{\s*(input[\s\S]*?font-size: max\(16px[^}]*\}\s*)\}/.exec(mainCss)
  assert.ok(match, 'styles/main.css must carry a <768px block flooring field font-size at 16px')
  return match[1]
}

runTest('D3 -- the 16px floor exists, is !important, and covers input/select/textarea', () => {
  const block = focusZoomFloorBlock()
  // Catches: dropping !important. `.text-xs`/`.text-sm` in this same file ARE
  // !important, so a non-important floor loses outright and every
  // `<input className="input text-sm">` is back to 14px, which is what iOS
  // zooms on. This is the exact way the .input rule's own max(16px, ...)
  // silently lost before this lane.
  assert.match(block, /font-size: max\(16px, 1em\) !important;/)
  // Catches: forgetting one of the three element types (the audit counted 74
  // `<input|select|textarea ... text-xs|text-sm>` single-line hits).
  assert.match(block, /\binput:is\(/, 'input must be covered')
  assert.match(block, /\bselect:not\(/, 'select must be covered')
  assert.match(block, /\btextarea:not\(/, 'textarea must be covered')
  assert.match(block, /\[contenteditable='true'\]/, 'contenteditable must be covered')
  // Catches: the trap this rule exists to survive. A bare type selector
  // (`input, select, textarea`, specificity 0-0-1) LOSES to `.text-sm`
  // (0-1-0) even when both are !important -- the same fight
  // `input.date-entry-input` documents losing once. Every selector in the
  // block must therefore be qualified beyond a bare element name.
  for (const selector of block.slice(0, block.indexOf('{')).split(',')) {
    const trimmed = selector.trim()
    if (!trimmed) continue
    assert.match(
      trimmed,
      /[:.[]/,
      `"${trimmed}" is a bare type selector (0-0-1) and would lose to the !important .text-sm/.text-xs rules`,
    )
  }
})

runTest('D3 -- the floor is declared AFTER the text-size utilities it must beat', () => {
  // Catches: someone moving the block up next to the other @media rules.
  // `input:is(...)` (0-2-1) beats `.text-sm` (0-1-0) on specificity, but
  // `input.date-entry-input` is 0-1-1 and several future rules could tie;
  // source order is the second half of the guarantee and is free to keep.
  const floorAt = mainCss.indexOf('font-size: max(16px, 1em)')
  const textSmAt = mainCss.indexOf('.text-sm { font-size: calc(0.875rem')
  assert.ok(floorAt > 0 && textSmAt > 0)
  assert.ok(floorAt > textSmAt, 'the 16px floor must come after .text-sm in main.css')
})

runTest('D3 -- the date-entry field keeps its own rule instead of tying with the floor', () => {
  // Catches: dropping the :not(.date-entry-input) exclusion. Without it the
  // floor (0-2-1) outranks input.date-entry-input (0-1-1) and silently
  // discards the 13px desktop pin that rule exists for.
  assert.match(mainCss, /input:is\(\[type='text'/)
  assert.match(mainCss, /:not\(\[type\]\)\):not\(\.date-entry-input\)/)
  assert.match(mainCss, /input\.date-entry-input \{\s*font-size: max\(16px, calc\(13px \* var\(--ui-text-scale, 1\)\)\) !important;/)
})

runTest('D3 -- the storefront translate select is floored too', () => {
  // Catches: leaving the one field main.css cannot reach. The Google
  // Translate <select> is pinned at 0.875rem through an ID selector (1-2-1),
  // which outranks the floor, so tapping it zoomed the storefront.
  assert.match(
    portalCss,
    /@media \(max-width: 767px\) \{[\s\S]*?\.goog-te-combo[\s\S]*?font-size: 16px !important;/,
  )
})

runTest('D3 -- index.html still caps browser zoom as belt and braces', () => {
  // Catches: removing maximum-scale while believing the CSS floor replaced
  // it. It did not -- it replaced it as the PRIMARY mechanism only.
  assert.match(indexHtml, /name="viewport"[^>]*maximum-scale=1[^>]*user-scalable=no/)
})

// ---------------------------------------------------------------------------
// D5 -- --kb-inset, produced by the hook and consumed by the modal rules
// ---------------------------------------------------------------------------

runTest('D5 -- Modal installs the shared inset hook', () => {
  // Catches: the hook existing as orphaned code nothing calls (Golden Rule:
  // no zombie code). Modal.tsx is the component every admin dialog renders
  // through, so it is the one install point.
  assert.match(modalSource, /import \{ useVisualViewportInset \} from '\.\.\/\.\.\/utils\/useVisualViewportInset\.ts'/)
  assert.match(modalSource, /\r?\n  useVisualViewportInset\(\)\r?\n/)
})

runTest('D5 -- the modal height/padding rules consume var(--kb-inset)', () => {
  // Catches: publishing the property but never subtracting it -- the failure
  // mode where the measurement is right and the footer is still under the
  // keyboard. Both the dvh max-height and the wrapper padding must use it:
  // max-height alone shrinks a centred panel without moving it up.
  assert.match(
    mainCss,
    /\.modal-panel-safe \{[\s\S]*?max-height: calc\(100dvh[^;]*- var\(--kb-inset, 0px\)\);/,
  )
  assert.match(
    mainCss,
    /\.modal-viewport-safe \{[\s\S]*?padding-bottom: calc\([^;]*\+ var\(--kb-inset, 0px\)\);/,
  )
  // Catches: adding a new .max-h-modal-* size that forgets the subtraction.
  const caps = mainCss.match(/\.max-h-modal-\d+ \{[^}]*\}/g) || []
  assert.ok(caps.length >= 5, `expected the .max-h-modal-* family, found ${caps.length}`)
  for (const cap of caps) {
    assert.match(cap, /var\(--kb-inset, 0px\)/, `${cap} must subtract the keyboard inset`)
    // The 0px fallback is what makes every one of these a no-op on desktop.
    assert.match(cap, /var\(--kb-inset, 0px\)/)
  }
})

/**
 * Executes the real hook module against a fake React + fake visualViewport.
 * Source-shape checks cannot tell a per-instance subscription from a shared
 * one, or a no-op-at-zero from a write-every-event, so this runs it.
 */
function runHookHarness() {
  const compiled = ts.transpileModule(hookSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const listeners: Record<string, number> = {}
  const writes: string[] = []
  const properties = new Map<string, string>()
  const style = {
    setProperty(name: string, value: string) {
      properties.set(name, value)
      writes.push(`set ${name}=${value}`)
    },
    removeProperty(name: string) {
      properties.delete(name)
      writes.push(`remove ${name}`)
    },
  }
  const viewport = {
    height: 800,
    offsetTop: 0,
    handlers: {} as Record<string, Array<() => void>>,
    addEventListener(type: string, fn: () => void) {
      listeners[type] = (listeners[type] || 0) + 1
      ;(viewport.handlers[type] ||= []).push(fn)
    },
    removeEventListener(type: string, fn: () => void) {
      listeners[type] -= 1
      viewport.handlers[type] = (viewport.handlers[type] || []).filter((h) => h !== fn)
    },
    fire(type: string) {
      for (const fn of viewport.handlers[type] || []) fn()
    },
  }
  const fakeWindow = {
    innerHeight: 800,
    visualViewport: viewport,
    addEventListener(type: string, _fn: () => void) { listeners[type] = (listeners[type] || 0) + 1 },
    removeEventListener(type: string, _fn: () => void) { listeners[type] -= 1 },
  }
  const fakeDocument = { documentElement: { style } }

  const cleanups: Array<() => void> = []
  const react = { useEffect: (fn: () => (() => void) | void) => { const undo = fn(); if (undo) cleanups.push(undo) } }

  const module: { exports: Record<string, unknown> } = { exports: {} }
  const globals = { window: fakeWindow, document: fakeDocument }
  new Function('require', 'module', 'exports', 'window', 'document', compiled)(
    (name: string) => (name === 'react' ? react : {}),
    module,
    module.exports,
    globals.window,
    globals.document,
  )
  const useVisualViewportInset = module.exports.useVisualViewportInset as () => void
  return { useVisualViewportInset, listeners, writes, properties, viewport, fakeWindow, cleanups }
}

runTest('D5 -- the inset is measured as innerHeight - viewport.height - offsetTop', () => {
  const h = runHookHarness()
  h.useVisualViewportInset()
  // iOS with the keyboard up: the layout viewport is unchanged at 800 and the
  // visual viewport has been shrunk AND pushed down to reveal the field.
  h.viewport.height = 480
  h.viewport.offsetTop = 30
  h.viewport.fire('resize')
  // Catches: the two arithmetic mistakes that look plausible --
  // innerHeight - height (ignores offsetTop, reports 320 and over-shrinks the
  // dialog by the scroll amount), and height - innerHeight (negative).
  assert.equal(h.properties.get('--kb-inset'), '290px')
})

runTest('D5 -- a closed keyboard writes nothing at all (desktop is a no-op)', () => {
  const h = runHookHarness()
  h.useVisualViewportInset()
  // A desktop browser with a horizontal scrollbar, and iOS mid-toolbar
  // animation, both leave a few px of difference every scroll tick.
  h.viewport.height = 785
  h.viewport.fire('scroll')
  h.viewport.fire('scroll')
  h.viewport.fire('resize')
  // Catches: writing `0px` (or `15px`) on every event. Each write invalidates
  // style for the whole document; this must cost a compare, not a repaint.
  assert.deepEqual(h.writes, [], `expected no style writes, got ${JSON.stringify(h.writes)}`)
  assert.equal(h.properties.has('--kb-inset'), false)
})

runTest('D5 -- an unchanged keyboard height is written once, not once per event', () => {
  const h = runHookHarness()
  h.useVisualViewportInset()
  h.viewport.height = 500
  h.viewport.fire('resize')
  h.viewport.fire('scroll')
  h.viewport.fire('scroll')
  // Catches: dropping the `inset === published` early return.
  assert.deepEqual(h.writes, ['set --kb-inset=300px'])
})

runTest('D5 -- N modals share ONE listener pair and release it at the last unmount', () => {
  const h = runHookHarness()
  h.useVisualViewportInset()
  h.useVisualViewportInset()
  h.useVisualViewportInset()
  // Catches: a per-instance subscription. Three stacked dialogs would then
  // run three measurements per scroll tick on the device least able to
  // afford it, and the refcount could never reach zero cleanly.
  assert.equal(h.listeners.resize, 1, 'exactly one visualViewport resize listener')
  assert.equal(h.listeners.scroll, 1, 'exactly one visualViewport scroll listener')
  assert.equal(h.listeners.orientationchange, 1)

  h.viewport.height = 500
  h.viewport.fire('resize')
  assert.equal(h.properties.get('--kb-inset'), '300px')

  h.cleanups[0]()
  h.cleanups[1]()
  // Catches: releasing on the FIRST unmount. Two modals are still open here,
  // so the inset must still be live.
  assert.equal(h.listeners.resize, 1, 'the listener survives while any consumer is mounted')
  assert.equal(h.properties.get('--kb-inset'), '300px')

  h.cleanups[2]()
  // Catches: leaking the listener, and leaving a stale --kb-inset behind that
  // would shrink every later dialog by 300px with no keyboard on screen.
  assert.equal(h.listeners.resize, 0, 'the last unmount removes the listener')
  assert.equal(h.listeners.scroll, 0)
  assert.equal(h.listeners.orientationchange, 0)
  assert.equal(h.properties.has('--kb-inset'), false, 'the property is removed with the last consumer')
})

runTest('D5 -- a host without visualViewport is inert rather than broken', () => {
  const h = runHookHarness()
  ;(h.fakeWindow as { visualViewport?: unknown }).visualViewport = undefined
  h.useVisualViewportInset()
  // Catches: dereferencing window.visualViewport unguarded, which throws on
  // engines that lack it and takes the whole <Modal> subtree down with it.
  assert.deepEqual(h.writes, [])
  assert.equal(h.listeners.resize, undefined)
})

// ---------------------------------------------------------------------------
// D4 -- one --app-vh helper, no raw vh left in the lane's surfaces
// ---------------------------------------------------------------------------

runTest('D4 -- the --app-vh helper is defined with an @supports guard', () => {
  assert.match(mainCss, /:root \{ --app-vh: 1vh; \}/)
  // Catches: copying the `a: 100vh; a: 100dvh` double-declaration pattern the
  // neighbouring rules use. Custom property values are unparsed token streams,
  // so an engine with no dvh support would ACCEPT and keep `--app-vh: 1dvh`
  // and every consumer would compute to nothing. @supports is the only guard
  // that actually tests the unit.
  assert.match(mainCss, /@supports \(height: 1dvh\) \{\s*:root \{ --app-vh: 1dvh; \}\s*\}/)
  assert.doesNotMatch(
    mainCss,
    /:root \{ --app-vh: 1vh; \}\s*:root \{ --app-vh: 1dvh; \}/,
    'an unguarded second declaration would win on engines that cannot use it',
  )
})

/** Source with comments removed -- a `vh` inside a comment is documentation. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

/** Raw `NNvh` values -- the ones dvh/svh/lvh and --app-vh replaced. */
function rawViewportHeights(source: string): string[] {
  return (codeOnly(source).match(/(?<![a-z-])\d+(?:\.\d+)?vh\b/g) || [])
}

function everyTsxFile(): string[] {
  const base = path.join(ROOT, 'src')
  const found: string[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), `${prefix}${entry.name}/`); continue }
      if (entry.name.endsWith('.tsx')) found.push(`${prefix}${entry.name}`)
    }
  }
  walk(base, '')
  return found.sort()
}

// The raw-vh sites left OUTSIDE this lane's write set, frozen by name. The set
// may shrink, never grow: a new file appearing here is a new `70vh` that will
// measure the "chrome hidden" viewport on an iPhone.
const RAW_VH_ALLOWLIST = new Set([
  'components/shared/AvailabilityFilterOptions.tsx',
  'components/shared/BackgroundImportTracker.tsx',
  'components/shared/ButtonGuidePopover.tsx',
  'components/shared/FilterMenu.tsx',
  'components/shared/ImageGalleryLightbox.tsx',
  'components/shared/NotesWidget.tsx',
  'components/shared/NotificationCenter.tsx',
  'components/shared/PageSizeSelect.tsx',
  'components/shared/RenameCascadeModal.tsx',
  'components/shared/SuggestionTextInput.tsx',
  'components/shared/kit/Fold.tsx',
  'components/shifts/ShiftHistoryModal.tsx',
  'components/utils-settings/AuditLog.tsx',
])

runTest('D4 -- no raw vh outside the frozen allowlist', () => {
  const offenders = everyTsxFile()
    .filter((file) => !RAW_VH_ALLOWLIST.has(file))
    .map((file) => ({ file, hits: rawViewportHeights(read(path.join('src', file))) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.file} (${entry.hits.join(', ')})`)
  assert.deepEqual(offenders, [], 'these must go through calc(N*var(--app-vh)) or a .max-h-modal-* class')
})

runTest('D4 -- the allowlist names real remaining work, and the detector really detects', () => {
  // A sweep that answers "clean" for everything is indistinguishable from a
  // broken sweep. Positive control: the exact shape this lane removed.
  assert.deepEqual(
    rawViewportHeights(`<div className="max-h-[70vh] overflow-auto">`),
    ['70vh'],
    'the detector must catch a re-added raw vh',
  )
  assert.deepEqual(
    rawViewportHeights(`className="max-h-[min(28rem,70vh)]" style={{ minHeight: '100vh' }}`),
    ['70vh', '100vh'],
    'compound values and inline styles count too',
  )
  // Negative controls: the fixed spelling, the sibling units, and a comment.
  assert.deepEqual(rawViewportHeights(`max-h-[calc(70*var(--app-vh))]`), [])
  assert.deepEqual(rawViewportHeights(`h-[100dvh] w-[50svh] max-h-[80lvh]`), [])
  assert.deepEqual(rawViewportHeights(`{/* it used to be max-h-[70vh] */}`), [])
  // ...and every allowlisted file must still actually contain one, so a file
  // that gets fixed later is removed from the list rather than left rotting.
  for (const file of RAW_VH_ALLOWLIST) {
    assert.ok(
      rawViewportHeights(read(path.join('src', file))).length > 0,
      `${file} no longer has a raw vh -- take it off RAW_VH_ALLOWLIST`,
    )
  }
})

runTest('D4 -- the surfaces this lane converted route through the helper', () => {
  // Catches a revert of the specific sites, which the sweep above would also
  // catch but without naming them. Three spot-checks across the three shapes:
  // a plain cap, a compound min(), and a non-className value.
  assert.match(read('src/components/shared/AppSelect.tsx'), /max-h-\[min\(18rem,calc\(100\*var\(--app-vh\)_-_1rem\)\)\]/)
  assert.match(read('src/components/shared/ActionHistoryBar.tsx'), /max-h-\[min\(28rem,calc\(70\*var\(--app-vh\)\)\)\]/)
  assert.match(read('src/components/sales/reports/PeriodReport.tsx'), /maxHeight="calc\(70 \* var\(--app-vh\)\)"/)
  assert.match(read('src/AppContext.tsx'), /minHeight:'calc\(100 \* var\(--app-vh\)\)'/)
})

// ---------------------------------------------------------------------------
// D7 / D8 -- the pre-paint shell decision
// ---------------------------------------------------------------------------

runTest('D7 -- the head script decides the theme BEFORE the shell stylesheet', () => {
  const decisionAt = indexHtml.indexOf('setInitialBusinessOsTheme')
  const shellStyleAt = indexHtml.indexOf('<style data-business-os-initial-shell>')
  // The TAG, not the many prose mentions of the filename in the comments.
  const bootstrapTagAt = indexHtml.indexOf('src="/theme-bootstrap.js"')
  assert.ok(decisionAt > 0, 'index.html must decide the theme in the synchronous head script')
  assert.ok(shellStyleAt > 0)
  // Catches: putting the decision after the shell CSS, or relying on
  // theme-bootstrap.js alone -- which loads at the bottom of <body> (and is
  // inlined after </head> in the build), i.e. after the shell has painted.
  assert.ok(decisionAt < shellStyleAt, 'the decision must run before the shell styles are parsed')
  assert.ok(decisionAt < bootstrapTagAt, 'the decision must run before theme-bootstrap.js loads')
})

runTest('D7 -- the shell is light-first and never reads the OS preference', () => {
  const shellBlock = /<style data-business-os-initial-shell>[\s\S]*?<\/style>/.exec(indexHtml)?.[0] || ''
  assert.ok(shellBlock, 'the initial shell style block must exist')
  // Comments removed: this block's own comments name the media query they
  // exist to warn against, and a doesNotMatch that trips on documentation
  // measures the prose, not the CSS.
  const shellStyle = shellBlock.replace(/\/\*[\s\S]*?\*\//g, '')
  // Catches the actual defect: `@media (prefers-color-scheme: dark)` painting
  // the shell dark on a dark-mode iPhone that theme-bootstrap then forces back
  // to light -- a dark flash on every cold start, against the light-first rule.
  assert.doesNotMatch(shellStyle, /prefers-color-scheme/, 'the shell must not auto-honour OS dark')
  assert.doesNotMatch(shellStyle, /color-scheme: light dark/, '`light dark` re-opens the same door')
  assert.match(shellStyle, /color-scheme: light;/)
  // ...and it must still be able to render dark for a device that chose it.
  assert.match(shellStyle, /\.dark \{\s*color-scheme: dark;/)
  assert.match(shellStyle, /\.dark,\s*\.dark body \{\s*background: #101827;/)
})

runTest('D7 -- old stored themes keep working: the head script and theme-bootstrap agree', () => {
  const headScript = /setInitialBusinessOsTheme[\s\S]*?\}\(\)\)/.exec(indexHtml)?.[0] || ''
  assert.ok(headScript, 'the head theme script must exist')
  // Catches the migration hazard: a head script that reads only the newest key
  // would paint light for a device whose stored 'dark' lives under an older
  // key, and theme-bootstrap would then flip it dark -- the same flash, just
  // for a different population. Both files must read the same three keys.
  const keys = ['businessos_device_settings', 'businessos_theme', 'businessos_settings']
  for (const key of keys) {
    assert.ok(headScript.includes(`'${key}'`), `the head script must read ${key}`)
    assert.ok(themeBootstrapSource.includes(`'${key}'`), `theme-bootstrap.ts must read ${key}`)
  }
  // ...in the same precedence order.
  const orderIn = (source: string) => keys.map((key) => source.indexOf(`'${key}'`))
  const headOrder = orderIn(headScript)
  const bootstrapOrder = orderIn(themeBootstrapSource)
  assert.ok(headOrder[0] < headOrder[1] && headOrder[1] < headOrder[2], 'head script precedence')
  assert.ok(bootstrapOrder[0] < bootstrapOrder[1] && bootstrapOrder[1] < bootstrapOrder[2], 'theme-bootstrap precedence')
  // Catches: defaulting to dark, or treating any truthy value as dark.
  assert.match(headScript, /=== 'dark'/, 'only the literal "dark" may mean dark')
  assert.doesNotMatch(headScript, /matchMedia/, 'the head script must never auto-honour the OS scheme')
})

runTest('D8 -- the iOS status bar style suits the light chrome both hosts paint', () => {
  // Catches: going back to black-translucent, which paints the status text
  // WHITE over page content. The storefront ground is #ffffff
  // (portalContrast.ts PORTAL_LIGHT_SURFACE) and the admin mobile top bar is
  // --nav-surface #fffdf8 (nav-chrome.css), so white-on-white was the result.
  assert.match(indexHtml, /name="apple-mobile-web-app-status-bar-style" content="default"/)
  assert.doesNotMatch(
    /<meta name="apple-mobile-web-app-status-bar-style"[^>]*>/.exec(indexHtml)?.[0] || '',
    /black-translucent/,
  )
  // The evidence the choice rests on must stay true, or the choice is stale.
  assert.match(read('src/components/catalog/portalContrast.ts'), /PORTAL_LIGHT_SURFACE = '#ffffff'/)
  assert.match(read('src/components/navigation/nav-chrome.css'), /--nav-surface: #fffdf8;/)
})

// ---------------------------------------------------------------------------
// D9 -- tap highlight
// ---------------------------------------------------------------------------

runTest('D9 -- the WebKit tap highlight is suppressed once, on an inherited root', () => {
  // Catches: not having it at all (the state before this lane -- zero
  // occurrences in the repo), and catches putting it on `body` or on
  // individual components, which leaves portalled overlays rendered into
  // document.body's sibling tree flashing grey on every tap.
  assert.match(mainCss, /html \{[\s\S]*?-webkit-tap-highlight-color: transparent;[\s\S]*?\}/)
})

if (failed > 0) {
  process.exitCode = 1
}
console.log(failed === 0 ? 'ios layout guards: PASS' : `ios layout guards: ${failed} FAILED`)

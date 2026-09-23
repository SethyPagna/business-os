// The iOS-PWA lane's regression lock: printing, the parked app update, the
// install-failure cleanup and the offline Khmer font.
//
// Owner rule (2026-09-14): "for iOS PWA, I just want to make it more foolproof
// as iOS seems to be very bad for PWA". Every check below stands for one way
// an installed iPhone app failed while a desktop browser was fine:
//
//   H1  window.open was called AFTER an await, so the tap was over and iOS
//       refused the window -- "printing is broken on the iPhone/iPad". The
//       same-document iframe path is what replaces it when there is no usable
//       second window at all.
//   A5  a worker parked in 'waiting' since the last time the app was opened
//       never re-announced itself, so the update was never offered.
//   A7  a failed install left its half-filled caches behind on a device whose
//       storage is the reason the install failed.
//   A11 one wasted caches.match on every navigation.
//   A6  the self-hosted Khmer font was not precached, so a cold offline
//       install fell back to the system Khmer face.
//
// Run: node tests/iosPrintAndServiceWorker.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(here, '..', rel), 'utf8')

let checks = 0
const check = (label: string, fn: () => void): void => { fn(); checks += 1; console.log(`  ok  ${label}`) }
const checkAsync = async (label: string, fn: () => Promise<void>): Promise<void> => {
  await fn()
  checks += 1
  console.log(`  ok  ${label}`)
}

const printReceipt = read('src/utils/printReceipt.ts')
const printSurface = read('src/utils/printSurface.ts')
const exportOptions = read('src/utils/exportOptions.ts')
const receipt = read('src/components/receipt/Receipt.tsx')
const indexEntry = read('src/index.tsx')
const swSource = read('src/public-runtime/service-worker.ts')
const builtSw = read('public/sw.js')
const viteConfig = read('vite.config.ts')
const testChain = read('tests/runTestChain.ts')

function functionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `could not find ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.ok(end > start, `could not find ${endMarker} after ${startMarker}`)
  return source.slice(start, end)
}

// Comments are not code. printReceipt.ts EXPLAINS the rule in prose directly
// above the line that obeys it ("opened BEFORE the first await"), so a naive
// scan reads that word as an await and reports the fixed code as broken.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// THE H1 INVARIANT, as an executable rule rather than a comment: inside a
// function that opens a window, the open must happen before the first await.
// iOS ends the user gesture at that await and refuses every window after it.
function opensWindowAfterAnAwait(input: string): boolean {
  const body = stripComments(input)
  const open = Math.min(
    ...[/\bwindow\.open\(/, /\bopenPrintPreviewWindow\(/]
      .map((pattern) => {
        const match = pattern.exec(body)
        return match ? match.index : Number.POSITIVE_INFINITY
      }),
  )
  if (!Number.isFinite(open)) return false
  const firstAwait = /\bawait\b/.exec(body)
  return firstAwait !== null && firstAwait.index < open
}

// Positive control: the rule must actually catch the shape it exists to catch,
// otherwise a green sweep says nothing. This is the code as it shipped before
// this lane.
check('the gesture rule catches the ORIGINAL defect (positive control)', () => {
  const before = `
    const layout = await createPrintableReceiptMarkup(content, options)
    const html = buildPrintablePreviewDocument(layout, options)
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) throw new Error('Popup blocked. Allow popups for this page and try again.')
  `
  assert.equal(opensWindowAfterAnAwait(before), true, 'the rule must flag an open that follows an await')
  const after = `
    const previewWindow = options.previewWindow !== undefined ? options.previewWindow : openPrintPreviewWindow()
    const layout = await createPrintableReceiptMarkup(content, options)
  `
  assert.equal(opensWindowAfterAnAwait(after), false, 'the rule must accept an open that precedes every await')
})

// --- H1: the window is opened inside the gesture ---------------------------

check('openPrintableReceiptPreview opens its window before any await', () => {
  const body = functionBody(printReceipt, 'export async function openPrintableReceiptPreview', '\nfunction downloadBlob')
  assert.equal(opensWindowAfterAnAwait(body), false, 'the preview window must be opened before the markup is built')
  assert.doesNotMatch(body, /Popup blocked/, 'a standalone iOS app has no popup setting to point people at')
})

check('the Receipt Print action opens the window inside the tap', () => {
  // Receipt.tsx awaits a dynamic import before it can call the print module at
  // all, so the window has to be opened by the call site and handed down.
  const body = functionBody(receipt, 'const exportReceiptPdf = async', 'const exportBothSeparately')
  assert.equal(opensWindowAfterAnAwait(body), false, 'the window must be opened before loadReceiptPrintModule()')
  assert.match(body, /openPrintPreviewWindow\(\)/, 'the call site opens the window itself')
  assert.match(receipt, /previewWindow,/, 'and passes it into printReceipt')
  assert.match(printReceipt, /previewWindow\?: Window \| null/, 'the print options carry it')
})

check('"All" prints the card and the full receipt one after the other', () => {
  // Only one print frame exists at a time. Started together, the second print
  // replaced the first one's frame while it was still being prepared: the
  // installed app printed one of the two and left Print disabled (Sep 23 2026).
  const body = stripComments(functionBody(receipt, 'const exportBothSeparately = async', 'const shellStyleFor'))
  assert.doesNotMatch(body, /Promise\.all/, 'the two renditions must not be exported concurrently')
  assert.match(body, /for \(const variant of \['compact', 'full'\] as const\) \{\s*try \{\s*if \(mode === 'print' && variant === 'full'\) await printFrameReleased\(\)\s*await exportReceiptVariant\(printTools, mode, variant\)/,
    'each rendition finishes before the next one starts, and a print waits until the card\'s print sheet has closed')
  assert.match(body, /failure = failure \?\? error/, 'a failed rendition still lets the other one through')
})

check('openPrintExport opens its window before anything else', () => {
  const body = functionBody(exportOptions, 'export function openPrintExport', '\n}')
  assert.equal(opensWindowAfterAnAwait(body), false)
  assert.doesNotMatch(body, /return false\s*\n\s*printWindow/, 'a blocked popup is no longer the end of the road')
})

check('the window opener is synchronous and is the only window.open left', () => {
  assert.match(printSurface, /export function openPrintPreviewWindow\(\): Window \| null/, 'not async: an await would end the gesture')
  assert.match(printSurface, /window\.open\('', '_blank'\)/)
  assert.doesNotMatch(printReceipt, /window\.open\('', '_blank'\)/, 'printReceipt must go through the shared opener')
  assert.doesNotMatch(exportOptions, /window\.open\(/, 'exportOptions must go through the shared opener')
})

// --- H1: the same-document print path ---------------------------------------

check('standalone mode never asks for a window', () => {
  assert.match(printSurface, /import \{ isStandaloneDisplayMode \} from '\.\/standaloneDisplay\.ts'/)
  const opener = functionBody(printSurface, 'export function openPrintPreviewWindow', '\nfunction waitForImage')
  assert.match(opener, /if \(isStandaloneDisplayMode\(\)\) return null/, 'an installed iOS app must not open a window at all')
})

check('a missing window selects the iframe print path', () => {
  const body = functionBody(printReceipt, 'export async function openPrintableReceiptPreview', '\nfunction downloadBlob')
  assert.match(body, /if \(!previewWindow\) \{[\s\S]*?printHtmlInHiddenFrame\(html, \{/, 'no window means print in this document')
  assert.match(body, /beforePrint: \(_win, frameDoc\) => \{ remeasureContinuousRollBeforePrint\(frameDoc, layout, options\.previewTranslate\) \}/,
    'the iframe path re-measures the roll length inside the actual print document, right before print()')
  assert.match(body, /buildPrintablePreviewDocument\(layout, options\)/, 'the iframe gets the SAME document, stylesheet included')
  const exportBody = functionBody(exportOptions, 'export function openPrintExport', '\n}')
  assert.match(exportBody, /printHtmlInHiddenFrame\(buildPrintDocument\(\{ \.\.\.input, autoPrint: false \}\)\)/,
    'the frame prints the document itself, so it must not also self-print')
})

check('the iframe path waits for assets, prints, and cleans up everywhere', () => {
  assert.match(printSurface, /fonts\?\.ready/, 'fonts must have settled before printing')
  assert.match(printSurface, /frameDocument\.images/, 'and so must the images')
  assert.match(printSurface, /execCommand\?\.\('print', false, undefined\)/, 'Safari and Chromium print a frame through execCommand')
  assert.match(printSurface, /if \(!printed\) frameWindow\.print\(\)/, 'Firefox (execCommand false) through print(), never both')
  assert.match(printSurface, /addEventListener\?\.\('afterprint', remove, \{ once: true \}\)/)
  assert.match(printSurface, /setTimeout\(remove, PRINT_FRAME_CLEANUP_MS\)/, 'iOS may never fire afterprint')
  // MEMORY: one frame at a time, and every exit path clears it.
  assert.match(printSurface, /discardActivePrintFrame\(\)/)
  assert.equal((printSurface.match(/discardActivePrintFrame\(\)/g) || []).length >= 4, true,
    'the frame must be discarded on re-entry, on a missing content document, and on a thrown error')
  assert.doesNotMatch(printSurface, /createObjectURL/, 'this path creates no object URL to leak')
})

// --- H1, executed: the real printSurface module on a stub DOM ---------------

type StubFrame = {
  style: { cssText: string }
  title: string
  removed: boolean
  written: string
  setAttribute: (name: string, value: string) => void
  remove: () => void
  contentWindow: Record<string, unknown>
  contentDocument: Record<string, unknown>
  afterPrint: (() => void) | null
}

const printed: string[] = []
const created: StubFrame[] = []
let execCommandPrints = false
let execCommandCalls = 0

function makeFrame(): StubFrame {
  const frame: StubFrame = {
    style: { cssText: '' },
    title: '',
    removed: false,
    written: '',
    afterPrint: null,
    setAttribute: () => {},
    remove: () => { frame.removed = true },
    contentWindow: {
      focus: () => {},
      print: () => { printed.push(frame.written) },
      requestAnimationFrame: (cb: () => void) => { cb() },
      addEventListener: (type: string, handler: () => void) => { if (type === 'afterprint') frame.afterPrint = handler },
    },
    contentDocument: {
      open: () => {},
      write: (html: string) => { frame.written = html },
      close: () => {},
      images: [],
      fonts: { ready: Promise.resolve() },
      execCommand: () => { execCommandCalls += 1; return execCommandPrints },
    },
  }
  created.push(frame)
  return frame
}

const appended: StubFrame[] = []
let standalone = false
let windowOpenResult: unknown = null
let windowOpenCalls = 0

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get: () => ({ get standalone() { return standalone } }),
})
;(globalThis as Record<string, unknown>).window = {
  open: () => { windowOpenCalls += 1; return windowOpenResult },
  matchMedia: () => ({ matches: standalone }),
}
;(globalThis as Record<string, unknown>).document = {
  body: { appendChild: (frame: StubFrame) => { appended.push(frame) } },
  createElement: () => makeFrame(),
}

const surface = await import('../src/utils/printSurface.ts')

check('an installed app gets null instead of a window, and never calls open', () => {
  standalone = true
  windowOpenCalls = 0
  assert.equal(surface.openPrintPreviewWindow(), null)
  assert.equal(windowOpenCalls, 0, 'window.open must not even be attempted inside a standalone PWA')
})

check('a normal browser still gets its preview window', () => {
  standalone = false
  const fakeWindow = { id: 'preview' }
  windowOpenResult = fakeWindow
  assert.equal(surface.openPrintPreviewWindow(), fakeWindow)
})

check('a blocked popup is reported as no window, not as a throw', () => {
  standalone = false
  windowOpenResult = null
  assert.equal(surface.openPrintPreviewWindow(), null)
})

await checkAsync('the iframe path writes the document, prints it, and removes the frame', async () => {
  printed.length = 0
  const html = '<!doctype html><html><body>receipt</body></html>'
  assert.equal(await surface.printHtmlInHiddenFrame(html), true)
  assert.deepEqual(printed, [html], 'the document reached the platform print dialog')
  const frame = created[created.length - 1]
  assert.equal(appended.includes(frame), true, 'the frame is in the document, so Safari considers it rendered')
  assert.notEqual(frame.style.cssText.includes('display:none'), true, 'a display:none frame does not print on Safari')
  assert.equal(frame.removed, false, 'removing it before afterprint would cancel the job')
  frame.afterPrint?.()
  assert.equal(frame.removed, true, 'afterprint removes it')
})

await checkAsync('a second print replaces the first frame instead of stacking one', async () => {
  const before = created.length
  await surface.printHtmlInHiddenFrame('<html>one</html>')
  const first = created[created.length - 1]
  await surface.printHtmlInHiddenFrame('<html>two</html>')
  assert.equal(first.removed, true, 'the first frame is discarded when a second print starts')
  assert.equal(created.length, before + 2, 'exactly one frame per print')
  created[created.length - 1].afterPrint?.()
})

// "All" prints the card, then the full receipt. The second print replaces the
// card's frame, and on iOS that cancels a print sheet still open (Sep 23 2026).
await checkAsync('a print that follows another one can wait until the first sheet has closed', async () => {
  let settled = false
  await surface.printHtmlInHiddenFrame('<html>card</html>')
  const card = created[created.length - 1]
  void surface.printFrameReleased().then(() => { settled = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, false, 'the card\'s sheet is still open: its frame is still there')
  card.afterPrint?.()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, true, 'afterprint releases the wait')
  assert.equal(card.removed, true)
  let idle = false
  void surface.printFrameReleased().then(() => { idle = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(idle, true, 'with no frame left there is nothing to wait for')
})

await checkAsync('a new print releases a waiter on the frame it replaces', async () => {
  let settled = false
  await surface.printHtmlInHiddenFrame('<html>first</html>')
  void surface.printFrameReleased().then(() => { settled = true })
  await surface.printHtmlInHiddenFrame('<html>second</html>')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, true, 'a replaced frame never leaves anyone waiting on it')
  created[created.length - 1].afterPrint?.()
})

await checkAsync('a browser whose execCommand prints (Safari, Chromium) is never also sent print()', async () => {
  printed.length = 0
  execCommandCalls = 0
  execCommandPrints = true
  try {
    assert.equal(await surface.printHtmlInHiddenFrame('<html>once</html>'), true)
    assert.equal(execCommandCalls, 1, 'execCommand is asked exactly once')
    assert.deepEqual(printed, [], 'print() is skipped, so one tap is one print job')
  } finally {
    execCommandPrints = false
    created[created.length - 1].afterPrint?.()
  }
})

check('a discarded frame leaves no cleanup timer behind', () => {
  // The 2-minute cleanup timer holds the detached print document -- fonts and
  // decoded images included -- alive until it fires. Discarding a frame early
  // must cancel it, or repeated Print taps pile up detached receipts in memory
  // on the device that has the least of it. If this regresses, this suite also
  // stops exiting on its own and hangs the gate for two minutes.
  const pending = process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout')
  assert.deepEqual(pending, [], 'every print frame created above cancelled its own timer')
})

// --- A5: a parked worker announces itself, but only if it is a new build ----

check('a waiting worker is re-announced through the page event', () => {
  assert.match(indexEntry, /registration\.waiting/, 'index.tsx must look at the parked worker')
  assert.match(indexEntry, /announceWaitingAppShell\(registration\)/, 'and run the announcement at registration time')
  assert.match(indexEntry, /dispatchEvent\(new CustomEvent\('sync:app-update-available'/,
    'through the same event web-api.ts raises and App.tsx listens for')
})

check('the same build parked again must NOT prompt for an update', () => {
  const body = functionBody(indexEntry, 'async function announceWaitingAppShell', '\nfunction registerOfflineAppShell')
  assert.match(body, /requestWorkerVersion\(waiting\)/, 'the waiting worker is asked which build it is')
  assert.match(body, /waitingHash === FRONTEND_BUILD_HASH\) return/, 'an identical build is not an update')
  assert.match(body, /!waitingHash \|\| /, 'an unanswered probe is not an update either')
  assert.match(swSource, /BUSINESS_OS_APP_VERSION_REQUEST/, 'the worker answers that probe')
  assert.match(builtSw, /BUSINESS_OS_APP_VERSION_REQUEST/, 'and so does the shipped sw.js')
})

check('noticing a parked worker still never activates or reloads anything', () => {
  const body = functionBody(indexEntry, 'async function announceWaitingAppShell', '\nfunction registerOfflineAppShell')
  assert.doesNotMatch(body, /skipWaiting|SKIP_WAITING|location\.reload/, 'restarting stays the user\'s choice')
})

// --- A7: a failed install cleans up after itself ----------------------------

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  check(`a failed install deletes only the caches it created (${label})`, () => {
    const body = functionBody(source, "addEventListener('install'", "addEventListener('activate'")
    assert.match(body, /cacheNamesBeforeInstall = new Set\(await caches\.keys\(\)\)/, 'the pre-existing caches are recorded first')
    assert.match(body, /\[APP_SHELL_CACHE, STATIC_CACHE\]\s*\n?\s*\.filter\(\(name\) => !cacheNamesBeforeInstall\.has\(name\)\)/,
      'only the caches THIS attempt created may be deleted -- the running page is still serving from the current generation')
    assert.match(body, /throw error/, 'and the install still fails')
  })
}

// --- A11 / P4-4b: navigation is cache-first with background revalidation ----
// (Was network-first-with-no-timeout: a slow-but-alive iOS connection made
// every navigation wait for the full round trip before the shell could even
// start parsing -- the reported "takes a while to load" lag. Serving the
// cached shell immediately and refreshing it via event.waitUntil is safe
// because APP_SHELL_CACHE is named after this worker's own BUILD_HASH, so it
// can never serve a stale build's shell under a new build's version.)

// The recovery navigation's answer, as an executable rule (Part 628 ticket 4).
// Matching fetch(request) alone passed a call nobody waits for: fired,
// forgotten, and the navigation answered from the dead shell anyway. The
// fetch must be held, raced against the recovery budget, the race awaited,
// and what the race produced must be what the navigation is answered with.
function answersWithTheAwaitedRace(input: string): boolean {
  const body = stripComments(input)
  const held = /const (\w+) = fetch\(request\)/.exec(body)
  if (!held) return false
  const race = new RegExp(`const (\\w+) = [^;]{0,40}?await Promise\\.race\\(\\[${held[1]}, [^;]{0,200}?RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS`).exec(body)
  return race !== null && new RegExp(`\\breturn ${race[1]}\\b`).test(body)
}

// Positive control: every way of dropping the answer must fail the rule.
check('the recovery answer rule catches a fetch nobody waits for (positive control)', () => {
  const answered = `
    const network = fetch(request).catch(() => null)
    const fresh = cached
      ? await Promise.race([network, new Promise((resolve) => { setTimeout(() => resolve(null), RECOVERY_NAVIGATION_FETCH_TIMEOUT_MS) })])
      : await network
    if (fresh) return fresh
  `
  assert.equal(answersWithTheAwaitedRace(answered), true, 'the rule must accept the awaited race answering the navigation')
  for (const [shape, from, to] of [
    ['fired and forgotten', 'const network = fetch(request)', 'fetch(request)'],
    ['raced, never awaited', 'await Promise.race', 'Promise.race'],
    ['awaited, then ignored', 'return fresh', 'return cached'],
  ]) {
    const broken = answered.replace(from, to)
    assert.notEqual(broken, answered, `${shape}: the mutation must apply`)
    assert.equal(answersWithTheAwaitedRace(broken), false, `the rule must flag: ${shape}`)
  }
})

for (const [label, source] of [['source', swSource], ['shipped sw.js', builtSw]] as const) {
  check(`appShellFallback serves the cached shell immediately and revalidates in the background (${label})`, () => {
    const body = functionBody(source, 'async function appShellFallback', 'async function cacheFirstStatic')
    assert.match(body, /(?:const|let) cached = await cache\.match\('\/index\.html'\) \|\| await cache\.match\('\/'\)/, 'the cache is read once, up front')
    // Sep 23 2026: exactly ONE awaited fetch now precedes the cache hit -- the
    // recovery navigation (__bos_reload), which exists only because the page
    // has already proven the cached shell cannot run. Answering that one from
    // cache is the incident this check must not re-authorise. The guarantee
    // this check was written for is unchanged and still asserted below: an
    // ORDINARY navigation never waits on the network when the cache can
    // answer, which is the iOS latency fix.
    const beforeCacheCheck = body.slice(0, body.indexOf('if (cached)'))
    const recoveryStart = beforeCacheCheck.indexOf('if (isRecoveryNavigation(request)) {')
    assert.ok(recoveryStart > 0, 'the recovery navigation must still be the branch that goes to the network')
    const recoveryBranch = beforeCacheCheck.slice(recoveryStart)
    // Measured, not assumed: an init object rebuilds the Request and turns
    // navigate mode into same-origin, and the origin then sees
    // sec-fetch-mode: same-origin -- the read this host answers with a bot
    // challenge rather than the page. That includes { signal }, which is why
    // the wait below is bounded by a clock and not by an AbortController.
    assert.doesNotMatch(recoveryBranch, /fetch\(request,/, 'un-downgraded: no init object on it, not even a signal')
    assert.ok(answersWithTheAwaitedRace(recoveryBranch),
      'the navigation must be answered with the awaited race of its own fetch against the recovery budget -- '
      + 'an origin that accepts the connection and never answers left the tab blank')
    assert.doesNotMatch(
      beforeCacheCheck.slice(0, recoveryStart),
      /await fetch/,
      'no OTHER network wait may precede a cache hit -- that is the round-trip lag this fix removed',
    )
    assert.match(body, /if \(cached\) \{[\s\S]*event\.waitUntil\(revalidate\)[\s\S]*return cached[;\s]*\}/, 'a cache hit returns immediately; the network refresh happens after, off the response path')
    // The miss path moved into fetchAndCacheShell when the Sep 17 redirect fix
    // gave the poisoned-entry branch somewhere to jump to; what matters here is
    // unchanged -- the network is awaited only when the cache could not answer.
    assert.match(body, /await fetch\(request, \{ ?cache: 'no-store' ?\}\)/, 'only a genuine cache miss (this worker\'s first navigation) still waits on the network')
  })
}

// --- A6: the Khmer font is precached ---------------------------------------

check('the precache manifest includes woff2', () => {
  assert.match(viteConfig, /\.filter\(\(fileName\) => \/\\\.\(\?:js\|css\|woff2\)\$\/i\.test\(fileName\)\)/,
    'self-hosted fonts must be precached, not left to opportunistic caching')
})

// --- the shipped sw.js is the compiled source, checked by the gate ----------

check('verify:public-runtime runs before any test in this suite', () => {
  // sw.js is generated from service-worker.ts; this suite reads both, and the
  // chain's own preflight is what proves they match. Do not duplicate it here.
  assert.match(testChain, /const PREFLIGHT = \[[^\]]*'verify:public-runtime'/, 'the gate must still verify the generated runtime')
})

console.log(`\nios print + service worker: ${checks} checks passed`)

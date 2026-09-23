import { isStandaloneDisplayMode } from './standaloneDisplay.ts'

// Where a printable document is DELIVERED on this platform.
//
// A desktop/Android browser can show it in a second window, which is also the
// preview the cashier reviews before pressing Print. An installed iOS PWA
// cannot: there is no address bar, no popup permission to grant, and
// `window.open` either returns null or opens the document in Safari outside
// the installed app -- where the app's `document.write`/print wiring never
// reaches it. That is the whole "printing is broken on the iPhone" report.
//
// So there are exactly two delivery surfaces, and every print path in the app
// picks between them here instead of inventing its own fallback.

// MEMORY: exactly one print frame can exist at a time. A second Print tap
// while the first sheet is still open replaces that frame instead of stacking
// another document, and every exit path below -- afterprint, the timeout, and
// a thrown error -- removes it. Nothing here creates an object URL (the
// document is written straight into the frame), so there is none to revoke.
let activePrintFrame: HTMLIFrameElement | null = null
// The frame's own cleanup, so discarding it also cancels the pending cleanup
// timer. Without this the timer below outlives the frame it was scheduled for
// and holds that detached document (fonts, decoded images) alive for two more
// minutes -- on the device with the least memory of any client we have.
let releaseActivePrintFrame: (() => void) | null = null

function discardActivePrintFrame(): void {
  const frame = activePrintFrame
  const release = releaseActivePrintFrame
  activePrintFrame = null
  releaseActivePrintFrame = null
  if (release) release()
  else if (frame) frame.remove()
}

// A slow webfont must never be the reason a receipt does not print: after this
// the frame is printed with whatever has loaded.
export const PRINT_FRAME_ASSET_TIMEOUT_MS = 4000
// iOS does not reliably fire 'afterprint', and removing the frame while the
// print sheet is still open cancels the job -- so cleanup is late on purpose.
const PRINT_FRAME_CLEANUP_MS = 120_000

/**
 * Opens the blank preview window. MUST be called in the synchronous part of
 * the user's tap/click: after any `await` iOS and Safari no longer treat the
 * call as user-initiated and return null. Returns null when this device has no
 * usable second window, which every caller must read as "use
 * printHtmlInHiddenFrame instead", never as an error.
 */
export function openPrintPreviewWindow(): Window | null {
  if (typeof window === 'undefined') return null
  // An installed iOS app would lose the document to Safari even when the call
  // succeeds, so it never asks for a window in the first place.
  if (isStandaloneDisplayMode()) return null
  try {
    return window.open('', '_blank')
  } catch {
    return null
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => resolve()
    image.addEventListener('load', done, { once: true })
    // A broken image must settle too, otherwise it holds the print forever.
    image.addEventListener('error', done, { once: true })
  })
}

function withTimeout(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    work.then(() => { clearTimeout(timer); resolve() }, () => { clearTimeout(timer); resolve() })
  })
}

/**
 * The app's own @font-face rules, for a document the app prints. A print
 * document (the preview window or the hidden frame) has only the fonts it
 * declares itself, so without these its Khmer text fell back to a system font
 * with other metrics: a receipt the app measured at 208.7mm printed 224.2mm
 * long and spilled onto a second page, and the 80x50 card lost its bottom
 * 3.7mm (Sep 23 2026). URLs are made absolute so they resolve the same from a
 * popup or a frame; a face is only fetched when text uses it, from the files
 * the app has already loaded.
 */
export function appFontFaceCss(): string {
  if (typeof document === 'undefined' || typeof CSSFontFaceRule === 'undefined') return ''
  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets || [])) {
    let sheetRules: CSSRuleList
    try { sheetRules = sheet.cssRules } catch { continue } // a cross-origin sheet is unreadable
    const base = sheet.href || document.baseURI
    for (const rule of Array.from(sheetRules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      rules.push(rule.cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _quote: string, url: string) => {
        try { return `url("${new URL(url, base).href}")` } catch { return whole }
      }))
    }
  }
  return rules.join('\n')
}

// Exported so a caller that needs to act on the print document AFTER its
// fonts/images have settled but BEFORE print() is invoked (receipt printing
// re-measures its @page height in exactly that window) can await the same
// wait this module already uses for the hidden-iframe path, instead of
// inventing a second one that could disagree on timing.
export async function waitForFrameAssets(frameWindow: Window, frameDocument: Document): Promise<void> {
  const fonts = (frameDocument as Document & { fonts?: FontFaceSet }).fonts
  await withTimeout(Promise.all([
    fonts?.ready ? Promise.resolve(fonts.ready) : Promise.resolve(),
    Promise.all(Array.from(frameDocument.images || []).map(waitForImage)),
  ]), PRINT_FRAME_ASSET_TIMEOUT_MS)
  // One frame after layout: the receipt's own mm-based @page sizing is
  // resolved from the rendered document, not from the parsed HTML.
  await new Promise<void>((resolve) => {
    if (typeof frameWindow.requestAnimationFrame === 'function') frameWindow.requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

function removeFrameAfterPrinting(frame: HTMLIFrameElement, frameWindow: Window): void {
  let removed = false
  let timer = 0
  const remove = () => {
    if (removed) return
    removed = true
    clearTimeout(timer)
    frame.remove()
    if (activePrintFrame === frame) {
      activePrintFrame = null
      releaseActivePrintFrame = null
    }
  }
  timer = setTimeout(remove, PRINT_FRAME_CLEANUP_MS) as unknown as number
  releaseActivePrintFrame = remove
  frameWindow.addEventListener?.('afterprint', remove, { once: true })
}

/**
 * Prints `html` from a hidden iframe inside the CURRENT document, so the
 * installed iOS app keeps the job instead of handing a blank window to Safari.
 * Resolves once the platform print dialog has been asked for; returns false
 * only when this environment cannot host a frame at all, so the caller can
 * report a real failure rather than a silent no-op.
 *
 * `beforePrint`, when given, runs after fonts/images have settled and BEFORE
 * print() is called -- the one moment a caller can still rewrite something in
 * the frame's own document (receipt printing uses this to re-measure its
 * @page height inside the actual document that is about to print, not the
 * app's off-screen estimate). A throwing beforePrint must never cancel the
 * print itself; the frame already carries a working fallback.
 */
export async function printHtmlInHiddenFrame(
  html: string,
  options: { beforePrint?: (frameWindow: Window, frameDocument: Document) => void | Promise<void> } = {},
): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) return false
  // Never two at once: the previous document is dropped before this one is
  // written, so repeated taps cannot leave frames (and their decoded fonts
  // and images) alive in memory behind the print sheet.
  discardActivePrintFrame()
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.title = 'Print document'
  // Deliberately NOT display:none / visibility:hidden / zero-size: Safari
  // refuses to print a frame it does not consider rendered. A 1px transparent
  // frame pinned to the corner is rendered, unfocusable and invisible.
  frame.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;z-index:-1;'
  document.body.appendChild(frame)

  activePrintFrame = frame
  const frameWindow = frame.contentWindow
  const frameDocument = frame.contentDocument || frameWindow?.document || null
  if (!frameWindow || !frameDocument) {
    discardActivePrintFrame()
    return false
  }

  try {
    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()
    await waitForFrameAssets(frameWindow, frameDocument)
    if (options.beforePrint) {
      try { await options.beforePrint(frameWindow, frameDocument) } catch { /* fallback @page rule already in the document */ }
    }
    removeFrameAfterPrinting(frame, frameWindow)
    frameWindow.focus()
    // Safari (every iOS browser is Safari's engine) and Chromium print the
    // frame's own document through execCommand, which returns true, so
    // print() below is skipped; Firefox returns false and is served by
    // print(). Exactly one of the two runs, so one tap is one print job.
    let printed = false
    try {
      printed = frameDocument.execCommand?.('print', false, undefined) === true
    } catch {
      printed = false
    }
    if (!printed) frameWindow.print()
    return true
  } catch (error) {
    discardActivePrintFrame()
    throw error
  }
}

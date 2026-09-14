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

// A slow webfont must never be the reason a receipt does not print: after this
// the frame is printed with whatever has loaded.
const PRINT_FRAME_ASSET_TIMEOUT_MS = 4000
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

async function waitForFrameAssets(frameWindow: Window, frameDocument: Document): Promise<void> {
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
  }
  timer = setTimeout(remove, PRINT_FRAME_CLEANUP_MS) as unknown as number
  frameWindow.addEventListener?.('afterprint', remove, { once: true })
}

/**
 * Prints `html` from a hidden iframe inside the CURRENT document, so the
 * installed iOS app keeps the job instead of handing a blank window to Safari.
 * Resolves once the platform print dialog has been asked for; returns false
 * only when this environment cannot host a frame at all, so the caller can
 * report a real failure rather than a silent no-op.
 */
export async function printHtmlInHiddenFrame(html: string): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) return false
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.title = 'Print document'
  // Deliberately NOT display:none / visibility:hidden / zero-size: Safari
  // refuses to print a frame it does not consider rendered. A 1px transparent
  // frame pinned to the corner is rendered, unfocusable and invisible.
  frame.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;z-index:-1;'
  document.body.appendChild(frame)

  const frameWindow = frame.contentWindow
  const frameDocument = frame.contentDocument || frameWindow?.document || null
  if (!frameWindow || !frameDocument) {
    frame.remove()
    return false
  }

  try {
    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()
    await waitForFrameAssets(frameWindow, frameDocument)
    removeFrameAfterPrinting(frame, frameWindow)
    frameWindow.focus()
    // Safari (every iOS browser is Safari's engine) prints the frame's own
    // document through execCommand; Chromium and Firefox return false here
    // and are served by print() below. Trying both is what makes one code
    // path work on all of them.
    let printed = false
    try {
      printed = frameDocument.execCommand?.('print', false, undefined) === true
    } catch {
      printed = false
    }
    if (!printed) frameWindow.print()
    return true
  } catch (error) {
    frame.remove()
    throw error
  }
}

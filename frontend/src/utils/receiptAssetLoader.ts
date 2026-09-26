// Bounded inlining of a receipt's images and CSS url() assets before it prints.
//
// Why this exists (I8, Sep 26 2026): printReceipt.ts inlined every <img> and
// every style url() through fetch() + FileReader with NO deadline. A slow or
// hung image host (a logo URL, an ABA QR on another origin) held the whole
// print indefinitely -- the defect class behind "printing is slow". The loader
// below gives one preparation ONE shared deadline that covers headers, body
// and the FileReader, even when a transport ignores AbortSignal, and fetches
// each URL once per preparation however many nodes reference it.
//
// OWNER RULE: an image never blocks a print and never turns it into an error.
// Any failure -- timeout, 404, CORS refusal, reader error, a bad URL -- drops
// THAT asset (the image is hidden, the background removed) and the receipt
// prints without it, exactly as it did before the deadline existed. The typed
// error is internal: it is logged, never shown and never thrown to a caller.
//
// Origin: the deadline loader, de-duplication and the negative-control test
// are Codex's perf-print work (Worktrees/perf-print-20260925). Codex's version
// failed the whole print on any asset error; this one degrades instead.
//
// ONE EXCEPTION, the ABA payment QR (owner, 27 Sep 2026, Q13): it is not
// decoration, so the 5 s deadline must not hide it. An image inside a
// `data-receipt-qr="payment"` block is inlined FIRST, with its own generous
// deadline (RECEIPT_PAYMENT_QR_BUDGET_MS), and a slow one is waited for. Only
// when it really cannot be had is the WHOLE block removed -- collapsed, not a
// hidden gap -- and the caller told through onPaymentQrOmitted, so it can warn
// that the receipt printed without it.

import { RECEIPT_QR_ATTR, RECEIPT_QR_WAIT_CEILING_MS } from './receiptQrReadiness.ts'

export const RECEIPT_ASSET_BUDGET_MS = 5000
export const RECEIPT_PAYMENT_QR_BUDGET_MS = RECEIPT_QR_WAIT_CEILING_MS
// Only a payment QR that is actually slow switches the caller's label to
// "waiting"; a cached one inlines well inside this and never flickers it.
const PAYMENT_QR_WAITING_NOTICE_MS = 300
export const RECEIPT_ASSET_INLINE_CONCURRENCY = 3

export type ReceiptAssetFailure = 'timeout' | 'aborted' | 'http' | 'network' | 'reader' | 'invalid-url'

/** Internal only: explains in the log why one asset was left out of a print. */
export class ReceiptAssetError extends Error {
  readonly reason: ReceiptAssetFailure
  constructor(reason: ReceiptAssetFailure, detail = '') {
    super(`Receipt asset skipped (${reason})${detail ? `: ${detail}` : ''}`)
    this.name = 'ReceiptAssetError'
    this.reason = reason
  }
}

export type ReceiptAssetLoader = {
  /** Resolves to a data: URL, or rejects with ReceiptAssetError. */
  load: (src: string) => Promise<string>
  dispose: () => void
}

/** One lifetime for both inline stages. No cache survives a preparation. */
export function createReceiptAssetLoader({
  budgetMs = RECEIPT_ASSET_BUDGET_MS,
  baseUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost/',
  signal,
}: { budgetMs?: number; baseUrl?: string; signal?: AbortSignal } = {}): ReceiptAssetLoader {
  const controller = new AbortController()
  const pending = new Map<string, Promise<string>>()
  const readers = new Map<FileReader, () => void>()
  const waiters = new Set<(error: ReceiptAssetError) => void>()
  let closed = false
  let closedReason: ReceiptAssetFailure = 'aborted'
  const stop = (reason: ReceiptAssetFailure = 'aborted') => {
    if (closed) return
    closed = true
    closedReason = reason
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
    controller.abort()
    for (const cancel of readers.values()) cancel()
    readers.clear()
    for (const reject of waiters) reject(new ReceiptAssetError(reason))
    waiters.clear()
    pending.clear()
  }
  const onExternalAbort = () => stop('aborted')
  const timer = setTimeout(() => stop('timeout'), budgetMs)
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  if (signal?.aborted) stop('aborted')

  const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    if (closed) { reject(new ReceiptAssetError(closedReason)); return }
    const reader = new FileReader()
    const finish = () => {
      reader.onload = reader.onerror = reader.onabort = null
      readers.delete(reader)
    }
    readers.set(reader, () => {
      finish()
      if (reader.readyState === 1) reader.abort()
      reject(new ReceiptAssetError(closedReason))
    })
    reader.onload = () => {
      const result = String(reader.result || '')
      finish()
      if (result) resolve(result)
      else reject(new ReceiptAssetError('reader', 'empty result'))
    }
    reader.onerror = reader.onabort = () => { finish(); reject(new ReceiptAssetError('reader')) }
    try { reader.readAsDataURL(blob) } catch { finish(); reject(new ReceiptAssetError('reader')) }
  })

  const load = (src: string): Promise<string> => {
    if (closed) return Promise.reject(new ReceiptAssetError(closedReason))
    if (/^data:/i.test(src)) return Promise.resolve(src)
    let url: URL
    try { url = new URL(src, baseUrl) } catch { return Promise.reject(new ReceiptAssetError('invalid-url', src)) }
    const cached = pending.get(url.href)
    if (cached) return cached
    let rejectWork!: (error: ReceiptAssetError) => void
    const work = new Promise<string>((resolve, reject) => {
      rejectWork = reject
      waiters.add(reject)
      void (async () => {
        let response: Response
        try {
          response = await fetch(url.href, {
            mode: 'cors',
            credentials: url.origin === new URL(baseUrl).origin ? 'same-origin' : 'omit',
            signal: controller.signal,
          })
        } catch (error) {
          throw closed ? new ReceiptAssetError(closedReason) : new ReceiptAssetError('network', String((error as Error)?.message || error))
        }
        if (closed) throw new ReceiptAssetError(closedReason)
        if (!response.ok) throw new ReceiptAssetError('http', `${response.status} ${url.href}`)
        const blob = await response.blob()
        if (closed) throw new ReceiptAssetError(closedReason)
        return readBlob(blob)
      })().then(resolve, (error) => reject(error instanceof ReceiptAssetError ? error : new ReceiptAssetError(closed ? closedReason : 'network')))
    })
    // Detach this request's cancellation callback on either outcome.
    const tracked = work.then(
      value => { waiters.delete(rejectWork); return value },
      error => { waiters.delete(rejectWork); throw error },
    )
    pending.set(url.href, tracked)
    return tracked
  }
  return { load, dispose: () => stop('aborted') }
}

async function mapReceiptAssets<T>(items: Iterable<T> | ArrayLike<T> | null | undefined, worker: (item: T, index: number) => Promise<void> | void): Promise<void> {
  const list = Array.from(items || [])
  if (!list.length) return
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(RECEIPT_ASSET_INLINE_CONCURRENCY, list.length) }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(list[index], index)
    }
  })
  await Promise.all(workers)
}

function extractUrlsFromCssValue(value: unknown): string[] {
  return Array.from(String(value || '').matchAll(/url\((['"]?)(.*?)\1\)/gi))
    .map((match) => String(match[2] || '').trim())
    .filter(Boolean)
}

/** The asset, or null when it has to be left out. Never rejects. */
async function tryLoad(assets: ReceiptAssetLoader, src: string, skipped: ReceiptAssetError[]): Promise<string | null> {
  try {
    return await assets.load(src)
  } catch (error) {
    skipped.push(error instanceof ReceiptAssetError ? error : new ReceiptAssetError('network', String(error)))
    return null
  }
}

async function inlineImageNodeSources(root: HTMLElement, assets: ReceiptAssetLoader, skipped: ReceiptAssetError[]): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'))
  await mapReceiptAssets(images, async (image) => {
    const src = String(image.getAttribute('src') || '').trim()
    if (!src || /^data:/i.test(src)) return
    const dataUrl = await tryLoad(assets, src, skipped)
    if (dataUrl) {
      image.setAttribute('src', dataUrl)
    } else {
      // Unchanged from before the deadline: a missing image is hidden, and
      // the receipt still prints.
      image.removeAttribute('src')
      image.style.visibility = 'hidden'
    }
  })
}

async function inlineStyleAssetUrls(root: HTMLElement, assets: ReceiptAssetLoader, skipped: ReceiptAssetError[]): Promise<void> {
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
  await mapReceiptAssets(nodes, async (node) => {
    if (!(node instanceof HTMLElement)) return
    const style = node.getAttribute('style') || ''
    const urls = extractUrlsFromCssValue(style)
    if (!urls.length) return
    let nextStyle = style
    for (const src of urls) {
      if (/^data:/i.test(src)) continue
      const dataUrl = await tryLoad(assets, src, skipped)
      if (dataUrl) {
        nextStyle = nextStyle.split(src).join(dataUrl)
      } else {
        const escaped = String(src).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        nextStyle = nextStyle
          .replace(new RegExp(`background-image\\s*:\\s*url\\((['"]?)${escaped}\\1\\)\\s*;?`, 'gi'), 'background-image:none;')
          .replace(new RegExp(`background\\s*:[^;]*url\\((['"]?)${escaped}\\1\\)[^;]*;?`, 'gi'), 'background:none;')
      }
    }
    node.setAttribute('style', nextStyle)
  })
}

export type InlineReceiptAssetOptions = {
  budgetMs?: number
  paymentQrBudgetMs?: number
  baseUrl?: string
  signal?: AbortSignal
  /** Called once when at least one payment QR block was left out of this print. */
  onPaymentQrOmitted?: () => void
  /** true while a payment QR is slow to inline, false once it is settled. */
  onPaymentQrWaiting?: (waiting: boolean) => void
}

function paymentQrBlockOf(image: HTMLElement): Element | null {
  return typeof image.closest === 'function' ? image.closest(`[${RECEIPT_QR_ATTR}="payment"]`) : null
}

/**
 * Stage one: every payment QR image, with its own generous deadline. A slow
 * one is waited for; one that cannot be had takes its whole block out of the
 * clone. Returns the data: URLs it inlined, keyed by source, so the general
 * stage never fetches the same image a second time.
 */
async function inlinePaymentQrImages(
  root: HTMLElement,
  options: InlineReceiptAssetOptions,
  skipped: ReceiptAssetError[],
): Promise<{ inlined: Map<string, string>; omitted: number }> {
  const inlined = new Map<string, string>()
  let omitted = 0
  const paymentImages = Array.from(root.querySelectorAll('img')).filter((image) => paymentQrBlockOf(image))
  if (!paymentImages.length) return { inlined, omitted }
  const paymentAssets = createReceiptAssetLoader({
    budgetMs: options.paymentQrBudgetMs ?? RECEIPT_PAYMENT_QR_BUDGET_MS,
    baseUrl: options.baseUrl,
    signal: options.signal,
  })
  let waitingShown = false
  const waitingNotice = setTimeout(() => { waitingShown = true; options.onPaymentQrWaiting?.(true) }, PAYMENT_QR_WAITING_NOTICE_MS)
  try {
    await mapReceiptAssets(paymentImages, async (image) => {
      const src = String(image.getAttribute('src') || '').trim()
      if (/^data:/i.test(src)) return
      const dataUrl = src ? await tryLoad(paymentAssets, src, skipped) : null
      if (dataUrl) {
        image.setAttribute('src', dataUrl)
        inlined.set(src, dataUrl)
      } else {
        paymentQrBlockOf(image)?.remove()
        omitted += 1
      }
    })
  } finally {
    clearTimeout(waitingNotice)
    if (waitingShown) options.onPaymentQrWaiting?.(false)
    paymentAssets.dispose()
  }
  return { inlined, omitted }
}

/**
 * Inlines every <img> and style url() under `root` as a data: URL, within one
 * shared deadline. Always resolves: an asset that cannot be had in time is
 * left out and reported in the returned list (for logging), never thrown.
 * Payment QR images are the exception described at the top of this file.
 */
export async function inlineReceiptAssets(
  root: unknown,
  options: InlineReceiptAssetOptions = {},
): Promise<ReceiptAssetError[]> {
  const skipped: ReceiptAssetError[] = []
  if (typeof HTMLElement === 'undefined' || !(root instanceof HTMLElement)) return skipped
  const payment = await inlinePaymentQrImages(root, options, skipped)
  // A cancelled print is not an omitted payment QR: nothing is printed.
  if (payment.omitted && !options.signal?.aborted) options.onPaymentQrOmitted?.()
  const general = createReceiptAssetLoader(options)
  const assets: ReceiptAssetLoader = {
    load: (src) => {
      const known = payment.inlined.get(src)
      return known ? Promise.resolve(known) : general.load(src)
    },
    dispose: general.dispose,
  }
  try {
    await inlineImageNodeSources(root, assets, skipped)
    await inlineStyleAssetUrls(root, assets, skipped)
  } finally {
    assets.dispose()
  }
  if (skipped.length && typeof console !== 'undefined') {
    console.warn(`[receipt] printed without ${skipped.length} asset(s)`, skipped.map((error) => error.message))
  }
  return skipped
}

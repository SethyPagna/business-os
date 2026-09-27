// Print waits for QR codes (Q13, owner decision 27 Sep 2026): a receipt is
// never printed, exported or shared with a placeholder where a QR belongs.
//
// Every QR on a receipt announces its own state on the element that holds it:
//
//   data-receipt-qr="generated" | "payment"
//   data-receipt-qr-state="pending" | "ready" | "error"
//
// `generated` is a "scan to visit" code made locally (ReceiptQrCodes.tsx).
// `payment` is the ABA payment QR, a user-entered image URL. The print
// pipeline (printReceipt.ts) calls waitForReceiptQrCodes() on the live receipt
// BEFORE it clones anything, and it resolves only from those attributes -- a
// MutationObserver re-reads them whenever one changes -- never from a timer
// guessing that generation has probably finished.
//
// The two kinds fail differently, by the owner's rule:
//  - a generated QR that failed (after its one automatic retry) refuses the
//    print: the tile shows the error with Retry, and nothing is printed;
//  - a payment QR that errored is left out of the print cleanly, and the
//    caller is told so it can warn. A payment QR that is merely slow is waited
//    for, up to RECEIPT_QR_WAIT_CEILING_MS, with the caller's Cancel.

export const RECEIPT_QR_ATTR = 'data-receipt-qr'
export const RECEIPT_QR_STATE_ATTR = 'data-receipt-qr-state'
export const RECEIPT_QR_WAIT_CEILING_MS = 30_000

export type ReceiptQrKind = 'generated' | 'payment'
export type ReceiptQrState = 'pending' | 'ready' | 'error'

export type ReceiptQrErrorCode =
  /** A generated QR failed twice; its tile shows Retry. */
  | 'generation-failed'
  /** A generated QR was still pending at the ceiling. */
  | 'generation-timeout'
  /** The cashier pressed Cancel while the print waited. */
  | 'cancelled'

/** Thrown to the caller instead of printing. Callers translate by `code`. */
export class ReceiptQrError extends Error {
  readonly code: ReceiptQrErrorCode
  constructor(code: ReceiptQrErrorCode) {
    super(code === 'cancelled' ? 'Print cancelled' : `Receipt QR code not ready (${code})`)
    this.name = 'ReceiptQrError'
    this.code = code
  }
}

export function isReceiptQrError(error: unknown): error is ReceiptQrError {
  return error instanceof ReceiptQrError
}

/** Attribute props for the element that holds one QR. */
export function receiptQrAttrs(kind: ReceiptQrKind, state: ReceiptQrState): Record<string, string> {
  return { [RECEIPT_QR_ATTR]: kind, [RECEIPT_QR_STATE_ATTR]: state }
}

type QrCensus = { generatedPending: number; generatedFailed: number; paymentPending: number; paymentFailed: number }

function readQrCensus(root: ParentNode): QrCensus {
  const census: QrCensus = { generatedPending: 0, generatedFailed: 0, paymentPending: 0, paymentFailed: 0 }
  root.querySelectorAll(`[${RECEIPT_QR_ATTR}]`).forEach((node) => {
    const kind = node.getAttribute(RECEIPT_QR_ATTR)
    const state = node.getAttribute(RECEIPT_QR_STATE_ATTR)
    if (kind === 'generated') {
      if (state === 'error') census.generatedFailed += 1
      else if (state !== 'ready') census.generatedPending += 1
    } else if (kind === 'payment') {
      if (state === 'error') census.paymentFailed += 1
      else if (state !== 'ready') census.paymentPending += 1
    }
  })
  return census
}

export type ReceiptQrWaitResult = {
  /** Payment QRs that will be left out of this print (errored, or still loading at the ceiling). */
  paymentOmitted: number
}

export type ReceiptQrWaitOptions = {
  signal?: AbortSignal
  ceilingMs?: number
  /** Called with true when the print has to wait, and false when it stops waiting. */
  onWaiting?: (waiting: boolean) => void
}

/**
 * Resolves once every QR under `root` has settled; rejects with ReceiptQrError
 * when the print must not happen. Never resolves while a generated QR is
 * pending, so a caller that clones after it can never clone a placeholder.
 */
export function waitForReceiptQrCodes(root: unknown, options: ReceiptQrWaitOptions = {}): Promise<ReceiptQrWaitResult> {
  const { signal, ceilingMs = RECEIPT_QR_WAIT_CEILING_MS, onWaiting } = options
  if (signal?.aborted) return Promise.reject(new ReceiptQrError('cancelled'))
  if (typeof Element === 'undefined' || !(root instanceof Element)) return Promise.resolve({ paymentOmitted: 0 })

  const first = readQrCensus(root)
  if (first.generatedFailed) return Promise.reject(new ReceiptQrError('generation-failed'))
  if (!first.generatedPending && !first.paymentPending) return Promise.resolve({ paymentOmitted: first.paymentFailed })

  return new Promise<ReceiptQrWaitResult>((resolve, reject) => {
    let settled = false
    const finish = (outcome: () => void) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(ceiling)
      signal?.removeEventListener('abort', onAbort)
      onWaiting?.(false)
      outcome()
    }
    const recheck = () => {
      const census = readQrCensus(root)
      if (census.generatedFailed) finish(() => reject(new ReceiptQrError('generation-failed')))
      else if (!census.generatedPending && !census.paymentPending) finish(() => resolve({ paymentOmitted: census.paymentFailed }))
    }
    const onAbort = () => finish(() => reject(new ReceiptQrError('cancelled')))
    const observer = new MutationObserver(recheck)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: [RECEIPT_QR_ATTR, RECEIPT_QR_STATE_ATTR] })
    signal?.addEventListener('abort', onAbort, { once: true })
    // The ceiling is the owner's bound on waiting, not a guess at readiness: a
    // generated QR still pending then refuses the print; a payment QR still
    // loading is treated as not loadable and left out, with the warning.
    const ceiling = setTimeout(() => {
      const census = readQrCensus(root)
      if (census.generatedFailed) finish(() => reject(new ReceiptQrError('generation-failed')))
      else if (census.generatedPending) finish(() => reject(new ReceiptQrError('generation-timeout')))
      else finish(() => resolve({ paymentOmitted: census.paymentFailed + census.paymentPending }))
    }, ceilingMs)
    onWaiting?.(true)
  })
}

/**
 * Applied to a CLONE of the receipt, after waitForReceiptQrCodes resolved:
 * drops every payment QR that is not ready (so it collapses instead of leaving
 * a gap or a broken-image icon), and refuses when a generated QR is somehow
 * not ready -- the live receipt re-rendered between the wait and the clone.
 */
export function stripUnreadyReceiptQrCodes(clone: Element): void {
  clone.querySelectorAll(`[${RECEIPT_QR_ATTR}]`).forEach((node) => {
    if (node.getAttribute(RECEIPT_QR_STATE_ATTR) === 'ready') return
    if (node.getAttribute(RECEIPT_QR_ATTR) === 'payment') node.remove()
    else throw new ReceiptQrError(node.getAttribute(RECEIPT_QR_STATE_ATTR) === 'error' ? 'generation-failed' : 'generation-timeout')
  })
}

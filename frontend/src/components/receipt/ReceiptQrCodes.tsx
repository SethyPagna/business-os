import { useEffect, useState } from 'react'
import type { ReceiptQrSocialLink } from '../receipt-settings/constants'
import { normalizeSocialQrUrl } from '../../utils/socialQrLink'
import { receiptQrDataUrls } from '../../utils/receiptQrCache.ts'
import { receiptQrAttrs } from '../../utils/receiptQrReadiness.ts'

export interface ReceiptQrEntry {
  key: string
  label: string
  url: string
}

interface ReceiptQrCodesProps {
  entries: ReceiptQrEntry[]
  scanLabel: string
  /** Shown in a tile whose QR could not be generated. */
  failedLabel: string
  retryLabel: string
}

// Generation, the session cache and in-flight sharing live in
// utils/receiptQrCache.ts: the tiles mount with the receipt preview, so the QR
// images are usually ready before Print is tapped. "Usually" is not enough
// (Q13): each tile also announces its state through receiptQrAttrs, and the
// print pipeline waits on that (utils/receiptQrReadiness.ts) instead of
// cloning whatever the tile shows at the moment of the tap.

type TileGeneration = { status: 'pending' | 'error'; dataUrl: null } | { status: 'ready'; dataUrl: string }

function readyOrPending(url: string): TileGeneration {
  const cached = receiptQrDataUrls.peek(url)
  return cached ? { status: 'ready', dataUrl: cached } : { status: 'pending', dataUrl: null }
}

function QrTile({ entry, failedLabel, retryLabel }: { entry: ReceiptQrEntry; failedLabel: string; retryLabel: string }) {
  const [generation, setGeneration] = useState<TileGeneration>(() => readyOrPending(entry.url))
  // Bumped by Retry: re-runs the effect below for the same URL.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const initial = readyOrPending(entry.url)
    setGeneration(initial)
    if (initial.status === 'ready') return undefined
    // One automatic retry (owner rule): a transient failure, such as the
    // qrcode chunk failing to load once, must not reach the cashier. The cache
    // never remembers a failure, so the second get() really regenerates.
    receiptQrDataUrls.get(entry.url)
      .catch(() => receiptQrDataUrls.get(entry.url))
      .then(
        (dataUrl) => { if (!cancelled) setGeneration({ status: 'ready', dataUrl }) },
        () => { if (!cancelled) setGeneration({ status: 'error', dataUrl: null }) },
      )
    return () => { cancelled = true }
  }, [entry.url, attempt])

  // N33 (owner, Sep 6 2026, reading a printed 80mm receipt): "for the qr code
  // and the qr code name, keep them closer to each other, less margin." They
  // sat 8px apart -- 4px of padding inside the white box plus a 4px flex gap
  // -- which on a thermal print reads as two unrelated things. The box is now
  // exactly the size of the code it holds, so the 2px gap is all that is left
  // between the image and the name it belongs to.
  //
  // The tile is `w-full max-w-[80px]` rather than a fixed 80px, because three
  // fixed 80px tiles plus their gutters overflow a 58mm receipt -- and a
  // column that has run off the paper is not an evenly spaced one.
  return (
    <div className="flex w-full max-w-[80px] flex-col items-center gap-0.5 text-center">
      <div className="flex w-full max-w-[68px] items-center justify-center bg-white" {...receiptQrAttrs('generated', generation.status)}>
        {generation.status === 'ready'
          ? <img src={generation.dataUrl} alt={entry.label} width={68} height={68} className="h-auto w-full" />
          : generation.status === 'error'
            // Only ever on screen: printing refuses while any tile is here.
            // min-h rather than a fixed height, so a Khmer label keeps the
            // vertical room its stacked glyphs need.
            ? (
              <div role="alert" className="flex min-h-[68px] w-full flex-col items-center justify-center gap-1 border border-dashed border-red-300 p-1 text-center">
                <span className="text-[9px] leading-normal text-red-700">{failedLabel}</span>
                <button type="button" className="rounded border border-red-300 px-1.5 py-0.5 text-[9px] font-medium leading-normal text-red-700 hover:bg-red-50" onClick={() => setAttempt((value) => value + 1)}>
                  {retryLabel}
                </button>
              </div>
            )
            : <div className="h-[68px] w-full animate-pulse bg-gray-100" />}
      </div>
      <div className="w-full truncate text-[9px] font-medium leading-tight text-gray-600">{entry.label}</div>
    </div>
  )
}

/**
 * Renders the "scan to view" QR block at the end of a receipt. Designed to
 * work with the DOM-to-canvas export in printReceipt.ts: each QR is a plain
 * <img> with a data: URL src, which inlineImageNodeSources() passes through
 * untouched (no network re-fetch, no CORS taint) when the receipt is
 * rendered to PDF/image/print.
 */
export default function ReceiptQrCodes({ entries, scanLabel, failedLabel, retryLabel }: ReceiptQrCodesProps) {
  const visible = entries.filter((entry) => entry.url)
  if (!visible.length) return null
  return (
    <div key="qr_codes" className="mt-2 border-t border-dashed border-gray-300 pt-2">
      {scanLabel ? <div className="mb-1 text-center text-[10px] font-medium text-gray-500">{scanLabel}</div> : null}
      {/* Three equal 1fr columns with each tile centred in its own -- the
          spacing between the codes is the same wherever the receipt is cut,
          and the row gap no longer has to carry the padding the tiles used to
          add underneath themselves (N33). */}
      <div className="grid grid-cols-3 justify-items-center gap-x-1 gap-y-2">
        {visible.map((entry) => <QrTile key={entry.key} entry={entry} failedLabel={failedLabel} retryLabel={retryLabel} />)}
      </div>
    </div>
  )
}

export function normalizeQrSocialLinksForReceipt(links: ReceiptQrSocialLink[] | undefined): ReceiptQrEntry[] {
  if (!Array.isArray(links)) return []
  return links
    .filter((link) => link && String(link.url || '').trim())
    .slice(0, 8)
    .map((link, index) => ({
      key: link.id || `social-${index}`,
      label: String(link.label || '').trim() || `Link ${index + 1}`,
      // Canonicalize to each platform's real Universal Link shape before
      // it's ever turned into a QR code -- see socialQrLink.ts's own
      // header comment for why this (not a custom fb://-style scheme) is
      // what makes the printed QR code open the app directly, landing on
      // the actual page/group, with a graceful browser fallback when the
      // app isn't installed.
      url: normalizeSocialQrUrl(String(link.url || '').trim()).url,
    }))
}

/**
 * The ABA payment QR on the 80x50 card: an image the shop uploaded or linked,
 * so unlike the tiles above it is fetched, not generated. It announces its
 * state like a tile (receiptQrAttrs) and the print waits for it while it loads,
 * however slowly, up to the owner's 30 s ceiling (Q13). When the image errors
 * -- a dead link, or a URL that is not an image -- the block collapses: no
 * gap, no broken-image icon, and the print leaves it out and warns.
 *
 * Mount it with `key={src}` so a changed URL starts again from pending.
 */
export function ReceiptPaymentQr({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending')
  return (
    <div {...receiptQrAttrs('payment', state)} hidden={state === 'error'} className={state === 'error' ? undefined : 'flex justify-center pt-1'}>
      <img
        src={src}
        alt={alt}
        className="h-16 w-16 object-contain"
        onLoad={() => setState('ready')}
        onError={() => setState('error')}
      />
    </div>
  )
}

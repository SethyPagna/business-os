import { useEffect, useState } from 'react'
import type { ReceiptQrSocialLink } from '../receipt-settings/constants'
import { normalizeSocialQrUrl } from '../../utils/socialQrLink'

export interface ReceiptQrEntry {
  key: string
  label: string
  url: string
}

interface ReceiptQrCodesProps {
  entries: ReceiptQrEntry[]
  scanLabel: string
}

// Small in-memory cache so re-rendering the same receipt (e.g. switching
// language tabs) doesn't regenerate identical QR images every time.
const qrDataUrlCache = new Map<string, string>()
let qrcodeModulePromise: Promise<typeof import('qrcode')> | null = null

function loadQrcodeModule(): Promise<typeof import('qrcode')> {
  if (!qrcodeModulePromise) qrcodeModulePromise = import('qrcode')
  return qrcodeModulePromise
}

async function generateQrDataUrl(url: string): Promise<string> {
  const cached = qrDataUrlCache.get(url)
  if (cached) return cached
  const QRCode = await loadQrcodeModule()
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: '#111827', light: '#ffffff' },
  })
  qrDataUrlCache.set(url, dataUrl)
  return dataUrl
}

function QrTile({ entry }: { entry: ReceiptQrEntry }) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => qrDataUrlCache.get(entry.url) || null)

  useEffect(() => {
    let cancelled = false
    if (!entry.url) return undefined
    generateQrDataUrl(entry.url)
      .then((url) => { if (!cancelled) setDataUrl(url) })
      .catch(() => { if (!cancelled) setDataUrl(null) })
    return () => { cancelled = true }
  }, [entry.url])

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
      <div className="flex w-full max-w-[68px] items-center justify-center bg-white">
        {dataUrl
          ? <img src={dataUrl} alt={entry.label} width={68} height={68} className="h-auto w-full" />
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
export default function ReceiptQrCodes({ entries, scanLabel }: ReceiptQrCodesProps) {
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
        {visible.map((entry) => <QrTile key={entry.key} entry={entry} />)}
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

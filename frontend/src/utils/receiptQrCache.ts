// QR images for the receipt's "scan to visit" block, as data: URLs.
//
// Generated client-side from the lazy `qrcode` chunk (no network). A finished
// URL is kept for the session so re-rendering the same receipt (switching
// language, editing Receipt Settings) never regenerates it, and -- since I8,
// Sep 26 2026 -- a generation already in flight is shared, so tiles that mount
// together for the same link wait on ONE generation instead of racing several.
// A failed generation is not remembered: the next mount simply tries again.

export type QrDataUrlGenerator = (url: string) => Promise<string>

export function createQrDataUrlCache(generate: QrDataUrlGenerator) {
  const ready = new Map<string, string>()
  const inFlight = new Map<string, Promise<string>>()
  return {
    /** The finished data: URL, synchronously, or null when not generated yet. */
    peek(url: string): string | null {
      return ready.get(url) || null
    },
    get(url: string): Promise<string> {
      const cached = ready.get(url)
      if (cached) return Promise.resolve(cached)
      const pending = inFlight.get(url)
      if (pending) return pending
      const work = Promise.resolve()
        .then(() => generate(url))
        .then(
          (dataUrl) => { ready.set(url, dataUrl); inFlight.delete(url); return dataUrl },
          (error) => { inFlight.delete(url); throw error },
        )
      inFlight.set(url, work)
      return work
    },
  }
}

let qrcodeModulePromise: Promise<typeof import('qrcode')> | null = null

function loadQrcodeModule(): Promise<typeof import('qrcode')> {
  if (!qrcodeModulePromise) {
    qrcodeModulePromise = import('qrcode')
    // A failed chunk load must not be memoized, or the block stays blank.
    qrcodeModulePromise.catch(() => { qrcodeModulePromise = null })
  }
  return qrcodeModulePromise
}

export const receiptQrDataUrls = createQrDataUrlCache(async (url) => {
  const QRCode = await loadQrcodeModule()
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: '#111827', light: '#ffffff' },
  })
})

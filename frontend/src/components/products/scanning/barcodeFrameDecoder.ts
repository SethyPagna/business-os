// What the main thread and the decode worker agree on: which formats count, what
// makes a read acceptable, how a native result is chosen, where the on-screen
// guide sits in the camera frame, and the messages the two threads exchange.
// Pure and free of ZXing, so the scanner modal can import it without pulling
// the decoder: the ladder (barcodeLadder.ts) and the ZXing readers
// (barcodeZxing.ts) belong to the worker alone.

/** Retail and stock symbologies, in BarcodeDetector naming. QR is left out on
 * purpose: no caller scans one, and boxes often carry a marketing QR beside
 * the EAN that would otherwise win the race. */
export const RETAIL_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']

// A 1-3 character Code 128 / Code 39 / ITF "read" is noise that happens to
// form a valid start/stop pattern; no product barcode is that short.
const MIN_REAL_BARCODE_LENGTH = 4

/** Live loop timing: how often the native detector looks at a frame, and the
 * head start it gets before ZXing joins in. A fixed time, so changing the
 * cadence cannot silently change how long a foil label waits for ZXing. */
export const NATIVE_TICK_INTERVAL_MS = 120
export const NATIVE_ONLY_MS = 1000

export function zxingHeadStartOver(nativeStartedAt: number, now: number): boolean {
  return now - nativeStartedAt >= NATIVE_ONLY_MS
}

export interface BarcodeRead {
  text: string
  format: string
}

function gtinChecksumOk(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = 4 - weight) {
    sum += Number(digits[index]) * weight
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

function expandUpcE(code: string): string {
  const [system, d1, d2, d3, d4, d5, d6, check] = code
  const body = d6 <= '2' ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
    : d6 === '3' ? `${d1}${d2}${d3}00000${d4}${d5}`
      : d6 === '4' ? `${d1}${d2}${d3}${d4}00000${d5}`
        : `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return `${system}${body}${check}`
}

/** EAN/UPC reads must carry a valid check digit; Code 128, Code 39 and ITF need
 * printable text of at least MIN_REAL_BARCODE_LENGTH characters (ZXing checks
 * Code 128 and ITF's own checksums, Code 39 has none by default). */
export function isAcceptableBarcodeRead(read: BarcodeRead | null | undefined): read is BarcodeRead {
  const text = String(read?.text || '').trim()
  if (!text || /[\u0000-\u001f]/.test(text)) return false
  switch (read?.format) {
    case 'ean_13': return text.length === 13 && gtinChecksumOk(text)
    case 'ean_8': return text.length === 8 && gtinChecksumOk(text)
    case 'upc_a': return text.length === 12 && gtinChecksumOk(text)
    case 'upc_e': return text.length === 8 && /^[01]\d{7}$/.test(text) && gtinChecksumOk(expandUpcE(text))
    case 'code_128':
    case 'code_39':
    case 'itf': return text.length >= MIN_REAL_BARCODE_LENGTH
    // Native detectors report a format; anything outside the retail set (a
    // box's marketing QR) is not a product code.
    default: return !read?.format || RETAIL_BARCODE_FORMATS.includes(read.format)
  }
}

/** Live-loop guard: a ZXing read wins only when the next read agrees with it,
 * so one smudged frame cannot pick the wrong product. Misses in between do not
 * reset the candidate; a different value replaces it. A native read is trusted
 * on its own. */
export function createReadConfirmer(): (read: BarcodeRead | null, source: 'native' | 'zxing') => string | null {
  let candidate = ''
  return (read, source) => {
    if (!isAcceptableBarcodeRead(read)) return null
    const text = read.text.trim()
    if (source === 'native' || candidate === text) return text
    candidate = text
    return null
  }
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Formats to ask the native BarcodeDetector for, from its own supported list
 * (`null`: it cannot list them, so assume ours). Empty means it reads none of
 * the retail formats, and the live loop should start ZXing at once instead of
 * waiting on a detector that can never answer. */
export function planNativeFormats(supported: readonly unknown[] | null): string[] {
  if (supported === null) return [...RETAIL_BARCODE_FORMATS]
  return supported.map((format) => String(format || '')).filter((format) => RETAIL_BARCODE_FORMATS.includes(format))
}

export interface NativeDetection {
  rawValue?: unknown
  format?: unknown
  boundingBox?: Rect | null
}

function centreInside(box: Rect | null | undefined, area: Rect): boolean {
  if (!box) return false
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height
}

/** The read to act on from one native detection pass. A second code elsewhere
 * on the box must not beat the one in the guide, so an acceptable result whose
 * box centre lies in `guide` wins; otherwise the first acceptable result does
 * (a detector that reports no box ranks every result as outside). */
export function pickNativeRead(results: readonly NativeDetection[], guide: Rect): BarcodeRead | null {
  let outside: BarcodeRead | null = null
  for (const result of results) {
    const read = { text: String(result?.rawValue || '').trim(), format: String(result?.format || '') }
    if (!isAcceptableBarcodeRead(read)) continue
    if (centreInside(result.boundingBox, guide)) return read
    outside ??= read
  }
  return outside
}

/** One grabbed region as the camera's own RGBA pixels. The main thread only
 * reads them out and transfers the buffer; the worker turns them into grayscale. */
export interface PixelFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** A frame for the worker to decode: the guide area (the centre of a photo),
 * and, when sent, the whole picture. */
export interface DecodeRequest {
  id: number
  centre: PixelFrame
  full?: PixelFrame
  /** The photo path's last resort; the live loop never asks for it. */
  tryHarder: boolean
}

export type DecodeReply =
  | { type: 'ready' }
  | { type: 'read'; id: number; read: BarcodeRead | null }
  /** Without an id the worker could not start; with one, that frame failed. */
  | { type: 'failed'; id?: number; message: string }

// Longest side of a grabbed region; a larger source is scaled down by the canvas.
const MAX_SIDE = 1280

/** The on-screen scan box: its size as a percentage of the visible video area,
 * centred in it. The scanner modal draws its overlay from SCAN_GUIDE_BOX and
 * the grabber decodes the same box, so the code the person aims into the guide
 * is the code that gets read. */
export interface GuideBox { widthPercent: number; heightPercent: number }
export const SCAN_GUIDE_BOX: GuideBox = { widthPercent: 86, heightPercent: 70 }

export interface ViewSize { width: number; height: number }

/** On-screen size of the element showing a video, or null when it is not laid
 * out (a detached image, a test double). */
export function viewOf(element: { clientWidth?: number; clientHeight?: number }): ViewSize | null {
  return element.clientWidth && element.clientHeight ? { width: element.clientWidth, height: element.clientHeight } : null
}

/** Where `box` sits in the camera frame. The video fills its view with
 * object-fit: cover, so the view shows a centred crop of the frame scaled by
 * max(view / frame); the guide is centred in that crop, hence in the frame.
 * Rounded outward so the rect always contains the guide. A null view means
 * the frame is shown whole. */
export function guideRectInFrame(frameWidth: number, frameHeight: number, view: ViewSize | null, box: GuideBox): Rect {
  const scale = view ? Math.max(view.width / frameWidth, view.height / frameHeight) : 1
  const visibleWidth = view ? view.width / scale : frameWidth
  const visibleHeight = view ? view.height / scale : frameHeight
  const width = (visibleWidth * box.widthPercent) / 100
  const height = (visibleHeight * box.heightPercent) / 100
  const left = (frameWidth - width) / 2
  const top = (frameHeight - height) / 2
  const x = Math.max(0, Math.floor(left))
  const y = Math.max(0, Math.floor(top))
  return {
    x,
    y,
    width: Math.min(frameWidth, Math.ceil(left + width)) - x,
    height: Math.min(frameHeight, Math.ceil(top + height)) - y,
  }
}

// A still photo has no guide to follow: its middle is where the subject is.
function photoCentre(width: number, height: number): Rect {
  const centreWidth = Math.round(width * 0.6)
  const centreHeight = Math.round(height * 0.6)
  return { x: (width - centreWidth) >> 1, y: (height - centreHeight) >> 1, width: centreWidth, height: centreHeight }
}

/** The two regions of a source, each read out only when asked for. */
export interface PixelRegions {
  centre: () => PixelFrame
  full: () => PixelFrame
}

/** Grabs regions from a video or image through one reusable canvas: the area
 * `guide` outlines on screen (the centre 60% x 60% for a photo, which has no
 * guide) at up to native resolution, and the whole picture, each capped at
 * MAX_SIDE. */
export function createFrameGrabber(guide?: GuideBox) {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  const grab = (source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): PixelFrame => {
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
    const width = Math.max(1, Math.round(sw * scale))
    const height = Math.max(1, Math.round(sh * scale))
    if (!canvas || !context) {
      canvas = document.createElement('canvas')
      context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Canvas 2D is unavailable for barcode scanning.')
    }
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height)
    return { data: context.getImageData(0, 0, width, height).data, width, height }
  }
  return (source: CanvasImageSource, sourceWidth: number, sourceHeight: number): PixelRegions => {
    const centre = guide
      ? guideRectInFrame(sourceWidth, sourceHeight, viewOf(source as { clientWidth?: number; clientHeight?: number }), guide)
      : photoCentre(sourceWidth, sourceHeight)
    return {
      centre: () => grab(source, centre.x, centre.y, centre.width, centre.height),
      full: () => grab(source, 0, 0, sourceWidth, sourceHeight),
    }
  }
}

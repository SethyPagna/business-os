// Shared decode ladder for the live camera loop and the photo path. ZXing's
// own loop decodes one whole grayscale frame and thresholds each scanned row
// on that row's histogram, so a pale foil label on a dark box reads as blank,
// and a code standing on its end is never seen. This file owns the frame
// instead: centre crop, then the whole frame; plain grayscale, then a locally
// normalised and thresholded copy; each upright and turned 90 degrees.

/** Retail and stock symbologies, in BarcodeDetector naming. QR is left out on
 * purpose: no caller scans one, and boxes often carry a marketing QR beside
 * the EAN that would otherwise win the race. */
export const RETAIL_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']

export interface LumaFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface BarcodeRead {
  text: string
  format: string
}

export type LumaDecoder = (frame: LumaFrame, tryHarder: boolean) => BarcodeRead | null

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

/** EAN/UPC reads must carry a valid check digit; other retail symbologies only
 * need printable text (Code 128 and ITF verify their own checksums in ZXing). */
export function isAcceptableBarcodeRead(read: BarcodeRead | null | undefined): read is BarcodeRead {
  const text = String(read?.text || '').trim()
  if (!text || /[\u0000-\u001f]/.test(text)) return false
  switch (read?.format) {
    case 'ean_13': return text.length === 13 && gtinChecksumOk(text)
    case 'ean_8': return text.length === 8 && gtinChecksumOk(text)
    case 'upc_a': return text.length === 12 && gtinChecksumOk(text)
    case 'upc_e': return text.length === 8 && /^[01]\d{7}$/.test(text) && gtinChecksumOk(expandUpcE(text))
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

function rgbaToLuma(rgba: Uint8ClampedArray, width: number, height: number): LumaFrame {
  const data = new Uint8ClampedArray(width * height)
  for (let source = 0, target = 0; target < data.length; source += 4, target += 1) {
    data[target] = (306 * rgba[source] + 601 * rgba[source + 1] + 117 * rgba[source + 2] + 512) >> 10
  }
  return { data, width, height }
}

// Neighbourhood for the local passes: several bar widths, well under a label.
const localRadius = (width: number, height: number) => Math.max(8, Math.round(Math.min(width, height) / 16))

/** Re-centres every pixel on its neighbourhood mean and scales by the local
 * spread. ZXing thresholds each scanned row on that row's own histogram, so a
 * pale foil label on a dark box reads as all-white; after this the label's
 * bars and spaces straddle mid-grey wherever they sit and however much glare
 * lies across them. Edges stay grey, not snapped, so bar widths survive. */
function normalizeLocalContrast(frame: LumaFrame): LumaFrame {
  const { width, height } = frame
  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  const squares = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    let rowSquares = 0
    for (let x = 0; x < width; x += 1) {
      const value = frame.data[y * width + x]
      rowSum += value
      rowSquares += value * value
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum
      squares[(y + 1) * stride + x + 1] = squares[y * stride + x + 1] + rowSquares
    }
  }
  const radius = localRadius(width, height)
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const area = (bottom - top) * (right - left)
      const corner = (table: Float64Array) => table[bottom * stride + right] - table[top * stride + right]
        - table[bottom * stride + left] + table[top * stride + left]
      const mean = corner(sums) / area
      const spread = Math.sqrt(Math.max(0, corner(squares) / area - mean * mean))
      data[y * width + x] = 128 + (64 * (frame.data[y * width + x] - mean)) / Math.max(spread, 6)
    }
  }
  return { data, width, height }
}

/** Black where a pixel is darker than its neighbourhood mean, white
 * elsewhere: the sign of the normalisation above without its cost, which is
 * what the live loop can afford per frame. */
function thresholdLocalMean(frame: LumaFrame): LumaFrame {
  const { width, height } = frame
  const stride = width + 1
  const sums = new Uint32Array(stride * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += frame.data[y * width + x]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum
    }
  }
  const radius = localRadius(width, height)
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const sum = sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left]
      data[y * width + x] = frame.data[y * width + x] * (bottom - top) * (right - left) < sum ? 0 : 255
    }
  }
  return { data, width, height }
}

/** Averages each pixel with the rows above and below it. Once a 1D code's bars
 * run vertically this removes sensor noise without blurring the bars, which is
 * what a single-row reader needs on a dim, low-contrast label. */
function smoothAlongBars(frame: LumaFrame, radius = 3): LumaFrame {
  const { width, height } = frame
  const data = new Uint8ClampedArray(width * height)
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    let count = 0
    for (let y = 0; y < Math.min(height, radius); y += 1) { sum += frame.data[y * width + x]; count += 1 }
    for (let y = 0; y < height; y += 1) {
      const enter = y + radius
      const leave = y - radius - 1
      if (enter < height) { sum += frame.data[enter * width + x]; count += 1 }
      if (leave >= 0) { sum -= frame.data[leave * width + x]; count -= 1 }
      data[y * width + x] = sum / count
    }
  }
  return { data, width, height }
}

/** Quarter turn clockwise, so 1D readers (which scan rows) see vertical bars. */
export function rotateQuarter(frame: LumaFrame): LumaFrame {
  const { width, height } = frame
  const data = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[x * height + (height - 1 - y)] = frame.data[y * width + x]
  }
  return { data, width: height, height: width }
}

type Region = 'centre' | 'full'
type Variant = 'gray' | 'smooth' | 'contrast' | 'threshold'

/** Lazily produced views of one frame: the centre of the on-screen guide box
 * and the whole picture, each already capped in size. */
export interface FrameRegions {
  centre: () => LumaFrame
  full: () => LumaFrame
}

interface LadderStep { region: Region; variant: Variant; rotate: boolean; tryHarder: boolean }

// The fast tier lets ZXing sample ~15 rows per view (12-80 ms each, measured);
// TRY_HARDER samples ~256 rows and costs 0.4-1.2 s per miss on the same
// machine, so it is the photo path's last resort and never blocks the live
// camera loop.
const FAST_LADDER: LadderStep[] = []
for (const region of ['centre', 'full'] as Region[]) {
  for (const variant of ['gray', 'threshold'] as Variant[]) {
    for (const rotate of [false, true]) FAST_LADDER.push({ region, variant, rotate, tryHarder: false })
  }
}
const FULL_LADDER: LadderStep[] = [...FAST_LADDER]
for (const region of ['centre', 'full'] as Region[]) {
  for (const rotate of [false, true]) FULL_LADDER.push({ region, variant: 'contrast', rotate, tryHarder: true })
}

/** Runs ladder steps from `startStep` until one decodes or `deadline` passes
 * (checked between steps, so the first step always runs). Returns the read, or
 * the step the next frame should resume from. */
export function runDecodeLadder(
  regions: FrameRegions,
  decode: LumaDecoder,
  {
    startStep = 0,
    deadline = Infinity,
    tryHarder = false,
    now = () => Date.now(),
  }: { startStep?: number; deadline?: number; tryHarder?: boolean; now?: () => number } = {},
): { read: BarcodeRead | null; nextStep: number; attempts: number } {
  const ladder = tryHarder ? FULL_LADDER : FAST_LADDER
  const views = new Map<string, LumaFrame>()
  const view = (region: Region, variant: Variant, rotate: boolean): LumaFrame => {
    const key = `${region}:${variant}:${rotate}`
    let frame = views.get(key)
    if (!frame) {
      frame = variant === 'gray'
        ? (rotate ? rotateQuarter(view(region, 'gray', false)) : regions[region]())
        : variant === 'smooth' ? smoothAlongBars(view(region, 'gray', rotate))
          : variant === 'contrast' ? normalizeLocalContrast(view(region, 'smooth', rotate))
            : thresholdLocalMean(view(region, 'smooth', rotate))
      views.set(key, frame)
    }
    return frame
  }

  let attempts = 0
  for (let offset = 0; offset < ladder.length; offset += 1) {
    const step = (startStep + offset) % ladder.length
    if (attempts > 0 && now() >= deadline) return { read: null, nextStep: step, attempts }
    const { region, variant, rotate, tryHarder: hard } = ladder[step]
    attempts += 1
    const read = decode(view(region, variant, rotate), hard)
    if (isAcceptableBarcodeRead(read)) return { read, nextStep: step, attempts }
  }
  return { read: null, nextStep: startStep % ladder.length, attempts }
}

const MAX_SIDE = 1280

/** Grabs regions from a video or image through one reusable canvas: the
 * centre 60% x 60% (where the guide box asks for the code) at up to native
 * resolution, and the whole picture, each capped at MAX_SIDE. */
export function createFrameGrabber() {
  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  const grab = (source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): LumaFrame => {
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
    return rgbaToLuma(context.getImageData(0, 0, width, height).data, width, height)
  }
  return (source: CanvasImageSource, sourceWidth: number, sourceHeight: number): FrameRegions => {
    const cw = Math.round(sourceWidth * 0.6)
    const ch = Math.round(sourceHeight * 0.6)
    return {
      centre: () => grab(source, (sourceWidth - cw) >> 1, (sourceHeight - ch) >> 1, cw, ch),
      full: () => grab(source, 0, 0, sourceWidth, sourceHeight),
    }
  }
}

/** Two readers per session, both limited to the retail formats: a fast one and
 * a TRY_HARDER one. Only "nothing here" exceptions count as a miss; anything
 * else is a real fault and propagates. */
export async function loadLumaDecoder(): Promise<LumaDecoder> {
  const zxing = await import('@zxing/library')
  const formatByName: Record<string, number> = {
    ean_13: zxing.BarcodeFormat.EAN_13,
    ean_8: zxing.BarcodeFormat.EAN_8,
    upc_a: zxing.BarcodeFormat.UPC_A,
    upc_e: zxing.BarcodeFormat.UPC_E,
    code_128: zxing.BarcodeFormat.CODE_128,
    code_39: zxing.BarcodeFormat.CODE_39,
    itf: zxing.BarcodeFormat.ITF,
  }
  const nameByFormat = new Map(Object.entries(formatByName).map(([name, format]) => [format, name]))
  const possibleFormats = RETAIL_BARCODE_FORMATS.map((name) => formatByName[name])
  const createReader = (tryHarder: boolean) => {
    const reader = new zxing.MultiFormatReader()
    const hints = new Map<number, unknown>([[zxing.DecodeHintType.POSSIBLE_FORMATS, possibleFormats]])
    if (tryHarder) hints.set(zxing.DecodeHintType.TRY_HARDER, true)
    reader.setHints(hints as never)
    return reader
  }
  const fast = createReader(false)
  const hard = createReader(true)
  return (frame, tryHarder) => {
    const reader = tryHarder ? hard : fast
    try {
      const source = new zxing.RGBLuminanceSource(frame.data, frame.width, frame.height)
      const result = reader.decodeWithState(new zxing.BinaryBitmap(new zxing.HybridBinarizer(source)))
      return { text: String(result.getText() || '').trim(), format: nameByFormat.get(result.getBarcodeFormat()) || '' }
    } catch (error) {
      if (
        error instanceof zxing.NotFoundException
        || error instanceof zxing.ChecksumException
        || error instanceof zxing.FormatException
      ) return null
      throw error
    }
  }
}

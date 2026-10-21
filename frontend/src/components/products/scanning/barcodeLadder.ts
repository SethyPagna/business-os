// The decode ladder, run inside the decode worker (barcodeDecode.worker.ts).
// ZXing's own loop decodes one whole grayscale frame and thresholds each scanned
// row on that row's histogram, so a pale foil label on a dark box reads as
// blank, and a code standing on its end is never seen. This file owns the frame
// instead: the area the on-screen guide outlines (a still photo has no guide, so
// its centre), then the whole frame; plain grayscale, then a locally
// normalised and thresholded copy; each upright and turned 90 degrees.
// Nothing here may be imported by the main thread: it would pull the ladder
// back onto the thread the worker exists to keep free.

import { isAcceptableBarcodeRead, type BarcodeRead } from './barcodeFrameDecoder.ts'

export interface LumaFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type LumaDecoder = (frame: LumaFrame, tryHarder: boolean) => BarcodeRead | null

type NumericArray = Uint8ClampedArray | Uint32Array | Float64Array

/** Named arrays that survive between frames. A live scan hands the ladder the
 * same few sizes on every frame; allocating them anew meant about 1 MB of
 * grayscale per view and, for the contrast pass, 15 MB of float tables per
 * call. A slot is valid until the same slot is asked for again, so a name must
 * never be shared by two arrays that are alive together. */
export interface Scratch {
  array<T extends NumericArray>(slot: string, Type: new (length: number) => T, length: number): T
}

/** Allocates every array fresh: the behaviour before arrays were kept. */
export const FRESH_ARRAYS: Scratch = { array: (_slot, Type, length) => new Type(length) }

export function createScratch(): Scratch {
  const held = new Map<string, NumericArray>()
  return {
    array<T extends NumericArray>(slot: string, Type: new (length: number) => T, length: number): T {
      const kept = held.get(slot)
      if (kept instanceof Type && kept.length === length) return kept
      const fresh = new Type(length)
      held.set(slot, fresh)
      return fresh
    },
  }
}

export type Region = 'centre' | 'full'
type Variant = 'gray' | 'smooth' | 'contrast' | 'threshold'

/** The slot a ladder view lives in: unique per live view, stable across frames. */
export const viewSlot = (region: Region, variant: Variant, rotate: boolean): string => `${region}:${variant}:${rotate}`

export function rgbaToLuma(rgba: Uint8ClampedArray, width: number, height: number, scratch: Scratch = FRESH_ARRAYS, slot = 'luma'): LumaFrame {
  const data = scratch.array(slot, Uint8ClampedArray, width * height)
  for (let source = 0, target = 0; target < data.length; source += 4, target += 1) {
    data[target] = (306 * rgba[source] + 601 * rgba[source + 1] + 117 * rgba[source + 2] + 512) >> 10
  }
  return { data, width, height }
}

// Neighbourhood for the local passes: several bar widths, well under a label.
const localRadius = (width: number, height: number) => Math.max(8, Math.round(Math.min(width, height) / 16))

// A summed-area table reads its first row and column as zero. They are never
// written by the fill, so a kept array must be cleared there: the rest of it
// holds the previous frame.
function clearTableEdges(table: NumericArray, stride: number, rows: number): void {
  table.fill(0, 0, stride)
  for (let row = 1; row < rows; row += 1) table[row * stride] = 0
}

/** Re-centres every pixel on its neighbourhood mean and scales by the local
 * spread. ZXing thresholds each scanned row on that row's own histogram, so a
 * pale foil label on a dark box reads as all-white; after this the label's
 * bars and spaces straddle mid-grey wherever they sit and however much glare
 * lies across them. Edges stay grey, not snapped, so bar widths survive. */
export function normalizeLocalContrast(frame: LumaFrame, scratch: Scratch, slot: string): LumaFrame {
  const { width, height } = frame
  const stride = width + 1
  const tableLength = stride * (height + 1)
  const sums = scratch.array(`contrast-sums:${tableLength}`, Float64Array, tableLength)
  const squares = scratch.array(`contrast-squares:${tableLength}`, Float64Array, tableLength)
  clearTableEdges(sums, stride, height + 1)
  clearTableEdges(squares, stride, height + 1)
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
  const data = scratch.array(slot, Uint8ClampedArray, width * height)
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
export function thresholdLocalMean(frame: LumaFrame, scratch: Scratch, slot: string): LumaFrame {
  const { width, height } = frame
  const stride = width + 1
  const tableLength = stride * (height + 1)
  const sums = scratch.array(`threshold-sums:${tableLength}`, Uint32Array, tableLength)
  clearTableEdges(sums, stride, height + 1)
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += frame.data[y * width + x]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + rowSum
    }
  }
  const radius = localRadius(width, height)
  const data = scratch.array(slot, Uint8ClampedArray, width * height)
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
export function smoothAlongBars(frame: LumaFrame, scratch: Scratch, slot: string, radius = 3): LumaFrame {
  const { width, height } = frame
  const data = scratch.array(slot, Uint8ClampedArray, width * height)
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
export function rotateQuarter(frame: LumaFrame, scratch: Scratch = FRESH_ARRAYS, slot = 'rotated'): LumaFrame {
  const { width, height } = frame
  const data = scratch.array(slot, Uint8ClampedArray, width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[x * height + (height - 1 - y)] = frame.data[y * width + x]
  }
  return { data, width: height, height: width }
}

/** Lazily produced views of one frame: the guide area (the centre of a photo)
 * and the whole picture, each already capped in size. A frame the main thread
 * sent without the whole picture has no `full`, and the steps that need it are
 * skipped. */
export interface FrameRegions {
  centre: () => LumaFrame
  full?: () => LumaFrame
}

interface LadderStep { region: Region; variant: Variant; rotate: boolean; tryHarder: boolean }

// The fast tier lets ZXing sample ~15 rows per view (12-80 ms each, measured);
// TRY_HARDER samples ~256 rows and costs 0.4-1.2 s per miss on the same
// machine, so it is the photo path's last resort and never delays a live frame.
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
 * the step a later frame could resume from. The worker runs every step of a
 * frame, so the app itself sets neither `deadline` nor `startStep` any more;
 * both stay, tested, for a caller that has to bound a frame. */
export function runDecodeLadder(
  regions: FrameRegions,
  decode: LumaDecoder,
  {
    startStep = 0,
    deadline = Infinity,
    tryHarder = false,
    now = () => Date.now(),
    scratch = FRESH_ARRAYS,
  }: { startStep?: number; deadline?: number; tryHarder?: boolean; now?: () => number; scratch?: Scratch } = {},
): { read: BarcodeRead | null; nextStep: number; attempts: number } {
  const ladder = tryHarder ? FULL_LADDER : FAST_LADDER
  const views = new Map<string, LumaFrame>()
  const view = (region: Region, variant: Variant, rotate: boolean): LumaFrame => {
    const slot = viewSlot(region, variant, rotate)
    let frame = views.get(slot)
    if (!frame) {
      frame = variant === 'gray'
        ? (rotate ? rotateQuarter(view(region, 'gray', false), scratch, slot) : regions[region]!())
        : variant === 'smooth' ? smoothAlongBars(view(region, 'gray', rotate), scratch, slot)
          : variant === 'contrast' ? normalizeLocalContrast(view(region, 'smooth', rotate), scratch, slot)
            : thresholdLocalMean(view(region, 'smooth', rotate), scratch, slot)
      views.set(slot, frame)
    }
    return frame
  }

  let attempts = 0
  for (let offset = 0; offset < ladder.length; offset += 1) {
    const step = (startStep + offset) % ladder.length
    const { region, variant, rotate, tryHarder: hard } = ladder[step]
    if (!regions[region]) continue
    if (attempts > 0 && now() >= deadline) return { read: null, nextStep: step, attempts }
    attempts += 1
    const read = decode(view(region, variant, rotate), hard)
    if (isAcceptableBarcodeRead(read)) return { read, nextStep: step, attempts }
  }
  return { read: null, nextStep: startStep % ladder.length, attempts }
}

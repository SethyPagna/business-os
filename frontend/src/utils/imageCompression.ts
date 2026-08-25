// Client-side image compression.
//
// Why this exists: the Cloudflare Workers runtime has no `sharp` (or any
// native image library), so the old Docker backend's "compress on upload"
// behavior could not be ported server-side. Until this fix, the Workers
// routes (`/api/products/upload-image`, `/api/files/upload`,
// `/api/users/avatar-upload`) papered over that gap by hard-rejecting any
// image over 40KB with an error telling the person to pre-compress it
// themselves -- so uploads from a phone camera or an unedited product photo
// failed outright.
//
// This module does the compression the browser is able to do (Canvas ->
// blob re-encode), before the file ever reaches the network layer. It is
// deliberately conservative about quality: the goal is "strip the bytes a
// person would never notice" (huge dimensions, PNG-for-a-photo, no
// re-encode at all), not aggressive lossy shrinking.

export type CompressImageOptions = {
  /** Longest edge, in pixels, after resizing. Photos rarely need more than this for POS/product/portal use. */
  maxDimension?: number
  /** Encoder quality 0..1 for the FIRST attempt. Kept high by default; see buildCompressionPlan for how later attempts step this down when the byte caps below aren't met. */
  quality?: number
  /** If the recompressed result isn't at least this fraction smaller than the source, keep the original bytes -- but only applies when the source is already within budget (see maxBytes/targetBytes); an over-budget source always takes the smallest result found regardless of this ratio. */
  minSavingsRatio?: number
  /** Optional new base name (extension is decided by the output encoding), e.g. a matched product name. */
  renameTo?: string
  /** Hard cap, in bytes. Every attempt in the compression plan runs until the result is at or under this, or every step (down to the dimension/quality floor) has been tried -- whichever comes first. */
  maxBytes?: number
  /** Soft target, in bytes -- compression stops as soon as a step reaches this, without necessarily walking the whole plan down to maxBytes' worst case. Should be <= maxBytes. */
  targetBytes?: number
}

export const DEFAULT_COMPRESS_OPTIONS: Required<Pick<CompressImageOptions, 'maxDimension' | 'quality' | 'minSavingsRatio' | 'maxBytes' | 'targetBytes'>> = {
  maxDimension: 2560,
  quality: 0.92,
  minSavingsRatio: 0.05,
  // THE BAND: land between 300KB and 350KB. 350KB is a hard ceiling nothing
  // may cross; 300KB is a floor, because landing far below the cap throws
  // away image quality for storage nobody asked to save.
  //
  // The previous 180KB/140KB pair (and the Library page's even tighter
  // 70KB/40KB override) were not the real problem on their own -- the
  // SELECTION RULE was. The encode loop kept the SMALLEST blob it had seen
  // and stopped at the soft target, and the plan only ever steps DOWN in
  // quality and dimension. So the result was structurally biased toward the
  // bottom of the budget: an image that could have been a crisp 340KB was
  // shipped as a soft 70KB.
  //
  // Because the plan is monotonically decreasing, the FIRST attempt that
  // fits under maxBytes is by construction the LARGEST one that fits -- so
  // the loop now stops there instead of continuing to shrink. A result
  // below targetBytes therefore means the source genuinely could not
  // produce more bytes at full quality and full dimension (a small or very
  // flat image), not that the algorithm gave up early.
  maxBytes: 350 * 1024,
  targetBytes: 300 * 1024,
}

/** Hard ceiling for any stored image, in bytes. Nothing may exceed this. */
export const IMAGE_SIZE_CEILING_BYTES = DEFAULT_COMPRESS_OPTIONS.maxBytes
/** Desired floor. Landing below this is acceptable ONLY when the source cannot produce more. */
export const IMAGE_SIZE_FLOOR_BYTES = DEFAULT_COMPRESS_OPTIONS.targetBytes

const COMPRESSIBLE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

function supportsCanvasCompression(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
    && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.toBlob === 'function'
}

export function isCompressibleImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  const mime = (file.type || '').toLowerCase()
  if (COMPRESSIBLE_MIME.has(mime)) return true
  // Some browsers/OSes hand us images with no MIME type set; fall back to extension.
  return /\.(jpe?g|png|webp)$/i.test(file.name || '')
}

/** Pure sizing helper -- kept separate from the DOM/Canvas calls so it is unit-testable in Node. */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxDimension = DEFAULT_COMPRESS_OPTIONS.maxDimension,
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height)
  if (!Number.isFinite(longest) || longest <= 0 || longest <= maxDimension) {
    return { width, height, scaled: false }
  }
  const scale = maxDimension / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: true }
}

// Quality ladder tried at each dimension before stepping the dimension
// down. Front-loaded with the caller's own starting quality (~0.92) so a
// source that's already small/simple often exits on the very first
// attempt with no visible loss at all; the later steps only ever run for
// images that didn't make budget at a higher quality.
const QUALITY_STEPS = [0.92, 0.8, 0.68, 0.55, 0.42]
// Each dimension round shrinks the longest edge by 25% from the previous
// round -- big enough to meaningfully cut bytes (pixel count drops
// ~44% per round), small enough that a product/POS photo is still sharp
// well past the floor below.
const DIMENSION_SHRINK_FACTOR = 0.75
// Never resize a photo smaller than this on its longest edge, no matter
// how far over the byte cap the source is -- past this point further
// shrinking reads as genuinely low-resolution, not just "compressed",
// for the product-card/lightbox/POS-grid sizes this app displays images
// at. A source that still can't hit maxBytes at this floor + the lowest
// quality step ships as the smallest attempt found rather than looping
// forever chasing an unreachable target.
const MIN_DIMENSION_FLOOR = 480
const MAX_DIMENSION_ROUNDS = 3

/**
 * Builds the ordered list of (maxDimension, quality) attempts
 * compressImageFile walks through until one lands at or under
 * targetBytes/maxBytes. Pure and DOM-free so it's directly unit-testable
 * (see tests/imageCompressionPlan.test.ts) -- the actual Canvas encode
 * loop in compressImageFile just walks whatever this returns.
 */
export function buildCompressionPlan(initialMaxDimension: number): Array<{ maxDimension: number; quality: number }> {
  const plan: Array<{ maxDimension: number; quality: number }> = []
  let dim = Math.max(MIN_DIMENSION_FLOOR, Math.round(initialMaxDimension) || DEFAULT_COMPRESS_OPTIONS.maxDimension)
  const seenDimensions = new Set<number>()
  for (let round = 0; round < MAX_DIMENSION_ROUNDS; round += 1) {
    if (seenDimensions.has(dim)) break
    seenDimensions.add(dim)
    for (const quality of QUALITY_STEPS) plan.push({ maxDimension: dim, quality })
    if (dim <= MIN_DIMENSION_FLOOR) break
    dim = Math.max(MIN_DIMENSION_FLOOR, Math.round(dim * DIMENSION_SHRINK_FACTOR))
  }
  return plan
}

/**
 * Renaming helper -- also unit-testable without touching the DOM. Mirrors
 * the backend's sanitize rules exactly (no path separators/control
 * chars, disallowed characters collapse to a single '-', not a plain
 * space -- Part 242, see cloudflare/src/lib/importImageMatch.ts's
 * sanitizeBaseName for the shared rationale).
 */
export function buildCompressedFileName(originalName: string, renameTo: string | undefined, outputExt: 'webp' | 'jpg'): string {
  const base = (renameTo || originalName || 'image').replace(/\.[^./\\]+$/, '')
  const safeBase = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 150) || 'image'
  return `${safeBase}.${outputExt}`
}

async function loadBitmap(file: File): Promise<{ width: number; height: number; source: ImageBitmap | HTMLImageElement }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { width: bitmap.width, height: bitmap.height, source: bitmap }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Could not read image for compression'))
      element.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, source: img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), mime, quality))
}

/**
 * Compresses an image File client-side. Falls back to returning the
 * original file untouched whenever compression isn't possible or isn't
 * worthwhile (already small, not a photo format, browser lacks Canvas
 * support, encoding failed) -- callers should always be able to send
 * whatever this returns without extra branching.
 */
function extnameOf(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName || '')
  return match ? match[0] : ''
}

/**
 * Renames a File to `renameTo` without touching its bytes/type. Used on
 * every path where `compressImageFile` decides NOT to re-encode (already
 * small, PNG/screenshot that wouldn't shrink, unsupported browser, encode
 * failure) -- those are exactly the cases that used to silently skip the
 * rename entirely, since the old code only renamed inside the "compression
 * succeeded" branch. That's the actual cause of the reported bug: whether
 * an uploaded product photo got renamed to the product name, or kept
 * whatever meaningless name the phone/camera assigned it, depended on
 * whether that particular image happened to compress well -- invisible and
 * unpredictable from the person uploading it.
 */
export function renameFileIfRequested(file: File, renameTo: string | undefined): File {
  if (!renameTo) return file
  const ext = (extnameOf(file.name) || '.jpg').toLowerCase()
  const safeBase = renameTo
    .replace(/\.[^./\\]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 150) || 'image'
  const fileName = `${safeBase}${ext}`
  if (fileName === file.name) return file
  return new File([file], fileName, { type: file.type, lastModified: file.lastModified })
}

export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<File> {
  const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...options }
  if (!(file instanceof File) || !isCompressibleImageFile(file) || !supportsCanvasCompression()) {
    return renameFileIfRequested(file, opts.renameTo)
  }

  try {
    const { width, height, source } = await loadBitmap(file)
    const plan = buildCompressionPlan(opts.maxDimension)

    let best: { blob: Blob; mime: string; ext: 'webp' | 'jpg' } | null = null
    let canvas: HTMLCanvasElement | null = null
    let ctx: CanvasRenderingContext2D | null = null
    let currentDimension = -1
    let outputMime: 'image/webp' | 'image/jpeg' = 'image/jpeg'
    let outputExt: 'webp' | 'jpg' = 'jpg'
    let webpChecked = false
    let anyResized = false

    for (const step of plan) {
      // Only redraw the canvas when the dimension actually changes --
      // encoding the same pixels at a different quality doesn't need a
      // fresh draw, so a typical run (one dimension round, several
      // quality steps) draws once and re-encodes cheaply from there.
      if (step.maxDimension !== currentDimension) {
        // Release the previous round's canvas backing store before
        // allocating the next one. Without this, a sequential multi-image
        // upload loop (ProductForm's gallery add, BulkImportModal's
        // per-row image match) can accumulate several full-resolution
        // canvas buffers in a row before the browser's GC catches up --
        // on iOS Safari specifically, which enforces a hard aggregate
        // canvas-memory budget per page, this silently makes `toBlob`
        // return null for later images once the budget is exhausted, so
        // `best` stays null and the ORIGINAL uncompressed file ships
        // instead (the exact "only compresses every 4-5 images" symptom
        // reported this session). Zeroing width/height forces the
        // browser to free the backing store immediately rather than
        // waiting on GC.
        if (canvas) { canvas.width = 0; canvas.height = 0 }
        const target = computeTargetDimensions(width, height, step.maxDimension)
        if (target.scaled) anyResized = true
        canvas = document.createElement('canvas')
        canvas.width = target.width
        canvas.height = target.height
        ctx = canvas.getContext('2d')
        if (!ctx) break
        ctx.drawImage(source as CanvasImageSource, 0, 0, target.width, target.height)
        currentDimension = step.maxDimension
        if (!webpChecked) {
          const canEncodeWebp = await canvasToBlob(canvas, 'image/webp', 0.95).then((blob) => !!blob).catch(() => false)
          outputMime = canEncodeWebp ? 'image/webp' : 'image/jpeg'
          outputExt = canEncodeWebp ? 'webp' : 'jpg'
          webpChecked = true
        }
      }
      if (!canvas) break

      const blob = await canvasToBlob(canvas, outputMime, step.quality)
      if (!blob) continue
      // The plan walks from highest quality/largest dimension downward, so
      // sizes decrease monotonically. That makes the FIRST attempt at or
      // under the ceiling the LARGEST one that fits -- i.e. the best quality
      // available within budget -- so take it and stop.
      //
      // This used to keep whichever blob was SMALLEST and stop at the soft
      // target, which walked past perfectly good results to ship the most
      // degraded one the plan produced. That is why stored images sat far
      // below their budget.
      if (blob.size <= opts.maxBytes) {
        best = { blob, mime: outputMime, ext: outputExt }
        break
      }
      // Still over the ceiling: hold the smallest seen so far purely as a
      // fallback for a detail-dense source that never gets under it.
      if (!best || blob.size < best.blob.size) best = { blob, mime: outputMime, ext: outputExt }
    }
    if ('close' in source && typeof (source as ImageBitmap).close === 'function') (source as ImageBitmap).close()
    // Same backing-store release as above, for the last canvas the loop
    // created -- this is what actually frees memory ahead of the NEXT
    // file in a sequential upload loop, since this function returns right
    // after this point on every path below.
    if (canvas) { canvas.width = 0; canvas.height = 0 }

    if (!best) return renameFileIfRequested(file, opts.renameTo)
    // Never ship something bigger than what was already there.
    if (best.blob.size >= file.size) return renameFileIfRequested(file, opts.renameTo)

    // A source that's already small and within maxDimension only gets
    // replaced if the re-encode actually saved meaningful space
    // (minSavingsRatio) -- no point spending a re-encode's worth of
    // generational quality loss on a handful of KB. A source that started
    // over either byte cap or over maxDimension always takes the smallest
    // result the plan found, even if that's a less-than-minSavingsRatio
    // improvement, because getting under budget takes priority there.
    const startedWithinBudget = file.size <= opts.targetBytes && !anyResized
    if (startedWithinBudget && best.blob.size > file.size * (1 - opts.minSavingsRatio)) {
      return renameFileIfRequested(file, opts.renameTo)
    }

    const fileName = buildCompressedFileName(file.name, opts.renameTo, best.ext)
    return new File([best.blob], fileName, { type: best.mime, lastModified: Date.now() })
  } catch {
    // Never let a compression failure block the upload -- ship the original,
    // still renamed if one was requested.
    return renameFileIfRequested(file, opts.renameTo)
  }
}

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

// Downscales in halving steps instead of one jump.
//
// This is the fix for "blurred pixels" on large photos. A single
// drawImage() from, say, 4000px straight down to 1600px makes the browser
// sample a 2.5x reduction in one pass: it reads roughly one source pixel per
// destination pixel and discards the rest, so fine detail aliases into mush.
// It is why a big photo came out looking soft while a zip of the same file
// stays crisp -- zip is lossless and never resamples at all.
//
// Halving repeatedly is the standard remedy: each 2:1 step averages exactly
// 4 source pixels into 1, which is what the smoothing filter is good at, and
// the errors do not compound the way one large jump's do. The final step
// lands on the exact target.
//
// imageSmoothingQuality is set explicitly because browsers default it to
// 'low' in several cases, which is precisely the cheap sampling being
// avoided here.
function drawDownscaled(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Not a reduction (or barely one): a single draw is already correct, and
  // halving toward a LARGER size would be wrong.
  if (targetWidth >= sourceWidth || targetHeight >= sourceHeight || sourceWidth / targetWidth < 2) {
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
    return
  }

  let currentWidth = sourceWidth
  let currentHeight = sourceHeight
  let current: CanvasImageSource = source
  let scratch: HTMLCanvasElement | null = null

  // Halve while a full halving still overshoots the target.
  while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
    const nextWidth = Math.max(1, Math.floor(currentWidth / 2))
    const nextHeight = Math.max(1, Math.floor(currentHeight / 2))
    const next = document.createElement('canvas')
    next.width = nextWidth
    next.height = nextHeight
    const nextCtx = next.getContext('2d')
    if (!nextCtx) break
    nextCtx.imageSmoothingEnabled = true
    nextCtx.imageSmoothingQuality = 'high'
    nextCtx.drawImage(current, 0, 0, nextWidth, nextHeight)
    // Free the previous scratch immediately rather than waiting on GC --
    // same iOS Safari canvas-memory budget the main loop already guards.
    if (scratch) { scratch.width = 0; scratch.height = 0 }
    scratch = next
    current = next
    currentWidth = nextWidth
    currentHeight = nextHeight
  }

  ctx.drawImage(current, 0, 0, targetWidth, targetHeight)
  if (scratch) { scratch.width = 0; scratch.height = 0 }
}

export const DEFAULT_COMPRESS_OPTIONS: Required<Pick<CompressImageOptions, 'maxDimension' | 'quality' | 'minSavingsRatio' | 'maxBytes' | 'targetBytes'>> = {
  maxDimension: 2560,
  quality: 0.94,
  minSavingsRatio: 0.05,
  // Keep new product/library images close to the upload ceiling rather than
  // crushing them far below it. The Worker accepts 1MB as the normal fast
  // path, so 900KB leaves transport/header safety room while preserving much
  // more detail than the former 300-350KB band.
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
  maxBytes: 900 * 1024,
  targetBytes: 820 * 1024,
}

/** Hard ceiling for any stored image, in bytes. Nothing may exceed this. */
export const IMAGE_SIZE_CEILING_BYTES = DEFAULT_COMPRESS_OPTIONS.maxBytes
/** Desired floor. Landing below this is acceptable ONLY when the source cannot produce more. */
export const IMAGE_SIZE_FLOOR_BYTES = DEFAULT_COMPRESS_OPTIONS.targetBytes

const COMPRESSIBLE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'])

function supportsCanvasCompression(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
    && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.toBlob === 'function'
}

export function isCompressibleImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  const mime = (file.type || '').toLowerCase()
  if (COMPRESSIBLE_MIME.has(mime)) return true
  // Treat other still-image MIME types as candidates too: if this browser can
  // decode them, Canvas can convert them to WebP/JPEG. Animated GIF/SVG are
  // excluded because flattening them would change semantics.
  if (mime.startsWith('image/') && mime !== 'image/gif' && mime !== 'image/svg+xml') return true
  // Some browsers/OSes hand us images with no MIME type set; fall back to extension.
  return /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name || '')
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

// Compression order is deliberately dimension-first. For product photos a
// slightly smaller high-quality WebP generally looks better than a full-size
// image crushed to low encoder quality. We therefore try high quality at each
// progressively smaller dimension, then only lower quality at the final
// dimension if a pathological/detail-dense image still misses the byte cap.
const PRIMARY_QUALITY = 0.94
const QUALITY_FALLBACK_STEPS = [0.88, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.22, 0.16]
const DIMENSION_SHRINK_FACTOR = 0.8
// Emergency floor only. The loop stops at the FIRST result under the cap, so
// normal photos never reach this size; it exists for unusually noisy/detail-
// dense camera images that would otherwise still exceed 1MB after a 640px
// encode and get rejected downstream.
const MIN_DIMENSION_FLOOR = 320
const MAX_DIMENSION_ROUNDS = 16

/**
 * Builds the ordered list of (maxDimension, quality) attempts
 * compressImageFile walks through until one lands at or under maxBytes.
 * The ladder always reaches MIN_DIMENSION_FLOOR, so a camera photo cannot
 * stop after only a few rounds and remain above the server budget. Because
 * the first under-cap result wins, the emergency floor is used only when
 * every larger, higher-quality attempt really failed the byte ceiling.
 */
export function buildCompressionPlan(initialMaxDimension: number, initialQuality = PRIMARY_QUALITY): Array<{ maxDimension: number; quality: number }> {
  const dimensions: number[] = []
  let dim = Math.max(MIN_DIMENSION_FLOOR, Math.round(initialMaxDimension) || DEFAULT_COMPRESS_OPTIONS.maxDimension)
  for (let round = 0; round < MAX_DIMENSION_ROUNDS; round += 1) {
    if (dimensions.includes(dim)) break
    dimensions.push(dim)
    if (dim <= MIN_DIMENSION_FLOOR) break
    dim = Math.max(MIN_DIMENSION_FLOOR, Math.round(dim * DIMENSION_SHRINK_FACTOR))
  }
  if (dimensions[dimensions.length - 1] !== MIN_DIMENSION_FLOOR) dimensions.push(MIN_DIMENSION_FLOOR)

  const firstQuality = Math.min(0.98, Math.max(0.5, Number(initialQuality) || PRIMARY_QUALITY))
  const plan = dimensions.map((maxDimension) => ({ maxDimension, quality: firstQuality }))
  for (const quality of QUALITY_FALLBACK_STEPS) plan.push({ maxDimension: MIN_DIMENSION_FLOOR, quality })
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
  // createImageBitmap is fast and memory-efficient when the browser supports
  // the source codec, but some Safari/HEIC combinations expose the function
  // and still reject the decode. Fall through to <img> instead of treating
  // that first decoder failure as "compression impossible".
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { width: bitmap.width, height: bitmap.height, source: bitmap }
    } catch { /* try the DOM image decoder below */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Could not decode image for compression'))
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
export function renameFileIfRequested(file: File, renameTo: string | undefined, position = 1): File {
  if (!renameTo) return file
  const ext = (extnameOf(file.name) || '.jpg').toLowerCase()
  const safeBase = renameTo
    .replace(/\.[^./\\]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 150) || 'image'
  // ALWAYS indexed, matching buildImageDisplayName on the Worker side.
  //
  // This used to emit a bare "<Product Name>.jpg", so one product could end
  // up with a file named bare and the next named _2 -- and which you got
  // depended on WHICH ROUTE did the renaming. One shape now: every stored
  // image is `<Product Name>_<n>`, so sorting is correct by name alone and a
  // second image is purely additive rather than renaming the first. Matching
  // still folds a trailing index back, so both spellings resolve to the same
  // product on re-import.
  const fileName = `${safeBase}_${Math.max(1, Math.floor(position))}${ext}`
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
    const plan = buildCompressionPlan(opts.maxDimension, opts.quality)

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
        drawDownscaled(ctx, source as CanvasImageSource, width, height, target.width, target.height)
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
    // Never ship something bigger than what was already there. If an extreme
    // source still misses maxBytes even at the emergency floor, return the
    // smallest re-encode rather than the original giant camera file; the
    // upload route has a second server-side normalization ladder and can then
    // finish the job without blaming the operator.
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

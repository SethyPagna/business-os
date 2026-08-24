// Client-side video compression, via ffmpeg.wasm.
//
// WHY THIS EXISTS: same root cause as utils/imageCompression.ts -- the
// Cloudflare Workers backend has no native transcoder (ffmpeg cannot run
// inside a Workers V8 isolate; see cloudflare/src/queue.ts's notes on
// that), so a video attached from a phone camera or an unedited product
// clip had nowhere to shrink before hitting storage. This module runs
// the compression in the browser instead, the same place image
// compression already happens, before the file ever leaves the client.
//
// AUTOMATIC ONLY, DELIBERATELY: per direction, this exposes no manual
// codec/CRF/bitrate picker (unlike the reference app in the attached zip,
// which has a full settings dialog for exactly that). One function, one
// behavior: pick sane settings from the source file itself and go. If a
// person needs frame-accurate control over their video encode, this is
// the wrong tool for that -- it's a "make the upload not enormous"
// safety net, mirroring imageCompression.ts's own stated goal ("strip
// the bytes a person would never notice"), not a video editor.
//
// WHY @ffmpeg/ffmpeg (not a rewrite against a newer major): the zip this
// was built from (`video-compress-main`) already pins `@ffmpeg/ffmpeg`
// ^0.11.6 + `@ffmpeg/core` ^0.11.0 in its package.json, and this
// project's own frontend/package.json already carries those exact same
// two dependencies (confirmed before writing a line of this file) --
// they were added for this file to exist, so this targets that version's
// API (`createFFmpeg`/`FS`/`run`), not the newer `@ffmpeg/ffmpeg@0.12`
// class-based API, to avoid a dependency bump this session wasn't asked
// to make.
//
// LAZY-LOADED, LIKE THE SOURCE APP: `@ffmpeg/ffmpeg` + its wasm core are
// multiple MB -- importing it at module scope would bloat every page's
// bundle (POS, Products, Portal, everything) for a feature only the
// upload path ever touches. The import (and the ffmpeg core fetch/load)
// only happens the first time `compressVideoFile` actually runs, and the
// loaded instance is cached for the rest of the session.

const COMPRESSIBLE_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/3gpp'])

// Below this, the ffmpeg.wasm load + transcode overhead (multi-MB wasm
// core fetch, single-threaded software encode) isn't worth it for the
// bytes it would save -- ship the original untouched, same "not worth
// it" floor imageCompression.ts applies via minSavingsRatio.
const MIN_COMPRESSIBLE_BYTES = 2 * 1024 * 1024

// Above this, be more aggressive (lower quality target) so a multi-
// hundred-MB phone-camera clip doesn't take minutes of single-threaded
// wasm encoding or blow past a typical upload size limit.
const LARGE_FILE_BYTES = 80 * 1024 * 1024

export function isCompressibleVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  const mime = (file.type || '').toLowerCase()
  if (COMPRESSIBLE_MIME.has(mime)) return true
  if (mime.startsWith('video/')) return true
  // Some browsers/OSes (notably older Android/iOS share sheets) hand us
  // a video with no MIME type set at all; fall back to extension.
  return /\.(mp4|mov|webm|mkv|3gp|m4v)$/i.test(file.name || '')
}

function supportsWasm(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function'
}

// Picks the whole automatic preset from nothing but the source file's
// own size -- no probing for resolution/duration (ffprobe-style
// inspection would mean an extra full decode pass before the real one,
// doubling wasm work for information this heuristic doesn't need). CRF
// is libx264's constant-quality mode: lower number = higher quality/
// bigger file. 26 is a conservative "won't be visibly worse" default;
// large files step up to 30 (still fine for POS/product/portal display
// sizes, meaningfully smaller output, faster single-threaded encode).
// The 1280px cap keeps a 4K phone clip from encoding at its native
// resolution for a UI that never displays video larger than a product
// card/lightbox anyway -- same reasoning as imageCompression.ts's
// maxDimension, just for video.
function pickAutomaticSettings(sourceBytes: number): { crf: number; maxWidth: number; audioBitrateKbps: number } {
  const large = sourceBytes >= LARGE_FILE_BYTES
  return { crf: large ? 30 : 26, maxWidth: 1280, audioBitrateKbps: large ? 96 : 128 }
}

type FfmpegInstance = {
  isLoaded: () => boolean
  load: () => Promise<void>
  FS: (method: string, ...args: unknown[]) => unknown
  run: (...args: string[]) => Promise<void>
  setProgress: (cb: (progress: { ratio: number }) => void) => void
  exit?: () => void
}

let ffmpegSingleton: FfmpegInstance | null = null
let ffmpegLoadPromise: Promise<FfmpegInstance> | null = null

// Loads (and caches) a single ffmpeg.wasm instance for the whole session.
// Dynamic import so `@ffmpeg/ffmpeg` never enters the main bundle for
// pages that never touch video upload.
async function getFfmpeg(): Promise<FfmpegInstance> {
  if (ffmpegSingleton?.isLoaded()) return ffmpegSingleton
  if (ffmpegLoadPromise) return ffmpegLoadPromise

  ffmpegLoadPromise = (async () => {
    const { createFFmpeg } = await import('@ffmpeg/ffmpeg')
    const instance = createFFmpeg({ log: false }) as unknown as FfmpegInstance
    await instance.load()
    ffmpegSingleton = instance
    return instance
  })()

  try {
    return await ffmpegLoadPromise
  } finally {
    ffmpegLoadPromise = null
  }
}

async function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

function getExtension(name: string): string {
  return (/\.([a-zA-Z0-9]+)$/.exec(name || '')?.[1] || 'mp4').toLowerCase()
}

/** Renaming helper -- mirrors imageCompression.ts's buildCompressedFileName exactly (same sanitize rules, incl. the '-' substitution for disallowed characters -- Part 242), so a bulk-import auto-rename lands on a consistent filename shape whether it's an image or a video. */
export function buildCompressedVideoFileName(originalName: string, renameTo: string | undefined): string {
  const base = (renameTo || originalName || 'video').replace(/\.[^./\\]+$/, '')
  const safeBase = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 150) || 'video'
  return `${safeBase}.mp4`
}

export type CompressVideoOptions = {
  /** Optional new base name (extension is always .mp4, the one format this module ever outputs), e.g. a matched product name -- same purpose as imageCompression's renameTo. */
  renameTo?: string
}

/**
 * Compresses a video File client-side via ffmpeg.wasm, using automatic
 * settings derived from the file itself -- no manual codec/bitrate
 * picker. Falls back to returning the original file untouched whenever
 * compression isn't possible, isn't worthwhile, or fails for any reason
 * -- same contract as compressImageFile: callers should always be able
 * to send whatever this returns without extra branching or error
 * handling of their own.
 */
export async function compressVideoFile(file: File, options: CompressVideoOptions = {}): Promise<File> {
  if (!(file instanceof File) || !isCompressibleVideoFile(file) || !supportsWasm()) return file
  if (file.size < MIN_COMPRESSIBLE_BYTES) return file

  const inputName = `input.${getExtension(file.name)}`
  const outputName = 'output.mp4'

  try {
    const ffmpeg = await getFfmpeg()
    const settings = pickAutomaticSettings(file.size)

    ffmpeg.FS('writeFile', inputName, await readFileAsUint8Array(file))

    // -vf scale=...: only downscales (never upscales) -- 'min(...)'
    // guards a source already smaller than the cap. -2 keeps the other
    // dimension even, which libx264 requires. Automatic-only, so this is
    // always CRF mode (no bitrate/percentage/filesize picker) with a
    // faster x264 preset -- appropriate for a background browser encode,
    // not a broadcast-quality offline render.
    const args = [
      '-i', inputName,
      '-vf', `scale='min(${settings.maxWidth},iw)':-2`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', String(settings.crf),
      '-c:a', 'aac',
      '-b:a', `${settings.audioBitrateKbps}k`,
      '-movflags', '+faststart',
      outputName,
    ]

    await ffmpeg.run(...args)

    const data = ffmpeg.FS('readFile', outputName) as { buffer: ArrayBuffer; length: number }
    const blob = new Blob([data.buffer], { type: 'video/mp4' })

    // Only use the recompressed version if it actually saved meaningful
    // space -- a source that's already well-compressed (common for a
    // video re-uploaded from a previous export of this same app) can
    // come out larger after a fresh encode; ship the original then.
    if (!blob.size || blob.size >= file.size) return file

    const fileName = buildCompressedVideoFileName(file.name, options.renameTo)
    return new File([blob], fileName, { type: 'video/mp4', lastModified: Date.now() })
  } catch {
    // Never let a compression failure block the upload -- ship the
    // original, exactly as compressImageFile does on any Canvas/encode
    // failure.
    return file
  } finally {
    // Best-effort cleanup of the in-memory FS entries so a session that
    // compresses many videos back-to-back doesn't accumulate them --
    // failures here (e.g. a file that never got written because `load()`
    // itself threw) are expected and harmless.
    try { ffmpegSingleton?.FS('unlink', inputName) } catch { /* noop */ }
    try { ffmpegSingleton?.FS('unlink', outputName) } catch { /* noop */ }
  }
}

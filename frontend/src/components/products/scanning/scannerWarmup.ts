// What the scanner can settle before its camera is ready. The press that opens
// it starts all of this (warmScanner), so it finishes while getUserMedia is
// still waiting on the camera or the permission prompt: what the native
// BarcodeDetector reads (asked once per page load) and the ZXing chunk.
// Kept free of decoder imports so the buttons that call it stay small.

import type { NativeDetection } from './barcodeFrameDecoder.ts'

export interface NativeBarcodeDetector {
  detect: (source: HTMLVideoElement) => Promise<NativeDetection[]>
}

export interface NativeBarcodeDetectorConstructor {
  new(options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<unknown[]>
}

export function getNativeBarcodeDetector(): NativeBarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') return null
  const detector = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector
  return typeof detector === 'function' ? detector as NativeBarcodeDetectorConstructor : null
}

async function readSupportedFormats(detector: NativeBarcodeDetectorConstructor): Promise<unknown[] | null> {
  if (typeof detector.getSupportedFormats !== 'function') return null
  try {
    return await detector.getSupportedFormats()
  } catch (error) {
    // ZXing reads every retail format, so a detector that cannot even list
    // its own is left out rather than stopping the scan.
    console.error('[scanner] The native barcode detector could not list its formats; using the ZXing decoder.', error)
    return []
  }
}

let supportedFormats: Promise<unknown[] | null> | null = null

/** The formats the native BarcodeDetector says it reads, asked once per page
 * load however many times the scanner is warmed or opened. [] when this
 * browser has no detector (or it failed to answer); null when it has one that
 * cannot list its formats. */
export function nativeSupportedFormats(): Promise<unknown[] | null> {
  const detector = getNativeBarcodeDetector()
  if (!detector) return Promise.resolve([])
  supportedFormats ??= readSupportedFormats(detector)
  return supportedFormats
}

export type ScannerMark = 'tap' | 'stream' | 'decoder-ready' | 'read'

/** performance.mark points for timing tap -> camera -> decoder -> read on a
 * real device. Nothing is sent anywhere; only the latest of each is kept. */
export function markScanner(step: ScannerMark): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  const name = `scanner:${step}`
  performance.clearMarks(name)
  performance.mark(name)
}

let engineFetchStarted = false

/** Called on the press that opens the scanner. Idempotent, and never throws:
 * it is a head start, and the scan that follows reports any real failure. */
export function warmScanner(): void {
  markScanner('tap')
  if (engineFetchStarted) return
  engineFetchStarted = true
  void nativeSupportedFormats()
  import('./barcodeFrameDecoder.ts').then((decoder) => decoder.prefetchZxing()).catch(() => {})
}

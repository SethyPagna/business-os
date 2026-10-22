import {
  createFrameGrabber,
  isAcceptableBarcodeRead,
  planNativeFormats,
  type PixelRegions,
} from './barcodeFrameDecoder.ts'
import { acquireDecodeClient, type DecodeClient } from './decodeWorkerClient.ts'
import type { NativeBarcodeDetectorConstructor } from './scannerWarmup.ts'

/** Why a photo gave no barcode. The scanner modal turns each into a translated sentence;
 * the message is for developers and logs, never shown to a person. */
export type PhotoScanFailure = 'no-photo' | 'unreadable' | 'no-barcode'

export class PhotoScanError extends Error {
  failure: PhotoScanFailure

  constructor(failure: PhotoScanFailure, message: string) {
    super(message)
    this.name = 'PhotoScanError'
    this.failure = failure
  }
}

/** A decoded photo: what the native detector and the pixel grabber both read. */
export interface PhotoImage {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
  release: () => void
}

interface ScanBarcodeOptions {
  openImage?: (file: Blob) => Promise<PhotoImage>
  grabRegions?: (source: PhotoImage['source'], width: number, height: number) => PixelRegions
  getNativeBarcodeDetector?: () => unknown
  acquireClient?: () => DecodeClient
}

async function openPhoto(file: Blob): Promise<PhotoImage> {
  // createImageBitmap decodes off the main thread and needs no data URL.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch (_) {
      // Some Safari/HEIC combinations expose the function and still reject the
      // decode; the DOM image decoder below takes those.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new PhotoScanError('unreadable', 'Unable to open the selected image.'))
      image.src = url
    })
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function detectWithNativeBarcodeDetector(source: PhotoImage['source'], options: ScanBarcodeOptions): Promise<string> {
  const BarcodeDetectorCtor = options.getNativeBarcodeDetector
    ? options.getNativeBarcodeDetector()
    : (globalThis as { BarcodeDetector?: unknown })?.BarcodeDetector
  if (typeof BarcodeDetectorCtor !== 'function') return ''

  try {
    const NativeDetector = BarcodeDetectorCtor as NativeBarcodeDetectorConstructor
    const supported = typeof NativeDetector.getSupportedFormats === 'function' ? await NativeDetector.getSupportedFormats() : null
    // A detector that reads none of our formats can never answer; the decoder is the only way.
    const formats = planNativeFormats(supported)
    if (!formats.length) return ''
    const results = await new NativeDetector({ formats }).detect(source)
    const read = (results || [])
      .map((result) => ({ text: String(result?.rawValue || '').trim(), format: String(result?.format || '') }))
      .find((candidate) => isAcceptableBarcodeRead(candidate))
    return read?.text || ''
  } catch (error) {
    // A native detector that throws is treated like one that saw nothing: the
    // decoder still reads the photo.
    console.error('[scanner] The native detector could not read the photo; using the ZXing decoder.', error)
    return ''
  }
}

export async function scanBarcodeFromImageFile(file: unknown, options: ScanBarcodeOptions = {}): Promise<string> {
  if (!file) throw new PhotoScanError('no-photo', 'Choose a photo before scanning.')

  const image = await (options.openImage || openPhoto)(file as Blob)
  try {
    const nativeValue = await detectWithNativeBarcodeDetector(image.source, options)
    if (nativeValue) return nativeValue

    // A still photo can afford the whole ladder, TRY_HARDER included: the
    // person is already waiting on "Reading photo...", and it runs in the
    // worker, so the page stays responsive.
    const grabRegions = options.grabRegions || ((source, width, height) => createFrameGrabber()(source, width, height))
    const regions = grabRegions(image.source, image.width, image.height)
    const frames = { centre: regions.centre(), full: regions.full() }
    const client = (options.acquireClient || acquireDecodeClient)()
    try {
      await client.ready
      const read = await client.decode(frames, true)
      if (!read) throw new PhotoScanError('no-barcode', 'We could not find a barcode in that photo.')
      return read.text.trim()
    } finally {
      client.terminate()
    }
  } finally {
    image.release()
  }
}

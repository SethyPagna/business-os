import {
  RETAIL_BARCODE_FORMATS,
  createFrameGrabber,
  isAcceptableBarcodeRead,
  loadLumaDecoder,
  runDecodeLadder,
  type FrameRegions,
  type LumaDecoder,
} from './barcodeFrameDecoder.ts'

interface BarcodeImageElement {
  naturalWidth?: number
  naturalHeight?: number
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  src: string
}

interface BarcodeDetectorResult {
  rawValue?: unknown
  format?: unknown
}

interface NativeBarcodeDetector {
  detect(image: BarcodeImageElement): Promise<BarcodeDetectorResult[]>
}

interface NativeBarcodeDetectorConstructor {
  new(options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<unknown[]>
}

interface ScanBarcodeOptions {
  readDataUrl?: (file: unknown) => Promise<string> | string
  loadDecoder?: () => Promise<LumaDecoder>
  grabRegions?: (image: BarcodeImageElement, width: number, height: number) => FrameRegions
  createImage?: () => BarcodeImageElement
  getNativeBarcodeDetector?: () => unknown
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read the selected image.'))
    reader.readAsDataURL(file)
  })
}

function createImageElement(): BarcodeImageElement {
  return new Image()
}

async function loadImageSource(image: BarcodeImageElement, src: string): Promise<BarcodeImageElement> {
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Unable to open the selected image.'))
    image.src = src
  })
  return image
}

async function detectWithNativeBarcodeDetector(
  image: BarcodeImageElement,
  options: ScanBarcodeOptions = {},
): Promise<string> {
  const BarcodeDetectorCtor = options.getNativeBarcodeDetector
    ? options.getNativeBarcodeDetector()
    : (globalThis as { BarcodeDetector?: unknown })?.BarcodeDetector
  if (typeof BarcodeDetectorCtor !== 'function') return ''

  try {
    const NativeDetector = BarcodeDetectorCtor as NativeBarcodeDetectorConstructor
    const supportedFormats = typeof NativeDetector.getSupportedFormats === 'function'
      ? await NativeDetector.getSupportedFormats()
      : RETAIL_BARCODE_FORMATS
    const formats = (supportedFormats || [])
      .map((format) => String(format || ''))
      .filter((format) => RETAIL_BARCODE_FORMATS.includes(format))
    const detector = new NativeDetector({ formats: formats.length ? formats : RETAIL_BARCODE_FORMATS })
    const results = await detector.detect(image)
    const read = (results || [])
      .map((result) => ({ text: String(result?.rawValue || '').trim(), format: String(result?.format || '') }))
      .find((candidate) => isAcceptableBarcodeRead(candidate))
    return read?.text || ''
  } catch (_) {
    // A native detector that throws is treated like one that saw nothing:
    // the ZXing ladder below still reads the photo.
    return ''
  }
}

export async function scanBarcodeFromImageFile(file: unknown, options: ScanBarcodeOptions = {}): Promise<string> {
  if (!file) throw new Error('Choose a photo before scanning.')

  const readDataUrl = options.readDataUrl || ((input: unknown) => readFileAsDataUrl(input as Blob))
  const loadDecoder = options.loadDecoder || (() => loadLumaDecoder())
  const grabRegions = options.grabRegions
    || ((image: BarcodeImageElement, width: number, height: number) => (
      createFrameGrabber()(image as unknown as CanvasImageSource, width, height)
    ))
  const createImage = options.createImage || createImageElement

  const dataUrl = await readDataUrl(file)
  if (!String(dataUrl || '').trim()) {
    throw new Error('Unable to read that photo right now.')
  }

  const image = await loadImageSource(createImage(), dataUrl)
  const nativeValue = await detectWithNativeBarcodeDetector(image, options)
  if (nativeValue) return nativeValue

  // A still photo can afford the whole ladder, TRY_HARDER included: the
  // person is already waiting on "Reading photo...".
  const decode = await loadDecoder()
  const regions = grabRegions(image, Number(image.naturalWidth || 0), Number(image.naturalHeight || 0))
  const { read } = runDecodeLadder(regions, decode, { tryHarder: true })
  if (!read) throw new Error('We could not find a barcode in that photo.')
  return read.text.trim()
}

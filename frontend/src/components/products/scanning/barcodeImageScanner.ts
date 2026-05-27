interface BarcodeImageElement {
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  onerror: ((this: GlobalEventHandlers, ev: Event) => unknown) | null
  src: string
}

interface BarcodeDetectorResult {
  rawValue?: unknown
}

interface NativeBarcodeDetector {
  detect(image: BarcodeImageElement): Promise<BarcodeDetectorResult[]>
}

interface NativeBarcodeDetectorConstructor {
  new(options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<unknown[]>
}

interface ZxingReader {
  decodeFromImageElement(image: BarcodeImageElement): Promise<{
    getText?: () => unknown
  } | null>
}

interface ZxingModule {
  BrowserMultiFormatReader: new() => ZxingReader
}

interface ScanBarcodeOptions {
  readDataUrl?: (file: unknown) => Promise<string> | string
  loadZxingModule?: () => Promise<ZxingModule>
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

const KNOWN_FORMATS = [
  'aztec',
  'codabar',
  'code_128',
  'code_39',
  'code_93',
  'data_matrix',
  'ean_13',
  'ean_8',
  'itf',
  'pdf417',
  'qr_code',
  'upc_a',
  'upc_e',
]

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
      : KNOWN_FORMATS
    const formats = (supportedFormats || [])
      .map((format) => String(format || ''))
      .filter((format) => KNOWN_FORMATS.includes(format))
    const detector = new NativeDetector({ formats: formats.length ? formats : KNOWN_FORMATS })
    const results = await detector.detect(image)
    const value = String(results?.[0]?.rawValue || '').trim()
    return value
  } catch (_) {
    return ''
  }
}

export async function scanBarcodeFromImageFile(file: unknown, options: ScanBarcodeOptions = {}): Promise<string> {
  if (!file) throw new Error('Choose a photo before scanning.')

  const readDataUrl = options.readDataUrl || ((input: unknown) => readFileAsDataUrl(input as Blob))
  const loadZxingModule: () => Promise<ZxingModule> = options.loadZxingModule
    || (async () => (await import('@zxing/browser')) as unknown as ZxingModule)
  const createImage = options.createImage || createImageElement

  const dataUrl = await readDataUrl(file)
  if (!String(dataUrl || '').trim()) {
    throw new Error('Unable to read that photo right now.')
  }

  const image = await loadImageSource(createImage(), dataUrl)
  const nativeValue = await detectWithNativeBarcodeDetector(image, options)
  if (nativeValue) return nativeValue

  const { BrowserMultiFormatReader } = await loadZxingModule()
  const reader = new BrowserMultiFormatReader()
  const result = await reader.decodeFromImageElement(image)
  const value = String(result?.getText?.() || '').trim()
  if (!value) throw new Error('We could not find a barcode in that photo.')
  return value
}

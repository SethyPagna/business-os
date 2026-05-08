function readFileAsDataUrl(file) {
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

function createImageElement() {
  return new Image()
}

async function loadImageSource(image, src) {
  await new Promise((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Unable to open the selected image.'))
    image.src = src
  })
  return image
}

async function detectWithNativeBarcodeDetector(image, options = {}) {
  const BarcodeDetectorCtor = options.getNativeBarcodeDetector
    ? options.getNativeBarcodeDetector()
    : globalThis?.BarcodeDetector
  if (typeof BarcodeDetectorCtor !== 'function') return ''

  try {
    const supportedFormats = typeof BarcodeDetectorCtor.getSupportedFormats === 'function'
      ? await BarcodeDetectorCtor.getSupportedFormats()
      : KNOWN_FORMATS
    const formats = (supportedFormats || []).filter((format) => KNOWN_FORMATS.includes(format))
    const detector = new BarcodeDetectorCtor({ formats: formats.length ? formats : KNOWN_FORMATS })
    const results = await detector.detect(image)
    const value = String(results?.[0]?.rawValue || '').trim()
    return value
  } catch (_) {
    return ''
  }
}

export async function scanBarcodeFromImageFile(file, options = {}) {
  if (!file) throw new Error('Choose a photo before scanning.')

  const readDataUrl = options.readDataUrl || readFileAsDataUrl
  const loadZxingModule = options.loadZxingModule || (() => import('@zxing/browser'))
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

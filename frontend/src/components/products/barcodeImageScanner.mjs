function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read the selected image.'))
    reader.readAsDataURL(file)
  })
}

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

export async function scanBarcodeFromImageFile(file, options = {}) {
  if (!file) throw new Error('Choose a photo before scanning.')

  const readDataUrl = options.readDataUrl || readFileAsDataUrl
  const loadZxingModule = options.loadZxingModule || (() => import('@zxing/browser'))
  const createImage = options.createImage || createImageElement

  const dataUrl = await readDataUrl(file)
  if (!String(dataUrl || '').trim()) {
    throw new Error('Unable to read that photo right now.')
  }

  const { BrowserMultiFormatReader } = await loadZxingModule()
  const reader = new BrowserMultiFormatReader()
  const image = await loadImageSource(createImage(), dataUrl)
  const result = await reader.decodeFromImageElement(image)
  const value = String(result?.getText?.() || '').trim()
  if (!value) throw new Error('We could not find a barcode in that photo.')
  return value
}

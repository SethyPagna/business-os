export const PRINT_DEFAULTS = {
  paperSize: '80mm',
  marginTop: '4',
  marginRight: '4',
  marginBottom: '4',
  marginLeft: '4',
  scale: '100',
  customWidth: '80',
  customHeight: '297',
}

function parsePrintNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const RECEIPT_INLINE_STYLE_PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'box-sizing',
  'overflow',
  'overflow-x',
  'overflow-y',
  'background',
  'background-color',
  'color',
  'opacity',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'word-break',
  'word-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'object-fit',
  'object-position',
  'transform',
  'transform-origin',
]

function cloneElementWithInlineStyles(node) {
  if (!node || !(node instanceof HTMLElement)) return null

  const cloned = node.cloneNode(true)
  const sourceElements = [node, ...node.querySelectorAll('*')]
  const clonedElements = [cloned, ...cloned.querySelectorAll('*')]

  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceEl = sourceElements[index]
    const clonedEl = clonedElements[index]
    if (!(sourceEl instanceof HTMLElement) || !(clonedEl instanceof HTMLElement)) continue

    const computed = window.getComputedStyle(sourceEl)
    const styleText = RECEIPT_INLINE_STYLE_PROPS
      .map((prop) => `${prop}:${computed.getPropertyValue(prop)};`)
      .join('')
    const existing = clonedEl.getAttribute('style') || ''
    clonedEl.setAttribute('style', `${existing}${existing ? ';' : ''}${styleText}`)
  }

  return cloned
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read receipt asset'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

async function inlineImageNodeSources(root) {
  if (!root || !(root instanceof HTMLElement)) return
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(images.map(async (image) => {
    const src = String(image.getAttribute('src') || '').trim()
    if (!src || /^data:/i.test(src)) return
    try {
      const absoluteSrc = new URL(src, window.location.href).toString()
      const response = await fetch(absoluteSrc, {
        mode: 'cors',
        credentials: absoluteSrc.startsWith(window.location.origin) ? 'same-origin' : 'omit',
      })
      if (!response.ok) throw new Error(`Image fetch failed with ${response.status}`)
      const blob = await response.blob()
      const dataUrl = await blobToDataUrl(blob)
      image.setAttribute('src', dataUrl)
    } catch (_) {
      image.removeAttribute('src')
      image.style.visibility = 'hidden'
    }
  }))
}

function mmToPt(mm) {
  return mm * (72 / 25.4)
}

function dataUrlToBytes(dataUrl) {
  const [, base64 = ''] = String(dataUrl || '').split(',')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function joinPdfChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    out.set(chunk, offset)
    offset += chunk.length
  })
  return out
}

function buildPdfStream(dict, bodyBytes) {
  const encoder = new TextEncoder()
  return joinPdfChunks([
    encoder.encode(`${dict}\nstream\n`),
    bodyBytes,
    encoder.encode('\nendstream'),
  ])
}

function buildSingleImagePdf({ imageBytes, imageWidthPx, imageHeightPx, pageWidthPt, title = 'Receipt' }) {
  const encoder = new TextEncoder()
  const pageHeightPt = Math.max(36, pageWidthPt * (imageHeightPx / imageWidthPx))
  const safeTitle = String(title || 'Receipt').replace(/[()\\]/g, '')
  const content = encoder.encode(`q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ`)

  const objects = [
    encoder.encode(`<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`),
    encoder.encode(`<< /Type /Pages /Count 1 /Kids [3 0 R] >>`),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources 4 0 R /Contents 6 0 R >>`),
    encoder.encode(`<< /ProcSet [/PDF /ImageC] /XObject << /Im0 5 0 R >> >>`),
    buildPdfStream(`<< /Type /XObject /Subtype /Image /Width ${imageWidthPx} /Height ${imageHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>`, imageBytes),
    buildPdfStream(`<< /Length ${content.length} >>`, content),
    encoder.encode(`<< /Title (${safeTitle}) >>`),
  ]

  const chunks = [encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')]
  const offsets = [0]
  let position = chunks[0].length

  objects.forEach((objectBytes, index) => {
    offsets.push(position)
    const objectHeader = encoder.encode(`${index + 1} 0 obj\n`)
    const objectFooter = encoder.encode('\nendobj\n')
    chunks.push(objectHeader, objectBytes, objectFooter)
    position += objectHeader.length + objectBytes.length + objectFooter.length
  })

  const xrefOffset = position
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (let index = 1; index < offsets.length; index += 1) {
    xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `)
  }
  chunks.push(encoder.encode(`${xrefLines.join('\n')}\n`))
  chunks.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`))
  return joinPdfChunks(chunks)
}

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrapTextLine(text, maxChars = 54) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ['']
  const words = clean.split(' ')
  const lines = []
  let current = ''
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) {
      current = next
      return
    }
    if (current) lines.push(current)
    current = word.length > maxChars ? word.slice(0, maxChars) : word
  })
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function buildTextOnlyPdf({ lines, pageWidthPt, title = 'Receipt' }) {
  const encoder = new TextEncoder()
  const safeTitle = String(title || 'Receipt').replace(/[()\\]/g, '')
  const margin = 18
  const fontSize = 9
  const lineHeight = 12
  const preparedLines = (Array.isArray(lines) ? lines : [''])
    .flatMap((line) => wrapTextLine(line, 54))
    .slice(0, 260)

  const pageHeightPt = Math.max(72, margin * 2 + preparedLines.length * lineHeight + 12)
  const startY = pageHeightPt - margin - fontSize
  const contentLines = ['BT', `/F1 ${fontSize} Tf`, `${margin} ${startY.toFixed(2)} Td`]

  preparedLines.forEach((line, index) => {
    const escaped = escapePdfText(line)
    contentLines.push(`(${escaped}) Tj`)
    if (index < preparedLines.length - 1) contentLines.push(`0 -${lineHeight} Td`)
  })
  contentLines.push('ET')

  const content = encoder.encode(contentLines.join('\n'))
  const objects = [
    encoder.encode(`<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`),
    encoder.encode(`<< /Type /Pages /Count 1 /Kids [3 0 R] >>`),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources 4 0 R /Contents 5 0 R >>`),
    encoder.encode(`<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>`),
    buildPdfStream(`<< /Length ${content.length} >>`, content),
    encoder.encode(`<< /Title (${safeTitle}) >>`),
  ]

  const chunks = [encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')]
  const offsets = [0]
  let position = chunks[0].length

  objects.forEach((objectBytes, index) => {
    offsets.push(position)
    const objectHeader = encoder.encode(`${index + 1} 0 obj\n`)
    const objectFooter = encoder.encode('\nendobj\n')
    chunks.push(objectHeader, objectBytes, objectFooter)
    position += objectHeader.length + objectBytes.length + objectFooter.length
  })

  const xrefOffset = position
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (let index = 1; index < offsets.length; index += 1) {
    xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `)
  }
  chunks.push(encoder.encode(`${xrefLines.join('\n')}\n`))
  chunks.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`))
  return joinPdfChunks(chunks)
}

function buildReceiptFileName(title = 'receipt') {
  const safeBase = String(title || 'receipt')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${safeBase || 'receipt'}.pdf`
}

async function waitForElementAssets(element) {
  const imageWaiters = Array.from(element.querySelectorAll('img')).map((img) => {
    if (img.complete) return Promise.resolve()
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true })
      img.addEventListener('error', resolve, { once: true })
    })
  })

  try {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, 2000)),
      ])
    }
  } catch (_) {}

  if (imageWaiters.length) {
    await Promise.race([
      Promise.all(imageWaiters),
      new Promise((resolve) => window.setTimeout(resolve, 2500)),
    ])
  }

  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

async function renderElementToCanvas(element) {
  await waitForElementAssets(element)

  const rect = element.getBoundingClientRect()
  const width = Math.max(
    1,
    Math.ceil(rect.width || element.offsetWidth || element.scrollWidth || 320),
  )
  const height = Math.max(
    1,
    Math.ceil(element.scrollHeight || rect.height || element.offsetHeight || 200),
  )
  const scale = Math.min(2.25, Math.max(1.5, window.devicePixelRatio || 1.75))
  const cloned = cloneElementWithInlineStyles(element)
  if (!cloned) throw new Error('Receipt preview element is unavailable')
  await inlineImageNodeSources(cloned)
  const markup = cloned.outerHTML
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#ffffff;overflow:hidden;">
          ${markup}
        </div>
      </foreignObject>
    </svg>
  `

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = 'sync'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to rasterize receipt layout'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas rendering unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.scale(scale, scale)
    context.drawImage(image, 0, 0, width, height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function withReceiptElement(content, widthMm, action, printSettings = getPrintSettings()) {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${widthMm}mm`
  host.style.maxWidth = `${widthMm}mm`
  host.style.background = '#fff'
  host.style.boxSizing = 'border-box'
  host.style.padding = `${Math.max(0, parsePrintNumber(printSettings.marginTop, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginRight, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginBottom, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginLeft, 4))}mm`
  host.style.pointerEvents = 'none'
  const inner = document.createElement('div')
  inner.style.width = '100%'
  inner.style.transformOrigin = 'top left'
  const scaleFactor = Math.max(0.5, Math.min(1.5, parsePrintNumber(printSettings.scale, 100) / 100))
  if (scaleFactor !== 1) {
    inner.style.transform = `scale(${scaleFactor})`
    inner.style.width = `${100 / scaleFactor}%`
  }
  if (typeof HTMLElement !== 'undefined' && content instanceof HTMLElement) {
    inner.innerHTML = cloneElementWithInlineStyles(content)?.outerHTML || ''
  } else {
    inner.innerHTML = String(content || '')
  }
  host.appendChild(inner)
  document.body.appendChild(host)
  try {
    if (scaleFactor !== 1) {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
      const rect = inner.getBoundingClientRect()
      host.style.minHeight = `${Math.ceil(rect.height)}px`
    }
    return await action(host)
  } finally {
    host.remove()
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return url
}

export function getPrintSettings() {
  try {
    return { ...PRINT_DEFAULTS, ...JSON.parse(localStorage.getItem('bos_print_settings') || '{}') }
  } catch {
    return { ...PRINT_DEFAULTS }
  }
}

export function savePrintSettings(settings) {
  try {
    localStorage.setItem('bos_print_settings', JSON.stringify(settings))
  } catch (_) {}
}

export function getPaperWidthMm(settings = getPrintSettings()) {
  if (settings.paperSize === 'custom') return Math.max(40, parseFloat(settings.customWidth || '80') || 80)
  if (settings.paperSize === '58mm') return 58
  if (settings.paperSize === '72mm') return 72
  if (settings.paperSize === '80mm') return 80
  if (settings.paperSize === 'A4') return 210
  if (settings.paperSize === 'letter') return 216
  return 80
}

export async function createReceiptPdfBlob(content, options = {}) {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  const title = options.title || 'Receipt'
  const pageWidthPt = mmToPt(widthMm)

  const renderPdfBlob = async () => {
    const canvas = await withReceiptElement(content, widthMm, renderElementToCanvas, printSettings)
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.98)
    const jpegBytes = dataUrlToBytes(jpegUrl)
    const pdfBytes = buildSingleImagePdf({
      imageBytes: jpegBytes,
      imageWidthPx: canvas.width,
      imageHeightPx: canvas.height,
      pageWidthPt,
      title,
    })
    return new Blob([pdfBytes], { type: 'application/pdf' })
  }

  try {
    return await renderPdfBlob()
  } catch (firstError) {
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180))
      return await renderPdfBlob()
    } catch (secondError) {
      throw new Error(
        secondError?.message
        || firstError?.message
        || 'Unable to render receipt PDF. Please try again after the receipt preview finishes loading.',
      )
    }
  }
}

export async function downloadReceiptPdf(content, options = {}) {
  const blob = await createReceiptPdfBlob(content, options)
  const fileName = buildReceiptFileName(options.fileName || options.title || 'receipt')
  const url = downloadBlob(blob, fileName)
  return { blob, fileName, url }
}

export async function openReceiptPdf(content, options = {}) {
  const blob = await createReceiptPdfBlob(content, options)
  const fileName = buildReceiptFileName(options.fileName || options.title || 'receipt')
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    downloadBlob(blob, fileName)
    return { blob, fileName, url, opened: false }
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { blob, fileName, url, opened: true }
}

export function printReceipt(content, options = {}) {
  const printSettings = getPrintSettings()
  return openReceiptPdf(content, {
    ...options,
    printSettings,
    title: options.title || 'Receipt',
    fileName: options.fileName || options.title || 'receipt',
  })
}

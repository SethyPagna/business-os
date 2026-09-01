import {
  DEFAULT_RECEIPT_PRINT_SETTINGS,
  normalizeReceiptPrintSettings,
  RECEIPT_PRINT_SETTINGS_STORAGE_KEY,
} from './receiptAppliedConfig'
import type { ReceiptPrintSettings } from '../types/receiptContracts'

export const PRINT_DEFAULTS = { ...DEFAULT_RECEIPT_PRINT_SETTINGS }
const RECEIPT_ASSET_INLINE_CONCURRENCY = 3

type ReceiptContent = string | HTMLElement
type ReceiptSourceSettings = {
  receipt_print_settings?: unknown
}
type ReceiptPrintOptions = {
  printSettings?: ReceiptPrintSettings
  paperWidthMm?: number
  title?: string
  note?: string
  autoPrint?: boolean
  fileName?: string
  allowTextFallback?: boolean
  preferTextOnly?: boolean
  previewFallback?: boolean
  autoPrintOnPreviewFallback?: boolean
  previewFallbackNote?: string
}
type ByteChunk = Uint8Array<ArrayBufferLike>
type ImagePdfInput = {
  imageBytes: ByteChunk
  imageWidthPx: number
  imageHeightPx: number
  pageWidthPt: number
  pageHeightPt?: number
  title?: string
}
type TextPdfInput = {
  lines: unknown[]
  pageWidthPt: number
  pageHeightPt?: number
  title?: string
}
type ReceiptFallbackLine = {
  text: string
  kind: 'text' | 'center' | 'row' | 'item'
}

type PrintableReceiptLayout = {
  markup: string
  widthMm: number
  pageHeightMm: number
  continuousRoll: boolean
}

function parsePrintNumber(value: unknown, fallback: number): number {
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

function cloneElementWithInlineStyles(node: unknown): HTMLElement | null {
  if (!node || !(node instanceof HTMLElement)) return null

  const cloned = node.cloneNode(true) as HTMLElement
  const sourceElements = [node, ...Array.from(node.querySelectorAll('*'))]
  const clonedElements = [cloned, ...Array.from(cloned.querySelectorAll('*'))]

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

export function normalizeReceiptContentWidth<T>(root: T): T {
  if (!root || !(root instanceof HTMLElement)) return root
  const nodes = [
    ...(root.matches?.('[data-receipt-export-root="true"]') ? [root] : []),
    ...Array.from(root.querySelectorAll('[data-receipt-export-root="true"]')),
  ]

  nodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    node.style.width = '100%'
    node.style.maxWidth = '100%'
    node.style.minWidth = '0'
    node.style.marginLeft = 'auto'
    node.style.marginRight = 'auto'
    node.style.boxSizing = 'border-box'
    node.style.overflowX = 'hidden'
    node.style.wordBreak = 'break-word'
    node.style.overflowWrap = 'anywhere'
  })

  return root
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read receipt asset'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

async function mapReceiptAssets<T>(items: Iterable<T> | ArrayLike<T> | null | undefined, worker: (item: T, index: number) => Promise<void> | void): Promise<void> {
  const list = Array.from(items || [])
  if (!list.length) return
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(RECEIPT_ASSET_INLINE_CONCURRENCY, list.length) }, async () => {
    while (nextIndex < list.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(list[index], index)
    }
  })
  await Promise.all(workers)
}

async function inlineImageNodeSources(root: unknown): Promise<void> {
  if (!root || !(root instanceof HTMLElement)) return
  const images = Array.from(root.querySelectorAll('img'))
  await mapReceiptAssets(images, async (image) => {
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
  })
}

function extractUrlsFromCssValue(value: unknown): string[] {
  return Array.from(String(value || '').matchAll(/url\((['"]?)(.*?)\1\)/gi))
    .map((match) => String(match[2] || '').trim())
    .filter(Boolean)
}

async function inlineStyleAssetUrls(root: unknown): Promise<void> {
  if (!root || !(root instanceof HTMLElement)) return
  const nodes = [root, ...Array.from(root.querySelectorAll('*'))]
  await mapReceiptAssets(nodes, async (node) => {
    if (!(node instanceof HTMLElement)) return
    const style = node.getAttribute('style') || ''
    const urls = extractUrlsFromCssValue(style)
    if (!urls.length) return

    let nextStyle = style
    for (const src of urls) {
      if (/^data:/i.test(src)) continue
      try {
        const absoluteSrc = new URL(src, window.location.href).toString()
        const response = await fetch(absoluteSrc, {
          mode: 'cors',
          credentials: absoluteSrc.startsWith(window.location.origin) ? 'same-origin' : 'omit',
        })
        if (!response.ok) throw new Error(`Asset fetch failed with ${response.status}`)
        const blob = await response.blob()
        const dataUrl = await blobToDataUrl(blob)
        nextStyle = nextStyle.split(src).join(dataUrl)
      } catch (_) {
        const escaped = String(src).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        nextStyle = nextStyle
          .replace(new RegExp(`background-image\\s*:\\s*url\\((['"]?)${escaped}\\1\\)\\s*;?`, 'gi'), 'background-image:none;')
          .replace(new RegExp(`background\\s*:[^;]*url\\((['"]?)${escaped}\\1\\)[^;]*;?`, 'gi'), 'background:none;')
      }
    }

    node.setAttribute('style', nextStyle)
  })
}

function normalizePrintableRoot(root: unknown, widthMm: number): HTMLElement | null {
  if (!root || !(root instanceof HTMLElement)) return null
  root.style.position = 'static'
  root.style.left = 'auto'
  root.style.top = 'auto'
  root.style.right = 'auto'
  root.style.bottom = 'auto'
  root.style.pointerEvents = 'auto'
  root.style.width = `${widthMm}mm`
  root.style.maxWidth = `${widthMm}mm`
  root.style.minHeight = '0'
  // Print is anchored to the physical paper origin. Centering is useful in
  // the on-screen preview, but on a printer it can combine with driver
  // unprintable-area offsets and clip the left edge of narrow thermal paper.
  root.style.margin = '0'
  root.style.boxSizing = 'border-box'
  root.style.overflow = 'visible'
  root.style.background = '#ffffff'
  return root
}

function mmToPt(mm: number): number {
  return mm * (72 / 25.4)
}

function dataUrlToBytes(dataUrl: unknown): Uint8Array {
  const [, base64 = ''] = String(dataUrl || '').split(',')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBlobPart(bytes: ByteChunk): BlobPart {
  return Uint8Array.from(bytes)
}

function joinPdfChunks(chunks: ByteChunk[]): ByteChunk {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    out.set(chunk, offset)
    offset += chunk.length
  })
  return out
}

function buildPdfStream(dict: string, bodyBytes: ByteChunk): ByteChunk {
  const encoder = new TextEncoder()
  return joinPdfChunks([
    encoder.encode(`${dict}\nstream\n`),
    bodyBytes,
    encoder.encode('\nendstream'),
  ])
}

function buildSingleImagePdf({ imageBytes, imageWidthPx, imageHeightPx, pageWidthPt, pageHeightPt: fixedHeightPt, title = 'Receipt' }: ImagePdfInput): ByteChunk {
  const encoder = new TextEncoder()
  const contentHeightPt = pageWidthPt * (imageHeightPx / imageWidthPx)
  // Continuous-roll thermal paper (58/72/80mm) has no fixed length, so the
  // page just wraps the content. Fixed-sheet formats (A4/Letter/custom with
  // an explicit height) pass a minimum height here so a short receipt still
  // gets a full-size page instead of a tiny sliver -- while a receipt longer
  // than the sheet still renders in full rather than being cut off.
  const pageHeightPt = Math.max(36, fixedHeightPt || 0, contentHeightPt)
  const safeTitle = String(title === '' ? '' : (title || 'Receipt')).replace(/[()\\]/g, '')
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

  const chunks: ByteChunk[] = [encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')]
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

function escapePdfText(value: unknown): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrapTextLine(text: unknown, maxChars = 54): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ['']
  const words = clean.split(' ')
  const lines: string[] = []
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

function buildTextOnlyPdf({ lines, pageWidthPt, pageHeightPt: fixedHeightPt, title = 'Receipt' }: TextPdfInput): ByteChunk {
  const encoder = new TextEncoder()
  const safeTitle = String(title === '' ? '' : (title || 'Receipt')).replace(/[()\\]/g, '')
  const margin = 18
  const fontSize = 9
  const lineHeight = 12
  const preparedLines = (Array.isArray(lines) ? lines : [''])
    .flatMap((line) => wrapTextLine(line, 54))
    .slice(0, 260)

  const contentHeightPt = margin * 2 + preparedLines.length * lineHeight + 12
  const pageHeightPt = Math.max(72, fixedHeightPt || 0, contentHeightPt)
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

  const chunks: ByteChunk[] = [encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')]
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

function buildReceiptFileName(title = 'receipt', extension = 'pdf'): string {
  const safeBase = String(title || 'receipt')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const safeExtension = String(extension || 'pdf').replace(/^\./, '').replace(/[^a-z0-9]/gi, '') || 'pdf'
  return `${safeBase || 'receipt'}.${safeExtension}`
}

function wrapReceiptFallbackLine(line: unknown, maxChars: number): string[] {
  const textLine = String(line || '').replace(/\s+/g, ' ').trim()
  if (!textLine) return ['']
  if (!textLine.includes('\t')) return wrapTextLine(textLine, maxChars)

  const parts = textLine.split('\t').map((part) => part.trim())
  if (parts.length >= 3) {
    const [name, qty, ...priceParts] = parts
    const price = priceParts.join(' ')
    const nameWidth = Math.max(12, maxChars - 16)
    const nameLines = wrapTextLine(name, nameWidth)
    const firstLine = [nameLines[0] || '', qty || '', price || ''].join('\t')
    return [
      firstLine,
      ...nameLines.slice(1).map((continuation) => `  ${continuation}`),
    ]
  }

  const [label, value] = parts
  const labelWidth = Math.max(12, maxChars - 12)
  const labelLines = wrapTextLine(label, labelWidth)
  return [
    [labelLines[0] || '', value || ''].join('\t'),
    ...labelLines.slice(1).map((continuation) => `  ${continuation}`),
  ]
}

function classifyReceiptFallbackLine(line: unknown, index: number): ReceiptFallbackLine {
  const text = String(line || '').replace(/\s+/g, ' ').trim()
  if (!text) return { text: '', kind: 'text' }
  if (/^[=\-_.]{8,}$/.test(text)) return { text, kind: 'center' }
  if (text.includes('\t')) {
    return { text, kind: text.split('\t').length >= 3 ? 'item' : 'row' }
  }
  if (index <= 2) return { text, kind: 'center' }
  if (/thank you/i.test(text)) return { text, kind: 'center' }
  return { text, kind: 'text' }
}

function measureWrappedReceiptHeight(lines: ReceiptFallbackLine[], maxChars: number, lineHeight: number): number {
  return lines.reduce((height, line) => {
    const wrappedCount = Math.max(1, wrapReceiptFallbackLine(line.text, maxChars).length)
    const extra = line.kind === 'center' && /^[=\-_.]{8,}$/.test(line.text) ? 3 : 0
    return height + wrappedCount * lineHeight + extra
  }, 0)
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: unknown, maxWidth: number): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return ['']
  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word
    if (context.measureText(next).width <= maxWidth) {
      current = next
      return
    }
    if (current) lines.push(current)
    if (context.measureText(word).width <= maxWidth) {
      current = word
      return
    }

    let fragment = ''
    Array.from(word).forEach((char) => {
      const candidate = `${fragment}${char}`
      if (context.measureText(candidate).width <= maxWidth || !fragment) {
        fragment = candidate
        return
      }
      lines.push(fragment)
      fragment = char
    })
    current = fragment
  })

  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function drawClippedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  context.save()
  context.beginPath()
  context.rect(x, y - 1, maxWidth, lineHeight + 2)
  context.clip()
  context.fillText(text, x, y)
  context.restore()
}

function createTextOnlyReceiptCanvas(content: ReceiptContent, options: ReceiptPrintOptions = {}): HTMLCanvasElement {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  const lines = extractReceiptLines(content)
  const scale = 2
  const widthPx = Math.max(320, Math.round(widthMm * 4.2))
  const paddingX = 24
  const paddingY = 24
  const lineHeight = 18
  const fontSize = 12
  const maxChars = Math.max(28, Math.floor((widthPx - paddingX * 2) / 6.5))
  const classifiedLines = lines.map(classifyReceiptFallbackLine)
  const heightPx = Math.max(260, paddingY * 2 + measureWrappedReceiptHeight(classifiedLines, maxChars, lineHeight))

  const canvas = document.createElement('canvas')
  canvas.width = widthPx * scale
  canvas.height = heightPx * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering unavailable')

  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, widthPx, heightPx)
  context.fillStyle = '#111827'
  const fontStack = `"Noto Sans Khmer", "Khmer OS", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`
  context.font = `${fontSize}px ${fontStack}`
  context.textBaseline = 'top'

  let y = paddingY
  classifiedLines.forEach((entry, index) => {
    const wrappedLines = wrapReceiptFallbackLine(entry.text, maxChars)
    wrappedLines.forEach((line, wrappedIndex) => {
      const textLine = String(line || '')
      const isSeparator = /^[=\-_.]{8,}$/.test(textLine)
      const isTitle = index === 0
      const isCenter = entry.kind === 'center'
      if (isTitle) {
        context.font = `700 ${fontSize + 3}px ${fontStack}`
      } else if (entry.kind === 'item' || /^(total|subtotal|paid|change|discount|delivery)\b/i.test(textLine)) {
        context.font = `600 ${fontSize}px ${fontStack}`
      } else {
        context.font = `${fontSize}px ${fontStack}`
      }

      if (isSeparator) {
        context.strokeStyle = '#cbd5e1'
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(paddingX, y + 7)
        context.lineTo(widthPx - paddingX, y + 7)
        context.stroke()
        y += lineHeight
        return
      }

      if (entry.kind === 'item' && textLine.includes('\t')) {
        const parts = textLine.split('\t')
        const qtyX = widthPx - paddingX - 96
        const priceX = widthPx - paddingX
        const nameMaxWidth = Math.max(92, qtyX - paddingX - 18)
        const nameLines = wrapCanvasText(context, parts[0] || '', nameMaxWidth)
        context.textAlign = 'left'
        drawClippedText(context, nameLines[0] || '', paddingX, y, nameMaxWidth, lineHeight)
        context.textAlign = 'center'
        context.fillText(parts[1] || '', qtyX, y)
        context.textAlign = 'right'
        context.fillText(parts.slice(2).join(' ') || '', priceX, y)
        context.textAlign = 'left'
        nameLines.slice(1).forEach((continuation) => {
          y += lineHeight
          drawClippedText(context, `  ${continuation}`, paddingX, y, nameMaxWidth, lineHeight)
        })
        y += lineHeight
        return
      } else if (entry.kind === 'row' && textLine.includes('\t')) {
        const parts = textLine.split('\t')
        context.textAlign = 'left'
        context.fillText(parts[0] || '', paddingX, y)
        context.textAlign = 'right'
        context.fillText(parts.slice(1).join(' ') || '', widthPx - paddingX, y)
        context.textAlign = 'left'
      } else if (isCenter) {
        context.textAlign = 'center'
        context.fillText(textLine, widthPx / 2, y)
        context.textAlign = 'left'
      } else if (wrappedIndex > 0) {
        context.fillText(`  ${textLine}`, paddingX, y)
      } else {
        context.fillText(textLine, paddingX, y)
      }
      y += lineHeight
    })

    if (entry.kind === 'center' && /^[=\-_.]{8,}$/.test(entry.text)) {
      y += 3
    } else {
      y += 1
    }
  })

  return canvas
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob: Blob | null) => {
        if (blob) resolve(blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' }))
        else reject(new Error('Unable to render receipt image. Please try again after the preview finishes loading.'))
      }, 'image/png')
    } catch (error) {
      reject(error)
    }
  })
}

async function waitForElementAssets(element: HTMLElement): Promise<void> {
  const imageWaiters = Array.from(element.querySelectorAll('img')).map((img) => {
    if (img.complete) return Promise.resolve()
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true })
      img.addEventListener('error', () => resolve(), { once: true })
    })
  })

  try {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
      ])
    }
  } catch (_) {}

  if (imageWaiters.length) {
    await Promise.race([
      Promise.all(imageWaiters),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
    ])
  }

  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
}

async function renderElementToCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
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
  normalizeReceiptContentWidth(cloned)
  cloned.style.position = 'static'
  cloned.style.left = 'auto'
  cloned.style.top = 'auto'
  cloned.style.right = 'auto'
  cloned.style.bottom = 'auto'
  cloned.style.pointerEvents = 'auto'
  cloned.style.width = `${width}px`
  cloned.style.maxWidth = `${width}px`
  cloned.style.minHeight = '0'
  cloned.style.margin = '0'
  await inlineImageNodeSources(cloned)
  await inlineStyleAssetUrls(cloned)
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
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
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

async function withReceiptElement<T>(
  content: ReceiptContent,
  widthMm: number,
  action: (host: HTMLElement) => T | Promise<T>,
  printSettings: ReceiptPrintSettings = getPrintSettings(),
): Promise<T> {
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
    const cloned = normalizeReceiptContentWidth(cloneElementWithInlineStyles(content))
    inner.innerHTML = cloned?.outerHTML || ''
  } else {
    inner.innerHTML = String(content || '')
  }
  host.appendChild(inner)
  document.body.appendChild(host)
  try {
    if (scaleFactor !== 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const rect = inner.getBoundingClientRect()
      host.style.minHeight = `${Math.ceil(rect.height)}px`
    }
    return await action(host)
  } finally {
    host.remove()
  }
}

async function createPrintableReceiptMarkup(content: ReceiptContent, options: ReceiptPrintOptions = {}): Promise<PrintableReceiptLayout> {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  return withReceiptElement(content, widthMm, async (host) => {
    await waitForElementAssets(host)

    // Measure the COMPLETE printable host (including the configured receipt
    // margins). CSS physical units are resolved consistently inside this host,
    // so deriving mm from its actual width avoids hard-coding a px/mm ratio and
    // keeps the page height matched to the exact receipt DOM.
    const hostRect = host.getBoundingClientRect()
    const renderedWidthPx = Math.max(1, hostRect.width || host.offsetWidth || host.scrollWidth)
    const renderedHeightPx = Math.max(1, host.scrollHeight || hostRect.height || host.offsetHeight)
    const measuredHeightMm = renderedHeightPx * (widthMm / renderedWidthPx)
    const fixedHeightMm = getPaperHeightMm(printSettings)
    const continuousRoll = fixedHeightMm == null
    // A tiny tail allowance prevents sub-pixel/driver rounding from spilling a
    // one-page thermal receipt onto a second blank/cut page. It is deliberately
    // applied only to continuous rolls; fixed cards/sheets keep their exact size.
    const pageHeightMm = fixedHeightMm ?? Math.max(1, measuredHeightMm + 1)

    const clone = normalizePrintableRoot(cloneElementWithInlineStyles(host), widthMm)
    if (!clone) throw new Error('Receipt preview element is unavailable')
    // IMPORTANT: keep the host padding. Those are the user's configured print
    // margins and they belong INSIDE the 80mm paper width. The previous print
    // path zeroed this padding and then forced the nested receipt back to 80mm,
    // creating an over-wide tree that could clip on the left/right.
    normalizeReceiptContentWidth(clone)
    clone.style.width = `${widthMm}mm`
    clone.style.maxWidth = `${widthMm}mm`
    clone.style.minWidth = `${widthMm}mm`
    clone.querySelectorAll('canvas, video').forEach((node) => node.remove())
    await inlineImageNodeSources(clone)
    await inlineStyleAssetUrls(clone)
    return { markup: clone.outerHTML, widthMm, pageHeightMm, continuousRoll }
  }, printSettings)
}

function buildPrintablePreviewDocument(layout: PrintableReceiptLayout, options: ReceiptPrintOptions = {}): string {
  const { markup, widthMm, pageHeightMm } = layout
  const title = options.title === '' ? '' : (options.title || 'Receipt')
  const toolbarTitle = title || 'Receipt Preview'
  const note = options.note ? `<div class="receipt-note">${escapeHtml(options.note)}</div>` : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #eef2f7;
        color: #111827;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .receipt-shell {
        min-height: 100vh;
        padding: 24px 12px 40px;
        overflow-x: auto;
      }
      .receipt-toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0 auto 16px;
        width: min(100%, 860px);
        padding: 14px 16px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(14px);
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
      }
      .receipt-toolbar-copy {
        min-width: 0;
      }
      .receipt-toolbar-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: #0f172a;
      }
      .receipt-toolbar-subtitle {
        margin: 4px 0 0;
        font-size: 12px;
        color: #64748b;
      }
      .receipt-toolbar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .receipt-toolbar button {
        appearance: none;
        border: 1px solid rgba(37, 99, 235, 0.16);
        border-radius: 12px;
        background: #ffffff;
        color: #1d4ed8;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
        padding: 11px 14px;
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      }
      .receipt-toolbar button:hover {
        background: #eff6ff;
        border-color: rgba(37, 99, 235, 0.28);
      }
      .receipt-note {
        margin: 0 auto 14px;
        width: min(100%, 860px);
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff7ed;
        border: 1px solid #fdba74;
        color: #9a3412;
        font-size: 12px;
        line-height: 1.5;
      }
      .receipt-stage {
        display: flex;
        justify-content: center;
        max-width: 100%;
        overflow-x: auto;
        padding-bottom: 8px;
      }
      .receipt-frame {
        width: calc(${widthMm}mm + 32px);
        max-width: none;
        flex: 0 0 auto;
        padding: 16px;
        border-radius: 14px;
        background: #ffffff;
        box-shadow: 0 22px 58px rgba(15, 23, 42, 0.16);
      }
      .receipt-frame > * {
        margin: 0 auto;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      @page {
        size: ${widthMm}mm ${pageHeightMm.toFixed(2)}mm;
        margin: 0;
      }
      @media print {
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${widthMm}mm !important;
          min-width: ${widthMm}mm !important;
          max-width: ${widthMm}mm !important;
          height: ${pageHeightMm.toFixed(2)}mm !important;
          min-height: ${pageHeightMm.toFixed(2)}mm !important;
          background: #ffffff;
          overflow: visible !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .receipt-shell {
          width: ${widthMm}mm !important;
          min-width: ${widthMm}mm !important;
          max-width: ${widthMm}mm !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
        }
        .receipt-toolbar, .receipt-note { display: none !important; }
        .receipt-stage {
          display: block !important;
          width: ${widthMm}mm !important;
          max-width: ${widthMm}mm !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
        }
        .receipt-frame {
          width: ${widthMm}mm !important;
          min-width: ${widthMm}mm !important;
          max-width: ${widthMm}mm !important;
          margin: 0 !important;
          padding: 0 !important;
          border-radius: 0;
          box-shadow: none;
          overflow: visible !important;
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .receipt-frame > * {
          margin: 0 !important;
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
      }
    </style>
  </head>
  <body>
    <div class="receipt-shell">
      <div class="receipt-toolbar">
        <div class="receipt-toolbar-copy">
          <h1 class="receipt-toolbar-title">${escapeHtml(toolbarTitle)}</h1>
          <p class="receipt-toolbar-subtitle">Printable receipt preview. Use Print to print now or Save as PDF from your browser.</p>
        </div>
        <div class="receipt-toolbar-actions">
          <button type="button" data-receipt-action="print">Print / Save PDF</button>
          <button type="button" data-receipt-action="close">Close</button>
        </div>
      </div>
      ${note}
      <div class="receipt-stage">
        <div class="receipt-frame">
          ${markup}
        </div>
      </div>
    </div>
  </body>
</html>`
}

function attachPrintablePreviewActions(previewWindow: Window | null, { autoPrint = false }: { autoPrint?: boolean } = {}): void {
  if (!previewWindow?.document) return
  const doc = previewWindow.document
  const printButton = doc.querySelector('[data-receipt-action="print"]')
  const closeButton = doc.querySelector('[data-receipt-action="close"]')
  printButton?.addEventListener('click', () => previewWindow.print?.())
  closeButton?.addEventListener('click', () => previewWindow.close?.())

  if (!autoPrint) return
  const schedulePrint = () => previewWindow.setTimeout?.(() => previewWindow.print?.(), 240)
  if (doc.readyState === 'complete') schedulePrint()
  else previewWindow.addEventListener?.('load', schedulePrint, { once: true })
}

export async function openPrintableReceiptPreview(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  const layout = await createPrintableReceiptMarkup(content, options)
  const html = buildPrintablePreviewDocument(layout, options)
  const previewWindow = window.open('', '_blank')
  if (!previewWindow) throw new Error('Popup blocked. Allow popups for this page and try again.')
  previewWindow.document.open()
  previewWindow.document.write(html)
  previewWindow.document.close()
  attachPrintablePreviewActions(previewWindow, { autoPrint: !!options.autoPrint })
  previewWindow.focus?.()
  return { opened: true, mode: 'preview' }
}

function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return url
}

export function getPrintSettings(sourceSettings: ReceiptSourceSettings | null = null): ReceiptPrintSettings {
  try {
    if (sourceSettings && typeof sourceSettings === 'object' && sourceSettings.receipt_print_settings) {
      return normalizeReceiptPrintSettings(sourceSettings.receipt_print_settings)
    }
  } catch (_) {}
  try {
    return normalizeReceiptPrintSettings(JSON.parse(localStorage.getItem(RECEIPT_PRINT_SETTINGS_STORAGE_KEY) || '{}'))
  } catch {
    return { ...PRINT_DEFAULTS }
  }
}

export function savePrintSettings(settings: unknown): ReceiptPrintSettings {
  const normalized = normalizeReceiptPrintSettings(settings)
  try {
    localStorage.setItem(RECEIPT_PRINT_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  } catch (_) {}
  return normalized
}

export function getPaperWidthMm(settings: ReceiptPrintSettings = getPrintSettings()): number {
  if (settings.paperSize === 'custom') return Math.max(40, parseFloat(settings.customWidth || '80') || 80)
  if (settings.paperSize === '58mm') return 58
  if (settings.paperSize === '72mm') return 72
  if (settings.paperSize === '80mm') return 80
  if (settings.paperSize === '80x50mm') return 80
  if (settings.paperSize === 'A4') return 210
  if (settings.paperSize === 'letter') return 216
  return 80
}

/**
 * Fixed sheet length in mm for paper sizes that have a real physical height
 * (A4, Letter, or a custom size with an explicit height set). Continuous-roll
 * thermal paper (58/72/80mm) returns null -- its page length is driven by
 * the receipt content instead, which is the correct behavior for a printer
 * that feeds a roll rather than cutting fixed sheets.
 */
export function getPaperHeightMm(settings: ReceiptPrintSettings = getPrintSettings()): number | null {
  if (settings.paperSize === 'A4') return 297
  if (settings.paperSize === 'letter') return 279.4
  if (settings.paperSize === '80x50mm') return 50
  if (settings.paperSize === 'custom') {
    const parsed = parseFloat(String(settings.customHeight ?? ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

export async function createReceiptPdfBlob(content: ReceiptContent, options: ReceiptPrintOptions = {}): Promise<Blob> {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  const heightMm = getPaperHeightMm(printSettings)
  const title = options.title === '' ? '' : (options.title || 'Receipt')
  const pageWidthPt = mmToPt(widthMm)
  const pageHeightPt = heightMm != null ? mmToPt(heightMm) : undefined
  const allowTextFallback = Boolean(options.allowTextFallback || options.preferTextOnly)
  const buildTextOnlyReceiptBlob = () => {
    const fallbackLines = extractReceiptLines(content)
    const pdfBytes = buildTextOnlyPdf({
      lines: fallbackLines,
      pageWidthPt,
      pageHeightPt,
      title,
    })
    return new Blob([bytesToBlobPart(pdfBytes)], { type: 'application/pdf' })
  }

  if (options.preferTextOnly) {
    return buildTextOnlyReceiptBlob()
  }

  const renderPdfBlob = async () => {
    const canvas = await withReceiptElement(content, widthMm, renderElementToCanvas, printSettings)
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.98)
    const jpegBytes = dataUrlToBytes(jpegUrl)
    const pdfBytes = buildSingleImagePdf({
      imageBytes: jpegBytes,
      imageWidthPx: canvas.width,
      imageHeightPx: canvas.height,
      pageWidthPt,
      pageHeightPt,
      title,
    })
    return new Blob([bytesToBlobPart(pdfBytes)], { type: 'application/pdf' })
  }

  try {
    return await renderPdfBlob()
  } catch (firstError) {
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180))
      return await renderPdfBlob()
    } catch (secondError) {
      if (allowTextFallback) {
        try {
          return buildTextOnlyReceiptBlob()
        } catch (_) {}
      }
      throw new Error(
        (secondError instanceof Error ? secondError.message : '')
        || (firstError instanceof Error ? firstError.message : '')
        || 'Unable to render receipt PDF. Please try again after the receipt preview finishes loading.',
      )
    }
  }
}

export async function createReceiptImageBlob(content: ReceiptContent, options: ReceiptPrintOptions = {}): Promise<Blob> {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  try {
    const canvas = await withReceiptElement(content, widthMm, renderElementToCanvas, printSettings)
    try {
      return await canvasToPngBlob(canvas)
    } catch (_) {
      const fallbackCanvas = createTextOnlyReceiptCanvas(content, options)
      return await canvasToPngBlob(fallbackCanvas)
    }
  } catch (error) {
    const fallbackCanvas = createTextOnlyReceiptCanvas(content, options)
    try {
      return await canvasToPngBlob(fallbackCanvas)
    } catch (_) {
      throw error
    }
  }
}

function extractReceiptLines(content: ReceiptContent): string[] {
  if (typeof document === 'undefined') return []
  let root: HTMLElement | null = null
  if (typeof HTMLElement !== 'undefined' && content instanceof HTMLElement) {
    root = content.cloneNode(true) as HTMLElement
  } else {
    const holder = document.createElement('div')
    holder.innerHTML = String(content || '')
    root = holder
  }
  const textOf = (node: Element | ChildNode | null | undefined): string => String(node?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
  const elementLines = (element: HTMLElement): string[] => {
    const main = element.querySelector('[data-receipt-main="true"]')
    const sublines = Array.from(element.querySelectorAll('[data-receipt-subline="true"]'))
      .map((child) => textOf(child))
      .filter(Boolean)
    if (main || sublines.length) return [textOf(main || element.firstChild), ...sublines].filter(Boolean)

    const blockChildren = Array.from(element.children) as HTMLElement[]
    if (blockChildren.length) {
      const childLines = blockChildren
        .flatMap((child) => elementLines(child))
        .filter(Boolean)
      if (childLines.length) return childLines
    }

    return textOf(element)
      .split(/\r?\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }
  const joinColumns = (values: string[]): string => {
    const compactValues = values.map((value) => String(value || '').trim())
    if (compactValues.length >= 3) {
      const [name, qty, price] = compactValues
      return [name, qty, price].join('\t')
    }
    if (compactValues.length === 2) {
      const [label, value] = compactValues
      return [label, value].join('\t')
    }
    return compactValues.filter(Boolean).join('    ')
  }

  const markedLines = Array.from(root?.querySelectorAll?.('[data-receipt-line="true"]') || [])
    .flatMap((node) => {
      const element = node as HTMLElement
      const cells = Array.from(element.querySelectorAll(':scope > [data-receipt-cell]')) as HTMLElement[]
      if (cells.length === 3) {
        const [nameCell, qtyCell, priceCell] = cells
        const nameLines = elementLines(nameCell)
        const qtyLines = elementLines(qtyCell)
        const priceLines = elementLines(priceCell)
        return [
          joinColumns([nameLines[0] || '', qtyLines[0] || '', priceLines[0] || '']),
          ...nameLines.slice(1).map((line) => `  ${line}`),
          ...priceLines.slice(1).map((line) => `\t\t${line}`),
        ].filter(Boolean)
      }
      const childLines = Array.from(element.children)
        .map((child) => elementLines(child as HTMLElement))
        .filter((lines) => lines.length > 0)
      if (childLines.length === 3) {
        const [nameLines, qtyLines, priceLines] = childLines
        return [
          joinColumns([nameLines[0] || '', qtyLines[0] || '', priceLines[0] || '']),
          ...nameLines.slice(1).map((line) => `  ${line}`),
          ...priceLines.slice(1).map((line) => `\t\t${line}`),
        ]
      }
      if (childLines.length === 2) {
        const [labelLines, valueLines] = childLines
        const firstLabel = labelLines[0] || ''
        const firstValue = valueLines[0] || ''
        const firstLines = firstLabel.length + firstValue.length > 42
          ? [firstLabel, `\t${firstValue}`]
          : [joinColumns([firstLabel, firstValue])]
        return [
          ...firstLines,
          ...labelLines.slice(1).map((line) => `  ${line}`),
          ...valueLines.slice(1).map((line) => `\t${line}`),
        ]
      }
      if (childLines.length > 1) return [joinColumns(childLines.map((lines) => lines.join(' ')))]
      return elementLines(element)
    })
    .filter(Boolean)
  if (markedLines.length) return markedLines
  const text = String(root?.innerText || root?.textContent || '')
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return lines.length ? lines : ['Receipt preview', 'Open the PDF after it downloads to view or print it.']
}

export async function downloadReceiptPdf(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  try {
    const blob = await createReceiptPdfBlob(content, options)
    const fileName = buildReceiptFileName(options.fileName || options.title || 'receipt')
    const url = downloadBlob(blob, fileName)
    return { blob, fileName, url, mode: 'pdf' }
  } catch (error) {
    if (options.previewFallback !== false) {
      await openPrintableReceiptPreview(content, {
        ...options,
        autoPrint: options.autoPrintOnPreviewFallback ?? true,
        note: options.previewFallbackNote || 'PDF export could not be generated automatically, so a printable receipt preview was opened instead.',
      })
      return { blob: null, fileName: null, url: null, mode: 'preview-fallback' }
    }
    throw error
  }
}

export async function downloadReceiptImage(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  const blob = await createReceiptImageBlob(content, options)
  const fileName = buildReceiptFileName(options.fileName || options.title || 'receipt', '.png')
  const url = downloadBlob(blob, fileName)
  return { blob, fileName, url, mode: 'image' }
}

export async function openReceiptPdf(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  try {
    const blob = await createReceiptPdfBlob(content, options)
    const fileName = buildReceiptFileName(options.fileName || options.title || 'receipt')
    const url = URL.createObjectURL(blob)
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      downloadBlob(blob, fileName)
      return { blob, fileName, url, opened: false, mode: 'pdf' }
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return { blob, fileName, url, opened: true, mode: 'pdf' }
  } catch (error) {
    if (options.previewFallback !== false) {
      return openPrintableReceiptPreview(content, {
        ...options,
        autoPrint: false,
        note: options.previewFallbackNote || 'PDF export could not be generated automatically, so a printable receipt preview was opened instead.',
      })
    }
    throw error
  }
}

export function printReceipt(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  return openPrintableReceiptPreview(content, {
    ...options,
    printSettings: options.printSettings || getPrintSettings(),
    title: options.title === undefined ? 'Receipt' : options.title,
    autoPrint: true,
  })
}

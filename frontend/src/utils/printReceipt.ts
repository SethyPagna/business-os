import {
  DEFAULT_DRIVER_FORM_WIDTH_MM,
  DEFAULT_RECEIPT_PRINT_SETTINGS,
  normalizeReceiptPrintSettings,
  RECEIPT_PRINT_SETTINGS_STORAGE_KEY,
} from './receiptAppliedConfig.ts'
import type { ReceiptPrintSettings } from '../types/receiptContracts'
import { computeFixedSheetFit, computeImagePageSegments, computeImagePdfLayout, isSingleSheetPaperSize } from './receiptPdfLayout.ts'
import { RECEIPT_ITEM_COLUMN_GAP_EM, RECEIPT_ROW_GRID_TEMPLATE, receiptItemGridTemplate } from './receiptItemColumns.ts'
import { receiptLengthDiagnosticLine, receiptPreviewDiagnosticLines, receiptPreviewSettings, type ReceiptPreviewSettings, type ReceiptPreviewTranslate } from './receiptPreviewDiagnostics.ts'
import { appFontFaceCss, openPrintPreviewWindow, printHtmlInHiddenFrame, waitForFrameAssets } from './printSurface.ts'

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
  previewTranslate?: ReceiptPreviewTranslate
  // The preview window the CALLER opened inside the user's tap, before its own
  // awaits (Receipt.tsx lazy-loads this module first, and after that await iOS
  // no longer treats window.open as user-initiated). `null` means "this device
  // gave no second window" and selects the same-document print path;
  // `undefined` means "not a gesture-critical caller, open one here".
  previewWindow?: Window | null
  // Text colour for the last-resort text-only canvas fallback in
  // createReceiptImageBlob (used only when the primary html2canvas render of
  // the already-styled DOM clone fails). Callers pass '#000000' when the
  // receipt's Text contrast setting is 'maximum' so even that rare fallback
  // stays pure black instead of the softer default.
  textColor?: string
}
type ByteChunk = Uint8Array<ArrayBufferLike>
type ImagePdfInput = {
  imageBytes: ByteChunk
  imageWidthPx: number
  imageHeightPx: number
  pageWidthPt: number
  pageHeightPt?: number
  singleSheet?: boolean
  breakOffsetsPx?: number[]
  title?: string
}
type TextPdfInput = {
  lines: unknown[]
  pageWidthPt: number
  pageHeightPt?: number
  singleSheet?: boolean
  title?: string
  bold?: boolean
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
  /** One physical card/label: the whole receipt has to land on this one page. */
  singleSheet: boolean
  previewSettings?: ReceiptPreviewSettings
  // The owner's chosen fallback strategy for continuous-roll paper (see
  // ReceiptPrintSettings.pageSizeMode). Defaults to 'measured' so a caller
  // that builds a layout without this field (existing tests, a genuinely
  // fixed sheet) keeps today's behaviour exactly.
  pageSizeMode?: ReceiptPrintSettings['pageSizeMode']
}

// One explicit page as long as the longest continuous roll a thermal driver
// commonly exposes. Chosen as a fallback for drivers that ignore a measured
// `@page` height outright but still honour an explicit one: an owner who
// still sees a blank band or a second strip after 'measured' and 'fixed'
// have both been tried can select this as the last resort before 'driver'.
const RECEIPT_AUTO_LONGEST_PAGE_MM = 3276

function parsePrintNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

// driver-forms mode: the printer's registered form IS the printable width
// (see ReceiptPrintSettings.driverFormWidthMm), so the configured side
// margins must not also eat into it -- that double-accounting is exactly the
// "some margins left and right" the owner photographed. Cap left/right at
// 1mm. The top margin is 0: after each cut the printer already feeds about
// 11mm of blank paper (head to cutter) ahead of the receipt, and the 4mm
// setting stacked on top of it was the large top space the owner reported
// on 2026-09-23. The bottom margin (the gap before the cut) is kept.
export function capDriverFormMargins(settings: ReceiptPrintSettings): ReceiptPrintSettings {
  const cap = (value: unknown) => String(Math.min(1, Math.max(0, parsePrintNumber(value, 4))))
  return { ...settings, marginTop: '0', marginLeft: cap(settings.marginLeft), marginRight: cap(settings.marginRight) }
}

// driver-forms governs the roll and the 80x50 card printed on it (a document
// sheet keeps its own explicit paperSize width): these print at the printer's
// registered form width, not the configured roll width, so a driver that only
// registers e.g. 72mm forms prints the receipt at the paper's full width
// instead of scaling an 80mm layout down and leaving side margins.
export function printsOnPrinterPaper(settings: ReceiptPrintSettings): boolean {
  return (getPaperHeightMm(settings) == null || isSingleSheetPaperSize(settings.paperSize))
    && (settings.pageSizeMode || DEFAULT_RECEIPT_PRINT_SETTINGS.pageSizeMode) === 'driver-forms'
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

function applyHighContrastBold(root: HTMLElement, printSettings: ReceiptPrintSettings): HTMLElement {
  if (!printSettings.highContrastBold) return root
  root.setAttribute('data-receipt-high-contrast', 'true')
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  elements.forEach((element) => {
    if (!(element instanceof HTMLElement)) return
    element.style.setProperty('color', '#000000', 'important')
    element.style.setProperty('font-weight', '700', 'important')
    element.style.setProperty('opacity', '1', 'important')
    element.style.setProperty('text-shadow', 'none', 'important')
  })
  return root
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
    // The source preview deliberately hides overflow to keep its rounded
    // paper shell tidy. Carrying that clipping into the printable clone cut
    // every right-aligned value at the same edge. Printing needs semantic
    // reflow inside the paper width, never a crop.
    node.style.overflow = 'visible'
    node.style.overflowX = 'visible'
    node.style.wordBreak = 'break-word'
    node.style.overflowWrap = 'anywhere'

    // Computed styles are copied from the on-screen preview before the clone
    // is placed inside the printable content box. Browsers report computed
    // width/height values in pixels, so carrying those dimensions across
    // freezes every row at its preview size. Once a long product name wraps
    // on the narrower print surface, the frozen parent height makes the next
    // row overlap it. Let normal block/grid layout recalculate dimensions for
    // every receipt node while preserving explicit sizing for actual assets.
    node.querySelectorAll<HTMLElement>('*').forEach((descendant) => {
      if (descendant instanceof HTMLImageElement
        || descendant instanceof SVGElement
        || descendant instanceof HTMLCanvasElement
        || descendant instanceof HTMLVideoElement) return
      descendant.style.height = 'auto'
      descendant.style.minHeight = '0'
      descendant.style.maxHeight = 'none'
    })

    node.querySelectorAll<HTMLElement>('[data-receipt-line="true"]').forEach((line) => {
      line.style.width = '100%'
      line.style.minWidth = '0'
      line.style.maxWidth = '100%'
      line.style.height = 'auto'
      line.style.minHeight = '0'
      line.style.maxHeight = 'none'
      // getComputedStyle() resolves an implicit grid row to a concrete pixel
      // track (for example `16.5px`). cloneElementWithInlineStyles carries
      // that value into the printable clone. If a different paper/driver
      // width then wraps the value, clearing height alone is not enough: the
      // explicit grid track stays one line tall and the extra lines paint
      // through the following receipt rows. Restore implicit auto sizing so
      // identifiers, dates, phone numbers and Khmer money can make the row
      // grow without overlap.
      line.style.gridTemplateRows = 'none'
      line.style.overflow = 'visible'
      const hasQty = Boolean(line.querySelector('[data-receipt-cell="qty"]'))
      const hasPrice = Boolean(line.querySelector('[data-receipt-cell="price"]'))
      const hasLineTotal = Boolean(line.querySelector('[data-receipt-cell="line-total"]'))
      // Replace pixel tracks captured from the on-screen preview with tracks
      // recalculated against the actual printable content box. Count the cells
      // rather than assuming: the item table is four columns (item, qty, price,
      // total) unless a shop has turned the price column off, and a track count
      // that disagrees with the cell count silently wraps a cell onto its own
      // row on paper while looking perfect on screen.
      //
      // The tracks themselves come from utils/receiptItemColumns, the ONE
      // owner of the receipt's grid geometry. This block used to carry its own
      // copy, and that copy had already drifted from what Receipt.tsx renders
      // (3.6rem/3.2rem here against 3.9rem/3.4rem there, 4.25rem against
      // 4.6rem on the label rows) -- so a column change made in the component
      // reached the screen and never reached print, image or PDF.
      if (hasQty && hasPrice && hasLineTotal) {
        line.style.gridTemplateColumns = receiptItemGridTemplate(true)
        line.style.columnGap = `${RECEIPT_ITEM_COLUMN_GAP_EM}em`
      } else if (hasQty && (hasPrice || hasLineTotal)) {
        line.style.gridTemplateColumns = receiptItemGridTemplate(false)
        line.style.columnGap = `${RECEIPT_ITEM_COLUMN_GAP_EM}em`
      } else if (line.children.length === 2) {
        line.style.gridTemplateColumns = RECEIPT_ROW_GRID_TEMPLATE
      }
    })

    node.querySelectorAll<HTMLElement>('[data-receipt-cell="name"], [data-receipt-cell="price"], [data-receipt-cell="line-total"]')
      .forEach((cell) => {
        cell.style.minWidth = '0'
        cell.style.maxWidth = '100%'
        cell.style.height = 'auto'
        cell.style.maxHeight = 'none'
        cell.style.overflow = 'visible'
      })
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

function serializePdfObjects(objects: ByteChunk[], infoObjectId: number): ByteChunk {
  const encoder = new TextEncoder()
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
  chunks.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`))
  return joinPdfChunks(chunks)
}

export function buildSingleImagePdf({ imageBytes, imageWidthPx, imageHeightPx, pageWidthPt, pageHeightPt: fixedHeightPt, singleSheet = false, breakOffsetsPx = [], title = 'Receipt' }: ImagePdfInput): ByteChunk {
  const encoder = new TextEncoder()
  // Continuous rolls wrap the complete rendered receipt. The explicit 80x50
  // card keeps one exact MediaBox and is fitted there. Other fixed-height
  // formats are document pages: draw the raster at full paper width on as many
  // pages as it needs instead of shrinking a long receipt onto one page.
  const { pageHeightPt, drawWidthPt, drawHeightPt, drawXPt, drawYPt } = computeImagePdfLayout({
    imageWidthPx,
    imageHeightPx,
    pageWidthPt,
    fixedHeightPt: singleSheet ? fixedHeightPt : undefined,
  })
  const safeTitle = String(title === '' ? '' : (title || 'Receipt')).replace(/[()\\]/g, '')
  const documentPageHeightPt = fixedHeightPt != null && !singleSheet ? Math.max(36, fixedHeightPt) : pageHeightPt
  const pageSegments = fixedHeightPt != null && !singleSheet
    ? computeImagePageSegments({
      imageHeightPx,
      pageCapacityPx: documentPageHeightPt * imageWidthPx / pageWidthPt,
      breakOffsetsPx,
    })
    : [{ startPx: 0, endPx: imageHeightPx }]
  const pageCount = pageSegments.length
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 3 + index)
  const resourcesObjectId = 3 + pageCount
  const imageObjectId = resourcesObjectId + 1
  const firstContentObjectId = imageObjectId + 1
  const infoObjectId = firstContentObjectId + pageCount
  const pageContents = pageSegments.map((segment) => {
    const pxToPt = drawWidthPt / Math.max(1, imageWidthPx)
    const segmentHeightPt = (segment.endPx - segment.startPx) * pxToPt
    const clipY = Math.max(0, documentPageHeightPt - segmentHeightPt)
    const offsetY = pageCount === 1
      ? drawYPt
      : documentPageHeightPt - drawHeightPt + segment.startPx * pxToPt
    const clip = pageCount === 1
      ? ''
      : `0 ${clipY.toFixed(2)} ${pageWidthPt.toFixed(2)} ${segmentHeightPt.toFixed(2)} re W n\n`
    return encoder.encode(`q\n${clip}${drawWidthPt.toFixed(2)} 0 0 ${drawHeightPt.toFixed(2)} ${drawXPt.toFixed(2)} ${offsetY.toFixed(2)} cm\n/Im0 Do\nQ`)
  })
  const objects: ByteChunk[] = [
    encoder.encode(`<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`),
    encoder.encode(`<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`),
    ...pageObjectIds.map((_, pageIndex) => encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${documentPageHeightPt.toFixed(2)}] /Resources ${resourcesObjectId} 0 R /Contents ${firstContentObjectId + pageIndex} 0 R >>`)),
    encoder.encode(`<< /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageObjectId} 0 R >> >>`),
    buildPdfStream(`<< /Type /XObject /Subtype /Image /Width ${imageWidthPx} /Height ${imageHeightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>`, imageBytes),
    ...pageContents.map((content) => buildPdfStream(`<< /Length ${content.length} >>`, content)),
    encoder.encode(`<< /Title (${safeTitle}) >>`),
  ]
  return serializePdfObjects(objects, infoObjectId)
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

function buildTextOnlyPdf({ lines, pageWidthPt, pageHeightPt: fixedHeightPt, singleSheet = false, title = 'Receipt', bold = false }: TextPdfInput): ByteChunk {
  const encoder = new TextEncoder()
  const safeTitle = String(title === '' ? '' : (title || 'Receipt')).replace(/[()\\]/g, '')
  const margin = 18
  const fontSize = 9
  const lineHeight = 12
  const preparedLines = (Array.isArray(lines) ? lines : [''])
    .flatMap((line) => wrapTextLine(line, 54))
  const contentHeightPt = margin * 2 + preparedLines.length * lineHeight + 12
  const pageHeightPt = fixedHeightPt != null ? Math.max(72, fixedHeightPt) : Math.max(72, contentHeightPt)
  const fixedContentScale = fixedHeightPt != null && singleSheet
    ? Math.min(1, Math.max(0.1, (pageHeightPt - margin * 2) / Math.max(1, preparedLines.length * lineHeight + 12)))
    : 1
  const fittedFontSize = fontSize * fixedContentScale
  const fittedLineHeight = lineHeight * fixedContentScale
  const isFixedDocument = fixedHeightPt != null && !singleSheet
  const linesPerPage = isFixedDocument
    ? Math.max(1, Math.floor((pageHeightPt - margin * 2 - 12) / fittedLineHeight))
    : Math.max(1, preparedLines.length)
  const pageLines: string[][] = []
  for (let index = 0; index < Math.max(1, preparedLines.length); index += linesPerPage) {
    pageLines.push(preparedLines.slice(index, index + linesPerPage))
  }
  if (!pageLines.length) pageLines.push([''])
  const pageContents = pageLines.map((linesForPage) => {
    const startY = pageHeightPt - margin - fittedFontSize
    const contentLines = ['BT', `/F1 ${fittedFontSize.toFixed(2)} Tf`, `${margin} ${startY.toFixed(2)} Td`]
    linesForPage.forEach((line, index) => {
      contentLines.push(`(${escapePdfText(line)}) Tj`)
      if (index < linesForPage.length - 1) contentLines.push(`0 -${fittedLineHeight.toFixed(2)} Td`)
    })
    contentLines.push('ET')
    return encoder.encode(contentLines.join('\n'))
  })
  const pageCount = pageContents.length
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 3 + index)
  const resourcesObjectId = 3 + pageCount
  const firstContentObjectId = resourcesObjectId + 1
  const infoObjectId = firstContentObjectId + pageCount
  const objects: ByteChunk[] = [
    encoder.encode(`<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`),
    encoder.encode(`<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`),
    ...pageObjectIds.map((_, pageIndex) => encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Resources ${resourcesObjectId} 0 R /Contents ${firstContentObjectId + pageIndex} 0 R >>`)),
    encoder.encode(`<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /${bold ? 'Helvetica-Bold' : 'Helvetica'} >> >> >>`),
    ...pageContents.map((content) => buildPdfStream(`<< /Length ${content.length} >>`, content)),
    encoder.encode(`<< /Title (${safeTitle}) >>`),
  ]
  return serializePdfObjects(objects, infoObjectId)
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
  const defaultFontWeight = printSettings.highContrastBold ? '700 ' : ''
  const maxChars = Math.max(28, Math.floor((widthPx - paddingX * 2) / 6.5))
  const classifiedLines = lines.map(classifyReceiptFallbackLine)
  const heightPx = Math.max(260, paddingY * 2 + measureWrappedReceiptHeight(classifiedLines, maxChars, lineHeight))

  const canvas = document.createElement('canvas')
  canvas.width = widthPx * scale
  canvas.height = heightPx * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas rendering unavailable')

  // Two contrast controls stack here, newest first: the receipt template's
  // Text contrast = maximum arrives as options.textColor and forces pure
  // black, and failing that the older per-print highContrastBold switch still
  // darkens the default. Neither touches font size.
  const textColor = options.textColor || (printSettings.highContrastBold ? '#000000' : '#111827')
  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, widthPx, heightPx)
  context.fillStyle = textColor
  const fontStack = `"Noto Sans Khmer", "Khmer OS", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`
  context.font = `${defaultFontWeight}${fontSize}px ${fontStack}`
  context.textBaseline = 'top'

  let y = paddingY
  classifiedLines.forEach((entry, index) => {
    const wrappedLines = wrapReceiptFallbackLine(entry.text, maxChars)
    wrappedLines.forEach((line, wrappedIndex) => {
      const textLine = String(line || '')
      const isSeparator = /^[=\-_.]{8,}$/.test(textLine)
      const isTitle = index === 0
      const isCenter = entry.kind === 'center'
      if (printSettings.highContrastBold) {
        context.font = `700 ${isTitle ? fontSize + 3 : fontSize}px ${fontStack}`
      } else if (isTitle) {
        context.font = `700 ${fontSize + 3}px ${fontStack}`
      } else if (entry.kind === 'item' || /^(total|subtotal|paid|change|discount|delivery)\b/i.test(textLine)) {
        context.font = `600 ${fontSize}px ${fontStack}`
      } else {
        context.font = `${fontSize}px ${fontStack}`
      }

      if (isSeparator) {
        // Dividers take the same stacked rule as the text, and keep the
        // thicker 1.5px rule bold mode ships -- a weak-ink thermal printer
        // drops a 1px hairline entirely.
        context.strokeStyle = options.textColor || (printSettings.highContrastBold ? '#000000' : '#cbd5e1')
        context.lineWidth = printSettings.highContrastBold ? 1.5 : 1
        context.beginPath()
        context.moveTo(paddingX, y + 7)
        context.lineTo(widthPx - paddingX, y + 7)
        context.stroke()
        y += lineHeight
        return
      }

      if (entry.kind === 'item' && textLine.includes('\t')) {
        const parts = textLine.split('\t')
        // Four fields = item / qty / price / total (the Sep-4 layout); three =
        // the same table with the price column switched off. The right edge is
        // fixed either way, and the extra money column is carved out of the
        // name's width rather than pushed past the paper.
        const hasTotalColumn = parts.length >= 4
        const priceX = widthPx - paddingX
        const qtyX = widthPx - paddingX - (hasTotalColumn ? 150 : 96)
        const unitX = widthPx - paddingX - (hasTotalColumn ? 54 : 0)
        const nameMaxWidth = Math.max(92, qtyX - paddingX - 18)
        const nameLines = wrapCanvasText(context, parts[0] || '', nameMaxWidth)
        context.textAlign = 'left'
        drawClippedText(context, nameLines[0] || '', paddingX, y, nameMaxWidth, lineHeight)
        context.textAlign = 'center'
        context.fillText(parts[1] || '', qtyX, y)
        context.textAlign = 'right'
        if (hasTotalColumn) {
          context.fillText(parts[2] || '', unitX, y)
          context.fillText(parts.slice(3).join(' ') || '', priceX, y)
        } else {
          context.fillText(parts.slice(2).join(' ') || '', priceX, y)
        }
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

async function renderElementToCanvasResult(element: HTMLElement): Promise<{ canvas: HTMLCanvasElement; breakOffsetsPx: number[] }> {
  await waitForElementAssets(element)

  const rect = element.getBoundingClientRect()
  const width = Math.max(
    1,
    Math.ceil(rect.width || element.offsetWidth || element.scrollWidth || 320),
  )
  const sourceHeight = Math.max(
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
  // Rasterizing an SVG <foreignObject> and then calling canvas.toDataURL()
  // taints the canvas in Safari and in current Chromium builds. That made the
  // visible receipt look correct but caused Open PDF / Image to fail and fall
  // back to the browser print view. html2canvas paints the already-sanitized,
  // fully inlined clone directly, so the resulting canvas remains exportable
  // on desktop, Android PWA, and iOS PWA.
  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.position = 'fixed'
  stage.style.left = '-10000px'
  stage.style.top = '0'
  stage.style.width = `${width}px`
  stage.style.minHeight = `${sourceHeight}px`
  stage.style.height = 'auto'
  stage.style.overflow = 'visible'
  stage.style.background = '#ffffff'
  stage.style.pointerEvents = 'none'
  stage.appendChild(cloned)
  document.body.appendChild(stage)
  try {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    const renderedRect = cloned.getBoundingClientRect()
    const renderedHeight = Math.max(
      1,
      Math.ceil(cloned.scrollHeight || renderedRect.height || cloned.offsetHeight || sourceHeight),
    )
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(cloned, {
      backgroundColor: '#ffffff',
      scale,
      width,
      height: renderedHeight,
      windowWidth: width,
      windowHeight: renderedHeight,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      allowTaint: false,
      logging: false,
    })
    return {
      canvas,
      // Measure boundaries on the exact normalized clone html2canvas painted.
      // The live host can wrap one line differently after its computed styles
      // are copied, which is enough to bisect the last item on a PDF page.
      breakOffsetsPx: collectReceiptPageBreakOffsets(cloned, canvas.height),
    }
  } finally {
    stage.remove()
  }
}

async function renderElementToCanvas(element: HTMLElement): Promise<HTMLCanvasElement> {
  return (await renderElementToCanvasResult(element)).canvas
}

function collectReceiptPageBreakOffsets(element: HTMLElement, canvasHeightPx: number): number[] {
  const rootRect = element.getBoundingClientRect()
  const sourceHeightPx = Math.max(1, element.scrollHeight || rootRect.height || element.offsetHeight || 1)
  const canvasScale = canvasHeightPx / sourceHeightPx
  const offsets = new Set<number>()
  const noteBoundary = (node: Element | null | undefined, edge: 'top' | 'bottom' | 'both' = 'bottom') => {
    if (!(node instanceof HTMLElement)) return
    const rect = node.getBoundingClientRect()
    const top = Math.max(0, rect.top - rootRect.top) * canvasScale
    // Include two CSS pixels of the element's following spacing. Rasterized
    // glyph antialiasing and borders can paint just beyond getBoundingClientRect
    // by a fraction; ending exactly at `bottom` visibly shaves a baseline even
    // though the next page technically contains the remaining pixels.
    const bottom = (Math.max(0, rect.bottom - rootRect.top) + 2) * canvasScale
    if ((edge === 'top' || edge === 'both') && top > 0) offsets.add(top)
    if ((edge === 'bottom' || edge === 'both') && bottom > 0) offsets.add(bottom)
  }

  element.querySelectorAll('[data-receipt-line="true"]').forEach((node) => {
    // An item line sits inside a padded/separated wrapper. Its grid bottom is
    // not the end of the visual item, so break after the wrapper instead.
    const parent = node.parentElement
    const atomicBlock = parent?.classList.contains('py-1.5') || parent?.classList.contains('border-y-2')
      ? parent
      : node
    noteBoundary(atomicBlock)
  })

  // Keep a generated QR block together too. It has no receipt-line marker,
  // so use the top-level receipt child that owns each image as an atomic block.
  const receiptRoot = element.querySelector('[data-receipt-export-root="true"]') || element.firstElementChild
  receiptRoot?.querySelectorAll('img').forEach((image) => {
    let block: Element | null = image
    while (block?.parentElement && block.parentElement !== receiptRoot) block = block.parentElement
    noteBoundary(block, 'top')
    noteBoundary(block, 'bottom')
  })

  return Array.from(offsets).sort((a, b) => a - b)
}

async function withReceiptElement<T>(
  content: ReceiptContent,
  widthMm: number,
  action: (host: HTMLElement) => T | Promise<T>,
  printSettings: ReceiptPrintSettings = getPrintSettings(),
  { cardFromTopEdge = false }: { cardFromTopEdge?: boolean } = {},
): Promise<T> {
  const isElementContent = typeof HTMLElement !== 'undefined' && content instanceof HTMLElement
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = `${widthMm}mm`
  host.style.maxWidth = `${widthMm}mm`
  host.style.background = '#fff'
  host.style.boxSizing = 'border-box'
  const printPadding = `${Math.max(0, parsePrintNumber(printSettings.marginTop, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginRight, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginBottom, 4))}mm ${Math.max(0, parsePrintNumber(printSettings.marginLeft, 4))}mm`
  // Receipt components already own the full paper-width shell and its inner
  // padding. Applying the configured margins to the outer host as well made
  // an 80 mm receipt behave like a roughly 72 mm receipt, which was the source
  // of the excessive side margins and narrow/cropped columns. String content
  // has no shell, so it still receives the host padding.
  host.style.padding = isElementContent ? '0' : printPadding
  host.style.pointerEvents = 'none'
  const inner = document.createElement('div')
  inner.style.width = '100%'
  inner.style.transformOrigin = 'top left'
  const scaleFactor = Math.max(0.5, Math.min(1.5, parsePrintNumber(printSettings.scale, 100) / 100))
  if (scaleFactor !== 1) {
    inner.style.transform = `scale(${scaleFactor})`
    inner.style.width = `${100 / scaleFactor}%`
  }
  const fixedSheetHeightMm = getPaperHeightMm(printSettings)
  // Only a single card/label has to hold the whole receipt; A4/Letter and any
  // custom size as tall as a document page keep paginating at full size.
  const fitToOneSheet = isSingleSheetPaperSize(printSettings.paperSize)
  if (isElementContent) {
    const cloned = normalizeReceiptContentWidth(cloneElementWithInlineStyles(content))
    if (cloned) {
      // cloneElementWithInlineStyles bakes the export root's COMPUTED height,
      // i.e. its height as laid out on screen at the modal's width, not at the
      // paper's. Every paper must drop it, or the paper-width layout is
      // measured against, and printed inside, a box of the screen's height: a
      // card laid out on a phone narrower than 80mm was fitted against that
      // taller height and shrank further than its own content needs, and a
      // roll or document page carried the modal's height into the print.
      cloned.style.height = 'auto'
      cloned.style.minHeight = '0'
      cloned.style.maxHeight = 'none'
      // On continuous rolls the receipt shell's padding is the physical print
      // margin. Replace its screen-preview padding with the operator setting,
      // instead of stacking two independent margins. Fixed cards keep their
      // deliberately designed internal card padding.
      if (fixedSheetHeightMm == null) cloned.style.padding = printPadding
      // Except at the top when the card prints on the printer's paper: the
      // printer has already fed ~11mm of blank paper past the cutter, the
      // same reason the roll's top margin is 0 there (capDriverFormMargins).
      // Only the print path passes this; PDF and image keep the card as is.
      else if (cardFromTopEdge) cloned.style.paddingTop = '0'
    }
    inner.innerHTML = cloned?.outerHTML || ''
  } else {
    inner.innerHTML = String(content || '')
  }
  host.appendChild(inner)
  applyHighContrastBold(host, printSettings)
  document.body.appendChild(host)
  try {
    if (scaleFactor !== 1) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const rect = inner.getBoundingClientRect()
      host.style.minHeight = `${Math.ceil(rect.height)}px`
    }
    // Fit a fixed sheet HERE, once, so Print, PDF and Image all export the same
    // single correctly scaled page. Before this, the print document handed an
    // over-tall 80x50 card straight to `@page` and the engine broke it across
    // two pages, while the PDF rescued itself by shrinking the finished raster
    // uniformly and centering it inside side gutters -- two policies, both wrong.
    if (fixedSheetHeightMm != null && fitToOneSheet) {
      // Measure only once the fonts and images this card is made of have
      // settled. Both callers await the same helper AFTER this point, so a fit
      // computed before it would be measuring a half-laid-out card and could
      // decide a card that overflows needs no scaling at all.
      await waitForElementAssets(host)
      const hostWidthPx = Math.max(1, host.getBoundingClientRect().width || host.offsetWidth || 1)
      // Derive px/mm from the host itself rather than assuming 96dpi: CSS
      // physical units resolve consistently inside it, exactly as the page
      // measurement below already relies on.
      const pxPerMm = hostWidthPx / Math.max(0.01, widthMm)
      const contentHeightMm = Math.max(1, inner.getBoundingClientRect().height) / pxPerMm
      const fit = computeFixedSheetFit({ contentHeightMm, sheetHeightMm: fixedSheetHeightMm })
      if (!fit.fits) {
        // Render wider, then scale back down -- the same mechanism the operator
        // Scale setting uses. A transform on its own would not stop pagination:
        // it never shrinks the layout box the print engine fragments, and
        // scaling in place would leave the card narrow inside side gutters.
        const totalScale = scaleFactor * fit.scale
        inner.style.transform = `scale(${totalScale})`
        inner.style.width = `${100 / totalScale}%`
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      }
      host.style.height = `${fixedSheetHeightMm}mm`
      host.style.minHeight = `${fixedSheetHeightMm}mm`
      host.style.maxHeight = `${fixedSheetHeightMm}mm`
      host.style.overflow = 'hidden'
    }
    return await action(host)
  } finally {
    host.remove()
  }
}

export type ReceiptPageGeometry = {
  pageHeightMm: number
  continuousRoll: boolean
  pageSizeMode: ReceiptPrintSettings['pageSizeMode']
}

/**
 * The one place that decides a receipt's printable page length and whether
 * it is a continuous, in-document-remeasured roll -- pulled out of
 * createPrintableReceiptMarkup as a pure function so it is directly testable
 * without a DOM (that function also clones/measures the live host, which
 * needs `document`). `fixedHeightMm` is getPaperHeightMm(printSettings): a
 * document sheet (A4/Letter/custom with a height) always keeps its own
 * explicit height and 'measured' bookkeeping, regardless of what
 * pageSizeMode happens to be saved as -- pageSizeMode governs CONTINUOUS ROLL
 * paper (58/72/80mm, fixedHeightMm null) and the 80x50 card (`singleSheet`),
 * which prints on the same roll printer as the full receipt.
 */
export function resolveReceiptPageGeometry({
  fixedHeightMm,
  measuredHeightMm,
  savedPageSizeMode,
  fixedPageLengthMm,
  singleSheet = false,
}: {
  fixedHeightMm: number | null
  measuredHeightMm: number
  savedPageSizeMode?: string
  fixedPageLengthMm?: unknown
  singleSheet?: boolean
}): ReceiptPageGeometry {
  const pageSizeMode: ReceiptPrintSettings['pageSizeMode'] = (savedPageSizeMode as ReceiptPrintSettings['pageSizeMode'])
    || DEFAULT_RECEIPT_PRINT_SETTINGS.pageSizeMode
  const printerPaper = pageSizeMode === 'driver-forms' || pageSizeMode === 'driver'
  if (fixedHeightMm != null) {
    // In the printer-paper modes the card sends no @page size either, so it
    // starts at the top of the chosen paper instead of being centred on it
    // (about 37cm down a 72 x 800mm form); it keeps its one-card height.
    return { pageHeightMm: fixedHeightMm, continuousRoll: false, pageSizeMode: singleSheet && printerPaper ? pageSizeMode : 'measured' }
  }
  if (printerPaper) {
    // No `@page size` is emitted for either mode (see
    // buildPrintablePreviewDocument): the paper chosen in the print dialog is
    // the page. Chrome never switches that paper to match a CSS size -- a
    // smaller CSS page is centred on it (the blank band above the receipt)
    // and a larger one is shrunk or split -- whereas with no size the receipt
    // starts at the top of whatever paper is chosen, and on the longest form
    // (72 x 800mm on the owner's printer) the driver trims the unused paper
    // and cuts at the end of the receipt. This number is never printed as a
    // page length; it is the content estimate the preview reports.
    return { pageHeightMm: Math.max(1, measuredHeightMm + 1), continuousRoll: false, pageSizeMode }
  }
  if (pageSizeMode === 'fixed') {
    // A document page of the owner's chosen length; a long receipt flows
    // onto further pages of that same length instead of clipping or scaling
    // (isSingleSheetPaperSize stays false here, same as A4/Letter).
    return { pageHeightMm: Math.max(10, parsePrintNumber(fixedPageLengthMm, 100)), continuousRoll: false, pageSizeMode }
  }
  if (pageSizeMode === 'auto-longest') {
    return { pageHeightMm: RECEIPT_AUTO_LONGEST_PAGE_MM, continuousRoll: false, pageSizeMode }
  }
  // 'measured': current behaviour. A continuous roll is
  // width-only media: its one logical page grows with the complete receipt.
  // Keep this measured height for both HTML Print and PDF/Image so item
  // count can never trigger pagination or fit-to-page shrinking.
  return { pageHeightMm: Math.max(1, measuredHeightMm + 1), continuousRoll: true, pageSizeMode: 'measured' }
}

async function createPrintableReceiptMarkup(content: ReceiptContent, options: ReceiptPrintOptions = {}): Promise<PrintableReceiptLayout> {
  const printSettings = options.printSettings || getPrintSettings()
  const singleSheet = isSingleSheetPaperSize(printSettings.paperSize)
  const printsOnDriverForms = printsOnPrinterPaper(printSettings)
  const widthMm = options.paperWidthMm
    || (printsOnDriverForms ? getDriverFormWidthMm(printSettings) : getPaperWidthMm(printSettings))
  // PRINT-PATH ONLY (this function). PDF/image export keep the operator's
  // configured margins unchanged -- see createReceiptPdfBlob and
  // createReceiptImageBlob, which call withReceiptElement with the
  // untouched `printSettings`, not this capped copy.
  const hostPrintSettings = printsOnDriverForms ? capDriverFormMargins(printSettings) : printSettings
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
    const { pageHeightMm, continuousRoll, pageSizeMode } = resolveReceiptPageGeometry({
      fixedHeightMm,
      measuredHeightMm,
      savedPageSizeMode: printSettings.pageSizeMode,
      fixedPageLengthMm: printSettings.fixedPageLengthMm,
      singleSheet,
    })

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
    return {
      markup: clone.outerHTML,
      widthMm,
      pageHeightMm,
      continuousRoll,
      singleSheet,
      // hostPrintSettings so the shown margins match what actually printed
      // (capped side margins in driver-forms mode, unchanged otherwise).
      previewSettings: receiptPreviewSettings(hostPrintSettings),
      pageSizeMode,
    }
  }, hostPrintSettings, { cardFromTopEdge: printsOnDriverForms && singleSheet })
}

export function buildPrintablePreviewDocument(layout: PrintableReceiptLayout, options: ReceiptPrintOptions = {}): string {
  const { markup, widthMm, pageHeightMm, continuousRoll, singleSheet, pageSizeMode = 'measured' } = layout
  // 'driver-forms' (the default) and 'driver' send no `@page size` at all
  // (margin stays 0): the paper chosen in the print dialog is the page, and
  // the receipt starts at its top instead of being centred on it (see
  // resolveReceiptPageGeometry). Every other mode keeps an explicit, valid
  // width x height.
  const omitPageSize = pageSizeMode === 'driver' || pageSizeMode === 'driver-forms'
  // Three page semantics, not two. A continuous roll is one variable-height
  // logical page whose length is the measured receipt content.
  // A DOCUMENT page (A4, Letter, custom) is a stack of pages, so a long receipt
  // legitimately continues onto page 2. Only the explicit 80x50 summary is one
  // physical card: withReceiptElement has already fitted it to that height, and
  // clipping here prevents rounding from spilling a second card.
  const clipToOnePage = singleSheet && !continuousRoll
  const pageOverflow = clipToOnePage ? 'hidden' : 'visible'
  // 2026-09-15 (owner, two photos of a real 80mm print) + coordinator review:
  // `size: <width>mm auto` is NOT a valid @page value -- CSS Paged Media only
  // accepts `auto` alone, one/two lengths, or a page-size keyword, never a
  // length combined with `auto`. That declaration silently parses to nothing,
  // the printer falls back to its OWN default document size, and that is
  // exactly the "auto inserts page breaks / shrinks to a fixed sheet" failure
  // a4d99ac0 hit on Sep 12 (bare `auto`, same root cause) and 943e9884
  // reverted the same day. `size` must stay a VALID explicit width x height.
  //
  // What actually caused the blank band and the forced second page: the
  // height was measured in the APP's off-screen clone, not in the document
  // that is about to print. A different document (its own font-fallback
  // timing, its own sub-pixel rounding) lays the same markup out a hair
  // taller or shorter, and a real thermal driver, handed a page shorter than
  // what it is physically printing, still has to put that overflow
  // somewhere -- a gap reconciled against its own registered form, then a
  // forced page for whatever no longer fit. The value below is only the
  // FALLBACK for a print with no JS (or one that reaches print() before the
  // re-measure resolves); `remeasureContinuousRollBeforePrint` below
  // overwrites it, in the actual print document, right before print() is
  // called in both delivery paths.
  const pageSizeCss = `${widthMm}mm ${pageHeightMm.toFixed(2)}mm`
  // 'auto-longest' is one explicit page as long as the printer's longest
  // supported roll (RECEIPT_AUTO_LONGEST_PAGE_MM); a receipt must never
  // legitimately fill it, so nothing should ever try to break after it --
  // this only guards against a driver that pages anyway.
  const autoLongestCss = pageSizeMode === 'auto-longest'
    ? `
        .receipt-frame, .receipt-frame > * {
          page-break-after: avoid;
          break-after: avoid-page;
        }`
    : ''
  const documentHeightCss = clipToOnePage
    ? `height: ${pageHeightMm.toFixed(2)}mm !important;
          min-height: ${pageHeightMm.toFixed(2)}mm !important;`
    : `height: auto !important;
          min-height: 0 !important;`
  const fixedFrameHeightCss = clipToOnePage
    ? `height: ${pageHeightMm.toFixed(2)}mm !important;
          max-height: ${pageHeightMm.toFixed(2)}mm !important;`
    : ''
  // The atomic "keep this block on one page" rules exist for a genuine
  // multi-page document (A4/Letter/custom) and the single fixed 80x50 card,
  // where a second page is expected and an item or the QR block must not be
  // sliced mid-block across it. A continuous roll never legitimately has a
  // second page, so forcing its top-level blocks (items, totals, the QR
  // footer) to stay together is exactly what pushed a whole block onto a
  // manufactured page 2 when the roll's real height differed from the
  // JS estimate by even a fraction of a millimetre. `auto` removes the risk
  // at the source; these rules would only reintroduce it.
  const pageBreakAvoidanceCss = continuousRoll
    ? ''
    : `
        .receipt-frame {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .receipt-frame > * {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .receipt-frame [data-receipt-line="true"],
        .receipt-frame img {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }`
  const title = options.title === '' ? '' : (options.title || 'Receipt')
  const toolbarTitle = title || 'Receipt Preview'
  const note = options.note ? `<div class="receipt-note">${escapeHtml(options.note)}</div>` : ''
  const diagnostics = receiptPreviewDiagnosticLines(layout,
    layout.previewSettings || receiptPreviewSettings(options.printSettings || getPrintSettings()), options.previewTranslate)
    .map((line) => `<p>${escapeHtml(line)}</p>`).join('')
  // The exact measured length, as its OWN line with a stable selector so
  // remeasureContinuousRollBeforePrint can replace it once it has a number
  // measured in this document instead of the app's off-screen estimate.
  const lengthLine = continuousRoll
    ? `<p data-receipt-length-line="true">${escapeHtml(receiptLengthDiagnosticLine(pageHeightMm, options.previewTranslate))}</p>`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      ${appFontFaceCss()}
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
      .receipt-print-diagnostics {
        flex: 1 0 100%;
        min-width: 0;
        font-size: 12px;
        line-height: 1.5;
        color: #334155;
        overflow-wrap: anywhere;
      }
      .receipt-print-diagnostics p { margin: 4px 0 0; }
      .receipt-stage {
        display: flex;
        justify-content: center;
        max-width: 100%;
        overflow-x: auto;
        padding-bottom: 8px;
      }
      .receipt-frame {
        /* The receipt content already contains its designed paper padding.
           Adding another 16px frame around it made the fallback preview look
           noticeably narrower and more heavily margined than the receipt the
           cashier just reviewed. Keep the frame at the exact paper width. */
        width: ${widthMm}mm;
        max-width: none;
        flex: 0 0 auto;
        padding: 0;
        border-radius: 8px;
        background: transparent;
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.12);
      }
      .receipt-frame > * {
        margin: 0 auto;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      @page {
        ${omitPageSize ? '' : `size: ${pageSizeCss};`}
        margin: 0;
      }
      @media print {
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${widthMm}mm !important;
          min-width: ${widthMm}mm !important;
          max-width: ${widthMm}mm !important;
          ${documentHeightCss}
          background: #ffffff;
          overflow: ${pageOverflow} !important;
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
          overflow: ${pageOverflow} !important;
          ${fixedFrameHeightCss}
        }
        .receipt-frame > * {
          margin: 0 !important;
        }${pageBreakAvoidanceCss}${autoLongestCss}
      }
    </style>
    <!-- Empty until remeasureContinuousRollBeforePrint (below) fills it in,
         right before print(), with an @page rule measured in THIS document.
         Placed after the main stylesheet so it wins the cascade once it has
         content; a fixed sheet or a print with no JS never touches it and
         keeps the fallback @page above. -->
    <style id="receipt-page-size"></style>
  </head>
  <body>
    <div class="receipt-shell">
      <div class="receipt-toolbar">
        <div class="receipt-toolbar-copy">
          <h1 class="receipt-toolbar-title">${escapeHtml(toolbarTitle)}</h1>
          <p class="receipt-toolbar-subtitle">Printable receipt preview. Use Print to print now or Save as PDF from your browser.</p>
        </div>
        <div class="receipt-toolbar-actions">
          <button type="button" data-receipt-action="print">Print</button>
          <button type="button" data-receipt-action="close">Close</button>
        </div>
        <div class="receipt-print-diagnostics" data-receipt-print-diagnostics="true">${diagnostics}${lengthLine}</div>
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

// Safety margin added on top of the in-document measurement below. The app's
// off-screen estimate already adds 1mm (createPrintableReceiptMarkup); this
// is a second, independent buffer for the number measured in the ACTUAL
// print document, where sub-pixel rounding differs again.
const RECEIPT_PAGE_MEASURE_BUFFER_MM = 3

/**
 * Reads `.receipt-frame`'s own rendered size INSIDE `doc` -- the document
 * that is actually about to print, fonts and images already settled -- and
 * converts it to a page height in mm using that same document's px/mm ratio.
 * Returns null when the frame cannot be measured (no `.receipt-frame`, or a
 * zero width); the caller keeps the app-measured fallback @page rule in that
 * case instead of writing a bogus one.
 */
export function measureContinuousRollPageHeightMm(doc: Document, widthMm: number): number | null {
  const frame = doc.querySelector('.receipt-frame')
  if (!frame) return null
  const rect = frame.getBoundingClientRect?.() as { width?: number; height?: number } | undefined
  const renderedWidthPx = rect?.width || (frame as HTMLElement).offsetWidth || 0
  if (!(renderedWidthPx > 0)) return null
  const renderedHeightPx = (frame as HTMLElement).scrollHeight || rect?.height || (frame as HTMLElement).offsetHeight || 0
  if (!(renderedHeightPx > 0)) return null
  const heightMm = renderedHeightPx * (widthMm / renderedWidthPx)
  return Math.max(1, heightMm + RECEIPT_PAGE_MEASURE_BUFFER_MM)
}

/**
 * Overwrites the dedicated `#receipt-page-size` stylesheet with a fresh,
 * VALID `@page { size: <width>mm <height>mm; margin: 0; }` rule -- never
 * `auto` combined with a length, which CSS Paged Media rejects outright and
 * which is what handed pagination to the printer's own default document
 * size in the first place. No-ops if the document has no such element (a
 * fixed sheet's document never needs one).
 */
export function writeContinuousRollPageSize(doc: Document, widthMm: number, heightMm: number): void {
  const styleEl = doc.getElementById('receipt-page-size')
  if (!styleEl) return
  styleEl.textContent = `@page { size: ${widthMm}mm ${heightMm.toFixed(2)}mm; margin: 0; }`
}

/**
 * The one place both print delivery paths (the preview window and the
 * hidden same-document iframe) re-measure a continuous roll's page height
 * INSIDE the document that is about to print, and show that exact number to
 * the operator, right before print() is called. A fixed sheet (already
 * fitted to its explicit height) and any measurement failure are silent
 * no-ops -- this must never throw and block a print; the fallback @page rule
 * already baked into the document by buildPrintablePreviewDocument still
 * works on its own.
 */
export function remeasureContinuousRollBeforePrint(
  doc: Document,
  layout: PrintableReceiptLayout,
  translate?: ReceiptPreviewTranslate,
): void {
  if (!layout.continuousRoll) return
  try {
    const heightMm = measureContinuousRollPageHeightMm(doc, layout.widthMm)
    if (heightMm == null) return
    writeContinuousRollPageSize(doc, layout.widthMm, heightMm)
    const lengthLineEl = doc.querySelector('[data-receipt-length-line]')
    if (lengthLineEl) lengthLineEl.textContent = receiptLengthDiagnosticLine(heightMm, translate)
  } catch {
    // The fallback @page rule from the initial markup still prints correctly.
  }
}

function attachPrintablePreviewActions(
  previewWindow: Window | null,
  layout: PrintableReceiptLayout,
  options: ReceiptPrintOptions,
  { autoPrint = false }: { autoPrint?: boolean } = {},
): void {
  if (!previewWindow?.document) return
  const doc = previewWindow.document
  const printButton = doc.querySelector('[data-receipt-action="print"]')
  const closeButton = doc.querySelector('[data-receipt-action="close"]')
  const printNow = async () => {
    // Re-measure in THIS document, fonts/images settled, right before print()
    // -- the one moment left to correct the app's off-screen estimate.
    await waitForFrameAssets(previewWindow, doc)
    remeasureContinuousRollBeforePrint(doc, layout, options.previewTranslate)
    previewWindow.print?.()
  }
  printButton?.addEventListener('click', () => { void printNow() })
  closeButton?.addEventListener('click', () => previewWindow.close?.())

  if (!autoPrint) return
  const schedulePrint = () => previewWindow.setTimeout?.(() => { void printNow() }, 240)
  if (doc.readyState === 'complete') schedulePrint()
  else previewWindow.addEventListener?.('load', schedulePrint, { once: true })
}

export async function openPrintableReceiptPreview(content: ReceiptContent, options: ReceiptPrintOptions = {}) {
  // The window is opened BEFORE the first await, not after it. Building the
  // markup awaits fonts, images and a requestAnimationFrame, and by then the
  // user's tap is over: iOS blocks window.open, and an installed iOS PWA has
  // no address bar to un-block it and would hand the blank window to Safari
  // anyway -- which is why the receipt never reached the printer on iPhone.
  const previewWindow = options.previewWindow !== undefined ? options.previewWindow : openPrintPreviewWindow()
  try {
    const layout = await createPrintableReceiptMarkup(content, options)
    const html = buildPrintablePreviewDocument(layout, options)
    if (!previewWindow) {
      // No second window on this device. Print the SAME document -- identical
      // markup, identical embedded stylesheet, so the thermal layout is byte
      // for byte the one the preview would have shown -- from a hidden iframe
      // in this document. On iOS the platform print sheet is itself the
      // preview (and its Save to Files is the PDF), so this path prints even
      // when the caller only asked to preview: there is nowhere else to show
      // it, and silently doing nothing is what people reported as broken.
      const printed = await printHtmlInHiddenFrame(html, {
        // printHtmlInHiddenFrame has already awaited fonts/images by the time
        // this runs -- re-measuring here needs no second wait, just the read
        // + rewrite, right before it calls print().
        beforePrint: (_win, frameDoc) => { remeasureContinuousRollBeforePrint(frameDoc, layout, options.previewTranslate) },
      })
      if (!printed) throw new Error('This browser could not open the receipt for printing.')
      return { opened: true, mode: 'frame-print' }
    }
    previewWindow.document.open()
    previewWindow.document.write(html)
    previewWindow.document.close()
    attachPrintablePreviewActions(previewWindow, layout, options, { autoPrint: !!options.autoPrint })
    previewWindow.focus?.()
    return { opened: true, mode: 'preview' }
  } catch (error) {
    // Never leave the blank tab this function opened stranded on screen.
    try { previewWindow?.close?.() } catch { /* already closed by the user */ }
    throw error
  }
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

/**
 * The printer driver's registered form width in mm for pageSizeMode
 * 'driver-forms' -- independent of `paperSize`, since a printer can be
 * configured for e.g. 80mm continuous paper while its driver only ever
 * registers narrower (e.g. 72mm) forms.
 */
export function getDriverFormWidthMm(settings: ReceiptPrintSettings = getPrintSettings()): number {
  const parsed = Number.parseFloat(String(settings.driverFormWidthMm ?? ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRIVER_FORM_WIDTH_MM
}

export async function createReceiptPdfBlob(content: ReceiptContent, options: ReceiptPrintOptions = {}): Promise<Blob> {
  const printSettings = options.printSettings || getPrintSettings()
  const widthMm = options.paperWidthMm || getPaperWidthMm(printSettings)
  const heightMm = getPaperHeightMm(printSettings)
  const title = options.title === '' ? '' : (options.title || 'Receipt')
  const pageWidthPt = mmToPt(widthMm)
  const pageHeightPt = heightMm != null ? mmToPt(heightMm) : undefined
  const singleSheet = isSingleSheetPaperSize(printSettings.paperSize)
  const allowTextFallback = Boolean(options.allowTextFallback || options.preferTextOnly)
  const buildTextOnlyReceiptBlob = () => {
    const fallbackLines = extractReceiptLines(content)
    const pdfBytes = buildTextOnlyPdf({
      lines: fallbackLines,
      pageWidthPt,
      pageHeightPt,
      singleSheet,
      title,
      bold: printSettings.highContrastBold,
    })
    return new Blob([bytesToBlobPart(pdfBytes)], { type: 'application/pdf' })
  }

  if (options.preferTextOnly) {
    return buildTextOnlyReceiptBlob()
  }

  const renderPdfBlob = async () => {
    const rendered = await withReceiptElement(content, widthMm, renderElementToCanvasResult, printSettings)
    const { canvas, breakOffsetsPx } = rendered
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.98)
    const jpegBytes = dataUrlToBytes(jpegUrl)
    const pdfBytes = buildSingleImagePdf({
      imageBytes: jpegBytes,
      imageWidthPx: canvas.width,
      imageHeightPx: canvas.height,
      pageWidthPt,
      pageHeightPt,
      singleSheet,
      breakOffsetsPx,
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
    // Up to FOUR tab-separated fields, because the item table has four columns.
    // Truncating at three here is what would silently drop the line total.
    if (compactValues.length >= 3) {
      return compactValues.slice(0, 4).join('\t')
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
      // Three or four: the item table is four columns unless the price column
      // is switched off. Sublines (the riel figure) hang off the LAST cell,
      // which is the line total when there is one.
      if (cells.length === 3 || cells.length === 4) {
        const columns = cells.map((cell) => elementLines(cell))
        const lastColumn = columns[columns.length - 1] || []
        return [
          joinColumns(columns.map((lines) => lines[0] || '')),
          ...(columns[0] || []).slice(1).map((line) => `  ${line}`),
          ...lastColumn.slice(1).map((line) => `\t\t${line}`),
        ].filter(Boolean)
      }
      const childLines = Array.from(element.children)
        .map((child) => elementLines(child as HTMLElement))
        .filter((lines) => lines.length > 0)
      if (childLines.length === 3 || childLines.length === 4) {
        const lastColumn = childLines[childLines.length - 1] || []
        return [
          joinColumns(childLines.map((lines) => lines[0] || '')),
          ...(childLines[0] || []).slice(1).map((line) => `  ${line}`),
          ...lastColumn.slice(1).map((line) => `\t\t${line}`),
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

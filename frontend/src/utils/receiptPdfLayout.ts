export type ImagePdfLayout = {
  pageHeightPt: number
  drawWidthPt: number
  drawHeightPt: number
  drawXPt: number
  drawYPt: number
}

export function computeImagePdfLayout({
  imageWidthPx,
  imageHeightPx,
  pageWidthPt,
  fixedHeightPt,
}: {
  imageWidthPx: number
  imageHeightPx: number
  pageWidthPt: number
  fixedHeightPt?: number
}): ImagePdfLayout {
  const safeImageWidthPx = Math.max(1, imageWidthPx)
  const safeImageHeightPx = Math.max(1, imageHeightPx)
  const contentHeightPt = pageWidthPt * (safeImageHeightPx / safeImageWidthPx)
  const pageHeightPt = fixedHeightPt != null ? Math.max(36, fixedHeightPt) : Math.max(36, contentHeightPt)
  const imageScale = fixedHeightPt != null
    ? Math.min(pageWidthPt / safeImageWidthPx, pageHeightPt / safeImageHeightPx)
    : pageWidthPt / safeImageWidthPx
  const drawWidthPt = safeImageWidthPx * imageScale
  const drawHeightPt = safeImageHeightPx * imageScale

  return {
    pageHeightPt,
    drawWidthPt,
    drawHeightPt,
    drawXPt: Math.max(0, (pageWidthPt - drawWidthPt) / 2),
    drawYPt: Math.max(0, (pageHeightPt - drawHeightPt) / 2),
  }
}

export type FixedSheetFit = {
  scale: number
  fits: boolean
  scaledHeightMm: number
  unscaledPageCount: number
  contentWidthPercent: number
}

/**
 * Only the named compact sales-summary format is one physical card whose
 * complete contents must be fitted onto one sheet. A custom height is a page
 * size, not an implicit card: for example, the 98 x 148 mm media exposed by a
 * thermal-printer driver must paginate a long receipt at full scale. Inferring
 * this from an arbitrary height threshold made that common 148 mm page shrink
 * every 10/20-item receipt onto one tiny sheet.
 */
export function isSingleSheetPaperSize(paperSize: unknown): boolean {
  return String(paperSize || '').trim().toLowerCase() === '80x50mm'
}

export type ImagePageSegment = {
  startPx: number
  endPx: number
}

/**
 * Split a top-to-bottom receipt raster into fixed-height pages. Candidate
 * offsets are the bottoms of real receipt rows; preferring the last candidate
 * before a page edge keeps an item/value row together and leaves intentional
 * white space rather than slicing text between pages. An over-tall block still
 * advances by one full page so malformed input cannot stall pagination.
 */
export function computeImagePageSegments({
  imageHeightPx,
  pageCapacityPx,
  breakOffsetsPx = [],
}: {
  imageHeightPx: number
  pageCapacityPx: number
  breakOffsetsPx?: number[]
}): ImagePageSegment[] {
  const height = Math.max(1, Number.isFinite(imageHeightPx) ? imageHeightPx : 1)
  const capacity = Math.max(1, Number.isFinite(pageCapacityPx) ? pageCapacityPx : 1)
  const candidates = Array.from(new Set(breakOffsetsPx
    .filter((value) => Number.isFinite(value) && value > 0 && value < height)
    .map((value) => Math.max(0, Math.min(height, value)))))
    .sort((a, b) => a - b)
  const pages: ImagePageSegment[] = []
  let startPx = 0
  while (startPx < height - 1e-6) {
    const limitPx = Math.min(height, startPx + capacity)
    if (limitPx >= height - 1e-6) {
      pages.push({ startPx, endPx: height })
      break
    }
    const safeEndPx = candidates.reduce((best, value) => (
      value > startPx + 1e-6 && value <= limitPx + 1e-6 ? value : best
    ), 0)
    const endPx = safeEndPx > startPx ? safeEndPx : limitPx
    pages.push({ startPx, endPx })
    startPx = endPx
  }
  return pages.length ? pages : [{ startPx: 0, endPx: height }]
}

/**
 * A single fixed sheet -- the 80x50 sales card, or a small custom card -- has a
 * hard height budget, unlike a continuous roll whose page simply grows. When the
 * rendered receipt is taller than that budget the printer fragments it across
 * pages (the "prints on 1/2 and 2/2" report) unless something scales the layout
 * BOX down first. `scale` is that factor; `contentWidthPercent` is the widened
 * layout width to give the content before scaling it back, so a fitted card
 * still spans the full paper width instead of shrinking into side gutters.
 *
 * There is deliberately no minimum-scale clamp: a clamp would leave content
 * taller than the sheet, which is exactly the pagination this exists to prevent.
 */
export function computeFixedSheetFit({
  contentHeightMm,
  sheetHeightMm,
}: {
  contentHeightMm: number
  sheetHeightMm: number
}): FixedSheetFit {
  const safeContentMm = Math.max(0.01, Number.isFinite(contentHeightMm) ? contentHeightMm : 0)
  const safeSheetMm = Math.max(0.01, Number.isFinite(sheetHeightMm) ? sheetHeightMm : 0)
  const ratio = safeSheetMm / safeContentMm
  const fits = ratio >= 1
  const scale = fits ? 1 : ratio

  return {
    scale,
    fits,
    scaledHeightMm: safeContentMm * scale,
    // Sub-millimetre rounding must not invent a page, so compare with a small
    // tolerance: a card measured at exactly the sheet height is one page.
    unscaledPageCount: Math.max(1, Math.ceil(safeContentMm / safeSheetMm - 1e-6)),
    contentWidthPercent: 100 / scale,
  }
}

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
 * The tallest fixed sheet that counts as ONE physical piece of paper.
 *
 * A card or label -- the 80x50 sales summary, or a small custom size the
 * operator typed -- is a single ticket: content that does not fit is not
 * carried onto a second page, it is a wasted label and a lost line, so it has
 * to be scaled to fit. A document page (A4 297mm, Letter 279.4mm, or a custom
 * size as tall as one) is the opposite: a 60-item receipt is legitimately two
 * pages there, and squeezing it onto one would make it unreadable. The test is
 * the sheet's own height rather than a list of paper-size names, so a custom
 * 60mm card and a custom 297mm page each behave like what they physically are.
 */
export const SINGLE_SHEET_MAX_HEIGHT_MM = 150

/**
 * True when a fixed sheet has to hold the whole receipt on one page. Continuous
 * rolls (null height) are never single sheets -- their page simply grows.
 */
export function isSingleSheetHeight(sheetHeightMm: number | null | undefined): boolean {
  if (sheetHeightMm == null || !Number.isFinite(sheetHeightMm) || sheetHeightMm <= 0) return false
  return sheetHeightMm <= SINGLE_SHEET_MAX_HEIGHT_MM
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

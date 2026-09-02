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

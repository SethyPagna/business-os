import type { ReceiptPrintSettings } from '../types/receiptContracts'

/** Screen-only diagnostics. These values never determine print geometry. */
export function receiptPreviewSettings(settings: Partial<ReceiptPrintSettings> = {}) {
  const number = (value: unknown, fallback: number) => {
    const parsed = Number.parseFloat(String(value ?? ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return {
    // Match the renderer's effective scale and non-negative margin bounds.
    scalePercent: Math.max(50, Math.min(150, number(settings.scale, 100))),
    marginsMm: [settings.marginTop, settings.marginRight, settings.marginBottom, settings.marginLeft]
      .map((value) => Math.max(0, number(value, 4))),
  }
}

export type ReceiptPreviewSettings = ReturnType<typeof receiptPreviewSettings>

export const RECEIPT_PREVIEW_COPY = {
  receipt_preview_requested_paper: 'Requested paper',
  receipt_preview_dialog_paper: 'length set by the paper chosen in the print dialog',
  receipt_preview_dialog_paper_hint: 'In the print dialog, choose the longest paper once (e.g. 72 × 800 mm) and keep Margins and Scale at Default. Chrome remembers it, and the printer stops and cuts at the end of the receipt.',
  receipt_preview_continuous_roll: 'Continuous roll — one content-height strip',
  receipt_preview_single_card: 'Single card — fitted to one sheet',
  receipt_preview_fixed_document: 'Fixed-size document',
  receipt_preview_app_scale: 'App scale',
  receipt_preview_margins: 'Margins (top / right / bottom / left)',
  receipt_preview_actual_size: 'In the printer dialog, select matching paper and Actual size / 100%. App scale is separate from printer scaling.',
  receipt_preview_roll_warning: 'Fitting this long receipt to fixed paper such as 98 × 148 mm can shrink its width. The browser cannot force the printer paper size.',
  receipt_preview_card_note: 'The app has fitted this card to one sheet. Printer scaling is separate.',
  // 2026-09-15 (owner, real 80mm print photos): a blank band before the
  // shop name is consistent with the printer driver's own registered form
  // being taller than the receipt -- the page itself cannot shrink that
  // form, only the driver's own paper/media setting can. Shown next to the
  // exact measured length so the owner can see the number that should match
  // what the driver is set to.
  receipt_preview_length: 'Receipt length',
  receipt_preview_driver_hint: 'Set the printer driver to roll / continuous paper at Actual size (no "fit to page"). A driver form taller than the receipt shows as blank space before the print that this page cannot remove.',
  receipt_preview_page_size_mode: 'Page length mode',
  receipt_preview_mode_measured: 'Measured (auto-fit)',
  receipt_preview_mode_fixed: 'Fixed length',
  receipt_preview_mode_driver: 'Printer driver default',
  receipt_preview_mode_auto_longest: 'Longest roll (auto)',
  receipt_preview_mode_driver_forms: 'Printer paper',
  receipt_preview_mode_troubleshoot: 'Still seeing a blank band or a split strip? Choose Printer paper and pick the longest paper in the print dialog (e.g. 72 × 800 mm). If that still fails, try Fixed length, then Longest roll.',
} as const

export type ReceiptPreviewTranslate = (key: string) => string | undefined

// Rendered as its own diagnostic line (not folded into the array above) so
// the print document can find and REPLACE just this line by its data
// attribute once the in-document re-measurement (printReceipt.ts) has a more
// accurate number than the app's off-screen estimate baked in at render time.
export function receiptLengthDiagnosticLine(heightMm: number, translate?: ReceiptPreviewTranslate): string {
  const localized = translate?.('receipt_preview_length')
  const label = localized && localized !== 'receipt_preview_length' ? localized : RECEIPT_PREVIEW_COPY.receipt_preview_length
  return `${label}: ${Number(heightMm.toFixed(2)).toString()} mm`
}

const RECEIPT_PAGE_SIZE_MODE_LABELS: Record<string, keyof typeof RECEIPT_PREVIEW_COPY> = {
  measured: 'receipt_preview_mode_measured',
  fixed: 'receipt_preview_mode_fixed',
  driver: 'receipt_preview_mode_driver',
  'auto-longest': 'receipt_preview_mode_auto_longest',
  'driver-forms': 'receipt_preview_mode_driver_forms',
}

export function receiptPreviewDiagnosticLines(
  layout: { widthMm: number; pageHeightMm: number; continuousRoll: boolean; singleSheet: boolean; pageSizeMode?: string },
  settings: ReceiptPreviewSettings,
  translate?: ReceiptPreviewTranslate,
): string[] {
  const text = (key: keyof typeof RECEIPT_PREVIEW_COPY) => {
    const localized = translate?.(key)
    return localized && localized !== key ? localized : RECEIPT_PREVIEW_COPY[key]
  }
  const dimension = (value: number) => Number(value.toFixed(2)).toString()
  const mode = layout.continuousRoll ? 'receipt_preview_continuous_roll'
    : layout.singleSheet ? 'receipt_preview_single_card' : 'receipt_preview_fixed_document'
  const pageSizeMode = layout.pageSizeMode || 'measured'
  // A page-size-mode fallback applies to the roll printer's paper: the roll's
  // OWN measured page (continuousRoll true), one of the fallbacks a roll can
  // be switched to (pageSizeMode !== 'measured'), or the 80x50 card printed
  // in a printer-paper mode. A document sheet (A4/Letter/custom height)
  // always reports pageSizeMode 'measured' and continuousRoll false, so this
  // line never appears for it.
  const showPageSizeMode = layout.continuousRoll || pageSizeMode !== 'measured'
  // 'driver-forms' and 'driver' request no page length at all (printReceipt.ts
  // sends no @page size for them): only the width is the app's, the length is
  // whatever paper the print dialog has selected. The dialog-paper hint is
  // their advice; the troubleshoot line would only repeat it.
  const dialogPaper = pageSizeMode === 'driver-forms' || pageSizeMode === 'driver'
  const paperLine = dialogPaper
    ? `${text('receipt_preview_requested_paper')}: ${dimension(layout.widthMm)} mm · ${text('receipt_preview_dialog_paper')}`
    : `${text('receipt_preview_requested_paper')}: ${dimension(layout.widthMm)} × ${dimension(layout.pageHeightMm)} mm · ${text(mode)}`
  return [
    paperLine,
    `${text('receipt_preview_app_scale')}: ${dimension(settings.scalePercent)}% · ${text('receipt_preview_margins')}: ${settings.marginsMm.map(dimension).join(' / ')} mm`,
    text(dialogPaper ? 'receipt_preview_dialog_paper_hint' : 'receipt_preview_actual_size'),
    ...(showPageSizeMode ? [`${text('receipt_preview_page_size_mode')}: ${text(RECEIPT_PAGE_SIZE_MODE_LABELS[pageSizeMode] || 'receipt_preview_mode_measured')}`] : []),
    ...(layout.continuousRoll ? [text('receipt_preview_roll_warning'), text('receipt_preview_driver_hint')]
      : layout.singleSheet ? [text('receipt_preview_card_note')] : []),
    ...(showPageSizeMode && !dialogPaper ? [text('receipt_preview_mode_troubleshoot')] : []),
  ]
}

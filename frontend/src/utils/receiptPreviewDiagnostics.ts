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

export function receiptPreviewDiagnosticLines(
  layout: { widthMm: number; pageHeightMm: number; continuousRoll: boolean; singleSheet: boolean },
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
  return [
    `${text('receipt_preview_requested_paper')}: ${dimension(layout.widthMm)} × ${dimension(layout.pageHeightMm)} mm · ${text(mode)}`,
    `${text('receipt_preview_app_scale')}: ${dimension(settings.scalePercent)}% · ${text('receipt_preview_margins')}: ${settings.marginsMm.map(dimension).join(' / ')} mm`,
    text('receipt_preview_actual_size'),
    ...(layout.continuousRoll ? [text('receipt_preview_roll_warning'), text('receipt_preview_driver_hint')]
      : layout.singleSheet ? [text('receipt_preview_card_note')] : []),
  ]
}

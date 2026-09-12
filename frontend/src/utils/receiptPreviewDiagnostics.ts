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
} as const

export type ReceiptPreviewTranslate = (key: string) => string | undefined

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
    ...(layout.continuousRoll ? [text('receipt_preview_roll_warning')]
      : layout.singleSheet ? [text('receipt_preview_card_note')] : []),
  ]
}

import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import Ruler from 'lucide-react/dist/esm/icons/ruler.js'
import Scaling from 'lucide-react/dist/esm/icons/scaling.js'
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-2.js'
import { downloadReceiptPdf, getPaperWidthMm, getPrintSettings, openReceiptPdf, printReceipt, savePrintSettings, PRINT_DEFAULTS } from '../../utils/printReceipt'
import { isReceiptCardPaper, normalizeReceiptTemplate, receiptRenditionPrintSettings, type ReceiptRendition } from '../../utils/receiptAppliedConfig'
import { RECEIPT_SHELL_HORIZONTAL_PADDING_PX } from '../../utils/receiptItemColumns.ts'
import type { ReceiptPrintSettings } from '../../types/receiptContracts'
import InfoHint from '../shared/InfoHint.tsx'

type Translate = (key: string, fallback?: string) => string | undefined
type AppSettings = Record<string, unknown> & { receipt_print_settings?: unknown }
type SaveSettingsOptions = {
  silentToast?: boolean
  refreshChannels?: string[]
  reason?: string
  source?: string
}
type SaveSettings = (settings: Record<string, unknown>, options?: SaveSettingsOptions) => Promise<unknown> | unknown

interface SectionProps {
  icon?: LucideIcon
  title: string
  children: ReactNode
}

interface PrintSettingsProps {
  t?: Translate
  previewTargetRef?: RefObject<HTMLElement | null> | null
  settings?: AppSettings
  saveSettings?: SaveSettings | null
}

type ReceiptMarginKey = 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'

function Section({ icon: Icon, title, children }: SectionProps) {
  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2 dark:border-gray-700">
        {Icon ? <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" /> : null}
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

// The normal path for both Test Print buttons is `getPreviewSource()` below
// finding the REAL, already-rendered receipt preview DOM (the live sidebar/
// modal <ReceiptPreview>) via `[data-receipt-export-root="true"]` -- that
// element already carries Receipt.tsx's `data-receipt-contrast` attribute and
// main.css's override, so it honours Text Contrast automatically, the same
// way print/PDF/image export does. This synthetic HTML string is only a
// last-resort fallback for when that real preview DOM isn't mounted/found
// (e.g. the ref hasn't attached yet) -- it must still honour the same setting
// rather than silently reverting to grey, so the fallback also takes the
// current contrast mode.
function buildFallbackPreviewHtml(printSettings: ReceiptPrintSettings, T: (key: string, fallback: string) => string, contrastMode: string): string {
  // Either switch alone is enough to darken this fallback: Text contrast =
  // maximum, or the older highContrastBold. Only the latter also bolds.
  const isMaxContrast = contrastMode === 'maximum' || printSettings.highContrastBold
  const highContrastStyle = printSettings.highContrastBold
    ? 'color:#000;font-weight:700;'
    : (isMaxContrast ? 'color:#000;' : 'color:#111827;')
  const metaColor = isMaxContrast ? '#000000' : '#555'
  const footerColor = isMaxContrast ? '#000000' : '#777'
  return `
    <div data-receipt-high-contrast="${printSettings.highContrastBold ? 'true' : 'false'}" style="padding:8px;text-align:center;${highContrastStyle}">
      <div style="font-size:16px;font-weight:bold;margin-bottom:4px;">Business OS</div>
      <div style="font-size:11px;color:${metaColor};margin-bottom:8px;">${T('receipt_test_pdf', 'Receipt Test')}</div>
      <div style="border-top:1px dashed #000;margin:6px 0;"></div>
      <div style="font-size:12px;text-align:left;">
        <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 1 x2</span><span>$10.00</span></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 2 x1</span><span>$5.50</span></div>
      </div>
      <div style="border-top:1px dashed #000;margin:6px 0;"></div>
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;gap:16px;"><span>TOTAL</span><span>$15.50</span></div>
      <div style="margin-top:10px;font-size:10px;color:${footerColor};">Paper: ${printSettings?.paperSize || '80mm'} | Scale: ${printSettings?.scale || 100}%</div>
      <div style="margin-top:4px;font-size:10px;">Thank you!</div>
    </div>
  `
}

function buildSafePreviewSource(previewNode: unknown, rendition: ReceiptRendition, printSettings: ReceiptPrintSettings, T: (key: string, fallback: string) => string, contrastMode: string): string | HTMLElement {
  if (!(previewNode instanceof HTMLElement)) {
    return buildFallbackPreviewHtml(printSettings, T, contrastMode)
  }
  try {
    // With the 80x50 card enabled the preview holds both renditions.
    const exportRoots = Array.from(previewNode.querySelectorAll('[data-receipt-export-root="true"]'))
    const exportRoot = exportRoots.find((root) => root.getAttribute('data-receipt-rendition') === rendition) || exportRoots[0]
    return exportRoot instanceof HTMLElement ? exportRoot : previewNode
  } catch (_) {
    return buildFallbackPreviewHtml(printSettings, T, contrastMode)
  }
}

export default function PrintSettings({ t: tProp, previewTargetRef = null, settings = {}, saveSettings: saveAppSettings = null }: PrintSettingsProps) {
  const T = (key: string, fallback: string): string => tProp?.(key, fallback) || fallback
  const [ps, setPs] = useState(() => {
    try {
      return getPrintSettings(settings)
    } catch (_) {
      return { ...PRINT_DEFAULTS }
    }
  })
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    try {
      setPs(getPrintSettings(settings))
    } catch (_) {
      setPs({ ...PRINT_DEFAULTS })
    }
  }, [settings?.receipt_print_settings])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
  }, [])

  const persistPrintSettings = (next: ReceiptPrintSettings) => {
    if (typeof saveAppSettings !== 'function') return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void saveAppSettings(
        { receipt_print_settings: JSON.stringify(next) },
        {
          silentToast: true,
          refreshChannels: ['settings', 'sales', 'pos', 'dashboard'],
          reason: 'receipt-print-settings-saved',
          source: 'receipt-settings:print',
        },
      )
    }, 350)
  }

  const setValue = <Key extends keyof ReceiptPrintSettings>(key: Key, value: ReceiptPrintSettings[Key]) => {
    setPs((prev) => {
      const next = { ...prev, [key]: value }
      try { savePrintSettings(next) } catch (_) {}
      persistPrintSettings(next)
      return next
    })
  }

  const resetMargins = () => {
    const next = { ...ps, marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0' }
    setPs(next)
    try { savePrintSettings(next) } catch (_) {}
    persistPrintSettings(next)
  }

  const paperSizes: Array<{ id: ReceiptPrintSettings['paperSize']; label: string; desc: string }> = [
    { id: '58mm', label: '58mm', desc: T('print_narrow_thermal', 'Narrow thermal') },
    { id: '72mm', label: '72mm', desc: T('print_medium_thermal', 'Medium thermal') },
    { id: '80mm', label: '80mm', desc: T('print_standard_thermal', 'Standard thermal') },
    { id: '80x50mm', label: '80 × 50mm', desc: T('print_sales_summary', 'Compact sales summary') },
    { id: 'A4', label: 'A4', desc: T('print_standard_office', 'Standard office') },
    { id: 'letter', label: 'Letter', desc: T('print_us_standard', 'US standard') },
    { id: 'custom', label: T('print_set_size', 'Custom'), desc: T('print_set_size', 'Set size') },
  ]

  const pageSizeModes: Array<{ id: ReceiptPrintSettings['pageSizeMode']; label: string; desc: string }> = [
    { id: 'driver-forms', label: T('print_page_size_mode_driver_forms', 'Printer paper (default)'), desc: T('print_page_size_mode_driver_forms_desc', 'Prints at the printer\'s paper width with no top margin; the paper chosen in the print dialog sets the length. Choose the longest paper once (e.g. 72 × 800 mm) and the printer stops and cuts at the end of the receipt.') },
    { id: 'measured', label: T('print_page_size_mode_measured', 'Measured'), desc: T('print_page_size_mode_measured_desc', 'Auto-fits the roll to the printed receipt height, right before printing.') },
    { id: 'fixed', label: T('print_page_size_mode_fixed', 'Fixed length'), desc: T('print_page_size_mode_fixed_desc', 'A page length you choose; long receipts continue onto further pages of that length.') },
    { id: 'driver', label: T('print_page_size_mode_driver', 'Printer driver default'), desc: T('print_page_size_mode_driver_desc', 'Sends no page size; the printer driver\'s own registered paper/form decides.') },
    { id: 'auto-longest', label: T('print_page_size_mode_auto_longest', 'Longest roll'), desc: T('print_page_size_mode_auto_longest_desc', 'One page as long as the printer\'s longest supported roll.') },
  ]
  const fixedLengthPresets = ['50', '100', '150', '200', '297']

  const marginFields: Array<[ReceiptMarginKey, string]> = [
    ['marginTop', T('print_top', 'Top')],
    ['marginRight', T('print_right', 'Right')],
    ['marginBottom', T('print_bottom', 'Bottom')],
    ['marginLeft', T('print_left', 'Left')],
  ]
  const paperWidthMm = getPaperWidthMm(ps)
  const marginNumber = (value: unknown): number => {
    const parsed = Number.parseFloat(String(value ?? ''))
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  // The fixed 80x50 card overrides normal margins to zero when it exports,
  // but its shell still owns the same 16px design padding on each side. Show
  // that real content width instead of incorrectly promising all 80mm.
  const fixedCardPaddingMm = RECEIPT_SHELL_HORIZONTAL_PADDING_PX * 25.4 / 96
  const effectiveLeftMm = ps.paperSize === '80x50mm' ? fixedCardPaddingMm / 2 : marginNumber(ps.marginLeft)
  const effectiveRightMm = ps.paperSize === '80x50mm' ? fixedCardPaddingMm / 2 : marginNumber(ps.marginRight)
  const contentWidthMm = Math.max(0, paperWidthMm - effectiveLeftMm - effectiveRightMm)
  const mm = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1)

  // Only the fallback synthetic HTML (buildFallbackPreviewHtml) reads this --
  // the real preview DOM branch already carries its own contrast attribute.
  const contrastMode = normalizeReceiptTemplate(settings.receipt_template).text_contrast

  // A test prints what a sale's Print prints on this paper: the 80x50 card on
  // 80 x 50 paper, otherwise the full receipt, each with its own settings.
  const testRendition: ReceiptRendition = isReceiptCardPaper(ps) ? 'card' : 'full'
  const testPrintSettings = receiptRenditionPrintSettings(ps, testRendition)

  const getPreviewSource = () => {
    const previewNode = previewTargetRef?.current
    return buildSafePreviewSource(previewNode, testRendition, testPrintSettings, T, contrastMode)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
        {T('print_auto_save_note', 'Print settings save automatically and apply whenever you print from POS or Sales.')}
      </div>

      <Section icon={Printer} title={T('print_paper_size', 'Paper Size')}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {paperSizes.map((size) => (
            <button
              key={size.id}
              type="button"
              onClick={() => setValue('paperSize', size.id)}
              className={`rounded-xl border-2 p-3 text-left ${
                ps.paperSize === size.id
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              <div className={`text-sm font-bold ${ps.paperSize === size.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                {size.label}
              </div>
              <div className="text-xs text-gray-400">{size.desc}</div>
            </button>
          ))}
        </div>

        {ps.paperSize === 'custom' ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="print-custom-width" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_width_mm', 'Width (mm)')}</label>
              <input id="print-custom-width" name="print_custom_width" autoComplete="off" className="input text-sm" type="number" min="30" max="300" value={ps.customWidth || '80'} onChange={(event) => setValue('customWidth', event.target.value)} />
            </div>
            <div>
              <label htmlFor="print-custom-height" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_height_mm', 'Height (mm)')}</label>
              <input id="print-custom-height" name="print_custom_height" autoComplete="off" className="input text-sm" type="number" min="50" max="1000" value={ps.customHeight || '297'} onChange={(event) => setValue('customHeight', event.target.value)} />
            </div>
          </div>
        ) : null}
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <div className="font-semibold">
            {T('print_effective_dimensions', 'Paper {paper}mm · content {content}mm')
              .replace('{paper}', mm(paperWidthMm))
              .replace('{content}', mm(contentWidthMm))}
          </div>
          <div className="mt-1">
            {T('print_driver_size_note', 'For physical printing, select the same paper size in Chrome and the printer driver, use 100% / Actual size, browser margins None, and disable headers and footers.')}
          </div>
          {/* The printer-paper modes send no page size: nothing is centred, so there is no blank band to explain. */}
          {['58mm', '72mm', '80mm'].includes(ps.paperSize) && !['driver-forms', 'driver'].includes(ps.pageSizeMode || 'driver-forms') ? (
            <div className="mt-1">
              {T('receipt_preview_driver_hint', 'Set the printer driver to roll / continuous paper at Actual size (no "fit to page"). A driver form taller than the receipt shows as blank space before the print that this page cannot remove.')}
            </div>
          ) : null}
        </div>
      </Section>

      {['58mm', '72mm', '80mm'].includes(ps.paperSize) ? (
        <Section icon={Ruler} title={T('print_page_size_mode_title', 'Page length handling')}>
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-xs text-gray-500">
              {T('print_page_size_mode_desc', 'Choose how the printable page length is decided on continuous roll paper. If a print shows a blank band before the receipt or splits onto a second strip, try a different mode here.')}
            </p>
            <InfoHint
              label={T('print_page_size_mode_title', 'Page length handling')}
              text={T('receipt_preview_mode_troubleshoot', 'Still seeing a blank band or a split strip? In Print Settings, try Fixed length, then Longest roll, then Printer driver default.')}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {pageSizeModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setValue('pageSizeMode', mode.id)}
                className={`rounded-xl border-2 p-3 text-left ${
                  (ps.pageSizeMode || 'driver-forms') === mode.id
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className={`text-sm font-bold ${(ps.pageSizeMode || 'driver-forms') === mode.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  {mode.label}
                </div>
                <div className="text-xs text-gray-400">{mode.desc}</div>
              </button>
            ))}
          </div>

          {(ps.pageSizeMode || 'driver-forms') === 'fixed' ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_fixed_page_length', 'Fixed page length')}</label>
              <div className="flex flex-wrap gap-2">
                {fixedLengthPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setValue('fixedPageLengthMm', preset)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${(ps.fixedPageLengthMm || '100') === preset ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}
                  >
                    {paperWidthMm} × {preset}mm
                  </button>
                ))}
              </div>
              <div className="mt-2 max-w-[160px]">
                <label htmlFor="print-fixed-page-length" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_height_mm', 'Height (mm)')}</label>
                <input
                  id="print-fixed-page-length"
                  name="print_fixed_page_length"
                  autoComplete="off"
                  className="input text-sm"
                  type="number"
                  min="10"
                  max="2000"
                  value={ps.fixedPageLengthMm || '100'}
                  onChange={(event) => setValue('fixedPageLengthMm', event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {(ps.pageSizeMode || 'driver-forms') === 'driver-forms' ? (
            <div className="mt-3 max-w-[200px]">
              <div className="mb-1 flex items-center gap-1.5">
                <label htmlFor="print-driver-form-width" className="text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_driver_form_width', 'Paper width (mm)')}</label>
                <InfoHint
                  label={T('print_driver_forms_title', 'Printer paper width')}
                  text={T('print_driver_forms_hint', 'The printable width of the printer\'s paper, as Chrome\'s print dialog lists it (72 mm for 72 × 800 mm paper). The receipt prints at this width; the paper chosen in the print dialog sets the length.')}
                />
              </div>
              <input
                id="print-driver-form-width"
                name="print_driver_form_width"
                autoComplete="off"
                className="input text-sm"
                type="number"
                min="30"
                max="300"
                value={ps.driverFormWidthMm || '72'}
                onChange={(event) => setValue('driverFormWidthMm', event.target.value)}
              />
            </div>
          ) : null}

          <button
            type="button"
            className="btn-secondary mt-3 flex items-center gap-2 text-sm"
            onClick={async () => {
              try {
                await printReceipt(getPreviewSource(), {
                  title: T('receipt_test_pdf', 'Receipt Test'),
                  printSettings: testPrintSettings,
                })
              } catch (error) {
                console.error('[PrintSettings] Test print failed:', error)
                alert(`${T('print_test_failed', 'Test print failed')}: ${error instanceof Error ? error.message : T('unknown_error', 'unknown error')}`)
              }
            }}
          >
            <Printer className="h-4 w-4" />
            {T('print_test_this_mode', 'Test print this mode')}
          </button>
        </Section>
      ) : null}

      <Section icon={Printer} title={T('print_dark_bold_title', 'Receipt Text Darkness')}>
        <label
          htmlFor="print-high-contrast-bold"
          className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${
            ps.highContrastBold
              ? 'border-gray-950 bg-gray-50 dark:border-white dark:bg-zinc-800'
              : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-zinc-900'
          }`}
        >
          <input
            id="print-high-contrast-bold"
            name="print_high_contrast_bold"
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-black"
            checked={ps.highContrastBold}
            onChange={(event) => setValue('highContrastBold', event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-black dark:text-white">
              {T('print_dark_bold', 'Extra-dark bold receipt text')}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              {T('print_dark_bold_desc', 'Print every receipt label and value in solid black at bold weight for faint thermal printers.')}
            </span>
            {ps.highContrastBold ? (
              <span className="mt-2 inline-flex rounded-full bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-white dark:text-black">
                {T('print_dark_bold_enabled', 'Dark print enabled')}
              </span>
            ) : null}
          </span>
        </label>
      </Section>

      <Section icon={Ruler} title={T('print_margins', 'Margins (mm)')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {marginFields.map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`print-${key}`} className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
              <input id={`print-${key}`} name={`print_${key}`} autoComplete="off" className="input text-sm" type="number" min="0" max="30" value={ps[key] || '4'} onChange={(event) => setValue(key, event.target.value)} />
            </div>
          ))}
        </div>
        <button type="button" onClick={resetMargins} className="mt-2 text-xs text-blue-600 hover:underline">
          {T('print_set_zero', 'Set all to 0')}
        </button>
      </Section>

      <Section icon={Scaling} title={T('print_scale', 'Scale')}>
        <div className="flex items-center gap-3">
          <label htmlFor="print-scale-slider" className="sr-only">{T('print_scale', 'Scale')}</label>
          <input id="print-scale-slider" name="print_scale" autoComplete="off" className="flex-1" type="range" min="50" max="150" step="5" value={ps.scale || '100'} onChange={(event) => setValue('scale', event.target.value)} />
          <span className="w-12 text-right text-sm font-bold text-gray-700 dark:text-gray-300">{ps.scale || 100}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {['75', '90', '100', '110', '125'].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setValue('scale', value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${(ps.scale || '100') === value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}
            >
              {value}%
            </button>
          ))}
        </div>
      </Section>

      <Section icon={TestTube2} title={T('print_test_title', 'Test Print')}>
        <p className="mb-3 text-xs text-gray-500">{T('print_test_desc_pdf', 'Generate a sample PDF to verify sizing, margins, and readability.')}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary flex items-center gap-2 text-sm"
            onClick={async () => {
              try {
                await openReceiptPdf(getPreviewSource(), {
                  title: T('receipt_test_pdf', 'Receipt Test'),
                  fileName: 'receipt-test',
                  printSettings: testPrintSettings,
                  previewFallback: true,
                  previewFallbackNote: T('receipt_pdf_preview_fallback', 'PDF export was unavailable, so a printable receipt preview was opened instead.'),
                })
              } catch (error) {
                console.error('[PrintSettings] PDF preview failed:', error)
                alert(`${T('pdf_preview_failed', 'PDF preview failed')}: ${error instanceof Error ? error.message : T('unknown_error', 'unknown error')}`)
              }
            }}
          >
            <Printer className="h-4 w-4" />
            {T('open_test_pdf', 'Open Test PDF')}
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-2 text-sm"
            onClick={async () => {
              try {
                await downloadReceiptPdf(getPreviewSource(), {
                  title: T('receipt_test_pdf', 'Receipt Test'),
                  fileName: 'receipt-test',
                  printSettings: testPrintSettings,
                  previewFallback: true,
                  previewFallbackNote: T('receipt_pdf_preview_fallback', 'PDF export was unavailable, so a printable receipt preview was opened instead.'),
                })
              } catch (error) {
                console.error('[PrintSettings] PDF download failed:', error)
                alert(`${T('pdf_download_failed', 'PDF download failed')}: ${error instanceof Error ? error.message : T('unknown_error', 'unknown error')}`)
              }
            }}
          >
            <Download className="h-4 w-4" />
            {T('download_pdf', 'Download PDF')}
          </button>
        </div>
      </Section>
    </div>
  )
}

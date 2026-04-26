import { useState } from 'react'
import { Download, Printer, Ruler, Scaling, TestTube2 } from 'lucide-react'
import { downloadReceiptPdf, getPrintSettings, openReceiptPdf, savePrintSettings, PRINT_DEFAULTS } from '../../utils/printReceipt'

function Section({ icon: Icon, title, children }) {
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

export default function PrintSettings({ t: tProp }) {
  const T = (key, fallback) => (tProp && tProp(key)) || fallback
  const [ps, setPs] = useState(() => {
    try {
      return getPrintSettings()
    } catch (_) {
      return { ...PRINT_DEFAULTS }
    }
  })

  const setValue = (key, value) => {
    setPs((prev) => {
      const next = { ...prev, [key]: value }
      try { savePrintSettings(next) } catch (_) {}
      return next
    })
  }

  const resetMargins = () => {
    const next = { ...ps, marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0' }
    setPs(next)
    try { savePrintSettings(next) } catch (_) {}
  }

  const paperSizes = [
    { id: '58mm', label: '58mm', desc: T('print_narrow_thermal', 'Narrow thermal') },
    { id: '72mm', label: '72mm', desc: T('print_medium_thermal', 'Medium thermal') },
    { id: '80mm', label: '80mm', desc: T('print_standard_thermal', 'Standard thermal') },
    { id: 'A4', label: 'A4', desc: T('print_standard_office', 'Standard office') },
    { id: 'letter', label: 'Letter', desc: T('print_us_standard', 'US standard') },
    { id: 'custom', label: T('print_set_size', 'Custom'), desc: T('print_set_size', 'Set size') },
  ]

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
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_width_mm', 'Width (mm)')}</label>
              <input className="input text-sm" type="number" min="30" max="300" value={ps.customWidth || '80'} onChange={(event) => setValue('customWidth', event.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{T('print_height_mm', 'Height (mm)')}</label>
              <input className="input text-sm" type="number" min="50" max="1000" value={ps.customHeight || '297'} onChange={(event) => setValue('customHeight', event.target.value)} />
            </div>
          </div>
        ) : null}
      </Section>

      <Section icon={Ruler} title={T('print_margins', 'Margins (mm)')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ['marginTop', T('print_top', 'Top')],
            ['marginRight', T('print_right', 'Right')],
            ['marginBottom', T('print_bottom', 'Bottom')],
            ['marginLeft', T('print_left', 'Left')],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
              <input className="input text-sm" type="number" min="0" max="30" value={ps[key] || '4'} onChange={(event) => setValue(key, event.target.value)} />
            </div>
          ))}
        </div>
        <button type="button" onClick={resetMargins} className="mt-2 text-xs text-blue-600 hover:underline">
          {T('print_set_zero', 'Set all to 0')}
        </button>
      </Section>

      <Section icon={Scaling} title={T('print_scale', 'Scale')}>
        <div className="flex items-center gap-3">
          <input className="flex-1" type="range" min="50" max="150" step="5" value={ps.scale || '100'} onChange={(event) => setValue('scale', event.target.value)} />
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
                await openReceiptPdf(`
                  <div style="padding:8px;text-align:center;">
                    <div style="font-size:16px;font-weight:bold;margin-bottom:4px;">Business OS</div>
                    <div style="font-size:11px;color:#555;margin-bottom:8px;">Test Receipt</div>
                    <div style="border-top:1px dashed #000;margin:6px 0;"></div>
                    <div style="font-size:12px;text-align:left;">
                      <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 1 x2</span><span>$10.00</span></div>
                      <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 2 x1</span><span>$5.50</span></div>
                    </div>
                    <div style="border-top:1px dashed #000;margin:6px 0;"></div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;gap:16px;"><span>TOTAL</span><span>$15.50</span></div>
                    <div style="margin-top:10px;font-size:10px;color:#777;">Paper: ${ps?.paperSize || '80mm'} | Scale: ${ps?.scale || 100}%</div>
                    <div style="margin-top:4px;font-size:10px;">Thank you!</div>
                  </div>
                `, {
                  title: T('receipt_test_pdf', 'Receipt Test'),
                  fileName: 'receipt-test',
                })
              } catch (error) {
                console.error('[PrintSettings] PDF preview failed:', error)
                alert(`${T('pdf_preview_failed', 'PDF preview failed')}: ${error?.message || T('unknown_error', 'unknown error')}`)
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
                await downloadReceiptPdf(`
                  <div style="padding:8px;text-align:center;">
                    <div style="font-size:16px;font-weight:bold;margin-bottom:4px;">Business OS</div>
                    <div style="font-size:11px;color:#555;margin-bottom:8px;">Test Receipt</div>
                    <div style="border-top:1px dashed #000;margin:6px 0;"></div>
                    <div style="font-size:12px;text-align:left;">
                      <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 1 x2</span><span>$10.00</span></div>
                      <div style="display:flex;justify-content:space-between;gap:16px;"><span>Item 2 x1</span><span>$5.50</span></div>
                    </div>
                    <div style="border-top:1px dashed #000;margin:6px 0;"></div>
                    <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;gap:16px;"><span>TOTAL</span><span>$15.50</span></div>
                    <div style="margin-top:10px;font-size:10px;color:#777;">Paper: ${ps?.paperSize || '80mm'} | Scale: ${ps?.scale || 100}%</div>
                    <div style="margin-top:4px;font-size:10px;">Thank you!</div>
                  </div>
                `, {
                  title: T('receipt_test_pdf', 'Receipt Test'),
                  fileName: 'receipt-test',
                })
              } catch (error) {
                console.error('[PrintSettings] PDF download failed:', error)
                alert(`${T('pdf_download_failed', 'PDF download failed')}: ${error?.message || T('unknown_error', 'unknown error')}`)
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

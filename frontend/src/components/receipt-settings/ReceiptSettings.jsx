
import { useState, useEffect, useRef, useCallback } from 'react'
import { Eye, Globe, LayoutList, Palette, Printer, Save, Truck, Type } from 'lucide-react'
import ErrorBoundary from './ErrorBoundary'
import { useApp } from '../../AppContext'
import { DEFAULT_TEMPLATE } from './constants'
import FieldOrderManager from './FieldOrderManager'
import AllFieldsPanel    from './AllFieldsPanel'
import ReceiptPreview    from './ReceiptPreview'
import PrintSettings     from './PrintSettings'
import { withLoaderTimeout } from '../../utils/loaders.mjs'

// ----- Shared primitives (defined locally to avoid circular imports) ----------
function Section({ title, children }) {
  return (
    <div className="card p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Toggle({ label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-2 cursor-pointer select-none" onClick={() => onChange(!value)}>
      <div className="flex-1 min-w-0 mr-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
        {desc && <div className="text-xs text-gray-400 mt-0.5">{desc}</div>}
      </div>
      <div className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
    </div>
  )
}
// -----------------------------------------------------------------------------

function parseTemplate(str) {
  try { return { ...DEFAULT_TEMPLATE, ...(typeof str === 'string' ? JSON.parse(str) : str) } }
  catch { return { ...DEFAULT_TEMPLATE } }
}

export default function ReceiptSettings() {
  console.debug('[ReceiptSettings] render start')
  const app = useApp()
  const t = (typeof app?.t === 'function') ? app.t : (k => k)
  const settings = app?.settings || {}
  const loadSettings = app?.loadSettings || (async () => ({}))
  const notify = app?.notify || (() => {})
  const fmtUSD = app?.fmtUSD || (n => String(n))
  const fmtKHR = app?.fmtKHR || (n => String(n))

  const [tpl, setTpl]               = useState(DEFAULT_TEMPLATE)
  const [activeSection, setActiveSection] = useState('fields')
  const [previewOpen, setPreviewOpen]     = useState(false)
  const [saving, setSaving]               = useState(false)

  // Refs for stable references inside effects (avoids stale closures)
  const saveTimerRef     = useRef(null)
  const isMountedRef     = useRef(false)   // guard: skip auto-save on first render
  const loadSettingsRef  = useRef(loadSettings)
  const saveInFlightRef  = useRef(false)
  const queuedSaveRef    = useRef(null)
  const aliveRef         = useRef(true)

  // Keep loadSettings ref current without re-triggering effects
  useEffect(() => { loadSettingsRef.current = loadSettings }, [loadSettings])
  useEffect(() => () => {
    aliveRef.current = false
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  // Initialise tpl once persisted settings arrive from the server
  useEffect(() => {
    if (settings.receipt_template) {
      setTpl(parseTemplate(settings.receipt_template))
    }
  }, [settings.receipt_template])

  // Shallow field updater
  const setT = useCallback((key, val) => setTpl(prev => ({ ...prev, [key]: val })), [])

  const persistTemplate = useCallback(async ({ silent = false, showToast = false } = {}) => {
    const options = { silent: !!silent, showToast: !!showToast }
    if (saveInFlightRef.current) {
      queuedSaveRef.current = {
        silent: Boolean(queuedSaveRef.current?.silent && options.silent),
        showToast: Boolean(queuedSaveRef.current?.showToast || options.showToast),
      }
      if (!options.silent && aliveRef.current) setSaving(true)
      return
    }

    saveInFlightRef.current = true
    if (!options.silent && aliveRef.current) setSaving(true)

    try {
      await withLoaderTimeout(
        () => window.api.saveSettings({ receipt_template: JSON.stringify(tpl) }),
        'Receipt settings save',
      )

      if (options.showToast) {
        try {
          await withLoaderTimeout(() => loadSettingsRef.current(), 'Receipt settings refresh')
        } catch (_) {}
        notify((t('receipt_settings') || 'Receipt settings') + ' ' + (t('success') || 'saved'))
      } else {
        Promise.resolve(loadSettingsRef.current()).catch(() => {})
      }
    } catch (error) {
      if (options.showToast) {
        notify(error?.message || 'Save failed - check server connection', 'error')
      }
    } finally {
      saveInFlightRef.current = false
      if (!options.silent && aliveRef.current) setSaving(false)

      const queued = queuedSaveRef.current
      queuedSaveRef.current = null
      if (queued && aliveRef.current) {
        window.setTimeout(() => {
          if (aliveRef.current) persistTemplate(queued)
        }, 0)
      }
    }
  }, [notify, t, tpl])

  // ?? Auto-save (debounced 900 ms, completely silent) ????????????????????????
  // KEY FIX: The `isMountedRef` guard prevents this effect from firing on the
  // initial render when `tpl` is still DEFAULT_TEMPLATE. Without the guard the
  // auto-save would POST DEFAULT_TEMPLATE to the server ~900 ms after opening
  // the page, OVERWRITING whatever the user had previously configured.
  //
  // KEY FIX: The try/catch prevents unhandled promise rejections when the server
  // is temporarily unreachable. In minified React builds, unhandled rejections
  // that bubble into the scheduler's async work loop cause "TypeError: r is not
  // a function" crashes with opaque stack traces. Swallowing the error here is
  // intentional ??the WS connection and health-check will recover automatically.
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      return
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      persistTemplate({ silent: true, showToast: false })
    }, 900)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [persistTemplate]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?? Manual save with user feedback ????????????????????????????????????????
  // Calls window.api.saveSettings directly (not AppContext.saveSettings) to avoid
  // the double-notification bug: AppContext.saveSettings calls notify() internally,
  // and the old code called notify() again after it returned, producing two toasts.
  const handleSave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await persistTemplate({ silent: false, showToast: true })
  }

  const SECTIONS = [
    { id: 'fields', label: t('receipt_fields') || 'All Fields', icon: LayoutList },
    { id: 'order', label: t('receipt_order') || 'Field Order', icon: LayoutList },
    { id: 'delivery', label: t('receipt_delivery') || 'Delivery', icon: Truck },
    { id: 'style', label: t('receipt_style') || 'Appearance', icon: Palette },
    { id: 'language', label: t('receipt_language') || 'Language', icon: Globe },
    { id: 'footer', label: t('receipt_footer_tab') || 'Footer', icon: Type },
    { id: 'print', label: t('receipt_print') || 'Print', icon: Printer },
  ]

  return (
    <ErrorBoundary>
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-zinc-950 lg:flex-row">

      {/* ?? Editor panel ?? */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-zinc-950">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/95 px-4 pb-3 pt-4 backdrop-blur dark:border-gray-800 dark:bg-zinc-950/95 sm:px-6 sm:pt-6">
          <h1 className="flex min-w-0 flex-1 items-center gap-2 truncate text-lg font-bold text-gray-900 dark:text-white sm:text-2xl">
            <Printer className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('receipt_template')}
          </h1>
          <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button onClick={() => setPreviewOpen(true)} className="btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:hidden">
              <Eye className="h-4 w-4" />
              {t('preview') || 'Preview'}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="btn-primary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm">
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : (t('save') || 'Save')}
            </button>
          </div>
        </div>

        <div className="mb-4 flex gap-1 overflow-x-auto bg-gray-50 px-4 pb-1 dark:bg-zinc-950 sm:flex-wrap sm:px-6 sm:overflow-visible">
          {SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <button key={section.id} onClick={() => setActiveSection(section.id)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 ${activeSection === section.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                </span>
              </button>
            )
          })}
        </div>

        <div className="page-scroll px-4 pb-24 sm:px-6 sm:pb-6">

          {activeSection === 'fields' && (
            <AllFieldsPanel tpl={tpl} setT={setT} />
          )}

          {activeSection === 'order' && (
            <Section title={t('receipt_section_order_title') || 'Receipt Section Order'}>
              <FieldOrderManager
                order={tpl.field_order}
                onChange={newOrder => setT('field_order', newOrder)}
                t={t}
              />
            </Section>
          )}

          {activeSection === 'delivery' && (
            <>
              <Section title={t('delivery_on_receipt') || 'Delivery on Receipt'}>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 mb-3 text-xs text-orange-700 dark:text-orange-400">
                  {t('receipt_delivery') || 'These settings control how delivery information appears on printed receipts for delivery orders.'}
                </div>
                <Toggle label={t('show_delivery_contact') || 'Enable Delivery Contact Section'} desc={t('rfd_delivery_show_contact') || 'Master switch for delivery contact information'} value={tpl.delivery_show_contact !== false} onChange={v => setT('delivery_show_contact', v)} />
                <Toggle label={t('show_delivery_driver_name') || 'Show Driver Name'} desc={t('rfd_delivery_driver_name') || 'Display driver/rider name'} value={tpl.delivery_show_driver_name !== false} onChange={v => setT('delivery_show_driver_name', v)} />
                <Toggle label={t('show_delivery_driver_phone') || 'Show Driver Phone'} desc={t('rfd_delivery_driver_phone') || 'Display driver/rider phone number'} value={tpl.delivery_show_driver_phone !== false} onChange={v => setT('delivery_show_driver_phone', v)} />
                <Toggle label={t('show_delivery_address') || 'Show Delivery Address'} desc={t('rfd_delivery_show_address') || 'Destination address on receipt'} value={!!tpl.delivery_show_address} onChange={v => setT('delivery_show_address', v)} />
                <Toggle label={t('show_delivery_fee') || 'Show Delivery Fee'} desc={t('rfd_delivery_show_fee') || 'Delivery fee line in totals'} value={!!tpl.delivery_show_fee} onChange={v => setT('delivery_show_fee', v)} />
              </Section>

              <Section title={t('delivery_fee_position') || 'Delivery Fee Position'}>
                <div className="space-y-2">
                  {[
                    ['totals',      t('totals_section') || 'In Totals Section',   t('delivery_position_totals_desc') || 'Appears with subtotal, discount, tax (recommended)'],
                    ['after_items', t('delivery_fee_position_after') || 'After Items List', t('delivery_position_after_desc') || 'Appears right after the items, before totals'],
                  ].map(([val, label, desc]) => (
                    <button key={val} onClick={() => setT('delivery_fee_position', val)}
                      className={`w-full p-3 rounded-xl border-2 text-left ${tpl.delivery_fee_position === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                      <div className={`text-sm font-medium ${tpl.delivery_fee_position === val ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                    </button>
                  ))}
                </div>
              </Section>

              <Section title={t('discount_settings') || 'Discount Settings'}>
                <Toggle label={t('show_discount_receipt') || 'Show Discount on Receipt'} desc={t('rfd_show_discount') || 'Display discount line when a discount was applied'} value={!!tpl.show_discount} onChange={v => setT('show_discount', v)} />
                <div className="mt-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">{t('discount_position') || 'Discount Position'}</label>
                  <div className="space-y-2">
                    {[
                      ['before_tax',     t('discount_before_tax') || 'Before Tax',             t('discount_before_tax_desc') || 'Discount -> Tax -> Total (standard)'],
                      ['after_subtotal', t('discount_after_subtotal') || 'Right After Subtotal', t('discount_after_subtotal_desc') || 'Subtotal -> Discount -> Tax -> Total'],
                    ].map(([val, label, desc]) => (
                      <button key={val} onClick={() => setT('discount_position', val)}
                        className={`w-full p-3 rounded-xl border-2 text-left ${(tpl.discount_position || 'before_tax') === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                        <div className={`text-sm font-medium ${(tpl.discount_position || 'before_tax') === val ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{label}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </Section>
            </>
          )}

          {activeSection === 'style' && (
            <>
              <Section title={t('receipt_font') || 'Font'}>
                <label className="text-sm text-gray-700 dark:text-gray-300 block mb-2">{t('font_family_label') || 'Font Family'}</label>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[['monospace', t('font_monospace') || 'Monospace'], ['sans', t('font_sans') || 'Sans-serif'], ['serif', t('font_serif') || 'Serif']].map(([val, label]) => (
                    <button key={val} onClick={() => setT('font_family', val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${tpl.font_family === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="text-sm text-gray-700 dark:text-gray-300 block mb-2">{t('font_size_label') || 'Font Size'}: {tpl.font_size}px</label>
                <input type="range" min="9" max="16" value={tpl.font_size} onChange={e => setT('font_size', parseInt(e.target.value))} className="w-full" />
              </Section>
              <Section title={t('header_alignment') || 'Header Alignment'}>
                <div className="grid grid-cols-3 gap-2">
                  {[['left', t('align_left') || 'Left'], ['center', t('align_center') || 'Center'], ['right', t('align_right') || 'Right']].map(([val, label]) => (
                    <button key={val} onClick={() => setT('align_header', val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${tpl.align_header === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title={t('separator_chars') || 'Separator Characters'}>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-500 mb-1 block">{t('header_separator') || 'Header Separator'}</label><input className="input w-24" value={tpl.header_separator} onChange={e => setT('header_separator', e.target.value)} maxLength={2} placeholder="==" /></div>
                  <div><label className="text-xs text-gray-500 mb-1 block">{t('footer_separator') || 'Footer Separator'}</label><input className="input w-24" value={tpl.footer_separator} onChange={e => setT('footer_separator', e.target.value)} maxLength={2} placeholder="--" /></div>
                  <div><label className="text-xs text-gray-500 mb-1 block">{t('separator') || 'Item Separator'}</label><input className="input w-24" value={tpl.line_char} onChange={e => setT('line_char', e.target.value)} maxLength={2} placeholder="-" /></div>
                </div>
              </Section>
            </>
          )}

          {activeSection === 'language' && (
            <Section title={t('receipt_language_title') || 'Receipt Language'}>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4 text-xs text-blue-700 dark:text-blue-400">
                {t('receipt_language_desc') || 'Sets the default language for printed receipts.'}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[['en', 'English', 'English only'], ['km', 'Khmer', 'Khmer only'], ['both', 'Both', 'Bilingual EN + KH']].map(([code, lbl, desc]) => (
                  <button key={code} onClick={() => setT('receipt_language', code)}
                    className={`p-3 rounded-xl border-2 text-left ${(tpl.receipt_language || 'en') === code ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                    <div className={`text-sm font-medium mb-1 ${(tpl.receipt_language || 'en') === code ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{lbl}</div>
                    <div className="text-xs text-gray-400">{desc}</div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {activeSection === 'footer' && (
            <>
              <Section title={t('footer_message_title') || 'Footer Message'}>
                <label className="text-xs text-gray-500 mb-1 block">{t('custom_footer_text') || 'Custom footer text'}</label>
                <textarea className="input resize-none" rows={3}
                  value={tpl.custom_footer}
                  onChange={e => setT('custom_footer', e.target.value)}
                  placeholder={settings.receipt_footer || 'Thank you for your business!'}
                />
              </Section>
              <Section title={t('custom_header_text') || 'Custom Header Text'}>
                <input className="input mb-3" value={tpl.custom_header} onChange={e => setT('custom_header', e.target.value)} placeholder="e.g. ** OFFICIAL RECEIPT **" />
              </Section>
            </>
          )}

          {activeSection === 'print' && <PrintSettings t={t} />}

        </div>
      </div>

      {/* ?? Live Preview (desktop sidebar) ?? */}
      <div className="hidden min-h-0 w-96 flex-shrink-0 flex-col border-l border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-zinc-900 lg:flex">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gray-100 p-4 dark:border-gray-800 dark:bg-zinc-900">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
            <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {t('live_preview')}
          </h2>
          <div className="flex gap-1">
            {[['en', 'EN'], ['km', 'KH'], ['both', 'Both']].map(([code, lbl]) => (
              <button key={code} onClick={() => setT('receipt_language', code)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium ${(tpl.receipt_language || 'en') === code ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto min-h-0 p-4">
          <ReceiptPreview tpl={tpl} settings={settings} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 lg:hidden sm:items-center" onClick={() => setPreviewOpen(false)}>
          <div className="bg-gray-100 dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:w-96 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
                <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                {t('live_preview')}
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[['en', 'EN'], ['km', 'KH'], ['both', 'Both']].map(([code, lbl]) => (
                    <button key={code} onClick={() => setT('receipt_language', code)}
                      className={`px-2 py-0.5 text-xs rounded font-medium ${(tpl.receipt_language || 'en') === code ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <button onClick={() => setPreviewOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-lg leading-none" aria-label="Close preview">x</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto min-h-0 p-4">
              <ReceiptPreview tpl={tpl} settings={settings} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
            </div>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  )
}




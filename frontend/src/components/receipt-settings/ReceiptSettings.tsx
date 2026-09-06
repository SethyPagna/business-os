
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import LayoutList from 'lucide-react/dist/esm/icons/layout-list.js'
import Palette from 'lucide-react/dist/esm/icons/palette.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import QrCodeIcon from 'lucide-react/dist/esm/icons/qr-code.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import Type from 'lucide-react/dist/esm/icons/type.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ErrorBoundary from './ErrorBoundary'
import { useApp } from '../../AppContext.tsx'
import { DEFAULT_TEMPLATE } from './constants'
import type { ReceiptTemplate, ReceiptQrSocialLink } from './constants'
import { parseReceiptTemplate, serializeReceiptTemplate } from './template'
import FieldOrderManager from './FieldOrderManager'
import AllFieldsPanel    from './AllFieldsPanel'
import ReceiptPreview    from './ReceiptPreview'
import PrintSettings     from './PrintSettings'
import AppSelect from '../shared/AppSelect.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { withLoaderTimeout } from '../../utils/loaders.ts'
import { buildAppliedReceiptConfig } from '../../utils/receiptAppliedConfig.ts'
import { normalizeSocialQrUrl } from '../../utils/socialQrLink.ts'
import { normalizeReceiptTextContrast } from '../../utils/receiptTextContrast.ts'

const RECEIPT_SETTINGS_SAVE_TIMEOUT_MS = 12000
const RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS = 10000

type Translate = (key: string, fallback?: string) => string
type AppSettings = Record<string, unknown> & {
  receipt_footer?: string
  receipt_template?: unknown
}
type SaveSettingsOptions = {
  silentToast?: boolean
  refreshChannels?: string[]
  reason?: string
  skipExpectedUpdatedAt?: boolean
  source?: string
}
type SaveSettingsResult = {
  success?: boolean
  conflict?: boolean
  actualUpdatedAt?: string | null
  error?: unknown
}
type SaveSettings = (
  settings: Record<string, unknown>,
  options?: SaveSettingsOptions,
) => Promise<SaveSettingsResult | void> | SaveSettingsResult | void
type LoadSettings = () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
type Notify = (message: string, type?: string) => void
type ReceiptSettingsApp = {
  t?: Translate
  settings?: AppSettings
  loadSettings?: LoadSettings
  saveSettings?: SaveSettings
  notify?: Notify
}
type SectionId = 'fields' | 'order' | 'delivery' | 'style' | 'language' | 'footer' | 'qr' | 'print'
type SectionConfig = {
  id: SectionId
  label: string
  icon: LucideIcon
}
type PersistOptions = {
  silent?: boolean
  showToast?: boolean
}
type SectionProps = {
  title: string
  children: ReactNode
}
type ToggleProps = {
  label: string
  desc?: string
  value: boolean
  onChange: (value: boolean) => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// ----- Shared primitives (defined locally to avoid circular imports) ----------
function Section({ title, children }: SectionProps) {
  return (
    <div className="card p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Toggle({ label, desc, value, onChange }: ToggleProps) {
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
// ----- QR Codes tab -----------------------------------------------------------
function looksLikeAdminUrl(rawUrl: string): boolean {
  if (typeof window === 'undefined' || !rawUrl) return false
  try {
    const parsed = new URL(rawUrl, window.location.origin)
    if (parsed.origin !== window.location.origin) return false
    const path = parsed.pathname.toLowerCase()
    const publicMarkers = ['/customer-portal', '/portal', '/shop', '/catalog', '/store']
    if (publicMarkers.some((marker) => path.startsWith(marker))) return false
    const adminMarkers = [
      '/dashboard', '/pos', '/settings', '/login', '/admin', '/inventory',
      '/sales', '/products', '/customers', '/suppliers', '/branches',
      '/reports', '/delivery', '/receipt-settings',
    ]
    if (adminMarkers.some((marker) => path.startsWith(marker))) return true
    return path === '' || path === '/'
  } catch {
    return false
  }
}

function newSocialLinkId(): string {
  return `qr-social-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

type ReceiptQrSettingsTabProps = {
  tpl: ReceiptTemplate
  setT: (key: string, val: unknown) => void
  t: Translate
}

function ReceiptQrSettingsTab({ tpl, setT, t }: ReceiptQrSettingsTabProps) {
  const socialLinks: ReceiptQrSocialLink[] = Array.isArray(tpl.qr_social_links) ? tpl.qr_social_links : []
  const portalUrl = tpl.qr_portal_url || ''
  const showAdminWarning = looksLikeAdminUrl(portalUrl)

  const updateSocialLink = (id: string, patch: Partial<ReceiptQrSocialLink>) => {
    setT('qr_social_links', socialLinks.map((link) => (link.id === id ? { ...link, ...patch } : link)))
  }
  const removeSocialLink = (id: string) => {
    setT('qr_social_links', socialLinks.filter((link) => link.id !== id))
  }
  const addSocialLink = () => {
    setT('qr_social_links', [...socialLinks, { id: newSocialLinkId(), label: '', url: '' }])
  }

  return (
    <>
      <Section title={t('receipt_qr_codes_title') || 'QR Codes on Receipt'}>
        <div className="mb-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
          {t('receipt_qr_codes_desc') || 'Add scannable QR codes to the bottom of every printed and PDF receipt, linking customers to your online shop or social pages.'}
        </div>
        <Toggle
          label={t('show_qr_codes') || 'Show QR codes on receipt'}
          desc={t('rfd_show_qr_codes') || 'Master switch for the QR code block at the end of the receipt'}
          value={!!tpl.show_qr_codes}
          onChange={(v) => setT('show_qr_codes', v)}
        />
      </Section>

      {tpl.show_qr_codes && (
        <>
          <Section title={t('receipt_qr_portal_title') || 'Online Shop / Portal Link'}>
            <Toggle
              label={t('show_qr_portal') || 'Show shop link QR code'}
              desc={t('rfd_show_qr_portal') || 'Lets customers scan to open your public catalog'}
              value={tpl.qr_show_portal !== false}
              onChange={(v) => setT('qr_show_portal', v)}
            />
            {tpl.qr_show_portal !== false && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="qr-portal-url" className="mb-1 block text-xs text-gray-500">{t('qr_portal_url_label') || 'Public portal URL'}</label>
                  <input
                    id="qr-portal-url"
                    name="qr_portal_url"
                    autoComplete="off"
                    className="input"
                    placeholder="https://yourstore.example.com/customer-portal"
                    value={portalUrl}
                    onChange={(e) => setT('qr_portal_url', e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="qr-portal-label" className="mb-1 block text-xs text-gray-500">{t('qr_portal_label_label') || 'Label shown under the QR code'}</label>
                  <input
                    id="qr-portal-label"
                    name="qr_portal_label"
                    autoComplete="off"
                    className="input"
                    placeholder={t('qr_scan_shop') || 'Shop Online'}
                    value={tpl.qr_portal_label || ''}
                    onChange={(e) => setT('qr_portal_label', e.target.value)}
                  />
                </div>
                {showAdminWarning && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{t('qr_admin_url_warning') || 'This looks like a link to your admin dashboard, not your public customer portal. Printing this on a receipt could let a customer open (or attempt to log into) your store management pages. Use your public catalog/portal link instead.'}</span>
                  </div>
                )}
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{t('qr_public_url_safety_note') || 'Only ever put your public, customer-facing link here. Never paste an admin/staff login link — anyone who scans the receipt can open it.'}</span>
                </div>
              </div>
            )}
          </Section>

          <Section title={t('receipt_qr_social_title') || 'Social Links'}>
            <Toggle
              label={t('show_qr_social') || 'Show social link QR codes'}
              desc={t('rfd_show_qr_social') || 'Add extra QR codes for Facebook, Telegram, or other pages'}
              value={!!tpl.qr_show_social}
              onChange={(v) => setT('qr_show_social', v)}
            />
            {tpl.qr_show_social && (
              <div className="mt-3 space-y-3">
                {socialLinks.length === 0 && (
                  <div className="text-xs text-gray-400">{t('qr_no_social_links') || 'No social links added yet.'}</div>
                )}
                {socialLinks.map((link) => {
                  // Live-detected platform + deep-link reliability check
                  // (see socialQrLink.ts's own header comment) -- shown
                  // per-link so a shop owner sees immediately if a pasted
                  // URL won't open the app directly when scanned, instead
                  // of only finding out from a customer's phone later.
                  const detected = link.url.trim() ? normalizeSocialQrUrl(link.url) : null
                  return (
                  <div key={link.id} className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="flex-1 space-y-2">
                      <input
                        className="input"
                        placeholder={t('qr_social_label_placeholder') || 'Label (e.g. Facebook Page)'}
                        value={link.label}
                        onChange={(e) => updateSocialLink(link.id, { label: e.target.value })}
                        autoComplete="off"
                      />
                      <input
                        className="input"
                        placeholder="https://facebook.com/yourpage"
                        value={link.url}
                        onChange={(e) => updateSocialLink(link.id, { url: e.target.value })}
                        autoComplete="off"
                      />
                      {detected && !detected.warning && detected.platform !== 'other' && (
                        <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          {(t('qr_detected_platform') || 'Detected: {platform} \u2014 will open the app directly when scanned').replace('{platform}', detected.platformLabel)}
                        </div>
                      )}
                      {detected?.warning && (
                        <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          <span>{detected.warning}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSocialLink(link.id)}
                      className="mt-1 flex-shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                      title={t('remove') || 'Remove'}
                      aria-label={t('remove') || 'Remove'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  )
                })}
                {socialLinks.length < 8 && (
                  <button type="button" onClick={addSocialLink} className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                    <Plus className="h-3.5 w-3.5" />
                    {t('qr_add_social_link') || 'Add social link'}
                  </button>
                )}
              </div>
            )}
          </Section>
        </>
      )}

      <Section title={t('sales_receipt_title') || '80 × 50mm ABA Sales Receipt'}>
        <Toggle
          label={t('sales_receipt_enabled') || 'Use compact 80 × 50mm sales receipt'}
          desc={t('sales_receipt_enabled_desc') || 'Shows shop and customer details, total, ABA payment details, and an optional payment note.'}
          value={tpl.sales_receipt_enabled === true}
          onChange={(value) => setT('sales_receipt_enabled', value)}
        />
        {tpl.sales_receipt_enabled ? (
          <div className="mt-3 space-y-3">
            <input className="input" aria-label="ABA account name" placeholder={t('aba_account_name') || 'ABA account name'} value={tpl.sales_receipt_aba_account_name || ''} onChange={(event) => setT('sales_receipt_aba_account_name', event.target.value)} />
            <input className="input" aria-label="ABA account number" placeholder={t('aba_account_number') || 'ABA account number'} value={tpl.sales_receipt_aba_account_number || ''} onChange={(event) => setT('sales_receipt_aba_account_number', event.target.value)} />
            <input className="input" aria-label="ABA QR image" placeholder={t('aba_qr_image') || 'ABA QR image URL'} value={tpl.sales_receipt_aba_qr_image || ''} onChange={(event) => setT('sales_receipt_aba_qr_image', event.target.value)} />
            <AppSelect
              value={tpl.sales_receipt_note || 'none'}
              onChange={(value) => setT('sales_receipt_note', value)}
              ariaLabel={t('payment_note') || 'Payment note'}
              className="w-full"
              buttonClassName="h-10 w-full"
              options={[
                { value: 'none', label: t('none') || 'None' },
                { value: 'received_payment', label: t('received_payment') || 'Received payment' },
              ]}
            />
          </div>
        ) : null}
      </Section>
    </>
  )
}
// -----------------------------------------------------------------------------

export default function ReceiptSettings() {
  console.debug('[ReceiptSettings] render start')
  const useReceiptSettingsApp = useApp as unknown as () => ReceiptSettingsApp | null
  const app = useReceiptSettingsApp()
  const t: Translate = (typeof app?.t === 'function') ? app.t : ((key) => key)
  const settings: AppSettings = app?.settings || {}
  const loadSettings: LoadSettings = app?.loadSettings || (async () => ({}))
  const saveSettings: SaveSettings = app?.saveSettings || (async () => ({ success: false, error: new Error('Settings save unavailable') }))
  const notify: Notify = app?.notify || (() => {})

  const [tpl, setTpl]               = useState<ReceiptTemplate>(DEFAULT_TEMPLATE)
  const [defaultFooter, setDefaultFooter] = useState<string>('')
  const [activeSection, setActiveSection] = useState<SectionId>('fields')
  const [previewOpen, setPreviewOpen]     = useState(false)
  const [saving, setSaving]               = useState(false)

  // Refs for stable references inside effects (avoids stale closures)
  const latestTemplateRef = useRef<ReceiptTemplate>(DEFAULT_TEMPLATE)
  const saveTimerRef     = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const isMountedRef     = useRef(false)   // guard: skip auto-save on first render
  const loadSettingsRef  = useRef<LoadSettings>(loadSettings)
  const saveInFlightRef  = useRef(false)
  const queuedSaveRef    = useRef<PersistOptions | null>(null)
  const aliveRef         = useRef(true)
  const previewTargetRef = useRef<HTMLDivElement | null>(null)
  const persistedTemplateRef = useRef('')
  const suppressNextAutoSaveRef = useRef(false)
  const persistedFooterRef = useRef('')
  const suppressNextFooterAutoSaveRef = useRef(false)
  const footerSaveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  latestTemplateRef.current = tpl

  // Keep loadSettings ref current without re-triggering effects
  useEffect(() => { loadSettingsRef.current = loadSettings }, [loadSettings])
  useEffect(() => () => {
    aliveRef.current = false
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (footerSaveTimerRef.current) clearTimeout(footerSaveTimerRef.current)
  }, [])

  // Initialise the default (fallback) footer once persisted settings arrive.
  // This mirrors the receipt_template hydrate effect just below, but is its
  // own independent field on the flat `settings` object rather than part of
  // the per-template `tpl` blob, since it moved here from the generic
  // Settings page (Part 188) and is saved separately from the template.
  useEffect(() => {
    const incoming = String(settings.receipt_footer || '')
    persistedFooterRef.current = incoming
    suppressNextFooterAutoSaveRef.current = true
    setDefaultFooter(incoming)
  }, [settings.receipt_footer])

  // Initialise tpl once persisted settings arrive from the server
  useEffect(() => {
    if (settings.receipt_template) {
      const parsed = parseReceiptTemplate(settings.receipt_template)
      persistedTemplateRef.current = serializeReceiptTemplate(parsed)
      suppressNextAutoSaveRef.current = true
      setTpl(parsed)
    }
  }, [settings.receipt_template])

  // Shallow field updater
  const setT = useCallback((key: string, val: unknown) => {
    setTpl((prev) => ({ ...prev, [key]: val }) as ReceiptTemplate)
  }, [])

  const persistTemplate = useCallback(async ({ silent = false, showToast = false }: PersistOptions = {}) => {
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
      const templateToPersist = latestTemplateRef.current
      const serializedTemplate = serializeReceiptTemplate(templateToPersist)
      const saveOptions = {
        silentToast: !options.showToast,
        refreshChannels: ['settings', 'sales', 'pos', 'dashboard'],
        reason: 'receipt-template-saved',
        source: options.showToast ? 'receipt-settings:manual-save' : 'receipt-settings:auto-save',
      }
      let result = await withLoaderTimeout(
        () => saveSettings(
          { receipt_template: serializedTemplate },
          saveOptions,
        ),
        'Receipt settings save',
        RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,
      )
      for (let attempt = 0; result?.conflict && result?.actualUpdatedAt && attempt < 3; attempt += 1) {
        result = await withLoaderTimeout(
          () => saveSettings(
            { receipt_template: serializedTemplate, expectedUpdatedAt: result?.actualUpdatedAt },
            saveOptions,
          ),
          'Receipt settings conflict retry',
          RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,
        )
      }
      if (result?.conflict) {
        result = await withLoaderTimeout(
          () => saveSettings(
            { receipt_template: serializedTemplate },
            { ...saveOptions, skipExpectedUpdatedAt: true },
          ),
          'Receipt settings conflict fallback',
          RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,
        )
      }
      if (result?.conflict) {
        throw new Error(t('settings_conflict') || 'Settings changed on another device. Reload and try again.')
      }
      persistedTemplateRef.current = serializedTemplate

      if (options.showToast) {
        try {
          await withLoaderTimeout(
            () => loadSettingsRef.current(),
            'Receipt settings refresh',
            RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS,
          )
        } catch (_) {}
      } else {
        void withLoaderTimeout(
          () => loadSettingsRef.current(),
          'Receipt settings silent refresh',
          RECEIPT_SETTINGS_REFRESH_TIMEOUT_MS,
        ).catch(() => {})
      }
    } catch (error) {
      if (options.showToast) {
        notify(getErrorMessage(error, 'Save failed - check server connection'), 'error')
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
  }, [notify, saveSettings, t])

  // ?€?€ Auto-save (debounced 900 ms, completely silent) ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
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
    const serialized = serializeReceiptTemplate(tpl)
    if (suppressNextAutoSaveRef.current || serialized === persistedTemplateRef.current) {
      suppressNextAutoSaveRef.current = false
      return
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      persistTemplate({ silent: true, showToast: false })
    }, 900)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [persistTemplate, tpl])

  // Independent debounced autosave for the default footer, same 900ms/silent
  // pattern as the template effect above, kept separate so an in-progress
  // footer edit never gets bundled into (or blocked by) a template save.
  useEffect(() => {
    if (suppressNextFooterAutoSaveRef.current || defaultFooter === persistedFooterRef.current) {
      suppressNextFooterAutoSaveRef.current = false
      return
    }
    if (footerSaveTimerRef.current) clearTimeout(footerSaveTimerRef.current)
    footerSaveTimerRef.current = setTimeout(() => {
      const valueToPersist = defaultFooter
      withLoaderTimeout(
        () => saveSettings(
          { receipt_footer: valueToPersist },
          { silentToast: true, refreshChannels: ['settings', 'sales', 'pos', 'dashboard'], reason: 'receipt-default-footer-saved', source: 'receipt-settings:auto-save' },
        ),
        'Receipt default footer save',
        RECEIPT_SETTINGS_SAVE_TIMEOUT_MS,
      ).then((result) => {
        if (!aliveRef.current) return
        if (!result?.conflict) persistedFooterRef.current = valueToPersist
      }).catch(() => {})
    }, 900)
    return () => { if (footerSaveTimerRef.current) clearTimeout(footerSaveTimerRef.current) }
  }, [defaultFooter, saveSettings])

  // ?€?€ Manual save with user feedback ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
  // Calls window.api.saveSettings directly (not AppContext.saveSettings) to avoid
  // the double-notification bug: AppContext.saveSettings calls notify() internally,
  // and the old code called notify() again after it returned, producing two toasts.
  const handleSave = async (): Promise<void> => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    await persistTemplate({ silent: false, showToast: true })
  }

  const SECTIONS: SectionConfig[] = [
    { id: 'fields', label: t('receipt_fields') || 'All Fields', icon: LayoutList },
    { id: 'order', label: t('receipt_order') || 'Field Order', icon: LayoutList },
    { id: 'delivery', label: t('receipt_delivery') || 'Delivery', icon: Truck },
    { id: 'style', label: t('receipt_style') || 'Appearance', icon: Palette },
    { id: 'language', label: t('receipt_language') || 'Language', icon: Globe },
    { id: 'footer', label: t('receipt_footer_tab') || 'Footer', icon: Type },
    { id: 'qr', label: t('receipt_qr_codes_tab') || 'QR Codes', icon: QrCodeIcon },
    { id: 'print', label: t('receipt_print') || 'Print', icon: Printer },
  ]
  const appliedReceiptConfig = useMemo(() => buildAppliedReceiptConfig({ settings, template: tpl }), [settings, tpl])
  const typedPreviewTargetRef = previewTargetRef as RefObject<HTMLElement | null>

  return (
    <ErrorBoundary>
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50 dark:bg-zinc-950 lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden lg:flex-row">

      {/* ?€?€ Editor panel ?€?€ */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-zinc-950">
        {/* Section tabs share a row with Preview/Save, now icon-only --
            these used to sit in their own labeled row above the tabs.
            Tabs stay scrollable (min-w-0 + overflow-x-auto); the button
            group is flex-shrink-0 so it never gets squeezed off-screen. */}
        <div
          className="sticky top-0 z-20 mb-4 flex items-center gap-2 border-b border-gray-200 bg-gray-50/95 px-4 pb-1 pt-4 backdrop-blur dark:border-gray-800 dark:bg-zinc-950/95 sm:px-6 sm:pt-6"
          title={t('rs_auto_save_hint') || 'Toggle any field on/off. All changes auto-save and apply instantly to the live preview and to receipts printed from POS & Sales.'}
        >
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-3 sm:flex-wrap sm:overflow-visible">
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
          <div className="flex flex-shrink-0 items-center gap-1.5 pb-3">
            <button
              onClick={() => setPreviewOpen(true)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/60 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-blue-500 dark:hover:bg-slate-700/80 dark:hover:text-blue-300 sm:hidden"
              title={t('preview') || 'Preview'}
              aria-label={t('preview') || 'Preview'}
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-600 px-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 hover:border-blue-800 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3.5"
              title={saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              aria-label={saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
            >
              <Save className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}</span>
            </button>
          </div>
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
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">{t('discount_position') || 'Discount Position'}</div>
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
                <div className="text-sm text-gray-700 dark:text-gray-300 block mb-2">{t('font_family_label') || 'Font Family'}</div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[['monospace', t('font_monospace') || 'Monospace'], ['sans', t('font_sans') || 'Sans-serif'], ['serif', t('font_serif') || 'Serif']].map(([val, label]) => (
                    <button key={val} onClick={() => setT('font_family', val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${tpl.font_family === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <label htmlFor="receipt-font-size" className="text-sm text-gray-700 dark:text-gray-300 block mb-2">{t('font_size_label') || 'Font Size'}: {tpl.font_size}px</label>
                <input id="receipt-font-size" name="receipt_font_size" autoComplete="off" type="range" min="9" max="16" value={tpl.font_size} onChange={e => setT('font_size', parseInt(e.target.value))} className="w-full" />
                <div className="mt-4 flex items-center gap-1.5">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('receipt_text_contrast') || 'Text Contrast'}</span>
                  <InfoHint
                    label={t('receipt_text_contrast') || 'Text Contrast'}
                    text={t('receipt_text_contrast_desc') || 'Maximum renders every receipt text node in pure black, without changing font size or weight.'}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[['normal', t('receipt_text_contrast_normal') || 'Normal'], ['maximum', t('receipt_text_contrast_maximum') || 'Maximum black']].map(([val, label]) => (
                    <button key={val} onClick={() => setT('text_contrast', val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${normalizeReceiptTextContrast(tpl.text_contrast) === val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
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
                  <div><label htmlFor="receipt-header-separator" className="text-xs text-gray-500 mb-1 block">{t('header_separator') || 'Header Separator'}</label><input id="receipt-header-separator" name="receipt_header_separator" className="input w-24" value={tpl.header_separator} onChange={e => setT('header_separator', e.target.value)} maxLength={2} placeholder="==" autoComplete="off" /></div>
                  <div><label htmlFor="receipt-footer-separator" className="text-xs text-gray-500 mb-1 block">{t('footer_separator') || 'Footer Separator'}</label><input id="receipt-footer-separator" name="receipt_footer_separator" className="input w-24" value={tpl.footer_separator} onChange={e => setT('footer_separator', e.target.value)} maxLength={2} placeholder="--" autoComplete="off" /></div>
                  <div><label htmlFor="receipt-line-separator" className="text-xs text-gray-500 mb-1 block">{t('separator') || 'Item Separator'}</label><input id="receipt-line-separator" name="receipt_line_separator" className="input w-24" value={tpl.line_char} onChange={e => setT('line_char', e.target.value)} maxLength={2} placeholder="-" autoComplete="off" /></div>
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
                <label htmlFor="receipt-custom-footer" className="text-xs text-gray-500 mb-1 block">{t('custom_footer_text') || 'Custom footer text'}</label>
                <textarea id="receipt-custom-footer" name="receipt_custom_footer" className="input resize-none" rows={3}
                  value={tpl.custom_footer}
                  onChange={e => setT('custom_footer', e.target.value)}
                  placeholder={defaultFooter || 'Thank you for your patronage!'}
                  autoComplete="off"
                />
              </Section>
              <Section title={t('footer_message') || 'Default footer message'}>
                <p className="text-xs text-gray-500 mb-2">
                  {t('default_footer_hint') || 'Used whenever a receipt has no custom footer text set above.'}
                </p>
                <textarea id="receipt-default-footer" name="receipt_footer" className="input resize-none" rows={2}
                  value={defaultFooter}
                  onChange={e => setDefaultFooter(e.target.value)}
                  placeholder="Thank you!"
                  autoComplete="off"
                />
              </Section>
              <Section title={t('custom_header_text') || 'Custom Header Text'}>
                <label htmlFor="receipt-custom-header" className="sr-only">{t('custom_header_text') || 'Custom Header Text'}</label>
                <input id="receipt-custom-header" name="receipt_custom_header" className="input mb-3" value={tpl.custom_header} onChange={e => setT('custom_header', e.target.value)} placeholder="e.g. ** OFFICIAL RECEIPT **" autoComplete="off" />
              </Section>
            </>
          )}

          {activeSection === 'qr' && (
            <ReceiptQrSettingsTab tpl={tpl} setT={setT} t={t} />
          )}

          {activeSection === 'print' && <PrintSettings t={t} previewTargetRef={typedPreviewTargetRef} settings={settings} saveSettings={saveSettings} />}

        </div>
      </div>

      {/* ?€?€ Live Preview (desktop sidebar) ?€?€ */}
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
        <div ref={previewTargetRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
          <ReceiptPreview tpl={appliedReceiptConfig.template} settings={appliedReceiptConfig.settings} />
        </div>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 lg:hidden sm:items-center" onClick={() => setPreviewOpen(false)}>
          <div className="bg-gray-100 dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:w-96 max-h-modal-85 flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={e => e.stopPropagation()}>
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
                <button type="button" onClick={() => setPreviewOpen(false)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white" aria-label="Close preview"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div ref={previewTargetRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
              <ReceiptPreview tpl={appliedReceiptConfig.template} settings={appliedReceiptConfig.settings} />
            </div>
          </div>
        </div>
      )}

    </div>
    </ErrorBoundary>
  )
}

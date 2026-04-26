import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../AppContext'
import { BadgeDollarSign, BookUser, Boxes, Building2, ClipboardList, DatabaseBackup, FolderOpen, ImagePlus, LayoutDashboard, MonitorSmartphone, Package, Receipt, RotateCcw, Server, Settings as SettingsIcon, ShoppingBag, ShoppingCart, Ticket, Trash2, Users } from 'lucide-react'
import FontFamilyPicker from './FontFamilyPicker'
import OtpModal from './OtpModal'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS, orderNavItems, parseNavSetting } from '../shared/navigationConfig'
import { createCircularFaviconDataUrl } from '../../utils/favicon'

const FALLBACK_COPY = {
  en: {
    customerPortalTitle: 'Customer Portal',
    customerPortalDesc: 'Portal layout, business info, public path, images, and customer-facing content are edited inside the Customer Portal page with live preview. Point rules are managed in Loyalty Points.',
    openEditor: 'Open editor',
    openPublicRoute: 'Open public route',
    appearanceHintAccent: 'Buttons, active links, and highlights',
    sidebarColorTitle: 'Sidebar Color',
    sidebarColorHint: 'Navigation background',
    pageBgTitle: 'Page Background',
    pageBgHint: 'Main content area',
    sidebarTextColorTitle: 'Sidebar Text & Icon Color',
    sidebarTextColorHint: 'Overrides page names, section text, and icons on the sidebar/mobile nav',
    resetToDefault: 'Reset to default',
    themeLight: 'Light',
    themeDark: 'Dark',
    englishLabel: 'English',
    khmerLabel: 'Khmer',
    customColor: 'Custom color',
    autoLabel: 'auto',
    navigationTitle: 'Navigation Layout',
    navigationHint: 'Choose the sidebar order and which 4 items stay pinned in the mobile bottom bar.',
    desktopOrder: 'Sidebar order',
    mobilePinned: 'Pinned on mobile',
    moveUp: 'Up',
    moveDown: 'Down',
    pinned: 'Pinned',
    inMoreMenu: 'In menu',
    navReset: 'Reset navigation',
  },
  km: {
    customerPortalTitle: 'Customer Portal',
    customerPortalDesc: 'Portal layout, business info, public path, images, and customer-facing content are edited inside the Customer Portal page with live preview. Point rules are managed in Loyalty Points.',
    openEditor: 'Open editor',
    openPublicRoute: 'Open public route',
    appearanceHintAccent: 'Buttons, active links, and highlights',
    sidebarColorTitle: 'Sidebar Color',
    sidebarColorHint: 'Navigation background',
    pageBgTitle: 'Page Background',
    pageBgHint: 'Main content area',
    sidebarTextColorTitle: 'Sidebar Text & Icon Color',
    sidebarTextColorHint: 'Overrides page names, section text, and icons on the sidebar/mobile nav',
    resetToDefault: 'Reset to default',
    themeLight: 'Light',
    themeDark: 'Dark',
    englishLabel: 'English',
    khmerLabel: 'Khmer',
    customColor: 'Custom color',
    autoLabel: 'auto',
  },
}

const SIDEBAR_COLORS = [
  ['', 'Default (auto)', '#e5e7eb'],
  ['#ffffff', 'White', '#e5e7eb'],
  ['#f8fafc', 'Off White', '#e2e8f0'],
  ['#f1f5f9', 'Light Gray', '#cbd5e1'],
  ['#1e293b', 'Dark Slate', '#334155'],
  ['#0f172a', 'Midnight', '#1e293b'],
  ['#18181b', 'Zinc Dark', '#27272a'],
  ['#1c1917', 'Stone Dark', '#292524'],
  ['#1e1b4b', 'Indigo Dark', '#312e81'],
  ['#14532d', 'Forest Dark', '#166534'],
  ['#7f1d1d', 'Crimson Dark', '#991b1b'],
  ['#0c4a6e', 'Ocean Dark', '#075985'],
  ['#3730a3', 'Indigo Mid', '#4338ca'],
  ['#1d4ed8', 'Blue Mid', '#2563eb'],
  ['#166534', 'Green Mid', '#15803d'],
  ['#0e7490', 'Cyan Mid', '#0891b2'],
]

const PAGE_BG_COLORS = [
  ['', 'Default (auto)', '#e5e7eb'],
  ['#ffffff', 'White', '#e5e7eb'],
  ['#f9fafb', 'Gray 50', '#e5e7eb'],
  ['#f1f5f9', 'Slate 100', '#cbd5e1'],
  ['#faf5ff', 'Lavender', '#e9d5ff'],
  ['#fdf2f8', 'Rose Tint', '#fbcfe8'],
  ['#f0fdf4', 'Mint', '#bbf7d0'],
  ['#eff6ff', 'Sky Tint', '#bfdbfe'],
  ['#fff7ed', 'Warm Sand', '#fed7aa'],
  ['#fefce8', 'Butter', '#fef08a'],
  ['#1a1a2e', 'Dark Navy', '#16213e'],
  ['#0f172a', 'Slate Dark', '#1e293b'],
  ['#18181b', 'Zinc Dark', '#27272a'],
  ['#1c1917', 'Stone Dark', '#292524'],
  ['#0a0a0a', 'Almost Black', '#171717'],
  ['#111827', 'Gray Dark', '#1f2937'],
]

const SIDEBAR_TEXT_COLORS = [
  ['', 'Default (auto)', '#d1d5db'],
  ['#ffffff', 'White', '#e5e7eb'],
  ['#f8fafc', 'Off White', '#e2e8f0'],
  ['#e2e8f0', 'Slate 200', '#cbd5e1'],
  ['#cbd5e1', 'Slate 300', '#94a3b8'],
  ['#111827', 'Gray 900', '#374151'],
  ['#1f2937', 'Gray 800', '#4b5563'],
  ['#0f766e', 'Teal 700', '#115e59'],
  ['#14532d', 'Forest 900', '#166534'],
  ['#7c2d12', 'Orange 900', '#9a3412'],
  ['#7f1d1d', 'Red 900', '#991b1b'],
  ['#1d4ed8', 'Blue 700', '#2563eb'],
  ['#4338ca', 'Indigo 700', '#4f46e5'],
]

const DEFAULT_PAYMENT_METHODS = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR', 'Pi Pay', 'Transfer']

const THEME_OPTION_KEYS = [['light', 'themeLight', 'Light'], ['dark', 'themeDark', 'Dark']]
const LANGUAGE_OPTION_KEYS = [['en', 'englishLabel', 'English'], ['km', 'khmerLabel', 'Khmer']]
const CARD_STYLE_OPTION_KEYS = [['sharp', 'sharp'], ['rounded', 'rounded'], ['pill', 'pill']]
const DENSITY_OPTION_KEYS = [['comfortable', 'comfortable'], ['compact', 'compact'], ['spacious', 'spacious']]

const ACCENT_COLORS = [
  ['#2563eb', 'Blue'],
  ['#1d4ed8', 'Navy'],
  ['#7c3aed', 'Purple'],
  ['#9333ea', 'Violet'],
  ['#db2777', 'Pink'],
  ['#e11d48', 'Rose'],
  ['#dc2626', 'Red'],
  ['#ea580c', 'Orange'],
  ['#d97706', 'Amber'],
  ['#ca8a04', 'Yellow'],
  ['#16a34a', 'Green'],
  ['#15803d', 'Forest'],
  ['#0891b2', 'Cyan'],
  ['#0f766e', 'Teal'],
  ['#0284c7', 'Sky'],
  ['#475569', 'Slate'],
  ['#57534e', 'Stone'],
  ['#374151', 'Gray'],
]

const TIMEZONE_OPTIONS = [
  'Asia/Phnom_Penh',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Yangon',
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Baghdad',
  'Africa/Nairobi',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Pacific/Auckland',
  'Pacific/Sydney',
]

const FONT_PREVIEW_CSS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  roboto: '"Roboto", sans-serif',
  poppins: '"Poppins", sans-serif',
  open_sans: '"Open Sans", sans-serif',
  outfit: '"Outfit", sans-serif',
  mono: '"Courier New", Courier, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  khmer: '"Noto Sans Khmer", "Khmer OS", sans-serif',
  hanuman: '"Hanuman", "Noto Sans Khmer", serif',
  battambang: '"Battambang", "Noto Sans Khmer", sans-serif',
}

const SETTINGS_NAV_ICONS = {
  dashboard: LayoutDashboard,
  catalog: ShoppingBag,
  loyalty_points: Ticket,
  pos: ShoppingCart,
  products: Package,
  inventory: Boxes,
  branches: Building2,
  sales: BadgeDollarSign,
  returns: RotateCcw,
  contacts: BookUser,
  users: Users,
  audit_log: ClipboardList,
  receipt_settings: Receipt,
  backup: DatabaseBackup,
  settings: SettingsIcon,
  files: FolderOpen,
  server: Server,
}

function normalizePortalPath(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
  return cleaned ? `/${cleaned}` : '/customer-portal'
}

function useCopy(language, t) {
  return (key, fallback) => {
    const translated = t?.(key)
    if (translated && translated !== key) return translated
    return FALLBACK_COPY.en?.[key] || fallback || key
  }
}

function getSettingsNavLabel(item, t) {
  if (item.id === 'catalog') {
    const label = t('customer_portal')
    return label && label !== 'customer_portal' ? label : 'Customer Portal'
  }
  if (item.id === 'loyalty_points') {
    const label = t('loyalty_points')
    return label && label !== 'loyalty_points' ? label : 'Loyalty Points'
  }
  if (item.id === 'server') {
    const label = t('sync_server_title')
    return label && label !== 'sync_server_title' ? label : 'Sync Server'
  }
  const label = t(item.key)
  return label && label !== item.key ? label : item.id
}

function SwatchPicker({ colors, value, onChange, fallbackValue, title, hint, resetLabel, autoLabel, customColorTitle, fieldId }) {
  return (
    <div className="sm:col-span-2">
      <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {title} <span className="text-xs font-normal text-gray-400">{hint}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {colors.map(([color, name, border]) => (
          <button
            key={`${title}-${name}-${color || 'default'}`}
            type="button"
            onClick={() => onChange(color)}
            title={name}
            style={{
              background: color || fallbackValue,
              border: `2px solid ${border}`,
            }}
            className={`w-8 h-8 rounded-lg transition-transform text-xs flex items-center justify-center ${(value || '') === color ? 'ring-2 ring-offset-1 ring-blue-500 scale-110' : 'hover:scale-105'}`}
          >
            {color === '' ? <span style={{ fontSize: '9px', color: '#666' }}>{autoLabel}</span> : null}
          </button>
        ))}
        <input
          id={fieldId}
          name={fieldId}
          type="color"
          value={value || fallbackValue}
          onChange={(event) => onChange(event.target.value)}
          title={customColorTitle}
          className="w-8 h-8 rounded-lg border border-gray-300 cursor-pointer"
          style={{ padding: '1px' }}
        />
      </div>
      {value ? (
        <button type="button" className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 underline" onClick={() => onChange('')}>
          {resetLabel}
        </button>
      ) : null}
    </div>
  )
}

export default function Settings() {
  const { t, settings, saveSettings, user, navigateTo, notify } = useApp()
  const [otpStatus, setOtpStatus] = useState(false)
  const [otpModal, setOtpModal] = useState(null)
  const [pmList, setPmList] = useState([])
  const [newPm, setNewPm] = useState('')
  const [form, setForm] = useState({})
  const [appFaviconPreview, setAppFaviconPreview] = useState('')
  const [dragPinnedId, setDragPinnedId] = useState(null)

  const uiLanguage = form.language || settings.language || 'en'
  const copy = useCopy(uiLanguage, t)
  const previewFontFamily = FONT_PREVIEW_CSS[form.ui_font_family || 'system'] || FONT_PREVIEW_CSS.system
  const previewBaseSize = Math.max(14, Math.round((parseFloat(form.ui_font_size || 14) / 14) * 16))
  const previewSidebarSize = form.ui_sidebar_font_size || Math.max(12, Math.round((parseFloat(form.ui_font_size || 14) || 14) * 0.98))
  const previewTitleSize = form.ui_title_font_size || Math.max(20, Math.round((parseFloat(form.ui_font_size || 14) || 14) * 1.75))
  const previewSectionSize = form.ui_section_font_size || Math.max(13, Math.round((parseFloat(form.ui_font_size || 14) || 14) * 1.14))
  const previewTableSize = form.ui_table_font_size || (form.ui_font_size || 14)
  const previewChipSize = form.ui_chip_font_size || Math.max(11, Math.round((parseFloat(form.ui_font_size || 14) || 14) * 0.92))

  useEffect(() => {
    if (user?.id) {
      window.api.otpStatus(user.id).then((result) => setOtpStatus(!!result?.otpEnabled)).catch(() => {})
    }
  }, [user])

  useEffect(() => {
    let cancelled = false
    const source = String(form.ui_app_favicon_image || settings.ui_app_favicon_image || '').trim()
    if (!source) {
      setAppFaviconPreview('')
      return undefined
    }
    createCircularFaviconDataUrl(source, { fit: 'cover', zoom: 100, positionX: 50, positionY: 50 })
      .then((preview) => {
        if (!cancelled) setAppFaviconPreview(preview || source)
      })
      .catch(() => {
        if (!cancelled) setAppFaviconPreview(source)
      })
    return () => {
      cancelled = true
    }
  }, [form.ui_app_favicon_image, settings.ui_app_favicon_image])

  useEffect(() => {
    try {
      const raw = settings.pos_payment_methods
      setPmList(raw ? JSON.parse(raw) : DEFAULT_PAYMENT_METHODS)
    } catch {
      setPmList(DEFAULT_PAYMENT_METHODS)
    }
  }, [settings.pos_payment_methods])

  useEffect(() => {
    setForm({ ...settings })
  }, [settings])

  const isAdmin = useMemo(() => {
    try {
      const permissions = typeof user?.permissions === 'string' ? JSON.parse(user.permissions) : (user?.permissions || {})
      return permissions.all
    } catch {
      return false
    }
  }, [user])

  const navItems = useMemo(() => orderNavItems(NAV_ITEMS, parseNavSetting(form.ui_nav_order, [])), [form.ui_nav_order])
  const mobilePinned = useMemo(() => parseNavSetting(form.ui_mobile_pinned, DEFAULT_MOBILE_PINNED).slice(0, 4), [form.ui_mobile_pinned])
  const mobilePinnedItems = useMemo(() => {
    const byId = new Map(navItems.map((item) => [item.id, item]))
    return mobilePinned.map((id) => byId.get(id)).filter(Boolean)
  }, [mobilePinned, navItems])

  const publicPortalPath = normalizePortalPath(form.customer_portal_path || settings.customer_portal_path || '/customer-portal')
  const publicPortalUrl = typeof window !== 'undefined' ? `${window.location.origin}${publicPortalPath}` : publicPortalPath

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const moveNavItem = (id, direction) => {
    const items = [...navItems]
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= items.length) return
    ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
    setValue('ui_nav_order', JSON.stringify(items.map((item) => item.id)))
  }

  const toggleMobilePinned = (id) => {
    const next = [...mobilePinned]
    const existingIndex = next.indexOf(id)
    if (existingIndex >= 0) {
      next.splice(existingIndex, 1)
    } else {
      if (next.length >= 4) next.pop()
      next.push(id)
    }
    setValue('ui_mobile_pinned', JSON.stringify(next))
  }

  const movePinnedItem = (id, direction) => {
    const next = [...mobilePinned]
    const index = next.indexOf(id)
    if (index < 0) return
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setValue('ui_mobile_pinned', JSON.stringify(next))
  }

  const movePinnedBefore = (dragId, targetId) => {
    if (!dragId || !targetId || dragId === targetId) return
    const next = [...mobilePinned]
    const dragIndex = next.indexOf(dragId)
    const targetIndex = next.indexOf(targetId)
    if (dragIndex < 0 || targetIndex < 0) return
    next.splice(dragIndex, 1)
    const insertIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex
    next.splice(insertIndex, 0, dragId)
    setValue('ui_mobile_pinned', JSON.stringify(next))
  }

  const resetNavigationLayout = () => {
    setValue('ui_nav_order', '')
    setValue('ui_mobile_pinned', JSON.stringify(DEFAULT_MOBILE_PINNED))
  }

  const field = (key, label, type = 'text', placeholder = '') => (
    <div>
      <label htmlFor={`settings-${key}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        id={`settings-${key}`}
        name={key}
        className="input"
        type={type}
        autoComplete={
          key === 'business_name' ? 'organization' :
          key === 'business_phone' ? 'tel' :
          key === 'business_email' ? 'email' :
          key === 'business_address' ? 'street-address' :
          'off'
        }
        placeholder={placeholder}
        value={form[key] || ''}
        onChange={(event) => setValue(key, event.target.value)}
      />
    </div>
  )

  const savePaymentMethods = (updated) => {
    setPmList(updated)
    saveSettings({ pos_payment_methods: JSON.stringify(updated) })
  }

  const uploadImageSetting = async (key) => {
    try {
      const file = await new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => resolve(input.files?.[0] || null)
        input.click()
      })
      if (!file) return
      const uploaded = await window.api.uploadFileAsset({ file, userId: user?.id, userName: user?.name })
      if (!uploaded?.public_path) throw new Error(uploaded?.error || 'Image upload failed')
      setValue(key, uploaded.public_path)
    } catch (error) {
      notify(error?.message || 'Image upload failed', 'error')
    }
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-6">{t('settings')}</h1>

      <div className="max-w-5xl space-y-5">
        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{t('business_info')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('business_name', t('business_name'), 'text', 'My Business')}
            {field('business_phone', t('phone'), 'text', '+1 234 567')}
            {field('business_address', t('address'), 'text', '123 Main St')}
            {field('business_email', t('email'), 'email', 'info@biz.com')}
            {field('tax_id', t('tax_id'), 'text', 'TAX-000')}
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Browser tab icon</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Used for the Business OS admin tab. The portal tab icon is managed in the Customer Portal editor.
              </p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gray-200 bg-gray-50 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              {appFaviconPreview ? (
                <img src={appFaviconPreview} alt="Business OS tab icon preview" className="h-full w-full rounded-full object-cover" />
              ) : (
                <MonitorSmartphone className="h-7 w-7 text-gray-400" />
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label htmlFor="settings-ui-app-favicon-image" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Business OS tab icon image
              </label>
              <input
                id="settings-ui-app-favicon-image"
                name="ui_app_favicon_image"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="/uploads/brand-icon.png"
                value={form.ui_app_favicon_image || ''}
                onChange={(event) => setValue('ui_app_favicon_image', event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => uploadImageSetting('ui_app_favicon_image')}>
                <ImagePlus className="h-4 w-4" />
                <span>Upload icon</span>
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setValue('ui_app_favicon_image', '')}>
                <Trash2 className="h-4 w-4" />
                <span>Clear</span>
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => navigateTo('catalog')}>
                <FolderOpen className="h-4 w-4" />
                <span>Portal editor</span>
              </button>
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{t('currency_settings')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('currency_usd_symbol', t('currency_usd_symbol'), 'text', '$')}
            {field('currency_khr_symbol', t('currency_khr_symbol'), 'text', 'KHR')}
            {field('exchange_rate', t('exchange_rate'), 'number', '4100')}
            <div>
              <label htmlFor="settings-display-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('display_currency')}</label>
              <select id="settings-display-currency" name="display_currency" className="input" value={form.display_currency || 'USD'} onChange={(event) => setValue('display_currency', event.target.value)}>
                <option value="USD">{t('usd_only')}</option>
                <option value="KHR">{t('khr_only')}</option>
                <option value="BOTH">{t('both_currencies')}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{copy('customerPortalTitle', 'Customer Portal')}</h2>
              <p className="text-xs text-gray-400 mt-1">{copy('customerPortalDesc', 'Portal layout, business info, public path, images, and customer-facing content are edited inside the Customer Portal page with live preview. Point rules are managed in Loyalty Points.')}</p>
              <div className="mt-2 text-xs text-gray-500 break-all">{publicPortalUrl}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <button type="button" className="btn-secondary text-sm" onClick={() => navigateTo('catalog')}>
                {copy('openEditor', 'Open editor')}
              </button>
              <a className="btn-secondary text-sm" href={publicPortalUrl} target="_blank" rel="noreferrer">
                {copy('openPublicRoute', 'Open public route')}
              </a>
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{t('receipt_settings')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('tax_rate', t('tax_rate'), 'number', '0')}
            <div>
              <label htmlFor="settings-receipt-footer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('footer_message')}</label>
              <textarea
                id="settings-receipt-footer"
                name="receipt_footer"
                autoComplete="off"
                className="input resize-none"
                rows={2}
                value={form.receipt_footer || ''}
                onChange={(event) => setValue('receipt_footer', event.target.value)}
                placeholder="Thank you!"
              />
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{t('appearance')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('theme')}</div>
              <div className="grid grid-cols-2 gap-2">
                {THEME_OPTION_KEYS.map(([themeValue, copyKey, defaultLabel]) => (
                  <button
                    key={themeValue}
                    type="button"
                    onClick={() => setValue('theme', themeValue)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${form.theme === themeValue ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {copy(copyKey, defaultLabel)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('language')}</div>
              <div className="grid grid-cols-2 gap-2">
                {LANGUAGE_OPTION_KEYS.map(([langCode, copyKey, defaultLabel]) => (
                  <button
                    key={langCode}
                    type="button"
                    onClick={() => setValue('language', langCode)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${form.language === langCode ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {copy(copyKey, defaultLabel)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('design_typography')}</h2>
          <p className="text-xs text-gray-400 mb-4">{t('customize_fonts')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="settings-ui-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('font_size_label')} <span className="text-gray-400 font-normal">({form.ui_font_size || 14}px)</span>
              </label>
              <input
                id="settings-ui-font-size"
                name="ui_font_size"
                type="range"
                min="12"
                max="20"
                step="1"
                value={form.ui_font_size || 14}
                onChange={(event) => setValue('ui_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-title-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Page title size <span className="text-gray-400 font-normal">({previewTitleSize}px)</span>
              </label>
              <input
                id="settings-ui-title-font-size"
                name="ui_title_font_size"
                type="range"
                min="20"
                max="40"
                step="1"
                value={form.ui_title_font_size || previewTitleSize}
                onChange={(event) => setValue('ui_title_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-sidebar-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sidebar size <span className="text-gray-400 font-normal">({previewSidebarSize}px)</span>
              </label>
              <input
                id="settings-ui-sidebar-font-size"
                name="ui_sidebar_font_size"
                type="range"
                min="12"
                max="22"
                step="1"
                value={form.ui_sidebar_font_size || previewSidebarSize}
                onChange={(event) => setValue('ui_sidebar_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-section-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Section heading size <span className="text-gray-400 font-normal">({previewSectionSize}px)</span>
              </label>
              <input
                id="settings-ui-section-font-size"
                name="ui_section_font_size"
                type="range"
                min="13"
                max="26"
                step="1"
                value={form.ui_section_font_size || previewSectionSize}
                onChange={(event) => setValue('ui_section_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-table-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Table and row text <span className="text-gray-400 font-normal">({previewTableSize}px)</span>
              </label>
              <input
                id="settings-ui-table-font-size"
                name="ui_table_font_size"
                type="range"
                min="11"
                max="20"
                step="1"
                value={form.ui_table_font_size || previewTableSize}
                onChange={(event) => setValue('ui_table_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-chip-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Badge and chip text <span className="text-gray-400 font-normal">({previewChipSize}px)</span>
              </label>
              <input
                id="settings-ui-chip-font-size"
                name="ui_chip_font_size"
                type="range"
                min="10"
                max="18"
                step="1"
                value={form.ui_chip_font_size || previewChipSize}
                onChange={(event) => setValue('ui_chip_font_size', event.target.value)}
                className="w-full accent-blue-600"
              />
            </div>

            <FontFamilyPicker value={form.ui_font_family || 'system'} onChange={(value) => setValue('ui_font_family', value)} />

            <div>
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('card_style')}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {CARD_STYLE_OPTION_KEYS.map(([radius, labelKey]) => (
                  <button
                    key={radius}
                    type="button"
                    onClick={() => setValue('ui_border_radius', radius)}
                    className={`flex-1 py-2 text-xs border-2 transition-colors ${radius === 'sharp' ? 'rounded-sm' : radius === 'pill' ? 'rounded-full' : 'rounded-lg'} ${(form.ui_border_radius || 'rounded') === radius ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('density')}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {DENSITY_OPTION_KEYS.map(([density, labelKey]) => (
                  <button
                    key={density}
                    type="button"
                    onClick={() => setValue('ui_density', density)}
                    className={`flex-1 py-2 text-xs rounded-lg border-2 transition-colors ${(form.ui_density || 'comfortable') === density ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-zinc-900/40">
              <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Typography preview</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800" style={{ fontFamily: previewFontFamily, fontSize: `${previewBaseSize}px` }}>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">English</div>
                  <div className="mt-2 font-semibold text-gray-900 dark:text-white" style={{ fontSize: `${previewTitleSize}px`, lineHeight: 1.05 }}>Leang Cosmetics</div>
                  <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-slate-600 dark:bg-zinc-700 dark:text-zinc-200" style={{ fontSize: `${previewSidebarSize}px` }}>
                    Sidebar example
                  </div>
                  <div className="mt-3 font-semibold text-gray-700 dark:text-gray-200" style={{ fontSize: `${previewSectionSize}px` }}>Section heading</div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    Product pages, receipts, settings, and forms follow this font family and the stronger size scale across the app.
                  </p>
                  <div className="mt-3 inline-flex rounded-full bg-blue-100 px-3 py-1 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" style={{ fontSize: `${previewChipSize}px` }}>
                    Category chip
                  </div>
                  <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-700 dark:bg-zinc-900/40" style={{ fontSize: `${previewTableSize}px` }}>
                      <span>Product</span>
                      <span className="text-right">Price</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-2 text-gray-700 dark:text-gray-200" style={{ fontSize: `${previewTableSize}px` }}>
                      <span>Lip Tint</span>
                      <span className="text-right">$9.90</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-800" style={{ fontFamily: previewFontFamily, fontSize: `${previewBaseSize}px` }}>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Khmer</div>
                  <div className="mt-2 font-semibold text-gray-900 dark:text-white" style={{ fontSize: `${previewTitleSize}px`, lineHeight: 1.05 }}>លាង កូស្មេធីក</div>
                  <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-slate-600 dark:bg-zinc-700 dark:text-zinc-200" style={{ fontSize: `${previewSidebarSize}px` }}>
                    ម៉ឺនុយចំហៀង
                  </div>
                  <div className="mt-3 font-semibold text-gray-700 dark:text-gray-200" style={{ fontSize: `${previewSectionSize}px` }}>ចំណងជើងផ្នែក</div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    ទំព័រផលិតផល បង្កាន់ដៃ ការកំណត់ និងសំណុំបែបបទនឹងប្រើពុម្ពអក្សរ និងទំហំអក្សរនេះ។
                  </p>
                  <div className="mt-3 inline-flex rounded-full bg-blue-100 px-3 py-1 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" style={{ fontSize: `${previewChipSize}px` }}>
                    ប្រភេទ
                  </div>
                  <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50 px-3 py-2 text-gray-500 dark:border-gray-700 dark:bg-zinc-900/40" style={{ fontSize: `${previewTableSize}px` }}>
                      <span>ទំនិញ</span>
                      <span className="text-right">តម្លៃ</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-2 text-gray-700 dark:text-gray-200" style={{ fontSize: `${previewTableSize}px` }}>
                      <span>លីបធីន</span>
                      <span className="text-right">$9.90</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="settings-ui-accent-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('accent_color')} <span className="text-xs font-normal text-gray-400">{copy('appearanceHintAccent', 'Buttons, active links, and highlights')}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {ACCENT_COLORS.map(([color, name]) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setValue('ui_accent_color', color)}
                    title={name}
                    style={{ background: color }}
                    className={`w-7 h-7 rounded-full border-4 transition-transform ${(form.ui_accent_color || '#2563eb') === color ? 'border-white scale-125 shadow-lg' : 'border-transparent hover:scale-110'}`}
                  />
                ))}
                <input
                  id="settings-ui-accent-color"
                  name="ui_accent_color"
                  type="color"
                  value={form.ui_accent_color || '#2563eb'}
                  onChange={(event) => setValue('ui_accent_color', event.target.value)}
                  title={copy('customColor', 'Custom color')}
                  className="w-7 h-7 rounded-full border border-gray-300 cursor-pointer p-0"
                  style={{ padding: 0 }}
                />
              </div>
            </div>

            <SwatchPicker
              fieldId="settings-ui-sidebar-color"
              colors={SIDEBAR_COLORS}
              value={form.ui_sidebar_color || ''}
              onChange={(value) => setValue('ui_sidebar_color', value)}
              fallbackValue={form.theme === 'dark' ? '#0f172a' : '#ffffff'}
              title={copy('sidebarColorTitle', 'Sidebar Color')}
              hint={copy('sidebarColorHint', 'Navigation background')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
            />

            <SwatchPicker
              fieldId="settings-ui-page-bg"
              colors={PAGE_BG_COLORS}
              value={form.ui_page_bg || ''}
              onChange={(value) => setValue('ui_page_bg', value)}
              fallbackValue={form.theme === 'dark' ? '#0f172a' : '#f9fafb'}
              title={copy('pageBgTitle', 'Page Background')}
              hint={copy('pageBgHint', 'Main content area')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
            />

            <SwatchPicker
              fieldId="settings-ui-sidebar-text-color"
              colors={SIDEBAR_TEXT_COLORS}
              value={form.ui_sidebar_text_color || ''}
              onChange={(value) => setValue('ui_sidebar_text_color', value)}
              fallbackValue={form.theme === 'dark' ? '#f8fafc' : '#111827'}
              title={copy('sidebarTextColorTitle', 'Sidebar Text & Icon Color')}
              hint={copy('sidebarTextColorHint', 'Overrides page names, section text, and icons on the sidebar/mobile nav')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
            />
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('timezone')}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t('timezone_desc')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="settings-display-timezone" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('display_timezone')}</label>
              <select
                id="settings-display-timezone"
                name="display_timezone"
                className="input text-sm"
                value={form.display_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                onChange={(event) => setValue('display_timezone', event.target.value)}
              >
                <option value="">{t('use_device_timezone')}</option>
                {TIMEZONE_OPTIONS.map((timezone) => (
                  <option key={timezone} value={timezone}>{timezone.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-xs">
              <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">{t('current_device_time')}</p>
              <p className="font-mono text-blue-600 dark:text-blue-400">{new Date().toLocaleString(undefined, { timeZoneName: 'short' })}</p>
              <p className="text-gray-500 mt-1">{t('device_timezone')}: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></p>
              <p className="text-gray-400 mt-1">{t('timezone_display_note')}</p>
            </div>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{copy('navigationTitle', 'Navigation Layout')}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{copy('navigationHint', 'Choose the sidebar order and which 4 items stay pinned in the mobile bottom bar.')}</p>

          <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-900/20">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">{copy('mobilePinned', 'Pinned on mobile')}</div>
            <div className="mt-2 grid gap-2">
              {mobilePinnedItems.length ? mobilePinnedItems.map((item, index) => (
                <div
                  key={`pin-${item.id}`}
                  draggable
                  onDragStart={() => setDragPinnedId(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    movePinnedBefore(dragPinnedId, item.id)
                    setDragPinnedId(null)
                  }}
                  onDragEnd={() => setDragPinnedId(null)}
                  className={`flex flex-col gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs dark:border-blue-900/50 dark:bg-blue-950/40 sm:flex-row sm:items-center ${dragPinnedId === item.id ? 'opacity-60' : ''}`}
                >
                  <span className="cursor-grab text-gray-400" title={copy('dragToReorder', 'Drag to reorder')}>::</span>
                  <span className="min-w-0 flex flex-1 items-center gap-2 truncate text-gray-700 dark:text-gray-200">
                    {(() => {
                      const Icon = SETTINGS_NAV_ICONS[item.id] || SettingsIcon
                      return <Icon className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                    })()}
                    <span className="truncate">{index + 1}. {getSettingsNavLabel(item, t)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary h-7 w-12 px-0 py-0 text-[11px]"
                    onClick={() => movePinnedItem(item.id, 'up')}
                    disabled={index === 0}
                  >
                    {copy('moveUp', 'Up')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary h-7 w-12 px-0 py-0 text-[11px]"
                    onClick={() => movePinnedItem(item.id, 'down')}
                    disabled={index === mobilePinnedItems.length - 1}
                  >
                    {copy('moveDown', 'Down')}
                  </button>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-blue-200 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/50 dark:text-blue-300">
                  {copy('noPinnedItems', 'No pinned items yet.')}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {navItems.map((item, index) => {
              const isPinned = mobilePinned.includes(item.id)
              const Icon = SETTINGS_NAV_ICONS[item.id] || SettingsIcon
              return (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-800/70">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-white p-2 text-blue-600 shadow-sm dark:bg-gray-900 dark:text-blue-400">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{getSettingsNavLabel(item, t)}</div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {copy('desktopOrder', 'Sidebar order')}: {index + 1} • {isPinned ? copy('pinned', 'Pinned') : copy('inMoreMenu', 'In menu')}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    <button type="button" className="btn-secondary h-8 px-0 py-0 text-[11px]" onClick={() => moveNavItem(item.id, 'up')} disabled={index === 0} title={copy('moveUp', 'Up')}>Up</button>
                    <button type="button" className="btn-secondary h-8 px-0 py-0 text-[11px]" onClick={() => moveNavItem(item.id, 'down')} disabled={index === navItems.length - 1} title={copy('moveDown', 'Down')}>Down</button>
                    <button
                      type="button"
                      className={`h-8 rounded-md border px-2 py-0 text-[11px] transition-colors ${isPinned ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                      onClick={() => toggleMobilePinned(item.id)}
                    >
                      {isPinned ? copy('pinned', 'Pinned') : copy('inMoreMenu', 'Menu')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {copy('mobilePinned', 'Pinned on mobile')}: {mobilePinnedItems.map((item) => getSettingsNavLabel(item, t)).join(', ')}
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={resetNavigationLayout}>
              {copy('navReset', 'Reset navigation')}
            </button>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('manage_payment_methods')}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('configure_payment_desc')}</p>

          <div className="space-y-2 mb-3 max-h-48 overflow-auto">
            {pmList.map((paymentMethod, index) => (
              <div key={`${paymentMethod}-${index}`} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{paymentMethod}</span>
                <button
                  type="button"
                  onClick={() => savePaymentMethods(pmList.filter((_, methodIndex) => methodIndex !== index))}
                  className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  {t('remove')}
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="settings-new-payment-method"
              name="new_payment_method"
              autoComplete="off"
              aria-label={t('add_payment_placeholder')}
              className="input flex-1 text-sm"
              placeholder={t('add_payment_placeholder')}
              value={newPm}
              onChange={(event) => setNewPm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newPm.trim()) {
                  savePaymentMethods([...pmList, newPm.trim()])
                  setNewPm('')
                }
              }}
            />
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => {
                if (!newPm.trim()) return
                savePaymentMethods([...pmList, newPm.trim()])
                setNewPm('')
              }}
            >
              + {t('add')}
            </button>
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('security') || 'Security'}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('configure_security_desc')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="login_session_duration" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('session_duration')}</label>
              <select
                id="login_session_duration"
                name="login_session_duration"
                className="input"
                value={form.login_session_duration || 'session'}
                onChange={(event) => setValue('login_session_duration', event.target.value)}
              >
                <option value="session">{t('until_browser_closes')}</option>
                <option value="7d">{t('days_7')}</option>
                <option value="30d">{t('days_30')}</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{t('session_duration_hint')}</p>
            </div>
          </div>
        </div>

        {user && isAdmin ? (
          <div className="card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t('two_factor_auth')}</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('two_factor_desc')}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${otpStatus ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                {otpStatus ? t('otp_enabled') : t('otp_disabled')}
              </span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {!otpStatus ? (
                <button type="button" className="btn-primary text-sm" onClick={() => setOtpModal('setup')}>
                  {t('enable_2fa')}
                </button>
              ) : (
                <button type="button" className="btn-danger text-sm" onClick={() => setOtpModal('disable')}>
                  {t('disable_2fa')}
                </button>
              )}
            </div>

            {otpModal ? (
              <OtpModal
                mode={otpModal}
                userId={user.id}
                userName={user.name}
                onClose={() => setOtpModal(null)}
                onDone={(enabled) => {
                  setOtpStatus(enabled)
                  setOtpModal(null)
                }}
                t={t}
              />
            ) : null}
          </div>
        ) : null}

        <button type="button" className="btn-primary px-8 py-3 text-base w-full sm:w-auto" onClick={() => saveSettings(form)}>
          {t('save')}
        </button>
      </div>
    </div>
  )
}




import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../../AppContext'
import { useRef } from 'react'
import { ArrowDown, ArrowUp, BadgeDollarSign, BookUser, Boxes, Building2, ClipboardList, DatabaseBackup, FolderOpen, GripVertical, ImagePlus, LayoutDashboard, MonitorSmartphone, Package, Pin, PinOff, Receipt, RotateCcw, Save, Server, Settings as SettingsIcon, ShoppingBag, ShoppingCart, Ticket, Trash2, Users } from 'lucide-react'
import FontFamilyPicker from './FontFamilyPicker'
import OtpModal from './OtpModal'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS, orderNavItems, parseNavSetting } from '../shared/navigationConfig'
import { createCircularFaviconDataUrl } from '../../utils/favicon'
import PageHeader from '../shared/PageHeader'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout } from '../../utils/loaders.mjs'

const FALLBACK_COPY = {
  en: {
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
  ['', 'Auto', '#e5e7eb'],
  ['#f8fafc', 'Light', '#dbe4ef'],
  ['#dbeafe', 'Mid light', '#93c5fd'],
  ['#1e293b', 'Mid dark', '#334155'],
  ['#0f172a', 'Dark', '#1e293b'],
]

const PAGE_BG_COLORS = [
  ['', 'Auto', '#e5e7eb'],
  ['#ffffff', 'Light', '#e5e7eb'],
  ['#f1f5f9', 'Mid light', '#cbd5e1'],
  ['#1f2937', 'Mid dark', '#374151'],
  ['#0f172a', 'Dark', '#1e293b'],
]

const SIDEBAR_TEXT_COLORS = [
  ['', 'Auto', '#d1d5db'],
  ['#ffffff', 'Light', '#e5e7eb'],
  ['#cbd5e1', 'Mid light', '#94a3b8'],
  ['#334155', 'Mid dark', '#475569'],
  ['#111827', 'Dark', '#374151'],
]

const DEFAULT_PAYMENT_METHODS = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR', 'Pi Pay', 'Transfer']

const THEME_OPTION_KEYS = [['light', 'themeLight', 'Light'], ['dark', 'themeDark', 'Dark']]
const LANGUAGE_OPTION_KEYS = [['en', 'englishLabel', 'English'], ['km', 'khmerLabel', 'Khmer']]
const CARD_STYLE_OPTION_KEYS = [['sharp', 'sharp'], ['rounded', 'rounded'], ['pill', 'pill']]
const DENSITY_OPTION_KEYS = [['comfortable', 'comfortable'], ['compact', 'compact'], ['spacious', 'spacious']]

const ACCENT_COLORS = [
  ['#2563eb', 'Light'],
  ['#7c3aed', 'Mid light'],
  ['#0f766e', 'Mid dark'],
  ['#1f2937', 'Dark'],
]

function parseStoredColors(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function buildColorChoices(baseColors, customColors = []) {
  const seen = new Set()
  const presets = Array.isArray(baseColors) ? baseColors : []
  const extras = Array.isArray(customColors) ? customColors : []
  const next = []
  for (const [color, label, border] of presets) {
    const key = `${color || ''}|${label || ''}|${border || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push([color, label, border])
  }
  for (const color of extras) {
    const normalized = String(color || '').trim()
    if (!normalized) continue
    const key = `${normalized}|custom`
    if (seen.has(key)) continue
    seen.add(key)
    next.push([normalized, 'Custom', normalized])
  }
  return next
}

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

function SwatchPicker({
  colors,
  value,
  onChange,
  fallbackValue,
  title,
  hint,
  resetLabel,
  autoLabel,
  customColorTitle,
  fieldId,
  customColors = [],
  onAddCustomColor,
  onRemoveCustomColor,
}) {
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
          onBlur={(event) => onAddCustomColor?.(event.target.value)}
        />
      </div>
      {customColors.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {customColors.map((color) => (
            <div key={`${fieldId}-${color}`} className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => onChange(color)}
                className="flex items-center gap-1"
                title={color}
              >
                <span className="h-3 w-3 rounded-full border border-gray-200" style={{ background: color }} />
                <span className="font-medium text-gray-600 dark:text-gray-300">{color}</span>
              </button>
              <button
                type="button"
                className="text-gray-400 hover:text-red-500"
                onClick={() => onRemoveCustomColor?.(color)}
                aria-label={`Remove ${color}`}
                title={resetLabel}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {value ? (
        <button type="button" className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 underline" onClick={() => onChange('')}>
          {resetLabel}
        </button>
      ) : null}
    </div>
  )
}

export default function Settings() {
  const { t, settings, saveSettings, user, notify, deviceTimezone } = useApp()
  const [otpStatus, setOtpStatus] = useState(false)
  const [otpModal, setOtpModal] = useState(null)
  const [pmList, setPmList] = useState([])
  const [newPm, setNewPm] = useState('')
  const [form, setForm] = useState({})
  const [appFaviconPreview, setAppFaviconPreview] = useState('')
  const [dragPinnedId, setDragPinnedId] = useState(null)
  const otpStatusRequestRef = useRef(0)
  const faviconPreviewRequestRef = useRef(0)
  const uploadInFlightRef = useRef(false)
  const aliveRef = useRef(true)
  const [uploadingImage, setUploadingImage] = useState(false)

  const uiLanguage = form.language || settings.language || 'en'
  const copy = useCopy(uiLanguage, t)
  const previewFontFamily = FONT_PREVIEW_CSS[form.ui_font_family || 'system'] || FONT_PREVIEW_CSS.system
  const previewBaseSize = Math.max(14, Math.round((parseFloat(form.ui_font_size || 14) / 14) * 16))
  const previewTitleSize = form.ui_title_font_size || Math.max(20, Math.round((parseFloat(form.ui_font_size || 14) || 14) * 1.75))
  const previewSidebarSize = form.ui_sidebar_font_size || Math.max(13, Math.round(previewBaseSize * 0.95))
  const previewSectionSize = form.ui_section_font_size || Math.max(15, Math.round(previewBaseSize * 1.08))
  const previewChipSize = form.ui_chip_font_size || Math.max(11, Math.round(previewBaseSize * 0.78))
  const previewTableSize = form.ui_table_font_size || (form.ui_font_size || 14)
  const selectedDisplayTimezone = form.display_timezone || settings.display_timezone || deviceTimezone
  const previewLanguage = uiLanguage === 'km' ? 'km' : 'en'
  const customAccentColors = useMemo(() => parseStoredColors(form.ui_custom_accent_colors), [form.ui_custom_accent_colors])
  const customSidebarColors = useMemo(() => parseStoredColors(form.ui_custom_sidebar_colors), [form.ui_custom_sidebar_colors])
  const customPageBgColors = useMemo(() => parseStoredColors(form.ui_custom_page_bg_colors), [form.ui_custom_page_bg_colors])
  const customSidebarTextColors = useMemo(() => parseStoredColors(form.ui_custom_sidebar_text_colors), [form.ui_custom_sidebar_text_colors])
  const accentChoices = useMemo(() => buildColorChoices(ACCENT_COLORS.map(([color, label]) => [color, label, color]), customAccentColors), [customAccentColors])
  const sidebarColorChoices = useMemo(() => buildColorChoices(SIDEBAR_COLORS, customSidebarColors), [customSidebarColors])
  const pageBgChoices = useMemo(() => buildColorChoices(PAGE_BG_COLORS, customPageBgColors), [customPageBgColors])
  const sidebarTextChoices = useMemo(() => buildColorChoices(SIDEBAR_TEXT_COLORS, customSidebarTextColors), [customSidebarTextColors])
  const typographyPreview = previewLanguage === 'km'
    ? {
        eyebrow: 'Khmer',
        title: 'លាង កូស្មេធីក',
        sidebar: 'ម៉ឺនុយចំហៀង',
        section: 'ចំណងជើងផ្នែក',
        body: 'ទំព័រផលិតផល បង្កាន់ដៃ និងការកំណត់ នឹងប្រើពុម្ពអក្សរ និងទំហំអក្សរនេះ។',
        chip: 'ប្រភេទ',
      }
    : {
        eyebrow: 'English',
        title: 'Leang Cosmetics',
        sidebar: 'Sidebar item',
        section: 'Section heading',
        body: 'Products, receipts, settings, and forms will use this font family and size scale.',
        chip: 'Category',
      }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      invalidateTrackedRequest(otpStatusRequestRef)
      invalidateTrackedRequest(faviconPreviewRequestRef)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      invalidateTrackedRequest(otpStatusRequestRef)
      setOtpStatus(false)
      return
    }

    const requestId = beginTrackedRequest(otpStatusRequestRef)
    async function loadOtpStatus() {
      try {
        const result = await withLoaderTimeout(() => window.api.otpStatus(user.id), 'OTP status')
        if (!aliveRef.current || !isTrackedRequestCurrent(otpStatusRequestRef, requestId)) return
        setOtpStatus(!!result?.otpEnabled)
      } catch {
        if (!aliveRef.current || !isTrackedRequestCurrent(otpStatusRequestRef, requestId)) return
      }
    }

    loadOtpStatus()

    return () => {
      invalidateTrackedRequest(otpStatusRequestRef)
    }
  }, [user])

  useEffect(() => {
    const source = String(form.ui_app_favicon_image || settings.ui_app_favicon_image || '').trim()
    if (!source) {
      invalidateTrackedRequest(faviconPreviewRequestRef)
      setAppFaviconPreview('')
      return undefined
    }
    const requestId = beginTrackedRequest(faviconPreviewRequestRef)
    async function loadFaviconPreview() {
      try {
        const preview = await withLoaderTimeout(
          () => createCircularFaviconDataUrl(source, { fit: 'cover', zoom: 100, positionX: 50, positionY: 50 }),
          'Settings favicon preview',
          8000,
        )
        if (!isTrackedRequestCurrent(faviconPreviewRequestRef, requestId) || !aliveRef.current) return
        setAppFaviconPreview(preview || source)
      } catch {
        if (!isTrackedRequestCurrent(faviconPreviewRequestRef, requestId) || !aliveRef.current) return
        setAppFaviconPreview(source)
      }
    }
    loadFaviconPreview()
    return () => invalidateTrackedRequest(faviconPreviewRequestRef)
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

  const navItems = useMemo(
    () => orderNavItems(NAV_ITEMS, parseNavSetting(form.ui_nav_order, [])).filter((item) => item.id !== 'catalog'),
    [form.ui_nav_order],
  )
  const mobilePinned = useMemo(() => parseNavSetting(form.ui_mobile_pinned, DEFAULT_MOBILE_PINNED).slice(0, 4), [form.ui_mobile_pinned])
  const mobilePinnedItems = useMemo(() => {
    const byId = new Map(navItems.map((item) => [item.id, item]))
    return mobilePinned.map((id) => byId.get(id)).filter(Boolean)
  }, [mobilePinned, navItems])

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateStoredColorList = useCallback((key, updater) => {
    setForm((current) => {
      const currentList = parseStoredColors(current[key])
      const nextList = updater(currentList)
      return { ...current, [key]: JSON.stringify(nextList) }
    })
  }, [])
  const addStoredColor = useCallback((key, color) => {
    const normalized = String(color || '').trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) return
    updateStoredColorList(key, (currentList) => (
      currentList.includes(normalized) ? currentList : [...currentList, normalized]
    ))
  }, [updateStoredColorList])
  const removeStoredColor = useCallback((key, color) => {
    const normalized = String(color || '').trim().toLowerCase()
    updateStoredColorList(key, (currentList) => currentList.filter((entry) => entry !== normalized))
  }, [updateStoredColorList])
  const formatPreviewDateTime = (value) => {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString(undefined, {
      hour12: false,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: selectedDisplayTimezone,
      timeZoneName: 'short',
    })
  }

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
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    if (aliveRef.current) setUploadingImage(true)
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
      if (!aliveRef.current) return
      setValue(key, uploaded.public_path)
    } catch (error) {
      if (aliveRef.current) {
        notify(error?.message || 'Image upload failed', 'error')
      }
    } finally {
      uploadInFlightRef.current = false
      if (aliveRef.current) setUploadingImage(false)
    }
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <PageHeader
        icon={SettingsIcon}
        tone="slate"
        title={t('settings')}
        subtitle={uiLanguage === 'km' ? 'ការកំណត់កម្មវិធីទាំងអស់' : 'All app settings'}
        className="mb-6"
        stackOnMobile={false}
        actions={(
          <button type="button" className="btn-primary inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-medium sm:px-4 sm:py-2 sm:text-sm" onClick={() => saveSettings(form)}>
            <Save className="h-4 w-4" />
            <span>{t('save')}</span>
          </button>
        )}
      />

      <div className="mx-auto max-w-[96rem] space-y-4">
        {isAdmin ? (
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
        ) : null}

        {isAdmin ? (
        <div className="card p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Browser tab icon</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Used for the Business OS admin tab. The public portal tab icon is managed on the Customer Portal page.
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
              <button type="button" className="btn-secondary text-sm" onClick={() => uploadImageSetting('ui_app_favicon_image')} disabled={uploadingImage}>
                <ImagePlus className="h-4 w-4" />
                <span>{uploadingImage ? (t('uploading') || 'Uploading...') : (t('upload_image') || 'Upload Image')}</span>
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setValue('ui_app_favicon_image', '')} disabled={uploadingImage}>
                <Trash2 className="h-4 w-4" />
                <span>{t('clear_btn') || 'Clear'}</span>
              </button>
            </div>
          </div>
        </div>
        ) : null}

        {isAdmin ? (
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
        ) : null}

        {isAdmin ? (
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
        ) : null}

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">{t('appearance')}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('theme')}</div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {THEME_OPTION_KEYS.map(([themeValue, copyKey, defaultLabel]) => (
                  <button
                    key={themeValue}
                    type="button"
                    onClick={() => setValue('theme', themeValue)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${form.theme === themeValue ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {copy(copyKey, defaultLabel)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('language')}</div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {LANGUAGE_OPTION_KEYS.map(([langCode, copyKey, defaultLabel]) => (
                  <button
                    key={langCode}
                    type="button"
                    onClick={() => setValue('language', langCode)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${form.language === langCode ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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

            <div className="sm:col-span-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-zinc-900/40">
              <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{t('preview') || 'Preview'}</div>
              <div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-zinc-800" style={{ fontFamily: previewFontFamily }}>
                <div className="mt-1 truncate font-semibold text-gray-900 dark:text-white" style={{ fontSize: `${previewTitleSize}px`, lineHeight: 1.05 }}>
                  {typographyPreview.title}
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300" style={{ fontSize: `${previewBaseSize}px` }}>
                  {typographyPreview.body}
                </p>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="settings-ui-accent-color" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('accent_color')} <span className="text-xs font-normal text-gray-400">{copy('appearanceHintAccent', 'Buttons, active links, and highlights')}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {accentChoices.map(([color, name]) => (
                  <button
                    key={`${color}-${name}`}
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
                  onBlur={(event) => addStoredColor('ui_custom_accent_colors', event.target.value)}
                  title={copy('customColor', 'Custom color')}
                  className="w-7 h-7 rounded-full border border-gray-300 cursor-pointer p-0"
                  style={{ padding: 0 }}
                />
              </div>
              {customAccentColors.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {customAccentColors.map((color) => (
                    <button
                      key={`accent-${color}`}
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      onClick={() => removeStoredColor('ui_custom_accent_colors', color)}
                      title={`Remove ${color}`}
                    >
                      <span className="h-3 w-3 rounded-full border border-gray-200" style={{ background: color }} />
                      <span>{color}</span>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <SwatchPicker
              fieldId="settings-ui-sidebar-color"
              colors={sidebarColorChoices}
              value={form.ui_sidebar_color || ''}
              onChange={(value) => setValue('ui_sidebar_color', value)}
              fallbackValue={form.theme === 'dark' ? '#0f172a' : '#ffffff'}
              title={copy('sidebarColorTitle', 'Sidebar Color')}
              hint={copy('sidebarColorHint', 'Navigation background')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
              customColors={customSidebarColors}
              onAddCustomColor={(value) => addStoredColor('ui_custom_sidebar_colors', value)}
              onRemoveCustomColor={(value) => removeStoredColor('ui_custom_sidebar_colors', value)}
            />

            <SwatchPicker
              fieldId="settings-ui-page-bg"
              colors={pageBgChoices}
              value={form.ui_page_bg || ''}
              onChange={(value) => setValue('ui_page_bg', value)}
              fallbackValue={form.theme === 'dark' ? '#0f172a' : '#f9fafb'}
              title={copy('pageBgTitle', 'Page Background')}
              hint={copy('pageBgHint', 'Main content area')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
              customColors={customPageBgColors}
              onAddCustomColor={(value) => addStoredColor('ui_custom_page_bg_colors', value)}
              onRemoveCustomColor={(value) => removeStoredColor('ui_custom_page_bg_colors', value)}
            />

            <SwatchPicker
              fieldId="settings-ui-sidebar-text-color"
              colors={sidebarTextChoices}
              value={form.ui_sidebar_text_color || ''}
              onChange={(value) => setValue('ui_sidebar_text_color', value)}
              fallbackValue={form.theme === 'dark' ? '#f8fafc' : '#111827'}
              title={copy('sidebarTextColorTitle', 'Sidebar Text & Icon Color')}
              hint={copy('sidebarTextColorHint', 'Overrides page names, section text, and icons on the sidebar/mobile nav')}
              resetLabel={copy('resetToDefault', 'Reset to default')}
              autoLabel={copy('autoLabel', 'auto')}
              customColorTitle={copy('customColor', 'Custom color')}
              customColors={customSidebarTextColors}
              onAddCustomColor={(value) => addStoredColor('ui_custom_sidebar_text_colors', value)}
              onRemoveCustomColor={(value) => removeStoredColor('ui_custom_sidebar_text_colors', value)}
            />
          </div>
        </div>

        {isAdmin ? (
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
              <p className="font-mono text-blue-600 dark:text-blue-400">{formatPreviewDateTime(new Date())}</p>
              <p className="text-gray-500 mt-1">{t('display_timezone')}: <strong>{selectedDisplayTimezone}</strong></p>
              <p className="text-gray-500 mt-1">{t('device_timezone')}: <strong>{deviceTimezone}</strong></p>
              <p className="text-gray-400 mt-1">{t('timezone_display_note')}</p>
            </div>
          </div>
        </div>
        ) : null}

        {isAdmin ? (
        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{copy('navigationTitle', 'Navigation Layout')}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{copy('navigationHint', 'Choose the sidebar order and which 4 items stay pinned in the mobile bottom bar.')}</p>

          <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-900/20">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">{copy('mobilePinned', 'Pinned on mobile')}</div>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={resetNavigationLayout}>
                {copy('navReset', 'Reset navigation')}
              </button>
            </div>
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
                  className={`flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs dark:border-blue-900/50 dark:bg-blue-950/40 ${dragPinnedId === item.id ? 'opacity-60' : ''}`}
                >
                  <span className="cursor-grab text-gray-400" title={copy('dragToReorder', 'Drag to reorder')}>
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex flex-1 items-center gap-2 truncate text-gray-700 dark:text-gray-200">
                    {(() => {
                      const Icon = SETTINGS_NAV_ICONS[item.id] || SettingsIcon
                      return <Icon className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                    })()}
                    <span className="truncate">{index + 1}. {getSettingsNavLabel(item, t)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary flex h-7 w-7 items-center justify-center px-0 py-0"
                    onClick={() => movePinnedItem(item.id, 'up')}
                    disabled={index === 0}
                    aria-label={copy('moveUp', 'Up')}
                    title={copy('moveUp', 'Up')}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex h-7 w-7 items-center justify-center px-0 py-0"
                    onClick={() => movePinnedItem(item.id, 'down')}
                    disabled={index === mobilePinnedItems.length - 1}
                    aria-label={copy('moveDown', 'Down')}
                    title={copy('moveDown', 'Down')}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-blue-200 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/50 dark:text-blue-300">
                  {copy('noPinnedItems', 'No pinned items yet.')}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            {navItems.map((item, index) => {
              const isPinned = mobilePinned.includes(item.id)
              const Icon = SETTINGS_NAV_ICONS[item.id] || SettingsIcon
              return (
                <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/70">
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg bg-white p-1.5 text-blue-600 shadow-sm dark:bg-gray-900 dark:text-blue-400">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex flex-1 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100">{getSettingsNavLabel(item, t)}</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500 shadow-sm dark:bg-gray-900 dark:text-gray-300">
                        {index + 1}
                      </span>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="btn-secondary flex h-7 w-7 items-center justify-center px-0 py-0"
                        onClick={() => moveNavItem(item.id, 'up')}
                        disabled={index === 0}
                        aria-label={copy('moveUp', 'Up')}
                        title={copy('moveUp', 'Up')}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-secondary flex h-7 w-7 items-center justify-center px-0 py-0"
                        onClick={() => moveNavItem(item.id, 'down')}
                        disabled={index === navItems.length - 1}
                        aria-label={copy('moveDown', 'Down')}
                        title={copy('moveDown', 'Down')}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className={`flex h-7 w-7 items-center justify-center rounded-md border px-0 py-0 transition-colors ${isPinned ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
                        onClick={() => toggleMobilePinned(item.id)}
                        aria-label={isPinned ? copy('pinned', 'Pinned') : copy('inMoreMenu', 'Menu')}
                        title={isPinned ? copy('pinned', 'Pinned') : copy('inMoreMenu', 'Menu')}
                      >
                        {isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

        </div>
        ) : null}

        {isAdmin ? (
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
        ) : null}

        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{t('session_duration') || 'Session duration'}</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">{t('session_duration_hint')}</p>

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
                <option value="1d">{t('for_1_day') || '1 day'}</option>
                <option value="3d">{t('for_3_days') || '3 days'}</option>
                <option value="7d">{t('days_7')}</option>
                <option value="14d">{t('for_14_days') || '14 days'}</option>
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




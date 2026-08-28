import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { BUSINESS_TIME_ZONE } from '../../constants.ts'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import BookUser from 'lucide-react/dist/esm/icons/book-user.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js'
import ImagePlus from 'lucide-react/dist/esm/icons/image-plus.js'
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Pin from 'lucide-react/dist/esm/icons/pin.js'
import PinOff from 'lucide-react/dist/esm/icons/pin-off.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import Server from 'lucide-react/dist/esm/icons/server.js'
import SettingsIcon from 'lucide-react/dist/esm/icons/settings.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import FontFamilyPicker from './FontFamilyPicker'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS, orderNavItems, parseNavSetting } from '../shared/navigationConfig'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
import AppSelect from '../shared/AppSelect.tsx'
import { beginTrackedRequest, invalidateTrackedRequest, isTrackedRequestCurrent, withLoaderTimeout } from '../../utils/loaders.ts'
import { beginKeyedAction, beginSingleAction, finishKeyedAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { buildSettingsConflictState, diffSettingsConflictFields } from './settingsConflict.ts'
import type { SettingsConflictState } from './settingsConflict.ts'
import {
  createInitialUploadState,
  reduceUploadState,
  sanitizePersistedMediaPath,
} from '../../utils/mediaUploadState.ts'
import type { UploadAction } from '../../utils/mediaUploadState.ts'

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, type?: string) => void
type SettingValue = string | number | null | undefined
type SettingsRecord = Record<string, SettingValue>
type SettingsSectionId = 'all' | 'business' | 'appearance' | 'security'
type ColorChoice = [string, string, string]
type UploadState = ReturnType<typeof createInitialUploadState>
type UploadStateMap = Record<string, UploadState>

interface AppUser {
  id?: string | number
  name?: string
  permissions?: string | Record<string, unknown> | null
}

interface SaveSettingsResult {
  conflict?: boolean
  attempted?: SettingsRecord
  currentSettings?: SettingsRecord
  actualUpdatedAt?: string | null
  expectedUpdatedAt?: string | null
}

interface AppContextValue {
  t: TranslateFn
  settings: SettingsRecord
  saveSettings: (newSettings: SettingsRecord, options?: Record<string, unknown>) => Promise<SaveSettingsResult>
  loadSettings: (options?: { force?: boolean }) => Promise<SettingsRecord | null>
  user?: AppUser | null
  notify: NotifyFn
  deviceTimezone?: string
}

interface SettingsApi {
  uploadFileAsset?: (payload: {
    file: File
    userId?: string | number
    userName?: string
    signal?: AbortSignal
    onProgress?: (progress: { percent?: number }) => void
  }) => Promise<{
    public_path?: string
    cache_version?: string | number
    processing_status?: string
    media_job_id?: string | number
    error?: string
  }>
}

interface NavItem {
  id: string
  key: string
}

interface SwatchPickerProps {
  colors: ColorChoice[]
  value: string
  onChange: (value: string) => void
  fallbackValue: string
  title: string
  hint: string
  resetLabel: string
  autoLabel: string
  customColorTitle: string
  fieldId: string
  customColors?: string[]
  onAddCustomColor?: (color: string) => void
  onRemoveCustomColor?: (color: string) => void
}

interface SettingsSectionProps {
  title: ReactNode
  description?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

type CopyFn = (key: string, fallback: string) => string

const useApp = useAppHook as () => AppContextValue

function getSettingsApi(): SettingsApi {
  return (window as unknown as { api: SettingsApi }).api || {}
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function toStringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function toNumberValue(value: unknown, fallback = 0): number {
  const parsed = Number.parseFloat(toStringValue(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

const SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS = 30000

const FALLBACK_COPY: Record<'en' | 'km', Record<string, string>> = {
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
    defaultLandingPage: 'Default landing page',
    defaultLandingPageHint: 'Which page opens first after signing in. Applies to every user unless they navigate elsewhere.',
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

const SIDEBAR_COLORS: ColorChoice[] = [
  ['', 'Auto', '#e5e7eb'],
  ['#f8fafc', 'Light', '#dbe4ef'],
  ['#dbeafe', 'Mid light', '#93c5fd'],
  ['#1e293b', 'Mid dark', '#334155'],
  ['#0f172a', 'Dark', '#1e293b'],
]

const PAGE_BG_COLORS: ColorChoice[] = [
  ['', 'Auto', '#e5e7eb'],
  ['#ffffff', 'Light', '#e5e7eb'],
  ['#f1f5f9', 'Mid light', '#cbd5e1'],
  ['#1f2937', 'Mid dark', '#374151'],
  ['#0f172a', 'Dark', '#1e293b'],
]

const SIDEBAR_TEXT_COLORS: ColorChoice[] = [
  ['', 'Auto', '#d1d5db'],
  ['#ffffff', 'Light', '#e5e7eb'],
  ['#cbd5e1', 'Mid light', '#94a3b8'],
  ['#334155', 'Mid dark', '#475569'],
  ['#111827', 'Dark', '#374151'],
]

const RETIRED_PAYMENT_METHODS = new Set(['pi pay', 'transfer'])
const DEFAULT_PAYMENT_METHODS = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR']

function normalizePaymentMethods(value: unknown): string[] {
  const methods = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return methods
    .map((method) => String(method || '').trim())
    .filter((method) => {
      const normalized = method.toLocaleLowerCase()
      if (!method || RETIRED_PAYMENT_METHODS.has(normalized) || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
}

const SETTINGS_SECTION_OPTIONS: Array<{ value: SettingsSectionId; labelKey: string; label: string; hintKey: string; hint: string }> = [
  { value: 'all', labelKey: 'all', label: 'All', hintKey: 'settings_section_all_hint', hint: 'Show every settings section.' },
  { value: 'business', labelKey: 'business', label: 'Business', hintKey: 'settings_section_business_hint', hint: 'Business profile, browser icon, currency, receipt, and payment settings.' },
  { value: 'appearance', labelKey: 'appearance', label: 'Appearance', hintKey: 'settings_section_appearance_hint', hint: 'Theme, colors, fonts, typography, and navigation layout.' },
  { value: 'security', labelKey: 'security', label: 'Security', hintKey: 'settings_section_security_hint', hint: 'Session duration, notifications, and two-factor authentication.' },
]

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>(SETTINGS_SECTION_OPTIONS.map((option) => option.value))

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTION_IDS.has(value as SettingsSectionId)
}

const THEME_OPTION_KEYS = [['light', 'themeLight', 'Light'], ['dark', 'themeDark', 'Dark']]
const LANGUAGE_OPTION_KEYS = [['en', 'englishLabel', 'English'], ['km', 'khmerLabel', 'Khmer']]
const CARD_STYLE_OPTION_KEYS = [['sharp', 'sharp'], ['rounded', 'rounded'], ['pill', 'pill']]
const DENSITY_OPTION_KEYS = [['comfortable', 'comfortable'], ['compact', 'compact'], ['spacious', 'spacious']]

// Default swatch changed from blue (#2563eb) to the app's new brass accent,
// #9c7a3c (Aug 24 2026 -- "clean, professional, expensive", no blue). Other
// presets left as alternate options for orgs that want a different accent;
// only the default/first swatch and the '#2563eb' fallbacks below (and the
// matching one in AppContext.tsx) needed to change.
const ACCENT_COLORS: Array<[string, string]> = [
  ['#9c7a3c', 'Brass'],
  ['#7c3aed', 'Mid light'],
  ['#0f766e', 'Mid dark'],
  ['#1f2937', 'Dark'],
]

function parseStoredColors(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function buildColorChoices(baseColors: ColorChoice[], customColors: string[] = []): ColorChoice[] {
  const seen = new Set()
  const presets = Array.isArray(baseColors) ? baseColors : []
  const extras = Array.isArray(customColors) ? customColors : []
  const next: ColorChoice[] = []
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

const SETTINGS_NAV_ICONS: Record<string, typeof SettingsIcon> = {
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

function useCopy(_language: string, t: TranslateFn): CopyFn {
  return (key, fallback) => {
    const translated = t?.(key)
    if (translated && translated !== key) return translated
    return FALLBACK_COPY.en?.[key] || fallback || key
  }
}

function getSettingsNavLabel(item: NavItem, t: TranslateFn): string {
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
}: SwatchPickerProps) {
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
            className={`w-8 h-8 rounded-lg transition-transform text-xs flex items-center justify-center ${(value || '') === color ? 'ring-2 ring-offset-1 ring-primary-500 scale-110' : 'hover:scale-105'}`}
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

function SettingsSection({
  title,
  description = '',
  defaultOpen = false,
  children,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
      >
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-gray-900 dark:text-white">{title}</div>
          {description ? <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</div> : null}
        </div>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="border-t border-gray-100 px-4 py-4 sm:px-5 dark:border-gray-800">
          {children}
        </div>
      ) : null}
    </section>
  )
}

export default function Settings() {
  const { t, settings, saveSettings, loadSettings, user, notify, deviceTimezone } = useApp()
  const [pmList, setPmList] = useState<string[]>([])
  const [newPm, setNewPm] = useState('')
  const [form, setForm] = useState<SettingsRecord>({})
  const [previewNow, setPreviewNow] = useState(() => new Date())
  const [dragPinnedId, setDragPinnedId] = useState<string | null>(null)
  const [dragNavId, setDragNavId] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('all')
  const [settingsConflict, setSettingsConflict] = useState<SettingsConflictState | null>(null)
  const [showConflictReview, setShowConflictReview] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [uploadStates, setUploadStates] = useState<UploadStateMap>(() => ({}))
  const settingsSaveInFlightRef = useRef(false)
  const uploadInFlightKeysRef = useRef<Set<string>>(new Set())
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map())
  const uploadOriginalValuesRef = useRef<Map<string, string>>(new Map())
  const uploadPreviewUrlsRef = useRef<Map<string, string>>(new Map())
  const formHydratedRef = useRef(false)
  const formDirtyRef = useRef(false)
  const aliveRef = useRef(true)
  const sectionStorageKey = 'business-os:settings:section'
  const showSettingsSection = (sectionId: SettingsSectionId) => settingsSection === 'all' || settingsSection === sectionId
  const handleSettingsSectionChange = useCallback((value: string) => {
    if (isSettingsSectionId(value)) setSettingsSection(value)
  }, [])
  const uploadingImage = useMemo(
    () => Object.values(uploadStates).some((state) => state?.status === 'uploading'),
    [uploadStates],
  )

  const uiLanguage = toStringValue(form.language || settings.language, 'en')
  const copy = useCopy(uiLanguage, t)
  const previewFontFamily = FONT_PREVIEW_CSS[toStringValue(form.ui_font_family, 'system') as keyof typeof FONT_PREVIEW_CSS] || FONT_PREVIEW_CSS.system
  const previewBaseSize = Math.max(14, Math.round((toNumberValue(form.ui_font_size, 14) / 14) * 16))
  const previewTitleSize = form.ui_title_font_size || Math.max(20, Math.round((toNumberValue(form.ui_font_size, 14) || 14) * 1.75))
  const previewSidebarSize = form.ui_sidebar_font_size || Math.max(13, Math.round(previewBaseSize * 0.95))
  const previewSectionSize = form.ui_section_font_size || Math.max(15, Math.round(previewBaseSize * 1.08))
  const previewChipSize = form.ui_chip_font_size || Math.max(11, Math.round(previewBaseSize * 0.78))
  const previewTableSize = form.ui_table_font_size || (form.ui_font_size || 14)
  const selectedDisplayTimezone = BUSINESS_TIME_ZONE
  const previewLanguage = uiLanguage === 'km' ? 'km' : 'en'
  const customAccentColors = useMemo(() => parseStoredColors(form.ui_custom_accent_colors), [form.ui_custom_accent_colors])
  const customSidebarColors = useMemo(() => parseStoredColors(form.ui_custom_sidebar_colors), [form.ui_custom_sidebar_colors])
  const customPageBgColors = useMemo(() => parseStoredColors(form.ui_custom_page_bg_colors), [form.ui_custom_page_bg_colors])
  const customSidebarTextColors = useMemo(() => parseStoredColors(form.ui_custom_sidebar_text_colors), [form.ui_custom_sidebar_text_colors])
  const accentChoices = useMemo(() => buildColorChoices(ACCENT_COLORS.map(([color, label]) => [color, label, color] as ColorChoice), customAccentColors), [customAccentColors])
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
        title: 'Leang Beauty',
        sidebar: 'Sidebar item',
        section: 'Section heading',
        body: 'Products, receipts, settings, and forms will use this font family and size scale.',
        chip: 'Category',
      }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      uploadControllersRef.current.forEach((controller) => controller?.abort?.())
      uploadControllersRef.current.clear()
      uploadPreviewUrlsRef.current.forEach((previewUrl) => {
        if (previewUrl && String(previewUrl).startsWith('blob:')) URL.revokeObjectURL(previewUrl)
      })
      uploadPreviewUrlsRef.current.clear()
    }
  }, [])

  // (Settings favicon-preview effect removed with the favicon section --
  // the admin tab icon is DEFAULT branding now.)

  useEffect(() => {
    try {
      const raw = toStringValue(settings.pos_payment_methods)
      const parsed = raw ? JSON.parse(raw) : DEFAULT_PAYMENT_METHODS
      setPmList(normalizePaymentMethods(parsed))
    } catch {
      setPmList(DEFAULT_PAYMENT_METHODS)
    }
  }, [settings.pos_payment_methods])

  useEffect(() => {
    const nextSettings = settings && typeof settings === 'object' ? settings : {}
    // Settings refreshes can briefly deliver an empty mirror while the
    // authoritative response is still loading. Do not blank a rendered
    // form, and do not overwrite edits the person is actively making.
    if (!Object.keys(nextSettings).length && formHydratedRef.current) return
    if (formDirtyRef.current) return
    setForm({ ...nextSettings })
    formHydratedRef.current = true
  }, [settings])

  useEffect(() => {
    const timer = window.setInterval(() => setPreviewNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const isAdmin = useMemo(() => {
    try {
      const permissions = typeof user?.permissions === 'string' ? JSON.parse(user.permissions) : (user?.permissions || {})
      return permissions.all
    } catch {
      return false
    }
  }, [user])

  const navItems = useMemo<NavItem[]>(
    () => orderNavItems(NAV_ITEMS, parseNavSetting(toStringValue(form.ui_nav_order), [])) as NavItem[],
    [form.ui_nav_order],
  )
  const mobilePinned = useMemo(() => parseNavSetting(toStringValue(form.ui_mobile_pinned), DEFAULT_MOBILE_PINNED).slice(0, 4), [form.ui_mobile_pinned])
  const mobilePinnedItems = useMemo(() => {
    const byId = new Map(navItems.map((item) => [item.id, item]))
    return mobilePinned.map((id) => byId.get(id)).filter((item): item is NavItem => Boolean(item))
  }, [mobilePinned, navItems])

  const setValue = (key: string, value: SettingValue) => {
    formDirtyRef.current = true
    setForm((current) => ({ ...current, [key]: value }))
  }
  const getUploadState = useCallback(
    (key: string) => uploadStates[key] || createInitialUploadState(),
    [uploadStates],
  )
  const updateUploadState = useCallback((key: string, action: UploadAction) => {
    setUploadStates((current) => reduceUploadState(current, { ...(action || {}), key }))
  }, [])
  const updateStoredColorList = useCallback((key: string, updater: (currentList: string[]) => string[]) => {
    formDirtyRef.current = true
    setForm((current) => {
      const currentList = parseStoredColors(current[key])
      const nextList = updater(currentList)
      return { ...current, [key]: JSON.stringify(nextList) }
    })
  }, [])
  const addStoredColor = useCallback((key: string, color: string) => {
    const normalized = String(color || '').trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) return
    updateStoredColorList(key, (currentList) => (
      currentList.includes(normalized) ? currentList : [...currentList, normalized]
    ))
  }, [updateStoredColorList])
  const removeStoredColor = useCallback((key: string, color: string) => {
    const normalized = String(color || '').trim().toLowerCase()
    updateStoredColorList(key, (currentList) => currentList.filter((entry) => entry !== normalized))
  }, [updateStoredColorList])
  const formatPreviewDateTime = (value: Date | string | number) => {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('en-US', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: selectedDisplayTimezone,
      timeZoneName: 'short',
    })
  }

  const moveNavItem = (id: string, direction: 'up' | 'down') => {
    const items = [...navItems]
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) return
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= items.length) return
    ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
    setValue('ui_nav_order', JSON.stringify(items.map((item) => item.id)))
  }

  const moveNavBefore = (dragId: string | null, targetId: string) => {
    if (!dragId || !targetId || dragId === targetId) return
    const items = [...navItems]
    const dragIndex = items.findIndex((item) => item.id === dragId)
    const targetIndex = items.findIndex((item) => item.id === targetId)
    if (dragIndex < 0 || targetIndex < 0) return
    const [dragged] = items.splice(dragIndex, 1)
    items.splice(dragIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, dragged)
    setValue('ui_nav_order', JSON.stringify(items.map((item) => item.id)))
  }

  const toggleMobilePinned = (id: string) => {
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

  const movePinnedItem = (id: string, direction: 'up' | 'down') => {
    const next = [...mobilePinned]
    const index = next.indexOf(id)
    if (index < 0) return
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setValue('ui_mobile_pinned', JSON.stringify(next))
  }

  const movePinnedBefore = (dragId: string | null, targetId: string) => {
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
    setValue('default_landing_page', '')
  }

  const field = (key: string, label: string, type = 'text', placeholder = '') => (
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
          key === 'business_website' ? 'url' :
          'off'
        }
        placeholder={placeholder}
        value={form[key] || ''}
        onChange={(event) => setValue(key, event.target.value)}
      />
    </div>
  )

  const savePaymentMethods = (updated: string[]) => {
    setPmList(updated)
    void saveSettings(
      { pos_payment_methods: JSON.stringify(updated) },
      {
        silentToast: true,
        refreshChannels: ['settings', 'sales', 'pos', 'dashboard'],
        reason: 'pos-payment-methods-saved',
        source: 'settings:payment-methods',
      },
    )
  }

  const cancelImageUpload = useCallback((key: string) => {
    const controller = uploadControllersRef.current.get(key)
    controller?.abort?.()
    uploadControllersRef.current.delete(key)
    updateUploadState(key, { type: 'cancel' })
  }, [updateUploadState])

  const uploadImageSetting = async (key: string) => {
    if (!beginKeyedAction(uploadInFlightKeysRef, key)) return
    try {
      const file = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => resolve(input.files?.[0] || null)
        input.click()
      })
      if (!file) return
      const previousValue = String(form[key] || settings[key] || '').trim()
      uploadOriginalValuesRef.current.set(key, previousValue)
      const previousPreview = uploadPreviewUrlsRef.current.get(key)
      if (previousPreview && String(previousPreview).startsWith('blob:')) {
        URL.revokeObjectURL(previousPreview)
      }
      const localPreview = URL.createObjectURL(file)
      uploadPreviewUrlsRef.current.set(key, localPreview)
      setValue(key, localPreview)

      const controller = new AbortController()
      uploadControllersRef.current.set(key, controller)
      updateUploadState(key, {
        type: 'start',
        fileName: file.name,
        previewUrl: localPreview,
      })
      const uploaded = await withLoaderTimeout(
        () => getSettingsApi().uploadFileAsset?.({
          file,
          userId: user?.id,
          userName: user?.name,
          signal: controller.signal,
          onProgress: ({ percent }) => updateUploadState(key, { type: 'progress', progress: percent }),
        }),
        'Upload settings image',
        SETTINGS_IMAGE_UPLOAD_TIMEOUT_MS,
      )
      if (!uploaded?.public_path) throw new Error(uploaded?.error || 'Image upload failed')
      if (!aliveRef.current) return
      const { buildCacheBustedMediaPath } = await import('../../utils/mediaUpload.ts')
      const nextPath = buildCacheBustedMediaPath(uploaded.public_path, uploaded.cache_version)
      setValue(key, nextPath)
      updateUploadState(key, {
        type: 'success',
        publicPath: nextPath,
        processingStatus: uploaded.processing_status || 'ready',
        mediaJobId: uploaded.media_job_id || '',
        cacheVersion: uploaded.cache_version || '',
      })
    } catch (error) {
      if (aliveRef.current) {
        const errorMessage = getErrorMessage(error, 'Image upload failed')
        const cancelled = /cancelled|canceled|aborted/i.test(errorMessage)
        const previousValue = uploadOriginalValuesRef.current.get(key)
        setValue(key, previousValue || '')
        updateUploadState(key, cancelled ? { type: 'cancel' } : { type: 'error', error: errorMessage })
        if (!cancelled) notify(errorMessage, 'error')
      }
    } finally {
      finishKeyedAction(uploadInFlightKeysRef, key)
      uploadControllersRef.current.delete(key)
      uploadOriginalValuesRef.current.delete(key)
    }
  }

  const handleSaveSettings = async () => {
    if (!beginSingleAction(settingsSaveInFlightRef, { blocked: savingSettings })) return
    if (uploadingImage) {
      finishSingleAction(settingsSaveInFlightRef)
      notify(uiLanguage === 'km' ? 'សូមរង់ចាំឱ្យការផ្ទុករូបភាពបញ្ចប់សិន។' : 'Wait for the image upload to finish before saving settings.', 'error')
      return
    }
    setSavingSettings(true)
    const sanitizedForm = {
      ...form,
      ui_app_favicon_image: sanitizePersistedMediaPath(form.ui_app_favicon_image, toStringValue(settings.ui_app_favicon_image)),
    }
    try {
      const result = await saveSettings(sanitizedForm, {
        reason: 'settings-saved',
        source: 'settings:form-save',
      })
      if (result?.conflict) {
        setSettingsConflict(buildSettingsConflictState({
          attempted: result?.attempted || sanitizedForm,
          currentSettings: result?.currentSettings || {},
          actualUpdatedAt: result?.actualUpdatedAt || null,
          expectedUpdatedAt: result?.expectedUpdatedAt || null,
        }))
        setShowConflictReview(false)
        return
      }
      setForm((current) => ({
        ...current,
        ui_app_favicon_image: sanitizedForm.ui_app_favicon_image,
      }))
      formDirtyRef.current = false
      setSettingsConflict(null)
      setShowConflictReview(false)
    } finally {
      finishSingleAction(settingsSaveInFlightRef)
      setSavingSettings(false)
    }
  }

  const conflictFieldRows = useMemo(() => (
    settingsConflict
      ? diffSettingsConflictFields({
          localDraft: settingsConflict.localDraft || form,
          serverSettings: settingsConflict.serverSettings || {},
        })
      : []
  ), [form, settingsConflict])

  const reloadLatestSettings = useCallback(async () => {
    const latest = await loadSettings({ force: true }).catch(() => null)
    const nextSettings = latest && typeof latest === 'object'
      ? latest
      : (settingsConflict?.serverSettings || {})
    setForm({ ...nextSettings } as SettingsRecord)
    formDirtyRef.current = false
    setSettingsConflict(null)
    setShowConflictReview(false)
  }, [loadSettings, settingsConflict])

  const keepServerSettings = useCallback(() => {
    setForm({ ...(settingsConflict?.serverSettings || {}) } as SettingsRecord)
    formDirtyRef.current = false
    setSettingsConflict(null)
    setShowConflictReview(false)
  }, [settingsConflict])

  const retrySaveWithLatest = useCallback(async () => {
    const mergedDraft = {
      ...(settingsConflict?.serverSettings || {}),
      ...form,
    }
    const normalizedMergedDraft = mergedDraft as SettingsRecord
    setForm(normalizedMergedDraft)
    const result = await saveSettings(normalizedMergedDraft, {
      reason: 'settings-merged',
      source: 'settings:conflict-merge',
    })
    if (result?.conflict) {
      setSettingsConflict(buildSettingsConflictState({
        attempted: result?.attempted || mergedDraft,
        currentSettings: result?.currentSettings || {},
        actualUpdatedAt: result?.actualUpdatedAt || null,
        expectedUpdatedAt: result?.expectedUpdatedAt || null,
      }))
      setShowConflictReview(true)
      return
    }
    setSettingsConflict(null)
    setShowConflictReview(false)
  }, [form, saveSettings, settingsConflict])

  const notificationRealertValue = String(form.notifications_realert_minutes || '10')
  const notificationRealertPreset = ['5', '10', '30', '60'].includes(notificationRealertValue)
    ? notificationRealertValue
    : 'custom'
  const settingsSectionOptions = useMemo(() => (
    SETTINGS_SECTION_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey) || option.label,
      hint: t(option.hintKey) || option.hint,
    }))
  ), [t])

  return (
    <div className="page-scroll p-4 sm:p-6">
      {/* Section tabs share a row with Save so the primary action doesn't
          need its own separate title bar above them. */}
      <div className="mx-auto mb-4 flex max-w-[96rem] flex-wrap items-center justify-between gap-2">
        <SectionSwitcher
          className="mb-0 flex-1"
          label=""
          options={settingsSectionOptions}
          value={settingsSection}
          onChange={handleSettingsSectionChange}
          storageKey={sectionStorageKey}
        />
        <button type="button" className="btn-primary inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium sm:px-5 sm:py-2.5 sm:text-base" onClick={handleSaveSettings} disabled={savingSettings || uploadingImage}>
          <Save className="h-4 w-4 sm:h-5 sm:w-5" />
          <span>{savingSettings ? (t('saving') || 'Saving...') : t('save')}</span>
        </button>
      </div>

      <LoadingWatchdog
        loading={uploadingImage}
        timeoutMs={7000}
        label={t('uploading') || 'Uploading...'}
        details="Uploading and previewing the selected settings image."
        className="mx-auto mb-4 max-w-[96rem]"
      />

      {settingsConflict ? (
        <div className="mx-auto mb-4 max-w-[96rem] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="font-semibold">
                {uiLanguage === 'km' ? 'ការកំណត់ត្រូវបានផ្លាស់ប្តូរនៅឧបករណ៍ផ្សេង។' : 'Settings changed on another device.'}
              </div>
              <div className="mt-1 text-xs text-amber-800/90 dark:text-amber-100/80">
                {uiLanguage === 'km'
                  ? 'សូមទាញយកតម្លៃថ្មី ប្រៀបធៀបការផ្លាស់ប្តូរ ឬព្យាយាមរក្សាទុកម្តងទៀតជាមួយកំណែចុងក្រោយ។'
                  : 'Reload the latest values, compare changed fields, or retry your save with the newest version.'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-xs" onClick={reloadLatestSettings}>
                {uiLanguage === 'km' ? 'ទាញយកថ្មី' : 'Reload latest'}
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setShowConflictReview((current) => !current)}>
                {uiLanguage === 'km' ? 'ពិនិត្យការផ្លាស់ប្តូរ' : 'Review changes'}
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => { setSettingsConflict(null); setShowConflictReview(false) }}>
                {uiLanguage === 'km' ? 'បិទ' : 'Dismiss'}
              </button>
            </div>
          </div>

          {showConflictReview ? (
            <div className="mt-3 rounded-lg border border-amber-200/80 bg-white/80 dark:border-amber-900/60 dark:bg-slate-900/40">
              <div className="border-b border-amber-200/80 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-900/60 dark:text-amber-100">
                {uiLanguage === 'km' ? 'ការផ្លាស់ប្តូរដែលខុសគ្នា' : 'Changed fields'}
              </div>
              <div className="divide-y divide-amber-100 dark:divide-amber-900/40">
                {conflictFieldRows.length ? conflictFieldRows.map((row) => (
                  <div key={row.key} className="grid gap-3 px-3 py-3 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">{row.key.replace(/_/g, ' ')}</div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{uiLanguage === 'km' ? 'របស់អ្នក' : 'Your draft'}</div>
                      <div className="mt-1 break-words text-sm text-gray-900 dark:text-white">{String(row.localValue ?? '') || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{uiLanguage === 'km' ? 'ម៉ាស៊ីនមេ' : 'Server'}</div>
                      <div className="mt-1 break-words text-sm text-gray-900 dark:text-white">{String(row.serverValue ?? '') || '—'}</div>
                    </div>
                  </div>
                )) : (
                  <div className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">
                    {uiLanguage === 'km' ? 'មិនមានវាលខុសគ្នាដែលត្រូវបង្ហាញទេ។' : 'No changed fields to compare.'}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 border-t border-amber-200/80 px-3 py-3 sm:flex-row sm:justify-end dark:border-amber-900/60">
                <button type="button" className="btn-secondary text-xs" onClick={keepServerSettings}>
                  {uiLanguage === 'km' ? 'រក្សាតម្លៃម៉ាស៊ីនមេ' : 'Keep server'}
                </button>
                <button type="button" className="btn-primary text-xs" onClick={retrySaveWithLatest}>
                  {uiLanguage === 'km' ? 'រក្សាទុកម្តងទៀតជាមួយកំណែចុងក្រោយ' : 'Retry save with latest'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mx-auto max-w-[96rem] space-y-4">
        {isAdmin && showSettingsSection('business') ? (
        <SettingsSection title={t('business_info')} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('business_name', t('business_name'), 'text', 'My Business')}
            {field('business_phone', t('phone'), 'text', '+1 234 567')}
            {field('business_address', t('address'), 'text', '123 Main St')}
            {field('business_email', t('email'), 'email', 'info@biz.com')}
            {field('tax_id', t('tax_id'), 'text', 'TAX-000')}
            {field('business_website', t('business_website') || 'Public portal / website', 'url', 'https://yourshop.example.com')}
          </div>

          {/* The admin "tab icon" (favicon / PWA icon) section was removed:
              that icon is DEFAULT app branding now, not settings-
              customizable (see App.tsx's removed favicon/manifest effects
              and the PWA install fix). Settings customizes only the in-app
              TOPBAR organization logo, above. */}
        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('business') ? (
        <SettingsSection title={t('currency_tax_settings')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('currency_usd_symbol', t('currency_usd_symbol'), 'text', '$')}
            {field('currency_khr_symbol', t('currency_khr_symbol'), 'text', '៛')}
            {field('exchange_rate', t('exchange_rate'), 'number', '4100')}
            {field('tax_rate', t('tax_rate'), 'number', '0')}
            <div>
              <label htmlFor="settings-display-currency" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('display_currency')}</label>
              <AppSelect
                id="settings-display-currency"
                name="display_currency"
                value={form.display_currency || 'USD'}
                onChange={(nextValue) => setValue('display_currency', nextValue)}
                ariaLabel={t('display_currency')}
                className="w-full"
                buttonClassName="h-10 w-full"
                menuClassName="min-w-[12rem]"
                options={[
                  { value: 'USD', label: t('usd_only') },
                  { value: 'KHR', label: t('khr_only') },
                  { value: 'BOTH', label: t('both_currencies') },
                ]}
              />
            </div>
          </div>
        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('business') ? (
        <SettingsSection title={t('pos_settings') || 'POS Settings'}>
          <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="pr-3">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('pos_show_item_discount') || 'Show Discount in Cart'}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('pos_show_item_discount_desc') || 'Show the original price and savings for each item in the cart when a special price or discount applies. The price can still be changed in the cart either way.'}</div>
            </div>
            <input
              type="checkbox"
              checked={String(form.pos_show_item_discount ?? 'true') !== 'false'}
              onChange={(event) => setValue('pos_show_item_discount', event.target.checked ? 'true' : 'false')}
            />
          </label>
        </SettingsSection>
        ) : null}

        {showSettingsSection('appearance') ? (
        <SettingsSection title={t('appearance')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('theme')}</div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {THEME_OPTION_KEYS.map(([themeValue, copyKey, defaultLabel]) => (
                  <button
                    key={themeValue}
                    type="button"
                    onClick={() => setValue('theme', themeValue)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${form.theme === themeValue ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${form.language === langCode ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
                  >
                    {copy(copyKey, defaultLabel)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SettingsSection>
        ) : null}

        {showSettingsSection('appearance') ? (
        <SettingsSection title={t('design_typography')} description={t('customize_fonts')}>

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
                className="w-full accent-primary-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-title-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('page_title_size_label')} <span className="text-gray-400 font-normal">({previewTitleSize}px)</span>
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
                className="w-full accent-primary-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-sidebar-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('sidebar_text_size_label')} <span className="text-gray-400 font-normal">({previewSidebarSize}px)</span>
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
                className="w-full accent-primary-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-section-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('section_heading_size_label')} <span className="text-gray-400 font-normal">({previewSectionSize}px)</span>
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
                className="w-full accent-primary-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-table-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('table_row_text_size_label')} <span className="text-gray-400 font-normal">({previewTableSize}px)</span>
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
                className="w-full accent-primary-600"
              />
            </div>

            <div>
              <label htmlFor="settings-ui-chip-font-size" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('badge_chip_text_size_label')} <span className="text-gray-400 font-normal">({previewChipSize}px)</span>
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
                className="w-full accent-primary-600"
              />
            </div>

            <FontFamilyPicker value={toStringValue(form.ui_font_family, 'system')} onChange={(value) => setValue('ui_font_family', value)} />

            <div>
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('card_style')}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {CARD_STYLE_OPTION_KEYS.map(([radius, labelKey]) => (
                  <button
                    key={radius}
                    type="button"
                    onClick={() => setValue('ui_border_radius', radius)}
                    className={`py-2 text-xs border-2 transition-colors ${radius === 'sharp' ? 'rounded-sm' : radius === 'pill' ? 'rounded-full' : 'rounded-lg'} ${(form.ui_border_radius || 'rounded') === radius ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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
                    className={`py-2 text-xs rounded-lg border-2 transition-colors ${(form.ui_density || 'comfortable') === density ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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
                    className={`w-7 h-7 rounded-full border-4 transition-transform ${(form.ui_accent_color || '#9c7a3c') === color ? 'border-white scale-125 shadow-lg' : 'border-transparent hover:scale-110'}`}
                  />
                ))}
                <input
                  id="settings-ui-accent-color"
                  name="ui_accent_color"
                  type="color"
                  value={form.ui_accent_color || '#9c7a3c'}
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
              value={toStringValue(form.ui_sidebar_color)}
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
              value={toStringValue(form.ui_page_bg)}
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
              value={toStringValue(form.ui_sidebar_text_color)}
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
        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('appearance') ? (
        <SettingsSection title={t('timezone')} description={t('timezone_desc')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('display_timezone')}</div>
              <div className="flex h-10 items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">{BUSINESS_TIME_ZONE.replace(/_/g, ' ')}</div>
              <p className="mt-1 text-xs text-gray-500">All business timestamps use Phnom Penh time, regardless of this device.</p>
            </div>

            <div className="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-3 text-xs">
              <p className="font-semibold text-primary-700 dark:text-primary-300 mb-1">{t('current_device_time')}</p>
              <p className="font-mono text-primary-600 dark:text-primary-400">{formatPreviewDateTime(previewNow)}</p>
              <p className="text-gray-500 mt-1">{t('display_timezone')}: <strong>{selectedDisplayTimezone}</strong></p>
              <p className="text-gray-500 mt-1">{t('device_timezone')}: <strong>{deviceTimezone}</strong></p>
              <p className="text-gray-400 mt-1">{t('timezone_display_note')}</p>
            </div>
          </div>
        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('appearance') ? (
        <SettingsSection title={copy('navigationTitle', 'Navigation Layout')} description={copy('navigationHint', 'Choose the sidebar order and which 4 items stay pinned in the mobile bottom bar.')}>

          <div className="mb-4">
            <label htmlFor="settings-default-landing-page" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {copy('defaultLandingPage', 'Default landing page')}
            </label>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {copy('defaultLandingPageHint', 'Which page opens first after signing in. Applies to every user unless they navigate elsewhere.')}
            </p>
            <AppSelect
              id="settings-default-landing-page"
              name="default_landing_page"
              value={form.default_landing_page ? String(form.default_landing_page) : 'dashboard'}
              onChange={(nextValue) => setValue('default_landing_page', nextValue)}
              ariaLabel={copy('defaultLandingPage', 'Default landing page')}
              className="w-full sm:w-72"
              buttonClassName="h-9 w-full text-sm"
              options={navItems.map((item) => ({
                value: item.id,
                label: getSettingsNavLabel(item, t),
              }))}
            />
          </div>

          <div className="mb-4 rounded-xl border border-primary-100 bg-primary-50 p-3 dark:border-primary-900/40 dark:bg-primary-900/20">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-primary-700 dark:text-primary-300">{copy('mobilePinned', 'Pinned on mobile')}</div>
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
                  className={`flex items-center gap-2 rounded-lg border border-primary-200 bg-white px-2.5 py-1.5 text-xs dark:border-primary-900/50 dark:bg-primary-950/40 ${dragPinnedId === item.id ? 'opacity-60' : ''}`}
                >
                  <span className="cursor-grab text-gray-400" title={copy('dragToReorder', 'Drag to reorder')}>
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex flex-1 items-center gap-2 truncate text-gray-700 dark:text-gray-200">
                    {(() => {
                      const Icon = SETTINGS_NAV_ICONS[item.id] || SettingsIcon
                      return <Icon className="h-4 w-4 flex-shrink-0 text-primary-600 dark:text-primary-400" />
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
                <div className="rounded-lg border border-dashed border-primary-200 px-3 py-2 text-xs text-primary-700 dark:border-primary-900/50 dark:text-primary-300">
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
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDragNavId(item.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    moveNavBefore(dragNavId, item.id)
                    setDragNavId(null)
                  }}
                  onDragEnd={() => setDragNavId(null)}
                  className={`rounded-xl border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/70 ${dragNavId === item.id ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="cursor-grab text-gray-400" title={copy('dragToReorder', 'Drag to reorder')}>
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <div className="rounded-lg bg-white p-1.5 text-primary-600 shadow-sm dark:bg-gray-900 dark:text-primary-400">
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
                        className={`flex h-7 w-7 items-center justify-center rounded-md border px-0 py-0 transition-colors ${isPinned ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}
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

        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('business') ? (
        <SettingsSection title={t('manage_payment_methods')} description={t('configure_payment_desc')}>

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
                  savePaymentMethods(normalizePaymentMethods([...pmList, newPm.trim()]))
                  setNewPm('')
                }
              }}
            />
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => {
                if (!newPm.trim()) return
                savePaymentMethods(normalizePaymentMethods([...pmList, newPm.trim()]))
                setNewPm('')
              }}
            >
              + {t('add')}
            </button>
          </div>
        </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('security') ? (
          <SettingsSection
            title={t('notifications') || 'Notifications'}
            description={t('notification_settings_desc') || 'Choose which business alerts appear in the top-bar notification center.'}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['notifications_inventory_enabled', 'notification_inventory_alerts', 'Inventory alerts', 'notification_inventory_alerts_desc', 'Low stock and out of stock warnings'],
                ['notifications_expiry_enabled', 'notification_expiry_alerts', 'Expiry alerts', 'notification_expiry_alerts_desc', 'Products expiring soon or already expired'],
                ['notifications_supplier_credit_enabled', 'notification_supplier_credit_alerts', 'Supplier credit alerts', 'notification_supplier_credit_alerts_desc', 'Unpaid supplier purchases coming due or overdue'],
                ['notifications_sales_enabled', 'notification_sales_alerts', 'Sales alerts', 'notification_sales_alerts_desc', 'Awaiting payment and delivery follow-up'],
                ['notifications_loyalty_enabled', 'notification_loyalty_alerts', 'Loyalty alerts', 'notification_loyalty_alerts_desc', 'Customers who reached your points target'],
                ['notifications_portal_enabled', 'notification_portal_alerts', 'Customer portal alerts', 'notification_portal_alerts_desc', 'Other customer portal notices (pending Share & Reward submissions always appear, regardless of this setting)'],
                ['notifications_system_enabled', 'notification_system_alerts', 'System alerts', 'notification_system_alerts_desc', 'Only actionable system reminders'],
              ].map(([key, labelKey, fallbackLabel, descKey, fallbackDesc]) => (
                <label key={key} className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
                  <div className="pr-3">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{t(labelKey) || fallbackLabel}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{t(descKey) || fallbackDesc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={String(form[key] ?? 'true') !== 'false'}
                    onChange={(event) => setValue(key, event.target.checked ? 'true' : 'false')}
                  />
                </label>
              ))}
              <div className="sm:col-span-2">
                <label htmlFor="settings-notifications-expiry-days" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('notification_expiry_days') || 'Expiry alert window'}
                </label>
                <input
                  id="settings-notifications-expiry-days"
                  name="notifications_expiry_days"
                  className="input max-w-xs"
                  type="number"
                  min="0"
                  max="3650"
                  step="1"
                  value={form.notifications_expiry_days || '30'}
                  onChange={(event) => setValue('notifications_expiry_days', event.target.value)}
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {t('notification_expiry_days_desc') || 'Notify when a product expiry date is inside this many days.'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="settings-notifications-supplier-credit-days" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('notification_supplier_credit_days') || 'Supplier credit reminder window'}
                </label>
                <input
                  id="settings-notifications-supplier-credit-days"
                  name="notifications_supplier_credit_days"
                  className="input max-w-xs"
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  value={form.notifications_supplier_credit_days || '7'}
                  onChange={(event) => setValue('notifications_supplier_credit_days', event.target.value)}
                />
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {t('notification_supplier_credit_days_desc') || 'Remind when an on-credit supplier purchase is due inside this many days (overdue ones always show).'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="settings-notifications-loyalty-threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('notification_loyalty_threshold') || 'Loyalty points threshold'}
                </label>
                <input
                  id="settings-notifications-loyalty-threshold"
                  name="notifications_loyalty_threshold"
                  className="input max-w-xs"
                  type="number"
                  min="1"
                  step="1"
                  value={form.notifications_loyalty_threshold || '100'}
                  onChange={(event) => setValue('notifications_loyalty_threshold', event.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="settings-notifications-realert" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('notification_realert_interval') || 'Unresolved alert repeat interval'}
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,12rem)]">
                  <AppSelect
                    id="settings-notifications-realert"
                    name="notifications_realert_preset"
                    value={notificationRealertPreset}
                    onChange={(nextValue) => {
                      if (nextValue !== 'custom') {
                        setValue('notifications_realert_minutes', nextValue)
                      }
                    }}
                    ariaLabel={t('notification_realert_interval') || 'Unresolved alert repeat interval'}
                    className="w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[13rem]"
                    options={[
                      { value: '5', label: t('every_5_minutes') || 'Every 5 minutes' },
                      { value: '10', label: t('every_10_minutes') || 'Every 10 minutes' },
                      { value: '30', label: t('every_30_minutes') || 'Every 30 minutes' },
                      { value: '60', label: t('every_hour') || 'Every hour' },
                      { value: 'custom', label: t('custom') || 'Custom' },
                    ]}
                  />
                  <input
                    id="settings-notifications-realert-custom"
                    name="notifications_realert_minutes"
                    className="input"
                    type="number"
                    min="5"
                    max="1440"
                    step="1"
                    value={notificationRealertValue}
                    onChange={(event) => setValue('notifications_realert_minutes', event.target.value)}
                    aria-label={t('notification_realert_minutes') || 'Notification repeat minutes'}
                  />
                </div>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  {t('notification_realert_interval_desc') || 'Opening notifications clears the badge. Unresolved alerts can appear again after this interval.'}
                </p>
              </div>
            </div>
          </SettingsSection>
        ) : null}

        {isAdmin && showSettingsSection('security') ? (
          <SettingsSection
            title={t('audit_log_retention') || 'Audit log retention'}
            description={t('audit_log_retention_desc') || 'Audit log entries older than this are cleared automatically. There is no manual "Clear" action anymore.'}
          >
            <div className="max-w-xs">
              <label htmlFor="settings-audit-log-retention-days" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('audit_log_retention_days') || 'Keep audit logs for (days)'}
              </label>
              <input
                id="settings-audit-log-retention-days"
                name="audit_log_retention_days"
                className="input max-w-xs"
                type="number"
                min="1"
                max="3650"
                step="1"
                value={form.audit_log_retention_days || '21'}
                onChange={(event) => setValue('audit_log_retention_days', event.target.value)}
              />
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t('audit_log_retention_days_desc') || 'Entries older than this are deleted automatically on a daily schedule. Default is 21 days.'}
              </p>
            </div>
          </SettingsSection>
        ) : null}

        <button type="button" className="btn-primary px-8 py-3 text-base w-full sm:w-auto" onClick={handleSaveSettings} disabled={savingSettings || uploadingImage}>
          {savingSettings ? (t('saving') || 'Saving...') : t('save')}
        </button>
      </div>
    </div>
  )
}

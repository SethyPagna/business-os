import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ComponentType, ReactNode } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Chrome from 'lucide-react/dist/esm/icons/chrome.js'
import Link2 from 'lucide-react/dist/esm/icons/link-2.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import AppSelect from '../shared/AppSelect.tsx'
import Modal from '../shared/Modal'
import type { OtpModalProps } from '../utils-settings/OtpModal'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { STORAGE_KEYS } from '../../constants'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook } from '../../AppContext.tsx'
import { beginTrackedRequest, getFirstLoaderError, invalidateTrackedRequest, isTrackedRequestCurrent, settleLoaderMap, withLoaderTimeout } from '../../utils/loaders.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'

const PROFILE_LOAD_TIMEOUT_MS = 10000
const PROFILE_OTP_STATUS_TIMEOUT_MS = 8000
const PROFILE_VERIFICATION_CAPS_TIMEOUT_MS = 8000
const PROFILE_AUTH_METHODS_TIMEOUT_MS = 12000
const PROFILE_SAVE_TIMEOUT_MS = 20000
const PROFILE_PASSWORD_TIMEOUT_MS = 20000
const PROFILE_AUTH_REFRESH_TIMEOUT_MS = 12000
const PROFILE_OAUTH_START_TIMEOUT_MS = 20000
const PROFILE_OAUTH_DISCONNECT_TIMEOUT_MS = 20000
const PROFILE_AVATAR_UPLOAD_TIMEOUT_MS = 30000

type EntityId = string | number
type ProfileSection = 'personal' | 'login_methods' | 'security' | 'organization'
type OtpMode = 'setup' | 'disable' | null
type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void
type ProfileFilePickerModalProps = {
  open: boolean
  onClose: () => void
  onSelect?: (publicPath: string) => void
  mediaType?: 'image'
  title?: ReactNode
}

interface UserProfileModalProps {
  onClose: () => void
}

interface ProfileUser {
  id?: EntityId | null
  name?: string | null
  username?: string | null
  phone?: string | null
  email?: string | null
  avatar_path?: string | null
  updated_at?: string | null
  role_name?: string | null
  branch_name?: string | null
  organization_name?: string | null
}

interface ProfileSettings {
  login_session_duration?: string | null
  business_name?: string | null
  [key: string]: unknown
}

interface AppContextValue {
  user?: ProfileUser | null
  notify: NotifyFn
  hasPermission: (permission: string) => boolean
  saveSettings?: (settings: Record<string, unknown>) => unknown | Promise<unknown>
  settings?: ProfileSettings | null
  t: TranslateFn
  logout: () => void
}

interface ProfileResult extends ProfileUser {
  success?: boolean
  error?: string
}

interface OtpStatusResult {
  otpEnabled?: boolean
}

interface VerificationCapabilitiesResult {
  success?: boolean
  google_oauth?: boolean
  google_email_auth?: boolean
  google_login?: { enabled?: boolean } | null
}

interface AuthMethodsResult {
  success?: boolean
  google_linked?: boolean
  google_ready?: boolean
  email_login_enabled?: boolean
  [key: string]: unknown
}

interface MutationResult {
  success?: boolean
  error?: string
  url?: string
  path?: string
  methods?: AuthMethodsResult
  [key: string]: unknown
}

interface ProfileApi {
  getUserProfile: (id: EntityId) => Promise<ProfileResult>
  otpStatus: (id: EntityId) => Promise<OtpStatusResult>
  getVerificationCapabilities?: () => Promise<VerificationCapabilitiesResult>
  getUserAuthMethods?: (id: EntityId) => Promise<AuthMethodsResult>
  updateUserProfile: (id: EntityId, payload: Record<string, unknown>) => Promise<ProfileResult>
  changeUserPassword: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
  startGoogleOauth: (payload: Record<string, unknown>) => Promise<MutationResult>
  unlinkGoogleOauth: (payload: Record<string, unknown>) => Promise<MutationResult>
  disconnectUserAuthProvider: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
  uploadUserAvatar: (payload: { file: File }) => Promise<MutationResult>
}

interface AvatarPreviewProps {
  name?: string | null
  avatarPath?: string | null
}

interface ProfileSectionButtonProps {
  active: boolean
  children: ReactNode
  onClick: () => void
}

interface AvatarCropOptions {
  src: string
  zoom?: number
  positionX?: number
  positionY?: number
  size?: number
}

interface AvatarEditorModalProps {
  open: boolean
  src: string
  zoom: number
  positionX: number
  positionY: number
  onZoomChange: (value: number) => void
  onPositionXChange: (value: number) => void
  onPositionYChange: (value: number) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
  tr: (key: string, fallbackEn: string, fallbackKm?: string) => string
}

interface StoredOrganization {
  name?: string | null
}

const useApp = useAppHook as () => AppContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean
const LazyOtpModal = lazyRetry(async () => ({
  default: (await import('../utils-settings/OtpModal')).default as ComponentType<OtpModalProps>,
}), 'user-profile-otp-modal')
const LazyFilePickerModal = lazyRetry(async () => ({
  default: (await import('../files/FilePickerModal')).default as ComponentType<ProfileFilePickerModalProps>,
}), 'user-profile-file-picker-modal')

function getProfileApi(): ProfileApi {
  if (typeof window === 'undefined' || !window.api) throw new Error('Profile API is not available.')
  return window.api as ProfileApi
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function parseStoredOrganization(): StoredOrganization | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.ORGANIZATION) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 1. User Profile Modal
 * 1.1 Purpose
 * - Self-service account updates for all users.
 * - Admin override mode for privileged accounts.
 * - OTP and linked-provider account controls.
 */

function AvatarPreview({ name, avatarPath }: AvatarPreviewProps) {
  if (avatarPath) {
    return (
      <img
        src={avatarPath}
        alt={name || 'Avatar'}
        className="h-16 w-16 rounded-2xl object-cover ring-2 ring-blue-100 dark:ring-blue-900/40"
      />
    )
  }

  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-xl font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
      {name?.[0]?.toUpperCase() || 'U'}
    </div>
  )
}

function ProfileSectionButton({ active, children, onClick }: ProfileSectionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-900/30 dark:text-blue-300'
          : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:border-blue-500/50 dark:hover:text-blue-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

const PROFILE_KM_FALLBACKS: Record<string, string> = {
  profile: 'ប្រវត្តិរូប',
  loading_account: 'កំពុងផ្ទុកគណនី...',
  personal_details: 'ព័ត៌មានផ្ទាល់ខ្លួន',
  sign_in_methods: 'វិធីចូលប្រើ',
  security: 'សុវត្ថិភាព',
  organization: 'អង្គភាព',
  full_name: 'ឈ្មោះពេញ',
  username: 'ឈ្មោះអ្នកប្រើ',
  phone: 'លេខទូរស័ព្ទ',
  email: 'អ៊ីមែល',
  avatar_image: 'រូបភាពប្រវត្តិរូប',
  upload_image: 'បង្ហោះរូបភាព',
  open_files: 'ឯកសារ',
  choose_image_file: 'សូមជ្រើសរើសឯកសាររូបភាព',
  uploading: 'កំពុងបង្ហោះ...',
  saving: 'កំពុងរក្សាទុក...',
  avatar_uploaded: 'បានបង្ហោះរូបភាពប្រវត្តិរូប',
  avatar_upload_failed: 'បរាជ័យក្នុងការបង្ហោះរូបភាពប្រវត្តិរូប',
  no_avatar_uploaded: 'មិនទាន់មានរូបភាពប្រវត្តិរូបនៅឡើយទេ។',
  save_profile: 'រក្សាទុកប្រវត្តិរូប',
  profile_updated: 'បានធ្វើបច្ចុប្បន្នភាពប្រវត្តិរូប',
  profile_updated_email_changed: 'បានធ្វើបច្ចុប្បន្នភាពប្រវត្តិរូប ហើយអ៊ីមែលថ្មីត្រូវបានភ្ជាប់ទៅគណនីនេះ។',
  name_username_required: 'ត្រូវការឈ្មោះ និងឈ្មោះអ្នកប្រើ',
  current_password_required_save: 'ត្រូវការពាក្យសម្ងាត់បច្ចុប្បន្ន ដើម្បីរក្សាទុកការផ្លាស់ប្ដូរគណនី',
  profile_partial_load: 'ព័ត៌មានចូលប្រើខ្លះកំពុងធ្វើសមកាលកម្ម។ ប្រវត្តិរូបសំខាន់រួចរាល់ហើយ។',
  admin_profile_override_hint: 'អ្នកគ្រប់គ្រងអាចកែប្រែព័ត៌មានគណនីដោយផ្ទាល់ ខណៈដែលវិធីចូលប្រើនៅតែភ្ជាប់នឹងគណនីដដែល។',
  self_service_profile_hint: 'ការកែប្រែដោយខ្លួនឯងត្រូវការពាក្យសម្ងាត់បច្ចុប្បន្ន។ OTP និងអ្នកផ្តល់សេវាដែលបានភ្ជាប់នៅតែជាវិធីស្ដារគណនីសំខាន់។',
  phone_contact_only_hint: 'លេខទូរស័ព្ទត្រូវបានរក្សាទុកជាព័ត៌មានទំនាក់ទំនងប៉ុណ្ណោះ។ ការផ្ទៀងផ្ទាត់តាមទូរស័ព្ទត្រូវបានផ្អាកសិន។',
  profile_email_note: 'ប្រើសម្រាប់ការចូលប្រើតាមអ៊ីមែល ការប្ដូរពាក្យសម្ងាត់ សេចក្តីជូនដំណឹងគណនី និងការភ្ជាប់ជាមួយអ្នកផ្តល់សេវាដែលមានអ៊ីមែលដូចគ្នា។ Google នៅតែអាចភ្ជាប់ដោយឡែកបាន។',
  account_email_usage: 'អ៊ីមែលគណនី',
  saved: 'បានរក្សាទុក',
  optional: 'ស្រេចចិត្ត',
  email_login_simple_note: 'មិនត្រូវការការផ្ទៀងផ្ទាត់អ៊ីមែលដាច់ដោយឡែកនៅទីនេះទេ។ រក្សាទុកអ៊ីមែលម្តង ហើយបន្ទាប់មកអាចប្រើ OTP, Google ឬពាក្យសម្ងាត់ដើម្បីចូលប្រើ និងស្ដារគណនី។',
  email_login_ready_note_simple: 'ការចូលប្រើតាមអ៊ីមែលរួចរាល់ហើយ បន្ទាប់ពីរក្សាទុកអ៊ីមែលនេះក្នុងគណនី។',
  sign_in_methods_desc: 'រក្សាទុកគណនីមូលដ្ឋានដែលបង្កើតដោយអ្នកគ្រប់គ្រង ហើយបន្ថែមការចូលតាមអ៊ីមែល ឬ Google នៅពេលណាក៏បាន។',
  email_login: 'ចូលតាមអ៊ីមែល',
  setup_needed: 'ត្រូវការរៀបចំ',
  add_email_for_login_note: 'សូមបន្ថែមអ៊ីមែលគណនីជាមុនសិន ដើម្បីប្រើការចូលតាមអ៊ីមែលនៅលើទំព័រចូល។',
  google_signin: 'Google',
  connected: 'បានភ្ជាប់',
  ready_on_login: 'រួចរាល់ពេលចូល',
  google_login_ready_note: 'ភ្ជាប់ Google ម្តងនៅទីនេះ បន្ទាប់មកអ្នកអាចបន្តចូលប្រើដោយគណនី Google នោះបាន។',
  google_provider_disabled_note: 'មិនទាន់បើក Google sign-in នៅក្នុង Google login នៅឡើយទេ។',
  current_password: 'ពាក្យសម្ងាត់បច្ចុប្បន្ន',
  disconnect_google_password_hint: 'ប្រើពាក្យសម្ងាត់បច្ចុប្បន្ន មុនពេលផ្ដាច់ Google ចេញពីគណនីនេះ។',
  disconnect_google: 'ផ្ដាច់ Google',
  connecting: 'កំពុងភ្ជាប់...',
  disconnecting: 'កំពុងផ្ដាច់...',
  connect_google: 'ភ្ជាប់ Google',
  provider_email_match_note: 'នៅពេលភ្ជាប់រួច Google នឹងនៅតែភ្ជាប់ជាមួយគណនីមូលដ្ឋាននេះ។ អ្នកប្រើដែលត្រូវបានបិទ ឬលុប មិនអាចចូលប្រើកម្មវិធីបានទេ។',
  provider_change_note: 'បើចង់ប្តូរទៅគណនី Google ផ្សេង សូមផ្ដាច់គណនីបច្ចុប្បន្នជាមុន ហើយបន្ទាប់មកភ្ជាប់គណនីថ្មី។',
  profile_security_desc: 'គ្រប់គ្រងពាក្យសម្ងាត់ ការការពារ OTP និងរយៈពេលចូលប្រើលំនាំដើម។',
  username_login: 'ចូលតាមឈ្មោះអ្នកប្រើ',
  otp_enabled: 'OTP បានបើក',
  otp_not_enabled: 'OTP មិនទាន់បើក',
  on: 'បើក',
  off: 'បិទ',
  current_password_sensitive_note: 'ត្រូវការ មុនពេលប្តូរពាក្យសម្ងាត់ ឬផ្ដាច់ Google ពីគណនីនេះ។',
  new_password: 'ពាក្យសម្ងាត់ថ្មី',
  confirm_new_password: 'បញ្ជាក់ពាក្យសម្ងាត់ថ្មី',
  change_password: 'ប្តូរពាក្យសម្ងាត់',
  updating: 'កំពុងធ្វើបច្ចុប្បន្នភាព...',
  enable_otp_login: 'បើក OTP login',
  disable_otp_login: 'បិទ OTP login',
  session_duration: 'រយៈពេលចូលប្រើលំនាំដើម',
  until_browser_closes: 'រហូតដល់បិទកម្មវិធីរុករក',
  for_1_day: 'រយៈពេល ១ ថ្ងៃ',
  for_3_days: 'រយៈពេល ៣ ថ្ងៃ',
  for_7_days: 'រយៈពេល ៧ ថ្ងៃ',
  for_14_days: 'រយៈពេល ១៤ ថ្ងៃ',
  for_30_days: 'រយៈពេល ៣០ ថ្ងៃ',
  save_login_duration: 'រក្សាទុករយៈពេលចូលប្រើ',
  logout: 'ចេញ',
  organization_privacy_hint: 'អត្តសញ្ញាណអង្គភាពត្រូវបានលាក់នៅទីនេះ។ បង្ហាញតែឈ្មោះអង្គភាព និងតួនាទីប៉ុណ្ណោះ។',
  organization_name: 'ឈ្មោះអង្គភាព',
  workspace: 'កន្លែងការងារ',
  role: 'តួនាទី',
  branch: 'សាខា',
  no_role: 'គ្មានតួនាទី',
  organization_not_selected: 'មិនទាន់ជ្រើសរើសអង្គភាព',
  avatar_editor: 'កែតម្រូវរូបភាពប្រវត្តិរូប',
  avatar_editor_hint: 'អូសគ្រាប់រំកិល ដើម្បីពង្រីក និងកំណត់ទីតាំងរូបភាព មុនពេលរក្សាទុក។',
  crop_zoom: 'កម្រិតពង្រីក',
  crop_horizontal: 'ទីតាំងផ្ដេក',
  crop_vertical: 'ទីតាំងបញ្ឈរ',
  adjust_image: 'កែតម្រូវរូបភាព',
  save_avatar: 'រក្សាទុករូបភាព',
  avatar_preview: 'មើលជាមុន',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    try {
      const url = new URL(String(src || ''), window.location.href)
      if (url.origin !== window.location.origin && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob')) {
        img.crossOrigin = 'anonymous'
      }
    } catch (_) {}
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for editing'))
    img.src = src
  })
}

async function renderAvatarCropBlob({ src, zoom = 100, positionX = 50, positionY = 50, size = 512 }: AvatarCropOptions): Promise<Blob> {
  const image = await loadImageElement(src)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available for avatar editing')

  const baseScale = Math.max(size / image.width, size / image.height)
  const zoomScale = clamp(Number(zoom || 100) / 100, 1, 2.4)
  const drawWidth = image.width * baseScale * zoomScale
  const drawHeight = image.height * baseScale * zoomScale
  const left = (size - drawWidth) * (clamp(Number(positionX || 50), 0, 100) / 100)
  const top = (size - drawHeight) * (clamp(Number(positionY || 50), 0, 100) / 100)

  context.clearRect(0, 0, size, size)
  context.drawImage(image, left, top, drawWidth, drawHeight)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to render cropped avatar'))
    }, 'image/png', 0.95)
  })
}

function AvatarEditorModal({
  open,
  src,
  zoom,
  positionX,
  positionY,
  onZoomChange,
  onPositionXChange,
  onPositionYChange,
  onClose,
  onSave,
  saving,
  tr,
}: AvatarEditorModalProps) {
  if (!open || !src) return null

  return (
    <Modal title={tr('avatar_editor', 'Edit avatar image')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{tr('avatar_editor_hint', 'Use the sliders to zoom and position the image before saving.')}</p>
        <div className="flex justify-center rounded-2xl bg-gray-100 p-4 dark:bg-zinc-900/70">
          <div className="relative h-56 w-56 overflow-hidden rounded-[28px] bg-white shadow-inner dark:bg-zinc-800">
            <img
              src={src}
              alt={tr('avatar_preview', 'Avatar preview')}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                objectPosition: `${positionX}% ${positionY}%`,
                transform: `scale(${clamp(Number(zoom || 100) / 100, 1, 2.4)})`,
                transformOrigin: 'center',
              }}
            />
          </div>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('crop_zoom', 'Zoom')}</span>
            <input type="range" min="100" max="240" step="5" value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))} className="w-full accent-blue-600" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('crop_horizontal', 'Horizontal position')}</span>
            <input type="range" min="0" max="100" step="1" value={positionX} onChange={(event) => onPositionXChange(Number(event.target.value))} className="w-full accent-blue-600" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('crop_vertical', 'Vertical position')}</span>
            <input type="range" min="0" max="100" step="1" value={positionY} onChange={(event) => onPositionYChange(Number(event.target.value))} className="w-full accent-blue-600" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            {tr('cancel', 'Cancel', 'បោះបង់')}
          </button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving}>
            {saving ? tr('saving', 'Saving...') : tr('save_avatar', 'Save avatar')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function UserProfileModal({ onClose }: UserProfileModalProps) {
  const { user, notify, hasPermission, saveSettings, settings, t, logout } = useApp()
  const actionHistory = useActionHistory({ limit: 3, notify, scope: 'profile', user })
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key && !isBrokenLocalizedString(value)) return value
    const khmerFallback = PROFILE_KM_FALLBACKS[key] || fallbackKm
    if (isKhmer && !isBrokenLocalizedString(khmerFallback)) return khmerFallback
    return fallbackEn
  }
  const currentUserId = user?.id ?? null
  const requireCurrentUserId = (): EntityId => {
    if (currentUserId == null) throw new Error('Profile user is not available.')
    return currentUserId
  }
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [profile, setProfile] = useState<ProfileUser | null>(null)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false)
  const [avatarEditorSrc, setAvatarEditorSrc] = useState('')
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [otpMode, setOtpMode] = useState<OtpMode>(null)
  const [oauthConnecting, setOauthConnecting] = useState('')
  const [disconnectingProvider, setDisconnectingProvider] = useState('')
  const [verificationCaps, setVerificationCaps] = useState({
    googleOauth: false,
    googleLoginAuth: false,
    googleLoginEmailAuth: false,
  })
  const [authMethods, setAuthMethods] = useState<AuthMethodsResult | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [activeSection, setActiveSection] = useState<ProfileSection>('personal')
  const [sessionDuration, setSessionDuration] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SESSION_DURATION) || 'always'
    } catch (_) {
      return 'always'
    }
  })
  const [avatarZoom, setAvatarZoom] = useState(100)
  const [avatarPositionX, setAvatarPositionX] = useState(50)
  const [avatarPositionY, setAvatarPositionY] = useState(50)
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null)
  const avatarObjectUrlRef = useRef('')
  const loadProfileRequestRef = useRef(0)
  const saveProfileInFlightRef = useRef(false)
  const savePasswordInFlightRef = useRef(false)
  const avatarUploadInFlightRef = useRef(false)
  const saveSessionInFlightRef = useRef(false)
  const oauthRequestInFlightRef = useRef(false)

  /**
   * 2. Derived State
   * 2.1 Admins can bypass current-password checks for profile/password writes.
   */
  const canAdminOverride = hasPermission('all')
  const needsSensitivePassword = !canAdminOverride || !!authMethods?.google_linked
  const title = tr('profile', 'Profile')
  const organizationDetails = useMemo(() => {
    const storedOrganization = parseStoredOrganization()

    return {
      name: profile?.organization_name || user?.organization_name || storedOrganization?.name || settings?.business_name || tr('organization_not_selected', 'Organization not selected'),
      businessName: settings?.business_name || profile?.organization_name || user?.organization_name || '',
      roleName: profile?.role_name || user?.role_name || tr('no_role', 'No role'),
      branchName: profile?.branch_name || user?.branch_name || '',
    }
  }, [profile?.branch_name, profile?.organization_name, profile?.role_name, settings?.business_name, t, tr, user?.branch_name, user?.organization_name, user?.role_name])

  /**
   * 3. Data Hydration
   * 3.1 Load profile, OTP status, and provider capabilities.
   */
  const loadProfile = async (): Promise<void> => {
    if (!user?.id) return
    const requestId = beginTrackedRequest(loadProfileRequestRef)
    if (!profile) setLoading(true)
    try {
      const result = await settleLoaderMap({
        profile: () => withLoaderTimeout(
          () => getProfileApi().getUserProfile(user.id as EntityId),
          'Profile details',
          PROFILE_LOAD_TIMEOUT_MS,
        ),
        otp: () => withLoaderTimeout(
          () => getProfileApi().otpStatus(user.id as EntityId),
          'Profile OTP status',
          PROFILE_OTP_STATUS_TIMEOUT_MS,
        ),
        caps: () => withLoaderTimeout(
          () => getProfileApi().getVerificationCapabilities?.(),
          'Profile verification capabilities',
          PROFILE_VERIFICATION_CAPS_TIMEOUT_MS,
        ).catch(() => null),
        authMethods: () => withLoaderTimeout(
          () => getProfileApi().getUserAuthMethods?.(user.id as EntityId),
          'Profile sign-in methods',
          PROFILE_AUTH_METHODS_TIMEOUT_MS,
        ).catch(() => null),
      })
      const profileResult = result.values.profile as ProfileResult | undefined
      const otpResult = result.values.otp as OtpStatusResult | undefined
      const capsResult = result.values.caps as VerificationCapabilitiesResult | null | undefined
      const authMethodsResult = result.values.authMethods as AuthMethodsResult | null | undefined

      if (!isTrackedRequestCurrent(loadProfileRequestRef, requestId)) return
      if (!result.hasAnySuccess || !profileResult) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to load profile'))
      }
      if (profileResult?.success === false) throw new Error(profileResult.error || 'Failed to load profile')
      const { success: _success, ...profileData } = profileResult || {}
      setProfile(profileData)
      setOtpEnabled(!!otpResult?.otpEnabled)
      if (capsResult && capsResult.success !== false) {
        setVerificationCaps({
          googleOauth: capsResult.google_oauth === true,
          googleLoginAuth: capsResult.google_oauth === true || capsResult.google_login?.enabled === true,
          googleLoginEmailAuth: capsResult.google_email_auth === true,
        })
      }
      if (authMethodsResult && authMethodsResult.success !== false) {
        const { success: _authSuccess, ...authData } = authMethodsResult || {}
        setAuthMethods(authData)
      }
      if (result.hasErrors) {
        notify(tr('profile_partial_load', 'Some sign-in details are still catching up. The main profile is ready.'), 'warning')
      }
    } catch (error) {
      if (!isTrackedRequestCurrent(loadProfileRequestRef, requestId)) return
      notify(getErrorMessage(error, 'Failed to load profile'), 'error')
    } finally {
      if (isTrackedRequestCurrent(loadProfileRequestRef, requestId)) setLoading(false)
    }
  }

  useEffect(() => { loadProfile() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    invalidateTrackedRequest(loadProfileRequestRef)
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current)
      avatarObjectUrlRef.current = ''
    }
  }, [])

  useEffect(() => {
    const preferred = String(settings?.login_session_duration || '').trim()
    if (!preferred) return
    setSessionDuration(preferred)
  }, [settings?.login_session_duration])

  const verificationHelp = useMemo(() => {
    return canAdminOverride
      ? tr('admin_profile_override_hint', 'Admins can overwrite account fields directly while still keeping sign-in methods attached to the same account.')
      : tr('self_service_profile_hint', 'Self-service changes require your current password. OTP and linked providers remain the main recovery paths here.')
  }, [canAdminOverride, t])

  /**
   * 4. Profile + Security Mutations
   * 4.1 Profile update.
   * 4.2 Password update.
   * 4.3 Session-duration preference update.
   */
  const handleProfileSave = async () => {
    if (savingProfile || saveProfileInFlightRef.current) return
    if (!profile?.name?.trim() || !profile?.username?.trim()) {
      notify(tr('name_username_required', 'Name and username are required'), 'error')
      return
    }
    if (!canAdminOverride && !currentPassword.trim()) {
      notify(tr('current_password_required_save', 'Current password is required to save account changes'), 'error')
      return
    }

    saveProfileInFlightRef.current = true
    setSavingProfile(true)
    try {
      const previousEmail = String(profile.email || '').trim().toLowerCase()
      const userId = requireCurrentUserId()
      const result = await withLoaderTimeout(() => getProfileApi().updateUserProfile(userId, {
        name: profile.name,
        username: profile.username,
        phone: profile.phone,
        email: profile.email,
        avatar_path: profile.avatar_path,
        expectedUpdatedAt: profile.updated_at || undefined,
        currentPassword: canAdminOverride ? undefined : currentPassword,
        adminOverride: canAdminOverride,
        userId,
        userName: user?.name,
      }), 'Save profile', PROFILE_SAVE_TIMEOUT_MS)
      if (result?.success === false) {
        notify(result.error || 'Failed to save profile', 'error')
        return
      }
      const { success: _success, ...nextUser } = result || {}
      if (nextUser) {
        window.dispatchEvent(new CustomEvent('user:updated', { detail: nextUser }))
        setProfile(nextUser)
      }
      const authResult = await withLoaderTimeout(() => getProfileApi().getUserAuthMethods?.(userId), 'Profile sign-in methods', PROFILE_AUTH_REFRESH_TIMEOUT_MS).catch(() => null)
      if (authResult && authResult.success !== false) {
        const { success: _authSuccess, ...authData } = authResult || {}
        setAuthMethods(authData)
      }
      setCurrentPassword('')
      const nextEmail = String(nextUser?.email || '').trim().toLowerCase()
      const emailChanged = previousEmail !== nextEmail
      if (emailChanged && nextEmail) {
        notify(tr('profile_updated_email_changed', 'Profile updated. The new email is now attached to this account.'), 'success')
      } else {
        notify(tr('profile_updated', 'Profile updated'), 'success')
      }
      actionHistory.pushAction({
        scope: 'profile',
        entity: 'user',
        entity_id: userId,
        label: tr('profile_updated', 'Profile updated'),
      })
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to save profile'), 'error')
    } finally {
      saveProfileInFlightRef.current = false
      setSavingProfile(false)
    }
  }

  const handlePasswordSave = async () => {
    if (savingPassword || savePasswordInFlightRef.current) return
    if (newPassword.length < 6) return notify(tr('password_min_6', 'Use at least 6 characters for the new password.'), 'error')
    if (newPassword !== confirmPassword) return notify(tr('new_password_confirm_mismatch', 'New password confirmation does not match'), 'error')
    if (!canAdminOverride && !currentPassword.trim()) return notify(tr('current_password_required_change', 'Current password is required to change password'), 'error')

    savePasswordInFlightRef.current = true
    setSavingPassword(true)
    try {
      const userId = requireCurrentUserId()
      const result = await withLoaderTimeout(() => getProfileApi().changeUserPassword(userId, {
        currentPassword: canAdminOverride ? undefined : currentPassword,
        newPassword,
        adminOverride: canAdminOverride,
        userId,
        userName: user?.name,
      }), 'Change password', PROFILE_PASSWORD_TIMEOUT_MS)
      if (result?.success === false) {
        notify(result.error || 'Failed to change password', 'error')
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify(tr('password_updated', 'Password updated'), 'success')
      actionHistory.pushAction({
        scope: 'profile',
        entity: 'user',
        entity_id: userId,
        label: tr('password_updated', 'Password updated'),
      })
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to change password'), 'error')
    } finally {
      savePasswordInFlightRef.current = false
      setSavingPassword(false)
    }
  }

  const handleSessionSave = () => {
    if (saveSessionInFlightRef.current) return
    saveSessionInFlightRef.current = true
    Promise.resolve(saveSettings?.({ login_session_duration: sessionDuration }))
      .then(() => {
        actionHistory.pushAction({
          scope: 'profile',
          entity: 'user',
          entity_id: currentUserId,
          label: tr('save_login_duration', 'Save login duration'),
        })
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, 'Failed to save login duration preference'), 'error')
      })
      .finally(() => {
        saveSessionInFlightRef.current = false
      })
  }

  const refreshOtpState = async () => {
    setOtpMode(null)
    await loadProfile()
    actionHistory.pushAction({
      scope: 'profile',
      entity: 'otp',
      entity_id: currentUserId,
      label: tr('security_settings_updated', 'Security settings updated'),
    })
    notify(tr('security_settings_updated', 'Security settings updated'), 'success')
  }

  const handleAvatarPick = (): void => avatarFileInputRef.current?.click()

  const resetAvatarEditor = (): void => {
    setAvatarZoom(100)
    setAvatarPositionX(50)
    setAvatarPositionY(50)
  }

  const openAvatarEditor = (src: unknown): void => {
    const cleanSrc = String(src || '').trim()
    if (!cleanSrc) return
    resetAvatarEditor()
    setAvatarEditorSrc(cleanSrc)
    setAvatarEditorOpen(true)
  }

  const closeAvatarEditor = (): void => {
    setAvatarEditorOpen(false)
    if (avatarObjectUrlRef.current && avatarEditorSrc === avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current)
      avatarObjectUrlRef.current = ''
    }
    setAvatarEditorSrc('')
    resetAvatarEditor()
  }

  const handleStartOauthLink = async (provider: string): Promise<void> => {
    if (oauthRequestInFlightRef.current) return
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    if (!normalizedProvider) return
    if (!verificationCaps.googleLoginAuth) {
      notify(tr('google_oauth_not_ready', 'Google login is not ready yet.'), 'error')
      return
    }

    oauthRequestInFlightRef.current = true
    setOauthConnecting(normalizedProvider)
    try {
      try {
        localStorage.setItem(STORAGE_KEYS.OAUTH_LINK_PENDING, JSON.stringify({
          userId: user?.id || null,
          provider: normalizedProvider,
          email: String(profile?.email || '').trim().toLowerCase(),
          startedAt: Date.now(),
        }))
      } catch (_) {}
      const redirectTo = `${window.location.origin}${window.location.pathname}?auth_mode=link&auth_provider=${encodeURIComponent(normalizedProvider)}`
      const result = await withLoaderTimeout(() => getProfileApi().startGoogleOauth({
        provider: normalizedProvider,
        mode: 'link',
        redirectTo,
      }), 'Start sign-in provider', PROFILE_OAUTH_START_TIMEOUT_MS)
      if (result?.success === false || !result?.url) {
        notify(result?.error || tr('oauth_start_failed', 'Unable to start sign-in with provider.'), 'error')
        return
      }
      window.location.assign(result.url)
    } catch (error) {
      notify(getErrorMessage(error, tr('oauth_start_failed', 'Unable to start sign-in with provider.')), 'error')
    } finally {
      oauthRequestInFlightRef.current = false
      setOauthConnecting('')
    }
  }

  const handleDisconnectOauthProvider = async (provider: string): Promise<void> => {
    if (disconnectingProvider) return
    const normalizedProvider = String(provider || '').trim().toLowerCase()
    if (!normalizedProvider) return
    if (!currentPassword.trim()) {
      notify(tr('current_password_required_disconnect', 'Current password is required to disconnect a sign-in provider.'), 'error')
      return
    }

    setDisconnectingProvider(normalizedProvider)
    try {
      const result = await withLoaderTimeout(() => (
        normalizedProvider === 'google'
          ? getProfileApi().unlinkGoogleOauth({ currentPassword })
          : getProfileApi().disconnectUserAuthProvider(requireCurrentUserId(), {
            provider: normalizedProvider,
            currentPassword,
          })
      ), 'Disconnect sign-in provider', PROFILE_OAUTH_DISCONNECT_TIMEOUT_MS)
      if (result?.success === false) {
        notify(result.error || tr('identity_unlink_failed', 'Failed to disconnect sign-in method.'), 'error')
        return
      }
      if (result?.methods) {
        setAuthMethods(result.methods)
      } else {
        const authResult = await getProfileApi().getUserAuthMethods?.(requireCurrentUserId()).catch(() => null)
        if (authResult && authResult.success !== false) {
          const { success: _authSuccess, ...authData } = authResult || {}
          setAuthMethods(authData)
        }
      }
      setCurrentPassword('')
      notify(tr('identity_unlinked_success', 'Sign-in method disconnected.'), 'success')
      actionHistory.pushAction({
        scope: 'profile',
        entity: 'auth_provider',
        entity_id: currentUserId,
        label: tr('identity_unlinked_success', 'Sign-in method disconnected.'),
      })
    } catch (error) {
      notify(getErrorMessage(error, tr('identity_unlink_failed', 'Failed to disconnect sign-in method.')), 'error')
    } finally {
      setDisconnectingProvider('')
    }
  }

  /**
   * 6. Avatar Upload
   * 6.1 Preview the picked image with an object URL.
   * 6.2 Upload through backend media endpoint.
   */
  const handleAvatarSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify(tr('choose_image_file', 'Please choose an image file'), 'error')
      return
    }
    try {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current)
      }
      const objectUrl = URL.createObjectURL(file)
      avatarObjectUrlRef.current = objectUrl
      openAvatarEditor(objectUrl)
    } catch (error) {
      notify(getErrorMessage(error, tr('choose_image_file', 'Please choose an image file')), 'error')
    }
  }

  const saveAvatarFromEditor = async (): Promise<void> => {
    if (uploadingAvatar || avatarUploadInFlightRef.current) return
    avatarUploadInFlightRef.current = true
    setUploadingAvatar(true)
    try {
      const blob = await renderAvatarCropBlob({
        src: avatarEditorSrc,
        zoom: avatarZoom,
        positionX: avatarPositionX,
        positionY: avatarPositionY,
      })
      const file = new File([blob], 'avatar.png', { type: 'image/png' })
      const uploadResult = await withLoaderTimeout(() => getProfileApi().uploadUserAvatar({ file }), 'Upload avatar', PROFILE_AVATAR_UPLOAD_TIMEOUT_MS)
      if (!uploadResult?.path) throw new Error(tr('upload_no_image_path', 'Upload did not return an image path'))
      setProfile((current) => ({ ...(current || {}), avatar_path: uploadResult.path }))
      notify(tr('avatar_uploaded', 'Avatar uploaded'), 'success')
      actionHistory.pushAction({
        scope: 'profile',
        entity: 'user_avatar',
        entity_id: currentUserId,
        label: tr('avatar_uploaded', 'Avatar uploaded'),
      })
      closeAvatarEditor()
    } catch (error) {
      notify(getErrorMessage(error, tr('avatar_upload_failed', 'Avatar upload failed')), 'error')
    } finally {
      avatarUploadInFlightRef.current = false
      setUploadingAvatar(false)
    }
  }

  return (
    <>
      <Modal title={title} onClose={onClose} wide>
        {loading || !profile ? (
          <div className="py-10 text-center text-sm text-gray-400">{tr('loading_account', 'Loading account...')}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl bg-gray-50 p-3 dark:bg-zinc-800/70 sm:flex-row sm:items-center">
              <AvatarPreview name={profile.name} avatarPath={profile.avatar_path} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold leading-tight text-gray-900 dark:text-white">{profile.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      @{profile.username} {' · '} {profile.role_name || tr('no_role', 'No role')} {' · '} {otpEnabled ? tr('otp_enabled', 'OTP enabled') : tr('otp_not_enabled', 'OTP not enabled')}
                    </div>
                  </div>
                  <button
                    type="button"
                    title={tr('refresh_app', 'Refresh / check for update')}
                    aria-label={tr('refresh_app', 'Refresh / check for update')}
                    className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-zinc-900/70 dark:text-gray-300 dark:hover:bg-zinc-800/60 sm:px-3 sm:text-sm"
                    onClick={() => {
                      // Same manual "tell any waiting service worker to
                      // activate, then reload" action as the desktop
                      // sidebar's own update button -- that one only
                      // renders in the desktop-only <aside> (Sidebar.tsx's
                      // `hidden ... md:flex`), so there was previously no
                      // way at all to check for an update from a phone/PWA
                      // install, which is exactly where a stale cached
                      // build is most likely to linger unnoticed.
                      navigator.serviceWorker?.controller?.postMessage?.({ type: 'BUSINESS_OS_SKIP_WAITING' })
                      window.setTimeout(() => window.location.reload(), 250)
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span className="hidden sm:inline">{tr('refresh_app', 'Refresh / check for update')}</span>
                  </button>
                  <button
                    type="button"
                    title={tr('logout', 'Logout')}
                    aria-label={tr('logout', 'Logout')}
                    className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 dark:border-red-800/60 dark:bg-zinc-900/70 dark:text-red-300 dark:hover:bg-red-950/20 sm:px-3 sm:text-sm"
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">{tr('logout', 'Logout')}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
                <ProfileSectionButton active={activeSection === 'personal'} onClick={() => setActiveSection('personal')}>
                  {tr('personal_details', 'Personal details')}
                </ProfileSectionButton>
                <ProfileSectionButton active={activeSection === 'login_methods'} onClick={() => setActiveSection('login_methods')}>
                  {tr('sign_in_methods', 'Sign-in methods')}
                </ProfileSectionButton>
                <ProfileSectionButton active={activeSection === 'security'} onClick={() => setActiveSection('security')}>
                  {tr('security', 'Security')}
                </ProfileSectionButton>
                <ProfileSectionButton active={activeSection === 'organization'} onClick={() => setActiveSection('organization')}>
                  {tr('organization', 'Organization')}
                </ProfileSectionButton>
              </div>
              <ActionHistoryBar history={actionHistory} t={t} />
            </div>

            {activeSection === 'personal' ? (
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{tr('personal_details', 'Personal details')}</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{verificationHelp}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('full_name', 'Full name')}</label>
                  <input id="profile-name" name="name" className="input" value={profile.name || ''} onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div>
                  <label htmlFor="profile-username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('username', 'Username')}</label>
                  <input id="profile-username" name="username" className="input" value={profile.username || ''} onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <label htmlFor="profile-phone" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('phone', 'Phone')}</label>
                  <input
                    id="profile-phone"
                    name="phone"
                    className="input"
                    value={profile.phone || ''}
                    onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="+85512345678"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {tr('phone_contact_only_hint', 'Phone number is stored as a contact field only. Verification is paused for now.')}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                    <div>
                      <label htmlFor="profile-email" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('email', 'Email')}</label>
                      <input
                        id="profile-email"
                        name="email"
                        type="email"
                        className="input"
                        value={profile.email || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                      />
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {tr('profile_email_note', 'Used for email login, password changes, account notices, and matching existing provider records when helpful. Google can still be linked independently.')}
                      </p>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('account_email_usage', 'Account email')}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${profile.email?.trim() ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                          {profile.email?.trim() ? tr('saved', 'Saved') : tr('optional', 'Optional')}
                        </span>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">
                        {tr('email_login_simple_note', 'No separate email verification step is required here. Save your email once, then use OTP, Google, or your password for account access and recovery flows.')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="profile-avatar" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('avatar_image', 'Avatar image')}</label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={handleAvatarPick} disabled={uploadingAvatar}>
                      {uploadingAvatar ? tr('uploading', 'Uploading...') : tr('upload_image', 'Upload image')}
                    </button>
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => openAvatarEditor(profile.avatar_path)} disabled={uploadingAvatar || !profile.avatar_path}>
                      {tr('adjust_image', 'Adjust image')}
                    </button>
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setFilePickerOpen(true)}>
                      {tr('open_files', 'Files')}
                    </button>
                  </div>
                </div>
                <input
                  id="profile-avatar"
                  name="profile_avatar"
                  ref={avatarFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelected}
                />
                <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-gray-400">
                  {profile.avatar_path || tr('no_avatar_uploaded', 'No avatar uploaded yet.')}
                </div>
              </div>
              <div className="flex justify-end">
                <button className="btn-primary" onClick={handleProfileSave} disabled={savingProfile}>
                  {savingProfile ? tr('saving', 'Saving...') : tr('save_profile', 'Save profile')}
                </button>
              </div>
            </section>
            ) : null}

            {activeSection === 'login_methods' ? (
            <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <span>{tr('sign_in_methods', 'Sign-in methods')}</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {tr('sign_in_methods_desc', 'Keep your local admin-created account and add email or Google sign-in methods whenever you want them.' )}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <span>{tr('email_login', 'Email login')}</span>
                  </div>
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${authMethods?.email_login_enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {authMethods?.email_login_enabled ? tr('enabled', 'enabled') : tr('setup_needed', 'setup needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {!profile.email?.trim()
                      ? tr('add_email_for_login_note', 'Add your account email first to use email sign-in on the login screen.')
                      : tr('email_login_ready_note_simple', 'Email sign-in is ready once this email is saved on your account.')}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                    <Chrome className="h-4 w-4 text-gray-400" />
                    <span>{tr('google_signin', 'Google')}</span>
                  </div>
                  <div className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${authMethods?.google_linked ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : authMethods?.google_ready ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    {authMethods?.google_linked
                      ? tr('connected', 'Connected')
                      : authMethods?.google_ready
                        ? tr('ready_on_login', 'Ready on login')
                        : tr('setup_needed', 'setup needed')}
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {verificationCaps.googleOauth
                      ? (authMethods?.google_ready
                        ? tr('google_login_ready_note', 'Connect Google once here, then you can keep signing in with that Google account.')
                        : tr('google_provider_disabled_note', 'Google sign-in is not enabled in Google login yet.'))
                      : tr('google_provider_disabled_note', 'Google sign-in is not enabled in Google login yet.')}
                  </p>
                  {authMethods?.google_linked && needsSensitivePassword ? (
                    <div className="mt-3 space-y-2">
                      <label htmlFor="disconnect-google-password" className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                        {tr('current_password', 'Current password')}
                      </label>
                      <input
                        id="disconnect-google-password"
                        name="disconnect_google_password"
                        type="password"
                        autoComplete="current-password"
                        className="input text-sm"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {tr('disconnect_google_password_hint', 'Use your current password before disconnecting Google from this account.')}
                      </p>
                    </div>
                  ) : null}
                  {verificationCaps.googleOauth && authMethods?.google_ready ? (
                    authMethods?.google_linked ? (
                      <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={disconnectingProvider === 'google'} onClick={() => handleDisconnectOauthProvider('google')}>
                        {disconnectingProvider === 'google' ? tr('disconnecting', 'Disconnecting...') : tr('disconnect_google', 'Disconnect Google')}
                      </button>
                    ) : (
                      <button type="button" className="btn-secondary mt-3 px-3 py-1 text-xs" disabled={oauthConnecting === 'google'} onClick={() => handleStartOauthLink('google')}>
                        {oauthConnecting === 'google' ? tr('connecting', 'Connecting...') : tr('connect_google', 'Connect Google')}
                      </button>
                    )
                  ) : null}
                </div>

              </div>

              <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-zinc-800/70 dark:text-gray-400">
                <div>{tr('provider_email_match_note', 'Google stays linked to this local account once connected here. Disabled or deleted local users still cannot access the app.')}</div>
                <div className="mt-2">{tr('provider_change_note', 'To switch to another Google account, disconnect the current one first and then connect the new provider.')}</div>
              </div>
            </section>
            ) : null}

            {activeSection === 'security' ? (
            <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-gray-400" />
                  <span>{tr('security', 'Security')}</span>
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('profile_security_desc', 'Manage password, OTP login protection, and your default login duration.')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-zinc-700 dark:text-gray-300">{tr('username_login', 'Username login')}</span>
                  <span className={`rounded-full px-2 py-0.5 ${profile.email?.trim() ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {tr('email_login', 'Email login')} {profile.email?.trim() ? tr('enabled', 'enabled') : tr('setup_needed', 'setup needed')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 ${otpEnabled ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-700 dark:text-gray-300'}`}>
                    OTP 2FA {otpEnabled ? tr('on', 'on') : tr('off', 'off')}
                  </span>
                </div>
              </div>
              {needsSensitivePassword ? (
                <div>
                  <label htmlFor="security-current-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {tr('current_password', 'Current password')}
                  </label>
                  <input
                    id="security-current-password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    className="input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {tr('current_password_sensitive_note', 'Needed before changing your password or disconnecting Google from this account.')}
                  </p>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('new_password', 'New password')}</label>
                  <input id="new-password" name="new_password" type="password" autoComplete="new-password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('confirm_new_password', 'Confirm new password')}</label>
                  <input id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button className="btn-primary" onClick={handlePasswordSave} disabled={savingPassword}>
                  {savingPassword ? tr('updating', 'Updating...') : tr('change_password', 'Change password')}
                </button>
                <button className="btn-secondary" onClick={() => setOtpMode(otpEnabled ? 'disable' : 'setup')}>
                  {otpEnabled ? tr('disable_otp_login', 'Disable OTP login') : tr('enable_otp_login', 'Enable OTP login')}
                </button>
              </div>

              <div className="grid gap-3 rounded-xl bg-gray-50 p-4 dark:bg-zinc-800/70 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <label htmlFor="session-duration-profile" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('session_duration', 'Default login duration')}</label>
                  <AppSelect
                    id="session-duration-profile"
                    name="session_duration"
                    value={sessionDuration}
                    onChange={(nextValue) => setSessionDuration(nextValue)}
                    ariaLabel={tr('session_duration', 'Default login duration')}
                    className="w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[13rem]"
                    options={[
                      { value: 'always', label: tr('always_stay_signed_in', 'Always stay signed in') },
                      { value: 'session', label: tr('until_browser_closes', 'Until browser closes') },
                      { value: '1d', label: tr('for_1_day', 'For 1 day') },
                      { value: '3d', label: tr('for_3_days', 'For 3 days') },
                      { value: '7d', label: tr('for_7_days', 'For 7 days') },
                      { value: '14d', label: tr('for_14_days', 'For 14 days') },
                      { value: '30d', label: tr('for_30_days', 'For 30 days') },
                    ]}
                  />
                </div>
                <button className="btn-secondary" onClick={handleSessionSave}>{tr('save_login_duration', 'Save login duration')}</button>
              </div>
            </section>
            ) : null}

            {activeSection === 'organization' ? (
              <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-zinc-700">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{tr('organization', 'Organization')}</h3>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {tr('organization_privacy_hint', 'Organization identifiers stay hidden here. Only the organization name and role context are shown.')}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {tr('organization_name', 'Organization name')}
                    </div>
                    <div className="mt-2 text-base font-semibold text-gray-900 dark:text-white">
                      {organizationDetails.name}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {tr('role', 'Role')}
                    </div>
                    <div className="mt-2 text-base font-semibold text-gray-900 dark:text-white">
                      {organizationDetails.roleName}
                    </div>
                  </div>
                  {organizationDetails.businessName ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {tr('workspace', 'Workspace')}
                      </div>
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                        {organizationDetails.businessName}
                      </div>
                    </div>
                  ) : null}
                  {organizationDetails.branchName ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        {tr('branch', 'Branch')}
                      </div>
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                        {organizationDetails.branchName}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </Modal>

      {otpMode ? (
        <Suspense fallback={null}>
          <LazyOtpModal
            mode={otpMode}
            userId={user?.id}
            onClose={() => setOtpMode(null)}
            onDone={refreshOtpState}
            t={t}
          />
        </Suspense>
      ) : null}
      <AvatarEditorModal
        open={avatarEditorOpen}
        src={avatarEditorSrc}
        zoom={avatarZoom}
        positionX={avatarPositionX}
        positionY={avatarPositionY}
        onZoomChange={setAvatarZoom}
        onPositionXChange={setAvatarPositionX}
        onPositionYChange={setAvatarPositionY}
        onClose={closeAvatarEditor}
        onSave={saveAvatarFromEditor}
        saving={uploadingAvatar}
        tr={tr}
      />
      {filePickerOpen ? (
        <Suspense fallback={null}>
          <LazyFilePickerModal
            open={filePickerOpen}
            mediaType="image"
            title={tr('avatar_image', 'Avatar image')}
            onClose={() => setFilePickerOpen(false)}
            onSelect={(publicPath) => {
              setFilePickerOpen(false)
              openAvatarEditor(publicPath)
            }}
          />
        </Suspense>
      ) : null}
    </>
  )
}

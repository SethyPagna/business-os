import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import Check from 'lucide-react/dist/esm/icons/check.js'
import CircleUserRound from 'lucide-react/dist/esm/icons/circle-user-round.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import ShieldPlus from 'lucide-react/dist/esm/icons/shield-plus.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js'
import UsersIcon from 'lucide-react/dist/esm/icons/users.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect from '../shared/AppSelect.tsx'
import SearchInput from '../shared/SearchInput'
import FilterMenu from '../shared/FilterMenu'
import SortChip from '../shared/SortChip'
import { loadSortSpec, saveSortSpec, sortRecords, type SortField, type SortSpec } from '../../utils/listSort'
import Modal from '../shared/Modal'
import MinimizeButton from '../shared/MinimizeButton.tsx'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import { isDirtySince, stableSnapshot, useFormDirty } from '../../utils/formDirty.ts'
import type { CloseGuard } from '../../utils/useCloseGuard.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import PortalMenu, { type PortalMenuItem } from '../shared/PortalMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { fmtDate } from '../../utils/formatters'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { summarizeRoleChangesByModule, type RoleChangeRow } from './roleDiff.ts'
import { levelWord } from './rolePermissionLabel.ts'
import { roleTierCounts } from './permissionSummary.ts'
import { resettableRoleCode } from './roleDefaultsReset.ts'
import { ROLE_PRESETS } from './rolePresetDefaults'
import { isAdminControlUser, normalizePermissionState, type PermissionValue } from '../../utils/permissions.ts'
import { useIsPageActive } from '../shared/pageActivity'
import { APP_NAVIGATION_EVENT } from '../../app/pathRouting.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { RESTORE_WORK_EVENT, consumePendingRestore, markRestoreHandled, minimizeWork, reparkDeniedRestore, type MinimizedWorkEntry } from '../../utils/minimizedWork.ts'
import { clearWorkDraft, readWorkDraft, writeWorkDraft } from '../../utils/workDrafts.ts'
import { draftAuthorityChangedText, isDraftAuthorityCurrent } from '../../utils/draftAuthority.ts'
import { useFrozenDraftAuthority } from '../../utils/useFrozenDraftAuthority.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { copyPasswordToClipboard, passwordNoticeKey, requestPasswordSave } from '../../utils/passwordManager.ts'
import { newPasswordProblem, newPasswordRefusalMessage, passwordProblemMessage } from '../../utils/passwordRules.ts'
import type { PasswordIdentity } from '../../utils/passwordSuggest.ts'
import NewPasswordFields from '../auth/password/NewPasswordFields.tsx'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import DeviceApprovals from './DeviceApprovals.tsx'
import PasswordResetRequests from './PasswordResetRequests.tsx'
import ShiftHistoryPanel from '../shifts/ShiftHistoryPanel.tsx'
import { UserAvatarImage } from './UserAvatar.tsx'
import { buildUserWritePayload, userEditReplayScope, type UserWritePayload } from './userWritePayload.ts'
import { currentPasswordRateLimitMessage } from './currentPasswordErrors.ts'
import { lastAdminRequiredError, lastAdminRequiredMessage } from './lastAdminErrors.ts'
import {
  changeUserPassword as changeUserPasswordRequest,
  createRole as createRoleRequest,
  createUser as createUserRequest,
  deleteRole as deleteRoleRequest,
  getRoleDefaults as getRoleDefaultsRequest,
  getRoles as getRolesRequest,
  getUsers as getUsersRequest,
  resetPassword as resetPasswordRequest,
  updateRole as updateRoleRequest,
  updateUser as updateUserRequest,
} from '../../api/userAdminTransport.ts'

type EntityId = number | string
type UsersTab = 'users' | 'roles' | 'devices'
type UsersModal = 'editUser' | 'editRole' | 'resetPw' | 'userDetail' | null
type TranslateFn = (key: string) => string
type Translate = (key: string, fallback: string) => string
type NotifyFn = (message: string, tone?: string) => void
type PermissionState = Record<string, PermissionValue>

interface CurrentUser {
  id?: EntityId | null
  name?: string | null
  username?: string | null
  role_code?: string | null
}

interface AppContextValue {
  t: TranslateFn
  notify: NotifyFn
  hasPermission: (permission: string) => boolean
  user?: CurrentUser | null
}

interface SyncContextValue {
  syncChannel?: {
    channel?: string | null
    ts?: string | number | null
  } | null
}

interface UserRecord extends Record<string, unknown> {
  id: EntityId
  name?: string
  username?: string
  phone?: string | null
  email?: string | null
  avatar_path?: string | null
  role_id?: EntityId | null
  role_name?: string | null
  is_active?: boolean | number
  otp_enabled?: boolean | number
  created_at?: string | number | Date | null
  updated_at?: string | null
  has_admin_access?: boolean | number | null
  is_primary_admin?: boolean | number | null
}

// SortChip vocabulary (utils/listSort.ts) -- this list is loaded whole, so
// the client sort is authoritative.
const USER_SORT_FIELD_DEFS = [
  { id: 'name', kind: 'text' as const, get: (user: UserRecord) => user?.name || user?.username },
  { id: 'role', kind: 'text' as const, get: (user: UserRecord) => user?.role_name },
  { id: 'created', kind: 'date' as const, get: (user: UserRecord) => user?.created_at },
]

interface RoleRecord extends Record<string, unknown> {
  id: EntityId
  name?: string
  code?: string | null
  permissions?: string | Record<string, unknown> | null
  is_system?: boolean | number | null
  updated_at?: string | null
}

interface UserFormState {
  name: string
  username: string
  phone: string
  email: string
  avatar_path: string
  password: string
  passwordConfirm: string
  role_id: EntityId | ''
  is_active: number
}

interface RoleFormState {
  name: string
  permissions: PermissionState
}

interface PasswordFormState {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY_PASSWORD_FORM: PasswordFormState = { currentPassword: '', newPassword: '', confirmPassword: '' }

interface PasswordHandoverState {
  userId: EntityId
  name: string
  password: string
}

const sameUserId = (left: EntityId, right: EntityId): boolean => String(left) === String(right)

interface MutationResult {
  success?: boolean
  error?: string
  id?: EntityId
  data?: { id?: EntityId } | null
  item?: { id?: EntityId } | null
}

interface UsersApi {
  getUsers: () => Promise<unknown>
  getRoles: () => Promise<unknown>
  createUser: (payload: UserWritePayload & { password: string }) => Promise<MutationResult>
  updateUser: (id: EntityId, payload: UserWritePayload) => Promise<MutationResult>
  changeUserPassword: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
  resetPassword: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
  createRole: (payload: Record<string, unknown>) => Promise<MutationResult>
  updateRole: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
  deleteRole: (id: EntityId, payload?: Record<string, unknown>) => Promise<MutationResult>
}

interface ThreeDotProps {
  onDetails: () => void
  onEdit: () => void
  onResetPw: () => void
  canManage: boolean
}

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

function getUsersApi(): UsersApi {
  return {
    getUsers: getUsersRequest,
    getRoles: getRolesRequest,
    createUser: (payload) => createUserRequest(payload) as Promise<MutationResult>,
    updateUser: (id, payload) => updateUserRequest(id, payload) as Promise<MutationResult>,
    changeUserPassword: (id, payload) => changeUserPasswordRequest(id, payload) as Promise<MutationResult>,
    resetPassword: (id, payload) => resetPasswordRequest(id, payload) as Promise<MutationResult>,
    createRole: (payload) => createRoleRequest(payload) as Promise<MutationResult>,
    updateRole: (id, payload) => updateRoleRequest(id, payload) as Promise<MutationResult>,
    deleteRole: (id, payload) => deleteRoleRequest(id, payload) as Promise<MutationResult>,
  }
}

function normalizeUsers(value: unknown): UserRecord[] {
  return Array.isArray(value) ? value as UserRecord[] : []
}

function normalizeRoles(value: unknown): RoleRecord[] {
  return Array.isArray(value) ? value as RoleRecord[] : []
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function clearTimeoutRef(ref: MutableRefObject<number | null>): void {
  if (ref.current == null) return
  window.clearTimeout(ref.current)
  ref.current = null
}

function scheduleUsersSecondaryRead(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let idleId: number | null = null
  const timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(task, { timeout: USERS_SECONDARY_READ_IDLE_TIMEOUT_MS })
      return
    }
    task()
  }, USERS_SECONDARY_READ_DELAY_MS)
  return () => {
    window.clearTimeout(timerId)
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId)
    }
  }
}

/**
 * 1. Users Page Module
 * 1.1 Purpose
 * - Centralize user and role administration.
 * - Keep self-service profile access available for every signed-in user.
 * - Mirror backend admin guardrails in the client UX.
 */

/**
 * 1.2 Shared UI Helpers
 */
function ThreeDot({ onDetails, onEdit, onResetPw, canManage }: ThreeDotProps) {
  const { t } = useApp()
  const items: Array<PortalMenuItem | null> = [
    { label: t('view_details') || 'View details', onClick: onDetails },
    canManage ? { label: t('edit') || 'Edit', onClick: onEdit, color: 'blue' } : null,
    canManage ? { label: t('change_password') || 'Change password', onClick: onResetPw, color: 'blue' } : null,
  ].filter(Boolean)

  return (
    <PortalMenu
      trigger={<button className="three-dot-btn" type="button" title={t('more_actions') || 'More actions'} aria-label={t('more_actions') || 'More actions'}>...</button>}
      items={items}
    />
  )
}

const INITIAL_USER_FORM: UserFormState = {
  name: '',
  username: '',
  phone: '',
  email: '',
  avatar_path: '',
  password: '',
  passwordConfirm: '',
  role_id: '',
  is_active: 1,
}

const INITIAL_ROLE_FORM: RoleFormState = {
  name: '',
  permissions: {},
}

// The form a role opens with; a new role opens blank.
const roleFormOf = (role: RoleRecord | null): RoleFormState => (role
  ? { name: role.name || '', permissions: normalizePermissionState(role.permissions) }
  : INITIAL_ROLE_FORM)

// Keys of a minimized role draft: one chip per role (or one for the new-role form).
const roleFormWorkKey = (roleId?: EntityId | null): string => `role-form-${roleId ?? 'new'}`
const roleFormDraftBaseKey = (roleId?: EntityId | null): string => `role_${roleId ?? 'new'}`

// Icon-only buttons share one shape: the name rides the tooltip and the aria-label, touch screens get 44px. The colours
// are separate so a delete button never stacks two text colours for the same theme.
const ICON_BUTTON_SHAPE = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md disabled:opacity-40 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'
const ICON_BUTTON_CLASS = `${ICON_BUTTON_SHAPE} text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-100`
const ICON_BUTTON_DANGER_CLASS = `${ICON_BUTTON_SHAPE} text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-950/30`
const TIER_DOT = { full: 'bg-blue-600', review: 'bg-amber-500', view: 'bg-teal-600' } as const

function SensitiveMark({ sensitivity, tr }: { sensitivity: RoleChangeRow['sensitivity']; tr: Translate }) {
  if (sensitivity === 'normal') return null
  const label = tr(sensitivity === 'critical' ? 'permission_sensitive_critical' : 'permission_sensitive_high', 'Sensitive')
  return (
    <span role="img" aria-label={label} title={label} className={`mt-0.5 inline-flex shrink-0 ${sensitivity === 'critical' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

// A review row: the module with its shield, then its level move, the controls switched off, and each separate
// switch on a line of its own so a level change can never hide one.
function RoleReviewLabel({ row, tr }: { row: RoleChangeRow; tr: Translate }) {
  return (
    <span className="inline-flex items-start gap-1 text-sm font-medium text-gray-900 dark:text-gray-100" title={row.hint}>
      <SensitiveMark sensitivity={row.sensitivity} tr={tr} />
      <span className="break-words">{row.label}</span>
    </span>
  )
}

function RoleReviewValue({ row, tr }: { row: RoleChangeRow; tr: Translate }) {
  return (
    <div className="space-y-0.5">
      {row.lines.map((line, index) => (
        <div key={index} className={line.kind === 'level' ? (line.unchanged ? 'text-sm font-normal text-gray-500 dark:text-gray-400' : 'text-sm') : 'flex items-start justify-end gap-1 text-xs font-normal leading-5 text-gray-600 dark:text-gray-300'}>
          {line.sensitivity ? <SensitiveMark sensitivity={line.sensitivity} tr={tr} /> : null}
          <span className="break-words">{line.text}</span>
        </div>
      ))}
    </div>
  )
}

// Modules per level (Full, Review, View) and the actions switched off. Each segment names its own level -- the same
// word and dot colour as the editor's column header -- so the strip reads without a legend; a level nobody holds is
// left out. The numbers are spelled out in full for screen readers and on hover.
function RoleTierStrip({ permissions, tr }: { permissions: unknown; tr: Translate }) {
  const counts = roleTierCounts(normalizePermissionState(permissions))
  const spoken = tr('role_tier_strip_aria', 'Full {full}, Review {review}, View {view}, {off} off')
    .replace('{full}', String(counts.full)).replace('{review}', String(counts.review)).replace('{view}', String(counts.view)).replace('{off}', String(counts.off))
  return (
    <span role="img" aria-label={spoken} title={spoken} className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium leading-6 text-gray-600 dark:text-gray-300">
      {(['full', 'review', 'view'] as const).filter((level) => counts[level] > 0).map((level) => (
        <span key={level} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${TIER_DOT[level]}`} />
          {levelWord(level, tr)} {counts[level]}
        </span>
      ))}
      {counts.off > 0 ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <X className="h-3 w-3 shrink-0" aria-hidden="true" />
          {tr('off', 'Off')} {counts.off}
        </span>
      ) : null}
    </span>
  )
}
const LazyPermissionEditor = lazyRetry(async () => ({ default: (await import('./PermissionEditor')).default }), 'users-permission-editor')
const LazyUserDetailSheet = lazyRetry(async () => ({ default: (await import('./UserDetailSheet')).default }), 'users-user-detail-sheet')
const LazyUserProfileModal = lazyRetry(async () => ({ default: (await import('./UserProfileModal')).default }), 'users-user-profile-modal')
const LazyOtpModal = lazyRetry(async () => ({ default: (await import('../utils-settings/OtpModal')).default }), 'users-otp-recovery-modal')
const USERS_LIST_TIMEOUT_MS = 8000
const ROLES_LIST_TIMEOUT_MS = 8000
const USER_MUTATION_TIMEOUT_MS = 12000
const ROLE_MUTATION_TIMEOUT_MS = 12000
const USERS_SECONDARY_READ_DELAY_MS = 2500
const USERS_SECONDARY_READ_IDLE_TIMEOUT_MS = 5000
const MAIN_ACTION_BUTTON_CLASS = 'btn-primary inline-flex h-9 items-center gap-1.5 px-3 text-xs'

function passwordEntryError(password: string, confirm: string, missing: string, tr: Translate): string {
  if (!password) return missing
  const problem = newPasswordProblem(password)
  if (problem) return passwordProblemMessage(problem, tr)
  if (password !== confirm) return tr('new_password_confirm_mismatch', 'New password confirmation does not match')
  return ''
}

function passwordIdentity(user: UserRecord): PasswordIdentity {
  return { username: user.username, name: user.name, phone: user.phone || undefined }
}

type PasswordEntryProps = {
  tr: Translate
  target: UserRecord
  form: PasswordFormState
  setForm: Dispatch<SetStateAction<PasswordFormState>>
  passwordSaving: boolean
  onSave: () => void
}

function OwnPasswordChangeForm({ tr, target, form, setForm, passwordSaving, onSave }: PasswordEntryProps) {
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave() }}>
      <input type="text" name="username" autoComplete="username" value={target.username || ''} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
        {tr('current_password_required_change', 'Current password is required to change password')}
      </div>
      <div>
        <label htmlFor="reset-password-current" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('current_password', 'Current password')}</label>
        <input
          id="reset-password-current"
          name="current_password"
          type="password"
          autoComplete="current-password"
          className="input"
          value={form.currentPassword}
          onChange={(event) => setForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
          autoFocus
        />
      </div>
      <NewPasswordFields
        tr={tr}
        idPrefix="reset-password"
        password={form.newPassword}
        confirm={form.confirmPassword}
        onPasswordChange={(newPassword) => setForm((prev) => ({ ...prev, newPassword }))}
        onConfirmChange={(confirmPassword) => setForm((prev) => ({ ...prev, confirmPassword }))}
        identity={passwordIdentity(target)}
        disabled={passwordSaving}
        inputClassName="input"
      />
      <div className="flex justify-end">
        <button type="submit" className={MAIN_ACTION_BUTTON_CLASS} title={tr('change_password', 'Change password')} disabled={passwordSaving}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {passwordSaving ? tr('updating', 'Updating…') : tr('save', 'Save')}
        </button>
      </div>
    </form>
  )
}

// Not a form, and no field a password manager treats as a login: this is
// someone else's password, never one for the administrator's own vault.
function AdminPasswordResetForm({ tr, target, form, setForm, passwordSaving, onSave }: PasswordEntryProps) {
  return (
    <div className="space-y-4">
      <NewPasswordFields
        tr={tr}
        idPrefix="reset-password"
        mode="other-user"
        password={form.newPassword}
        confirm={form.confirmPassword}
        onPasswordChange={(newPassword) => setForm((prev) => ({ ...prev, newPassword }))}
        onConfirmChange={(confirmPassword) => setForm((prev) => ({ ...prev, confirmPassword }))}
        identity={passwordIdentity(target)}
        disabled={passwordSaving}
        inputClassName="input"
      />
      <div className="flex justify-end">
        <button type="button" className={MAIN_ACTION_BUTTON_CLASS} title={tr('change_password', 'Change password')} disabled={passwordSaving} onClick={onSave}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {passwordSaving ? tr('updating', 'Updating…') : tr('save', 'Save')}
        </button>
      </div>
    </div>
  )
}

function PasswordHandover({ tr, name, password, onDone }: { tr: Translate; name: string; password: string; onDone: () => void }) {
  const [copyNotice, setCopyNotice] = useState('')
  const copyLabel = tr('copy_new_password', 'Copy new password')
  const copy = async () => {
    const copied = await copyPasswordToClipboard(password)
    setCopyNotice(copied
      ? tr('new_password_copied', 'New password copied to clipboard.')
      : tr('new_password_copy_failed', 'Could not copy automatically. Select the new password field and copy it before leaving.'))
  }
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{tr('password_admin_handover_title', 'New password for {name}').replace('{name}', name)}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{tr('password_admin_handover_body', 'Give it to them now. It is shown only this once.')}</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 select-all break-all rounded-md bg-gray-50 px-2 py-1.5 font-mono text-sm text-gray-800 dark:bg-slate-900 dark:text-gray-100">{password}</div>
        <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-100" aria-label={copyLabel} title={copyLabel} onClick={() => { void copy() }}>
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {copyNotice ? <p className="text-xs text-gray-600 dark:text-gray-300" role="status">{copyNotice}</p> : null}
      <div className="flex justify-end">
        <button type="button" className={MAIN_ACTION_BUTTON_CLASS} onClick={onDone}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {tr('done', 'Done')}
        </button>
      </div>
    </div>
  )
}

/**
 * 1.2.1 Render-safe fallback for nullable contact values.
 */
function formatContactValue(value: unknown): string {
  const text = String(value || '').trim()
  return text || 'N/A'
}

function UsersDesktopSkeletonRows() {
  return Array.from({ length: 5 }).map((_, index) => (
    <tr key={`users-desktop-skeleton-${index}`} className="animate-pulse">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-blue-100 dark:bg-blue-900/40" />
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-5 w-20 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="mx-auto h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="mx-auto h-5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" /></td>
      <td className="px-3 py-3"><div className="mx-auto h-9 w-16 rounded-lg bg-slate-100 dark:bg-slate-800" /></td>
      <td className="px-2 py-3"><div className="ml-auto h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" /></td>
    </tr>
  ))
}

function UsersMobileSkeletonCards() {
  return Array.from({ length: 4 }).map((_, index) => (
    <div key={`users-mobile-skeleton-${index}`} className="card animate-pulse flex items-center gap-3 p-3">
      <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" />
    </div>
  ))
}

export default function Users() {
  const { t, notify, user: currentUser } = useApp()
  const { syncChannel } = useSync()
  // E4: renders inside the Settings hub now.
  const isActive = useIsPageActive('settings')
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef<number | null>(null)
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const rolesLoadedOnceRef = useRef(false)
  const rolesRequestRef = useRef(0)
  const rolesPromiseRef = useRef<Promise<void> | null>(null)
  const rolesSecondaryReadCancelRef = useRef<(() => void) | null>(null)
  const tr = useCallback((key: string, fallback: string): string => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }, [t])

  const [users, setUsers] = useState<UserRecord[]>([])
  // S-auth4c: bumped after an admin reset so the request panel reloads.
  const [resetRequestsVersion, setResetRequestsVersion] = useState(0)
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [tab, setTab] = useState<UsersTab>('users')
  const [modal, setModal] = useState<UsersModal>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null)
  const [search, setSearch] = useState('')
  // The Roles tab has its own search: text typed for users must not filter the roles list.
  const [roleSearch, setRoleSearch] = useState('')
  // Role/Status filter -- Users was the one remaining list page with a
  // search box but no FilterMenu at all (found during the Part 124
  // cross-page consistency audit; every other list page in the app has
  // one). Mirrors Branches.tsx's status-filter pattern exactly (same
  // 'all'/'active'/'inactive' values, same FilterMenu section shape).
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  // Unified sort (listSort.ts + SortChip); full list is client-held, so the
  // client sort is authoritative here.
  const [userSortSpec, setUserSortSpec] = useState<SortSpec>(() => loadSortSpec(
    'users:sort',
    { field: 'name', direction: 'asc' },
    USER_SORT_FIELD_DEFS as unknown as ReadonlyArray<SortField<unknown>>,
  ))
  useEffect(() => { saveSortSpec('users:sort', userSortSpec) }, [userSortSpec])
  const userSortFields = useMemo<SortField<UserRecord>[]>(() => {
    const labels: Record<string, string> = {
      name: tr('name', 'Name'),
      role: tr('role', 'Role'),
      created: tr('col_added', 'Added'),
    }
    return USER_SORT_FIELD_DEFS.map((field) => ({ ...field, label: labels[field.id] || field.id }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])
  const [userForm, setUserForm] = useState<UserFormState>(INITIAL_USER_FORM)
  const [roleForm, setRoleForm] = useState<RoleFormState>(INITIAL_ROLE_FORM)
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(EMPTY_PASSWORD_FORM)
  const [passwordHandover, setPasswordHandover] = useState<PasswordHandoverState | null>(null)
  const resetTargetId = modal === 'resetPw' && selectedUser ? selectedUser.id : null
  const openResetTargetRef = useRef<EntityId | null>(resetTargetId)
  openResetTargetRef.current = resetTargetId
  useEffect(() => { setPasswordHandover(null) }, [resetTargetId])
  const [saving, setSaving] = useState(false)
  // Part 563: the user-save review dialog is open (handleSaveUser validated +
  // opened it; commitSaveUser writes on confirm).
  const [userConfirmOpen, setUserConfirmOpen] = useState(false)
  // Reset that flag whenever the user modal is not open, so a stale "open" flag
  // can't resurface the dialog the next time the modal is opened.
  useEffect(() => { if (modal !== 'editUser') setUserConfirmOpen(false) }, [modal])
  const [passwordSaving, setPasswordSaving] = useState(false)
  // S4-21: three separate forms live on this page, so each declares its own
  // dirtiness and each re-baselines on the record it is editing (one modal
  // instance is reused for every user/role).
  const { dirty: userFormDirty } = useFormDirty(userForm, String(selectedUser?.id ?? 'new'))
  // Unsaved means "differs from the saved role" (a blank form when creating), so a draft restored from a minimized
  // chip counts as unsaved work too, which a first-render baseline would not.
  const roleFormDirty = isDirtySince(stableSnapshot(roleFormOf(selectedRole)), roleForm)
  const { dirty: passwordFormDirty } = useFormDirty(passwordForm, String(selectedUser?.id ?? 'new'))
  const [deletingRoleId, setDeletingRoleId] = useState<EntityId | null>(null)
  const saveUserInFlightRef = useRef(false)
  const passwordInFlightRef = useRef(false)
  const saveRoleInFlightRef = useRef(false)
  const deleteRoleInFlightRef = useRef(false)
  // The role waiting on the shared delete confirmation (was native confirm()).
  const [roleDeleteTarget, setRoleDeleteTarget] = useState<RoleRecord | null>(null)
  // The role-save review (before -> after for every changed key) is open; commitSaveRole writes on confirm.
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false)
  const [loadingRoleDefaults, setLoadingRoleDefaults] = useState(false)
  const [rolePreset, setRolePreset] = useState('')
  // The footer's Discard asks "Discard unsaved changes?" before it puts the saved role back in the editor.
  const [roleDiscardOpen, setRoleDiscardOpen] = useState(false)
  const selectedRoleIdRef = useRef<EntityId | null>(null)
  // The shared Modal has no Escape handling; these two review dialogs promise
  // Escape aborts, so they wire their own (abort only -- never a write).
  useEffect(() => {
    if (!userConfirmOpen && !roleDeleteTarget && !roleConfirmOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (userConfirmOpen && !saveUserInFlightRef.current) setUserConfirmOpen(false)
      if (roleDeleteTarget && !deleteRoleInFlightRef.current) setRoleDeleteTarget(null)
      if (roleConfirmOpen && !saveRoleInFlightRef.current) setRoleConfirmOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [userConfirmOpen, roleDeleteTarget, roleConfirmOpen])
  useEffect(() => { if (modal !== 'editRole') { setRoleConfirmOpen(false); setRoleDiscardOpen(false) } }, [modal])
  const [profileOpen, setProfileOpen] = useState(false)
  const [otpRecoveryTarget, setOtpRecoveryTarget] = useState<UserRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [rolesLoading, setRolesLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const actionHistory = useActionHistory({ limit: 3, notify, enabled: historyReady, user: currentUser })
  const runUserMutation = useCallback((loader: () => Promise<MutationResult>, label: string) => (
    withLoaderTimeout(loader, label, USER_MUTATION_TIMEOUT_MS)
  ), [])
  const runRoleMutation = useCallback((loader: () => Promise<MutationResult>, label: string) => (
    withLoaderTimeout(loader, label, ROLE_MUTATION_TIMEOUT_MS)
  ), [])

  /**
   * 2. Authorization Guards
   * 2.1 `canManage` gates admin-only data/actions.
   * 2.2 `canManageTargetUser` permits peer-admin management, including of the
   *     primary admin account (explicit user decision, Sep 1 2026). Server-side
   *     canManageTarget() enforces the same rule.
   */
  const canManage = isAdminControlUser(currentUser)
  const canManageTargetUser = (targetUser: UserRecord | null | undefined): boolean => {
    return canManage && !!targetUser
  }
  const isCurrentAccount = (targetUser: UserRecord): boolean => Number(targetUser.id) === Number(currentUser?.id)

  // Device-approval notifications navigate here with anchor 'devices' (see
  // routes/notifications.ts's buildDeviceApprovalSection and
  // AppContext.tsx's navigateTo). Users.tsx can already be mounted when
  // that navigation happens (pages stay mounted across switches), so a
  // one-time mount check isn't enough -- listen for the navigation event
  // too. window.location.hash is already updated by the time this fires,
  // since navigateTo() pushes the URL before dispatching the event.
  useEffect(() => {
    if (!canManage) return
    const applyHashTab = () => {
      if (window.location.hash === '#devices') setTab('devices')
    }
    applyHashTab()
    window.addEventListener(APP_NAVIGATION_EVENT, applyHashTab)
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, applyHashTab)
  }, [canManage])

  const syncChannelName = String(syncChannel?.channel || '')
  const syncTimestamp = Number(syncChannel?.ts || 0)

  const loadRoles = useCallback(async ({ silent = rolesLoadedOnceRef.current }: { silent?: boolean } = {}): Promise<void> => {
    if (rolesPromiseRef.current) return rolesPromiseRef.current
    const requestId = beginTrackedRequest(rolesRequestRef)
    const promise = (async () => {
      if (!canManage) {
        if (!isTrackedRequestCurrent(rolesRequestRef, requestId)) return
        setRoles([])
        setRolesLoading(false)
        rolesLoadedOnceRef.current = true
        return
      }
      if (!silent || !rolesLoadedOnceRef.current) {
        setRolesLoading(true)
      }
      try {
        const nextRoles = await withLoaderTimeout(() => getUsersApi().getRoles(), 'Roles list', ROLES_LIST_TIMEOUT_MS)
        if (!isTrackedRequestCurrent(rolesRequestRef, requestId)) return
        setRoles(normalizeRoles(nextRoles))
        rolesLoadedOnceRef.current = true
      } catch (error) {
        if (!isTrackedRequestCurrent(rolesRequestRef, requestId)) return
        if (tab === 'roles') {
          notify(getErrorMessage(error, tr('roles_load_failed', 'Failed to load roles')), 'warning')
        }
      } finally {
        if (!isTrackedRequestCurrent(rolesRequestRef, requestId)) return
        setRolesLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (rolesPromiseRef.current === wrappedPromise) {
        rolesPromiseRef.current = null
      }
    })
    rolesPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [canManage, notify, tab, tr])

  const load = useCallback(async ({ silent = loadedOnceRef.current }: { silent?: boolean } = {}): Promise<void> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (!canManage) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setUsers([])
        setRoles([])
        setLoadError(null)
        setLoading(false)
        loadedOnceRef.current = true
        return
      }
      clearTimeoutRef(loadWatchdogRef)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError(null)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoadError(tr('users_load_slow', 'Users are taking longer than expected. Tap Refresh or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const usersResult = await Promise.allSettled([
          withLoaderTimeout(() => getUsersApi().getUsers(), 'Users list', USERS_LIST_TIMEOUT_MS),
        ])

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return

        const nextUsers = usersResult[0]?.status === 'fulfilled' && Array.isArray(usersResult[0]?.value)
          ? normalizeUsers(usersResult[0].value)
          : null

        if (nextUsers) setUsers(nextUsers)
        else if (!loadedOnceRef.current) setUsers([])
        if (nextUsers === null) {
          const firstError = usersResult[0]?.status === 'rejected' ? usersResult[0].reason : null
          throw new Error(getErrorMessage(firstError, tr('users_load_failed', 'Failed to load users')))
        }

        loadedOnceRef.current = true
        setLoadError(null)
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const nextMessage = getErrorMessage(error, tr('users_load_failed', 'Failed to load users'))
        if (!loadedOnceRef.current) {
          setLoadError(nextMessage)
          notify(nextMessage, 'error')
        } else {
          const refreshMessage = tr('users_refresh_failed', 'Unable to refresh users right now. Showing the latest loaded data.')
        setLoadError((current) => current || refreshMessage)
        notify(refreshMessage, 'warning')
      }
    } finally {
        clearTimeoutRef(loadWatchdogRef)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [canManage, notify, tr])

  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      clearTimeoutRef(loadWatchdogRef)
      invalidateTrackedRequest(loadRequestRef)
      invalidateTrackedRequest(rolesRequestRef)
      loadPromiseRef.current = null
      rolesPromiseRef.current = null
      if (rolesSecondaryReadCancelRef.current) {
        rolesSecondaryReadCancelRef.current()
        rolesSecondaryReadCancelRef.current = null
      }
      setLoading(false)
      setRolesLoading(false)
      return
    }
    load({ silent: loadedOnceRef.current })
    if (tab === 'roles') {
      if (rolesSecondaryReadCancelRef.current) {
        rolesSecondaryReadCancelRef.current()
        rolesSecondaryReadCancelRef.current = null
      }
      loadRoles({ silent: rolesLoadedOnceRef.current })
      return
    }
    if (!rolesLoadedOnceRef.current && !rolesPromiseRef.current) {
      if (rolesSecondaryReadCancelRef.current) rolesSecondaryReadCancelRef.current()
      rolesSecondaryReadCancelRef.current = scheduleUsersSecondaryRead(() => {
        rolesSecondaryReadCancelRef.current = null
        loadRoles({ silent: true })
      })
    }
  }, [canManage, isActive, load, loadRoles, tab])
  useEffect(() => {
    if (!isActive) {
      setHistoryReady(false)
      return undefined
    }
    if (!loadedOnceRef.current || loading) return undefined
    setHistoryReady(true)
    return undefined
  }, [isActive, loading])
  useEffect(() => {
    if (!isActive || !syncChannelName) return
    if (syncChannelName === 'users') {
      load({ silent: true })
    }
    if (syncChannelName === 'roles') {
      loadRoles({ silent: true })
    }
  }, [isActive, load, loadRoles, syncChannelName, syncTimestamp])
  useEffect(() => {
    if (!isActive || tab !== 'roles') return
    loadRoles({ silent: rolesLoadedOnceRef.current })
  }, [isActive, loadRoles, tab])
  useEffect(() => () => {
    clearTimeoutRef(loadWatchdogRef)
    invalidateTrackedRequest(loadRequestRef)
    invalidateTrackedRequest(rolesRequestRef)
    loadPromiseRef.current = null
    rolesPromiseRef.current = null
  }, [])

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matched = users.filter((user) => {
      if (query && !`${user.name} ${user.username} ${user.phone || ''} ${user.email || ''} ${user.role_name || ''}`.toLowerCase().includes(query)) return false
      if (roleFilter !== 'all' && String(user.role_id ?? '') !== roleFilter) return false
      if (statusFilter !== 'all' && Boolean(user.is_active) !== (statusFilter === 'active')) return false
      return true
    })
    return sortRecords(matched, userSortSpec, userSortFields)
  }, [search, users, roleFilter, statusFilter, userSortFields, userSortSpec])
  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase()
    return query ? roles.filter((role) => String(role.name ?? '').toLowerCase().includes(query)) : roles
  }, [roles, roleSearch])
  const assignedCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const user of users) counts.set(Number(user.role_id), (counts.get(Number(user.role_id)) ?? 0) + 1)
    return counts
  }, [users])
  const userFilterActiveCount = (roleFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)
  const userFilterSections = useMemo(() => ([
    {
      id: 'role',
      label: tr('role', 'Role'),
      searchable: roles.length > 6,
      options: [
        { id: 'all', label: tr('all', 'All'), active: roleFilter === 'all', onClick: () => setRoleFilter('all') },
        ...roles.map((role) => ({
          id: String(role.id),
          label: role.name || `Role ${role.id}`,
          active: roleFilter === String(role.id),
          onClick: () => setRoleFilter(String(role.id)),
        })),
      ],
    },
    {
      id: 'status',
      label: tr('status', 'Status'),
      options: [
        { id: 'all', label: tr('all', 'All'), active: statusFilter === 'all', onClick: () => setStatusFilter('all') },
        { id: 'active', label: tr('active', 'Active'), active: statusFilter === 'active', onClick: () => setStatusFilter('active') },
        { id: 'inactive', label: tr('inactive', 'Inactive'), active: statusFilter === 'inactive', onClick: () => setStatusFilter('inactive') },
      ],
    },
  ]), [roles, roleFilter, statusFilter, tr])
  const clearUserFilters = useCallback(() => {
    setRoleFilter('all')
    setStatusFilter('all')
  }, [])

  /**
   * 3. Modal Openers
   * 3.1 Create/Edit user records.
   * 3.2 Create/Edit role records.
   */
  const openCreateUser = async () => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (!rolesLoadedOnceRef.current && !roles.length) {
      await loadRoles({ silent: false })
    }
    setSelectedUser(null)
    setUserForm({ ...INITIAL_USER_FORM, role_id: roles[0]?.id || '' })
    setModal('editUser')
  }

  const openEditUser = async (user: UserRecord): Promise<void> => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (!canManageTargetUser(user)) return notify(tr('cannot_manage_admin_account', 'You cannot manage this account.'), 'error')
    if (!rolesLoadedOnceRef.current && !roles.length) {
      await loadRoles({ silent: false })
    }
    setSelectedUser(user)
    setUserForm({
      name: user.name || '',
      username: user.username || '',
      phone: user.phone || '',
      email: user.email || '',
      avatar_path: user.avatar_path || '',
      password: '',
      passwordConfirm: '',
      role_id: user.role_id || '',
      is_active: user.is_active ? 1 : 0,
    })
    setModal('editUser')
  }

  const openCreateRole = () => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    setSelectedRole(null)
    setRoleForm(INITIAL_ROLE_FORM)
    setRolePreset('')
    setModal('editRole')
  }

  const openEditRole = (role: RoleRecord): void => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    setSelectedRole(role)
    setRoleForm(roleFormOf(role))
    setModal('editRole')
  }

  // The Users tab, narrowed to the people holding this role.
  const showRoleUsers = (role: RoleRecord): void => {
    setRoleFilter(String(role.id))
    setStatusFilter('all')
    setSearch('')
    setTab('users')
  }

  const buildRoleWritePayload = useCallback((role: Partial<RoleRecord> = {}): Record<string, unknown> => ({
    name: String(role.name || '').trim(),
    permissions: normalizePermissionState(role.permissions),
    userId: currentUser?.id,
    userName: currentUser?.name,
  }), [currentUser?.id, currentUser?.name])

  /**
   * 4. Mutations
   * 4.1 User create/update.
   * 4.2 Password reset.
   * 4.3 Role create/update/delete.
   */
  const handleSaveUser = async () => {
    if (!userForm.name.trim() || !userForm.username.trim()) {
      notify(tr('name_username_required', 'Name and username are required'), 'error')
      return
    }
    const newUserPasswordError = selectedUser
      ? ''
      : passwordEntryError(userForm.password, userForm.passwordConfirm, tr('password_required_new_user', 'Password is required for new users'), tr)
    if (newUserPasswordError) {
      notify(newUserPasswordError, 'error')
      return
    }
    if (selectedUser && !canManageTargetUser(selectedUser)) {
      notify(tr('cannot_manage_admin_account', 'You cannot manage this account.'), 'error')
      return
    }
    if (!selectedUser && !userForm.role_id) {
      notify(tr('role_required_new_user', 'Choose a role for the new user'), 'error')
      return
    }
    // Part 563: everything validated -- open the review dialog. commitSaveUser
    // runs the actual create/update on confirm.
    setUserConfirmOpen(true)
  }

  // A username change is decided in the review dialog: 'carry' also updates
  // the linked live records, 'record_only' renames only this account. Without
  // an explicit choice a rename is never sent.
  const userFormRenamesUser = Boolean(selectedUser) && String(selectedUser?.username || '').trim() !== userForm.username.trim()

  const commitSaveUser = async (renameScope?: 'carry' | 'record_only') => {
    const usernameChanged = userFormRenamesUser
    if (usernameChanged && !renameScope) return
    if (!beginSingleAction(saveUserInFlightRef, { blocked: saving })) return
    setUserConfirmOpen(false)
    setSaving(true)
    try {
      const payload: UserWritePayload = {
        name: userForm.name.trim(),
        username: userForm.username.trim(),
        phone: userForm.phone.trim(),
        email: userForm.email.trim(),
        avatar_path: userForm.avatar_path.trim(),
        role_id: userForm.role_id || null,
        is_active: userForm.is_active,
        expectedUpdatedAt: selectedUser?.updated_at || undefined,
        userId: currentUser?.id,
        userName: currentUser?.name,
        ...(usernameChanged && renameScope ? { __rename_cascade: renameScope } : {}),
      }

      const result = selectedUser
        ? await runUserMutation(() => getUsersApi().updateUser(selectedUser.id, payload), 'Update user')
        : await runUserMutation(() => getUsersApi().createUser({ ...payload, password: userForm.password }), 'Create user')

      if (result?.success === false) {
        notify(newPasswordRefusalMessage(result, tr) || lastAdminRequiredMessage(result, tr) || result.error || 'Failed to save user', 'error')
        return
      }

      if (selectedUser) {
        const previousSnapshot = cloneHistorySnapshot(selectedUser)
        const nextSnapshot = cloneHistorySnapshot({ ...selectedUser, ...payload, id: selectedUser.id })
        // Undo and redo replay the rename scope this edit was made with.
        const replayScope = userEditReplayScope(previousSnapshot, nextSnapshot, renameScope)
        const actor = { id: currentUser?.id, name: currentUser?.name }
        actionHistory.pushAction({
          label: tr('user_history_edit', 'Edit user {name}').replace('{name}', previousSnapshot.name || nextSnapshot.name || '').trim(),
          undo: async () => {
            const undoResult = await runUserMutation(() => getUsersApi().updateUser(previousSnapshot.id, buildUserWritePayload(previousSnapshot, actor, replayScope)), 'Undo user update')
              .catch((error: unknown) => { throw lastAdminRequiredError(error, tr) })
            if (undoResult?.success === false) throw new Error(lastAdminRequiredMessage(undoResult, tr) || undoResult.error || 'Failed to restore user')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await runUserMutation(() => getUsersApi().updateUser(nextSnapshot.id, buildUserWritePayload(nextSnapshot, actor, replayScope)), 'Redo user update')
              .catch((error: unknown) => { throw lastAdminRequiredError(error, tr) })
            if (redoResult?.success === false) throw new Error(lastAdminRequiredMessage(redoResult, tr) || redoResult.error || 'Failed to reapply user changes')
            await load({ silent: true })
          },
        })
      }

      notify(selectedUser ? tr('user_updated', 'User updated') : tr('user_created', 'User created'), 'success')
      setModal(null)
      setSelectedUser(null)
      setUserForm(INITIAL_USER_FORM)
      await load()
    } catch (error) {
      notify(newPasswordRefusalMessage(error, tr) || lastAdminRequiredMessage(error, tr) || getErrorMessage(error, 'Failed to save user'), 'error')
    } finally {
      finishSingleAction(saveUserInFlightRef)
      setSaving(false)
    }
  }

  const buildUserReviewItems = (): ConfirmReviewItem[] => {
    const items: ConfirmReviewItem[] = userFormRenamesUser
      ? [
        { label: tr('rename_user_from', 'Current username'), value: String(selectedUser?.username || '').trim() },
        { label: tr('rename_user_to', 'New username'), value: userForm.username.trim() },
      ]
      : [{ label: tr('username', 'Username'), value: userForm.username.trim() }]
    const roleName = roles.find((role) => Number(role.id) === Number(userForm.role_id))?.name
    if (roleName || userForm.role_id) items.push({ label: tr('role', 'Role'), value: roleName || String(userForm.role_id) })
    const phone = userForm.phone.trim()
    if (phone) items.push({ label: tr('phone', 'Phone'), value: phone })
    const email = userForm.email.trim()
    if (email) items.push({ label: tr('email', 'Email'), value: email })
    items.push({ label: tr('status', 'Status'), value: userForm.is_active ? (t('active') || 'Active') : (t('inactive') || 'Inactive') })
    return items
  }

  const handleResetPassword = async () => {
    if (!selectedUser?.id) return
    if (!canManageTargetUser(selectedUser)) {
      notify(tr('cannot_manage_admin_account', 'You cannot manage this account.'), 'error')
      return
    }
    const { currentPassword, newPassword, confirmPassword } = passwordForm
    const ownAccount = isCurrentAccount(selectedUser)
    const entryError = passwordEntryError(newPassword, confirmPassword, tr('enter_new_password', 'Enter new password'), tr)
    if (entryError) {
      notify(entryError, 'error')
      return
    }
    if (ownAccount && !currentPassword.trim()) {
      notify(tr('current_password_required_change', 'Current password is required to change password'), 'error')
      return
    }
    if (!beginSingleAction(passwordInFlightRef, { blocked: passwordSaving })) return

    const targetId = selectedUser.id
    const stillOpenForTarget = () => openResetTargetRef.current !== null && sameUserId(openResetTargetRef.current, targetId)
    setPasswordSaving(true)
    try {
      const actor = { userId: currentUser?.id, userName: currentUser?.name }
      const result = await runUserMutation(() => (ownAccount
        ? getUsersApi().changeUserPassword(selectedUser.id, { currentPassword, newPassword, ...actor })
        : getUsersApi().resetPassword(selectedUser.id, { newPassword, ...actor })
      ), ownAccount ? 'Change user password' : 'Reset user password')
      if (result?.success === false) {
        notify(newPasswordRefusalMessage(result, tr) || currentPasswordRateLimitMessage(result, tr) || result.error || 'Failed to change password', 'error')
        return
      }
      if (ownAccount) {
        const stored = await requestPasswordSave({ username: String(selectedUser.username || ''), password: newPassword, displayName: selectedUser.name })
        const notice = passwordNoticeKey({ stored })
        notify(tr(notice.key, notice.fallback), stored ? 'success' : 'warning')
        if (!stillOpenForTarget()) return
        setPasswordForm(EMPTY_PASSWORD_FORM)
        setModal(null)
        return
      }
      setResetRequestsVersion((version) => version + 1)
      if (!stillOpenForTarget()) return
      setPasswordForm(EMPTY_PASSWORD_FORM)
      setPasswordHandover({ userId: targetId, name: String(selectedUser.name || selectedUser.username || ''), password: newPassword })
    } catch (error) {
      notify(newPasswordRefusalMessage(error, tr) || currentPasswordRateLimitMessage(error, tr) || getErrorMessage(error, 'Failed to change password'), 'error')
    } finally {
      finishSingleAction(passwordInFlightRef)
      setPasswordSaving(false)
    }
  }

  const roleResetCode = canManage ? resettableRoleCode(selectedRole) : null
  selectedRoleIdRef.current = selectedRole?.id ?? null
  const roleResetLabel = roleResetCode === 'manager' ? tr('role_reset_manager_defaults', 'Reset to Manager defaults') : tr('role_reset_employee_defaults', 'Reset to Employee defaults')

  // Loads the seeded permissions of this role into the editor DRAFT. Nothing is written: Save opens the review.
  const handleResetRoleDefaults = async () => {
    if (!roleResetCode || !selectedRole || loadingRoleDefaults) return
    const roleId = selectedRole.id
    setLoadingRoleDefaults(true)
    try {
      const result = await getRoleDefaultsRequest() as { success?: boolean; error?: string; defaults?: Record<string, Record<string, unknown>> } | null
      if (!result || result.success === false) {
        notify(result?.error || tr('role_defaults_load_failed', 'The role defaults could not be loaded. The role is unchanged.'), 'error')
        return
      }
      if (selectedRoleIdRef.current !== roleId) return
      const defaults = result.defaults?.[roleResetCode]
      if (!defaults || typeof defaults !== 'object' || Object.keys(defaults).length === 0) {
        notify(tr('role_defaults_none', 'No defaults are defined for this role. The role is unchanged.'), 'info')
        return
      }
      setRoleForm((prev) => ({ ...prev, permissions: normalizePermissionState(defaults) }))
      notify(tr('role_defaults_loaded', 'Defaults loaded into the editor. Review and save to apply them.'), 'info')
    } catch (error) {
      notify(getErrorMessage(error, tr('role_defaults_load_failed', 'The role defaults could not be loaded. The role is unchanged.')), 'error')
    } finally {
      setLoadingRoleDefaults(false)
    }
  }

  // Minimize parks the editor as a chip, the way the Branch form does (utils/minimizedWork.ts). The draft is written
  // when the admin minimizes, under the account and server the editor was opened under, and read back (then cleared)
  // when the chip is restored; dismissing the chip clears it (MinimizedWorkTray).
  const roleAuthority = useFrozenDraftAuthority(modal === 'editRole' ? roleFormDraftBaseKey(selectedRole?.id) : null, { formIdentity: String(selectedRole?.id ?? 'new') }).authority
  const canMinimizeRoleForm = canManage && roleAuthority !== null
  const preserveRoleForm = () => {
    if (!roleAuthority) return
    // A chip parked now would sit in the new account's list pointing at the old account's draft.
    if (!isDraftAuthorityCurrent(roleAuthority)) {
      notify(draftAuthorityChangedText(t), 'warning')
      return
    }
    writeWorkDraft(roleAuthority.draftKey, roleForm)
    // Storage can be full or blocked and the write is silent: a chip with no draft behind it would lose the work.
    if (stableSnapshot(readWorkDraft<RoleFormState>(roleAuthority.draftKey)?.data) !== stableSnapshot(roleForm)) {
      notify(tr('unable_to_minimize', 'Unable to minimize this edit.'), 'error')
      return
    }
    const name = roleForm.name.trim()
    minimizeWork({
      key: roleFormWorkKey(selectedRole?.id),
      kind: 'role_form',
      pageId: 'settings',
      anchor: 'hub:settings:users',
      label: selectedRole ? `${tr('edit_role', 'Edit role')} — ${selectedRole.name}` : `${tr('create_role', 'Create role')}${name ? ` — ${name}` : ''}`,
      payload: { roleId: selectedRole?.id ?? null },
      draftKey: roleAuthority.draftKey,
    })
    setModal(null)
    setSelectedRole(null)
    setRoleForm(INITIAL_ROLE_FORM)
  }

  // Reopens a parked editor. Whatever is wrong (not an admin, another role open, the role gone) puts the chip back
  // and says so: nothing is dropped.
  const roleModalOpenRef = useRef(false)
  roleModalOpenRef.current = modal === 'editRole'
  const restoreRoleForm = useCallback(async (entry: MinimizedWorkEntry): Promise<boolean> => {
    const refuse = (message: string): false => {
      reparkDeniedRestore(entry)
      notify(message, 'warning')
      return false
    }
    if (!canManage) return refuse(tr('access_denied', 'Access denied'))
    if (roleModalOpenRef.current) return refuse(tr('role_draft_open_first', 'Close or minimize the open role first.'))
    const draft = entry.draftKey ? readWorkDraft<Partial<RoleFormState>>(entry.draftKey)?.data : undefined
    if (!draft || typeof draft.name !== 'string') return refuse(tr('failed_to_load_data', 'Failed to load data'))
    const roleId = entry.payload?.roleId
    let role: RoleRecord | null = null
    if (roleId !== null && roleId !== undefined) {
      try {
        role = normalizeRoles(await getUsersApi().getRoles()).find((candidate) => String(candidate.id) === String(roleId)) ?? null
      } catch {
        return refuse(tr('roles_load_failed', 'Failed to load roles'))
      }
      if (!role) return refuse(tr('role_not_found', 'Role not found'))
      if (role.is_system) return refuse(tr('system_role_edit_locked', 'System roles cannot be edited here.'))
    }
    setSelectedRole(role)
    setRoleForm({ name: draft.name, permissions: normalizePermissionState(draft.permissions) })
    setRolePreset('')
    setTab('roles')
    setModal('editRole')
    if (entry.draftKey) clearWorkDraft(entry.draftKey)
    return true
  }, [canManage, notify, tr])
  useEffect(() => {
    const pending = consumePendingRestore('role_form')
    if (pending) void restoreRoleForm(pending).then((restored) => { if (restored) markRestoreHandled('role_form') })
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.kind !== 'role_form' || !detail.entry) return
      void restoreRoleForm(detail.entry as MinimizedWorkEntry).then((restored) => { if (restored) markRestoreHandled('role_form') })
    }
    window.addEventListener(RESTORE_WORK_EVENT, onRestore)
    return () => window.removeEventListener(RESTORE_WORK_EVENT, onRestore)
  }, [restoreRoleForm])

  // The footer's Discard asks the same question the X asks ("Discard unsaved changes?", Discard / Back), but it
  // answers by putting the saved role back in the editor instead of leaving it.
  const roleDiscardGuard: CloseGuard = {
    requestClose: () => setRoleDiscardOpen(true),
    promptOpen: roleDiscardOpen,
    options: ['discard', 'back'],
    dismissPrompt: () => setRoleDiscardOpen(false),
    discardAndClose: () => {
      setRoleForm(roleFormOf(selectedRole))
      setRolePreset('')
      setRoleDiscardOpen(false)
    },
    saveAndClose: () => undefined,
    saving: false,
    workLabel: null,
  }

  const roleAssignedCount = selectedRole ? assignedCounts.get(Number(selectedRole.id)) ?? 0 : 0
  // The save review and the footer count read the same rows: one per changed module, plus the name.
  const roleChangeRows = useMemo<RoleChangeRow[]>(() => (modal === 'editRole'
    ? summarizeRoleChangesByModule(selectedRole?.permissions, roleForm.permissions, tr, { from: selectedRole?.name ?? '', to: roleForm.name })
    : []), [modal, selectedRole, roleForm, tr])

  const buildRoleReviewItems = (): ConfirmReviewItem[] => roleChangeRows.map((row) => ({
    label: <RoleReviewLabel row={row} tr={tr} />,
    value: <RoleReviewValue row={row} tr={tr} />,
  }))

  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) {
      notify(tr('role_name_required', 'Role name is required'), 'error')
      return
    }
    // An edit that changes nothing is not sent: the Worker would write nothing
    // either, and the people holding this role would only be told to refresh.
    if (selectedRole && !roleFormDirty) {
      notify(tr('settings_no_changes', 'No changes to save'), 'info')
      setModal(null)
      setSelectedRole(null)
      setRoleForm(INITIAL_ROLE_FORM)
      return
    }
    // Nothing is written until the admin has seen every change, a new role included.
    setRoleConfirmOpen(true)
  }

  const commitSaveRole = async () => {
    if (!beginSingleAction(saveRoleInFlightRef, { blocked: saving })) return

    setSaving(true)
    try {
      const payload = {
        name: roleForm.name.trim(),
        permissions: roleForm.permissions,
        expectedUpdatedAt: selectedRole?.updated_at || undefined,
        userId: currentUser?.id,
        userName: currentUser?.name,
      }
      const result = selectedRole
        ? await runRoleMutation(() => getUsersApi().updateRole(selectedRole.id, payload), 'Update role')
        : await runRoleMutation(() => getUsersApi().createRole(payload), 'Create role')

      if (result?.success === false) {
        notify(lastAdminRequiredMessage(result, tr) || result.error || 'Failed to save role', 'error')
        return
      }

      if (selectedRole) {
        const previousSnapshot = cloneHistorySnapshot(selectedRole)
        const nextSnapshot = cloneHistorySnapshot({ ...selectedRole, ...payload, id: selectedRole.id })
        actionHistory.pushAction({
          label: tr('role_history_edit', 'Edit role {name}').replace('{name}', previousSnapshot.name || nextSnapshot.name || '').trim(),
          undo: async () => {
            const undoResult = await runRoleMutation(() => getUsersApi().updateRole(previousSnapshot.id, buildRoleWritePayload(previousSnapshot)), 'Undo role update')
              .catch((error: unknown) => { throw lastAdminRequiredError(error, tr) })
            if (undoResult?.success === false) throw new Error(lastAdminRequiredMessage(undoResult, tr) || undoResult.error || 'Failed to restore role')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await runRoleMutation(() => getUsersApi().updateRole(nextSnapshot.id, buildRoleWritePayload(nextSnapshot)), 'Redo role update')
              .catch((error: unknown) => { throw lastAdminRequiredError(error, tr) })
            if (redoResult?.success === false) throw new Error(lastAdminRequiredMessage(redoResult, tr) || redoResult.error || 'Failed to reapply role changes')
            await load({ silent: true })
          },
        })
      } else {
        let createdRoleId = extractHistoryResultId(result)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdRoleId })
        if (createdRoleId > 0) {
          actionHistory.pushAction({
            label: tr('role_history_add', 'Add role {name}').replace('{name}', createdSnapshot.name || '').trim(),
            undo: async () => {
              const undoResult = await runRoleMutation(() => getUsersApi().deleteRole(createdRoleId, { userId: currentUser?.id, userName: currentUser?.name }), 'Undo role creation')
              if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to undo role creation')
              await load({ silent: true })
            },
            redo: async () => {
              const redoResult = await runRoleMutation(() => getUsersApi().createRole(buildRoleWritePayload(createdSnapshot)), 'Redo role creation')
              if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to recreate role')
              createdRoleId = extractHistoryResultId(redoResult)
              await load({ silent: true })
            },
          })
        }
      }

      notify(selectedRole ? tr('role_updated', 'Role updated') : tr('role_created', 'Role created'), 'success')
      setModal(null)
      setSelectedRole(null)
      setRoleForm(INITIAL_ROLE_FORM)
      await load()
    } catch (error) {
      notify(lastAdminRequiredMessage(error, tr) || getErrorMessage(error, 'Failed to save role'), 'error')
    } finally {
      finishSingleAction(saveRoleInFlightRef)
      setSaving(false)
    }
  }

  const handleDeleteRole = async (role: RoleRecord): Promise<void> => {
    if (!canManage) return notify('No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    const assignedCount = assignedCounts.get(Number(role.id)) ?? 0
    if (assignedCount > 0) {
      notify(tr('role_delete_blocked', '{n} people still use this role').replace('{n}', String(assignedCount)), 'error')
      return
    }
    if (deletingRoleId != null) return
    // Confirmed in the shared review dialog; commitDeleteRole runs on confirm.
    setRoleDeleteTarget(role)
  }

  const commitDeleteRole = async (role: RoleRecord): Promise<void> => {
    if (!beginSingleAction(deleteRoleInFlightRef, { blocked: deletingRoleId != null, value: role.id })) return
    setRoleDeleteTarget(null)
    setDeletingRoleId(role.id)
    try {
      const snapshot = cloneHistorySnapshot(role)
      const result = await runRoleMutation(() => getUsersApi().deleteRole(role.id, {
        expectedUpdatedAt: role.updated_at || undefined,
        userId: currentUser?.id,
        userName: currentUser?.name,
      }), 'Delete role')
      if (result?.success === false) {
        notify(result.error || 'Failed to delete role', 'error')
        return
      }
      let restoredRoleId = 0
      actionHistory.pushAction({
        label: tr('role_history_delete', 'Delete role {name}').replace('{name}', snapshot.name || '').trim(),
        undo: async () => {
          const undoResult = await runRoleMutation(() => getUsersApi().createRole(buildRoleWritePayload(snapshot)), 'Undo role deletion')
          if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore role')
          restoredRoleId = extractHistoryResultId(undoResult)
          await load({ silent: true })
        },
        redo: async () => {
          const targetId = restoredRoleId || Number(snapshot.id || 0)
          if (!targetId) return
          const redoResult = await runRoleMutation(() => getUsersApi().deleteRole(targetId, { userId: currentUser?.id, userName: currentUser?.name }), 'Redo role deletion')
          if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to delete role again')
          await load({ silent: true })
        },
      })
      notify(tr('role_deleted', 'Role deleted'), 'success')
      await load()
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete role'), 'error')
    } finally {
      finishSingleAction(deleteRoleInFlightRef)
      setDeletingRoleId(null)
    }
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      {!canManage ? (
          <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
            {tr('users_view_only_note', 'View-only mode for shared users. Account details and OTP can still be managed from your profile button.')}
          </div>
      ) : null}

      {/* Section tabs share a row with the Profile button (view-scoped
          controls like Add User/Add Role live in the search row below,
          since they act on the currently selected tab). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1">
          {[
            ['users', t('users') || 'Users'],
            ['roles', t('roles') || 'Roles'],
            ...(canManage ? [['devices', tr('devices_tab', 'Devices')]] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as UsersTab)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary mb-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm" onClick={() => setProfileOpen(true)}>
          <CircleUserRound className="h-4 w-4" />
          <span>{tr('profile', 'Profile')}</span>
        </button>
      </div>

      {tab === 'roles' && rolesLoading && !roles.length ? (
        <div className="mb-2 text-xs text-blue-600 dark:text-blue-300">{tr('loading', 'Loading...')}</div>
      ) : null}

      {/* Toolbar + search pin to the top of the page's scroll container while scrolling -- the same `sticky top-2`
          treatment as Products/Inventory/Sales/Returns/Branches/Contacts/AuditLog, in one sticky wrapper.
          History and the primary Add/Create action hug their content (icon + word); Add/Create sits at the right edge.
          From 768px everything shares one row -- History, the search, Add/Create -- and below that the search drops to
          its own full-width line under History and Add/Create. DOM order is History, search, Add/Create (the tab order of
          the wide layout); `order-*` lifts the button beside History on a narrow screen. */}
      <div className="sticky top-2 z-30 -mx-1 bg-gray-50 pb-2 dark:bg-gray-900 sm:mx-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2 pt-1 md:flex-nowrap md:gap-x-2">
          <ActionHistoryBar history={actionHistory} t={t} className="order-1 w-auto shrink-0" showLabel />

          <div className="order-3 flex w-full min-w-0 flex-wrap items-center gap-2 md:order-2 md:w-auto md:flex-1 md:flex-nowrap">
            <SearchInput
              id={tab === 'roles' ? 'roles-search' : 'users-search'}
              name={tab === 'roles' ? 'roles_search' : 'users_search'}
              value={tab === 'roles' ? roleSearch : search}
              onChange={tab === 'roles' ? setRoleSearch : setSearch}
              placeholder={tab === 'roles' ? tr('role_search_placeholder', 'Search roles') : tr('search_users_placeholder', 'Search users, phone, email, or role')}
            />
            {/* Filter only applies to the users list (role_id/is_active
                columns) -- the roles tab renders `roles` directly with no
                filtering of its own, so the trigger stays hidden there
                rather than sitting inert. */}
            {tab === 'users' ? (
              <>
                <SortChip
                  spec={userSortSpec}
                  fields={userSortFields}
                  onChange={setUserSortSpec}
                  label={tr('sort', 'Sort')}
                />
                <FilterMenu
                  label={tr('filters', 'Filters')}
                  activeCount={userFilterActiveCount}
                  sections={userFilterSections}
                  onClear={userFilterActiveCount > 0 ? clearUserFilters : null}
                  mobileIconOnly
                />
              </>
            ) : null}
          </div>

          {tab === 'users' && canManage ? <button type="button" className="btn-primary order-2 ml-auto inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs sm:text-sm md:order-3 md:ml-0" onClick={openCreateUser}><UserPlus className="h-4 w-4 shrink-0" /><span>{t('add_user') || 'Add user'}</span></button> : null}
          {tab === 'roles' && canManage ? <button type="button" className="btn-primary order-2 ml-auto inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs sm:text-sm md:order-3 md:ml-0" title={tr('create_role', 'Create role')} onClick={openCreateRole}><ShieldPlus className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{t('create') || 'Create'}</span></button> : null}
        </div>
      </div>

      {loadError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {loadError}
        </div>
      ) : null}

      {tab === 'users' && canManage ? (
        <PasswordResetRequests
          t={t}
          notify={notify}
          refreshKey={resetRequestsVersion}
          onReset={(userId) => {
            const target = users.find((candidate) => Number(candidate.id) === Number(userId))
            if (!target || !canManageTargetUser(target)) {
              notify(tr('cannot_manage_admin_account', 'You cannot manage this account.'), 'error')
              return
            }
            setSelectedUser(target)
            setPasswordForm(EMPTY_PASSWORD_FORM)
            setModal('resetPw')
          }}
        />
      ) : null}

      {tab === 'users' ? (
        <>
          <div className="card hidden flex-col overflow-hidden sm:flex">
            <div className="overflow-auto">
              <table className="w-full min-w-[1080px] text-sm table-bordered">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('full_name', 'Name')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('username', 'Username')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('phone', 'Phone')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('email', 'Email')}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('role', 'Role')}</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{tr('status', 'Status')}</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">2FA</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{tr('added_on', 'Added')}</th>
                    <th className="px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{tr('shift_history', 'Shift history')}</th>
                    <th className="w-10 px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading && !users.length ? (
                    <UsersDesktopSkeletonRows />
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-400">{t('no_data') || 'No data'}</td>
                    </tr>
                  ) : filteredUsers.map((user) => (
                    <tr key={user.id} className="table-row cursor-pointer" onClick={() => { setSelectedUser(user); setModal('userDetail') }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                            <UserAvatarImage src={user.avatar_path} alt={user.name} className="h-9 w-9 object-cover" fallback={(user.name?.[0]?.toUpperCase() || 'U')} />
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{user.name}</div>
                            {Number(user.id) === Number(currentUser?.id) ? <div className="text-xs text-blue-500">{tr('current_account', 'Current account')}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{user.username}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatContactValue(user.phone)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatContactValue(user.email)}</td>
                      <td className="px-4 py-3">{user.role_name ? <span className="badge-blue text-xs">{user.role_name}</span> : <span className="text-xs text-gray-400">{t('no_role') || 'No role'}</span>}</td>
                      <td className="px-4 py-3 text-center"><span className={user.is_active ? 'badge-green' : 'badge-red'}>{user.is_active ? (t('active') || 'Active') : (t('inactive') || 'Inactive')}</span></td>
                      <td className="px-4 py-3 text-center">{user.otp_enabled ? <span className="badge-green text-xs">{tr('enabled', 'Enabled')}</span> : <span className="text-xs text-gray-400">{tr('off', 'Off')}</span>}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(user.created_at)}</td>
                      <td className="px-3 py-2 text-center" onClick={(event) => event.stopPropagation()}>
                        <ShiftHistoryPanel userId={user.id} compact label={tr('shift_code', 'Shift')} />
                      </td>
                      <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <ThreeDot
                          canManage={canManageTargetUser(user)}
                          onDetails={() => { setSelectedUser(user); setModal('userDetail') }}
                          onEdit={() => openEditUser(user)}
                          onResetPw={() => {
                            setSelectedUser(user)
                            setPasswordForm(EMPTY_PASSWORD_FORM)
                            setModal('resetPw')
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 sm:hidden">
            {loading && !users.length ? <UsersMobileSkeletonCards /> : null}
            {(!loading || users.length) ? filteredUsers.map((user) => (
              <div key={user.id} className="card flex items-center gap-3 p-3" onClick={() => { setSelectedUser(user); setModal('userDetail') }}>
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                  <UserAvatarImage src={user.avatar_path} alt={user.name} className="h-10 w-10 object-cover" fallback={(user.name?.[0]?.toUpperCase() || 'U')} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="detail-scroll-text font-semibold text-gray-900 dark:text-white">{user.name}</div>
                  <div className="detail-scroll-text text-xs text-gray-500 dark:text-gray-400">{user.email || user.phone || `@${user.username}`}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {user.role_name ? <span className="badge-blue text-xs">{user.role_name}</span> : <span className="text-xs text-gray-400">{t('no_role') || 'No role'}</span>}
                    <span className={user.is_active ? 'badge-green text-xs' : 'badge-red text-xs'}>{user.is_active ? (t('active') || 'Active') : (t('inactive') || 'Inactive')}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <ShiftHistoryPanel userId={user.id} compact label={tr('shift_code', 'Shift')} />
                  <ThreeDot
                    canManage={canManageTargetUser(user)}
                    onDetails={() => { setSelectedUser(user); setModal('userDetail') }}
                    onEdit={() => openEditUser(user)}
                    onResetPw={() => {
                      setSelectedUser(user)
                      setPasswordForm(EMPTY_PASSWORD_FORM)
                      setModal('resetPw')
                    }}
                  />
                </div>
              </div>
            )) : null}
          </div>
        </>
      ) : tab === 'roles' ? (
        <div className="space-y-3">
          {rolesLoading && !roles.length ? (
            <div className="card p-4 text-sm text-gray-500 dark:text-gray-400">{tr('loading', 'Loading...')}</div>
          ) : null}
          {filteredRoles.map((role) => {
            const assignedCount = assignedCounts.get(Number(role.id)) ?? 0
            const editable = canManage && !role.is_system
            const blockedLabel = tr('role_delete_blocked', '{n} people still use this role').replace('{n}', String(assignedCount))
            const peopleLabel = tr('role_people_count', '{n} people').replace('{n}', String(assignedCount))
            const editLabel = t('edit') || 'Edit'
            const deleteLabel = t('delete') || 'Delete'
            return (
              <div key={role.id} className={`card p-3 ${editable ? 'cursor-pointer' : ''}`} onClick={editable ? () => openEditRole(role) : undefined}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="min-w-0 break-words text-base font-semibold leading-relaxed text-gray-900 dark:text-white">{role.name}</span>
                  {String(role.code ?? '').trim().toLowerCase() === 'admin' ? <span className="badge-blue text-xs">{tr('role_admin_badge', 'Admin')}</span> : null}
                  {resettableRoleCode(role) ? <span className="badge-green text-xs">{tr('default_label', 'Default')}</span> : null}
                  <button
                    type="button"
                    className="inline-flex h-7 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-[44px]"
                    title={peopleLabel}
                    aria-label={peopleLabel}
                    onClick={(event) => { event.stopPropagation(); showRoleUsers(role) }}
                  >
                    <UsersIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {assignedCount}
                  </button>
                  <div className="order-last w-full sm:order-none sm:w-auto"><RoleTierStrip permissions={role.permissions} tr={tr} /></div>
                  {canManage ? (
                    <div className="ml-auto flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className={ICON_BUTTON_CLASS} title={editLabel} aria-label={editLabel} onClick={() => openEditRole(role)} disabled={Boolean(role.is_system)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {!role.is_system ? (
                        // A disabled button swallows hover in some browsers, so the reason rides the wrapper too.
                        <span className="inline-flex" title={assignedCount > 0 ? blockedLabel : undefined}>
                          <button
                            type="button"
                            className={ICON_BUTTON_DANGER_CLASS}
                            title={assignedCount > 0 ? blockedLabel : deleteLabel}
                            aria-label={assignedCount > 0 ? blockedLabel : deleteLabel}
                            onClick={() => handleDeleteRole(role)}
                            disabled={deletingRoleId === role.id || assignedCount > 0}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
          {!rolesLoading && roles.length > 0 && filteredRoles.length === 0 ? (
            <div className="card p-4 text-sm text-gray-500 dark:text-gray-400">{t('no_data') || 'No data'}</div>
          ) : null}
        </div>
      ) : null}

      {tab === 'devices' && canManage ? <DeviceApprovals t={t} notify={notify} /> : null}

      {modal === 'userDetail' && selectedUser ? (
        <Suspense fallback={null}>
          <LazyUserDetailSheet
            user={selectedUser}
            roles={roles}
            canManage={canManageTargetUser(selectedUser)}
            t={t}
            onEdit={() => openEditUser(selectedUser)}
            onResetPw={() => {
              setPasswordForm(EMPTY_PASSWORD_FORM)
              setModal('resetPw')
            }}
            canRecoverOtp={canManageTargetUser(selectedUser)
              && Number(selectedUser.id) !== Number(currentUser?.id)
              && Boolean(selectedUser.otp_enabled)}
            onRecoverOtp={() => {
              setOtpRecoveryTarget(selectedUser)
              setModal(null)
            }}
            onClose={() => { setModal(null); setSelectedUser(null) }}
          />
        </Suspense>
      ) : null}

      {modal === 'editUser' ? (
        <Modal title={selectedUser ? `${tr('edit_user', 'Edit User')}: ${selectedUser.name}` : tr('add_user', 'Add user')} onClose={() => setModal(null)} wide unsavedChanges={{ dirty: userFormDirty }}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('full_name', 'Full name')}</label>
                <input id="user-name" name="name" autoComplete="name" className="input" value={userForm.name} onChange={(e) => setUserForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('username', 'Username')}</label>
                <input id="user-username" name="new_user_username" autoComplete="off" data-1p-ignore="true" data-lpignore="true" data-bwignore="true" className="input" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('phone', 'Phone')}</label>
                <input id="user-phone" name="phone" autoComplete="tel" className="input" value={userForm.phone} onChange={(e) => setUserForm((prev) => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('email', 'Email')}</label>
                <input id="user-email" name="email" type="email" autoComplete="email" className="input" value={userForm.email} onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))} />
              </div>
            </div>
            <div>
              <label htmlFor="user-avatar" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('avatar_image', 'Avatar image')}</label>
              <input id="user-avatar" name="avatar_path" autoComplete="off" className="input" placeholder={tr('avatar_upload_note', 'Use My Profile to upload an image')} value={userForm.avatar_path} onChange={(e) => setUserForm((prev) => ({ ...prev, avatar_path: e.target.value }))} />
            </div>
            {!selectedUser ? (
              <NewPasswordFields
                tr={tr}
                idPrefix="new-user-password"
                mode="other-user"
                password={userForm.password}
                confirm={userForm.passwordConfirm}
                onPasswordChange={(password) => setUserForm((prev) => ({ ...prev, password }))}
                onConfirmChange={(passwordConfirm) => setUserForm((prev) => ({ ...prev, passwordConfirm }))}
                identity={{ username: userForm.username, name: userForm.name, phone: userForm.phone }}
                inputClassName="input"
                layout="columns"
              />
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="user-role" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('role', 'Role')}</label>
                <AppSelect
                  id="user-role"
                  name="role_id"
                  value={userForm.role_id || ''}
                  onChange={(nextValue) => setUserForm((prev) => ({ ...prev, role_id: nextValue }))}
                  ariaLabel={tr('role', 'Role')}
                  className="w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[12rem]"
                  options={[
                    ...(selectedUser ? [{ value: '', label: t('no_role') || 'No role' }] : [{ value: '', label: tr('choose_role', 'Choose a role') }]),
                    ...roles.map((role) => ({ value: role.id, label: role.name || String(role.id) })),
                  ]}
                />
              </div>
              <div>
                <label htmlFor="user-status" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('status', 'Status')}</label>
                <AppSelect
                  id="user-status"
                  name="is_active"
                  value={userForm.is_active}
                  onChange={(nextValue) => setUserForm((prev) => ({ ...prev, is_active: Number(nextValue) }))}
                  ariaLabel={tr('status', 'Status')}
                  className="w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[10rem]"
                  options={[
                    { value: 1, label: t('active') || 'Active' },
                    { value: 0, label: t('inactive') || 'Inactive' },
                  ]}
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" className={MAIN_ACTION_BUTTON_CLASS} onClick={handleSaveUser} disabled={saving}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? (t('loading') || 'Saving...') : (t('save') || 'Save')}
              </button>
            </div>
          </div>
          {userConfirmOpen ? (
            userFormRenamesUser ? (
              <ConfirmDialog
                t={t}
                title={tr('rename_user_choice_title', 'Rename this user?')}
                message={userForm.name.trim()}
                items={buildUserReviewItems()}
                note={tr('rename_user_history_note', 'Point-in-time audit history keeps the old name either way.')}
                confirmLabel={tr('rename_user_carry', 'Rename and update linked records')}
                cancelLabel={t('cancel') || 'Cancel'}
                working={saving}
                workingLabel={t('loading') || 'Saving...'}
                onConfirm={() => { void commitSaveUser('carry') }}
                onClose={() => { if (!saving) setUserConfirmOpen(false) }}
              >
                <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                  <p>{tr('rename_user_carry_desc', 'Live sales, returns, stock movements, transfers and other screens that show this user name switch to the new name.')}</p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => { void commitSaveUser('record_only') }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/40"
                  >
                    {tr('rename_user_record_only', 'Rename this user only')}
                    <span className="mt-0.5 block text-xs font-normal text-gray-500 dark:text-gray-400">{tr('rename_user_record_only_desc', 'Only the account changes; records that already show the old name keep it.')}</span>
                  </button>
                </div>
              </ConfirmDialog>
            ) : (
              <ConfirmDialog
                t={t}
                title={selectedUser ? tr('edit_user', 'Edit User') : tr('add_user', 'Add User')}
                message={userForm.name.trim()}
                items={buildUserReviewItems()}
                confirmLabel={selectedUser ? (t('save') || 'Save') : tr('add_user', 'Add User')}
                cancelLabel={t('cancel') || 'Cancel'}
                working={saving}
                workingLabel={t('loading') || 'Saving...'}
                onConfirm={() => { void commitSaveUser() }}
                onClose={() => { if (!saving) setUserConfirmOpen(false) }}
              />
            )
          ) : null}
        </Modal>
      ) : null}

      {roleDeleteTarget ? (
        <ConfirmDialog
          t={t}
          title={tr('delete_role_title', 'Delete role?')}
          message={roleDeleteTarget.name}
          danger
          confirmLabel={t('delete') || 'Delete'}
          cancelLabel={t('cancel') || 'Cancel'}
          working={deletingRoleId != null}
          workingLabel={t('loading') || 'Deleting...'}
          onConfirm={() => { void commitDeleteRole(roleDeleteTarget) }}
          onClose={() => { if (deletingRoleId == null) setRoleDeleteTarget(null) }}
        />
      ) : null}

      {roleConfirmOpen && modal === 'editRole' ? (
        <ConfirmDialog
          t={t}
          title={tr('role_review_title', 'Review role changes')}
          message={roleForm.name.trim()}
          items={buildRoleReviewItems()}
          note={roleAssignedCount > 0 ? tr('role_review_applies_now', 'Applies right away to {n} people with this role.').replace('{n}', String(roleAssignedCount)) : undefined}
          confirmLabel={t('save') || 'Save'}
          cancelLabel={t('cancel') || 'Cancel'}
          working={saving}
          workingLabel={t('loading') || 'Saving...'}
          onConfirm={() => { void commitSaveRole() }}
          onClose={() => { if (!saving) setRoleConfirmOpen(false) }}
        />
      ) : null}

      {modal === 'resetPw' && selectedUser ? (
        <Modal title={`${tr('change_password', 'Change password')}: ${selectedUser.name}`} onClose={() => setModal(null)} closeDisabled={passwordSaving} unsavedChanges={{ dirty: passwordFormDirty }}>
          {passwordHandover && sameUserId(passwordHandover.userId, selectedUser.id) ? (
            <PasswordHandover tr={tr} name={passwordHandover.name} password={passwordHandover.password} onDone={() => setModal(null)} />
          ) : isCurrentAccount(selectedUser) ? (
            <OwnPasswordChangeForm tr={tr} target={selectedUser} form={passwordForm} setForm={setPasswordForm} passwordSaving={passwordSaving} onSave={() => { void handleResetPassword() }} />
          ) : (
            <AdminPasswordResetForm tr={tr} target={selectedUser} form={passwordForm} setForm={setPasswordForm} passwordSaving={passwordSaving} onSave={() => { void handleResetPassword() }} />
          )}
        </Modal>
      ) : null}

      {modal === 'editRole' ? (
        <Modal
          title={selectedRole ? `${tr('edit_role', 'Edit role')}: ${selectedRole.name}` : tr('create_role', 'Create role')}
          onClose={() => setModal(null)}
          wide
          unsavedChanges={{ dirty: roleFormDirty }}
          onMinimize={canMinimizeRoleForm ? preserveRoleForm : undefined}
          headerExtra={canMinimizeRoleForm ? <MinimizeButton tr={(key, fallback) => tr(key, fallback)} onMinimize={preserveRoleForm} disabled={saving} /> : null}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label htmlFor="role-name" className="sr-only">{tr('role_name', 'Role name')}</label>
              <input id="role-name" name="role_name" autoComplete="off" className="input h-10 min-w-0 flex-1 [@media(pointer:coarse)]:h-11" placeholder={tr('role_name', 'Role name')} value={roleForm.name} onChange={(e) => setRoleForm((prev) => ({ ...prev, name: e.target.value }))} />
              {selectedRole ? (
                roleResetCode ? (
                  <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    title={roleResetLabel}
                    aria-label={roleResetLabel}
                    disabled={loadingRoleDefaults || saving}
                    onClick={() => { void handleResetRoleDefaults() }}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null
              ) : (
                // Only offered when creating: a one-click fill of the draft, never a template that stays locked in.
                // It is not shown while editing, so a pick can never overwrite permissions someone already saved.
                <AppSelect
                  id="role-preset"
                  name="role_preset"
                  value={rolePreset}
                  onChange={(key) => {
                    setRolePreset(key)
                    setRoleForm((prev) => ({ ...prev, permissions: { ...(ROLE_PRESETS.find((preset) => preset.key === key)?.permissions ?? {}) } }))
                  }}
                  ariaLabel={tr('role_start_from', 'Start from')}
                  prefix={tr('role_start_from', 'Start from')}
                  className="w-44 shrink-0 sm:w-56"
                  buttonClassName="h-10 w-full [@media(pointer:coarse)]:h-11"
                  menuClassName="min-w-[12rem]"
                  options={[
                    { value: '', label: tr('none', 'None') },
                    ...ROLE_PRESETS.map((preset) => ({ value: preset.key, label: <span title={tr(preset.descriptionKey, preset.description)}>{tr(preset.labelKey, preset.label)}</span> })),
                  ]}
                />
              )}
            </div>
            <Suspense fallback={<div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">{tr('loading', 'Loading...')}</div>}>
              <LazyPermissionEditor permissions={roleForm.permissions} baseline={selectedRole?.permissions} onChange={(permissions) => setRoleForm((prev) => ({ ...prev, permissions }))} t={t} />
            </Suspense>
            {/* Pinned to the bottom of the dialog like the review dialog's buttons, so Save is never three screens away. */}
            <div className="sticky bottom-0 z-30 -mx-3 -mb-3 flex items-center gap-2 border-t border-gray-200 bg-white px-3 pb-3 pt-3 dark:border-gray-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4 sm:pb-4">
              <span className="min-w-0 flex-1 text-xs leading-5 text-gray-500 dark:text-gray-400" role="status">
                {roleChangeRows.length === 1 ? tr('role_change_one', '1 change') : tr('role_changes_count', '{n} changes').replace('{n}', String(roleChangeRows.length))}
              </span>
              <button
                type="button"
                className={ICON_BUTTON_CLASS}
                title={tr('discard_changes', 'Discard changes')}
                aria-label={tr('discard_changes', 'Discard changes')}
                disabled={roleChangeRows.length === 0 || saving}
                onClick={() => setRoleDiscardOpen(true)}
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className={`${MAIN_ACTION_BUTTON_CLASS} [@media(pointer:coarse)]:h-11`} onClick={handleSaveRole} disabled={saving || roleChangeRows.length === 0 || !roleForm.name.trim()}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? (t('loading') || 'Saving...') : (t('save') || 'Save')}
              </button>
            </div>
            <UnsavedChangesPrompt guard={roleDiscardGuard} />
          </div>
        </Modal>
      ) : null}

      {profileOpen ? (
        <Suspense fallback={null}>
          <LazyUserProfileModal onClose={() => setProfileOpen(false)} />
        </Suspense>
      ) : null}
      {otpRecoveryTarget ? (
        <Suspense fallback={null}>
          <LazyOtpModal
            mode="recover"
            userId={otpRecoveryTarget.id}
            targetName={otpRecoveryTarget.name || null}
            targetUsername={otpRecoveryTarget.username || null}
            t={t}
            onClose={() => setOtpRecoveryTarget(null)}
            onDone={() => {
              setUsers((current) => current.map((entry) => Number(entry.id) === Number(otpRecoveryTarget.id)
                ? { ...entry, otp_enabled: false }
                : entry))
              notify(tr('otp_recovery_success', '2FA reset for {name}. They can now sign in with their password and set up 2FA again.').replace('{name}', otpRecoveryTarget.name || otpRecoveryTarget.username || 'the account'))
              setOtpRecoveryTarget(null)
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

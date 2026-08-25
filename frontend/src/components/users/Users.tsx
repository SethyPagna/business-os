import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import CircleUserRound from 'lucide-react/dist/esm/icons/circle-user-round.js'
import UserPlus from 'lucide-react/dist/esm/icons/user-plus.js'
import AppSelect from '../shared/AppSelect.tsx'
import SearchInput from '../shared/SearchInput'
import FilterMenu from '../shared/FilterMenu'
import Modal from '../shared/Modal'
import PortalMenu, { type PortalMenuItem } from '../shared/PortalMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar'
import { fmtDate } from '../../utils/formatters'
import { useApp as useAppHook, useSync as useSyncHook } from '../../AppContext.tsx'
import { PERMISSION_DEFS } from './permissionDefinitions'
import { ROLE_PRESETS } from './rolePresetDefaults'
import { REVIEW_TIER_KEYS, type PermissionValue } from '../../utils/permissions.ts'
import { useIsPageActive } from '../shared/pageActivity'
import { APP_NAVIGATION_EVENT } from '../../app/pathRouting.ts'
import { useActionHistory } from '../../utils/actionHistory.ts'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import DeviceApprovals from './DeviceApprovals.tsx'
import {
  changeUserPassword as changeUserPasswordRequest,
  createRole as createRoleRequest,
  createUser as createUserRequest,
  deleteRole as deleteRoleRequest,
  getRoles as getRolesRequest,
  getUsers as getUsersRequest,
  updateRole as updateRoleRequest,
  updateUser as updateUserRequest,
} from '../../api/userAdminTransport.ts'

type EntityId = number | string
type UsersTab = 'users' | 'roles' | 'devices'
type UsersModal = 'editUser' | 'editRole' | 'resetPw' | 'userDetail' | null
type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void
type PermissionState = Record<string, PermissionValue>

interface CurrentUser {
  id?: EntityId | null
  name?: string | null
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
}

interface RoleRecord extends Record<string, unknown> {
  id: EntityId
  name?: string
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

interface MutationResult {
  success?: boolean
  error?: string
  id?: EntityId
  data?: { id?: EntityId } | null
  item?: { id?: EntityId } | null
}

type UserWritePayload = Record<string, unknown> & {
  name: string
  username: string
  phone: string
  email: string
  avatar_path: string
  role_id: EntityId | null
  is_active: boolean | number
}

interface UsersApi {
  getUsers: () => Promise<unknown>
  getRoles: () => Promise<unknown>
  createUser: (payload: UserWritePayload & { password: string }) => Promise<MutationResult>
  updateUser: (id: EntityId, payload: UserWritePayload) => Promise<MutationResult>
  changeUserPassword: (id: EntityId, payload: Record<string, unknown>) => Promise<MutationResult>
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

// Preserves the 'review' tier value for REVIEW_TIER_KEYS sections instead
// of collapsing it to a plain boolean -- normalizePermissionState used to
// run every value through Boolean(enabled), which silently turned a
// hand-set 'review' string (e.g. on 'fees', set directly in the DB since
// this editor didn't offer a tier picker yet) into `true` the moment a
// role was opened for editing, so saving ANY unrelated change to that
// role (renaming it, touching a different permission) would silently
// upgrade Review Required to Full Access. Every other key keeps the old
// strict-boolean behavior; only a REVIEW_TIER_KEYS key preserves the
// literal string 'review', matching the backend's own strict
// interpretation in getPermissionTier() (a 'review' string on any other
// key is never valid and still collapses to boolean).
function normalizePermissionState(value: unknown): PermissionState {
  if (typeof value === 'string') {
    try {
      return normalizePermissionState(JSON.parse(value || '{}'))
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<PermissionState>((permissions, [key, enabled]) => {
    if (enabled === 'review' && REVIEW_TIER_KEYS.has(key)) {
      permissions[key] = 'review'
    } else {
      permissions[key] = Boolean(enabled)
    }
    return permissions
  }, {})
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
      trigger={<button className="three-dot-btn" type="button">...</button>}
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
  role_id: '',
  is_active: 1,
}

const INITIAL_ROLE_FORM: RoleFormState = {
  name: '',
  permissions: {},
}
const LazyPermissionEditor = lazyRetry(async () => ({ default: (await import('./PermissionEditor')).default }), 'users-permission-editor')
const LazyUserDetailSheet = lazyRetry(async () => ({ default: (await import('./UserDetailSheet')).default }), 'users-user-detail-sheet')
const LazyUserProfileModal = lazyRetry(async () => ({ default: (await import('./UserProfileModal')).default }), 'users-user-profile-modal')
const USERS_LIST_TIMEOUT_MS = 8000
const ROLES_LIST_TIMEOUT_MS = 8000
const USER_MUTATION_TIMEOUT_MS = 12000
const ROLE_MUTATION_TIMEOUT_MS = 12000
const USERS_SECONDARY_READ_DELAY_MS = 2500
const USERS_SECONDARY_READ_IDLE_TIMEOUT_MS = 5000

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
  const { t, notify, hasPermission, user: currentUser } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('users')
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
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [tab, setTab] = useState<UsersTab>('users')
  const [modal, setModal] = useState<UsersModal>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null)
  const [search, setSearch] = useState('')
  // Role/Status filter -- Users was the one remaining list page with a
  // search box but no FilterMenu at all (found during the Part 124
  // cross-page consistency audit; every other list page in the app has
  // one). Mirrors Branches.tsx's status-filter pattern exactly (same
  // 'all'/'active'/'inactive' values, same FilterMenu section shape).
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [userForm, setUserForm] = useState<UserFormState>(INITIAL_USER_FORM)
  const [roleForm, setRoleForm] = useState<RoleFormState>(INITIAL_ROLE_FORM)
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [saving, setSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [deletingRoleId, setDeletingRoleId] = useState<EntityId | null>(null)
  const saveUserInFlightRef = useRef(false)
  const passwordInFlightRef = useRef(false)
  const saveRoleInFlightRef = useRef(false)
  const deleteRoleInFlightRef = useRef(false)
  const [profileOpen, setProfileOpen] = useState(false)
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
   * 2.2 `canManageTargetUser` blocks peer-admin edits while preserving self actions.
   */
  const canManage = hasPermission('all')
  const canManageTargetUser = (targetUser: UserRecord | null | undefined): boolean => {
    if (!canManage || !targetUser) return false
    if (Number(targetUser.id) === Number(currentUser?.id)) return true
    return !targetUser.has_admin_access
  }

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
    return users.filter((user) => {
      if (query && !`${user.name} ${user.username} ${user.phone || ''} ${user.email || ''} ${user.role_name || ''}`.toLowerCase().includes(query)) return false
      if (roleFilter !== 'all' && String(user.role_id ?? '') !== roleFilter) return false
      if (statusFilter !== 'all' && Boolean(user.is_active) !== (statusFilter === 'active')) return false
      return true
    })
  }, [search, users, roleFilter, statusFilter])
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
    if (!canManageTargetUser(user)) return notify(tr('cannot_manage_admin_account', 'You cannot modify another admin account.'), 'error')
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
      role_id: user.role_id || '',
      is_active: user.is_active ? 1 : 0,
    })
    setModal('editUser')
  }

  const openCreateRole = () => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    setSelectedRole(null)
    setRoleForm(INITIAL_ROLE_FORM)
    setModal('editRole')
  }

  const openEditRole = (role: RoleRecord): void => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    setSelectedRole(role)
    setRoleForm({
      name: role.name || '',
      permissions: normalizePermissionState(role.permissions),
    })
    setModal('editRole')
  }

  const getRolePermissions = (role: RoleRecord | null | undefined): string[] => {
    const value = normalizePermissionState(role?.permissions)
    return Object.keys(value).filter((key) => value[key])
  }

  const getRolePermissionValue = (role: RoleRecord | null | undefined, key: string): PermissionValue => {
    const value = normalizePermissionState(role?.permissions)
    return value[key] ?? false
  }

  const getPermissionSummary = (role: RoleRecord): string => {
    const value = normalizePermissionState(role?.permissions)
    const keys = Object.keys(value).filter((key) => value[key])
    if (!keys.length) return tr('no_permissions', 'No permissions')
    if (keys.includes('all')) return tr('full_access', 'Full access')
    return keys
      .map((key) => {
        const perm = PERMISSION_DEFS.find((item) => item.key === key)
        const label = tr(perm?.tKey || key, perm?.label || key)
        return value[key] === 'review' ? `${label} (${tr('review_required', 'Partial Access')})` : label
      })
      .join(', ')
  }

  const buildUserWritePayload = useCallback((account: Partial<UserRecord> = {}, overrides: Partial<UserRecord> & { delete_user?: boolean | number } = {}): UserWritePayload => ({
    name: String(overrides.name ?? account.name ?? '').trim(),
    username: String(overrides.username ?? account.username ?? '').trim(),
    phone: String(overrides.phone ?? account.phone ?? '').trim(),
    email: String(overrides.email ?? account.email ?? '').trim(),
    avatar_path: String(overrides.avatar_path ?? account.avatar_path ?? '').trim(),
    role_id: overrides.role_id ?? account.role_id ?? null,
    is_active: overrides.is_active ?? account.is_active ?? 1,
    userId: currentUser?.id,
    userName: currentUser?.name,
    ...(overrides.delete_user ? { delete_user: 1 } : {}),
  }), [currentUser?.id, currentUser?.name])

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
    if (!selectedUser && !userForm.password.trim()) {
      notify(tr('password_required_new_user', 'Password is required for new users'), 'error')
      return
    }
    if (selectedUser && !canManageTargetUser(selectedUser)) {
      notify(tr('cannot_manage_admin_account', 'You cannot modify another admin account.'), 'error')
      return
    }
    if (!selectedUser && !userForm.role_id) {
      notify(tr('role_required_new_user', 'Choose a role for the new user'), 'error')
      return
    }
    if (!beginSingleAction(saveUserInFlightRef, { blocked: saving })) return

    setSaving(true)
    try {
      const payload = {
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
      }

      const result = selectedUser
        ? await runUserMutation(() => getUsersApi().updateUser(selectedUser.id, payload), 'Update user')
        : await runUserMutation(() => getUsersApi().createUser({ ...payload, password: userForm.password }), 'Create user')

      if (result?.success === false) {
        notify(result.error || 'Failed to save user', 'error')
        return
      }

      if (selectedUser) {
        const previousSnapshot = cloneHistorySnapshot(selectedUser)
        const nextSnapshot = cloneHistorySnapshot({ ...selectedUser, ...payload, id: selectedUser.id })
        actionHistory.pushAction({
          label: `Edit user ${previousSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const undoResult = await runUserMutation(() => getUsersApi().updateUser(previousSnapshot.id, buildUserWritePayload(previousSnapshot)), 'Undo user update')
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore user')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await runUserMutation(() => getUsersApi().updateUser(nextSnapshot.id, buildUserWritePayload(nextSnapshot)), 'Redo user update')
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply user changes')
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
      notify(getErrorMessage(error, 'Failed to save user'), 'error')
    } finally {
      finishSingleAction(saveUserInFlightRef)
      setSaving(false)
    }
  }

  const handleResetPassword = async () => {
    if (!selectedUser?.id) return
    if (!canManageTargetUser(selectedUser)) {
      notify(tr('cannot_manage_admin_account', 'You cannot modify another admin account.'), 'error')
      return
    }
    const currentPassword = String(passwordForm.currentPassword || '')
    const newPassword = String(passwordForm.newPassword || '')
    const confirmPassword = String(passwordForm.confirmPassword || '')
    const allowAdminOverride = Number(selectedUser.id) !== Number(currentUser?.id) && canManageTargetUser(selectedUser)

    if (!newPassword.trim()) {
      notify(tr('enter_new_password', 'Enter new password'), 'error')
      return
    }
    if (newPassword.length < 6) {
      notify(tr('password_min_6', 'Use at least 6 characters for the new password.'), 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      notify(tr('new_password_confirm_mismatch', 'New password confirmation does not match'), 'error')
      return
    }
    if (!allowAdminOverride && !currentPassword.trim()) {
      notify(tr('current_password_required_change', 'Current password is required to change password'), 'error')
      return
    }
    if (!beginSingleAction(passwordInFlightRef, { blocked: passwordSaving })) return

    setPasswordSaving(true)
    try {
      const result = await runUserMutation(() => getUsersApi().changeUserPassword(selectedUser.id, {
        currentPassword: allowAdminOverride ? undefined : currentPassword,
        newPassword,
        adminOverride: allowAdminOverride,
        userId: currentUser?.id,
        userName: currentUser?.name,
      }), 'Change user password')
      if (result?.success === false) {
        notify(result.error || 'Failed to change password', 'error')
        return
      }
      notify(tr('password_updated', 'Password updated'), 'success')
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
      setModal(null)
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to change password'), 'error')
    } finally {
      finishSingleAction(passwordInFlightRef)
      setPasswordSaving(false)
    }
  }

  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) {
      notify(tr('role_name_required', 'Role name is required'), 'error')
      return
    }
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
        notify(result.error || 'Failed to save role', 'error')
        return
      }

      if (selectedRole) {
        const previousSnapshot = cloneHistorySnapshot(selectedRole)
        const nextSnapshot = cloneHistorySnapshot({ ...selectedRole, ...payload, id: selectedRole.id })
        actionHistory.pushAction({
          label: `Edit role ${previousSnapshot.name || nextSnapshot.name || ''}`.trim(),
          undo: async () => {
            const undoResult = await runRoleMutation(() => getUsersApi().updateRole(previousSnapshot.id, buildRoleWritePayload(previousSnapshot)), 'Undo role update')
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore role')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await runRoleMutation(() => getUsersApi().updateRole(nextSnapshot.id, buildRoleWritePayload(nextSnapshot)), 'Redo role update')
            if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to reapply role changes')
            await load({ silent: true })
          },
        })
      } else {
        let createdRoleId = extractHistoryResultId(result)
        const createdSnapshot = cloneHistorySnapshot({ ...payload, id: createdRoleId })
        if (createdRoleId > 0) {
          actionHistory.pushAction({
            label: `Add role ${createdSnapshot.name || ''}`.trim(),
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
      notify(getErrorMessage(error, 'Failed to save role'), 'error')
    } finally {
      finishSingleAction(saveRoleInFlightRef)
      setSaving(false)
    }
  }

  const handleDeleteRole = async (role: RoleRecord): Promise<void> => {
    if (!canManage) return notify('No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    const assignedCount = users.filter((user) => Number(user.role_id) === Number(role.id)).length
    if (assignedCount > 0) {
      notify(tr('users_assigned_count', '{n} user(s) still assigned').replace('{n}', String(assignedCount)), 'error')
      return
    }
    if (!beginSingleAction(deleteRoleInFlightRef, { blocked: deletingRoleId != null, value: role.id })) return
    if (!window.confirm(`Delete role "${role.name}"?`)) {
      finishSingleAction(deleteRoleInFlightRef)
      return
    }

    setDeletingRoleId(role.id)
    try {
      const snapshot = cloneHistorySnapshot(role)
      const result = await runRoleMutation(() => getUsersApi().deleteRole(role.id, {
        userId: currentUser?.id,
        userName: currentUser?.name,
      }), 'Delete role')
      if (result?.success === false) {
        notify(result.error || 'Failed to delete role', 'error')
        return
      }
      let restoredRoleId = 0
      actionHistory.pushAction({
        label: `Delete role ${snapshot.name || ''}`.trim(),
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

      {/* Toolbar + search row pin to the top of the page's scroll container
          while scrolling -- same `sticky top-2` treatment as
          Products/Inventory/Sales/Returns/Branches/Contacts/AuditLog. This
          page was the one remaining list page without it (found during a
          ripple-consistency audit); grouped into the same single sticky
          wrapper those pages use rather than two independently-sticky
          siblings. History (bundles Undo/Redo) and the primary Add/Create
          action still each take an equal share of the toolbar row's full
          width (flex-1, labels always visible) -- previously only
          History's wrapper grew to fill the row while the small icon
          button inside it stayed put, so a wide invisible History control
          sat crowded right up against Add User/Create role with barely
          any visual gap. Search box stays on its own line below so it
          always gets full width to breathe. */}
      <div className="sticky top-2 z-30 -mx-1 space-y-2 bg-gray-50/95 pb-2 backdrop-blur dark:bg-gray-900/95 sm:mx-0">
        <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pt-1">
          <ActionHistoryBar history={actionHistory} t={t} className="min-w-0 flex-1" showLabel />
          {tab === 'users' && canManage ? <button type="button" className="btn-primary inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-xs sm:text-sm" onClick={openCreateUser}><UserPlus className="h-4 w-4 shrink-0" /><span className="truncate">{t('add_user') || 'Add user'}</span></button> : null}
          {tab === 'roles' && canManage ? <button type="button" className="btn-primary inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-xs sm:text-sm" onClick={openCreateRole}><span className="truncate">{t('create_role') || 'Create role'}</span></button> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            id="users-search"
            name="users_search"
            value={search}
            onChange={setSearch}
            placeholder={tr('search_users_placeholder', 'Search users, phone, email, or role')}
          />
          {/* Filter only applies to the users list (role_id/is_active
              columns) -- the roles tab renders `roles` directly with no
              filtering of its own, so the trigger stays hidden there
              rather than sitting inert. */}
          {tab === 'users' ? (
            <FilterMenu
              label={tr('filters', 'Filters')}
              activeCount={userFilterActiveCount}
              sections={userFilterSections}
              onClear={userFilterActiveCount > 0 ? clearUserFilters : null}
              mobileIconOnly
            />
          ) : null}
        </div>
      </div>

      {loadError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          {loadError}
        </div>
      ) : null}

      {tab === 'users' ? (
        <>
          <div className="card hidden flex-col overflow-hidden sm:flex">
            <div className="overflow-auto">
              <table className="w-full min-w-[980px] text-sm table-bordered">
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
                    <th className="w-10 px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {loading && !users.length ? (
                    <UsersDesktopSkeletonRows />
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">{t('no_data') || 'No data'}</td>
                    </tr>
                  ) : filteredUsers.map((user) => (
                    <tr key={user.id} className="table-row cursor-pointer" onClick={() => { setSelectedUser(user); setModal('userDetail') }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                            {user.avatar_path ? <img src={user.avatar_path} alt={user.name} className="h-9 w-9 object-cover" /> : (user.name?.[0]?.toUpperCase() || 'U')}
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
                      <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <ThreeDot
                          canManage={canManageTargetUser(user)}
                          onDetails={() => { setSelectedUser(user); setModal('userDetail') }}
                          onEdit={() => openEditUser(user)}
                          onResetPw={() => {
                            setSelectedUser(user)
                            setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
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
                  {user.avatar_path ? <img src={user.avatar_path} alt={user.name} className="h-10 w-10 object-cover" /> : (user.name?.[0]?.toUpperCase() || 'U')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900 dark:text-white">{user.name}</div>
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">{user.email || user.phone || `@${user.username}`}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {user.role_name ? <span className="badge-blue text-xs">{user.role_name}</span> : <span className="text-xs text-gray-400">{t('no_role') || 'No role'}</span>}
                    <span className={user.is_active ? 'badge-green text-xs' : 'badge-red text-xs'}>{user.is_active ? (t('active') || 'Active') : (t('inactive') || 'Inactive')}</span>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <ThreeDot
                    canManage={canManageTargetUser(user)}
                    onDetails={() => { setSelectedUser(user); setModal('userDetail') }}
                    onEdit={() => openEditUser(user)}
                    onResetPw={() => {
                      setSelectedUser(user)
                      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
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
          {roles.map((role) => {
            const assignedCount = users.filter((user) => Number(user.role_id) === Number(role.id)).length
            const permissionKeys = getRolePermissions(role)
            return (
              <div key={role.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-gray-900 dark:text-white">{role.name}</span>
                      {role.is_system ? <span className="badge-blue text-xs">{tr('system_role', 'System')}</span> : <span className="badge-green text-xs">{tr('custom_role', 'Custom')}</span>}
                      <span className="text-xs text-gray-400">{tr('users_assigned_count', '{n} user(s) still assigned').replace('{n}', String(assignedCount))}</span>
                    </div>
                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{getPermissionSummary(role)}</p>
                    <div className="flex flex-wrap gap-1">
                      {permissionKeys.length === 0 ? <span className="text-xs italic text-gray-400">{tr('no_permissions', 'No permissions')}</span> : null}
                      {permissionKeys.map((key) => (
                        <span key={key} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {PERMISSION_DEFS.find((item) => item.key === key)?.label || key}
                          {getRolePermissionValue(role, key) === 'review' ? ` (${tr('review_required', 'Partial Access')})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => openEditRole(role)} disabled={Boolean(role.is_system)}>{t('edit') || 'Edit'}</button>
                      {!role.is_system ? <button type="button" className="btn-danger px-3 py-1 text-xs" onClick={() => handleDeleteRole(role)} disabled={deletingRoleId === role.id}>{deletingRoleId === role.id ? (t('loading') || 'Deleting...') : (t('delete') || 'Delete')}</button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
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
              setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
              setModal('resetPw')
            }}
            onClose={() => { setModal(null); setSelectedUser(null) }}
          />
        </Suspense>
      ) : null}

      {modal === 'editUser' ? (
        <Modal title={selectedUser ? `${tr('edit_user', 'Edit User')}: ${selectedUser.name}` : tr('add_user', 'Add user')} onClose={() => setModal(null)} wide>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('full_name', 'Full name')}</label>
                <input id="user-name" name="name" autoComplete="name" className="input" value={userForm.name} onChange={(e) => setUserForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('username', 'Username')}</label>
                <input id="user-username" name="username" autoComplete="username" className="input" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
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
              <div>
                <label htmlFor="user-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('password', 'Password')}</label>
                <input id="user-password" name="password" type="password" autoComplete="new-password" className="input" value={userForm.password} onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))} />
              </div>
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
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('cancel') || 'Cancel'}</button>
              <button type="button" className="btn-primary" onClick={handleSaveUser} disabled={saving}>{saving ? (t('loading') || 'Saving...') : (t('save') || 'Save')}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === 'resetPw' && selectedUser ? (
        <Modal title={`${tr('change_password', 'Change password')}: ${selectedUser.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            {Number(selectedUser.id) === Number(currentUser?.id) ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                {tr('current_password_required_change', 'Current password is required to change password')}
              </div>
            ) : null}
            {Number(selectedUser.id) !== Number(currentUser?.id) && canManageTargetUser(selectedUser) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                {tr('admin_password_override_note', 'Current password can be left blank when an administrator updates another non-admin account.')}
              </div>
            ) : null}
            <div>
              <label htmlFor="reset-password-current" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('current_password', 'Current password')}</label>
              <input
                id="reset-password-current"
                name="current_password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="reset-password-new" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('new_password', 'New password')}</label>
              <input
                id="reset-password-new"
                name="new_password"
                type="password"
                autoComplete="new-password"
                className="input"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="reset-password-confirm" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('confirm_new_password', 'Confirm new password')}</label>
              <input
                id="reset-password-confirm"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                className="input"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('cancel') || 'Cancel'}</button>
              <button type="button" className="btn-primary" onClick={handleResetPassword} disabled={passwordSaving}>{passwordSaving ? (t('loading') || 'Saving...') : tr('change_password', 'Change password')}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === 'editRole' ? (
        <Modal title={selectedRole ? `${tr('edit_role', 'Edit role')}: ${selectedRole.name}` : tr('create_role', 'Create role')} onClose={() => setModal(null)} wide>
          <div className="space-y-4">
            <div>
              <label htmlFor="role-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('role_name', 'Role name')}</label>
              <input id="role-name" name="role_name" autoComplete="off" className="input" value={roleForm.name} onChange={(e) => setRoleForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            {!selectedRole ? (
              // Only offered when creating a brand-new role -- a one-click
              // fill for roleForm.permissions, not a locked-in template.
              // Never shown while editing an existing role, so a preset
              // click can never silently overwrite hand-tuned permissions
              // someone already saved.
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('role_preset_label', 'Start from a preset (optional)')}</label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      title={tr(preset.descriptionKey, preset.description)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                      onClick={() => setRoleForm((prev) => ({ ...prev, permissions: { ...preset.permissions } }))}
                    >
                      {tr(preset.labelKey, preset.label)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('permissions', 'Permissions')}</label>
              <Suspense fallback={<div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">{tr('loading', 'Loading...')}</div>}>
                <LazyPermissionEditor permissions={roleForm.permissions} onChange={(permissions) => setRoleForm((prev) => ({ ...prev, permissions }))} />
              </Suspense>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              {tr('affected_users_logout_warning', 'Affected users must log out and back in for changes to take effect.')}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('cancel') || 'Cancel'}</button>
              <button type="button" className="btn-primary" onClick={handleSaveRole} disabled={saving}>{saving ? (t('loading') || 'Saving...') : (t('save') || 'Save')}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {profileOpen ? (
        <Suspense fallback={null}>
          <LazyUserProfileModal onClose={() => setProfileOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  )
}

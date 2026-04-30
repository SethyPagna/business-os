import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleUserRound, UserPlus } from 'lucide-react'
import Modal from '../shared/Modal'
import PortalMenu from '../shared/PortalMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { fmtDate } from '../../utils/formatters'
import { useApp, useSync } from '../../AppContext'
import PermissionEditor, { PERMISSION_DEFS } from './PermissionEditor'
import UserDetailSheet from './UserDetailSheet'
import UserProfileModal from './UserProfileModal'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { cloneHistorySnapshot, extractHistoryResultId } from '../../utils/historyHelpers.mjs'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

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
function ThreeDot({ onDetails, onEdit, onResetPw, canManage }) {
  const { t } = useApp()
  const items = [
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

const INITIAL_USER_FORM = {
  name: '',
  username: '',
  phone: '',
  email: '',
  avatar_path: '',
  password: '',
  role_id: '',
  is_active: 1,
}

const INITIAL_ROLE_FORM = {
  name: '',
  permissions: {},
}

/**
 * 1.2.1 Render-safe fallback for nullable contact values.
 */
function formatContactValue(value) {
  const text = String(value || '').trim()
  return text || 'N/A'
}

export default function Users() {
  const { t, notify, hasPermission, user: currentUser, page } = useApp()
  const { syncChannel } = useSync()
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const tr = useCallback((key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }, [t])

  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [tab, setTab] = useState('users')
  const [modal, setModal] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedRole, setSelectedRole] = useState(null)
  const [search, setSearch] = useState('')
  const [userForm, setUserForm] = useState(INITIAL_USER_FORM)
  const [roleForm, setRoleForm] = useState(INITIAL_ROLE_FORM)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [saving, setSaving] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const actionHistory = useActionHistory({ limit: 3, notify })

  /**
   * 2. Authorization Guards
   * 2.1 `canManage` gates admin-only data/actions.
   * 2.2 `canManageTargetUser` blocks peer-admin edits while preserving self actions.
   */
  const canManage = hasPermission('all')
  const canManageTargetUser = (targetUser) => {
    if (!canManage || !targetUser) return false
    if (Number(targetUser.id) === Number(currentUser?.id)) return true
    return !targetUser.has_admin_access
  }

  const syncChannelName = String(syncChannel?.channel || '')
  const syncTimestamp = Number(syncChannel?.ts || 0)

  const load = useCallback(async ({ silent = loadedOnceRef.current } = {}) => {
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
      window.clearTimeout(loadWatchdogRef.current)
      if (!silent || !loadedOnceRef.current) {
        setLoading(true)
        setLoadError(null)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoading(false)
          setLoadError(tr('users_load_slow', 'Users are taking longer than expected. Tap Refresh or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const [usersResult, rolesResult] = await Promise.allSettled([
          withLoaderTimeout(() => window.api.getUsers(), 'Users list', 8000),
          withLoaderTimeout(() => window.api.getRoles(), 'Roles list', 8000),
        ])

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return

        const nextUsers = usersResult.status === 'fulfilled' && Array.isArray(usersResult.value)
          ? usersResult.value
          : null
        const nextRoles = rolesResult.status === 'fulfilled' && Array.isArray(rolesResult.value)
          ? rolesResult.value
          : null

        if (nextUsers) setUsers(nextUsers)
        else if (!loadedOnceRef.current) setUsers([])

        if (nextRoles) setRoles(nextRoles)
        else if (!loadedOnceRef.current) setRoles([])

        if (nextUsers === null && nextRoles === null) {
          const firstError = usersResult.reason || rolesResult.reason
          throw new Error(firstError?.message || tr('users_load_failed', 'Failed to load users'))
        }

        loadedOnceRef.current = true
        setLoadError(null)

        if (usersResult.status === 'rejected') {
          notify(usersResult.reason?.message || tr('users_partial_load_failed', 'User list is still catching up. Roles loaded first.'), 'warning')
        } else if (rolesResult.status === 'rejected') {
          notify(rolesResult.reason?.message || tr('roles_partial_load_failed', 'Roles are still catching up. Users loaded first.'), 'warning')
        }
      } catch (error) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const nextMessage = error?.message || tr('users_load_failed', 'Failed to load users')
        if (!loadedOnceRef.current) {
          setUsers([])
          setRoles([])
          setLoadError(nextMessage)
          notify(nextMessage, 'error')
          loadedOnceRef.current = true
        } else {
          const refreshMessage = tr('users_refresh_failed', 'Unable to refresh users right now. Showing the latest loaded data.')
          setLoadError((current) => current || refreshMessage)
          notify(refreshMessage, 'warning')
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
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
    if (page !== 'users') {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      return
    }
    load({ silent: loadedOnceRef.current })
  }, [canManage, load, page])
  useEffect(() => {
    if (page !== 'users' || !syncChannelName) return
    if (syncChannelName === 'users' || syncChannelName === 'roles') {
      load({ silent: true })
    }
  }, [load, page, syncChannelName, syncTimestamp])
  useEffect(() => () => {
    window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return users
    return users.filter((user) => `${user.name} ${user.username} ${user.phone || ''} ${user.email || ''} ${user.role_name || ''}`.toLowerCase().includes(query))
  }, [search, users])

  /**
   * 3. Modal Openers
   * 3.1 Create/Edit user records.
   * 3.2 Create/Edit role records.
   */
  const openCreateUser = () => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    setSelectedUser(null)
    setUserForm({ ...INITIAL_USER_FORM, role_id: roles[0]?.id || '' })
    setModal('editUser')
  }

  const openEditUser = (user) => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (!canManageTargetUser(user)) return notify(tr('cannot_manage_admin_account', 'You cannot modify another admin account.'), 'error')
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

  const openEditRole = (role) => {
    if (!canManage) return notify(t('no_permission') || 'No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    setSelectedRole(role)
    setRoleForm({
      name: role.name || '',
      permissions: typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {}),
    })
    setModal('editRole')
  }

  const getRolePermissions = (role) => {
    try {
      const value = typeof role?.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role?.permissions || {})
      return Object.keys(value).filter((key) => value[key])
    } catch (_) {
      return []
    }
  }

  const getPermissionSummary = (role) => {
    const keys = getRolePermissions(role)
    if (!keys.length) return tr('no_permissions', 'No permissions')
    if (keys.includes('all')) return tr('full_access', 'Full access')
    return keys
      .map((key) => {
        const perm = PERMISSION_DEFS.find((item) => item.key === key)
        return tr(perm?.tKey || key, perm?.label || key)
      })
      .join(', ')
  }

  const buildUserWritePayload = useCallback((account = {}, overrides = {}) => ({
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

  const buildRoleWritePayload = useCallback((role = {}) => ({
    name: String(role.name || '').trim(),
    permissions: typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {}),
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
        ? await window.api.updateUser(selectedUser.id, payload)
        : await window.api.createUser({ ...payload, password: userForm.password })

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
            const undoResult = await window.api.updateUser(previousSnapshot.id, buildUserWritePayload(previousSnapshot))
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore user')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await window.api.updateUser(nextSnapshot.id, buildUserWritePayload(nextSnapshot))
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
      notify(error?.message || 'Failed to save user', 'error')
    } finally {
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
    if (newPassword.length < 4) {
      notify(tr('new_password_min_length', 'Use at least 4 characters for the new password'), 'error')
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

    try {
      const result = await window.api.changeUserPassword(selectedUser.id, {
        currentPassword: allowAdminOverride ? undefined : currentPassword,
        newPassword,
        adminOverride: allowAdminOverride,
        userId: currentUser?.id,
        userName: currentUser?.name,
      })
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
      notify(error?.message || 'Failed to change password', 'error')
    }
  }

  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) {
      notify(tr('role_name_required', 'Role name is required'), 'error')
      return
    }

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
        ? await window.api.updateRole(selectedRole.id, payload)
        : await window.api.createRole(payload)

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
            const undoResult = await window.api.updateRole(previousSnapshot.id, buildRoleWritePayload(previousSnapshot))
            if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore role')
            await load({ silent: true })
          },
          redo: async () => {
            const redoResult = await window.api.updateRole(nextSnapshot.id, buildRoleWritePayload(nextSnapshot))
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
              const undoResult = await window.api.deleteRole(createdRoleId, { userId: currentUser?.id, userName: currentUser?.name })
              if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to undo role creation')
              await load({ silent: true })
            },
            redo: async () => {
              const redoResult = await window.api.createRole(buildRoleWritePayload(createdSnapshot))
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
      notify(error?.message || 'Failed to save role', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRole = async (role) => {
    if (!canManage) return notify('No permission', 'error')
    if (role?.is_system) return notify(tr('system_role_edit_locked', 'System roles cannot be edited here.'), 'error')
    const assignedCount = users.filter((user) => Number(user.role_id) === Number(role.id)).length
    if (assignedCount > 0) {
      notify(tr('users_assigned_count', '{n} user(s) still assigned').replace('{n}', assignedCount), 'error')
      return
    }
    if (!window.confirm(`Delete role "${role.name}"?`)) return

    try {
      const snapshot = cloneHistorySnapshot(role)
      const result = await window.api.deleteRole(role.id, {
        userId: currentUser?.id,
        userName: currentUser?.name,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to delete role', 'error')
        return
      }
      let restoredRoleId = 0
      actionHistory.pushAction({
        label: `Delete role ${snapshot.name || ''}`.trim(),
        undo: async () => {
          const undoResult = await window.api.createRole(buildRoleWritePayload(snapshot))
          if (undoResult?.success === false) throw new Error(undoResult.error || 'Failed to restore role')
          restoredRoleId = extractHistoryResultId(undoResult)
          await load({ silent: true })
        },
        redo: async () => {
          const targetId = restoredRoleId || Number(snapshot.id || 0)
          if (!targetId) return
          const redoResult = await window.api.deleteRole(targetId, { userId: currentUser?.id, userName: currentUser?.name })
          if (redoResult?.success === false) throw new Error(redoResult.error || 'Failed to delete role again')
          await load({ silent: true })
        },
      })
      notify(tr('role_deleted', 'Role deleted'), 'success')
      await load()
    } catch (error) {
      notify(error?.message || 'Failed to delete role', 'error')
    }
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            <CircleUserRound className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('users') || 'Users'}
          </h1>
          {loading ? (
            <div className="mt-1 text-xs text-blue-600 dark:text-blue-300">{tr('loading', 'Loading...')}</div>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm" onClick={() => setProfileOpen(true)}>
              <CircleUserRound className="h-4 w-4" />
              <span>{tr('profile', 'Profile')}</span>
            </button>
          {tab === 'users' && canManage ? <button type="button" className="btn-primary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm" onClick={openCreateUser}><UserPlus className="h-4 w-4" /><span>{t('add_user') || 'Add user'}</span></button> : null}
          {tab === 'roles' && canManage ? <button type="button" className="btn-primary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm" onClick={openCreateRole}>{t('create_role') || 'Create role'}</button> : null}
        </div>
      </div>

      {!canManage ? (
          <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
            {tr('users_view_only_note', 'View-only mode for shared users. Account details and OTP can still be managed from your profile button.')}
          </div>
      ) : null}

      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {[
          ['users', t('users') || 'Users'],
          ['roles', t('roles') || 'Roles'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label htmlFor="users-search" className="sr-only">{tr('search_users', 'Search users')}</label>
        <input
          id="users-search"
          name="users_search"
          aria-label="Search users"
          autoComplete="off"
          className="input max-w-sm"
          placeholder={tr('search_users_placeholder', 'Search users, phone, email, or role')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ActionHistoryBar history={actionHistory} className="mb-4" />

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
                  {filteredUsers.length === 0 ? (
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
            {filteredUsers.map((user) => (
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
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
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
                      <span className="text-xs text-gray-400">{tr('users_assigned_count', '{n} user(s) still assigned').replace('{n}', assignedCount)}</span>
                    </div>
                    <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{getPermissionSummary(role)}</p>
                    <div className="flex flex-wrap gap-1">
                      {permissionKeys.length === 0 ? <span className="text-xs italic text-gray-400">{tr('no_permissions', 'No permissions')}</span> : null}
                      {permissionKeys.map((key) => (
                        <span key={key} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          {PERMISSION_DEFS.find((item) => item.key === key)?.label || key}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => openEditRole(role)} disabled={role.is_system}>{t('edit') || 'Edit'}</button>
                      {!role.is_system ? <button type="button" className="btn-danger px-3 py-1 text-xs" onClick={() => handleDeleteRole(role)}>{t('delete') || 'Delete'}</button> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal === 'userDetail' && selectedUser ? (
        <UserDetailSheet
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
                <select id="user-role" name="role_id" className="input" value={userForm.role_id || ''} onChange={(e) => setUserForm((prev) => ({ ...prev, role_id: e.target.value }))}>
                  <option value="">{t('no_role') || 'No role'}</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="user-status" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('status', 'Status')}</label>
                <select id="user-status" name="is_active" className="input" value={userForm.is_active} onChange={(e) => setUserForm((prev) => ({ ...prev, is_active: Number(e.target.value) }))}>
                  <option value={1}>{t('active') || 'Active'}</option>
                  <option value={0}>{t('inactive') || 'Inactive'}</option>
                </select>
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
              <button type="button" className="btn-primary" onClick={handleResetPassword}>{tr('change_password', 'Change password')}</button>
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
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('permissions', 'Permissions')}</label>
              <PermissionEditor permissions={roleForm.permissions} onChange={(permissions) => setRoleForm((prev) => ({ ...prev, permissions }))} />
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

      {profileOpen ? <UserProfileModal onClose={() => setProfileOpen(false)} /> : null}
    </div>
  )
}

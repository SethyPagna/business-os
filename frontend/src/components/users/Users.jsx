import { useEffect, useMemo, useState } from 'react'
import { CircleUserRound, UserPlus } from 'lucide-react'
import Modal from '../shared/Modal'
import PortalMenu from '../shared/PortalMenu'
import { fmtDate } from '../../utils/formatters'
import { useApp, useSync } from '../../AppContext'
import PermissionEditor, { PERMISSION_DEFS } from './PermissionEditor'
import UserDetailSheet from './UserDetailSheet'
import UserProfileModal from './UserProfileModal'

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
    canManage ? { label: t('reset_password') || 'Reset password', onClick: onResetPw, color: 'blue' } : null,
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
  const { t, notify, hasPermission, user: currentUser } = useApp()
  const { syncChannel } = useSync()
  const tr = (key, fallback) => {
    const value = typeof t === 'function' ? t(key) : null
    return value && value !== key ? value : fallback
  }

  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [tab, setTab] = useState('users')
  const [modal, setModal] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedRole, setSelectedRole] = useState(null)
  const [search, setSearch] = useState('')
  const [userForm, setUserForm] = useState(INITIAL_USER_FORM)
  const [roleForm, setRoleForm] = useState(INITIAL_ROLE_FORM)
  const [newPw, setNewPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

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

  const load = async () => {
    if (!canManage) {
      setUsers([])
      setRoles([])
      return
    }
    try {
      const [userRows, roleRows] = await Promise.all([window.api.getUsers(), window.api.getRoles()])
      setUsers(Array.isArray(userRows) ? userRows : [])
      setRoles(Array.isArray(roleRows) ? roleRows : [])
    } catch (error) {
      notify(error?.message || 'Failed to load users', 'error')
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!syncChannel) return
    if (syncChannel.channel === 'users' || syncChannel.channel === 'roles') load()
  }, [syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!newPw.trim()) {
      notify(tr('enter_new_password', 'Enter new password'), 'error')
      return
    }

    try {
      const result = await window.api.resetPassword(selectedUser.id, {
        newPassword: newPw,
        userId: currentUser?.id,
        userName: currentUser?.name,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to reset password', 'error')
        return
      }
      notify(tr('password_reset', 'Password reset'), 'success')
      setNewPw('')
      setModal(null)
    } catch (error) {
      notify(error?.message || 'Failed to reset password', 'error')
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
      const result = await window.api.deleteRole(role.id, {
        userId: currentUser?.id,
        userName: currentUser?.name,
      })
      if (result?.success === false) {
        notify(result.error || 'Failed to delete role', 'error')
        return
      }
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
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm" onClick={() => setProfileOpen(true)}>
            <CircleUserRound className="h-4 w-4" />
            <span>{tr('my_profile', 'My Profile')}</span>
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
        <input
          id="users-search"
          name="users_search"
          aria-label="Search users"
          className="input max-w-sm"
          placeholder={`${t('search') || 'Search'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

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
                          onResetPw={() => { setSelectedUser(user); setNewPw(''); setModal('resetPw') }}
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
                    onResetPw={() => { setSelectedUser(user); setNewPw(''); setModal('resetPw') }}
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
          onResetPw={() => { setNewPw(''); setModal('resetPw') }}
          onClose={() => { setModal(null); setSelectedUser(null) }}
        />
      ) : null}

      {modal === 'editUser' ? (
        <Modal title={selectedUser ? `${tr('edit_user', 'Edit User')}: ${selectedUser.name}` : tr('add_user', 'Add user')} onClose={() => setModal(null)} wide>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="user-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('full_name', 'Full name')}</label>
                <input id="user-name" name="name" className="input" value={userForm.name} onChange={(e) => setUserForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-username" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('username', 'Username')}</label>
                <input id="user-username" name="username" className="input" value={userForm.username} onChange={(e) => setUserForm((prev) => ({ ...prev, username: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('phone', 'Phone')}</label>
                <input id="user-phone" name="phone" className="input" value={userForm.phone} onChange={(e) => setUserForm((prev) => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="user-email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('email', 'Email')}</label>
                <input id="user-email" name="email" type="email" className="input" value={userForm.email} onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))} />
              </div>
            </div>
            <div>
              <label htmlFor="user-avatar" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('avatar_image', 'Avatar image')}</label>
              <input id="user-avatar" name="avatar_path" className="input" placeholder={tr('avatar_upload_note', 'Use My Profile to upload an image')} value={userForm.avatar_path} onChange={(e) => setUserForm((prev) => ({ ...prev, avatar_path: e.target.value }))} />
            </div>
            {!selectedUser ? (
              <div>
                <label htmlFor="user-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('password', 'Password')}</label>
                <input id="user-password" name="password" type="password" className="input" value={userForm.password} onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))} />
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
        <Modal title={`${tr('reset_password', 'Reset password')}: ${selectedUser.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label htmlFor="reset-password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('new_password', 'New password')}</label>
              <input id="reset-password" name="new_password" type="password" className="input" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('cancel') || 'Cancel'}</button>
              <button type="button" className="btn-primary" onClick={handleResetPassword}>{t('save') || 'Save'}</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === 'editRole' ? (
        <Modal title={selectedRole ? `${tr('edit_role', 'Edit role')}: ${selectedRole.name}` : tr('create_role', 'Create role')} onClose={() => setModal(null)} wide>
          <div className="space-y-4">
            <div>
              <label htmlFor="role-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('role_name', 'Role name')}</label>
              <input id="role-name" name="role_name" className="input" value={roleForm.name} onChange={(e) => setRoleForm((prev) => ({ ...prev, name: e.target.value }))} />
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

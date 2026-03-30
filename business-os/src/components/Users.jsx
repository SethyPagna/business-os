import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-xl' : 'max-w-lg'} max-h-[92vh] flex flex-col fade-in`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  )
}

// All available permission keys + their human labels
const PERMISSION_DEFS = [
  { key: 'all',       label: '🔑 Administrator',        desc: 'Full access to everything' },
  { key: 'pos',       label: '🛒 Point of Sale',         desc: 'Can use the cashier/POS' },
  { key: 'products',  label: '📦 Products',              desc: 'View and manage products' },
  { key: 'inventory', label: '🏭 Inventory',             desc: 'View stock, adjust quantities' },
  { key: 'sales',     label: '💰 Sales History',         desc: 'View sales records' },
  { key: 'users',     label: '👥 User Management',       desc: 'Add/edit users and roles' },
  { key: 'audit_log', label: '📋 Audit Log',             desc: 'View system activity log' },
  { key: 'settings',  label: '⚙️ Settings & Receipt',    desc: 'Change app settings' },
  { key: 'backup',    label: '💾 Backup',                desc: 'Export and import backups' },
  { key: 'view_only', label: '👁 View Only',             desc: 'Dashboard only, no editing' },
]

function PermissionEditor({ permissions, onChange }) {
  const perms = typeof permissions === 'string' ? JSON.parse(permissions || '{}') : (permissions || {})

  const toggle = (key) => {
    const next = { ...perms }
    if (next[key]) {
      delete next[key]
    } else {
      next[key] = true
    }
    // If 'all' selected, clear everything else
    if (key === 'all' && next.all) {
      onChange({ all: true })
      return
    }
    // If anything else selected, remove 'all'
    if (key !== 'all') delete next.all
    onChange(next)
  }

  const activeCount = Object.keys(perms).filter(k => perms[k]).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">{activeCount} permission{activeCount !== 1 ? 's' : ''} selected</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange({ all: true })} className="text-xs text-blue-500 hover:underline">Select All</button>
          <span className="text-gray-300">|</span>
          <button type="button" onClick={() => onChange({})} className="text-xs text-red-500 hover:underline">Clear all</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {PERMISSION_DEFS.map(p => {
          const active = !!(perms[p.key])
          return (
            <div
              key={p.key}
              onClick={() => toggle(p.key)}
              className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors border select-none ${active ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            >
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${active ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                {active && <span className="text-white text-xs leading-none font-bold">✓</span>}
              </div>
              <div className="flex-1 min-w-0 pointer-events-none">
                <div className={`text-sm font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{p.label}</div>
                <div className="text-xs text-gray-400">{p.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Users() {
  const { t, notify, hasPermission } = useApp()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [tab, setTab] = useState('users')
  const [modal, setModal] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedRole, setSelectedRole] = useState(null)
  const [search, setSearch] = useState('')
  const [userForm, setUserForm] = useState({ name:'', username:'', password:'', role_id:'', is_active:1 })
  const [roleForm, setRoleForm] = useState({ name:'', permissions:{} })
  const [newPw, setNewPw] = useState('')
  const [saving, setSaving] = useState(false)

  // Only admins (has 'users' or 'all') can manage — guard the write actions
  const canManage = hasPermission('users')

  const load = async () => {
    const [u, r] = await Promise.all([window.api.getUsers(), window.api.getRoles()])
    setUsers(u); setRoles(r)
  }
  useEffect(() => { load() }, [])

  // ── Users ─────────────────────────────────────────────────────────────────
  const openCreateUser = () => {
    if (!canManage) return notify('No permission to manage users', 'error')
    setUserForm({ name:'', username:'', password:'', role_id: roles[0]?.id || '', is_active:1 })
    setSelectedUser(null); setModal('createUser')
  }
  const openEditUser = (u) => {
    if (!canManage) return notify('No permission to manage users', 'error')
    setUserForm({ name:u.name, username:u.username, password:'', role_id:u.role_id||'', is_active:u.is_active })
    setSelectedUser(u); setModal('editUser')
  }
  const handleSaveUser = async () => {
    if (!userForm.name || !userForm.username) return notify('Name and username required', 'error')
    setSaving(true)
    if (selectedUser) {
      await window.api.updateUser(selectedUser.id, {
        name: userForm.name, username: userForm.username,
        role_id: userForm.role_id || null, is_active: userForm.is_active
      })
      notify('User updated')
    } else {
      if (!userForm.password) { setSaving(false); return notify('Password required', 'error') }
      await window.api.createUser({
        name: userForm.name, username: userForm.username,
        password: userForm.password, role_id: userForm.role_id || null
      })
      notify('User created')
    }
    setSaving(false); setModal(null); load()
  }
  const handleResetPw = async () => {
    if (!newPw.trim()) return notify('Enter new password', 'error')
    await window.api.resetPassword(selectedUser.id, newPw)
    notify('Password reset'); setModal(null); setNewPw('')
  }

  // ── Roles ─────────────────────────────────────────────────────────────────
  const openCreateRole = () => {
    if (!canManage) return notify('No permission to manage roles', 'error')
    setRoleForm({ name:'', permissions:{} }); setSelectedRole(null); setModal('createRole')
  }
  const openEditRole = (r) => {
    if (!canManage) return notify('No permission to manage roles', 'error')
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions||'{}') : (r.permissions||{})
    setRoleForm({ name:r.name, permissions:perms })
    setSelectedRole(r); setModal('editRole')
  }
  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) return notify('Role name required', 'error')
    setSaving(true)
    if (selectedRole) {
      const res = await window.api.updateRole(selectedRole.id, {
        name: roleForm.name, permissions: roleForm.permissions
      })
      if (res?.success) notify('Role saved — users must re-login to see changes')
      else notify(res?.error || 'Failed to save', 'error')
    } else {
      const res = await window.api.createRole({ name: roleForm.name, permissions: roleForm.permissions })
      if (res?.success) notify('Role created')
    }
    setSaving(false); setModal(null); load()
  }
  const handleDeleteRole = async (role) => {
    if (!canManage) return notify('No permission', 'error')
    const assignedUsers = users.filter(u => u.role_id === role.id)
    if (assignedUsers.length > 0) {
      return notify(`Cannot delete: ${assignedUsers.length} user(s) still assigned. Reassign them first.`, 'error')
    }
    if (!confirm(`Delete role "${role.name}"?`)) return
    const res = await window.api.deleteRole(role.id)
    if (res.success) { notify('Role deleted'); load() }
    else notify(res.error || 'Cannot delete', 'error')
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filteredUsers = users.filter(u =>
    searchTerms.length === 0 ||
    searchTerms.every(term => `${u.name} ${u.username} ${u.role_name||''}`.toLowerCase().includes(term.toLowerCase()))
  )

  const getPermSummary = (r) => {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions||'{}') : (r.permissions||{})
    const keys = Object.keys(perms).filter(k => perms[k])
    if (keys.includes('all')) return '🔑 Full access'
    if (!keys.length) return '— no permissions —'
    return keys.map(k => PERMISSION_DEFS.find(p => p.key===k)?.label || k).join(', ')
  }

  const getPermTags = (r) => {
    const perms = typeof r.permissions === 'string' ? JSON.parse(r.permissions||'{}') : (r.permissions||{})
    return Object.keys(perms).filter(k => perms[k])
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">👥 {t('users')} & {t('roles')}</h1>
        <div className="flex gap-2">
          {tab === 'users' && canManage && (
            <button className="btn-primary text-sm" onClick={openCreateUser}>+ {t('add_user')}</button>
          )}
          {tab === 'roles' && canManage && (
            <button className="btn-primary text-sm" onClick={openCreateRole}>+ {t('create_role')}</button>
          )}
        </div>
      </div>

      {!canManage && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-3 mb-4 text-sm text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
          <span>👁</span> You have view-only access. Contact an administrator to make changes.
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {[['users',`👤 ${t('users')}`], ['roles',`🎭 ${t('roles')}`]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab===id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>{label}</button>
        ))}
      </div>

      <div className="mb-3">
        <input className="input max-w-xs" placeholder={`🔍 ${t('search')}...`} value={search} onChange={e=>setSearch(e.target.value)} />
      </div>

      {/* ── Users Tab ── */}
      {tab === 'users' && (
        <div className="card flex-1 overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('full_name')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('username')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('role')}</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Permissions</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0
                  ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
                  : filteredUsers.map(u => {
                    const role = roles.find(r => r.id === u.role_id)
                    const permTags = role ? getPermTags(role) : []
                    return (
                      <tr key={u.id} className="table-row">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">
                              {u.name?.[0]?.toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 dark:text-white">{u.name}</div>
                              {u.is_primary ? <span className="text-xs text-purple-600">Primary</span> : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-400 text-xs">{u.username}</td>
                        <td className="px-4 py-3">
                          {u.role_name ? <span className="badge-blue text-xs">{u.role_name}</span> : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {permTags.length === 0 && <span className="text-xs text-gray-400">none</span>}
                            {permTags.includes('all')
                              ? <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">all</span>
                              : permTags.map(k => <span key={k} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">{k}</span>)
                            }
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={u.is_active ? 'badge-green' : 'badge-red'}>{u.is_active ? t('active') : t('inactive')}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManage ? (
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => openEditUser(u)} className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">{t('edit')}</button>
                              <button onClick={() => { setSelectedUser(u); setNewPw(''); setModal('resetPw') }} className="text-orange-500 hover:text-orange-700 text-xs px-2 py-1 rounded hover:bg-orange-50 dark:hover:bg-orange-900/20">Reset PW</button>
                            </div>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                      </tr>
                    )
                  })
                }
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filteredUsers.length} {t('users')}</div>
        </div>
      )}

      {/* ── Roles Tab ── */}
      {tab === 'roles' && (
        <div className="flex-1 overflow-auto space-y-3">
          {roles.map(r => {
            const assignedCount = users.filter(u => u.role_id === r.id).length
            const tags = getPermTags(r)
            return (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="font-semibold text-gray-900 dark:text-white text-base">{r.name}</span>
                      {r.is_system ? <span className="badge-blue text-xs">System</span> : <span className="badge-green text-xs">Custom</span>}
                      <span className="text-xs text-gray-400">{assignedCount} user{assignedCount!==1?'s':''}</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{getPermSummary(r)}</p>
                    <div className="flex flex-wrap gap-1">
                      {tags.length === 0 && <span className="text-xs text-gray-400 italic">No permissions assigned</span>}
                      {tags.map(k => {
                        const def = PERMISSION_DEFS.find(p => p.key===k)
                        return (
                          <span key={k} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                            {def?.label || k}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openEditRole(r)} className="btn-secondary text-xs py-1 px-3">{t('edit')}</button>
                      {!r.is_system && (
                        <button onClick={() => handleDeleteRole(r)} className="btn-danger text-xs py-1 px-3">{t('delete')}</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {roles.length === 0 && <p className="text-center text-gray-400 py-8">No roles yet</p>}
        </div>
      )}

      {/* ── Create / Edit User Modal ── */}
      {(modal === 'createUser' || modal === 'editUser') && (
        <Modal title={modal==='createUser' ? `+ ${t('add_user')}` : `✏️ ${t('edit_user')}: ${selectedUser?.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('full_name')} *</label>
              <input className="input" value={userForm.name} onChange={e=>setUserForm(f=>({...f,name:e.target.value}))} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('username')} *</label>
              <input className="input" value={userForm.username} onChange={e=>setUserForm(f=>({...f,username:e.target.value}))} />
            </div>
            {modal === 'createUser' && (
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('password')} *</label>
                <input className="input" type="password" value={userForm.password} onChange={e=>setUserForm(f=>({...f,password:e.target.value}))} />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('role')} <span className="text-gray-400 font-normal">(determines permissions)</span></label>
              <select className="input" value={userForm.role_id||''} onChange={e=>setUserForm(f=>({...f,role_id:e.target.value}))}>
                <option value="">— No Role (view dashboard only) —</option>
                {roles.map(r => {
                  const tags = getPermTags(r)
                  return <option key={r.id} value={r.id}>{r.name} — {tags.includes('all') ? 'full access' : tags.join(', ') || 'no access'}</option>
                })}
              </select>
              {userForm.role_id && (
                <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  {(() => {
                    const role = roles.find(r => String(r.id) === String(userForm.role_id))
                    const tags = role ? getPermTags(role) : []
                    return (
                      <div className="flex flex-wrap gap-1">
                        {tags.map(k => <span key={k} className="text-xs bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{k}</span>)}
                        {!tags.length && <span className="text-xs text-gray-400">No permissions</span>}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
            {modal === 'editUser' && (
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">{t('status')}</label>
                <div className="flex gap-2">
                  <button onClick={() => setUserForm(f=>({...f,is_active:1}))} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 ${userForm.is_active ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'border-gray-200 dark:border-gray-600 text-gray-500'}`}>✓ {t('active')}</button>
                  <button onClick={() => setUserForm(f=>({...f,is_active:0}))} className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 ${!userForm.is_active ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'border-gray-200 dark:border-gray-600 text-gray-500'}`}>✕ {t('inactive')}</button>
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button className="btn-primary flex-1" onClick={handleSaveUser} disabled={saving}>{saving ? t('loading') : t('save')}</button>
              <button className="btn-secondary" onClick={() => setModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reset Password Modal ── */}
      {modal === 'resetPw' && (
        <Modal title={`🔑 Reset Password: ${selectedUser?.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('new_password')}</label>
              <input className="input" type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" onClick={handleResetPw}>{t('save')}</button>
              <button className="btn-secondary" onClick={() => setModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Create / Edit Role Modal ── */}
      {(modal === 'createRole' || modal === 'editRole') && (
        <Modal title={modal==='createRole' ? `+ ${t('create_role')}` : `✏️ ${t('edit_role')}: ${selectedRole?.name}`} onClose={() => setModal(null)} wide>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('role_name')} *</label>
              <input className="input" value={roleForm.name} onChange={e=>setRoleForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Store Manager" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">{t('permissions')}</label>
              <PermissionEditor
                permissions={roleForm.permissions}
                onChange={perms => setRoleForm(f => ({...f, permissions:perms}))}
              />
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Affected users must log out and back in for permission changes to take effect.
            </div>
          </div>
          <div className="flex gap-3 mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button className="btn-primary flex-1" onClick={handleSaveRole} disabled={saving}>{saving ? t('loading') : t('save')}</button>
            <button className="btn-secondary" onClick={() => setModal(null)}>{t('cancel')}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

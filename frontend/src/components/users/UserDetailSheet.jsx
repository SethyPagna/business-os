import { fmtDate } from '../../utils/formatters'
import { PERMISSION_DEFS } from './PermissionEditor'

function translateLabel(t, key, fallback) {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

function buildRowData(user, role, t) {
  return [
    [translateLabel(t, 'role', 'Role'), user.role_name || role?.name || translateLabel(t, 'no_role', 'No role')],
    [translateLabel(t, 'phone', 'Phone'), user.phone || '-'],
    [translateLabel(t, 'email', 'Email'), user.email || '-'],
    [translateLabel(t, 'status', 'Status'), user.is_active ? translateLabel(t, 'active', 'Active') : translateLabel(t, 'inactive', 'Inactive')],
    [translateLabel(t, 'email_verification', 'Email verification'), Number(user.email_verified || 0) === 1 ? translateLabel(t, 'verified', 'Verified') : translateLabel(t, 'not_verified', 'Not verified')],
    ['2FA', user.otp_enabled ? translateLabel(t, 'enabled', 'Enabled') : translateLabel(t, 'off', 'Off')],
    [translateLabel(t, 'added_on', 'Added'), fmtDate(user.created_at)],
  ]
}

export default function UserDetailSheet({ user, roles, canManage, onEdit, onResetPw, onClose, t }) {
  const role = roles?.find((item) => Number(item.id) === Number(user.role_id))
  let permissions = {}

  try {
    permissions = role
      ? (typeof role.permissions === 'string' ? JSON.parse(role.permissions || '{}') : (role.permissions || {}))
      : {}
  } catch (_) {
    permissions = {}
  }

  const permissionKeys = Object.keys(permissions).filter((key) => permissions[key])
  const rowData = buildRowData(user, role, t)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-lg font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
              {user.avatar_path ? <img src={user.avatar_path} alt={user.name} className="h-10 w-10 object-cover" /> : (user.name?.[0]?.toUpperCase() || 'U')}
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">{user.name}</div>
              <div className="text-xs text-gray-400">@{user.username}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center text-2xl text-gray-400 hover:text-gray-600"
            aria-label={translateLabel(t, 'close', 'Close')}
          >
            x
          </button>
        </div>

        <div className="modal-scroll flex-1 space-y-3 overflow-auto p-4">
          {rowData.map(([label, value]) => (
            <div key={label} className="flex gap-3">
              <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{label}</span>
              <span className="text-sm text-gray-800 dark:text-gray-200">{value}</span>
            </div>
          ))}

          <div className="flex gap-3">
            <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{translateLabel(t, 'permissions', 'Permissions')}</span>
            <div className="flex flex-1 flex-wrap gap-1">
              {permissionKeys.length === 0 ? <span className="text-xs italic text-gray-400">{translateLabel(t, 'none', 'None')}</span> : null}
              {permissions.all ? (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {translateLabel(t, 'full_access', 'Full access')}
                </span>
              ) : permissionKeys.map((key) => {
                const perm = PERMISSION_DEFS.find((item) => item.key === key)
                return (
                  <span key={key} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {translateLabel(t, perm?.tKey || key, perm?.label || key)}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {canManage ? (
          <div className="flex gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
            <button type="button" className="btn-primary flex-1" onClick={onEdit}>{translateLabel(t, 'edit', 'Edit')}</button>
            <button
              type="button"
              className="rounded-lg bg-orange-100 px-4 py-2 text-sm font-medium text-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
              onClick={onResetPw}
            >
              {translateLabel(t, 'reset_password', 'Reset password')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

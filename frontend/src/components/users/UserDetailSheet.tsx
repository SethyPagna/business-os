import X from 'lucide-react/dist/esm/icons/x.js'
import { fmtDate } from '../../utils/formatters'
import { describePermissionMap, permissionTierWord, type PermissionEntry } from './rolePermissionLabel.ts'
import { UserAvatarImage } from './UserAvatar.tsx'

type TranslateFunction = (key: string) => string

type UserRole = {
  id: string | number
  name?: string | null
  permissions?: string | Record<string, unknown> | null
}

type UserDetail = {
  role_id?: string | number | null
  role_name?: string | null
  phone?: string | null
  email?: string | null
  is_active?: boolean | number
  otp_enabled?: boolean | number
  permissions?: string | Record<string, unknown> | null
  created_at?: string | number | Date | null
  avatar_path?: string | null
  name?: string | null
  username?: string | null
}

type UserDetailSheetProps = {
  user: UserDetail
  roles?: UserRole[]
  canManage?: boolean
  canRecoverOtp?: boolean
  onEdit?: () => void
  onResetPw?: () => void
  onRecoverOtp?: () => void
  onClose?: () => void
  t?: TranslateFunction
}

function translateLabel(t: TranslateFunction | undefined, key: string, fallback: string): string {
  const value = typeof t === 'function' ? t(key) : null
  return value && value !== key ? value : fallback
}

function buildRowData(user: UserDetail, role: UserRole | undefined, t: TranslateFunction | undefined): Array<[string, string]> {
  return [
    [translateLabel(t, 'role', 'Role'), user.role_name || role?.name || translateLabel(t, 'no_role', 'No role')],
    [translateLabel(t, 'phone', 'Phone'), user.phone || '-'],
    [translateLabel(t, 'email', 'Email'), user.email || '-'],
    [translateLabel(t, 'status', 'Status'), user.is_active ? translateLabel(t, 'active', 'Active') : translateLabel(t, 'inactive', 'Inactive')],
    [translateLabel(t, 'email_login', 'Email login'), user.email ? translateLabel(t, 'enabled', 'Enabled') : translateLabel(t, 'setup_needed', 'Setup needed')],
    ['2FA', user.otp_enabled ? translateLabel(t, 'enabled', 'Enabled') : translateLabel(t, 'off', 'Off')],
    [translateLabel(t, 'added_on', 'Added'), fmtDate(user.created_at)],
  ]
}

function PermissionChip({ entry, tr, off, bare }: { entry: PermissionEntry; tr: (key: string, fallback: string) => string; off?: boolean; bare?: boolean }) {
  const tier = permissionTierWord(entry.tier, tr)
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs leading-5 ${off ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
      {entry.label}
      {tier && !bare ? ` (${tier})` : ''}
    </span>
  )
}

export default function UserDetailSheet({ user, roles, canManage, canRecoverOtp, onEdit, onResetPw, onRecoverOtp, onClose, t }: UserDetailSheetProps) {
  const role = roles?.find((item) => Number(item.id) === Number(user.role_id))
  const tr = (key: string, fallback: string) => translateLabel(t, key, fallback)
  const rolePermissions = describePermissionMap(role?.permissions, tr)
  const userExceptions = describePermissionMap(user.permissions, tr)
  const exceptionCount = userExceptions.granted.length + userExceptions.off.length + (userExceptions.all ? 1 : 0)
  const rowData = buildRowData(user, role, t)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-modal-85 w-full max-w-md flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:rounded-2xl pb-[env(safe-area-inset-bottom)] sm:pb-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-lg font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
              <UserAvatarImage src={user.avatar_path} alt={user.name || 'Avatar'} className="h-10 w-10 object-cover" fallback={(user.name?.[0]?.toUpperCase() || 'U')} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">{user.name}</div>
              <div className="text-xs text-gray-400">@{user.username}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"
            aria-label={translateLabel(t, 'close', 'Close')}
          >
            <X className="h-4 w-4" />
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
              {!rolePermissions.all && rolePermissions.granted.length === 0 ? <span className="text-xs italic text-gray-400">{translateLabel(t, 'none', 'None')}</span> : null}
              {rolePermissions.all ? (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs leading-5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {translateLabel(t, 'full_access', 'Full access')}
                </span>
              ) : rolePermissions.granted.map((entry) => <PermissionChip key={entry.key} entry={entry} tr={tr} />)}
            </div>
          </div>

          {rolePermissions.off.length > 0 ? (
            <div className="flex gap-3">
              <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{translateLabel(t, 'perm_switched_off_heading', 'Switched off')}</span>
              <div className="flex flex-1 flex-wrap gap-1">
                {rolePermissions.off.map((entry) => <PermissionChip key={entry.key} entry={entry} tr={tr} off bare />)}
              </div>
            </div>
          ) : null}

          {exceptionCount > 0 ? (
            <div className="flex gap-3">
              <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{translateLabel(t, 'perm_user_exceptions_heading', 'Individual exceptions')}</span>
              <div className="flex-1">
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                  {exceptionCount === 1
                    ? translateLabel(t, 'perm_user_exceptions_one', '1 individual exception')
                    : translateLabel(t, 'perm_user_exceptions_other', '{n} individual exceptions').replace('{n}', String(exceptionCount))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {userExceptions.all ? (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs leading-5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                      {translateLabel(t, 'full_access', 'Full access')}
                    </span>
                  ) : null}
                  {userExceptions.granted.map((entry) => <PermissionChip key={entry.key} entry={entry} tr={tr} />)}
                  {userExceptions.off.map((entry) => <PermissionChip key={entry.key} entry={entry} tr={tr} off />)}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
            <button type="button" className="btn-primary flex-1" onClick={onEdit}>{translateLabel(t, 'edit', 'Edit')}</button>
            <button
              type="button"
              className="rounded-lg bg-orange-100 px-4 py-2 text-sm font-medium text-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
              onClick={onResetPw}
            >
              {translateLabel(t, 'reset_password', 'Reset password')}
            </button>
            {canRecoverOtp && onRecoverOtp ? (
              <button
                type="button"
                className="rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
                onClick={onRecoverOtp}
              >
                {translateLabel(t, 'reset_2fa', 'Reset 2FA')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import ShieldOff from 'lucide-react/dist/esm/icons/shield-off.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { fmtDate } from '../../utils/formatters'
import { normalizePermissionState } from '../../utils/permissions.ts'
import PermissionSummaryList from './PermissionSummaryList.tsx'
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

// Icon-only actions: the name rides the tooltip and the aria-label, and touch screens get a 44px target.
const ICON_BUTTON = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'

export default function UserDetailSheet({ user, roles, canManage, canRecoverOtp, onEdit, onResetPw, onRecoverOtp, onClose, t }: UserDetailSheetProps) {
  const role = roles?.find((item) => Number(item.id) === Number(user.role_id))
  const tr = (key: string, fallback: string) => translateLabel(t, key, fallback)
  const exceptionCount = Object.keys(normalizePermissionState(user.permissions)).length
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
            className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
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
            <div className="min-w-0 flex-1">
              <PermissionSummaryList permissions={role?.permissions} mode="role" tr={tr} />
            </div>
          </div>

          {exceptionCount > 0 ? (
            <div className="flex gap-3">
              <span className="w-28 flex-shrink-0 pt-0.5 text-xs text-gray-400">{translateLabel(t, 'perm_user_exceptions_heading', 'Individual exceptions')}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
                  {exceptionCount === 1
                    ? translateLabel(t, 'perm_user_exceptions_one', '1 individual exception')
                    : translateLabel(t, 'perm_user_exceptions_other', '{n} individual exceptions').replace('{n}', String(exceptionCount))}
                </div>
                <PermissionSummaryList permissions={user.permissions} mode="exceptions" tr={tr} />
              </div>
            </div>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex items-center gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
            <button type="button" className="btn-primary inline-flex flex-1 items-center justify-center gap-1.5 [@media(pointer:coarse)]:h-11" onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {translateLabel(t, 'edit', 'Edit')}
            </button>
            <button
              type="button"
              className={`${ICON_BUTTON} text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100`}
              title={translateLabel(t, 'reset_password', 'Reset password')}
              aria-label={translateLabel(t, 'reset_password', 'Reset password')}
              onClick={onResetPw}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </button>
            {canRecoverOtp && onRecoverOtp ? (
              <button
                type="button"
                className={`${ICON_BUTTON} text-red-600 dark:text-red-300`}
                title={translateLabel(t, 'reset_2fa', 'Reset 2FA')}
                aria-label={translateLabel(t, 'reset_2fa', 'Reset 2FA')}
                onClick={onRecoverOtp}
              >
                <ShieldOff className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

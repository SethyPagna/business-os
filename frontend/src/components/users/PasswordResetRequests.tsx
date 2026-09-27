import { useCallback, useEffect, useState } from 'react'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import { fmtDateTime24 } from '../../utils/formatters'
import {
  dismissPasswordResetRequest,
  getPasswordResetRequests,
  type PasswordResetRequestRecord,
} from '../../api/userAdminTransport.ts'

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void

interface PasswordResetRequestsProps {
  t: TranslateFn
  notify: NotifyFn
  // Bumped by Users after an admin password reset, which resolves the
  // account's pending request on the Worker -- reload so it leaves the list.
  refreshKey: number
  onReset: (userId: number) => void
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

// S-auth4c: sign-in-screen "Ask an administrator" requests, shown to
// admin-control users at the top of Users. Reset opens the existing
// reset-password form for that account (answering the request); Dismiss
// closes it without a change. Renders nothing while there are none. The
// Worker enforces admin-control on both calls (routes/users.ts).
export default function PasswordResetRequests({ t, notify, refreshKey, onReset }: PasswordResetRequestsProps) {
  const [requests, setRequests] = useState<PasswordResetRequestRecord[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await getPasswordResetRequests() as { success?: boolean; requests?: PasswordResetRequestRecord[] } | null
      setRequests(result?.success === false ? [] : (Array.isArray(result?.requests) ? result.requests : []))
    } catch (_) {
      setRequests([])
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  const dismiss = async (request: PasswordResetRequestRecord) => {
    if (busyId !== null) return
    setBusyId(request.id)
    try {
      const result = await dismissPasswordResetRequest(request.id) as { success?: boolean; error?: string } | null
      if (result?.success === false) notify(result.error || tr(t, 'password_reset_request_dismiss_failed', 'Could not dismiss the request.'), 'error')
      await load()
    } catch (error) {
      notify(String((error as { message?: unknown })?.message || tr(t, 'password_reset_request_dismiss_failed', 'Could not dismiss the request.')), 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (!requests.length) return null

  return (
    <div className="card mb-3 space-y-2 p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <KeyRound className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        <span className="min-w-0 truncate">{tr(t, 'password_reset_requests_title', 'Password reset requests')}</span>
      </div>
      {requests.map((request) => (
        <div key={request.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{request.name || request.username}</div>
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">
              {[request.username, request.device_name, request.requested_at ? fmtDateTime24(request.requested_at) : ''].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="btn-primary h-8 shrink-0 px-3 text-xs" disabled={busyId !== null} onClick={() => onReset(Number(request.user_id))}>
            {tr(t, 'reset_password', 'Reset password')}
          </button>
          <button type="button" className="btn-secondary h-8 shrink-0 px-3 text-xs" disabled={busyId !== null} onClick={() => { void dismiss(request) }}>
            {tr(t, 'password_reset_request_dismiss', 'Dismiss')}
          </button>
        </div>
      ))}
    </div>
  )
}

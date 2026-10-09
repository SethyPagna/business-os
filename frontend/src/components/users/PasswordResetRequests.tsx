import { useCallback, useEffect, useRef, useState } from 'react'
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp } from '../../AppContext.tsx'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import { isAdminControlUser, type PermissionUser } from '../../utils/permissions.ts'
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
  const { user, syncUrl } = useApp() as { user: NonNullable<PermissionUser> & { id?: unknown; organization_id?: unknown }; syncUrl: string }
  const canManage = isAdminControlUser(user)
  const authority = captureActorReadScope('users').authority
  const ownerKey = JSON.stringify([user?.id, user?.organization_id, syncUrl, canManage, authority])
  const currentOwner = useRef({ ownerKey, canManage, authority })
  currentOwner.current = { ownerKey, canManage, authority }
  const mounted = useRef(false)
  const sequence = useRef(0)
  const active = useRef<{ ownerKey: string; id: number } | null>(null)
  const [snapshot, setSnapshot] = useState<{ ownerKey: string; rows: PasswordResetRequestRecord[] } | null>(null)
  const [readState, setReadState] = useState({ ownerKey, error: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const requests = snapshot?.ownerKey === ownerKey ? snapshot.rows : []
  const currentSnapshot = useRef(snapshot)
  currentSnapshot.current = snapshot
  const error = readState.ownerKey === ownerKey ? readState.error : ''
  const ownsScope = useCallback((scope: ActorReadScope) => mounted.current && currentOwner.current.canManage
    && currentOwner.current.ownerKey === ownerKey && currentOwner.current.authority === scope.authority
    && isActorReadScopeCurrent(scope, false), [ownerKey])
  const ownsRequest = (request: PasswordResetRequestRecord, scope: ActorReadScope) => ownsScope(scope)
    && currentSnapshot.current?.ownerKey === ownerKey
    && currentSnapshot.current.rows.some(row => row.id === request.id && row.user_id === request.user_id)

  const load = useCallback(async () => {
    const scope = captureActorReadScope('users')
    if (!ownsScope(scope)) return
    const requestSequence = ++sequence.current
    const current = () => requestSequence === sequence.current && ownsScope(scope)
    setReadState({ ownerKey, error: '' })
    try {
      const result = await getPasswordResetRequests() as { success?: boolean; requests?: PasswordResetRequestRecord[]; error?: string } | null
      if (!current()) return
      if (result?.success === false || !Array.isArray(result?.requests)) throw new Error(result?.error || tr(t, 'failed_to_load_data', 'Failed to load data'))
      setSnapshot({ ownerKey, rows: result.requests })
    } catch (error) {
      if (current()) setReadState({ ownerKey, error: error instanceof Error ? error.message : tr(t, 'failed_to_load_data', 'Failed to load data') })
    }
  }, [ownerKey, ownsScope, t])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; sequence.current++ }
  }, [load, refreshKey])

  const dismiss = async (request: PasswordResetRequestRecord) => {
    const scope = captureActorReadScope('users')
    if (!ownsRequest(request, scope) || active.current?.ownerKey === ownerKey) return
    const pending = { ownerKey, id: request.id }
    active.current = pending
    sequence.current++
    setBusy(ownerKey)
    try {
      const result = await dismissPasswordResetRequest(request.id) as { success?: boolean; error?: string } | null
      if (!ownsScope(scope)) return
      if (result?.success === false) throw new Error(result.error || tr(t, 'password_reset_request_dismiss_failed', 'Could not dismiss the request.'))
      await load()
    } catch (error) {
      if (ownsScope(scope)) notify(String((error as { message?: unknown })?.message || tr(t, 'password_reset_request_dismiss_failed', 'Could not dismiss the request.')), 'error')
    } finally {
      if (active.current === pending) active.current = null
      if (ownsScope(scope)) setBusy(null)
    }
  }

  const reset = (request: PasswordResetRequestRecord) => {
    const scope = captureActorReadScope('users')
    if (ownsRequest(request, scope) && active.current?.ownerKey !== ownerKey) onReset(Number(request.user_id))
  }

  if (!canManage || (!requests.length && !error)) return null

  return (
    <div className="card mb-3 space-y-2 p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <KeyRound className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
        <span className="min-w-0 break-words">{tr(t, 'password_reset_requests_title', 'Password reset requests')}</span>
      </div>
      {error ? <div role="alert" className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
        <span className="min-w-0 flex-1 break-words">{error}</span>
        <button type="button" className="btn-secondary min-h-11 min-w-11 shrink-0" aria-label={tr(t, 'retry', 'Retry')} title={tr(t, 'retry', 'Retry')} onClick={() => { void load() }}><RefreshCw className="h-4 w-4" aria-hidden="true" /></button>
      </div> : null}
      {requests.map((request) => (
        <div key={request.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <div className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{request.name || request.username}</div>
            <div className="break-words text-xs text-gray-500 dark:text-gray-400">
              {[request.username, request.device_name, request.requested_at ? fmtDateTime24(request.requested_at) : ''].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button type="button" className="btn-primary min-h-11 min-w-11 shrink-0" disabled={busy === ownerKey} aria-label={tr(t, 'reset_password', 'Reset password')} title={tr(t, 'reset_password', 'Reset password')} onClick={() => reset(request)}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className="btn-secondary min-h-11 min-w-11 shrink-0" disabled={busy === ownerKey} aria-label={tr(t, 'password_reset_request_dismiss', 'Dismiss')} title={tr(t, 'password_reset_request_dismiss', 'Dismiss')} onClick={() => { void dismiss(request) }}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

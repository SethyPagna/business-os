import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../AppContext.tsx'
import { captureActorReadScope, isActorReadScopeCurrent, type ActorReadScope } from '../../api/actorReadScope.ts'
import { isAdminControlUser, type PermissionUser } from '../../utils/permissions.ts'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import Modal from '../shared/Modal.tsx'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import ShieldX from 'lucide-react/dist/esm/icons/shield-x.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import MonitorSmartphone from 'lucide-react/dist/esm/icons/monitor-smartphone.js'
import { fmtDate } from '../../utils/formatters'
import {
  approveDevice,
  approveDeviceReplacing,
  getAllDevices,
  getLiveSessions,
  getPendingDevices,
  rejectDevice,
  resetDeviceForReapproval,
  revokeAllUserSessions,
  revokeDevice,
  revokeLiveSession,
  type LiveSessionRecord,
  type TrustedDeviceRecord,
} from '../../api/deviceAdminTransport.ts'

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void
type DevicePanelContext = {
  user: (NonNullable<PermissionUser> & { id?: unknown; organization_id?: unknown }) | null
  syncUrl: string
}
type DeviceSnapshot = {
  ownerKey: string
  pending: TrustedDeviceRecord[]
  approvedDevices: TrustedDeviceRecord[]
  rejectedHistory: TrustedDeviceRecord[]
  sessions: LiveSessionRecord[]
  limit: number | null
}

interface DeviceApprovalsProps {
  t: TranslateFn
  notify: NotifyFn
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
}

function readLimit(...responses: Array<{ limit?: unknown } | null | undefined>): number | null {
  for (const response of responses) {
    const limit = Number(response?.limit)
    if (Number.isInteger(limit) && limit > 0) return limit
  }
  return null
}

// The Worker's English refusal is a fallback; the panel speaks both languages by the machine code.
function deviceActionMessage(t: TranslateFn, err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'device_limit_reached') {
    return tr(t, 'device_limit_reached', 'This account already has the maximum number of approved devices. Remove one of its devices first, then approve this one.')
  }
  if (code === 'device_replace_conflict') {
    return tr(t, 'device_replace_conflict', 'The devices changed while you were deciding. Reload and try again.')
  }
  if (code === 'device_replace_invalid') {
    return tr(t, 'device_replace_invalid', 'Choose an approved device of the same account to replace.')
  }
  return err instanceof Error ? err.message : tr(t, 'device_action_failed', 'Action failed. Please try again.')
}

// Admin device/session panel (J3) -- Settings/Users > Devices. Three layers:
// devices awaiting approval (top, most actionable), then PER-ACCOUNT groups
// of approved devices + LIVE sessions (last seen, per-row revoke, and a
// sign-out-everywhere for the account), then the rejected/revoked history.
// Backend enforces admin-control access on every call (routes/devices.ts)
// regardless of what this panel shows, so a stale/incorrect frontend
// permission check here can't itself grant access -- this UI is
// convenience, not the security boundary.
export default function DeviceApprovals({ t, notify }: DeviceApprovalsProps) {
  const { user, syncUrl } = useApp() as DevicePanelContext
  const canManage = isAdminControlUser(user)
  const renderedAuthority = captureActorReadScope('devices').authority
  const ownerKey = JSON.stringify([user?.id, user?.organization_id, syncUrl, canManage, renderedAuthority])
  const currentOwner = useRef({ ownerKey, canManage, authority: renderedAuthority })
  currentOwner.current = { ownerKey, canManage, authority: renderedAuthority }
  const mounted = useRef(false)
  const requestSequence = useRef(0)
  const actions = useRef(new Set<string>())
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null)
  const currentSnapshot = snapshot?.ownerKey === ownerKey ? snapshot : null
  const pending = currentSnapshot?.pending || []
  const approvedDevices = currentSnapshot?.approvedDevices || []
  const rejectedHistory = currentSnapshot?.rejectedHistory || []
  const sessions = currentSnapshot?.sessions || []
  const deviceLimit = currentSnapshot?.limit ?? null
  const [readState, setReadState] = useState({ ownerKey, loading: true, error: '' })
  const loading = !currentSnapshot && (readState.ownerKey !== ownerKey || readState.loading)
  const error = readState.ownerKey === ownerKey ? readState.error : ''
  const [busyId, setBusyId] = useState<number | null>(null)
  // Session ids and device ids are separate sequences -- separate busy state
  // so a session action can't disable an unrelated device button.
  const [busySessionId, setBusySessionId] = useState<number | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  // An account already at its cap: the pending device waits for the admin to pick which approved device to replace.
  const [replacing, setReplacing] = useState<{ device: TrustedDeviceRecord; choices: TrustedDeviceRecord[]; selectedId: number } | null>(null)

  const ownsScope = useCallback((scope: ActorReadScope, owner = ownerKey) => mounted.current
    && currentOwner.current.canManage && currentOwner.current.ownerKey === owner
    && scope.authority === currentOwner.current.authority
    && isActorReadScopeCurrent(scope, false), [ownerKey])

  const load = useCallback(async () => {
    const scope = captureActorReadScope('devices')
    if (!ownsScope(scope)) return
    const sequence = ++requestSequence.current
    const current = () => sequence === requestSequence.current && ownsScope(scope)
    setReadState({ ownerKey, loading: true, error: '' })
    try {
      const [pendingRes, allRes, sessionsRes] = await Promise.all([
        getPendingDevices(),
        getAllDevices(),
        getLiveSessions(),
      ])
      if (!current()) return
      const nonPending = (allRes?.devices || []).filter((device) => device.status !== 'pending')
      setSnapshot({ ownerKey, pending: pendingRes?.devices || [], approvedDevices: nonPending.filter((device) => device.status === 'approved'), rejectedHistory: nonPending.filter((device) => device.status !== 'approved'), sessions: sessionsRes?.sessions || [], limit: readLimit(allRes, pendingRes) })
    } catch (err) {
      if (current()) setReadState({ ownerKey, loading: false, error: err instanceof Error ? err.message : tr(t, 'device_load_failed', 'Could not load device requests.') })
    } finally {
      if (current()) setReadState((state) => ({ ...state, loading: false }))
    }
  }, [t, ownerKey, ownsScope])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false; requestSequence.current++ }
  }, [load])
  useEffect(() => {
    setBusyId(null)
    setBusySessionId(null)
    setBusyUserId(null)
  }, [ownerKey])

  const runOnlineAction = async (kind: 'device' | 'session' | 'user', id: number, write: () => Promise<unknown>, successMessage: (result: unknown) => string, authority = { scope: captureActorReadScope('devices'), ownerKey }) => {
    if (!ownsScope(authority.scope, authority.ownerKey)) return
    const actionKey = `${authority.ownerKey}:${kind}:${id}`
    if (actions.current.has(actionKey)) return
    actions.current.add(actionKey)
    requestSequence.current++
    const setBusy = kind === 'device' ? setBusyId : kind === 'session' ? setBusySessionId : setBusyUserId
    setBusy(id)
    try {
      const result = await write()
      if (!ownsScope(authority.scope, authority.ownerKey)) return
      notify(successMessage(result), 'success')
      await load()
    } catch (err) {
      if (ownsScope(authority.scope, authority.ownerKey)) notify(deviceActionMessage(t, err), 'error')
    } finally {
      actions.current.delete(actionKey)
      if (ownsScope(authority.scope, authority.ownerKey)) setBusy((current) => current === id ? null : current)
    }
  }
  const runAction = (id: number, action: 'approve' | 'reject' | 'revoke' | 'reset', successMessage: string, authority = { scope: captureActorReadScope('devices'), ownerKey }) => runOnlineAction('device', id, () => {
    if (action === 'approve') return approveDevice(id)
    if (action === 'reject') return rejectDevice(id)
    if (action === 'reset') return resetDeviceForReapproval(id)
    return revokeDevice(id)
  }, () => successMessage, authority)

  const resetForReapproval = async (device: TrustedDeviceRecord) => {
    const authority = { scope: captureActorReadScope('devices'), ownerKey }
    if (!ownsScope(authority.scope)) return
    const confirmed = await askToConfirm({
      title: tr(t, 'device_reapproval_reset_title', 'Remove rejected device request?'),
      message: tr(
        t,
        'device_reapproval_reset_confirm',
        'Remove this rejected device request? This does not approve the device. The person must sign in again, then an administrator must approve the new request.',
      ),
      confirmLabel: tr(t, 'remove', 'Remove'),
      danger: true,
    })
    if (!confirmed) return
    void runAction(device.id, 'reset', tr(t, 'device_reapproval_reset_done', 'Rejected device request removed. It must sign in again for a new approval request.'), authority)
  }

  const startApprove = (device: TrustedDeviceRecord) => {
    const choices = approvedDevices
      .filter((approved) => approved.user_id === device.user_id)
      .sort((a, b) => String(a.last_seen_at || '').localeCompare(String(b.last_seen_at || '')))
    if (deviceLimit && choices.length >= deviceLimit) {
      setReplacing({ device, choices, selectedId: choices[0].id })
      return
    }
    void runAction(device.id, 'approve', tr(t, 'device_approved', 'Device approved.'))
  }

  const confirmReplace = () => {
    if (!replacing) return
    const { device, selectedId } = replacing
    setReplacing(null)
    void runOnlineAction('device', device.id, () => approveDeviceReplacing(device.id, selectedId), () => tr(t, 'device_replace_done', 'Device replaced and approved.'))
  }

  const runSessionRevoke = (sessionId: number) => runOnlineAction('session', sessionId, () => revokeLiveSession(sessionId), () => tr(t, 'session_revoked_notice', 'Session ended. That device is signed out.'))

  const runSignOutEverywhere = (userId: number) => runOnlineAction('user', userId, () => revokeAllUserSessions(userId), (result) => `${tr(t, 'sessions_revoked_notice', 'Signed the account out everywhere.')} (${Number((result as { revoked?: number } | null)?.revoked || 0)})`)

  // Per-account grouping (J3's "per-user devices"): one card per user that
  // has an approved device or a live session, devices then sessions inside.
  const accountGroups = useMemo(() => {
    type AccountGroup = {
      userId: number
      label: string
      username: string
      devices: TrustedDeviceRecord[]
      sessions: LiveSessionRecord[]
    }
    const byUser = new Map<number, AccountGroup>()
    const groupFor = (userId: number, label: string, username: string): AccountGroup => {
      const existing = byUser.get(userId)
      if (existing) return existing
      const created: AccountGroup = { userId, label, username, devices: [], sessions: [] }
      byUser.set(userId, created)
      return created
    }
    for (const device of approvedDevices) {
      groupFor(device.user_id, device.user_name || device.username, device.username).devices.push(device)
    }
    for (const session of sessions) {
      groupFor(session.user_id, session.user_name || session.username, session.username).sessions.push(session)
    }
    return [...byUser.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [approvedDevices, sessions])

  const renderDeviceMeta = (device: TrustedDeviceRecord) => (
    <div className="min-w-0">
      <div className="detail-scroll-text text-sm font-semibold text-gray-900 dark:text-white">
        {device.device_name || tr(t, 'unknown_device', 'Unknown device')}
      </div>
      <div className="mt-0.5 detail-scroll-text text-xs text-gray-500 dark:text-gray-400">
        {tr(t, 'account', 'Account')}: {device.user_name || device.username}
        {device.last_ip || device.first_ip ? ` \u00b7 ${device.last_ip || device.first_ip}` : ''}
      </div>
      <div className="mt-0.5 detail-scroll-text text-xs text-gray-400 dark:text-gray-500">
        {device.user_agent || tr(t, 'unknown_browser', 'Unknown browser')}
      </div>
      <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
        {tr(t, 'requested', 'Requested')} {fmtDate(device.requested_at)} · {tr(t, 'last_seen', 'Last seen')} {fmtDate(device.last_seen_at)}
        {device.decided_by_name ? ` · ${tr(t, 'decided_by', 'Decided by')} ${device.decided_by_name}` : ''}
      </div>
    </div>
  )

  if (!canManage) return null
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
        {tr(
          t,
          'device_approvals_intro',
          'Every new user device must be approved here before it can access Business OS. Only approve a device you recognize; approval remains until you revoke it.',
        )}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          {tr(t, 'pending_devices', 'Pending devices')}
          {pending.length ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {pending.length}
            </span>
          ) : null}
        </h3>

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{tr(t, 'loading', 'Loading...')}</div>
        ) : !pending.length ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            {tr(t, 'no_pending_devices', 'No devices are waiting for approval.')}
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between"
              >
                {renderDeviceMeta(device)}
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === device.id}
                    className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    onClick={() => startApprove(device)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {tr(t, 'approve', 'Approve')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === device.id}
                    className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600"
                    onClick={() => runAction(device.id, 'reject', tr(t, 'device_rejected_action', 'Device rejected.'))}
                  >
                    <ShieldX className="h-3.5 w-3.5" />
                    {tr(t, 'reject', 'Reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <MonitorSmartphone className="h-4 w-4 text-blue-500" />
          {tr(t, 'accounts_devices_sessions', 'Accounts: devices & live sessions')}
        </h3>
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{tr(t, 'loading', 'Loading...')}</div>
        ) : !accountGroups.length ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
            {tr(t, 'no_active_devices_sessions', 'No approved devices or live sessions yet.')}
          </div>
        ) : (
          <div className="space-y-3">
            {accountGroups.map((group) => (
              <div key={group.userId} className="rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {deviceLimit ? `${group.devices.length} / ${deviceLimit}` : group.devices.length} {tr(t, 'devices_word', 'devices')} · {group.sessions.length} {tr(t, 'live_sessions_word', 'live sessions')}
                    </span>
                  </div>
                  {group.sessions.length ? (
                    <button
                      type="button"
                      disabled={busyUserId === group.userId}
                      className="btn-secondary px-2.5 py-1 text-xs text-red-600"
                      onClick={() => runSignOutEverywhere(group.userId)}
                    >
                      {tr(t, 'sign_out_everywhere', 'Sign out everywhere')}
                    </button>
                  ) : null}
                </div>

                {group.devices.length ? (
                  <div className="space-y-2 px-3 py-2">
                    {group.devices.map((device) => (
                      <div
                        key={`device-${device.id}`}
                        className="flex flex-col gap-2 rounded-lg border border-gray-100 p-2.5 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between"
                      >
                        {renderDeviceMeta(device)}
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            {tr(t, 'approved', 'Approved')}
                          </span>
                          <button
                            type="button"
                            disabled={busyId === device.id}
                            className="btn-secondary px-2.5 py-1 text-xs text-red-600"
                            onClick={() => runAction(device.id, 'revoke', tr(t, 'device_revoked', 'Device access revoked.'))}
                          >
                            {tr(t, 'revoke', 'Revoke')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {group.sessions.length ? (
                  <div className="space-y-2 px-3 pb-2">
                    {group.sessions.map((session) => (
                      <div
                        key={`session-${session.id}`}
                        className="flex flex-col gap-2 rounded-lg bg-gray-50 p-2.5 dark:bg-gray-800/40 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="detail-scroll-text text-sm text-gray-900 dark:text-white">
                            {session.device_name || tr(t, 'unknown_device', 'Unknown device')}
                            <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {tr(t, 'live_session', 'Live session')}
                            </span>
                          </div>
                          <div className="mt-0.5 detail-scroll-text text-xs text-gray-500 dark:text-gray-400">
                            {session.user_agent || tr(t, 'unknown_browser', 'Unknown browser')}
                            {session.last_ip ? ` · ${session.last_ip}` : ''}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                            {tr(t, 'signed_in', 'Signed in')} {fmtDate(session.created_at)}
                            {session.last_seen_at ? ` · ${tr(t, 'last_seen', 'Last seen')} ${fmtDate(session.last_seen_at)}` : ''}
                            {` · ${tr(t, 'expires', 'Expires')} ${fmtDate(session.expires_at)}`}
                          </div>
                        </div>
                        <div className="flex shrink-0">
                          <button
                            type="button"
                            disabled={busySessionId === session.id}
                            className="btn-secondary px-2.5 py-1 text-xs text-red-600"
                            onClick={() => runSessionRevoke(session.id)}
                          >
                            {tr(t, 'end_session', 'End session')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {/* Deliberately NOT the existing `device_history` key -- that pack
              entry says "Device history", and this section no longer shows
              approved rows (they live in the per-account groups above). */}
          {tr(t, 'device_rejected_history', 'Rejected & revoked history')}
        </h3>
        {!rejectedHistory.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{tr(t, 'no_device_history', 'No decisions yet.')}</div>
        ) : (
          <div className="space-y-2">
            {rejectedHistory.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between"
              >
                {renderDeviceMeta(device)}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    {tr(t, 'rejected', 'Rejected')}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === device.id}
                    className="btn-secondary px-2.5 py-1 text-xs"
                    onClick={() => void resetForReapproval(device)}
                  >
                    {tr(t, 'device_reapproval_reset', 'Reset for re-approval')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {replacing ? (
        <Modal title={tr(t, 'device_replace_title', 'Replace a device')} onClose={() => setReplacing(null)} size="sm" layer="nested" keyboard unsavedChanges={{ dirty: false }}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {tr(t, 'device_replace_intro', 'This account has reached its device limit. Choose one approved device to remove; it is signed out right away and the new device is approved.')}
            </p>
            <div>
              <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{tr(t, 'device_replace_new', 'New device')}</div>
              {renderDeviceMeta(replacing.device)}
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{tr(t, 'device_replace_remove', 'Device to remove')}</legend>
              {replacing.choices.map((choice, index) => (
                <label
                  key={choice.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 ${replacing.selectedId === choice.id ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/20' : 'border-gray-200 dark:border-gray-700'}`}
                >
                  <input
                    type="radio"
                    name="device-to-replace"
                    className="mt-1"
                    checked={replacing.selectedId === choice.id}
                    onChange={() => setReplacing({ ...replacing, selectedId: choice.id })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{choice.device_name || tr(t, 'unknown_device', 'Unknown device')}</span>
                    <span className="block detail-scroll-text text-xs text-gray-500 dark:text-gray-400">
                      {tr(t, 'last_seen', 'Last seen')} {fmtDate(choice.last_seen_at)}{choice.last_ip || choice.first_ip ? ` \u00b7 ${choice.last_ip || choice.first_ip}` : ''}
                    </span>
                    {index === 0 ? <span className="block text-xs text-amber-700 dark:text-amber-300">{tr(t, 'device_replace_least_recent', 'Not used for the longest')}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setReplacing(null)}>{tr(t, 'cancel', 'Cancel')}</button>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={confirmReplace}>{tr(t, 'device_replace_confirm', 'Replace and approve')}</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {confirmDialog}
    </div>
  )
}

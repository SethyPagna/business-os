import { useCallback, useEffect, useMemo, useState } from 'react'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import ShieldX from 'lucide-react/dist/esm/icons/shield-x.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import MonitorSmartphone from 'lucide-react/dist/esm/icons/monitor-smartphone.js'
import { fmtDate } from '../../utils/formatters'
import {
  approveDevice,
  getAllDevices,
  getLiveSessions,
  getPendingDevices,
  rejectDevice,
  revokeAllUserSessions,
  revokeDevice,
  revokeLiveSession,
  type LiveSessionRecord,
  type TrustedDeviceRecord,
} from '../../api/deviceAdminTransport.ts'

type TranslateFn = (key: string) => string
type NotifyFn = (message: string, tone?: string) => void

interface DeviceApprovalsProps {
  t: TranslateFn
  notify: NotifyFn
}

function tr(t: TranslateFn, key: string, fallback: string): string {
  return t(key) || fallback
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
  const [pending, setPending] = useState<TrustedDeviceRecord[]>([])
  const [approvedDevices, setApprovedDevices] = useState<TrustedDeviceRecord[]>([])
  const [rejectedHistory, setRejectedHistory] = useState<TrustedDeviceRecord[]>([])
  const [sessions, setSessions] = useState<LiveSessionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  // Session ids and device ids are separate sequences -- separate busy state
  // so a session action can't disable an unrelated device button.
  const [busySessionId, setBusySessionId] = useState<number | null>(null)
  const [busyUserId, setBusyUserId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pendingRes, allRes, sessionsRes] = await Promise.all([
        getPendingDevices(),
        getAllDevices(),
        getLiveSessions(),
      ])
      setPending(pendingRes?.devices || [])
      const nonPending = (allRes?.devices || []).filter((device) => device.status !== 'pending')
      setApprovedDevices(nonPending.filter((device) => device.status === 'approved'))
      setRejectedHistory(nonPending.filter((device) => device.status !== 'approved'))
      setSessions(sessionsRes?.sessions || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(t, 'device_load_failed', 'Could not load device requests.'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const runAction = async (id: number, action: 'approve' | 'reject' | 'revoke', successMessage: string) => {
    setBusyId(id)
    try {
      if (action === 'approve') await approveDevice(id)
      else if (action === 'reject') await rejectDevice(id)
      else await revokeDevice(id)
      notify(successMessage, 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : tr(t, 'device_action_failed', 'Action failed. Please try again.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const runSessionRevoke = async (sessionId: number) => {
    setBusySessionId(sessionId)
    try {
      await revokeLiveSession(sessionId)
      notify(tr(t, 'session_revoked_notice', 'Session ended. That device is signed out.'), 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : tr(t, 'device_action_failed', 'Action failed. Please try again.'), 'error')
    } finally {
      setBusySessionId(null)
    }
  }

  const runSignOutEverywhere = async (userId: number) => {
    setBusyUserId(userId)
    try {
      const result = await revokeAllUserSessions(userId)
      const count = Number(result?.revoked || 0)
      notify(
        `${tr(t, 'sessions_revoked_notice', 'Signed the account out everywhere.')} (${count})`,
        'success',
      )
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : tr(t, 'device_action_failed', 'Action failed. Please try again.'), 'error')
    } finally {
      setBusyUserId(null)
    }
  }

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
      <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">
        {device.device_name || tr(t, 'unknown_device', 'Unknown device')}
      </div>
      <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
        {tr(t, 'account', 'Account')}: {device.user_name || device.username}
        {device.last_ip || device.first_ip ? ` \u00b7 ${device.last_ip || device.first_ip}` : ''}
      </div>
      <div className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
        {device.user_agent || tr(t, 'unknown_browser', 'Unknown browser')}
      </div>
      <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
        {tr(t, 'requested', 'Requested')} {fmtDate(device.requested_at)} · {tr(t, 'last_seen', 'Last seen')} {fmtDate(device.last_seen_at)}
        {device.decided_by_name ? ` · ${tr(t, 'decided_by', 'Decided by')} ${device.decided_by_name}` : ''}
      </div>
    </div>
  )

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
                    onClick={() => runAction(device.id, 'approve', tr(t, 'device_approved', 'Device approved.'))}
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
                      {group.devices.length} {tr(t, 'devices_word', 'devices')} · {group.sessions.length} {tr(t, 'live_sessions_word', 'live sessions')}
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
                          <div className="truncate text-sm text-gray-900 dark:text-white">
                            {session.device_name || tr(t, 'unknown_device', 'Unknown device')}
                            <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {tr(t, 'live_session', 'Live session')}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

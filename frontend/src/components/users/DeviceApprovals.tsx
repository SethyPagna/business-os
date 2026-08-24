import { useCallback, useEffect, useState } from 'react'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import ShieldX from 'lucide-react/dist/esm/icons/shield-x.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import { fmtDate } from '../../utils/formatters'
import {
  approveDevice,
  getAllDevices,
  getPendingDevices,
  rejectDevice,
  revokeDevice,
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

// Admin device-approval panel -- Settings/Users > Devices. Lists devices
// awaiting approval (top, most actionable) and the full approve/reject/
// revoke history below. Backend enforces admin-control access on every
// call (routes/devices.ts) regardless of what this panel shows, so a
// stale/incorrect frontend permission check here can't itself grant
// access -- this UI is convenience, not the security boundary.
export default function DeviceApprovals({ t, notify }: DeviceApprovalsProps) {
  const [pending, setPending] = useState<TrustedDeviceRecord[]>([])
  const [history, setHistory] = useState<TrustedDeviceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pendingRes, allRes] = await Promise.all([getPendingDevices(), getAllDevices()])
      setPending(pendingRes?.devices || [])
      setHistory((allRes?.devices || []).filter((device) => device.status !== 'pending'))
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
        <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {tr(t, 'device_history', 'Device history')}
        </h3>
        {!history.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">{tr(t, 'no_device_history', 'No decisions yet.')}</div>
        ) : (
          <div className="space-y-2">
            {history.map((device) => (
              <div
                key={device.id}
                className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between"
              >
                {renderDeviceMeta(device)}
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      device.status === 'approved'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}
                  >
                    {device.status === 'approved' ? tr(t, 'approved', 'Approved') : tr(t, 'rejected', 'Rejected')}
                  </span>
                  {device.status === 'approved' ? (
                    <button
                      type="button"
                      disabled={busyId === device.id}
                      className="btn-secondary px-2.5 py-1 text-xs text-red-600"
                      onClick={() => runAction(device.id, 'revoke', tr(t, 'device_revoked', 'Device access revoked.'))}
                    >
                      {tr(t, 'revoke', 'Revoke')}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

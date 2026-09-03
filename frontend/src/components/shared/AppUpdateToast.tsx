import { useCallback, useEffect, useState } from 'react'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  applyAppUpdate,
  dismissAppUpdate,
  getAppUpdateBlocker,
  shouldPromptForAppUpdate,
  type AppUpdateBlocker,
} from '../../utils/appUpdate.ts'

interface AppUpdateDetail {
  version?: string
  message?: string
  waiting?: boolean
}

interface AppUpdateBuffer {
  getPendingAppUpdate?: () => AppUpdateDetail | null | undefined
  clearPendingAppUpdate?: () => void
}

function getAppUpdateBuffer(): AppUpdateBuffer {
  if (typeof window === 'undefined') return {}
  return (window as unknown as { api?: AppUpdateBuffer }).api || {}
}

// P2-9 finding 3. The service worker has broadcast
// BUSINESS_OS_APP_UPDATE_AVAILABLE since Section 8b and App.tsx has stored it
// in `appUpdate` state since then -- but the value was never destructured by
// the consumer, so no UI has ever rendered it. The only way to pick up a new
// version was Sidebar's account panel -> "Refresh / check for update", which a
// cashier has no reason to ever open. This component is the missing surface.
//
// Deliberately a toast and not a modal: an update is never urgent enough to
// interrupt a checkout. It does not trap focus, does not cover the POS total
// or the bottom nav, and both of its actions are dismissive -- the app stays
// fully usable with it on screen.
export default function AppUpdateToast() {
  const { t } = useAppHook() as { t: (key: string) => string }
  const [detail, setDetail] = useState<AppUpdateDetail | null>(null)
  const [blocker, setBlocker] = useState<AppUpdateBlocker>(null)
  const [busy, setBusy] = useState(false)

  const offer = useCallback((next: AppUpdateDetail | null | undefined) => {
    if (!next) return
    if (!shouldPromptForAppUpdate(String(next.version || ''))) return
    setDetail(next)
    setBlocker(null)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onUpdate = (event: Event) => {
      offer(event instanceof CustomEvent ? event.detail as AppUpdateDetail : { message: 'New version ready' })
    }
    window.addEventListener('sync:app-update-available', onUpdate)
    // The broadcast is fire-and-forget and can land before this component
    // mounts (it is rendered inside the authenticated shell, and the SW
    // activates whenever it likes -- including while the user is still on the
    // login screen). web-api.ts buffers the most recent detail for exactly
    // this case; drain it on mount, then clear it: offer() has by then
    // recorded the decision durably in localStorage, so a remount does not
    // need the buffer to avoid re-asking.
    const buffer = getAppUpdateBuffer()
    const buffered = buffer.getPendingAppUpdate?.()
    if (buffered) {
      offer(buffered)
      buffer.clearPendingAppUpdate?.()
    }
    return () => window.removeEventListener('sync:app-update-available', onUpdate)
  }, [offer])

  // While the toast is up, keep the blocker line honest: the user may be
  // saving the very form that is blocking them. Re-checking on an interval
  // (rather than only on click) is what turns "you can't yet" into "you can
  // now" without a second failed click.
  useEffect(() => {
    if (!detail || !blocker) return undefined
    const timer = window.setInterval(() => {
      if (!getAppUpdateBlocker()) setBlocker(null)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [detail, blocker])

  if (!detail) return null

  const later = () => {
    dismissAppUpdate(String(detail.version || ''))
    setDetail(null)
  }

  const update = async () => {
    if (busy) return
    setBusy(true)
    try {
      // applyAppUpdate re-checks the guard itself and returns the reason
      // instead of reloading -- this component can never reload past it.
      const refused = await applyAppUpdate(String(detail.version || ''))
      if (refused) setBlocker(refused)
    } finally {
      setBusy(false)
    }
  }

  const blockerMessage = blocker === 'sale-in-flight'
    ? (t('wait_for_sale_before_update') || 'Wait for the current sale to finish before updating the app.')
    : blocker === 'unsaved-work'
      ? (t('save_or_discard_before_update') || 'Save or discard your unfinished work before updating the app.')
      : ''

  return (
    <div
      className="fixed inset-x-2 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[160] rounded-xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:inset-x-auto md:bottom-4 md:right-4 md:w-[22rem]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('update_available') || 'New version available'}
          </p>
          {blockerMessage ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{blockerMessage}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={later}>
          {t('later') || 'Later'}
        </button>
        <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => { void update() }} disabled={busy}>
          {t('update_now') || 'Update now'}
        </button>
      </div>
    </div>
  )
}

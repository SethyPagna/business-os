import { useEffect, useState } from 'react'
import Database from 'lucide-react/dist/esm/icons/database.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { requestPersistentAppStorage } from '../../api/syncRuntime.ts'
import InfoHint from './InfoHint.tsx'

const DISMISSED_KEY = 'businessos_storage_eviction_dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch (_) {
    return false
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch (_) {
    // A device that cannot write this flag will be told once more later.
    // Failing loudly here would be worse than a repeated hint.
  }
}

// P2-9 finding 4. Two halves, both broken before this component existed:
//
// 1. WHEN THE REQUEST HAPPENS. requestPersistentAppStorage() was called from
//    exactly one place -- AppContext.tsx's login() success branch. That covers
//    a fresh sign-in and nothing else. The overwhelmingly common way this app
//    is opened is a RESTORED session (the installed PWA relaunches and the
//    stored session is still valid), which never runs login() and therefore
//    never asked the browser to persist the origin at all. This component
//    mounts inside the authenticated shell, so it runs for both paths.
//    AppContext's own call is left in place deliberately: syncRuntime.ts
//    memoises the promise, so the two call sites are still one real request,
//    and its console breadcrumb is what support reads.
//
// 2. WHETHER THE USER IS TOLD. web-api.ts:432 already computes
//    'persistent' | 'eviction_possible' -- but only inside unlockOfflineVault,
//    and only to write it into IndexedDB. Nothing has ever surfaced it. On a
//    non-persistent origin iOS can drop the offline sales queue and the cached
//    app shell with no warning and no way for the user to have known.
//
// Shown once and dismissible: this is a device property the user can act on
// exactly once (install to the Home Screen), so repeating it is nagging.
export default function StoragePersistenceNotice() {
  const { t } = useAppHook() as { t: (key: string) => string }
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return undefined
    if (readDismissed()) return undefined
    let cancelled = false
    void requestPersistentAppStorage().then((granted) => {
      // Only 'eviction_possible' is worth the user's attention. A granted
      // origin is the expected outcome and says nothing actionable.
      if (cancelled || granted) return
      setVisible(true)
    })
    return () => { cancelled = true }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    writeDismissed()
    setVisible(false)
  }

  return (
    <div
      className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg dark:border-amber-800 dark:bg-amber-950/90"
      role="status"
    >
      <Database className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {t('storage_eviction_title') || 'Offline data may be cleared'}
          <InfoHint
            className="ml-1 align-middle"
            label={t('storage_eviction_title') || 'Offline data may be cleared'}
            text={t('storage_eviction_detail') || 'Offline sales waiting to sync and the saved app pages can be removed when the device runs low on space. Add the app to your Home Screen and open it from there -- browsers keep data for installed apps.'}
          />
        </p>
        <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
          {t('storage_eviction_body') || 'This browser did not grant permanent storage.'}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="flex-shrink-0 rounded-full p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
        aria-label={t('dismiss') || 'Dismiss'}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

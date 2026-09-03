import { useEffect, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Share from 'lucide-react/dist/esm/icons/share.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import InfoHint from './InfoHint.tsx'
import {
  dismissIosInstallHint,
  hasDeferredInstallPrompt,
  onInstallPromptAvailable,
  promptAppInstall,
  shouldOfferIosInstallHint,
} from '../../platform/runtime/standaloneNavigation.ts'

// Section 8b (PWA/iOS): two unrelated "get this app installed" gaps share one
// banner slot since they are mutually exclusive per device:
//
// - iOS Safari has no beforeinstallprompt event and no programmatic install
//   trigger at all -- Share -> Add to Home Screen is the only path onto a
//   home screen there, and it has zero discoverability on its own. That half
//   is a one-time TEXT nudge (localStorage-gated, see standaloneNavigation.ts).
// - Android/desktop Chromium browsers fire beforeinstallprompt instead, which
//   standaloneNavigation.ts captures at module load (before this component
//   ever mounts). That half is a real BUTTON that replays the captured
//   native prompt -- there is nothing to explain, so no dismiss/localStorage
//   gating is needed: the browser stops firing the event once installed
//   (`appinstalled`) and a declined prompt can legitimately be offered again
//   later (the browser itself decides whether/when to re-fire it).
//
// Both are hidden once the app is already running standalone.
export default function IosInstallHint() {
  const { t } = useAppHook() as { t: (key: string) => string }
  const [showIosHint, setShowIosHint] = useState(false)
  const [showAndroidPrompt, setShowAndroidPrompt] = useState(false)

  useEffect(() => {
    setShowIosHint(shouldOfferIosInstallHint())
    setShowAndroidPrompt(hasDeferredInstallPrompt())
    return onInstallPromptAvailable(() => setShowAndroidPrompt(true))
  }, [])

  if (showAndroidPrompt) {
    const install = async () => {
      // Optimistically hide first: the prompt is single-use regardless of
      // outcome (accepted, dismissed, or a stale/expired reference), so
      // there is nothing left to show either way once this resolves.
      setShowAndroidPrompt(false)
      await promptAppInstall()
    }

    return (
      <div
        className="fixed inset-x-0 bottom-0 z-[150] flex items-center gap-2.5 border-t border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] dark:border-blue-800 dark:bg-blue-950/90 dark:text-blue-100"
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
        role="status"
      >
        <Download className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{t('install_app') || 'Install app'}</span>
        <button
          type="button"
          onClick={install}
          className="flex-shrink-0 rounded-md bg-blue-700 px-3 py-1 font-medium text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {t('install_app') || 'Install app'}
        </button>
        <button
          type="button"
          onClick={() => setShowAndroidPrompt(false)}
          className="flex-shrink-0 rounded-full p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900"
          aria-label={t('dismiss') || 'Dismiss'}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (!showIosHint) return null

  const dismiss = () => {
    dismissIosInstallHint()
    setShowIosHint(false)
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[150] flex items-center gap-2.5 border-t border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] dark:border-blue-800 dark:bg-blue-950/90 dark:text-blue-100"
      style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
      role="status"
    >
      <Share className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {t('ios_install_hint') || 'Install this app: tap Share, then "Add to Home Screen".'}
        {/* P2-9 finding 8: the visible copy stays one short line naming both
            steps; the why-bother and the rest of the detail move behind the
            hint rather than growing this band into a paragraph the user has
            to read past to get back to work. */}
        <InfoHint
          className="ml-1 align-middle"
          label={t('install_app') || 'Install app'}
          text={t('ios_install_hint_detail') || 'Tap Share in Safari, then Add to Home Screen. Installed, the app gets its own icon and keeps working offline.'}
        />
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="flex-shrink-0 rounded-full p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-200 dark:hover:bg-blue-900"
        aria-label={t('dismiss') || 'Dismiss'}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

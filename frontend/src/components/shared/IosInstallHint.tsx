import { useEffect, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Share from 'lucide-react/dist/esm/icons/share.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import {
  dismissIosInstallHint,
  hasDeferredInstallPrompt,
  isHandheldInstallTarget,
  onInstallPromptAvailable,
  promptAppInstall,
  shouldOfferIosInstallHint,
} from '../../utils/standaloneNavigation.ts'
import InfoHint from './InfoHint.tsx'

// G5: the app had no install affordance of any kind -- no beforeinstallprompt
// capture, no Share -> Add to Home Screen hint, no navigator.standalone check
// anywhere in the codebase. That matters most on iOS, where an uninstalled
// origin is the one subject to ITP's 7-day storage cap (see C5's eviction
// band, which this hint is the fix for).
//
// Two mutually exclusive halves, one band slot:
//
//   - iOS Safari: a TEXT hint toward Share -> Add to Home Screen, because
//     there is no programmatic install trigger on iOS at all. Dismissible,
//     and the dismissal is a 14-day snooze rather than "never": a till that
//     is still not installed two weeks later still has the problem.
//   - Android/Chromium: a real Install BUTTON replaying the captured native
//     prompt. Nothing to explain, so no dismissal state -- the browser stops
//     firing the event once installed, and it decides for itself whether a
//     declined prompt may be offered again.
//
// Never on desktop (isHandheldInstallTarget), never once already standalone
// (both halves check it), and never on the public storefront: App.tsx mounts
// this below the isPublicCatalogRoute early return and below the signed-out
// returns, so no shopper and no login screen can reach it.
//
// The band renders its real content from first paint. There is no collapsed
// stub that expands once something else is answered.
export default function IosInstallHint() {
  const { t } = useAppHook() as { t: (key: string) => string }
  const [showIosHint, setShowIosHint] = useState(false)
  const [showInstallButton, setShowInstallButton] = useState(false)

  useEffect(() => {
    if (!isHandheldInstallTarget()) return undefined
    setShowIosHint(shouldOfferIosInstallHint())
    setShowInstallButton(hasDeferredInstallPrompt())
    // The capture is armed at boot (App.tsx), but Chromium decides when to
    // fire beforeinstallprompt -- often after this component has mounted.
    return onInstallPromptAvailable(() => setShowInstallButton(true))
  }, [])

  if (showInstallButton) {
    const install = async () => {
      // Hidden first: the prompt is spent either way (accepted, dismissed or
      // a stale reference), so there is nothing left to offer once it
      // resolves.
      setShowInstallButton(false)
      await promptAppInstall()
    }

    return (
      <div
        className="pointer-events-auto flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs leading-6 text-blue-900 shadow-lg dark:border-blue-700 dark:bg-blue-950/90 dark:text-blue-100"
        role="status"
      >
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words font-semibold">
          {t('install_app') || 'Install app'}
        </span>
        <InfoHint
          className="shrink-0"
          label={t('install_app') || 'Install app'}
          text={t('ios_install_hint_detail') || 'Installed, the app gets its own icon and keeps working offline, and the browser keeps its saved data instead of clearing it.'}
        />
        <button
          type="button"
          onClick={() => { void install() }}
          className="shrink-0 rounded-full bg-blue-700 px-3 font-semibold leading-6 text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {t('install_app') || 'Install app'}
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
      className="pointer-events-auto flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs leading-6 text-blue-900 shadow-lg dark:border-blue-700 dark:bg-blue-950/90 dark:text-blue-100"
      role="status"
    >
      <Share className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* One short visible line naming both steps; the why-bother lives in the
          InfoHint instead of growing this band into a paragraph. No
          truncation and leading-6 so the Khmer wording gets its full height
          rather than being clipped by a Latin-sized line box. */}
      <span className="min-w-0 flex-1 break-words">
        {t('ios_install_hint') || 'Install this app: tap Share, then "Add to Home Screen".'}
      </span>
      <InfoHint
        className="shrink-0"
        label={t('install_app') || 'Install app'}
        text={t('ios_install_hint_detail') || 'Installed, the app gets its own icon and keeps working offline, and the browser keeps its saved data instead of clearing it.'}
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss_notification') || 'Dismiss notification'}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-base leading-none opacity-70 hover:bg-current/10 hover:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

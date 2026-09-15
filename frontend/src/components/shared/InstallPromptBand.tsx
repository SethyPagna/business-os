import { useEffect, useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Share from 'lucide-react/dist/esm/icons/share.js'
import {
  dismissIosInstallHint,
  hasDeferredInstallPrompt,
  isHandheldInstallTarget,
  onInstallPromptAvailable,
  promptAppInstall,
  shouldOfferIosInstallHint,
} from '../../utils/standaloneNavigation.ts'
import InfoHint from './InfoHint.tsx'

/**
 * Shared translate signature both callers adapt to: the admin app's flat
 * `t(key)` (IosInstallHint.tsx) and the public storefront's `copy(key,
 * fallback, fallbackKm)` (PublicCatalogPage.tsx), which does not resolve
 * these top-level `lang/*.json` keys through its own `portalEditor.*`
 * pack lookup -- so the Khmer text has to be supplied here, not assumed
 * to come back from the translate function on its own.
 */
export type InstallPromptTranslate = (key: string, fallback: string, fallbackKm?: string) => string

// The device/prompt logic that used to live directly in IosInstallHint.tsx,
// now shared with the public storefront (App.tsx never mounts for the
// public route -- see PublicCatalogRoot.tsx -- so the admin-only component
// could not simply be reused as-is). Two mutually exclusive halves, one
// band slot:
//
//   - iOS Safari: a TEXT hint toward Share -> Add to Home Screen, because
//     there is no programmatic install trigger on iOS at all. Dismissible,
//     and the dismissal is a 14-day snooze rather than "never".
//   - Android/Chromium: a real Install BUTTON replaying the captured native
//     prompt. Nothing to explain, so no dismissal state -- the browser stops
//     firing the event once installed, and it decides for itself whether a
//     declined prompt may be offered again.
//
// Never on desktop (isHandheldInstallTarget), never once already standalone
// (both halves check it). Renders its real content from first paint -- no
// collapsed stub that expands once something else is answered.
export default function InstallPromptBand({ translate }: { translate: InstallPromptTranslate }) {
  const [showIosHint, setShowIosHint] = useState(false)
  const [showInstallButton, setShowInstallButton] = useState(false)

  useEffect(() => {
    if (!isHandheldInstallTarget()) return undefined
    setShowIosHint(shouldOfferIosInstallHint())
    setShowInstallButton(hasDeferredInstallPrompt())
    // The capture is armed at boot by each caller, but Chromium decides when
    // to fire beforeinstallprompt -- often after this component has mounted.
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
          {translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')}
        </span>
        <InfoHint
          className="shrink-0"
          label={translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')}
          text={translate(
            'ios_install_hint_detail',
            'Installed, the app gets its own icon and keeps working offline, and the browser keeps its saved data instead of clearing it.',
            'ពេលដំឡើងរួច កម្មវិធីមានរូបតំណាងផ្ទាល់ខ្លួន នៅតែអាចប្រើបានក្រៅបណ្ដាញ ហើយកម្មវិធីរុករករក្សាទិន្នន័យដែលបានរក្សាទុក ជំនួសឱ្យការលុបវា។',
          )}
        />
        <button
          type="button"
          onClick={() => { void install() }}
          className="shrink-0 rounded-full bg-blue-700 px-3 font-semibold leading-6 text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          {translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')}
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
        {translate('ios_install_hint', 'Install this app: tap Share, then "Add to Home Screen".', 'ដំឡើងកម្មវិធីនេះ៖ ចុច ចែករំលែក (Share) រួចជ្រើសរើស "បន្ថែមទៅអេក្រង់ដើម" (Add to Home Screen)។')}
      </span>
      <InfoHint
        className="shrink-0"
        label={translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')}
        text={translate(
          'ios_install_hint_detail',
          'Installed, the app gets its own icon and keeps working offline, and the browser keeps its saved data instead of clearing it.',
          'ពេលដំឡើងរួច កម្មវិធីមានរូបតំណាងផ្ទាល់ខ្លួន នៅតែអាចប្រើបានក្រៅបណ្ដាញ ហើយកម្មវិធីរុករករក្សាទិន្នន័យដែលបានរក្សាទុក ជំនួសឱ្យការលុបវា។',
        )}
      />
      <button
        type="button"
        onClick={dismiss}
        aria-label={translate('dismiss_notification', 'Dismiss notification', 'បិទការជូនដំណឹង')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-base leading-none opacity-70 hover:bg-current/10 hover:opacity-100"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

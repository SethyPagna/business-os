import { useSyncExternalStore } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Share from 'lucide-react/dist/esm/icons/share.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import {
  dismissInstallBand,
  installBandRoute,
  promptAppInstall,
  subscribeInstallOffer,
} from '../../utils/standaloneNavigation.ts'
import InfoHint from './InfoHint.tsx'

/** The storefront's copy() never resolves these top-level pack keys, so every call carries its own Khmer. */
export type InstallPromptTranslate = (key: string, fallback: string, fallbackKm: string) => string

/** The admin t() answers a missing key with the key itself, so the caller's text in the UI language takes over. */
export function translateFromPack(t: (key: string) => string, language: string): InstallPromptTranslate {
  return (key, fallback, fallbackKm) => {
    const packed = t(key)
    if (packed && packed !== key) return packed
    return language === 'km' ? fallbackKm : fallback
  }
}

const noRouteOutsideBrowser = () => null

export default function InstallPromptBand({ translate }: { translate: InstallPromptTranslate }) {
  const route = useSyncExternalStore(subscribeInstallOffer, installBandRoute, noRouteOutsideBrowser)
  if (!route) return null

  const installLabel = translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')
  const closeLabel = translate('dismiss_notification', 'Dismiss notification', 'បិទការជូនដំណឹង')
  const iosShare = route === 'ios-share'

  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs leading-6 text-blue-900 shadow-lg dark:border-blue-700 dark:bg-blue-950/90 dark:text-blue-100"
      role="status"
    >
      {iosShare ? <Share className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 break-words">
        {iosShare
          ? translate('ios_install_hint', 'Install: tap ••• or Share, then Add to Home Screen.', 'ដំឡើង៖ ចុច ••• ឬ ចែករំលែក (Share) រួចជ្រើសរើស បន្ថែមទៅអេក្រង់ដើម (Add to Home Screen)។')
          : installLabel}
      </span>
      <InfoHint
        className="shrink-0"
        label={installLabel}
        text={translate(
          'install_offer_detail',
          'Opens from its own icon on your home screen. It still needs the internet, and the phone keeps its saved sign-in instead of clearing it.',
          'បើកពីរូបតំណាងផ្ទាល់ខ្លួននៅលើអេក្រង់ដើម។ វានៅតែត្រូវការអ៊ីនធឺណិត ហើយទូរសព្ទរក្សាការចូលគណនីដែលបានរក្សាទុក ជំនួសឱ្យការលុបវា។',
        )}
      />
      {iosShare ? null : (
        <button
          type="button"
          onClick={() => { void promptAppInstall() }}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-700 px-3 font-semibold leading-6 text-white hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {translate('install_app_short', 'Install', 'ដំឡើង')}
        </button>
      )}
      <button
        type="button"
        onClick={dismissInstallBand}
        aria-label={closeLabel}
        title={closeLabel}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-current/10 hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

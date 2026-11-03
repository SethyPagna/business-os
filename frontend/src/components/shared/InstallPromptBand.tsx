import { Suspense, useRef, useState, useSyncExternalStore } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { isAdminHostname } from '../../app/pathRouting.ts'
import {
  dismissInstallBand,
  installBandRoute,
  promptAppInstall,
  subscribeInstallOffer,
} from '../../utils/standaloneNavigation.ts'
import { hasBottomActionBar, subscribeBottomActionBar } from '../../utils/bottomActionBar.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { useInstallBandClearance } from '../../utils/useInstallBandClearance.ts'

const IosInstallSteps = lazyRetry(() => import('../install/IosInstallSteps.tsx'), 'install-ios-steps')

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

const subscribeOfferOrBottomBar = (listener: () => void) => {
  const offer = subscribeInstallOffer(listener)
  const bar = subscribeBottomActionBar(listener)
  return () => { offer(); bar() }
}

const STAFF_APP_ICON = '/icon-192.png'
const SHOP_APP_ICON = '/leang-cosmetics-icon-192-v2.png'
// Under 360 px (iPhone SE class) the band is one short row: icon, one word, X. The sentence goes, unless it is the whole message.
const HIDDEN_WHEN_NARROW = 'max-[359px]:hidden'

export default function InstallPromptBand({ translate }: { translate: InstallPromptTranslate }) {
  // The admin host installs the staff app; every other host is the shop, which names itself.
  const staffApp = isAdminHostname()
  // A page with its own bottom-pinned primary action (the till) is never covered by the offer.
  const route = useSyncExternalStore(subscribeOfferOrBottomBar, () => (hasBottomActionBar() ? null : installBandRoute(staffApp)), noRouteOutsideBrowser)
  const [iosStepsOpen, setIosStepsOpen] = useState(false)
  const bandRef = useRef<HTMLDivElement>(null)
  useInstallBandClearance(bandRef, route !== null)
  if (!route) return null

  const title = staffApp
    ? translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')
    : translate('install_shop_band', 'Install Leang Cosmetics', 'ដំឡើង Leang Cosmetics')
  const detail = route === 'ios-share'
    ? translate('ios_install_hint', 'Add it to your Home Screen in 3 steps.', 'បន្ថែមទៅអេក្រង់ដើម ក្នុង ៣ ជំហាន។')
    : route === 'open-elsewhere'
      ? translate('install_open_elsewhere_hint', 'Open this page in Chrome or Safari to install.', 'បើកទំព័រនេះក្នុង Chrome ឬ Safari ដើម្បីដំឡើង។')
      : translate('install_offer_detail', 'Opens from its own icon on your home screen.', 'បើកពីរូបតំណាងផ្ទាល់ខ្លួននៅលើអេក្រង់ដើម។')
  const closeLabel = translate('dismiss_notification', 'Dismiss notification', 'បិទការជូនដំណឹង')
  const install = () => {
    if (route === 'ios-share') setIosStepsOpen(true)
    else void promptAppInstall()
  }

  return (
    <div
      ref={bandRef}
      className="pointer-events-auto flex w-full items-center gap-3 rounded-2xl border border-blue-300 bg-blue-50 px-3 py-2.5 text-blue-900 shadow-lg max-[359px]:gap-2 max-[359px]:py-2 dark:border-blue-700 dark:bg-blue-950/90 dark:text-blue-100"
      role="status"
    >
      <img
        src={staffApp ? STAFF_APP_ICON : SHOP_APP_ICON}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-xl max-[359px]:h-8 max-[359px]:w-8"
      />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm font-semibold leading-5 ${route === 'open-elsewhere' ? HIDDEN_WHEN_NARROW : ''}`}>{title}</p>
        <p className={`break-words text-xs leading-4 opacity-80 ${route === 'open-elsewhere' ? '' : HIDDEN_WHEN_NARROW}`}>{detail}</p>
      </div>
      {route === 'open-elsewhere' ? null : (
        <button
          type="button"
          onClick={install}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-700 px-3.5 py-2 text-sm font-semibold leading-5 text-white max-[359px]:px-3 max-[359px]:py-1.5 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500"
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
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-current/10 hover:opacity-100"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {iosStepsOpen ? (
        <Suspense fallback={null}>
          <IosInstallSteps translate={translate} onClose={() => setIosStepsOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  )
}

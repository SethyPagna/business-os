import { Suspense, useState, useSyncExternalStore } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { installMenuRoute, promptAppInstall, subscribeInstallOffer } from '../../utils/standaloneNavigation.ts'
import type { InstallPromptTranslate } from '../shared/InstallPromptBand.tsx'

const IosInstallSteps = lazyRetry(() => import('./IosInstallSteps.tsx'), 'install-ios-steps')

const noRouteOutsideBrowser = () => null

type InstallAppButtonProps = {
  translate: InstallPromptTranslate
  className: string
}

export default function InstallAppButton({ translate, className }: InstallAppButtonProps) {
  const route = useSyncExternalStore(subscribeInstallOffer, installMenuRoute, noRouteOutsideBrowser)
  const [iosStepsOpen, setIosStepsOpen] = useState(false)
  if (!route) return null

  const label = translate('install_app', 'Install app', 'ដំឡើងកម្មវិធី')
  const install = () => {
    if (route === 'ios-share') setIosStepsOpen(true)
    else void promptAppInstall()
  }

  return (
    <>
      <button type="button" onClick={install} aria-label={label} title={label} className={className}>
        <Download className="h-5 w-5" aria-hidden="true" />
      </button>
      {iosStepsOpen ? (
        <Suspense fallback={null}>
          <IosInstallSteps translate={translate} onClose={() => setIosStepsOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}

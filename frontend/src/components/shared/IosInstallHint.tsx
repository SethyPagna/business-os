import { useApp as useAppHook } from '../../AppContext.tsx'
import { isAdminHostname } from '../../app/pathRouting.ts'
import InstallPromptBand, { translateFromPack } from './InstallPromptBand.tsx'

// Admin host only: staff who reach the admin screens on the shop host must not install a shop-named app.
export default function IosInstallHint() {
  const { t, language } = useAppHook() as { t: (key: string) => string; language: string }
  if (!isAdminHostname()) return null
  return <InstallPromptBand translate={translateFromPack(t, language)} />
}

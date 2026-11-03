import { useApp as useAppHook } from '../../AppContext.tsx'
import { isAdminHostname } from '../../app/pathRouting.ts'
import { pageHasBottomActionBar } from '../../utils/bottomActionBar.ts'
import InstallPromptBand, { translateFromPack } from './InstallPromptBand.tsx'

// Admin host only: staff who reach the admin screens on the shop host must not install a shop-named app.
export default function IosInstallHint() {
  const { t, language, page } = useAppHook() as { t: (key: string) => string; language: string; page?: string }
  // The till's Complete Sale is pinned to the bottom: no offer over it, from the very first paint of a cold open.
  if (!isAdminHostname() || pageHasBottomActionBar(page)) return null
  return <InstallPromptBand translate={translateFromPack(t, language)} />
}

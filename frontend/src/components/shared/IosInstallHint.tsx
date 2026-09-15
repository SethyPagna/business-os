import { useApp as useAppHook } from '../../AppContext.tsx'
import InstallPromptBand from './InstallPromptBand.tsx'

// G5: the app had no install affordance of any kind -- no beforeinstallprompt
// capture, no Share -> Add to Home Screen hint, no navigator.standalone check
// anywhere in the codebase. That matters most on iOS, where an uninstalled
// origin is the one subject to ITP's 7-day storage cap (see C5's eviction
// band, which this hint is the fix for).
//
// This is the admin-app wrapper: it adapts the admin's own `t(key)`
// translator to InstallPromptBand's shared `translate(key, fallback,
// fallbackKm)` signature. The device/prompt logic and both rendered halves
// (iOS text hint, Android install button) live in InstallPromptBand.tsx,
// shared with the public storefront's own wrapper
// (PublicCatalogPage.tsx) -- App.tsx never mounts for the public route, so
// this component alone could never reach shoppers.
//
// Never on desktop (isHandheldInstallTarget, inside InstallPromptBand),
// never once already standalone, and never on the public storefront: App.tsx
// mounts this below the isPublicCatalogRoute early return and below the
// signed-out returns, so no shopper and no login screen can reach it.
export default function IosInstallHint() {
  const { t } = useAppHook() as { t: (key: string) => string }
  return <InstallPromptBand translate={(key, fallback) => t(key) || fallback} />
}

// The one third-party embed on the storefront, behind a click (N45).
//
// Evidence for why this exists: the only
// automatically-loading third party on the public catalogue is the Google
// Maps iframe in CatalogSecondaryTabs.tsx, which would be fetched as soon as the
// About tab renders and can set Google's own cookies without the visitor ever
// asking for a map. Everything else the storefront stores is either strictly
// necessary or explicitly requested. The map is gated at the moment data
// would leave the storefront; the policy separately describes app-managed
// storage without making a universal claim about banner requirements.
//
// The visitor's choice is remembered on their own device so the map is not
// re-gated on every visit. That preference is itself disclosed in the cookie
// table (LEGAL_STORAGE_ROWS).
import { useCallback, useEffect, useState } from 'react'
import EyeOff from 'lucide-react/dist/esm/icons/eye-off.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import { PORTAL_PRIMARY_BUTTON } from '../portalButtons.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export const MAP_CONSENT_STORAGE_KEY = 'business-os-portal-map-consent-v1'

export const MAP_CONSENT_REVOKE_EN = 'Unload map and forget this choice'
export const MAP_CONSENT_REVOKE_KM = 'បិទផែនទី និងលុបជម្រើសនេះពីឧបករណ៍'

const LOAD_BUTTON = PORTAL_PRIMARY_BUTTON
const ICON_LINK = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 dark:text-neutral-300 dark:hover:bg-neutral-800'

function readStoredChoice(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MAP_CONSENT_STORAGE_KEY) === 'granted'
  } catch {
    // Private windows and "block site data" browsers throw on access; the
    // visitor simply gets asked again.
    return false
  }
}

/**
 * Builds the "open it yourself" link: a plain Google Maps search for the
 * shop's address, so declining the embed is not a dead end. Falls back to the
 * embed URL when there is no address to search for -- opening that in a new
 * tab is still the visitor's own explicit action.
 */
export function mapFallbackHref(address: string, embedUrl: string): string {
  const trimmed = String(address || '').trim()
  if (!trimmed) return embedUrl
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`
}

export default function PortalEmbedConsent({
  copy,
  src,
  title,
  address = '',
  frameClassName = 'h-72 w-full border-0',
  className = '',
}: {
  copy: CopyFn
  src: string
  title: string
  address?: string
  frameClassName?: string
  // Lets the caller's card stretch the embed (the About page puts it beside the contacts).
  className?: string
}) {
  const [granted, setGranted] = useState(false)

  // Read the stored choice after mount, never during render: the storefront is
  // also rendered inside the admin preview, where reading storage during
  // render would make the two surfaces disagree on the first paint.
  useEffect(() => { setGranted(readStoredChoice()) }, [])

  const accept = useCallback(() => {
    setGranted(true)
    try {
      window.localStorage.setItem(MAP_CONSENT_STORAGE_KEY, 'granted')
    } catch {
      // Not remembered; the map still loads for this visit.
    }
  }, [])

  const revoke = useCallback(() => {
    // Unmounting the iframe stops this page from continuing to display the
    // third-party embed. Clearing the stored grant means a later visit asks
    // again before it sends another map request.
    try {
      window.localStorage.removeItem(MAP_CONSENT_STORAGE_KEY)
    } catch {
      // The iframe can still be unloaded for this visit when storage access
      // is blocked by the browser.
    }
    setGranted(false)
  }, [])

  const openLabel = copy('openInGoogleMaps', 'Open in Google Maps', 'បើកក្នុង Google Maps')
  const openLink = (
    <a
      href={mapFallbackHref(address, src)}
      target="_blank"
      rel="noreferrer noopener"
      className={ICON_LINK}
      aria-label={openLabel}
      title={openLabel}
    >
      <ExternalLink aria-hidden="true" className="h-4 w-4" />
    </a>
  )

  if (granted) {
    const revokeLabel = copy('portal_legal_map_consent_revoke', MAP_CONSENT_REVOKE_EN, MAP_CONSENT_REVOKE_KM)
    return (
      <div className={`flex flex-col ${className}`.trim()}>
        <div className="flex justify-end gap-1 px-2 pt-1">
          {openLink}
          <button type="button" onClick={revoke} className={ICON_LINK} aria-label={revokeLabel} title={revokeLabel}>
            <EyeOff aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <iframe
          title={title}
          src={src}
          className={frameClassName}
          loading="lazy"
          // The embed does not need the full storefront URL (which carries the
          // visitor's ?legal= and search state); the origin is enough for Google
          // to serve the map.
          referrerPolicy="strict-origin-when-cross-origin"
          // Google Maps needs scripts and its own origin; it does not need to
          // navigate the storefront out from under the visitor.
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 ${className}`.trim()}>
      <p className="min-w-0 flex-1 basis-40 text-sm leading-7 text-stone-600 dark:text-neutral-300">
        {copy('mapConsentLine', 'Google Maps sets its own cookies.', 'Google Maps កំណត់ខូឃីរបស់ខ្លួន។')}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={accept} className={LOAD_BUTTON}>
          <MapPin aria-hidden="true" className="h-4 w-4" />
          {copy('mapLoad', 'Load map', 'ផ្ទុកផែនទី')}
        </button>
        {openLink}
      </div>
    </div>
  )
}

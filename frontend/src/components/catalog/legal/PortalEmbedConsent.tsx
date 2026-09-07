// The one third-party embed on the storefront, behind a click (N45).
//
// Evidence for why this exists: the only
// automatically-loading third party on the public catalogue is the Google
// Maps iframe in CatalogSecondaryTabs.tsx, which is fetched as soon as the
// About tab renders and can set Google's own cookies without the visitor ever
// asking for a map. Everything else the storefront stores is either strictly
// necessary or explicitly requested (the translate script loads only after a
// visitor picks an external language). The map is gated at the moment data
// would leave the storefront; the policy separately describes app-managed
// storage without making a universal claim about banner requirements.
//
// The visitor's choice is remembered on their own device so the map is not
// re-gated on every visit. That preference is itself disclosed in the cookie
// table (LEGAL_STORAGE_ROWS).
import { useCallback, useEffect, useState } from 'react'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export const MAP_CONSENT_STORAGE_KEY = 'business-os-portal-map-consent-v1'

export const MAP_CONSENT_BODY_EN = 'The map is loaded from Google Maps, which can set its own cookies. Load it only if you want to.'
export const MAP_CONSENT_BODY_KM = 'ផែនទីផ្ទុកពី Google Maps ដែលអាចកំណត់ខូឃីផ្ទាល់ខ្លួន។ សូមផ្ទុកតែបើអ្នកចង់។'
export const MAP_CONSENT_LOAD_EN = 'Load the map'
export const MAP_CONSENT_LOAD_KM = 'ផ្ទុកផែនទី'
export const MAP_CONSENT_LINK_EN = 'Open in Google Maps instead'
export const MAP_CONSENT_LINK_KM = 'បើកក្នុង Google Maps ជំនួសវិញ'
export const MAP_CONSENT_REVOKE_EN = 'Unload map and forget this choice'
export const MAP_CONSENT_REVOKE_KM = 'បិទផែនទី និងលុបជម្រើសនេះពីឧបករណ៍'

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
}: {
  copy: CopyFn
  src: string
  title: string
  address?: string
  frameClassName?: string
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

  if (granted) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex justify-end px-3 pt-3">
          <button
            type="button"
            onClick={revoke}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {copy('portal_legal_map_consent_revoke', MAP_CONSENT_REVOKE_EN, MAP_CONSENT_REVOKE_KM)}
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
    <div className="flex flex-col items-start gap-3 px-5 py-6 text-sm text-slate-600 dark:text-neutral-300">
      <p className="max-w-prose text-xs leading-6">
        {copy('portal_legal_map_consent_b', MAP_CONSENT_BODY_EN, MAP_CONSENT_BODY_KM)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={accept}
          className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-400"
        >
          {copy('portal_legal_map_consent_load', MAP_CONSENT_LOAD_EN, MAP_CONSENT_LOAD_KM)}
        </button>
        <a
          href={mapFallbackHref(address, src)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs font-semibold text-emerald-700 underline underline-offset-2 transition hover:text-emerald-600 dark:text-emerald-300"
        >
          {copy('portal_legal_map_consent_link', MAP_CONSENT_LINK_EN, MAP_CONSENT_LINK_KM)}
        </a>
      </div>
    </div>
  )
}

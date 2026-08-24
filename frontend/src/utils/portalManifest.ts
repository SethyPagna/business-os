export type PortalManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose: 'any' | 'maskable'
}

export type PortalManifestInput = {
  businessName?: string | null
  title?: string | null
  publicPath?: string | null
  icon192?: string | null
  icon512?: string | null
  themeColor?: string | null
  backgroundColor?: string | null
}

export type PortalManifest = {
  name: string
  short_name: string
  start_url: string
  display: 'standalone'
  background_color: string
  theme_color: string
  icons: PortalManifestIcon[]
}

const DEFAULT_PORTAL_MANIFEST_NAME = 'Leang Cosmetics'
const DEFAULT_PORTAL_BACKGROUND_COLOR = '#f9fafb'
const DEFAULT_PORTAL_THEME_COLOR = '#1e3a8a'
const MAX_SHORT_NAME_LENGTH = 30

// Real gap this fixes (see progress.md's public-portal item): the app ships
// one static /manifest.json ("Business OS", generic icon) shared by both the
// internal admin app and every customer's public storefront -- a visitor who
// "Add to Home Screen"s a business's portal gets the ADMIN app's name and
// icon, not that business's own branding. Building this as a small pure
// function (no DOM/Canvas) kept separate from the effect that actually swaps
// the <link rel="manifest"> tag (CatalogPage.tsx) so the manifest CONTENT is
// unit-testable even though the DOM-swap plumbing around it isn't (same
// testability gap the existing favicon/title effect already has -- not
// introducing a new one).
export function buildPortalManifest(input: PortalManifestInput): PortalManifest {
  const name = String(input.businessName || input.title || '').trim() || DEFAULT_PORTAL_MANIFEST_NAME
  const shortName = name.length > MAX_SHORT_NAME_LENGTH ? `${name.slice(0, MAX_SHORT_NAME_LENGTH - 1).trim()}…` : name
  const startUrl = String(input.publicPath || '/customer-portal').trim() || '/customer-portal'

  const icons: PortalManifestIcon[] = []
  if (input.icon192) {
    icons.push({ src: input.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' })
    icons.push({ src: input.icon192, sizes: '192x192', type: 'image/png', purpose: 'maskable' })
  }
  if (input.icon512) {
    icons.push({ src: input.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' })
    icons.push({ src: input.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' })
  }

  return {
    name,
    short_name: shortName,
    start_url: startUrl,
    display: 'standalone',
    background_color: String(input.backgroundColor || '').trim() || DEFAULT_PORTAL_BACKGROUND_COLOR,
    theme_color: String(input.themeColor || '').trim() || DEFAULT_PORTAL_THEME_COLOR,
    icons,
  }
}

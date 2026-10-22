/**
 * Who this deployment belongs to.
 *
 * One build serves every client (Leang Cosmetics, BM Shop): the shop's name,
 * icons and house formats come from wrangler [vars], never from code. A var
 * left unset falls back to the neutral Business OS identity, so a deployment
 * that forgets one shows the product's own name, never another client's.
 *
 * The same resolved object is written into every app document the Worker
 * serves (lib/documentIdentity.ts), where the frontend and the service worker
 * read it
 * (frontend/src/app/clientIdentity.ts), and into the two install manifests
 * below. frontend/index.html carries NEUTRAL_CLIENT_IDENTITY as its static
 * default for documents the Worker never sees (the Vite dev server, an
 * unknown path the asset layer answers on its own).
 */

export type IdentityEnv = {
  BUSINESS_OS_SHOP_NAME?: string
  BUSINESS_OS_SHOP_NAME_KM?: string
  BUSINESS_OS_SHOP_ALIAS?: string
  BUSINESS_OS_SHOP_CATEGORY?: string
  BUSINESS_OS_SHOP_ICON_PREFIX?: string
  BUSINESS_OS_ADMIN_SHORT_NAME?: string
  BUSINESS_OS_ORGANIZATION_NAME?: string
  BUSINESS_OS_MEMBERSHIP_PREFIX?: string
  BUSINESS_OS_ADMIN_URL?: string
  BUSINESS_OS_PUBLIC_URL?: string
}

export type ShopIcons = {
  favicon: string
  icon192: string
  icon512: string
  maskable192: string
  maskable512: string
  appleTouch: string
}

export type ClientIdentity = {
  shopName: string
  shopNameKm: string
  /** The second name the shop is also known by, '' when it has none. */
  shopAlias: string
  /** "Name/Alias" when the shop has an alias, else the name. */
  shopNames: string
  /** 'beauty' switches on the cosmetics wording (AI persona, legal footer); '' is a general shop. */
  shopCategory: '' | 'beauty'
  shopDescription: string
  adminTitle: string
  adminShortName: string
  adminDescription: string
  organizationName: string
  membershipPrefix: string
  /**
   * The staff app's configured host (BM Shop's bm-admin.khshop.workers.dev),
   * '' when unset or unusable. admin.* and loopback are staff hosts without it
   * (lib/publicHostGate.ts).
   */
  staffHost: string
  shopIcons: ShopIcons
}

const NEUTRAL_NAME = 'Business OS'

// The staff app's own icons. A shop without its own artwork uses them too.
export const STAFF_ICONS: ShopIcons = {
  favicon: '/admin-favicon-v1.ico',
  icon192: '/icon-192.png',
  icon512: '/icon-512.png',
  maskable192: '/icon-192-maskable-v2.png',
  maskable512: '/icon-512-maskable-v2.png',
  appleTouch: '/admin-apple-touch-icon-v1.png',
}

// Upper-case letters and digits ending in a hyphen: membershipNumber.ts builds
// a SQLite GLOB from it, so nothing GLOB treats as special may get through.
const MEMBERSHIP_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,5}-$/
const DEFAULT_MEMBERSHIP_PREFIX = 'M-'
// Site-relative only: a leading // would be a protocol-relative URL on another host.
const ICON_PREFIX_PATTERN = /^\/(?!\/)[A-Za-z0-9/_-]*$/

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function membershipPrefixFrom(value: unknown): string {
  const prefix = text(value).toUpperCase()
  return MEMBERSHIP_PREFIX_PATTERN.test(prefix) ? prefix : DEFAULT_MEMBERSHIP_PREFIX
}

function urlHostname(value: unknown): string {
  try {
    const url = new URL(text(value))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}

/**
 * The host of BUSINESS_OS_ADMIN_URL. A staff host that is also the public host
 * (or its www. alias) would open the staff API on the storefront, so that
 * configuration counts as none.
 */
export function staffHostFrom(adminUrl: unknown, publicUrl: unknown): string {
  const host = urlHostname(adminUrl)
  const publicHost = urlHostname(publicUrl)
  if (!host || (publicHost && (host === publicHost || host === `www.${publicHost}`))) return ''
  return host
}

function shopIconsFrom(prefix: string): ShopIcons {
  if (!ICON_PREFIX_PATTERN.test(prefix)) return STAFF_ICONS
  return {
    favicon: `${prefix}favicon-v2.ico`,
    icon192: `${prefix}icon-192-v2.png`,
    icon512: `${prefix}icon-512-v2.png`,
    maskable192: `${prefix}icon-192-maskable-v2.png`,
    maskable512: `${prefix}icon-512-maskable-v2.png`,
    appleTouch: `${prefix}apple-touch-icon-v2.png`,
  }
}

export function resolveClientIdentity(env: IdentityEnv): ClientIdentity {
  const shopName = text(env.BUSINESS_OS_SHOP_NAME) || NEUTRAL_NAME
  const alias = text(env.BUSINESS_OS_SHOP_ALIAS)
  const adminTitle = `${shopName} Admin`
  return {
    shopName,
    shopNameKm: text(env.BUSINESS_OS_SHOP_NAME_KM) || shopName,
    shopAlias: alias,
    shopNames: alias ? `${shopName}/${alias}` : shopName,
    shopCategory: text(env.BUSINESS_OS_SHOP_CATEGORY).toLowerCase() === 'beauty' ? 'beauty' : '',
    shopDescription: `Browse ${shopName} products and contact the store.`,
    adminTitle,
    adminShortName: text(env.BUSINESS_OS_ADMIN_SHORT_NAME) || adminTitle,
    adminDescription: `Till, stock and sales for ${shopName} staff`,
    organizationName: text(env.BUSINESS_OS_ORGANIZATION_NAME) || NEUTRAL_NAME,
    membershipPrefix: membershipPrefixFrom(env.BUSINESS_OS_MEMBERSHIP_PREFIX),
    staffHost: staffHostFrom(env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL),
    shopIcons: shopIconsFrom(text(env.BUSINESS_OS_SHOP_ICON_PREFIX)),
  }
}

export const NEUTRAL_CLIENT_IDENTITY: ClientIdentity = resolveClientIdentity({})

/** For a <script type="application/json">: no `<` may close the element early. */
export function clientIdentityJson(identity: ClientIdentity): string {
  return JSON.stringify(identity).replace(/</g, '\\u003c')
}

function manifestIcons(icons: ShopIcons) {
  return [
    { src: icons.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: icons.maskable192, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: icons.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: icons.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
}

const MANIFEST_BASE = { id: '/', start_url: '/', scope: '/', display: 'standalone' }

/** /manifest.json: the staff app installed from the admin host. */
export function staffManifest(identity: ClientIdentity) {
  return {
    name: identity.adminTitle,
    short_name: identity.adminShortName,
    description: identity.adminDescription,
    ...MANIFEST_BASE,
    background_color: '#f4f1ea',
    theme_color: '#fffdf8',
    icons: manifestIcons(STAFF_ICONS),
  }
}

/** /portal-manifest.json: the storefront installed from the shop host. */
export function shopManifest(identity: ClientIdentity) {
  return {
    name: identity.shopName,
    short_name: identity.shopName,
    description: identity.shopDescription,
    ...MANIFEST_BASE,
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: manifestIcons(identity.shopIcons),
  }
}

export const MANIFEST_ROUTES = {
  '/manifest.json': staffManifest,
  '/portal-manifest.json': shopManifest,
} as const

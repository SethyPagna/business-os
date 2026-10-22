// Who this deployment belongs to: the shop's name, icons and house formats.
// The Worker writes them into the <script id="business-os-identity"> block of
// every app document it serves (cloudflare/src/lib/documentIdentity.ts, from
// wrangler [vars]); a document it never saw (the Vite dev server, a test)
// keeps index.html's neutral default, which is NEUTRAL_CLIENT_IDENTITY below.
// tests/clientIdentity.test.ts pins both against the Worker's own resolver.

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
  shopAlias: string
  shopNames: string
  shopCategory: '' | 'beauty'
  shopDescription: string
  adminTitle: string
  adminShortName: string
  adminDescription: string
  organizationName: string
  membershipPrefix: string
  staffHost: string
  shopIcons: ShopIcons
}

export const NEUTRAL_CLIENT_IDENTITY: ClientIdentity = {
  shopName: 'Business OS',
  shopNameKm: 'Business OS',
  shopAlias: '',
  shopNames: 'Business OS',
  shopCategory: '',
  shopDescription: 'Browse Business OS products and contact the store.',
  adminTitle: 'Business OS Admin',
  adminShortName: 'Business OS Admin',
  adminDescription: 'Till, stock and sales for Business OS staff',
  organizationName: 'Business OS',
  membershipPrefix: 'M-',
  staffHost: '',
  shopIcons: {
    favicon: '/admin-favicon-v1.ico',
    icon192: '/icon-192.png',
    icon512: '/icon-512.png',
    maskable192: '/icon-192-maskable-v2.png',
    maskable512: '/icon-512-maskable-v2.png',
    appleTouch: '/admin-apple-touch-icon-v1.png',
  },
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

// Field by field, so a block written by an older or newer Worker can only
// ever contribute well-typed strings.
export function parseClientIdentity(raw: unknown): ClientIdentity {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const icons = source.shopIcons && typeof source.shopIcons === 'object' ? source.shopIcons as Record<string, unknown> : {}
  const neutral = NEUTRAL_CLIENT_IDENTITY
  return {
    shopName: stringOr(source.shopName, neutral.shopName),
    shopNameKm: stringOr(source.shopNameKm, stringOr(source.shopName, neutral.shopNameKm)),
    shopAlias: stringOr(source.shopAlias, ''),
    shopNames: stringOr(source.shopNames, stringOr(source.shopName, neutral.shopNames)),
    shopCategory: source.shopCategory === 'beauty' ? 'beauty' : '',
    shopDescription: stringOr(source.shopDescription, neutral.shopDescription),
    adminTitle: stringOr(source.adminTitle, neutral.adminTitle),
    adminShortName: stringOr(source.adminShortName, neutral.adminShortName),
    adminDescription: stringOr(source.adminDescription, neutral.adminDescription),
    organizationName: stringOr(source.organizationName, neutral.organizationName),
    membershipPrefix: stringOr(source.membershipPrefix, neutral.membershipPrefix),
    staffHost: stringOr(source.staffHost, '').toLowerCase().trim(),
    shopIcons: {
      favicon: stringOr(icons.favicon, neutral.shopIcons.favicon),
      icon192: stringOr(icons.icon192, neutral.shopIcons.icon192),
      icon512: stringOr(icons.icon512, neutral.shopIcons.icon512),
      maskable192: stringOr(icons.maskable192, neutral.shopIcons.maskable192),
      maskable512: stringOr(icons.maskable512, neutral.shopIcons.maskable512),
      appleTouch: stringOr(icons.appleTouch, neutral.shopIcons.appleTouch),
    },
  }
}

let documentIdentity: ClientIdentity | null = null

export function getClientIdentity(): ClientIdentity {
  if (documentIdentity) return documentIdentity
  let raw: unknown = null
  try {
    const text = typeof document === 'undefined' ? '' : document.getElementById('business-os-identity')?.textContent || ''
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = null
  }
  documentIdentity = parseClientIdentity(raw)
  return documentIdentity
}

// Copy that names the shop carries {shop} (the name), {shopNames} (the name
// and the alias it is also known by) or {shopAlias} (the alias, else the name)
// in both language packs.
export function withShopName(text: string, identity: ClientIdentity = getClientIdentity()): string {
  return text
    .split('{shopNames}').join(identity.shopNames)
    .split('{shopAlias}').join(identity.shopAlias || identity.shopName)
    .split('{shop}').join(identity.shopName)
}

// The staff app's hosts: admin.* (Leang's admin.leangbeauty.com), the
// deployment's configured staff host (BM Shop's bm-admin.khshop.workers.dev,
// from BUSINESS_OS_ADMIN_URL; a *.workers.dev name cannot start with admin.)
// and loopback. Every other host is the storefront. The Worker's API gate
// applies the same rule (cloudflare/src/lib/publicHostGate.ts), as do
// index.html's bootstrap and the service worker.
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** A staff host on the network: admin.* or the configured staff host, never loopback by itself. */
export function isServedStaffHostname(hostname: unknown, identity: ClientIdentity = getClientIdentity()): boolean {
  const host = String(hostname || '').toLowerCase().trim()
  return host.startsWith('admin.') || (identity.staffHost !== '' && host === identity.staffHost)
}

export function isStaffHostname(hostname: unknown, identity: ClientIdentity = getClientIdentity()): boolean {
  return LOOPBACK_HOSTNAMES.has(String(hostname || '').toLowerCase().trim()) || isServedStaffHostname(hostname, identity)
}

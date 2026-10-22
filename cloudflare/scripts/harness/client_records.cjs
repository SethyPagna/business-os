'use strict'
// The strings a client's documents and install manifests carry, written out as frozen literals (never computed from
// the code under test) for the tests that hold the Worker's identity rewrite to them.
//
//   EXAMPLE_RECORD  the neutral fixture client: the committed template rendered with clients/example.env and the
//                   Example Shop identity of rendered_wrangler.cjs. Runs on every machine, CI included.
//   LEANG_RECORD    Leang Cosmetics: what the app wrote BEFORE identity became configurable (22 Oct 2026), frozen from
//                   commit 30fef7c2f (the admin rewrite module, the static index.html head, and
//                   frontend/public/manifest.json and portal-manifest.json). It is used only where this machine has
//                   the private Records/Clients/leang.env, whose vars the configurable path must reproduce to the byte.
//
// Only the names, the shop host and the icon prefix differ between clients; the staff artwork, colours and viewport
// are the same for all. Each record also carries: a www alias host, a retired alias host and a look-alike of the staff
// host (all of which are served the shop identity, never the staff one), and `leak`, a pattern that finds the client's
// names in anything written for another client.

const EXAMPLE_RECORD = Object.freeze({
  id: 'example',
  shopName: 'Example Shop',
  shopNameKm: 'ហាងគំរូ',
  shopAlias: 'Example Cosmetics',
  adminTitle: 'Example Shop Admin',
  adminShortName: 'Ex Admin',
  adminDescription: 'Till, stock and sales for Example Shop staff',
  shopDescription: 'Browse Example Shop products and contact the store.',
  shopHost: 'example.com',
  adminHost: 'admin.example.com',
  iconPrefix: '/example-shop-',
  membershipPrefix: 'EX-',
  wwwHost: 'www.example.com',
  retiredHost: 'example-shop.dpdns.org',
  lookalikeAdmin: 'notadmin.example.com',
  leak: /example/i,
})

const LEANG_RECORD = Object.freeze({
  id: 'leang',
  shopName: 'Leang Cosmetics',
  shopNameKm: 'លាង កូស្មេធីក',
  shopAlias: 'Leang Beauty',
  adminTitle: 'Leang Cosmetics Admin',
  adminShortName: 'Leang Admin',
  adminDescription: 'Till, stock and sales for Leang Cosmetics staff',
  shopDescription: 'Browse Leang Cosmetics products and contact the store.',
  shopHost: 'leangbeauty.com',
  adminHost: 'admin.leangbeauty.com',
  iconPrefix: '/leang-cosmetics-',
  membershipPrefix: 'LC-',
  wwwHost: 'www.leangbeauty.com',
  retiredHost: 'leangcosmetics.dpdns.org',
  lookalikeAdmin: 'notadmin.leangbeauty.com',
  leak: /leang/i,
})

const STAFF_ICON_SRCS = Object.freeze(['/icon-192.png', '/icon-192-maskable-v2.png', '/icon-512.png', '/icon-512-maskable-v2.png'])

const manifestIcons = (a, aMaskable, b, bMaskable) => [
  { src: a, sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: aMaskable, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: b, sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: bMaskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/** What the staff (admin) host's document carried. */
function frozenAdmin(r) {
  return {
    title: r.adminTitle,
    appTitle: r.adminShortName,
    description: r.adminDescription,
    themeColor: '#fffdf8',
    manifest: '/manifest.json',
    viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
    appleTouch: '/admin-apple-touch-icon-v1.png',
    favicon: '/admin-favicon-v1.ico',
    icon192: '/icon-192.png',
    icon512: '/icon-512.png',
    ogImage: '/icon-512.png',
    selfUrl: '/',
  }
}

/** What the shop host's document carried (the static head of frontend/index.html). */
function frozenShop(r) {
  return {
    title: r.shopName,
    appTitle: r.shopName,
    description: r.shopDescription,
    canonical: 'https://' + r.shopHost + '/',
    ogImage: 'https://' + r.shopHost + r.iconPrefix + 'icon-512-v2.png',
    favicon: r.iconPrefix + 'favicon-v2.ico',
    icon192: r.iconPrefix + 'icon-192-v2.png',
    icon512: r.iconPrefix + 'icon-512-v2.png',
    appleTouch: r.iconPrefix + 'apple-touch-icon-v2.png',
  }
}

/** frontend/public/manifest.json. */
function frozenStaffManifest(r) {
  return {
    name: r.adminTitle,
    short_name: r.adminShortName,
    description: r.adminDescription,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f1ea',
    theme_color: '#fffdf8',
    icons: manifestIcons(...STAFF_ICON_SRCS),
  }
}

/** frontend/public/portal-manifest.json. */
function frozenShopManifest(r) {
  return {
    name: r.shopName,
    short_name: r.shopName,
    description: r.shopDescription,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: manifestIcons(r.iconPrefix + 'icon-192-v2.png', r.iconPrefix + 'icon-192-maskable-v2.png', r.iconPrefix + 'icon-512-v2.png', r.iconPrefix + 'icon-512-maskable-v2.png'),
  }
}

/** The tags of the shop host's head, keyed the way the native test reads a document (headOf). */
function frozenShopHead(r) {
  const shop = frozenShop(r)
  return {
    title: shop.title,
    'meta name=description': shop.description,
    'meta name=apple-mobile-web-app-title': shop.appTitle,
    'meta name=theme-color': '#ffffff',
    'meta name=viewport': 'width=device-width, initial-scale=1, viewport-fit=cover',
    'meta property=og:site_name': shop.title,
    'meta property=og:title': shop.title,
    'meta property=og:description': shop.description,
    'meta property=og:url': shop.canonical,
    'meta property=og:image': shop.ogImage,
    'link rel=canonical': shop.canonical,
    'link rel=manifest': '/portal-manifest.json',
    'link rel=icon': shop.favicon,
    'link rel=icon 192x192': shop.icon192,
    'link rel=icon 512x512': shop.icon512,
    'link rel=apple-touch-icon': shop.appleTouch,
  }
}

/** The tags of the staff host's head, keyed the same way. */
function frozenStaffHead(r) {
  const admin = frozenAdmin(r)
  return {
    title: admin.title,
    'meta name=description': admin.description,
    'meta name=apple-mobile-web-app-title': admin.appTitle,
    'meta name=theme-color': admin.themeColor,
    'meta name=viewport': admin.viewport,
    'meta property=og:site_name': admin.title,
    'meta property=og:title': admin.title,
    'meta property=og:description': admin.description,
    'meta property=og:url': admin.selfUrl,
    'meta property=og:image': admin.ogImage,
    'link rel=canonical': admin.selfUrl,
    'link rel=manifest': admin.manifest,
    'link rel=icon': admin.favicon,
    'link rel=icon 192x192': admin.icon192,
    'link rel=icon 512x512': admin.icon512,
    'link rel=apple-touch-icon': admin.appleTouch,
  }
}

/** A record with its frozen documents and manifests attached, and the client's [vars] as `env`. */
const withFrozen = (record, env) => ({
  ...record,
  env,
  admin: frozenAdmin(record),
  shop: frozenShop(record),
  staffManifest: frozenStaffManifest(record),
  shopManifest: frozenShopManifest(record),
  shopHead: frozenShopHead(record),
  staffHead: frozenStaffHead(record),
})

module.exports = {
  EXAMPLE_RECORD, LEANG_RECORD, STAFF_ICON_SRCS,
  frozenAdmin, frozenShop, frozenStaffManifest, frozenShopManifest, frozenShopHead, frozenStaffHead, withFrozen,
}

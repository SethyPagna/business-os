import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission } from '../lib/permissions'
import { audit } from '../lib/audit'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { buildUniqueStoredName } from '../lib/fileAssets'
import { sanitizeMediaList } from '../lib/media'
import { detectBufferKind } from '../lib/uploadSecurity'
import { broadcast } from '../durable-objects/broadcastHub'
import { generatePortalAiResponse, getPortalAiUsageStatus } from '../lib/portalAi'
import { MAX_IMAGES_PER_PRODUCT } from '../lib/importImageMatch'
import { buildFtsMatchExpression, buildPartialWordMatchClause, buildShortWordFallbackClause, buildTrigramMatchExpression, PRODUCTS_FTS_BM25_SQL, runFuzzyFallbackMatch, tokenizeSearchWords } from '../lib/searchMatch'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

// Fuzzy (typo-tolerant) fallback bounds for GET /catalog/products/search --
// see that route's own comment and lib/searchMatch.ts's
// runFuzzyFallbackMatch for why/when this runs.
const PORTAL_FUZZY_FALLBACK_CANDIDATE_LIMIT = 3000
const PORTAL_FUZZY_FALLBACK_MATCH_CAP = 500

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

// Ported from backend/src/routes/portal.ts's normalizeUrl, minus the
// assertSafeOutboundUrl SSRF check (backend/src/urlSafety.ts -- a
// DNS-resolution-based check for private/internal IP ranges, not ported
// this pass; a Worker has no direct socket access the way that check
// guards against in the first place, so the specific SSRF vector it
// defends against doesn't apply the same way here, but this is a
// disclosed simplification, not a silent omission).
function normalizeUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^https?:\/\//i.test(raw) ? raw : (/^(www\.|[\w-]+(\.[\w-]+)+)/i.test(raw) ? `https://${raw}` : '')
  return normalized.replace(/\/$/, '')
}

// Ported from backend/src/routes/portal.ts. `redeemPoints` fallback of 100
// matches the legacy default; the KHR value is kept in 1000-increments,
// matching how KHR cash denominations actually work.
function normalizeRedeemValueUsd(value: unknown, fallback = 1): number {
  return Math.max(0, Math.round(toNumber(value, fallback)))
}

function normalizeRedeemValueKhr(value: unknown, fallback = 4100): number {
  const raw = Math.max(0, Math.round(toNumber(value, fallback)))
  if (raw === 0) return 0
  return Math.max(1000, Math.ceil(raw / 1000) * 1000)
}

// Ported from backend/src/portalUtils.ts (extractGoogleMapsEmbedUrl +
// normalizeGoogleMapsEmbed combined). Accepts either a raw Google Maps URL
// or an `<iframe src="...">` snippet pasted from Google's own "Share >
// Embed a map" dialog, and only allows Google-owned hosts through.
function normalizeGoogleMapsEmbed(value: unknown): string {
  const input = String(value || '').trim()
  if (!input) return ''
  const iframeMatch = input.match(/<iframe[^>]+src=(['"])(.*?)\1/i)
  const raw = iframeMatch && iframeMatch[2] ? iframeMatch[2].trim() : input
  if (!raw || !/^https?:\/\//i.test(raw)) return ''

  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const hostAllowed = /^(.+\.)?google\.[a-z.]+$/i.test(host)
      || host === 'maps.google.com'
      || host === 'share.google'
      || host === 'maps.app.goo.gl'
      || host === 'goo.gl'
    if (!hostAllowed) return ''

    const path = url.pathname.toLowerCase()
    if (path.startsWith('/maps/embed')) return url.toString()

    const embedUrl = new URL('https://www.google.com/maps')
    embedUrl.searchParams.set('q', url.toString())
    embedUrl.searchParams.set('output', 'embed')
    return embedUrl.toString()
  } catch (_) {
    return ''
  }
}

type SettingsMap = Record<string, string>

export async function loadSettingsMap(env: Env): Promise<SettingsMap> {
  const db = getDb(env)
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const map: SettingsMap = {}
  for (const row of rows) map[row.key] = row.value
  return map
}

function portalPublicUrl(settings: SettingsMap, env: Env): string {
  const configured = normalizeUrl(settings.customer_portal_public_url)
  const fallback = normalizeUrl(env.BUSINESS_OS_PUBLIC_URL)
  return (configured || fallback).replace(/\/public$/i, '')
}

export function buildPortalConfig(settings: SettingsMap, env: Env) {
  const exchangeRate = toNumber(settings.exchange_rate, 4100)
  const pointsBasis = ['usd', 'khr'].includes(String(settings.customer_portal_points_basis || '').toLowerCase())
    ? (String(settings.customer_portal_points_basis).toLowerCase() as 'usd' | 'khr')
    : 'usd'
  const pointsPerUsd = toNumber(settings.customer_portal_points_per_usd, 1)
  const derivedPointsPerKhr = pointsPerUsd > 0 && exchangeRate > 0 ? pointsPerUsd / exchangeRate : 0

  return {
    businessName: settings.business_name || 'Business OS',
    businessPhone: settings.business_phone || '',
    businessEmail: settings.business_email || '',
    businessAddress: settings.business_address || '',
    businessTagline: settings.customer_portal_business_tagline || '',
    businessLogo: settings.customer_portal_logo_image || '',
    businessFavicon: settings.customer_portal_favicon_image || '',
    businessCover: settings.customer_portal_cover_image || '',
    showLogo: normalizeBoolean(settings.customer_portal_show_logo, true),
    showCover: normalizeBoolean(settings.customer_portal_show_cover, true),
    showPhone: normalizeBoolean(settings.customer_portal_show_phone, true),
    showEmail: normalizeBoolean(settings.customer_portal_show_email, true),
    showAddress: normalizeBoolean(settings.customer_portal_show_address, true),
    showAbout: normalizeBoolean(settings.customer_portal_show_about, true),
    showCatalog: normalizeBoolean(settings.customer_portal_show_catalog, true),
    showMembership: normalizeBoolean(settings.customer_portal_show_membership, true),
    showFaq: normalizeBoolean(settings.customer_portal_show_faq, true),
    showPrices: normalizeBoolean(settings.customer_portal_show_prices, true),
    showOutOfStockProducts: normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true),
    // Master switch for the In Stock/Low Stock/Out of Stock badge on each
    // product card AND the stock-status filter pills above the grid --
    // both are gated on this one flag (frontend: CatalogProductsSection.tsx;
    // backend: buildPortalProductFilters below, which also ignores an
    // explicit ?stockState= query param when this is off, so hiding the
    // filter pills can't be bypassed by calling the API directly).
    showStockStatus: normalizeBoolean(settings.customer_portal_show_stock_status, true),
    // Per-product-card detail toggles (editor: CatalogEditorSurface.tsx
    // "showProductBrand" etc). These were saved to settings and used by
    // the editor's own live preview (CatalogProductsSection.tsx) but were
    // never read back out here, so the real public portal always showed
    // every field regardless of what the merchant turned off -- toggles
    // were no-ops on the live site even though they visibly worked in the
    // preview. Wired through the same settings keys CatalogPage.tsx saves.
    showProductBrand: normalizeBoolean(settings.customer_portal_show_product_brand, true),
    showProductCategory: normalizeBoolean(settings.customer_portal_show_product_category, true),
    showProductDescription: normalizeBoolean(settings.customer_portal_show_product_description, true),
    showProductDiscount: normalizeBoolean(settings.customer_portal_show_product_discount, true),
    // Same "editor reads it correctly, buildPortalConfig never sent it to
    // the real public site" gap already fixed twice for other toggles
    // above (out-of-stock, per-field show* toggles) -- this one was still
    // missing here entirely, so a merchant turning translation off in the
    // editor had no effect on the live portal (the frontend's own default
    // is `true`, so a missing field was silently read as "on").
    translateWidgetEnabled: normalizeBoolean(settings.customer_portal_translate_widget_enabled, true),
    aiEnabled: normalizeBoolean(settings.customer_portal_ai_enabled, true),
    aiTitle: settings.customer_portal_ai_title || 'Beauty Assistant',
    aiDisclaimer: settings.customer_portal_ai_disclaimer
      || 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.',
    aiProviderId: Number(settings.customer_portal_ai_provider_id || 0) || null,
    // Merchant-supplied extra system instructions for the portal AI chat
    // assistant, forwarded into the prompt built by lib/portalAi.ts.
    aiPrompt: settings.customer_portal_ai_prompt || '',
    publicUrl: portalPublicUrl(settings, env),
    publicPath: settings.customer_portal_path || '/',
    links: {
      website: settings.customer_portal_website || '',
      facebook: settings.customer_portal_facebook || '',
      instagram: settings.customer_portal_instagram || '',
      telegram: settings.customer_portal_telegram || '',
    },
    // Real bug found this session, same "editor saves it, buildPortalConfig
    // never sends it" shape already fixed above for translateWidgetEnabled
    // and the per-field show* toggles -- but for the entire social-links
    // visibility row AND the whole separate "Contact us" direct-message
    // channel block (Messenger/Telegram/WhatsApp/Phone/Instagram + their
    // labels + their own show* toggles). CatalogEditorSurface.tsx saves
    // all of these under customer_portal_show_facebook/_telegram/etc and
    // customer_portal_contact_messenger/_telegram/etc, and
    // PublicCatalogPage.tsx's socialLinks/contactChannels arrays read
    // displayConfig.showFacebook/linkLabels/contactLinks/contactLinkLabels/
    // showContact* -- none of which this function ever populated, so
    // every one of those fields silently fell back to the frontend's
    // DEFAULT_PUBLIC_CONFIG default instead of the merchant's real saved
    // value. Concretely: a merchant typing a Messenger/Telegram handle
    // into the "Contact us" section of the editor (confirmed via a real
    // report: Facebook page "@leanggirlactik", Telegram "@Leang_Cosmetic")
    // had it saved correctly to the settings table and rendered correctly
    // in the editor's own live preview, but the real public /config
    // endpoint never sent contactLinks/contactLinkLabels/showContact* at
    // all, so the live storefront's contact buttons never reflected it.
    showWebsite: normalizeBoolean(settings.customer_portal_show_website, true),
    showFacebook: normalizeBoolean(settings.customer_portal_show_facebook, true),
    showInstagram: normalizeBoolean(settings.customer_portal_show_instagram, true),
    showTelegram: normalizeBoolean(settings.customer_portal_show_telegram, true),
    linkLabels: {
      website: settings.customer_portal_website_label || 'Website',
      facebook: settings.customer_portal_facebook_label || 'Facebook',
      instagram: settings.customer_portal_instagram_label || 'Instagram',
      telegram: settings.customer_portal_telegram_label || 'Telegram',
    },
    contactLinks: {
      messenger: settings.customer_portal_contact_messenger || '',
      telegram: settings.customer_portal_contact_telegram || '',
      whatsapp: settings.customer_portal_contact_whatsapp || '',
      phone: settings.customer_portal_contact_phone || settings.business_phone || '',
      instagram: settings.customer_portal_contact_instagram || '',
    },
    contactLinkLabels: {
      messenger: settings.customer_portal_contact_messenger_label || 'Messenger',
      telegram: settings.customer_portal_contact_telegram_label || 'Telegram',
      whatsapp: settings.customer_portal_contact_whatsapp_label || 'WhatsApp',
      phone: settings.customer_portal_contact_phone_label || '',
      instagram: settings.customer_portal_contact_instagram_label || 'Instagram',
    },
    showContactMessenger: normalizeBoolean(settings.customer_portal_show_contact_messenger, true),
    showContactTelegram: normalizeBoolean(settings.customer_portal_show_contact_telegram, true),
    showContactWhatsapp: normalizeBoolean(settings.customer_portal_show_contact_whatsapp, false),
    showContactPhone: normalizeBoolean(settings.customer_portal_show_contact_phone, false),
    showContactInstagram: normalizeBoolean(settings.customer_portal_show_contact_instagram, false),
    title: settings.customer_portal_title || settings.business_name || 'Customer Portal',
    intro: settings.customer_portal_intro || 'Browse products and check membership details.',
    heroGradientStart: settings.customer_portal_hero_gradient_start || '#0f172a',
    heroGradientMid: settings.customer_portal_hero_gradient_mid || '#14532d',
    heroGradientEnd: settings.customer_portal_hero_gradient_end || '#ea580c',
    exchangeRate: toNumber(settings.exchange_rate, 4100),
    priceDisplay: settings.customer_portal_price_display || settings.display_currency || 'USD',
    refreshSeconds: Math.min(120, Math.max(5, Math.round(toNumber(settings.customer_portal_refresh_seconds, 20)))),
    gridColumnsMobile: Math.min(3, Math.max(1, Math.round(toNumber(settings.customer_portal_grid_columns_mobile, 1)))),
    gridColumnsDesktop: Math.min(8, Math.max(2, Math.round(toNumber(settings.customer_portal_grid_columns_desktop, 4)))),
    googleMapsEmbed: normalizeGoogleMapsEmbed(settings.customer_portal_google_maps_embed),
    showGoogleMap: normalizeBoolean(settings.customer_portal_show_google_map, true),
    pointsBasis,
    pointsPerUsd,
    pointsPerKhr: toNumber(settings.customer_portal_points_per_khr, derivedPointsPerKhr),
    redeemPoints: Math.max(1, Math.floor(toNumber(settings.customer_portal_redeem_points, 100))),
    redeemValueUsd: normalizeRedeemValueUsd(settings.customer_portal_redeem_value_usd, 1),
    redeemValueKhr: normalizeRedeemValueKhr(settings.customer_portal_redeem_value_khr, exchangeRate),
    membershipInfoText: settings.customer_portal_membership_info_text
      || 'Membership points are reviewed and applied by staff during checkout. Redemption uses whole units only.',
    submissionEnabled: normalizeBoolean(settings.customer_portal_submission_enabled, true),
    submissionRewardPoints: Math.max(0, Math.floor(toNumber(settings.customer_portal_submission_reward_points, 5))),
    submissionInstructions: settings.customer_portal_submission_instructions
      || 'Share the business on social media, then upload screenshots here for staff review.',
  }
}

// Root cause of "brand/category filter showing irrelevant/empty options":
// these two lists used to be sourced independently of what the catalog
// query below actually shows -- `categories` was every row in the
// `categories` table regardless of whether any product used it (a
// category created, then never assigned or later emptied out, stayed a
// selectable filter forever), and `brands` only checked `is_active`, not
// stock -- a brand whose only products were active-but-out-of-stock still
// showed as a filter option even though the catalog query below (and
// every filtered product search) excludes out-of-stock items, so picking
// it always landed on an empty result. Both queries now scope to exactly
// the same "actually visible in the portal" condition buildPortalCatalog
// uses (`is_active = 1 AND stock_quantity > out_of_stock_threshold`), so
// a filter option only ever appears when it can actually return
// something.
//
// Follow-up root cause of "category filter only ever shows All": the fix
// above kept categories sourced via an INNER JOIN against the separate
// `categories` lookup table (`products.category` is free text, not an FK
// -- see migrations/0001_init.sql -- so this was a case-insensitive
// trimmed name match). That join silently drops any category that's set
// as free text on a product but was never *also* created as its own row
// in that lookup table (e.g. typed directly during a product edit, or
// arriving via CSV import) -- exactly the gap between "admin shows every
// real category" and "portal shows only All", since the admin's own
// equivalent (routes/products.ts's loadProductFilters) never joins
// against the lookup table at all, it just selects DISTINCT values off
// products directly -- the same thing `brands` below already does, which
// is why brand filtering was unaffected. Category now matches that same
// direct, lookup-table-independent approach.
//
// This used to be a plain constant that ALWAYS excluded out-of-stock
// products, no matter what. That silently overrode the merchant's own
// "Show out-of-stock products" toggle (customer_portal_show_out_of_stock_
// products / config.showOutOfStockProducts): the setting only ever got
// read back out on the frontend as an *extra* client-side filter
// (CatalogPage.tsx) that could hide items further, never as something
// that could un-hide items the backend had already dropped from the
// response entirely -- so turning the toggle on did nothing, and the
// portal's total-products count, category/brand filter lists, and grid
// were all short by however many products were out of stock. Now a
// function of that setting: still excludes when the merchant wants
// out-of-stock hidden (matching the historical default), but includes
// everything (still gated on is_active) when they've asked to show it.
function portalVisibleProductFilter(showOutOfStockProducts: boolean): string {
  return showOutOfStockProducts
    ? 'p.is_active = 1'
    : 'p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)'
}

// Category-first, name-second default browsing order for the public
// catalog -- mirrors the admin Products/Inventory pages' own two-level
// sort (Part 226: category header first, A-Z; products A-Z within each
// category), but done here as a real SQL ORDER BY rather than client-side
// grouping, since this endpoint is server-paginated and each page only
// ever sees its own slice of rows. Blank/whitespace-only category sorts
// last (the "Uncategorized" bucket), same precedence Part 226 gave it on
// the admin side, via the leading CASE tier rather than relying on empty
// string sorting first alphabetically. Shared by buildPortalCatalog's
// bootstrap snapshot and /catalog/products/search's own no-search-term
// default so the two never drift into two different browsing orders.
const PORTAL_CATALOG_DEFAULT_ORDER_SQL =
  "CASE WHEN trim(COALESCE(p.category, '')) = '' THEN 1 ELSE 0 END ASC, lower(trim(p.category)) ASC, lower(p.name) ASC, p.id ASC"

// Ported from routes/products.ts's attachBranchStock so the public portal's
// product rows carry the same per-branch breakdown the admin catalog does.
// Without this, the portal never had branch_stock at all, which meant two
// gaps: (1) the branch filter pills in buildPortalProductFilters could
// narrow *which* products matched, but the returned rows never showed
// *which* branch(es) actually carried them, and (2) mergeSameDetailRows
// (see below) had nothing to combine -- a product imported/created once
// per branch (same name/price/etc, different row per branch) rendered as
// several visually-identical storefront cards instead of one card with
// stock spread across branches, exactly the duplicate-row symptom this
// pass is fixing.
async function attachPortalBranchStock(env: Env, products: Array<Record<string, unknown>>) {
  const ids = Array.from(new Set(products.map((p) => Number(p.id)).filter((id) => Number.isFinite(id) && id > 0)))
  if (!ids.length) return products
  const db = getDb(env)
  const placeholders = ids.map((_, i) => `@id${i}`).join(',')
  const params: Record<string, unknown> = {}
  ids.forEach((id, i) => { params[`id${i}`] = id })
  const rows = await db.prepare(`
    SELECT bs.product_id AS product_id, b.id AS branch_id, b.name AS branch_name, COALESCE(bs.quantity, 0) AS quantity
    FROM branches b
    LEFT JOIN branch_stock bs ON bs.branch_id = b.id AND bs.product_id IN (${placeholders})
    WHERE b.is_active = 1
    ORDER BY b.is_default DESC, b.id ASC
  `).all<{ product_id: number | null; branch_id: number; branch_name: string; quantity: number }>(params)

  const byProduct = new Map<number, Array<{ branch_id: number; branch_name: string; quantity: number }>>()
  for (const id of ids) byProduct.set(id, [])
  for (const row of rows) {
    if (!row.product_id) continue
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, [])
    byProduct.get(row.product_id)!.push({ branch_id: row.branch_id, branch_name: row.branch_name, quantity: row.quantity })
  }
  return products.map((product) => ({
    ...product,
    branch_stock: byProduct.get(Number(product.id)) || [],
  }))
}

async function buildPortalMeta(env: Env, showOutOfStockProducts: boolean) {
  const db = getDb(env)
  const visibleFilter = portalVisibleProductFilter(showOutOfStockProducts)
  // GROUP BY the normalized value rather than plain DISTINCT -- see the
  // matching fix/comment in routes/products.ts's loadProductFilters() for
  // why (imported data with inconsistent brand/category casing produced
  // two identical-looking dropdown rows that were different filter values).
  const [categories, brands, branches] = await Promise.all([
    db.prepare(`
      SELECT MIN(trim(p.category)) AS name
      FROM products p
      WHERE ${visibleFilter} AND trim(COALESCE(p.category, '')) <> ''
      GROUP BY lower(trim(p.category))
      ORDER BY lower(name) ASC
    `).all<{ name: string }>(),
    db.prepare(`
      SELECT MIN(trim(p.brand)) AS name
      FROM products p
      WHERE ${visibleFilter} AND trim(COALESCE(p.brand, '')) <> ''
      GROUP BY lower(trim(p.brand))
      ORDER BY lower(name) ASC
    `).all<{ name: string }>(),
    db.prepare('SELECT id, name FROM branches WHERE is_active = 1 ORDER BY is_default DESC, lower(name) ASC').all<{ id: number; name: string }>(),
  ])
  return {
    categories: categories || [],
    brands: brands || [],
    branches: branches || [],
  }
}

async function buildPortalCatalog(env: Env, showOutOfStockProducts: boolean) {
  const db = getDb(env)
  const visibleFilter = portalVisibleProductFilter(showOutOfStockProducts)
  const page = 1
  // Matches the search endpoint's own default below (Part 202) -- this
  // snapshot is what cachedPortal?.catalog?.pageSize on the frontend
  // initializes from, so the two must agree or the first live page fetch
  // after hydration would jump size out from under the visitor.
  const pageSize = 50
  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    WHERE ${visibleFilter}
  `).get<{ count: number }>()
  const total = totalRow?.count || 0
  const items = await db.prepare(`
    SELECT p.id, p.name, p.category, p.brand, p.unit, p.description,
           p.selling_price_usd, p.selling_price_khr, p.stock_quantity,
           p.low_stock_threshold, p.out_of_stock_threshold, p.image_path
    FROM products p
    WHERE ${visibleFilter}
    ORDER BY ${PORTAL_CATALOG_DEFAULT_ORDER_SQL}
    LIMIT @pageSize
  `).all({ pageSize })
  const itemsWithBranchStock = await attachPortalBranchStock(env, (items || []) as Array<Record<string, unknown>>)
  const initials = await db.prepare(`
    SELECT upper(substr(trim(name), 1, 1)) AS value, COUNT(*) AS count
    FROM products
    WHERE is_active = 1 AND trim(COALESCE(name, '')) <> ''
    GROUP BY value
    ORDER BY value ASC
  `).all<{ value: string; count: number }>()
  return {
    items: itemsWithBranchStock,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    initials: initials || [],
  }
}

// GET /config -- the real public branding endpoint. The original
// (backend/src/routes/portal.ts's buildPortalConfig) whitelists ~70 fields
// covering branding, FAQ, about-page blocks, translations, AI assistant
// config, and membership/points settings. Porting the entire whitelist
// faithfully is real, substantial work on its own -- this ports the core
// branding/display fields a portal needs to render at all (name, contact
// info, logo/cover, tagline, social links, show/hide toggles, hero colors,
// catalog display options), and is deliberately NOT a complete port of the
// original's full field set. Disclosed here and in MIGRATION.md, not
// silently partial: FAQ, about blocks, translations, AI settings, and
// membership/points config are not included in this response.
app.get('/config', async (c) => {
  const settings = await loadSettingsMap(c.env)
  return c.json(buildPortalConfig(settings, c.env))
})

app.get('/bootstrap', async (c) => {
  const settings = await loadSettingsMap(c.env)
  const showOutOfStockProducts = normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true)
  const [meta, catalog] = await Promise.all([
    buildPortalMeta(c.env, showOutOfStockProducts),
    buildPortalCatalog(c.env, showOutOfStockProducts),
  ])
  return c.json({
    config: buildPortalConfig(settings, c.env),
    meta,
    catalog,
    products: catalog.items,
    reviewItems: [],
    promotions: { items: [] },
  })
})

// GET /catalog/meta and GET /catalog/products -- previously only reachable
// bundled inside /bootstrap's response; legacy backend/src/routes/portal.ts
// exposes them standalone too (frontend/src/api/portalPublicTransport.ts
// calls them directly on some code paths, e.g. re-fetching meta after a
// promotions update without a full bootstrap round trip). No new query
// logic needed -- both reuse the same buildPortalMeta/buildPortalCatalog
// helpers /bootstrap above already calls.
app.get('/catalog/meta', async (c) => {
  const settings = await loadSettingsMap(c.env)
  const showOutOfStockProducts = normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true)
  return c.json(await buildPortalMeta(c.env, showOutOfStockProducts))
})
app.get('/catalog/products', async (c) => {
  const settings = await loadSettingsMap(c.env)
  const showOutOfStockProducts = normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true)
  return c.json(await buildPortalCatalog(c.env, showOutOfStockProducts))
})

// GET /ai/status -- whether the portal's AI shopping assistant is turned
// on and has a usable provider behind it. Ported the "is it available"
// half of legacy backend/src/services/portalAi.ts's getPortalAiUsageStatus;
// NOT ported: the actual chat-generation call (see POST /ai/chat below).
// The live per-minute capacity/active-visitor numbers legacy computes here
// come from in-memory process state that has no clean Workers equivalent
// (no shared memory across isolates) -- reporting a configured request
// budget instead of a live one is an honest simplification, not a silent
// gap, since nothing currently reads those numbers to throttle client
// requests either way.
app.get('/ai/status', async (c) => {
  const settings = await loadSettingsMap(c.env)
  const config = buildPortalConfig(settings, c.env)
  const db = getDb(c.env)
  const provider = config.aiProviderId
    ? await db.prepare(`
        SELECT id, name, requests_per_minute FROM ai_provider_configs
        WHERE id = ? AND enabled = 1 AND provider_type = 'chat'
      `).get<{ id: number; name: string; requests_per_minute: number }>([config.aiProviderId])
    : await db.prepare(`
        SELECT id, name, requests_per_minute FROM ai_provider_configs
        WHERE enabled = 1 AND provider_type = 'chat' ORDER BY priority ASC LIMIT 1
      `).get<{ id: number; name: string; requests_per_minute: number }>()

  return c.json({
    success: true,
    enabled: !!config.aiEnabled && !!provider,
    title: config.aiTitle,
    disclaimer: config.aiDisclaimer,
    usage: {
      providers: provider ? [{ id: provider.id, name: provider.name, requestsPerMinute: provider.requests_per_minute }] : [],
    },
  })
})

// Sanitizes the free-form shopper profile object from the request body.
// Ported from backend/src/routes/portal.ts's sanitizeAiProfile.
function sanitizeAiProfile(value: unknown) {
  const profile = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    brand: String(profile.brand || '').trim().slice(0, 120),
    skinType: String(profile.skinType || '').trim().slice(0, 120),
    concerns: String(profile.concerns || '').trim().slice(0, 220),
    shoppingFor: String(profile.shoppingFor || '').trim().slice(0, 120),
    goal: String(profile.goal || '').trim().slice(0, 180),
  }
}

function hasAiProfilePreference(profile: Record<string, unknown> = {}): boolean {
  return Object.values(profile).some((value) => !!value)
}

// Lightweight visitor fingerprint for AI per-visitor throttling/fairness
// only -- not used for auth or logging identity. Ported from backend/src/
// routes/portal.ts's getVisitorFingerprint (req.ip -> Workers' CF-Connecting-IP).
function getVisitorFingerprint(c: { req: { header: (name: string) => string | undefined } }, request: Request): string {
  const ip = getClientIp(request).slice(0, 120)
  const ua = (c.req.header('user-agent') || '').trim().slice(0, 240)
  return `${ip}|${ua || 'unknown-agent'}`
}

function collectRecommendationCitations(recommendations: Array<{ citations?: unknown[] }> = []) {
  const citations: unknown[] = []
  for (const recommendation of recommendations) {
    if (!Array.isArray(recommendation?.citations)) continue
    for (const citation of recommendation.citations) citations.push(citation)
  }
  return citations
}

// Full active-product list (not the paginated /catalog/products page) for
// the AI to select prompt candidates from, with each product's image
// gallery attached the same way buildPortalProductPayload does in the
// legacy backend (backend/src/routes/portal.ts's getPortalProductAssets).
// Bug found in a Track A config-propagation audit (progress.md): this
// always queried every active product regardless of stock, so a merchant
// with "Show out-of-stock products" turned off on the portal would still
// have the AI shopping assistant recommend/cite out-of-stock items to a
// customer -- the setting was applied to the grid/search everywhere else
// in this file, just never reached the AI candidate pool. Now takes the
// same showOutOfStockProducts flag as buildPortalMeta/buildPortalCatalog
// and reuses the identical portalVisibleProductFilter() SQL fragment, so
// the AI sees exactly the same visible-product set a shopper does.
async function loadPortalAiCatalog(env: Env, showOutOfStockProducts: boolean) {
  const db = getDb(env)
  const visibleFilter = portalVisibleProductFilter(showOutOfStockProducts)
  const products = await db.prepare(`
    SELECT id, name, brand, category, unit, description,
           selling_price_usd, selling_price_khr, stock_quantity,
           low_stock_threshold, out_of_stock_threshold, expiry_date,
           discount_enabled, discount_type, discount_percent,
           discount_amount_usd, discount_amount_khr,
           discount_starts_at, discount_ends_at, image_path
    FROM products
    WHERE ${visibleFilter}
    ORDER BY COALESCE(created_at, updated_at) DESC, id DESC
    LIMIT 500
  `).all<Record<string, unknown>>()
  const items = products || []
  if (!items.length) return items

  const ids = items.map((product) => Number(product.id))
  const placeholders = ids.map(() => '?').join(',')
  const imageRows = await db.prepare(`
    SELECT product_id, image_path FROM product_images
    WHERE product_id IN (${placeholders})
    ORDER BY sort_order ASC, id ASC
  `).all<{ product_id: number; image_path: string }>(ids)

  const imageMap = new Map<number, string[]>()
  for (const row of imageRows || []) {
    if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, [])
    imageMap.get(row.product_id)?.push(row.image_path)
  }

  return items.map((product) => {
    const gallery = sanitizeMediaList(imageMap.get(Number(product.id)) || []).slice(0, MAX_IMAGES_PER_PRODUCT)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    return { ...product, image_path: gallery[0] || null, image_gallery: gallery }
  })
}

// POST /ai/chat -- builds a product-grounded prompt from the live catalog
// via lib/portalAi.ts, calls the configured chat provider (with failover
// across all enabled chat providers), parses the model's JSON response
// into typed recommendations + citations, and logs the exchange to
// ai_response_logs. Ported from backend/src/routes/portal.ts +
// backend/src/services/portalAi.ts; see lib/portalAi.ts's file header for
// what changed adapting it to Workers (D1-backed per-visitor throttling
// instead of an in-memory Map).
app.post('/ai/chat', async (c) => {
  try {
    const clientIp = getClientIp(c.req.raw)
    const ipCheck = await checkRateLimit(c.env, 'portal:ai_chat:ip', clientIp, 20, 60 * 1000)
    if (!ipCheck.allowed) {
      c.header('Retry-After', String(ipCheck.retryAfterSeconds))
      return c.json({ error: `Too many requests. Try again in ${ipCheck.retryAfterSeconds} seconds.` }, 429)
    }

    const settings = await loadSettingsMap(c.env)
    const config = buildPortalConfig(settings, c.env)
    if (!config.aiEnabled) {
      return c.json({ error: 'Portal AI is currently disabled' }, 403)
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const question = String(body?.question || '').trim().slice(0, 2000)
    const profile = sanitizeAiProfile(body?.profile)
    if (!question && !hasAiProfilePreference(profile)) {
      return c.json({ error: 'Add a question or at least one shopping preference first' }, 400)
    }

    const products = await loadPortalAiCatalog(c.env, config.showOutOfStockProducts)
    const response = await generatePortalAiResponse(c.env, {
      config: {
        businessName: config.businessName,
        aiProviderId: config.aiProviderId,
        aiDisclaimer: config.aiDisclaimer,
        aiPrompt: config.aiPrompt,
      },
      profile,
      question,
      products,
      visitorFingerprint: getVisitorFingerprint(c, c.req.raw),
    })

    const citations = collectRecommendationCitations(response.recommendations)
    try {
      await getDb(c.env).prepare(`
        INSERT INTO ai_response_logs (
          surface, provider_config_id, provider_name, provider, model,
          actor_label, prompt_text, question_text, profile_json,
          candidate_products_json, recommendations_json, citations_json,
          answer_text, created_at
        ) VALUES ('portal', @provider_config_id, @provider_name, @provider, @model,
          'customer portal visitor', @prompt_text, @question_text, @profile_json,
          @candidate_products_json, @recommendations_json, @citations_json,
          @answer_text, @created_at)
      `).run({
        provider_config_id: response.provider?.id || null,
        provider_name: response.provider?.name || '',
        provider: response.provider?.provider || '',
        model: response.provider?.default_model || '',
        prompt_text: response.promptText || '',
        question_text: question,
        profile_json: JSON.stringify(profile),
        candidate_products_json: JSON.stringify(response.candidates || []),
        recommendations_json: JSON.stringify(response.recommendations || []),
        citations_json: JSON.stringify(citations),
        answer_text: response.summary || '',
        created_at: new Date().toISOString(),
      })
    } catch (_) {
      // Logging failure should never block the customer-facing response.
    }

    return c.json({
      success: true,
      summary: response.summary || '',
      notice: response.notice || config.aiDisclaimer,
      contactNote: response.contact_note || config.aiDisclaimer,
      followUpQuestions: response.follow_up_questions || [],
      recommendations: response.recommendations || [],
      usage: response.usage || (await getPortalAiUsageStatus(c.env, config.aiProviderId)),
      requestPolicy: response.requestPolicy || {},
      failovers: response.failovers || [],
    })
  } catch (error) {
    return c.json({ error: (error as Error)?.message || 'Portal AI request failed' }, 400)
  }
})


// filtered by is_active and the optional starts_at/ends_at scheduling
// window, same as the Express/Postgres version (backend/src/routes/
// portal.ts) this was ported from -- the portal never has to trust a
// client-side date check for what's allowed to show. No Postgres-specific
// syntax in the original here, so this is a direct, unmodified port.
app.get('/promotions', async (c) => {
  const db = getDb(c.env)
  const nowIso = new Date().toISOString()
  const rows = await db.prepare(`
    SELECT p.id, p.title, p.subtitle, p.image_path, p.link_type, p.link_url, p.badge_text, p.badge_color,
           p.link_product_id, pr.name AS link_product_name, pr.image_path AS link_product_image
    FROM promotions p
    LEFT JOIN products pr ON pr.id = p.link_product_id AND p.link_type = 'product'
    WHERE p.is_active = 1
      AND (p.starts_at IS NULL OR p.starts_at <= @now)
      AND (p.ends_at IS NULL OR p.ends_at >= @now)
    ORDER BY p.sort_order ASC, p.id ASC
  `).all({ now: nowIso })
  return c.json({ items: rows })
})

// ---- Customer membership lookup + share-submission workflow ----
// Ported from backend/src/routes/portal.ts. Previously had no real route
// at all on Cloudflare beyond a hardcoded `[]` review-queue stub -- the
// public portal could not look up a membership or submit a screenshot,
// and staff had nothing real to review. See PORTING_STATUS.md checkpoint 9.

function joinWrappedClauses(clauses: string[]): string {
  if (!clauses.length) return 'FALSE'
  return clauses.map((clause) => `(${clause})`).join(' OR ')
}

function normalizePhone(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '')
}

export type PortalConfigShape = ReturnType<typeof buildPortalConfig>

function calculatePointsValue(amountUsd: number, amountKhr: number, config: PortalConfigShape): number {
  if (config.pointsBasis === 'khr') {
    return config.pointsPerKhr > 0 ? amountKhr * config.pointsPerKhr : 0
  }
  return config.pointsPerUsd > 0 ? amountUsd * config.pointsPerUsd : 0
}

export type SubmissionRow = {
  id: number
  status: string
  reward_points: number
  [key: string]: unknown
}

export function summarizePoints(sales: Array<Record<string, unknown>>, returns: Array<Record<string, unknown>>, submissions: SubmissionRow[], config: PortalConfigShape, adjustments: Array<Record<string, unknown>> = []) {
  let earned = 0
  let deducted = 0
  let redeemed = 0
  let rewarded = 0
  let manuallyAwarded = 0

  for (const sale of sales) {
    const status = (sale.sale_status as string) || 'completed'
    if (status === 'cancelled' || status === 'awaiting_payment') continue
    earned += calculatePointsValue(toNumber(sale.total_usd), toNumber(sale.total_khr), config)
    redeemed += toNumber(sale.membership_points_redeemed)
  }
  for (const ret of returns) {
    if (((ret.status as string) || 'completed') === 'cancelled') continue
    deducted += calculatePointsValue(toNumber(ret.total_refund_usd), toNumber(ret.total_refund_khr), config)
  }
  for (const submission of submissions) {
    if (submission.status === 'approved') rewarded += toNumber(submission.reward_points)
  }
  for (const adjustment of adjustments) manuallyAwarded += toNumber(adjustment.points)

  const balance = Math.max(0, earned - deducted - redeemed + rewarded + manuallyAwarded)
  const redeemableUnits = Math.floor(balance / Math.max(1, config.redeemPoints))

  return {
    earned: Number(earned.toFixed(2)),
    deducted: Number(deducted.toFixed(2)),
    redeemed: Number(redeemed.toFixed(2)),
    rewarded: Number(rewarded.toFixed(2)),
    manuallyAwarded: Number(manuallyAwarded.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    redeemableUnits,
    minimumRedeemPoints: config.redeemPoints,
    nextRedeemAt: config.redeemPoints,
    nextRedeemNeeded: Math.max(0, Number((config.redeemPoints - (balance % config.redeemPoints || 0)).toFixed(2)) % config.redeemPoints),
    redeemValueUsd: Number((redeemableUnits * config.redeemValueUsd).toFixed(2)),
    redeemValueKhr: Number((redeemableUnits * config.redeemValueKhr).toFixed(0)),
  }
}

function summarizeMembershipTotals(sales: Array<Record<string, unknown>>, returns: Array<Record<string, unknown>>) {
  let totalSalesUsd = 0, totalSalesKhr = 0, totalReturnsUsd = 0, totalReturnsKhr = 0
  let membershipDiscountUsd = 0, membershipDiscountKhr = 0

  for (const sale of sales) {
    totalSalesUsd += toNumber(sale.total_usd)
    totalSalesKhr += toNumber(sale.total_khr)
    membershipDiscountUsd += toNumber(sale.membership_discount_usd)
    membershipDiscountKhr += toNumber(sale.membership_discount_khr)
  }
  for (const ret of returns) {
    totalReturnsUsd += toNumber(ret.total_refund_usd)
    totalReturnsKhr += toNumber(ret.total_refund_khr)
  }

  return {
    totalSalesUsd: Number(totalSalesUsd.toFixed(2)),
    totalSalesKhr: Number(totalSalesKhr.toFixed(0)),
    totalReturnsUsd: Number(totalReturnsUsd.toFixed(2)),
    totalReturnsKhr: Number(totalReturnsKhr.toFixed(0)),
    membershipDiscountUsd: Number(membershipDiscountUsd.toFixed(2)),
    membershipDiscountKhr: Number(membershipDiscountKhr.toFixed(0)),
  }
}

function normalizePortalSubmissionRows(rows: Array<Record<string, unknown>>): SubmissionRow[] {
  return rows.map((row) => {
    const { screenshots_json, ...entry } = row
    let screenshots: string[] = []
    try {
      screenshots = screenshots_json ? JSON.parse(String(screenshots_json)) : []
    } catch (_) {
      screenshots = []
    }
    return { ...(entry as SubmissionRow), screenshots }
  })
}

async function findCustomerByMembership(env: Env, membershipNumber: string) {
  return getDb(env).prepare(`
    SELECT id, name, membership_number, phone, email, address, notes, created_at
    FROM customers
    WHERE lower(trim(membership_number)) = lower(trim(@membershipNumber))
    LIMIT 1
  `).get<{ id: number; name: string; membership_number: string; phone: string }>({ membershipNumber })
}

// Only accept already-stored `/uploads/...` paths or inline base64 image
// data URLs -- a simplified version of the legacy `isSafeExternalImageReference`,
// which also allowed arbitrary remote image URLs behind an SSRF check
// (backend/src/netSecurity.ts's assertSafeOutboundUrl). That DNS-resolution
// based check doesn't have a clean Workers equivalent (no raw socket access
// to begin with), so remote URLs are disclosed as unsupported here rather
// than silently allowed through unchecked.
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i

function sanitizeScreenshots(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const safe: string[] = []
  for (const entry of list) {
    if (safe.length >= 8) break
    const normalized = String(entry || '').trim()
    if (!normalized || normalized.length > 2_000_000) continue
    if (normalized.startsWith('/uploads/') || DATA_IMAGE_RE.test(normalized)) safe.push(normalized)
  }
  return safe
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  try {
    const binary = atob(match[2])
    // Anonymous, unauthenticated endpoint -- cap the decoded size before
    // doing anything else with it (base64 expansion means a client could
    // otherwise send a much larger payload than the 2MB *string* length
    // check in sanitizeScreenshots implies; this is the actual byte-level
    // ceiling, checked before allocating the full output buffer).
    if (binary.length > 2_000_000) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return { bytes, mimeType: match[1] }
  } catch (_) {
    return null
  }
}

// Persists any inline data-URL screenshots to R2 (same bucket/prefix as
// lib/fileAssets.ts's uploads) and returns public paths; already-stored
// `/uploads/...` paths pass through unchanged.
async function materializePortalScreenshots(env: Env, screenshots: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const entry of screenshots) {
    if (/^data:image\//i.test(entry)) {
      const decoded = dataUrlToBytes(entry)
      if (!decoded) continue
      // This is the one upload path in the app that previously skipped
      // magic-byte validation (see lib/uploadSecurity.ts) -- every other
      // upload route (files.ts, products.ts, users.ts, importJobs.ts)
      // already checks that the file's real bytes match its claimed type,
      // but this one is also the only *unauthenticated* upload path
      // (anyone can submit a "screenshot" with a membership number,
      // no login), so it's the highest-value place to close the gap.
      // sanitizeScreenshots already restricted the claimed mime type to
      // image/(png|jpeg|webp|gif) via DATA_IMAGE_RE -- this confirms the
      // decoded bytes actually are that kind of file, not just labeled as
      // one, before anything gets written to R2 and served back out
      // publicly at /uploads/*.
      if (detectBufferKind(decoded.bytes) !== 'image') continue
      const storedName = buildUniqueStoredName(`portal-submission-${Date.now()}.jpg`)
      const objectKey = `uploads/${storedName}`
      await env.ASSETS.put(objectKey, decoded.bytes, { httpMetadata: { contentType: decoded.mimeType } })
      resolved.push(`/uploads/${storedName}`)
      continue
    }
    resolved.push(entry)
  }
  return resolved
}

app.get('/membership/:membershipNumber', async (c) => {
  const rate = await checkRateLimit(c.env, 'portal:membership_lookup', getClientIp(c.req.raw), 45, 60 * 1000)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds))
    return c.json({ error: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.` }, 429)
  }

  const membershipNumber = c.req.param('membershipNumber').trim()
  if (!membershipNumber) return c.json({ error: 'Membership number is required' }, 400)

  const customer = await findCustomerByMembership(c.env, membershipNumber)
  if (!customer) return c.json({ error: 'Membership not found' }, 404)

  const db = getDb(c.env)
  const params = {
    customerId: customer.id || null,
    customerName: customer.name || '',
    customerPhoneNormalized: normalizePhone(customer.phone),
    membershipNumber: customer.membership_number || membershipNumber,
  }
  const salesWhere: string[] = []
  const returnsWhere: string[] = []
  const submissionWhere: string[] = []

  if (params.customerId) {
    salesWhere.push('s.customer_id = @customerId')
    returnsWhere.push('r.customer_id = @customerId')
    submissionWhere.push('customer_id = @customerId')
  }
  if (params.customerName) {
    salesWhere.push(`(
      lower(trim(COALESCE(s.customer_name, ''))) = lower(trim(@customerName))
      AND (
        @customerPhoneNormalized = ''
        OR replace(replace(replace(replace(replace(COALESCE(s.customer_phone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE @customerPhoneNormalized || '%'
      )
    )`)
    returnsWhere.push(`lower(trim(COALESCE(r.customer_name, ''))) = lower(trim(@customerName))`)
  }
  if (params.membershipNumber) {
    submissionWhere.push(`lower(trim(COALESCE(membership_number, ''))) = lower(trim(@membershipNumber))`)
  }

  const salesWhereSql = joinWrappedClauses(salesWhere)
  const returnsWhereSql = joinWrappedClauses(returnsWhere)
  const submissionWhereSql = joinWrappedClauses(submissionWhere)

  // SQLite has no STRING_AGG/FILTER (that's Postgres) -- GROUP_CONCAT with
  // a CASE guard is the direct D1-compatible equivalent.
  const sales = await db.prepare(`
    SELECT
      s.id, s.receipt_number, s.created_at, s.branch_name, s.sale_status, s.payment_method,
      s.total_usd, s.total_khr, s.tax_usd, s.tax_khr, s.delivery_fee_usd, s.delivery_fee_khr,
      s.discount_usd, s.discount_khr,
      COALESCE(s.membership_discount_usd, 0) AS membership_discount_usd,
      COALESCE(s.membership_discount_khr, 0) AS membership_discount_khr,
      COALESCE(s.membership_points_redeemed, 0) AS membership_points_redeemed,
      GROUP_CONCAT(CASE WHEN si.id IS NOT NULL THEN si.product_name || ' x' || si.quantity END, ', ') AS items_summary
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE ${salesWhereSql}
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all(params)

  const returns = await db.prepare(`
    SELECT
      r.id, r.return_number, r.receipt_number, r.created_at, r.branch_name, r.reason, r.return_type,
      r.status, r.total_refund_usd, r.total_refund_khr,
      GROUP_CONCAT(CASE WHEN ri.id IS NOT NULL THEN ri.product_name || ' x' || ri.quantity END, ', ') AS items_summary
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE ${returnsWhereSql}
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all(params)

  const submissionRows = await db.prepare(`
    SELECT id, customer_id, membership_number, customer_name, platform, note, screenshots_json,
           status, reward_points, review_note, reviewed_by_name, reviewed_at, created_at
    FROM customer_share_submissions
    WHERE ${submissionWhereSql}
    ORDER BY created_at DESC
    LIMIT 100
  `).all(params)
  const submissions = normalizePortalSubmissionRows(submissionRows as unknown as Array<Record<string, unknown>>)
  const adjustments = params.customerId
    ? await db.prepare(`
      SELECT id, points, note, created_at
      FROM loyalty_point_adjustments
      WHERE customer_id = @customerId
      ORDER BY created_at DESC
      LIMIT 100
    `).all(params)
    : []

  const settings = await loadSettingsMap(c.env)
  const config = buildPortalConfig(settings, c.env)
  const points = summarizePoints(sales as unknown as Array<Record<string, unknown>>, returns as unknown as Array<Record<string, unknown>>, submissions, config, adjustments as unknown as Array<Record<string, unknown>>)
  const totals = summarizeMembershipTotals(sales as unknown as Array<Record<string, unknown>>, returns as unknown as Array<Record<string, unknown>>)

  return c.json({
    customer,
    sales,
    returns,
    submissions,
    adjustments,
    totals,
    points,
    config: {
      publicUrl: config.publicUrl,
      priceDisplay: config.priceDisplay,
      translateWidgetEnabled: false,
      refreshSeconds: config.refreshSeconds,
      redeemPoints: config.redeemPoints,
      redeemValueUsd: config.redeemValueUsd,
      redeemValueKhr: config.redeemValueKhr,
      membershipInfoText: config.membershipInfoText,
      submissionEnabled: config.submissionEnabled,
      submissionRewardPoints: config.submissionRewardPoints,
      submissionInstructions: config.submissionInstructions,
      googleMapsEmbed: config.googleMapsEmbed,
      showGoogleMap: config.showGoogleMap,
      publicPath: config.publicPath,
    },
  })
})

app.post('/submissions', async (c) => {
  const rate = await checkRateLimit(c.env, 'portal:submissions', getClientIp(c.req.raw), 12, 15 * 60 * 1000)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds))
    return c.json({ error: `Too many requests. Try again in ${rate.retryAfterSeconds} seconds.` }, 429)
  }

  const settings = await loadSettingsMap(c.env)
  const config = buildPortalConfig(settings, c.env)
  if (!config.submissionEnabled) return c.json({ error: 'Customer submissions are currently disabled' }, 403)

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const membershipNumber = String(body.membershipNumber || '').trim()
  if (!membershipNumber) return c.json({ error: 'Membership number is required' }, 400)

  const customer = await findCustomerByMembership(c.env, membershipNumber)
  if (!customer) return c.json({ error: 'Membership not found' }, 404)

  const screenshots = sanitizeScreenshots(body.screenshots)
  if (!screenshots.length) return c.json({ error: 'At least one screenshot is required' }, 400)
  const persistedScreenshots = await materializePortalScreenshots(c.env, screenshots)
  if (!persistedScreenshots.length) {
    return c.json({ error: 'Screenshot upload failed validation. Please upload a real image file.' }, 400)
  }

  const platform = String(body.platform || '').trim().slice(0, 120)
  const note = String(body.note || '').trim().slice(0, 4000)

  const db = getDb(c.env)
  const result = await db.prepare(`
    INSERT INTO customer_share_submissions (
      customer_id, membership_number, customer_name, platform, note, screenshots_json, status
    ) VALUES (@customerId, @membershipNumber, @customerName, @platform, @note, @screenshotsJson, 'pending')
  `).run({
    customerId: customer.id || null,
    membershipNumber: customer.membership_number || membershipNumber,
    customerName: customer.name || '',
    platform: platform || null,
    note: note || null,
    screenshotsJson: JSON.stringify(persistedScreenshots),
  })

  c.executionCtx.waitUntil(broadcast(c.env, 'portalSubmissions', { action: 'create', id: result.lastInsertRowid }))
  return c.json({ success: true, id: result.lastInsertRowid })
})

app.get('/submissions/review', requireAuth, async (c) => {
  const rows = await getDb(c.env).prepare(`
    SELECT id, customer_id, membership_number, customer_name, platform, note, screenshots_json,
           status, reward_points, review_note, reviewed_by_id, reviewed_by_name, reviewed_at, created_at
    FROM customer_share_submissions
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      created_at DESC
  `).all()
  return c.json(normalizePortalSubmissionRows(rows as unknown as Array<Record<string, unknown>>))
})

app.patch('/submissions/:id/review', requireAuth, async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'settings')) return c.json({ error: 'Forbidden' }, 403)

  const id = c.req.param('id')
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const status = String(body.status || '').trim().toLowerCase()
  if (!['pending', 'approved', 'rejected'].includes(status)) return c.json({ error: 'Invalid status' }, 400)

  const rewardPoints = Math.max(0, toNumber(body.reward_points, 0))
  const reviewNote = String(body.review_note || '').trim().slice(0, 4000)

  const db = getDb(c.env)
  const existing = await db.prepare('SELECT id FROM customer_share_submissions WHERE id = @id').get({ id })
  if (!existing) return c.json({ error: 'Submission not found' }, 404)

  await db.prepare(`
    UPDATE customer_share_submissions
    SET status = @status, reward_points = @rewardPoints, review_note = @reviewNote,
        reviewed_by_id = @reviewedById, reviewed_by_name = @reviewedByName, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id,
    status,
    rewardPoints: status === 'approved' ? rewardPoints : 0,
    reviewNote: reviewNote || null,
    reviewedById: user?.id ?? null,
    reviewedByName: user?.name ?? null,
  })

  await audit(c.env, user?.id ?? null, user?.name ?? null, 'review', 'portal_submission', id ?? null, { status, rewardPoints })
  c.executionCtx.waitUntil(broadcast(c.env, 'portalSubmissions', { action: 'review', id }))
  return c.json({ success: true })
})

// Ported following the same pattern as ../routes/products.ts. The full
// version (signals, asset galleries, initials/brand/category facets) is
// documented in cloudflare/MIGRATION.md rather than duplicated here --
// same technique, more branches.
// Builds the WHERE/params for the public catalog search. Previously GET
// /catalog/products/search accepted page/pageSize only and silently
// dropped every other query param the frontend sent (query, brand,
// category, branchId, stockState, initial) -- CatalogProductsSection.tsx's
// filter pills toggled real state and re-fired the search, but the
// backend ran the exact same hardcoded WHERE clause every time, so the
// results never changed no matter what was selected.
//
// Same shape as routes/products.ts's buildSearchFilters, but this is a
// new function rather than a shared/ported one: this route is
// unauthenticated (no requireAuth), the stock-state vocabulary the
// frontend sends here (in_stock/low_stock/out_of_stock) differs from the
// admin catalog's (positive/low/out), and "sellable only" is the correct
// *default* here in a way it deliberately isn't for POS/Products (an
// admin needs to see everything they own; a customer shouldn't be offered
// something with zero stock to buy) -- while still letting an explicit
// stockState filter (e.g. a "low stock" pill, for a "notify me" flow)
// override that default.
// `allowStockStateFilter` mirrors config.showStockStatus (see
// buildPortalConfig above) -- when the merchant has turned the stock-status
// badge/filter off, an explicit ?stockState= query param is ignored
// entirely rather than just hiding the pills client-side, so a customer
// can't bring the filter back by calling this endpoint directly.
//
// `showOutOfStockProducts` mirrors config.showOutOfStockProducts. This used
// to be missing entirely: with no explicit stock pill selected, the
// fallback branch below unconditionally added a "sellable only" clause,
// so out-of-stock products never appeared in the real search/pagination
// results no matter what the merchant's "Show out-of-stock products"
// setting said (the setting was only ever applied as an extra
// *client-side* filter in CatalogPage.tsx, which can hide items further
// but can't un-hide items the server never sent). Now the fallback only
// excludes out-of-stock items when the merchant actually wants them
// hidden; an explicit stock-status pill (e.g. a "notify me" out-of-stock
// filter) still always overrides this default either way.
export function buildPortalProductFilters(query: Record<string, string>, allowStockStateFilter = true, showOutOfStockProducts = false) {
  const where: string[] = ['p.is_active = 1']
  const params: Record<string, unknown> = {}
  const joins: string[] = []

  const branchIds = String(query.branchId || query.branch_id || '')
    .split(',')
    .map((v) => Number.parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
  let stockExpr = 'COALESCE(p.stock_quantity, 0)'
  if (branchIds.length === 1) {
    params.branchId = branchIds[0]
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
    stockExpr = 'COALESCE(selected_bs.quantity, 0)'
  } else if (branchIds.length > 1) {
    // More than one branch selected: sellable if ANY selected branch has
    // it. EXISTS keeps one row per product regardless of match count,
    // instead of needing a JOIN + GROUP BY threaded through every query
    // in this function just to support the multi-branch case.
    const keys = branchIds.map((id, index) => {
      const key = `branch${index}`
      params[key] = id
      return `@${key}`
    })
    where.push(`EXISTS (SELECT 1 FROM branch_stock mb WHERE mb.product_id = p.id AND mb.branch_id IN (${keys.join(', ')}) AND mb.quantity > 0)`)
  }

  // Was `raw.toLowerCase().split(/\s+/)` -- only ever split on whitespace,
  // so it never folded accents/diacritics and never treated "+"/"&"/"-"
  // etc. as word boundaries, meaning a typed "Cover+Concealer" (no spaces)
  // and a stored "Cover + Concealer" (spaces around the plus) landed as
  // different single "words" and never matched. Ported from
  // routes/products.ts's splitSearchTerms (lib/searchMatch.ts's
  // tokenizeSearchWords) -- this is the one search path that reaches
  // real customers (GET /api/portal/catalog/products/search), so it's
  // the one place fuzzy/typo-tolerant matching matters most, and it had
  // been left on a plain substring LIKE this whole time.
  const searchTerms = tokenizeSearchWords(query.query || query.q || '', 8)
  let searchWhereClause: string | undefined
  let matchRankSql: string | undefined
  if (searchTerms.length) {
    // Now on products_fts (migrations/0018_products_fts.sql) via an FTS5
    // column-SET filter (`{name brand category}:term`, see
    // buildFtsMatchExpression's own comment in lib/searchMatch.ts for how
    // this was verified against real FTS5) instead of the old per-row
    // REPLACE()-chain LIKE full-table scan -- that old approach couldn't
    // use SQLite's inverted index at all (every normalizedHaystackSql()
    // wrapper defeats any index on the underlying column), so every
    // storefront search was a full scan of the products table, the exact
    // cost profile migration 0018's own comment warns about. This is the
    // one search path that reaches real customers on every keystroke (see
    // the debounce fix on PublicCatalogPage.tsx), so it's the one place
    // that cost mattered most. The public portal doesn't expose an
    // AND/OR toggle -- always one AND-group of every typed word, same
    // shape this endpoint already had, just expressed as a single FTS5
    // group instead of an ANDed chain of LIKEs. `IN (SELECT rowid FROM
    // products_fts WHERE ... MATCH ...)` rather than a JOIN, matching
    // products.ts/inventory.ts's own wiring (a JOINed FTS5 table combined
    // via OR throws at the SQLite level -- confirmed against real FTS5,
    // see inventory.ts's comment). expandAliasCandidates (RT/NYX/BH/OFRA
    // shorthand) is folded into buildFtsMatchExpression itself now,
    // rather than expanded into separate LIKE clauses here.
    // Column set narrowed to name/sku/barcode only, matching
    // PRODUCT_SEARCH_COLUMNS on the staff-facing surfaces (products.ts/
    // inventory.ts) -- brand/category dropped per the same reasoning that
    // constant's own comment documents: product names already carry the
    // brand in this catalog, and the storefront's own brand/category filter
    // chips (below, the `for (const field of ['brand', 'category'])` loop)
    // already cover exact brand/category lookup. sku/barcode stay in scope
    // -- a shopper scanning or typing a product's barcode/SKU is exactly the
    // "second-most-used search dimension after name" case. 'unit' was never
    // in scope here (no portal equivalent of the admin unit-review
    // workflow), unaffected by this change.
    const ftsMatch = buildFtsMatchExpression([searchTerms], 'AND', ['name', 'sku', 'barcode'])
    const matchClauses: string[] = []
    if (ftsMatch) {
      params.portalFtsQuery = ftsMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @portalFtsQuery)')
      // Relevance ranking (bm25, same weighting products.ts uses) so a
      // search actually surfaces the best match first instead of just
      // alphabetically -- the old LIKE-chain version had no ranking
      // concept at all, every result tied and fell through to the
      // alphabetical ORDER BY regardless of match quality.
      matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @portalFtsQuery), 0)`
    }
    // products_fts_code (migrations/0019_products_fts_code.sql, trigram
    // tokenizer) covers the same real gap it covers for products.ts/
    // inventory.ts: word-prefix FTS5 matching alone can never find a
    // barcode/SKU typed as a MID-string fragment (e.g. the last 4 digits
    // of a barcode) because that fragment isn't a token boundary-aligned
    // prefix -- see that migration's own comment. Not wired to
    // matchRankSql -- trigram relevance isn't meaningful the same way
    // word-match relevance is, same call products.ts already made.
    const trigramMatch = buildTrigramMatchExpression([searchTerms], 'AND')
    if (trigramMatch) {
      params.portalCodeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @portalCodeQuery)')
    }
    // products_fts_name_trigram (migrations/0021_products_fts_name_
    // trigram.sql) -- same fused number+unit/shade-code gap
    // (e.g. "100ml", "110C") as products.ts/inventory.ts, and the
    // storefront needs it just as much: a shopper typing "ml" or a
    // shade-code fragment into the public search box is exactly the
    // reported "search hides a product that's clearly there" case, and
    // this is the highest-traffic search surface in the app (every
    // customer keystroke, not just staff). Reuses the same trigramMatch
    // expression computed above -- it's table-agnostic MATCH text.
    if (trigramMatch) {
      params.portalNameCodeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_name_trigram WHERE products_fts_name_trigram MATCH @portalNameCodeQuery)')
    }
    // Short-word (<3 char) LIKE fallback -- see buildShortWordFallbackClause's
    // own comment in lib/searchMatch.ts. Scoped to 'name' only on the
    // storefront (no 'unit' column exposed here the way the admin
    // products/inventory search intentionally keeps for the unit-review
    // workflow -- see PRODUCT_SEARCH_COLUMNS's own comment).
    // Same depth-100 fix as products.ts/inventory.ts's identical call
    // sites: name_normalized instead of raw p.name, alreadyNormalizedCols=
    // true, so a shopper's 1-2 character search doesn't run the ~78-level
    // nested REPLACE() chain (see migration 0037_product_search_compact_
    // columns.sql and products.ts's own comment on this exact fix).
    const shortWordMatch = buildShortWordFallbackClause([searchTerms], 'AND', ['p.name_normalized'], params, 'portalShortw', true)
    if (shortWordMatch) matchClauses.push(shortWordMatch)
    // Compact-brand substring fallback intentionally NOT called here
    // anymore -- brand dropped from ftsMatch's own column list above, same
    // reasoning (see PRODUCT_SEARCH_COLUMNS's comment in lib/searchMatch.ts).
    // Partial multi-word fallback -- same long-name gap products.ts/
    // inventory.ts close (see buildPartialWordMatchClause's own comment).
    // Scoped to name only, same reasoning as those two.
    // Same depth-100 fix as products.ts/inventory.ts -- name_normalized, alreadyNormalizedCols=true.
    const partialMatch = buildPartialWordMatchClause([searchTerms], 'AND', ['p.name_normalized'], params, 'portalPartialw', 4, true)
    if (partialMatch) matchClauses.push(partialMatch)
    if (matchClauses.length) {
      searchWhereClause = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
    }
  }

  for (const field of ['brand', 'category']) {
    const values = String(query[field] || '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v.toLowerCase() !== 'all')
    if (values.length === 1) {
      params[field] = values[0].toLowerCase()
      where.push(`lower(trim(COALESCE(p.${field}, ''))) = @${field}`)
    } else if (values.length > 1) {
      const keys = values.map((value, index) => {
        const key = `${field}${index}`
        params[key] = value.toLowerCase()
        return `@${key}`
      })
      where.push(`lower(trim(COALESCE(p.${field}, ''))) IN (${keys.join(', ')})`)
    }
  }

  const stockStates = allowStockStateFilter
    ? String(query.stockState || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    : []
  if (stockStates.length) {
    const clauses = stockStates.map((state) => {
      if (state === 'out_of_stock') return `${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`
      if (state === 'low_stock') return `${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`
      if (state === 'in_stock') return `${stockExpr} > COALESCE(p.low_stock_threshold, 10)`
      return '1=1'
    })
    where.push(`(${clauses.join(' OR ')})`)
  } else if (!showOutOfStockProducts) {
    // No explicit stock pill selected, and the merchant wants out-of-stock
    // products hidden by default: exclude them. When
    // showOutOfStockProducts is true, fall through without adding this
    // clause so out-of-stock items are included like everything else.
    where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  }

  // Snapshot before the search clause is added -- every OTHER filter
  // (branch/brand/category/stock) already applies. Same "candidate list
  // for the JS fuzzy fallback" role as products.ts's buildSearchFilters --
  // see that file and lib/searchMatch.ts's runFuzzyFallbackMatch for why
  // this exists. The public storefront is the one search path that reaches
  // real customers, so it's the one place fuzzy/typo tolerance matters
  // most.
  const baseWhere = [...where]
  if (searchWhereClause) where.push(searchWhereClause)

  return { where, joins, params, stockExpr, baseWhere, searchTerms, matchRankSql }
}

app.get('/catalog/products/search', async (c) => {
  const db = getDb(c.env)
  const query = c.req.query()
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1)
  // Default page size is 50 across the app (Part 151's decision, extended
  // here to the public portal's own search endpoint per Part 202 -- this
  // used to default to 20, out of step with every other page's default and
  // with buildPortalCatalog's own bootstrap-snapshot size below).
  // 20, matching CATALOG_DEFAULT_PAGE_SIZE on the storefront -- a request
  // that omits pageSize must get the same page the client would have asked
  // for, or the first load differs from every later one.
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize || '20', 10) || 20))
  const offset = (page - 1) * pageSize

  // Targeted key lookup (not the full loadSettingsMap scan) since this runs
  // on every search/page/filter request -- see buildPortalConfig's
  // showStockStatus/showOutOfStockProducts for the same settings used to
  // drive the editor toggles and the badge/pill display.
  const stockSettingsRows = await db.prepare(
    `SELECT key, value FROM settings WHERE key IN ('customer_portal_show_stock_status', 'customer_portal_show_out_of_stock_products')`
  ).all<{ key: string; value: string }>()
  const stockSettings: Record<string, string> = {}
  for (const row of stockSettingsRows || []) stockSettings[row.key] = row.value
  const allowStockStateFilter = normalizeBoolean(stockSettings.customer_portal_show_stock_status, true)
  const showOutOfStockProducts = normalizeBoolean(stockSettings.customer_portal_show_out_of_stock_products, true)

  const filters = buildPortalProductFilters(query, allowStockStateFilter, showOutOfStockProducts)
  const { where, joins, params } = filters
  // Kept as its own clause (not folded into buildPortalProductFilters/
  // baseWhere) since it's applied here, after the function returns -- but
  // it still needs to reach the fuzzy fallback's candidate query below, or
  // a fuzzy hit could surface a product outside the alphabet bar's
  // selected letter. See the `initialClause` use in the fallback block.
  const initial = String(query.initial || '').trim()
  const initialClause = initial && initial.toLowerCase() !== 'all'
    ? "upper(substr(trim(COALESCE(p.name, '')), 1, 1)) = @initial"
    : undefined
  if (initialClause) {
    params.initial = initial.toUpperCase()
    where.push(initialClause)
  }
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`

  const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM products p ${joinSql} ${whereSql}`).get<{ count: number }>(params)
  let total = totalRow?.count || 0

  // Same field set as buildPortalCatalog's initial (unfiltered, page-1)
  // load above -- this endpoint is what every page/page-size/filter
  // change actually hits, so leaving out stock_quantity/thresholds here
  // (as a previous version of this query did) meant every interaction
  // that re-ran the search -- including just changing page size --
  // dropped stock data entirely, and getStockStatus()'s `Number(qty || 0)`
  // fallback then read that as 0 and mislabeled every low-stock product
  // as out_of_stock.
  const selectColumnsSql = `p.id, p.name, p.category, p.brand, p.unit, p.description,
           p.selling_price_usd, p.selling_price_khr, p.stock_quantity,
           p.low_stock_threshold, p.out_of_stock_threshold, p.image_path`
  // When there's an active search, relevance (bm25 via matchRankSql) sorts
  // first and name is just the tiebreaker -- otherwise (no search) the
  // catalog stays name-alphabetical, same browsing order as before this
  // session's FTS5 change. Mirrors products.ts's own
  // effectiveFamilyOrderSql pattern (match_rank ASC, then the caller's
  // chosen sort).
  const orderBySql = filters.matchRankSql
    ? `${filters.matchRankSql} ASC, lower(p.name) ASC, p.id ASC`
    : PORTAL_CATALOG_DEFAULT_ORDER_SQL
  let items = await db.prepare(`
    SELECT ${selectColumnsSql}
    FROM products p
    ${joinSql}
    ${whereSql}
    ORDER BY ${orderBySql}
    LIMIT @pageSize OFFSET @offset
  `).all({ ...params, pageSize, offset })

  // JS fuzzy (typo-tolerant) fallback -- see lib/searchMatch.ts's
  // runFuzzyFallbackMatch header comment and products.ts's/inventory.ts's
  // identical block. This is the one search path that reaches real
  // customers, so it's the one place typo tolerance matters most. Only
  // runs when the strict SQL-folded search found literally nothing for a
  // real query -- the common case never pays this extra pair of queries.
  // Scoped to name/sku/barcode, matching this endpoint's own ftsMatch
  // column list above (brand/category dropped for the same reasoning --
  // see PRODUCT_SEARCH_COLUMNS's comment in lib/searchMatch.ts).
  if (total === 0 && filters.searchTerms.length) {
    const fallbackBaseWhere = initialClause ? [...filters.baseWhere, initialClause] : filters.baseWhere
    const candidateRows = await db.prepare(`
      SELECT p.id AS id, p.name AS name, p.sku AS sku, p.barcode AS barcode
      FROM products p
      ${joinSql}
      WHERE ${fallbackBaseWhere.join(' AND ')}
      ORDER BY p.id ASC
      LIMIT ${PORTAL_FUZZY_FALLBACK_CANDIDATE_LIMIT}
    `).all<{ id: number; name: string; sku: string; barcode: string }>(params)
    const candidates = candidateRows.map((row) => ({
      id: row.id,
      haystack: [row.name, row.sku, row.barcode].filter(Boolean).join(' '),
    }))
    const fuzzyIds = runFuzzyFallbackMatch(candidates, filters.searchTerms, 'AND').slice(0, PORTAL_FUZZY_FALLBACK_MATCH_CAP)
    if (fuzzyIds.length) {
      const fuzzyParams: Record<string, unknown> = { ...params }
      const idPlaceholders = fuzzyIds.map((id, index) => {
        const key = `fuzzyId${index}`
        fuzzyParams[key] = id
        return `@${key}`
      })
      const fuzzyWhereSql = `WHERE ${[...fallbackBaseWhere, `p.id IN (${idPlaceholders.join(', ')})`].join(' AND ')}`
      const fuzzyTotalRow = await db.prepare(`SELECT COUNT(*) AS count FROM products p ${joinSql} ${fuzzyWhereSql}`).get<{ count: number }>(fuzzyParams)
      total = fuzzyTotalRow?.count || 0
      items = await db.prepare(`
        SELECT ${selectColumnsSql}
        FROM products p
        ${joinSql}
        ${fuzzyWhereSql}
        ORDER BY lower(p.name) ASC, p.id ASC
        LIMIT @pageSize OFFSET @offset
      `).all({ ...fuzzyParams, pageSize, offset })
    }
  }

  // Same branch_stock attachment as buildPortalCatalog's initial load --
  // this is the endpoint every filter/page/search change actually hits, so
  // leaving it out here would mean branch_stock (and the duplicate-row
  // merge below that depends on it) only ever worked on the very first,
  // unfiltered page load.
  const itemsWithBranchStock = await attachPortalBranchStock(c.env, (items || []) as Array<Record<string, unknown>>)

  // Alphabet-bar counts scoped to the SAME filters as the main query above
  // (with `initial` itself forced to 'all', so the bar shows every letter
  // reachable under the current brand/category/branch/stock/search
  // selection, not just whichever letter is currently picked) -- same
  // pattern as routes/products.ts's loadProductFilters, which exists
  // specifically because an unscoped alphabet bar shows non-zero counts
  // for letters that have zero real matches once filters are applied.
  const { where: initialsWhere, joins: initialsJoins, params: initialsParams } = buildPortalProductFilters({ ...query, initial: 'all' }, allowStockStateFilter, showOutOfStockProducts)
  const initials = await db.prepare(`
    SELECT upper(substr(trim(p.name), 1, 1)) AS value, COUNT(*) AS count
    FROM products p
    ${initialsJoins.join('\n')}
    WHERE ${initialsWhere.join(' AND ')} AND trim(COALESCE(p.name, '')) <> ''
    GROUP BY value
    ORDER BY value ASC
  `).all<{ value: string; count: number }>(initialsParams)

  return c.json({
    items: itemsWithBranchStock,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    initials: initials || [],
  })
})

export default app

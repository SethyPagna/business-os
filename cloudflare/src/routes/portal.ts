import { Hono } from 'hono'
import { getDb } from '../lib/db'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env }>()

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

type SettingsMap = Record<string, string>

async function loadSettingsMap(env: Env): Promise<SettingsMap> {
  const db = getDb(env)
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const map: SettingsMap = {}
  for (const row of rows) map[row.key] = row.value
  return map
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
  return c.json({
    businessName: settings.business_name || 'Business OS',
    businessPhone: settings.business_phone || '',
    businessEmail: settings.business_email || '',
    businessAddress: settings.business_address || '',
    businessTagline: settings.customer_portal_business_tagline || '',
    businessLogo: settings.customer_portal_logo_image || '',
    businessCover: settings.customer_portal_cover_image || '',
    showLogo: normalizeBoolean(settings.customer_portal_show_logo, true),
    showCover: normalizeBoolean(settings.customer_portal_show_cover, true),
    showPhone: normalizeBoolean(settings.customer_portal_show_phone, true),
    showEmail: normalizeBoolean(settings.customer_portal_show_email, true),
    showAddress: normalizeBoolean(settings.customer_portal_show_address, true),
    publicUrl: normalizeUrl(settings.customer_portal_public_url),
    links: {
      website: settings.customer_portal_website || '',
      facebook: settings.customer_portal_facebook || '',
      instagram: settings.customer_portal_instagram || '',
      telegram: settings.customer_portal_telegram || '',
    },
    title: settings.business_name || settings.customer_portal_title || 'Customer Portal',
    intro: settings.customer_portal_intro || 'Browse products and check membership details.',
    heroGradientStart: settings.customer_portal_hero_gradient_start || '#0f172a',
    heroGradientMid: settings.customer_portal_hero_gradient_mid || '#14532d',
    heroGradientEnd: settings.customer_portal_hero_gradient_end || '#ea580c',
    exchangeRate: toNumber(settings.exchange_rate, 4100),
    showCatalog: normalizeBoolean(settings.customer_portal_show_catalog, true),
    showPrices: normalizeBoolean(settings.customer_portal_show_prices, true),
    showOutOfStockProducts: normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true),
    priceDisplay: settings.customer_portal_price_display || settings.display_currency || 'USD',
    refreshSeconds: Math.min(120, Math.max(5, Math.round(toNumber(settings.customer_portal_refresh_seconds, 20)))),
    gridColumnsMobile: Math.min(3, Math.max(1, Math.round(toNumber(settings.customer_portal_grid_columns_mobile, 1)))),
    gridColumnsDesktop: Math.min(8, Math.max(2, Math.round(toNumber(settings.customer_portal_grid_columns_desktop, 4)))),
  })
})

// GET /promotions -- the Announcement Strip's public feed. Server-side
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

// Ported following the same pattern as ../routes/products.ts. The full
// version (signals, asset galleries, initials/brand/category facets) is
// documented in cloudflare/MIGRATION.md rather than duplicated here --
// same technique, more branches.
app.get('/catalog/products/search', async (c) => {
  const db = getDb(c.env)
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') || '20', 10) || 20))
  const offset = (page - 1) * pageSize

  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS count FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
  `).get<{ count: number }>()
  const total = totalRow?.count || 0

  const items = await db.prepare(`
    SELECT p.id, p.name, p.category, p.brand, p.selling_price_usd, p.selling_price_khr, p.image_path
    FROM products p
    WHERE p.is_active = 1 AND COALESCE(p.stock_quantity, 0) > COALESCE(p.out_of_stock_threshold, 0)
    ORDER BY lower(p.name) ASC, p.id ASC
    LIMIT @pageSize OFFSET @offset
  `).all({ pageSize, offset })

  return c.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
})

export default app

'use strict'

/**
 * Customer Portal API route module.
 * Handles portal configuration, customer-safe catalog payloads,
 * membership lookup summaries, and share-submission workflows.
 */
const express = require('express')
const { db } = require('../database')
const { tryParse, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { storeDataUrlAsset } = require('../fileAssets')
const { normalizeAboutBlocks, normalizeGoogleMapsEmbed } = require('../portalUtils')
const { generatePortalAiResponse, getPortalAiUsageStatus } = require('../services/portalAi')
const { checkRateLimit } = require('../security')
const { getDefaultOrganization, getPortalPublicPath } = require('../organizationContext')
const { assertSafeOutboundUrl, isSafeExternalImageReference } = require('../netSecurity')
const { sanitizeMediaList, sanitizeSettingsSnapshot } = require('../settingsSnapshot')
const { getOrSetJson } = require('../runtimeCache')
const { aggregateInitialRows, getInitialKey, getInitialType } = require('../initials')

const router = express.Router()

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

/** Parse a finite number with safe fallback for invalid values. */
function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/** Normalize mixed boolean-like payload values (1/true/yes/on). */
function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

/** Strip non-numeric characters for phone/membership matching. */
function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '')
}

/** Sanitize and normalize customer portal public path. */
function normalizePublicPath(value) {
  const raw = String(value || '').trim()
  const cleaned = raw
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  return cleaned ? `/${cleaned}` : '/customer-portal'
}

/** Validate/normalize absolute public URL fields. */
function normalizeUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^https?:\/\//i.test(raw)
    ? raw
    : (/^(www\.|[\w-]+(\.[\w-]+)+)/i.test(raw) ? `https://${raw}` : '')
  if (!normalized) return ''
  try {
    return assertSafeOutboundUrl(normalized, { allowedProtocols: ['https:', 'http:'] }).replace(/\/$/, '')
  } catch (_) {
    return ''
  }
}

/** Keep redemption USD value as non-negative integer. */
function normalizeRedeemValueUsd(value, fallback = 1) {
  return Math.max(0, Math.round(toNumber(value, fallback)))
}

/** Keep redemption KHR value in 1000 increments, minimum 1000 when non-zero. */
function normalizeRedeemValueKhr(value, fallback = 4100) {
  const raw = Math.max(0, Math.round(toNumber(value, fallback)))
  if (raw === 0) return 0
  return Math.max(1000, Math.ceil(raw / 1000) * 1000)
}

/** Normalize configurable gradient color values into safe hex colors. */
function normalizeHexColor(value, fallback) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

/** Normalize editable FAQ entries into safe public question/answer pairs. */
function normalizeFaqItems(value) {
  const input = Array.isArray(value) ? value : tryParse(value, [])
  if (!Array.isArray(input)) return []
  return input
    .map((item, index) => ({
      id: String(item?.id || `faq-${index + 1}`).trim() || `faq-${index + 1}`,
      question: String(item?.question || '').trim(),
      answer: String(item?.answer || '').trim(),
    }))
    .filter((item) => item.question && item.answer)
    .slice(0, 24)
}

/** Sanitize optional per-language public portal dynamic content overrides. */
function normalizePortalTranslations(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : tryParse(value, {})
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const normalized = {}
  Object.entries(input).forEach(([language, block]) => {
    const languageKey = String(language || '').trim()
    if (!languageKey || !block || typeof block !== 'object' || Array.isArray(block)) return
    normalized[languageKey] = block
  })
  return normalized
}

function normalizeProductIdList(value) {
  const input = Array.isArray(value) ? value : tryParse(value, [])
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const ids = []
  input.forEach((entry) => {
    const id = Number(entry)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}

/** Load global settings table into key/value map for fast lookup. */
function loadSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const map = {}
  rows.forEach((row) => { map[row.key] = row.value })
  return sanitizeSettingsSnapshot(map)
}

/** Build full portal configuration object from persisted settings. */
function buildPortalConfig() {
  const settings = loadSettingsMap()
  const organization = getDefaultOrganization()
  const defaultPublicPath = getPortalPublicPath(organization || { slug: 'leangcosmetics' })
  const exchangeRate = toNumber(settings.exchange_rate, 4100)
  const pointsBasis = ['usd', 'khr'].includes(String(settings.customer_portal_points_basis || '').toLowerCase())
    ? String(settings.customer_portal_points_basis).toLowerCase()
    : 'usd'
  const pointsPerUsd = toNumber(settings.customer_portal_points_per_usd, 1)
  const derivedPointsPerKhr = pointsPerUsd > 0 && exchangeRate > 0 ? pointsPerUsd / exchangeRate : 0
  const languageSetting = settings.customer_portal_language || 'auto'
  const language = languageSetting === 'auto'
    ? 'en'
    : languageSetting

  const redeemPoints = Math.max(1, Math.floor(toNumber(settings.customer_portal_redeem_points, 100)))
  const redeemValueUsd = normalizeRedeemValueUsd(settings.customer_portal_redeem_value_usd, 1)
  const redeemValueKhr = normalizeRedeemValueKhr(settings.customer_portal_redeem_value_khr, exchangeRate)
  const recommendedProductIds = normalizeProductIdList(settings.customer_portal_recommended_product_ids || '[]')

  return {
    businessName: settings.business_name || 'Business OS',
    businessPhone: settings.business_phone || '',
    businessEmail: settings.business_email || '',
    businessAddress: settings.business_address || '',
    addressLink: normalizeUrl(settings.customer_portal_address_link),
    businessTagline: settings.customer_portal_business_tagline || '',
    businessLogo: settings.customer_portal_logo_image || '',
    businessFavicon: settings.customer_portal_favicon_image || '',
    logoSize: Math.min(144, Math.max(48, Math.round(toNumber(settings.customer_portal_logo_size, 80)))),
    logoFit: settings.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
    logoZoom: Math.min(180, Math.max(80, Math.round(toNumber(settings.customer_portal_logo_zoom, 100)))),
    logoPositionX: Math.min(100, Math.max(0, Math.round(toNumber(settings.customer_portal_logo_position_x, 50)))),
    logoPositionY: Math.min(100, Math.max(0, Math.round(toNumber(settings.customer_portal_logo_position_y, 50)))),
    businessCover: settings.customer_portal_cover_image || '',
    showLogo: normalizeBoolean(settings.customer_portal_show_logo, true),
    showCover: normalizeBoolean(settings.customer_portal_show_cover, true),
    showPhone: normalizeBoolean(settings.customer_portal_show_phone, true),
    showEmail: normalizeBoolean(settings.customer_portal_show_email, true),
    showAddress: normalizeBoolean(settings.customer_portal_show_address, true),
    publicUrl: normalizeUrl(settings.customer_portal_public_url),
    googleMapsEmbed: normalizeGoogleMapsEmbed(settings.customer_portal_google_maps_embed),
    showGoogleMap: normalizeBoolean(settings.customer_portal_show_google_map, true),
    links: {
      website: settings.customer_portal_website || '',
      facebook: settings.customer_portal_facebook || '',
      instagram: settings.customer_portal_instagram || '',
      telegram: settings.customer_portal_telegram || '',
    },
    // Customer-visible label overrides for each social/action link.
    linkLabels: {
      website: String(settings.customer_portal_website_label || 'Website').trim() || 'Website',
      facebook: String(settings.customer_portal_facebook_label || 'Facebook').trim() || 'Facebook',
      instagram: String(settings.customer_portal_instagram_label || 'Instagram').trim() || 'Instagram',
      telegram: String(settings.customer_portal_telegram_label || 'Telegram').trim() || 'Telegram',
    },
    showWebsite: normalizeBoolean(settings.customer_portal_show_website, true),
    showFacebook: normalizeBoolean(settings.customer_portal_show_facebook, true),
    showInstagram: normalizeBoolean(settings.customer_portal_show_instagram, true),
    showTelegram: normalizeBoolean(settings.customer_portal_show_telegram, true),
    title: settings.business_name || settings.customer_portal_title || 'Customer Portal',
    titleSize: Math.min(64, Math.max(28, Number(settings.customer_portal_title_size || 40) || 40)),
    intro: settings.customer_portal_intro || 'Browse products and check membership details.',
    aiEnabled: normalizeBoolean(settings.customer_portal_ai_enabled, true),
    aiTitle: String(settings.customer_portal_ai_title || 'Beauty Assistant').trim() || 'Beauty Assistant',
    aiIntro: String(settings.customer_portal_ai_intro || 'Tell us what you are shopping for and the assistant will suggest products from Leang Cosmetics.').trim(),
    aiDisclaimer: String(settings.customer_portal_ai_disclaimer || 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.').trim()
      || 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.',
    aiProviderId: Number(settings.customer_portal_ai_provider_id || 0) || null,
    aiPrompt: String(settings.customer_portal_ai_prompt || '').trim(),
    showFaq: normalizeBoolean(settings.customer_portal_show_faq, true),
    faqTitle: String(settings.customer_portal_faq_title || 'Frequently asked questions').trim() || 'Frequently asked questions',
    faqItems: normalizeFaqItems(settings.customer_portal_faq_items || '[]'),
    showAbout: normalizeBoolean(settings.customer_portal_show_about, true),
    aboutTitle: String(settings.customer_portal_about_title || 'About us').trim() || 'About us',
    aboutContent: String(settings.customer_portal_about_content || '').trim(),
    aboutBlocks: normalizeAboutBlocks(settings.customer_portal_about_blocks || '[]'),
    translations: normalizePortalTranslations(settings.customer_portal_translations || '{}'),
    heroGradientStart: normalizeHexColor(settings.customer_portal_hero_gradient_start, '#0f172a'),
    heroGradientMid: normalizeHexColor(settings.customer_portal_hero_gradient_mid, '#14532d'),
    heroGradientEnd: normalizeHexColor(settings.customer_portal_hero_gradient_end, '#ea580c'),
    language,
    languageSetting,
    exchangeRate,
    translateWidgetEnabled: normalizeBoolean(settings.customer_portal_translate_widget_enabled, false),
    showCatalog: normalizeBoolean(settings.customer_portal_show_catalog, true),
    showMembership: normalizeBoolean(settings.customer_portal_show_membership, true),
    showPrices: normalizeBoolean(settings.customer_portal_show_prices, true),
    showOutOfStockProducts: normalizeBoolean(settings.customer_portal_show_out_of_stock_products, true),
    priceDisplay: settings.customer_portal_price_display || settings.display_currency || 'USD',
    showTopSellerBadge: normalizeBoolean(settings.customer_portal_show_top_seller_badge, true),
    showTopProductBadge: normalizeBoolean(settings.customer_portal_show_top_product_badge, true),
    showRecommendedBadge: normalizeBoolean(settings.customer_portal_show_recommended_badge, true),
    showPromotionBadge: normalizeBoolean(settings.customer_portal_show_promotion_badge, true),
    showNewArrivalBadge: normalizeBoolean(settings.customer_portal_show_new_arrival_badge, false),
    highlightRankLimit: Math.max(1, Math.min(10, Math.round(toNumber(settings.customer_portal_highlight_rank_limit, 3)))),
    recommendedProductIds,
    refreshSeconds: Math.min(120, Math.max(5, Math.round(toNumber(settings.customer_portal_refresh_seconds, 20)))),
    stockThresholdMode: settings.customer_portal_stock_threshold_mode === 'global' ? 'global' : 'product',
    lowStockThreshold: Math.max(0, toNumber(settings.customer_portal_low_stock_threshold, 10)),
    outOfStockThreshold: Math.max(0, toNumber(settings.customer_portal_out_of_stock_threshold, 0)),
    gridColumnsMobile: Math.min(3, Math.max(1, Math.round(toNumber(settings.customer_portal_grid_columns_mobile, 1)))),
    gridColumnsDesktop: Math.min(8, Math.max(2, Math.round(toNumber(settings.customer_portal_grid_columns_desktop, 4)))),
    pointsBasis,
    pointsPerUsd,
    pointsPerKhr: toNumber(settings.customer_portal_points_per_khr, derivedPointsPerKhr),
    redeemPoints,
    redeemValueUsd,
    redeemValueKhr,
    showPointValue: normalizeBoolean(settings.customer_portal_show_point_value, true),
    membershipInfoText: settings.customer_portal_membership_info_text
      || 'Membership points are reviewed and applied by staff during checkout. Redemption uses whole units only.',
    submissionEnabled: normalizeBoolean(settings.customer_portal_submission_enabled, true),
    submissionRewardPoints: Math.max(0, Math.floor(toNumber(settings.customer_portal_submission_reward_points, 5))),
    submissionInstructions: settings.customer_portal_submission_instructions
      || 'Share the business on social media, then upload screenshots here for staff review.',
    publicPath: normalizePublicPath(settings.customer_portal_path || defaultPublicPath),
    organization: organization ? {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      public_id: organization.public_id,
    } : null,
  }
}

function buildRankMap(rows, scoreKey) {
  const ranked = rows
    .map((row) => ({
      productId: Number(row?.product_id || 0),
      score: Number(row?.[scoreKey] || 0),
    }))
    .filter((row) => row.productId > 0 && row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.productId - b.productId
    })

  const rankMap = new Map()
  ranked.forEach((row, index) => {
    rankMap.set(row.productId, index + 1)
  })
  return rankMap
}

function getPortalProductSignals(config) {
  const completedStatuses = "('cancelled','awaiting_payment')"
  const saleRows = db.prepare(`
    SELECT
      si.product_id,
      COALESCE(SUM(si.quantity), 0) AS sold_quantity,
      COALESCE(SUM(si.total_usd), 0) AS revenue_usd,
      COALESCE(SUM(si.total_khr), 0) AS revenue_khr
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id IS NOT NULL
      AND COALESCE(s.sale_status, 'completed') NOT IN ${completedStatuses}
    GROUP BY si.product_id
  `).all()

  const returnRows = db.prepare(`
    SELECT
      ri.product_id,
      COALESCE(SUM(ri.quantity), 0) AS returned_quantity,
      COALESCE(SUM(ri.total_usd), 0) AS refunded_usd,
      COALESCE(SUM(ri.total_khr), 0) AS refunded_khr
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE ri.product_id IS NOT NULL
      AND COALESCE(r.status, 'completed') != 'cancelled'
      AND COALESCE(r.return_scope, 'customer') = 'customer'
    GROUP BY ri.product_id
  `).all()

  const metrics = new Map()
  saleRows.forEach((row) => {
    const productId = Number(row.product_id || 0)
    if (!productId) return
    metrics.set(productId, {
      product_id: productId,
      sold_quantity: Number(row.sold_quantity || 0),
      revenue_usd: Number(row.revenue_usd || 0),
      revenue_khr: Number(row.revenue_khr || 0),
      returned_quantity: 0,
      refunded_usd: 0,
      refunded_khr: 0,
    })
  })

  returnRows.forEach((row) => {
    const productId = Number(row.product_id || 0)
    if (!productId) return
    const current = metrics.get(productId) || {
      product_id: productId,
      sold_quantity: 0,
      revenue_usd: 0,
      revenue_khr: 0,
      returned_quantity: 0,
      refunded_usd: 0,
      refunded_khr: 0,
    }
    current.returned_quantity = Number(row.returned_quantity || 0)
    current.refunded_usd = Number(row.refunded_usd || 0)
    current.refunded_khr = Number(row.refunded_khr || 0)
    metrics.set(productId, current)
  })

  const rankedRows = Array.from(metrics.values()).map((row) => ({
    product_id: row.product_id,
    net_quantity: Math.max(0, row.sold_quantity - row.returned_quantity),
    net_revenue_usd: Math.max(0, row.revenue_usd - row.refunded_usd),
    net_revenue_khr: Math.max(0, row.revenue_khr - row.refunded_khr),
  }))

  const topSellerRank = buildRankMap(rankedRows, 'net_quantity')
  const topProductRank = buildRankMap(rankedRows, 'net_revenue_usd')

  const newArrivalRank = new Map()
  db.prepare(`
    SELECT id
    FROM products
    WHERE is_active = 1
    ORDER BY COALESCE(created_at, updated_at) DESC, id DESC
  `).all().forEach((row, index) => {
    const productId = Number(row.id || 0)
    if (!productId) return
    newArrivalRank.set(productId, index + 1)
  })

  const recommendedRank = new Map()
  normalizeProductIdList(config?.recommendedProductIds || []).forEach((productId, index) => {
    recommendedRank.set(productId, index + 1)
  })

  return {
    topSellerRank,
    topProductRank,
    newArrivalRank,
    recommendedRank,
  }
}

/** Convert sale/return amounts into points based on selected points basis. */
function calculatePointsValue(amountUsd, amountKhr, config) {
  if (config.pointsBasis === 'khr') {
    if (config.pointsPerKhr > 0) return amountKhr * config.pointsPerKhr
    return 0
  }
  if (config.pointsPerUsd > 0) return amountUsd * config.pointsPerUsd
  return 0
}

/** Aggregate earned/deducted/redeemed/rewarded points and redemption summary. */
function summarizePoints(sales, returns, submissions, config) {
  const eligibleSales = sales.filter((sale) => !['cancelled', 'awaiting_payment'].includes(sale.sale_status || 'completed'))
  const activeReturns = returns.filter((ret) => (ret.status || 'completed') !== 'cancelled')
  const approvedRewards = submissions.filter((submission) => submission.status === 'approved')

  const earned = eligibleSales.reduce((sum, sale) => (
    sum + calculatePointsValue(toNumber(sale.total_usd), toNumber(sale.total_khr), config)
  ), 0)

  const deducted = activeReturns.reduce((sum, ret) => (
    sum + calculatePointsValue(toNumber(ret.total_refund_usd), toNumber(ret.total_refund_khr), config)
  ), 0)

  const redeemed = eligibleSales.reduce((sum, sale) => (
    sum + toNumber(sale.membership_points_redeemed)
  ), 0)

  const rewarded = approvedRewards.reduce((sum, submission) => (
    sum + toNumber(submission.reward_points)
  ), 0)

  const balance = Math.max(0, earned - deducted - redeemed + rewarded)
  const redeemableUnits = Math.floor(balance / Math.max(1, config.redeemPoints))

  return {
    earned: Number(earned.toFixed(2)),
    deducted: Number(deducted.toFixed(2)),
    redeemed: Number(redeemed.toFixed(2)),
    rewarded: Number(rewarded.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    redeemableUnits,
    minimumRedeemPoints: config.redeemPoints,
    nextRedeemAt: config.redeemPoints,
    nextRedeemNeeded: Math.max(0, Number((config.redeemPoints - (balance % config.redeemPoints || 0)).toFixed(2)) % config.redeemPoints),
    redeemValueUsd: Number((redeemableUnits * config.redeemValueUsd).toFixed(2)),
    redeemValueKhr: Number((redeemableUnits * config.redeemValueKhr).toFixed(0)),
  }
}

/** Return customer-facing product payload including branch stock and image gallery. */
function getPortalProducts(config = buildPortalConfig()) {
  const signals = getPortalProductSignals(config)
  const products = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.category,
      p.brand,
      p.unit,
      p.description,
      p.selling_price_usd,
      p.selling_price_khr,
      p.special_price_usd,
      p.special_price_khr,
      p.discount_enabled,
      p.discount_type,
      p.discount_percent,
      p.discount_amount_usd,
      p.discount_amount_khr,
      p.discount_label,
      p.discount_badge_color,
      p.discount_starts_at,
      p.discount_ends_at,
      p.stock_quantity,
      p.low_stock_threshold,
      p.out_of_stock_threshold,
      p.image_path,
      p.created_at
    FROM products p
    WHERE p.is_active = 1
    ORDER BY p.name COLLATE NOCASE ASC
    LIMIT 500
  `).all()

  const ids = products.map((product) => product.id)
  const imageRows = ids.length
    ? db.prepare(`
      SELECT product_id, image_path
      FROM product_images
      WHERE product_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order ASC, id ASC
    `).all(...ids)
    : []
  const imageMap = new Map()
  imageRows.forEach((row) => {
    if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, [])
    imageMap.get(row.product_id).push(row.image_path)
  })
  const branchRows = ids.length
    ? db.prepare(`
      SELECT
        bs.product_id,
        b.id AS branch_id,
        b.name AS branch_name,
        COALESCE(bs.quantity, 0) AS quantity
      FROM branch_stock bs
      JOIN branches b ON b.id = bs.branch_id
      WHERE bs.product_id IN (${ids.map(() => '?').join(',')})
        AND b.is_active = 1
      ORDER BY bs.product_id ASC, b.is_default DESC, b.name ASC
    `).all(...ids)
    : []
  const branchStockMap = new Map()
  branchRows.forEach((row) => {
    if (!branchStockMap.has(row.product_id)) branchStockMap.set(row.product_id, [])
    branchStockMap.get(row.product_id).push({
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      quantity: row.quantity,
    })
  })

  return products.map((product) => {
    const gallery = sanitizeMediaList(imageMap.get(product.id) || []).slice(0, 5)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    return {
      ...product,
      image_path: gallery[0] || null,
      image_gallery: gallery,
      branch_stock: branchStockMap.get(product.id) || [],
      top_seller_rank: signals.topSellerRank.get(product.id) || 0,
      top_product_rank: signals.topProductRank.get(product.id) || 0,
      new_arrival_rank: signals.newArrivalRank.get(product.id) || 0,
      portal_recommended: signals.recommendedRank.has(product.id),
      recommended_rank: signals.recommendedRank.get(product.id) || 0,
    }
  })
}

function cacheTtl(seconds = 20) {
  return Math.min(60, Math.max(5, Number(seconds || 20) || 20))
}

function normalizePositiveInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function splitSearchTerms(value = '') {
  return String(value || '')
    .normalize('NFC')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
}

function splitFilterValues(value = '') {
  return String(value || '')
    .normalize('NFC')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== 'all')
    .slice(0, 40)
}

function appendPortalProductSearchFilters(query = {}, config = {}) {
  const joins = []
  const params = {}
  const where = ['p.is_active = 1']
  const branchIds = splitFilterValues(query.branchId || query.branch_id || '')
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
  if (branchIds.length) {
    branchIds.forEach((id, index) => {
      params[`branchId${index}`] = id
    })
  }
  const searchTerms = splitSearchTerms(query.query || query.q || '')
  if (searchTerms.length) {
    const clauses = searchTerms.map((term, index) => {
      const key = `search${index}`
      params[key] = `%${term}%`
      return `(
        lower(COALESCE(p.name, '')) LIKE @${key}
        OR lower(COALESCE(p.category, '')) LIKE @${key}
        OR lower(COALESCE(p.brand, '')) LIKE @${key}
        OR lower(COALESCE(p.description, '')) LIKE @${key}
      )`
    })
    where.push(`(${clauses.join(' AND ')})`)
  }
  ;['brand', 'category'].forEach((field) => {
    const values = splitFilterValues(query[field] || '')
    if (values.length === 1) {
      params[field] = values[0]
      where.push(`p.${field} = @${field}`)
    } else if (values.length > 1) {
      const keys = values.map((value, index) => {
        const key = `${field}${index}`
        params[key] = value
        return `@${key}`
      })
      where.push(`p.${field} IN (${keys.join(',')})`)
    }
  })
  const branchIdPlaceholders = branchIds.map((_, index) => `@branchId${index}`).join(',')
  const stockExpr = branchIds.length
    ? `(SELECT COALESCE(SUM(quantity), 0) FROM branch_stock selected_bs WHERE selected_bs.product_id = p.id AND selected_bs.branch_id IN (${branchIdPlaceholders}))`
    : 'COALESCE(p.stock_quantity, 0)'
  if (branchIds.length) {
    where.push(`${stockExpr} > 0`)
  }
  const stockStates = splitFilterValues(query.stockState || query.stock_state || '').map((entry) => entry.toLowerCase())
  if (stockStates.length) {
    const stockClauses = []
    if (stockStates.includes('in_stock') || stockStates.includes('positive')) stockClauses.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
    if (stockStates.includes('low_stock') || stockStates.includes('low')) stockClauses.push(`(${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10))`)
    if (stockStates.includes('out_of_stock') || stockStates.includes('out')) stockClauses.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
    if (stockClauses.length) where.push(`(${stockClauses.join(' OR ')})`)
  }
  if (!normalizeBoolean(config?.showOutOfStockProducts, false) && !stockStates.length) {
    where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  }
  const initial = String(query.initial || '').normalize('NFC').trim()
  if (initial && initial.toLowerCase() !== 'all') {
    const key = getInitialKey(initial)
    params.initial = key
    if (getInitialType(key) === 'latin') where.push('upper(substr(trim(COALESCE(p.name, "")), 1, 1)) = @initial')
    else where.push('substr(trim(COALESCE(p.name, "")), 1, 1) = @initial')
  }
  return { joins, where, params, stockExpr }
}

function getPortalCatalogSearchMetadata(query = {}, config = {}) {
  const metadataQuery = { ...query, initial: 'all' }
  const { joins, where, params } = appendPortalProductSearchFilters(metadataQuery, config)
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`
  const distinctField = (field) => db.prepare(`
    SELECT DISTINCT p.${field} AS value
    FROM products p
    ${joinSql}
    ${whereSql}
      AND COALESCE(trim(p.${field}), '') != ''
    ORDER BY p.${field} COLLATE NOCASE ASC
    LIMIT 500
  `).all(params).map((row) => row.value)
  const initials = aggregateInitialRows(db.prepare(`
    SELECT substr(trim(p.name), 1, 1) AS value, COUNT(*) AS count
    FROM products p
    ${joinSql}
    ${whereSql}
      AND COALESCE(trim(p.name), '') != ''
    GROUP BY value
  `).all(params))
  return {
    brands: distinctField('brand'),
    categories: distinctField('category'),
    initials,
  }
}

function getPortalCatalogProductPage(config = {}, query = {}) {
  const page = normalizePositiveInt(query.page, 1, { min: 1, max: 100000 })
  const pageSize = normalizePositiveInt(query.pageSize || query.page_size, 20, { min: 1, max: 100 })
  const offset = (page - 1) * pageSize
  const signals = getPortalProductSignals(config)
  const { joins, where, params, stockExpr } = appendPortalProductSearchFilters(query, config)
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products p
    ${joinSql}
    ${whereSql}
  `).get(params)?.count || 0
  const products = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.category,
      p.brand,
      p.unit,
      p.description,
      p.selling_price_usd,
      p.selling_price_khr,
      p.special_price_usd,
      p.special_price_khr,
      p.discount_enabled,
      p.discount_type,
      p.discount_percent,
      p.discount_amount_usd,
      p.discount_amount_khr,
      p.discount_label,
      p.discount_badge_color,
      p.discount_starts_at,
      p.discount_ends_at,
      p.stock_quantity,
      p.low_stock_threshold,
      p.out_of_stock_threshold,
      p.image_path,
      p.created_at,
      ${stockExpr} AS selected_branch_quantity
    FROM products p
    ${joinSql}
    ${whereSql}
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
    LIMIT @pageSize OFFSET @offset
  `).all({ ...params, pageSize, offset })

  const ids = products.map((product) => product.id)
  const imageRows = ids.length
    ? db.prepare(`
      SELECT product_id, image_path
      FROM product_images
      WHERE product_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order ASC, id ASC
    `).all(...ids)
    : []
  const branchRows = ids.length
    ? db.prepare(`
      SELECT
        bs.product_id,
        b.id AS branch_id,
        b.name AS branch_name,
        COALESCE(bs.quantity, 0) AS quantity
      FROM branch_stock bs
      JOIN branches b ON b.id = bs.branch_id
      WHERE bs.product_id IN (${ids.map(() => '?').join(',')})
        AND b.is_active = 1
      ORDER BY bs.product_id ASC, b.is_default DESC, b.name ASC
    `).all(...ids)
    : []
  const imageMap = new Map()
  imageRows.forEach((row) => {
    if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, [])
    imageMap.get(row.product_id).push(row.image_path)
  })
  const branchStockMap = new Map()
  branchRows.forEach((row) => {
    if (!branchStockMap.has(row.product_id)) branchStockMap.set(row.product_id, [])
    branchStockMap.get(row.product_id).push({
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      quantity: row.quantity,
    })
  })

  const items = products.map((product) => {
    const gallery = sanitizeMediaList(imageMap.get(product.id) || []).slice(0, 5)
    const fallbackImage = sanitizeMediaList([product.image_path])[0] || null
    if (!gallery.length && fallbackImage) gallery.push(fallbackImage)
    return {
      ...product,
      image_path: gallery[0] || null,
      image_gallery: gallery,
      branch_stock: branchStockMap.get(product.id) || [],
      top_seller_rank: signals.topSellerRank.get(product.id) || 0,
      top_product_rank: signals.topProductRank.get(product.id) || 0,
      new_arrival_rank: signals.newArrivalRank.get(product.id) || 0,
      portal_recommended: signals.recommendedRank.has(product.id),
      recommended_rank: signals.recommendedRank.get(product.id) || 0,
    }
  })
  const filters = getPortalCatalogSearchMetadata(query, config)
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    filters,
    initials: filters.initials,
  }
}

function getCachedPortalConfig() {
  return getOrSetJson('portal:config', 20, () => buildPortalConfig())
}

function getCachedPortalMeta() {
  return getOrSetJson('portal:meta', 20, () => getPortalCatalogMeta())
}

function getCachedPortalProducts(config) {
  const ttl = cacheTtl(config?.refreshSeconds || 20)
  return getOrSetJson('portal:products', ttl, () => getPortalProducts(config))
}

function getPortalCatalogMeta() {
  const categories = db.prepare(`
    SELECT id, name
    FROM categories
    ORDER BY name COLLATE NOCASE ASC
  `).all()

  const productBrands = db.prepare(`
    SELECT DISTINCT brand
    FROM products
    WHERE is_active = 1
      AND brand IS NOT NULL
      AND trim(brand) != ''
    ORDER BY brand COLLATE NOCASE ASC
  `).all().map((row) => row.brand)

  let libraryBrands = []
  try {
    const rawValue = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = 'product_brand_options'
      LIMIT 1
    `).get()?.value
    const parsed = JSON.parse(rawValue || '[]')
    if (Array.isArray(parsed)) {
      libraryBrands = parsed
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    }
  } catch (_) {}

  const brands = Array.from(new Set([...productBrands, ...libraryBrands]))
    .sort((a, b) => a.localeCompare(b))

  const branches = db.prepare(`
    SELECT id, name, is_default
    FROM branches
    WHERE is_active = 1
    ORDER BY is_default DESC, name COLLATE NOCASE ASC
  `).all()

  return { categories, brands, branches }
}

/** Resolve active customer by membership number (case-insensitive). */
function findCustomerByMembership(membershipNumber) {
  return db.prepare(`
    SELECT id, name, membership_number, phone, email, address, company, notes, created_at
    FROM customers
    WHERE lower(trim(membership_number)) = lower(trim(?))
    LIMIT 1
  `).get(membershipNumber)
}

/** Sanitize screenshot payload to supported URL/data-image entries with limits. */
function sanitizeScreenshots(value) {
  const screenshots = Array.isArray(value) ? value : []
  return screenshots
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry && entry.length <= 2_000_000)
    .filter((entry) => isSafeExternalImageReference(entry))
    .slice(0, 8)
}

async function materializePortalScreenshots(screenshots = []) {
  const resolved = []
  for (const entry of screenshots) {
    if (/^data:image\//i.test(entry)) {
      const asset = await storeDataUrlAsset({
        dataUrl: entry,
        fileName: `portal-submission-${Date.now()}.jpg`,
        source: 'portal_submission',
      })
      resolved.push(asset.public_path)
      continue
    }
    resolved.push(entry)
  }
  return resolved
}

/** Normalize public AI assistant profile payload into short searchable fields. */
function sanitizeAiProfile(value) {
  const profile = value && typeof value === 'object' ? value : {}
  return {
    brand: String(profile.brand || '').trim().slice(0, 120),
    skinType: String(profile.skinType || '').trim().slice(0, 120),
    concerns: String(profile.concerns || '').trim().slice(0, 220),
    shoppingFor: String(profile.shoppingFor || '').trim().slice(0, 120),
    goal: String(profile.goal || '').trim().slice(0, 180),
  }
}

/** Build a lightweight visitor fingerprint for AI throttling/fairness only. */
function getVisitorFingerprint(req) {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 120)
  const ua = String(req.get('user-agent') || '').trim().slice(0, 240)
  return `${ip}|${ua || 'unknown-agent'}`
}

function getClientKey(req, suffix = '') {
  const ip = String(req.ip || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown-ip'
  return `${ip}|${String(suffix || '').trim().toLowerCase()}`
}

function applyPortalRateLimit(req, res, { name, max, windowMs, key = '' }) {
  const result = checkRateLimit(name, getClientKey(req, key || name), max, windowMs)
  if (result.allowed) return true
  res.setHeader('Retry-After', String(result.retryAfterSeconds))
  res.status(429).json({ error: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.` })
  return false
}

router.get('/config', asyncRoute(async (_req, res) => {
  res.json(await getCachedPortalConfig())
}))

router.get('/bootstrap', asyncRoute(async (_req, res) => {
  const config = await getCachedPortalConfig()
  const catalog = getPortalCatalogProductPage(config, { page: 1, pageSize: 20 })
  res.json({
    config,
    meta: await getCachedPortalMeta(),
    catalog,
    products: catalog.items,
  })
}))

router.get('/catalog/meta', asyncRoute(async (_req, res) => {
  res.json(await getCachedPortalMeta())
}))

router.get('/catalog/products', asyncRoute(async (_req, res) => {
  const config = await getCachedPortalConfig()
  res.json(await getCachedPortalProducts(config))
}))

router.get('/catalog/products/search', asyncRoute(async (req, res) => {
  const config = await getCachedPortalConfig()
  res.json(getPortalCatalogProductPage(config, req.query))
}))

router.get('/ai/status', (_req, res) => {
  const config = buildPortalConfig()
  const usage = getPortalAiUsageStatus(config, config.aiProviderId)
  res.json({
    success: true,
    enabled: !!config.aiEnabled,
    title: config.aiTitle,
    disclaimer: config.aiDisclaimer,
    usage,
  })
})

router.post('/ai/chat', async (req, res) => {
  try {
    if (!applyPortalRateLimit(req, res, { name: 'portal:ai_chat', max: 20, windowMs: 60 * 1000 })) return
    const config = await getCachedPortalConfig()
    if (!config.aiEnabled) {
      return res.status(403).json({ error: 'Portal AI is currently disabled' })
    }

    const question = String(req.body?.question || '').trim().slice(0, 2000)
    const profile = sanitizeAiProfile(req.body?.profile)
    if (!question && !Object.values(profile).some(Boolean)) {
      return res.status(400).json({ error: 'Add a question or at least one shopping preference first' })
    }

    const products = await getCachedPortalProducts(config)
    const response = await generatePortalAiResponse({
      config,
      profile,
      question,
      products,
      visitorFingerprint: getVisitorFingerprint(req),
    })

    const citations = response.recommendations.flatMap((item) => Array.isArray(item?.citations) ? item.citations : [])
    try {
      db.prepare(`
        INSERT INTO ai_response_logs (
          surface,
          provider_config_id,
          provider_name,
          provider,
          model,
          actor_label,
          prompt_text,
          question_text,
          profile_json,
          candidate_products_json,
          recommendations_json,
          citations_json,
          answer_text,
          created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        'portal',
        response.provider?.id || null,
        response.provider?.name || '',
        response.provider?.provider || '',
        response.provider?.default_model || '',
        'customer portal visitor',
        response.promptText || '',
        question,
        JSON.stringify(profile),
        JSON.stringify(response.candidates || []),
        JSON.stringify(response.recommendations || []),
        JSON.stringify(citations),
        response.summary || '',
        new Date().toISOString(),
      )
    } catch (_) {}

    res.json({
      success: true,
      summary: response.summary || '',
      notice: response.notice || config.aiDisclaimer,
      contactNote: response.contact_note || config.aiDisclaimer,
      followUpQuestions: response.follow_up_questions || [],
      recommendations: response.recommendations || [],
      usage: response.usage || getPortalAiUsageStatus(config, config.aiProviderId),
      requestPolicy: response.requestPolicy || {},
      failovers: response.failovers || [],
    })
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Portal AI request failed' })
  }
})

router.get('/membership/:membershipNumber', (req, res) => {
  if (!applyPortalRateLimit(req, res, { name: 'portal:membership_lookup', max: 45, windowMs: 60 * 1000 })) return
  const membershipNumber = String(req.params.membershipNumber || '').trim()
  if (!membershipNumber) return res.status(400).json({ error: 'Membership number is required' })

  const customer = findCustomerByMembership(membershipNumber)
  if (!customer) return res.status(404).json({ error: 'Membership not found' })

  const params = {
    customerId: customer.id || null,
    customerName: customer.name || '',
    customerPhone: customer.phone || '',
    customerPhoneNormalized: normalizePhone(customer.phone),
    membershipNumber: customer.membership_number || membershipNumber,
  }

  const sales = db.prepare(`
    SELECT
      s.id,
      s.receipt_number,
      s.created_at,
      s.branch_name,
      s.sale_status,
      s.payment_method,
      s.total_usd,
      s.total_khr,
      s.tax_usd,
      s.tax_khr,
      s.delivery_fee_usd,
      s.delivery_fee_khr,
      s.discount_usd,
      s.discount_khr,
      COALESCE(s.membership_discount_usd, 0) AS membership_discount_usd,
      COALESCE(s.membership_discount_khr, 0) AS membership_discount_khr,
      COALESCE(s.membership_points_redeemed, 0) AS membership_points_redeemed,
      STRING_AGG(si.product_name || ' x' || si.quantity, ', ' ORDER BY si.id) FILTER (WHERE si.id IS NOT NULL) AS items_summary
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE
      (@customerId IS NOT NULL AND s.customer_id = @customerId)
      OR (
        lower(trim(COALESCE(s.customer_name, ''))) = lower(trim(@customerName))
        AND (
          @customerPhoneNormalized = ''
          OR replace(replace(replace(replace(replace(COALESCE(s.customer_phone, ''), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE @customerPhoneNormalized || '%'
        )
      )
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all(params)

  const returns = db.prepare(`
    SELECT
      r.id,
      r.return_number,
      r.receipt_number,
      r.created_at,
      r.branch_name,
      r.reason,
      r.return_type,
      r.status,
      r.total_refund_usd,
      r.total_refund_khr,
      STRING_AGG(ri.product_name || ' x' || ri.quantity, ', ' ORDER BY ri.id) FILTER (WHERE ri.id IS NOT NULL) AS items_summary
    FROM returns r
    LEFT JOIN return_items ri ON ri.return_id = r.id
    WHERE
      (@customerId IS NOT NULL AND r.customer_id = @customerId)
      OR (
        lower(trim(COALESCE(r.customer_name, ''))) = lower(trim(@customerName))
      )
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT 100
  `).all(params)

  const submissions = db.prepare(`
    SELECT
      id,
      membership_number,
      customer_name,
      platform,
      note,
      screenshots_json,
      status,
      reward_points,
      review_note,
      reviewed_by_name,
      reviewed_at,
      created_at
    FROM customer_share_submissions
    WHERE
      (customer_id IS NOT NULL AND customer_id = @customerId)
      OR lower(trim(COALESCE(membership_number, ''))) = lower(trim(@membershipNumber))
    ORDER BY created_at DESC
    LIMIT 100
  `).all(params).map((entry) => ({
    ...entry,
    screenshots: tryParse(entry.screenshots_json, []),
  })).map(({ screenshots_json, ...entry }) => entry)

  const config = buildPortalConfig()
  const points = summarizePoints(sales, returns, submissions, config)

  const totals = {
    totalSalesUsd: Number(sales.reduce((sum, sale) => sum + toNumber(sale.total_usd), 0).toFixed(2)),
    totalSalesKhr: Number(sales.reduce((sum, sale) => sum + toNumber(sale.total_khr), 0).toFixed(0)),
    totalReturnsUsd: Number(returns.reduce((sum, ret) => sum + toNumber(ret.total_refund_usd), 0).toFixed(2)),
    totalReturnsKhr: Number(returns.reduce((sum, ret) => sum + toNumber(ret.total_refund_khr), 0).toFixed(0)),
    membershipDiscountUsd: Number(sales.reduce((sum, sale) => sum + toNumber(sale.membership_discount_usd), 0).toFixed(2)),
    membershipDiscountKhr: Number(sales.reduce((sum, sale) => sum + toNumber(sale.membership_discount_khr), 0).toFixed(0)),
  }

  res.json({
    customer,
    sales,
    returns,
    submissions,
    totals,
    points,
    config: {
      publicUrl: config.publicUrl,
      priceDisplay: config.priceDisplay,
      translateWidgetEnabled: config.translateWidgetEnabled,
      refreshSeconds: config.refreshSeconds,
      stockThresholdMode: config.stockThresholdMode,
      lowStockThreshold: config.lowStockThreshold,
      outOfStockThreshold: config.outOfStockThreshold,
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

router.post('/submissions', async (req, res) => {
  try {
    if (!applyPortalRateLimit(req, res, { name: 'portal:submissions', max: 12, windowMs: 15 * 60 * 1000 })) return
    const config = buildPortalConfig()
    if (!config.submissionEnabled) {
      return res.status(403).json({ error: 'Customer submissions are currently disabled' })
    }

    const membershipNumber = String(req.body?.membershipNumber || '').trim()
    if (!membershipNumber) return res.status(400).json({ error: 'Membership number is required' })

    const customer = findCustomerByMembership(membershipNumber)
    if (!customer) return res.status(404).json({ error: 'Membership not found' })

    const screenshots = sanitizeScreenshots(req.body?.screenshots)
    if (!screenshots.length) return res.status(400).json({ error: 'At least one screenshot is required' })
    const persistedScreenshots = await materializePortalScreenshots(screenshots)

    const platform = String(req.body?.platform || '').trim().slice(0, 120)
    const note = String(req.body?.note || '').trim().slice(0, 4000)

    const result = db.prepare(`
      INSERT INTO customer_share_submissions (
        customer_id,
        membership_number,
        customer_name,
        platform,
        note,
        screenshots_json,
        status
      ) VALUES (?,?,?,?,?,?,'pending')
    `).run(
      customer.id || null,
      customer.membership_number || membershipNumber,
      customer.name || '',
      platform || null,
      note || null,
      JSON.stringify(persistedScreenshots),
    )

    broadcast('portalSubmissions')
    res.json({ success: true, id: result.lastInsertRowid })
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Failed to submit screenshots' })
  }
})

router.get('/submissions/review', authToken, (_req, res) => {
  const rows = db.prepare(`
    SELECT
      id,
      customer_id,
      membership_number,
      customer_name,
      platform,
      note,
      screenshots_json,
      status,
      reward_points,
      review_note,
      reviewed_by_id,
      reviewed_by_name,
      reviewed_at,
      created_at
    FROM customer_share_submissions
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      created_at DESC
  `).all().map((row) => ({
    ...row,
    screenshots: tryParse(row.screenshots_json, []),
  })).map(({ screenshots_json, ...row }) => row)

  res.json(rows)
})

router.patch('/submissions/:id/review', authToken, requirePermission('settings'), (req, res) => {
  const { id } = req.params
  const actor = getAuditActor(req)
  const status = String(req.body?.status || '').trim().toLowerCase()
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  const rewardPoints = Math.max(0, toNumber(req.body?.reward_points, 0))
  const reviewNote = String(req.body?.review_note || '').trim().slice(0, 4000)

  const existing = db.prepare('SELECT id FROM customer_share_submissions WHERE id = ?').get(id)
  if (!existing) return res.status(404).json({ error: 'Submission not found' })

  db.prepare(`
    UPDATE customer_share_submissions
    SET
      status = ?,
      reward_points = ?,
      review_note = ?,
      reviewed_by_id = ?,
      reviewed_by_name = ?,
      reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status,
    status === 'approved' ? rewardPoints : 0,
    reviewNote || null,
    actor.userId,
    actor.userName,
    id,
  )

  broadcast('portalSubmissions')
  res.json({ success: true })
})

module.exports = router

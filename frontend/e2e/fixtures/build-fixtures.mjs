/**
 * e2e/fixtures/build-fixtures.mjs -- regenerates the committed JSON fixtures.
 *
 * PROVENANCE. Every field below is copied from the real Worker route that
 * produces it, so a fixture cannot drift into a shape the app never sees:
 *
 *   portal-config.json    <- cloudflare/src/routes/portal.ts buildPortalConfig()
 *                            (the full returned object, with the settings-table
 *                            fallbacks taken -- i.e. what a store that has only
 *                            filled in its identity fields actually serves).
 *   portal-meta.json      <- buildPortalMeta(): { categories, brands, branches }
 *                            where categories/brands are [{ name }] and
 *                            branches are [{ id, name }].
 *   portal-products.json  <- the column list buildPortalCatalog() selects,
 *                            AFTER attachPortalStockStatus(): stock_quantity,
 *                            low_stock_threshold and out_of_stock_threshold are
 *                            REMOVED and stock_status + branch_availability are
 *                            added. Reproducing that removal matters: it is the
 *                            portal's security boundary.
 *   admin-*.json          <- cloudflare/src/routes/auth.ts, settings.ts,
 *                            sales.ts, runtime.ts (see each file's header note).
 *
 * The product rows are synthetic but deterministic: 137 products, every name
 * unique (so one row == one storefront card and no grouping collapse can hide
 * a paging bug), brands spread over 9 initials, a known promoted/discounted
 * subset, and a known out-of-stock subset.
 *
 * Run:  node e2e/fixtures/build-fixtures.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Deterministic pseudo-random: a fixture regenerated on another machine must
// be byte-identical, so Math.random is not usable here.
// ---------------------------------------------------------------------------
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const BRANDS = [
  'Aurelia', 'Belle Roux', 'Céleste', 'Dermalux', 'Eunoia',
  'Fleurine', 'Glowary', 'Havenlys', 'Iridine',
]
const CATEGORIES = ['Skincare', 'Makeup', 'Haircare', 'Fragrance', 'Body care']
const UNITS = ['pcs', 'box', 'bottle', 'tube']
const BRANCHES = [
  { id: 1, name: 'Shop' },
  { id: 2, name: 'Warehouse' },
]

const PRODUCT_COUNT = 137
const random = makeRandom(20260914)

const products = []
for (let index = 0; index < PRODUCT_COUNT; index += 1) {
  const id = 1000 + index
  const brand = BRANDS[index % BRANDS.length]
  const category = CATEGORIES[index % CATEGORIES.length]
  const unit = UNITS[index % UNITS.length]
  // Unique, stable, and sortable: the pager specs assert WHICH card is first
  // on a page, so the name has to pin the order without depending on locale
  // collation of accented brand names.
  const name = `E2E Product ${String(index + 1).padStart(3, '0')} ${brand}`
  const priceUsd = Number((3 + Math.round(random() * 4700) / 100).toFixed(2))
  // Three known states, by position rather than by chance, so a spec can name
  // the exact card it expects to carry each badge.
  const stockState = index % 11 === 0 ? 'out_of_stock' : (index % 7 === 0 ? 'low_stock' : 'in_stock')
  const discounted = index % 9 === 0
  products.push({
    id,
    name,
    category,
    brand,
    categories: JSON.stringify([category]),
    brands: JSON.stringify([brand]),
    unit,
    description: `Deterministic e2e fixture row ${index + 1}. Not a real product.`,
    selling_price_usd: priceUsd,
    selling_price_khr: Math.round(priceUsd * 4100 / 100) * 100,
    image_path: '',
    discount_enabled: discounted ? 1 : 0,
    discount_type: discounted ? 'percent' : null,
    discount_percent: discounted ? 15 : null,
    discount_amount_usd: null,
    discount_amount_khr: null,
    discount_label: discounted ? 'Deal' : null,
    discount_badge_color: discounted ? '#b91c1c' : null,
    discount_starts_at: null,
    discount_ends_at: null,
    // attachPortalStockStatus() output. stock_quantity / low_stock_threshold /
    // out_of_stock_threshold are deliberately ABSENT -- the live portal payload
    // does not carry them, and a fixture that did would let a regression that
    // starts reading raw quantities pass here and fail in production.
    stock_status: stockState,
    branch_availability: BRANCHES.map((branch) => ({
      branch_id: branch.id,
      // The warehouse never sells, so its availability differs from the shop's
      // on purpose -- that is the branch-filter spec's discriminating input.
      status: branch.id === 2 ? (index % 3 === 0 ? 'in_stock' : 'out_of_stock') : stockState,
    })),
  })
}

// buildPortalConfig()'s exact key set, with the "identity filled in, nothing
// else customised" settings row -- i.e. every `settings.x || default` takes its
// default and every normalizeBoolean takes its documented default.
const config = {
  businessName: 'Leang Beauty',
  businessPhone: '+855 12 345 678',
  businessEmail: 'hello@leangbeauty.test',
  businessAddress: '12 Street 271, Phnom Penh, Cambodia',
  businessLegalName: 'Leang Beauty Co., Ltd.',
  businessRegistrationNumber: 'KH-E2E-0001',
  publicationReady: true,
  publicationMissing: [],
  businessTagline: 'Cosmetics, skincare and fragrance',
  businessLogo: '',
  businessFavicon: '',
  businessCover: '',
  showLogo: true,
  showCover: true,
  showPhone: true,
  showEmail: true,
  showAddress: true,
  showAbout: true,
  showCatalog: true,
  showMembership: false,
  showFaq: true,
  faqTitle: 'Frequently asked questions',
  faqItems: [
    { id: 1, question: 'Do you deliver?', answer: 'Yes, within Phnom Penh.' },
    { id: 2, question: 'Are the products authentic?', answer: 'Every item is sourced from the brand.' },
  ],
  showPrices: true,
  showOutOfStockProducts: true,
  showStockStatus: true,
  showProductBrand: true,
  showProductCategory: true,
  showProductDescription: true,
  showProductDiscount: true,
  translateWidgetEnabled: true,
  // OFF in the fixture. The assistant opens a network conversation that has
  // nothing to do with any error class these specs cover, and leaving it on
  // adds a tab whose first paint is an AI status round trip.
  aiEnabled: false,
  aiTitle: 'Beauty Assistant',
  aiDisclaimer: 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.',
  aiProviderId: null,
  aiPrompt: '',
  publicUrl: 'https://leangbeauty.test',
  publicUrlOverride: '',
  publicPath: '/',
  links: { website: '', facebook: 'https://facebook.com/leangbeauty', instagram: '', telegram: '' },
  showWebsite: true,
  showFacebook: true,
  showInstagram: true,
  showTelegram: true,
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '+855 12 345 678', instagram: '' },
  contactLinkLabels: { messenger: 'Messenger', telegram: 'Telegram', whatsapp: 'WhatsApp', phone: '', instagram: 'Instagram' },
  showContactMessenger: true,
  showContactTelegram: true,
  showContactWhatsapp: false,
  showContactPhone: false,
  showContactInstagram: false,
  title: 'Leang Beauty',
  intro: 'Browse products and check membership details.',
  heroGradientStart: '#0f172a',
  heroGradientMid: '#14532d',
  heroGradientEnd: '#ea580c',
  exchangeRate: 4100,
  priceDisplay: 'USD',
  refreshSeconds: 20,
  gridColumnsMobile: 1,
  gridColumnsDesktop: 4,
  googleMapsEmbed: '',
  showGoogleMap: false,
  loyaltyPointsEnabled: true,
  pointsBasis: 'usd',
  pointsPerUsd: 1,
  pointsPerKhr: 1 / 4100,
  redeemPoints: 100,
  redeemValueUsd: 1,
  redeemValueKhr: 4100,
  membershipInfoText: 'Membership points are reviewed and applied by staff during checkout. Redemption uses whole units only.',
  submissionEnabled: false,
}

// buildPortalMeta(): GROUP BY lower(trim(x)) ORDER BY lower(name) ASC.
const meta = {
  categories: [...new Set(products.map((p) => p.category))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((name) => ({ name })),
  brands: [...new Set(products.map((p) => p.brand))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((name) => ({ name })),
  branches: BRANCHES.map((branch) => ({ id: branch.id, name: branch.name })),
}

// ---------------------------------------------------------------------------
// The ADMIN catalogue -- the same products, seen from the inside
// ---------------------------------------------------------------------------
// The public payload deliberately carries no quantities (attachPortalStockStatus
// strips stock_quantity / low_stock_threshold / out_of_stock_threshold before
// anything leaves the Worker). The admin surfaces read exactly those columns,
// so the two fixtures cannot be the same file, and the difference between them
// is itself a contract worth keeping visible: if a portal spec ever starts
// finding stock_quantity, a privacy regression has shipped.
//
// Field set from frontend/src/components/products/helpers/productWriteHelpers.ts
// buildProductWritePayload() -- the one place that enumerates a product row as
// the app understands it -- plus the branch_stock array its
// buildProductBranchStockAdjustments() reads.
const adminProducts = products.map((product, index) => {
  const stockState = product.stock_status
  const shopQuantity = stockState === 'out_of_stock' ? 0 : (stockState === 'low_stock' ? 2 : 12 + (index % 30))
  const warehouseQuantity = (product.branch_availability.find((entry) => entry.branch_id === 2)?.status === 'in_stock')
    ? 40 + (index % 17)
    : 0
  const costUsd = Number((product.selling_price_usd * 0.6).toFixed(2))
  return {
    id: product.id,
    name: product.name,
    // A stable, checkable barcode per row: scanner.spec.ts types one of these
    // into the search box to prove the scan path and the typed path agree.
    barcode: `88${String(product.id).padStart(11, '0')}`,
    sku: `E2E-${product.id}`,
    category: product.category,
    brand: product.brand,
    unit: product.unit,
    description: product.description,
    selling_price_usd: product.selling_price_usd,
    selling_price_khr: product.selling_price_khr,
    wholesale_price_usd: 0,
    wholesale_price_khr: 0,
    purchase_price_usd: costUsd,
    purchase_price_khr: Math.round(costUsd * 4100 / 100) * 100,
    cost_price_usd: costUsd,
    cost_price_khr: Math.round(costUsd * 4100 / 100) * 100,
    // Present here and absent from the portal file, on purpose (see above).
    stock_quantity: shopQuantity + warehouseQuantity,
    low_stock_threshold: 5,
    out_of_stock_threshold: 0,
    supplier: '',
    custom_fields: {},
    image_path: null,
    image_gallery: [],
    is_active: 1,
    is_group: 0,
    parent_id: null,
    discount_enabled: product.discount_enabled,
    discount_type: product.discount_type,
    discount_percent: product.discount_percent,
    discount_amount_usd: product.discount_amount_usd,
    discount_amount_khr: product.discount_amount_khr,
    discount_label: product.discount_label,
    discount_badge_color: product.discount_badge_color,
    discount_starts_at: null,
    discount_ends_at: null,
    branch_stock: [
      { branch_id: 1, branch_name: 'Shop', quantity: shopQuantity },
      { branch_id: 2, branch_name: 'Warehouse', quantity: warehouseQuantity },
    ],
  }
})

// routes/products.ts GET /bootstrap's narrow branch projection:
// SELECT id, name, is_default, is_active FROM branches WHERE is_active = 1.
const adminBranches = [
  { id: 1, name: 'Shop', is_default: 1, is_active: 1 },
  { id: 2, name: 'Warehouse', is_default: 0, is_active: 1 },
]

writeFileSync(path.join(here, 'portal-config.json'), `${JSON.stringify(config, null, 2)}\n`)
writeFileSync(path.join(here, 'portal-meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
writeFileSync(path.join(here, 'portal-products.json'), `${JSON.stringify(products, null, 2)}\n`)
writeFileSync(path.join(here, 'admin-products.json'), `${JSON.stringify({
  _provenance: 'Generated by build-fixtures.mjs from the same rows as portal-products.json. Item fields: frontend/src/components/products/helpers/productWriteHelpers.ts buildProductWritePayload + branch_stock. Branches: cloudflare/src/routes/products.ts GET /bootstrap projection.',
  branches: adminBranches,
  items: adminProducts,
}, null, 2)}\n`)

console.log(`wrote portal-config.json, portal-meta.json, portal-products.json, admin-products.json (${products.length} products)`)

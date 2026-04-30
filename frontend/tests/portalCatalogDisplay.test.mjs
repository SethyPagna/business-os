import assert from 'node:assert/strict'
import {
  buildPortalHighlightBadges,
  buildPortalPricePresentation,
  getPortalGridClass,
  getPortalMobileGridClass,
  getPortalPromotionDetails,
  normalizeRecommendedProductIds,
  productMatchesPortalBranches,
} from '../src/components/catalog/portalCatalogDisplay.mjs'

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const copy = (key, fallback) => fallback || key
const formatPortalPrice = (usd, khr, config) => {
  if (config.priceDisplay === 'KHR') return `${Number(khr || 0).toFixed(0)} KHR`
  if (config.priceDisplay === 'BOTH') return `$${Number(usd || 0).toFixed(2)} / ${Number(khr || 0).toFixed(0)} KHR`
  return `$${Number(usd || 0).toFixed(2)}`
}

runTest('normalizeRecommendedProductIds keeps unique positive numeric ids', () => {
  assert.deepEqual(normalizeRecommendedProductIds('[1,"2",2,-4,"bad",3]'), [1, 2, 3])
})

runTest('portal grid helpers honor configured mobile and desktop columns', () => {
  assert.equal(getPortalMobileGridClass(3), 'grid-cols-3')
  assert.equal(getPortalGridClass(7), 'lg:grid-cols-4 xl:grid-cols-7')
  assert.equal(getPortalGridClass(8), 'lg:grid-cols-4 xl:grid-cols-8')
})

runTest('branch matching uses branch presence instead of positive stock only', () => {
  const product = {
    branch_stock: [
      { branch_id: 2, quantity: 0 },
      { branch_id: 3, quantity: 4 },
    ],
  }
  assert.equal(productMatchesPortalBranches(product, ['2']), true)
  assert.equal(productMatchesPortalBranches(product, ['9']), false)
})

runTest('promotion helpers prefer special price when it is lower than selling price', () => {
  const product = {
    selling_price_usd: 12,
    selling_price_khr: 49200,
    special_price_usd: 9,
    special_price_khr: 36900,
  }
  const promotion = getPortalPromotionDetails(product)
  assert.equal(promotion.active, true)
  assert.equal(promotion.percentOff, 25)

  const presentation = buildPortalPricePresentation(product, { priceDisplay: 'USD' }, formatPortalPrice)
  assert.equal(presentation.primaryText, '$9.00')
  assert.equal(presentation.originalText, '$12.00')
})

runTest('highlight badges stay compact and follow ranking priority', () => {
  const product = {
    portal_recommended: true,
    top_seller_rank: 1,
    top_product_rank: 2,
    new_arrival_rank: 1,
    selling_price_usd: 20,
    special_price_usd: 15,
    selling_price_khr: 82000,
    special_price_khr: 61500,
  }
  const badges = buildPortalHighlightBadges(product, {
    showRecommendedBadge: true,
    showPromotionBadge: true,
    showTopSellerBadge: true,
    showTopProductBadge: true,
    showNewArrivalBadge: true,
    highlightRankLimit: 3,
  }, copy)

  assert.equal(badges.length, 2)
  assert.equal(badges[0].key, 'recommended')
  assert.equal(badges[1].key, 'promotion')
})

if (failed > 0) {
  process.exitCode = 1
}

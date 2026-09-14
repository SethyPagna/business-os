// P3-L3 item C: every promotion on the public storefront is linked.
//
// Owner: "make sure promotion links also have them all linked. public
// website etc..." and, on a shareable URL, "they are all in public website,
// why would i need a new link? i mean maybe click to view products." So
// every promotion surface leads to a product on the same page:
//
//   1. the announcement strip (PortalPromotionsBanner): "View <product>"
//      opens the product detail flyout, no longer just the image lightbox;
//   2. the promo strip's campaign chip (PortalPromoStrip): narrows the grid
//      to that rule's products through the search facet promo=rule:<id>;
//   3. the editor's promotion cards (CatalogProductsSection): "View product"
//      opens the flyout, a URL card follows only a safe link;
//   4. a product that is not on the loaded page is fetched by id through
//      the SAME search endpoint (no by-id route with its own rules);
//   5. the editor preview (CatalogPage) does the same, so what the owner
//      sees while editing is what a visitor gets.
//
// Run: node tests/promotionLinks.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeLinkUrl } from '../src/utils/safeLinkUrl.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => fs.readFileSync(path.join(here, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const catalog = (name: string) => read(`src/components/catalog/${name}`)

// 1. Announcement strip: a product link opens the product.
const banner = catalog('PortalPromotionsBanner.tsx')
assert.match(banner, /onOpenProduct\?: \(productId: number, productName: string\) => void/, 'banner takes onOpenProduct')
const activate = banner.slice(banner.indexOf('const handleActivate'), banner.indexOf('// While loading'))
assert.ok(
  activate.indexOf('onOpenProduct(promo.link_product_id') < activate.indexOf('onOpenImage?.('),
  'a product link opens the product BEFORE the image-lightbox fallback is considered',
)
assert.match(banner, /link_product_id && \(onOpenProduct \|\| promo\.image_path \|\| promo\.link_product_image\)/, 'a product card is clickable even without an image once products can be opened')

// 2. Campaign chip narrows the grid to that rule.
const strip = catalog('PortalPromoStrip.tsx')
assert.match(strip, /setPromoFacet\?: \(value: string\) => void/, 'strip takes the facet setter')
assert.match(strip, /aria-pressed=\{promoFacet === `rule:\$\{item\.ruleId\}`\}/, 'the chip announces its pressed state')
assert.match(strip, /setPromoFacet\?\.\(promoFacet === `rule:\$\{item\.ruleId\}` \? '' : `rule:\$\{item\.ruleId\}`\)/, 'tap sets rule:<id>, second tap clears it')
assert.doesNotMatch(strip, /<span\s+key=\{item\.key\}/, 'the rule chip is no longer an inert span')

// 3. Promotion cards: product CTA opens the flyout; URL CTA is allowlisted.
const section = catalog('CatalogProductsSection.tsx')
assert.match(section, /openProductById\?: \(productId: number, productName: string\) => void/)
assert.match(section, /openProductById\(Number\(item\.linkProductId\), item\.linkProductName \|\| ''\)/, 'the card CTA opens the product by id')
assert.match(section, /: setSearch\(item\.linkProductName \|\| ''\)\)/, 'without an opener the CTA still searches the name')
assert.match(section, /safeLinkUrl\(item\.linkUrl\) \? \(/, 'a URL card renders only when the link is safe')
assert.match(section, /href=\{safeLinkUrl\(item\.linkUrl\) \|\| undefined\}/, 'the href is the allowlisted value')
assert.doesNotMatch(section, /href=\{item\.linkUrl\}/, 'the raw card link is never an href')
assert.match(section, /promoFacet=\{promoFacet\}\s+setPromoFacet=\{setPromoFacet\}/, 'the strip receives the facet from the section')
assert.match(section, /setPromoFacet\(promoFacet \? '' : 'promoted'\)/, 'the "only deals" toggle turns any promo facet off')

// 4. The storefront resolves a product id through the search endpoint.
const shop = catalog('PublicCatalogPage.tsx')
assert.match(shop, /const \[promoFacet, setPromoFacet\] = useState\(''\)/)
assert.match(shop, /promo: promoFacet,/, 'the facet string is sent as-is (promoted or rule:<id>)')
assert.match(shop, /searchPortalCatalogProducts\?\.\(\{ productId, pageSize: 1 \}\)/, 'by-id lookup goes through the search endpoint')
assert.match(shop, /if \(product\) openProductDetail\(product\)\s+else setSearch\(productName\)/, 'a product that no longer answers falls back to a name search')
assert.match(shop, /onOpenProduct=\{openProductById\}/, 'the banner gets the opener')
assert.match(shop, /openProductById=\{openProductById\}/, 'the cards get the opener')
assert.match(shop, /setPromoFacet\(''\)/, 'clearing filters clears the facet')
assert.match(shop, /\(promoFacet \? 1 : 0\)/, 'the facet counts as an active filter')
assert.doesNotMatch(shop + section + strip, /promoOnly|setPromoOnly/, 'the boolean facet is gone everywhere')

// 5. Editor preview parity.
const editor = catalog('CatalogPage.tsx')
assert.match(editor, /promo: promoFacet,/, 'the preview search sends the facet')
assert.match(editor, /onOpenProduct=\{openProductById\}/, 'the preview banner opens products')
assert.match(editor, /^\s+openProductById,$/m, 'the preview cards open products')
assert.match(editor, /^\s+promoFacet,\s+setPromoFacet,$/m, 'the preview section gets the facet')

// The Worker side of the same contract.
const worker = read('../cloudflare/src/routes/portal.ts')
assert.match(worker, /\/\^rule:\\d\+\$\/\.test\(promoFacet\)/, 'the Worker accepts promo=rule:<id>')
assert.match(worker, /singleRuleAppliesSql\(searchRules, Number\(promoFacet\.slice\('rule:'\.length\)\), params\)/, 'and only an ACTIVE rule can match')
assert.match(worker, /const productIdClause = Number\.isFinite\(productId\) && productId > 0 \? 'p\.id = @productId' : undefined/)
assert.match(worker, /const fallbackBaseWhere = \[\.\.\.filters\.baseWhere, \.\.\.postFilterClauses\]/, 'the fuzzy fallback honours the promo and id facets too')
assert.match(worker, /'stockState', 'initial', 'promo', 'productId',/, 'productId is part of the cache key')

// The link allowlist that both the Worker (at config build) and the anchor
// apply. Same cases as promotionLinkUrlParity.test.ts's Worker twin.
for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'java\tscript:alert(1)', '//evil.example', 'vbscript:x', 'file:///etc/passwd']) {
  assert.equal(safeLinkUrl(bad), null, `${JSON.stringify(bad)} is refused`)
}
for (const good of ['https://example.com/promo', 'http://example.com', '/?legal=terms', '/uploads/x.jpg']) {
  assert.equal(safeLinkUrl(good), good, `${good} passes unchanged`)
}

// The promotion is NAMED beside its amount wherever a sale line prints a
// cut: the sale line already carries product_discount_label (the rule's
// title, captured at sale time by capturedPricingMetadata), and none of the
// three surfaces rendered it.
const receipt = read('src/components/receipt/Receipt.tsx')
assert.match(receipt, /\{hasItemDiscount && item\.product_discount_label \? <span className="ml-1 text-\[10px\] font-semibold text-red-600">\{item\.product_discount_label\}<\/span> : null\}/, 'the receipt prints the promotion as a tag beside the name, only when the line has a cut')
const modal = read('src/components/sales/SaleDetailModal.tsx')
assert.match(modal, /product_discount_label\?: string \| null/, 'the modal line type carries the label')
assert.match(modal, /\(-\{fmtUSD\(displayDiscount\)\}\{item\.product_discount_label \? ` \$\{item\.product_discount_label\}` : ''\}\)/, 'the modal names it inside the cut parentheses')
const telegram = read('../cloudflare/src/lib/telegram.ts')
assert.match(telegram, /promotionLabel\?: string \| null/, 'the Telegram item carries it')
assert.match(telegram, /const promotionLabel = lineDiscount > 0 \? cleanLine\(item\.promotionLabel, 40\) : ''/, 'and prints it only with a cut')
const sales = read('../cloudflare/src/routes/sales.ts')
assert.match(sales, /promotionLabel: item\.product_discount_label \|\| null/, 'routes/sales.ts passes the captured label through')

console.log('promotionLinks tests passed')

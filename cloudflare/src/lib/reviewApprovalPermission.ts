import type { Env } from '../index'
import type { SessionUser } from './auth'
import type { PendingActionRow } from './pendingActions'
import { getActionTier } from './permissions'
import { hasCatalogCostWrite } from './acquisitionCostAccess'
import { getDb } from './db'
import { roundMoney4, subtractDecimalSum } from './moneyPrecision'
import { readProductMoneyPlan } from './productWrites'
import { normalizeProductDiscountBody, productDiscountChanged, PRODUCT_DISCOUNT_PRICE_FIELDS } from './productDiscountGate'
import { productImageFieldsChanged, productImageFieldsChangedResolved } from './productImagePermission'
import { productSupplierChanged } from './productSupplierGate'

// Finding H (12 Oct 2026): approving a queued request replays its write with the REVIEWER's authority
// (lib/reviewApply.ts), so the reviewer must hold, right now, the same grant the direct route demands for
// that exact action, and for every effect the write has (price, cost, image). Full access to the section
// is not enough: a per-action switch such as fees:delete=false narrows it, exactly as on the direct route.
//
// One entry per registerApplier() triple in lib/reviewApply.ts; test-review-approval-permission-native.cjs
// asserts the two key sets are equal. A triple with no entry is refused (fail closed), so an applier added
// later without a mapping can never run on the reviewer's section grant alone.
const REVIEW_ACTIONS: Readonly<Record<string, string>> = {
  'fees:delete:fee': 'delete',
  'products:create:product': 'add',
  'products:update:product': 'edit',
  'products:delete:product': 'delete',
  'inventory:update:inventory_reason': 'edit_reasons',
  'branches:create:branch': 'add',
  'branches:update:branch': 'edit',
  'branches:delete:branch': 'delete',
}
const PRICE_FIELDS = ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr'] as const
const owns = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key)

export type ReviewApprovalRefusal = { status: 400 | 403 | 501; body: Record<string, unknown> }

function refusal(permission: string): ReviewApprovalRefusal {
  return { status: 403, body: { error: `Full ${permission} permission is required to approve this request.`, code: 'review_action_full_required', permission } }
}
const UNMAPPED: ReviewApprovalRefusal = {
  status: 501,
  body: { error: 'This kind of request has no approval rule, so it cannot be approved.', code: 'no_review_applier' },
}

// A plan-less (historical) queued price is compared with the stored value exactly as SQLite will store it:
// null only equals null, the stored preimage must be numeric, the text must be plain ASCII (SQLite's numeric
// affinity does not trim Unicode spaces, the decimal parser does), and the decimals must be exactly equal.
function legacyPriceChanged(next: unknown, previous: unknown): boolean {
  if (next === null || previous === null) return next !== previous
  if ((typeof next !== 'number' && typeof next !== 'string') || typeof previous !== 'number') return true
  if (typeof next === 'string' && /[^\x00-\x7f]/.test(next)) return true
  try { return subtractDecimalSum(next, [previous]) !== '0' } catch { return true }
}

/**
 * The refusal for approving `row` as `user`, or null when every effect of the approval is within the
 * reviewer's current grants. Reads the product row (and gallery) only when a price or image field is present
 * and the reviewer lacks that grant. Never writes.
 */
export async function reviewApprovalPermissionError(env: Env, user: SessionUser, row: PendingActionRow, productRemoval = false): Promise<ReviewApprovalRefusal | null> {
  if (productRemoval) return getActionTier(user, 'products', 'delete') === 'full' ? null : refusal('products:delete')
  const action = REVIEW_ACTIONS[`${row.section}:${row.action_type}:${row.entity_type}`]
  if (!action) return UNMAPPED
  if (getActionTier(user, row.section, action) !== 'full') return refusal(`${row.section}:${action}`)
  if (row.section !== 'products' || (row.action_type !== 'create' && row.action_type !== 'update')) return null

  const body = JSON.parse(row.payload_json || '{}') as Record<string, unknown>
  const plan = readProductMoneyPlan(body)
  if (hasCatalogCostWrite(body, user)) return refusal('product_cost_edit')
  // OPUS-H-1: judge the value the writer will store. A queued spelling with no canonical form is refused for
  // every reviewer (the writer would refuse it too), so it can never be approved as "unchanged".
  const invalidDiscount = normalizeProductDiscountBody(body)
  if (invalidDiscount) return { status: 400, body: invalidDiscount }
  const priceDenied = getActionTier(user, 'products', 'price') !== 'full'
  const imageDenied = getActionTier(user, 'products', 'image') !== 'full'
  if (row.action_type === 'create') {
    // Same policy as the direct POST: initial selling/wholesale prices are not gated, a discount is.
    if (priceDenied && productDiscountChanged(null, body)) return refusal('products:price')
    if (imageDenied && productImageFieldsChanged(body)) return refusal('products:image')
    // A starting quantity is a stock-in however the approval lands: on a new product (audit P2-b) or, by owner
    // ruling 16 (13 Oct 2026), on the existing product a queued create now matches -- an inventory adjust, like every receipt.
    if (getActionTier(user, 'inventory', 'adjust') !== 'full' && Number(body.stock_quantity) > 0) return refusal('inventory:adjust')
    return null
  }

  const checksPrice = priceDenied && [...PRICE_FIELDS, ...PRODUCT_DISCOUNT_PRICE_FIELDS].some(field => owns(body, field))
  const checksImages = imageDenied && (owns(body, 'image_path') || owns(body, 'image_gallery'))
  // A queued supplier change is approved with the REVIEWER's grant, like a price (owner, 19 Oct 2026).
  const checksSupplier = getActionTier(user, 'products', 'supplier') !== 'full' && owns(body, 'supplier')
  if (!checksPrice && !checksImages && !checksSupplier) return null
  const db = getDb(env)
  const current = await db.prepare('SELECT * FROM products WHERE id = @id').get<Record<string, unknown>>({ id: row.entity_id })
  if (!current) return null
  if (checksSupplier && productSupplierChanged(current.supplier, body)) return refusal('products:supplier')
  if (checksPrice) {
    // A saved plan is the direct route's own comparison (routes/products.ts productPriceChanged); updateRow
    // guards its before-image, so the plan's before IS the value being replaced.
    const priceChanged = PRICE_FIELDS.some(field => owns(body, field) && (plan
      ? roundMoney4(Number(body[field]) || 0) !== roundMoney4(Number(plan.before?.[field]) || 0)
      : legacyPriceChanged(body[field], current[field])))
    if (priceChanged || productDiscountChanged(current, body)) return refusal('products:price')
  }
  if (checksImages) {
    const gallery = await db.prepare('SELECT image_path FROM product_images WHERE product_id = @id ORDER BY sort_order ASC, id ASC')
      .all<{ image_path: string }>({ id: row.entity_id })
    if (await productImageFieldsChangedResolved(db, body, { image_path: current.image_path, image_gallery: gallery.map(entry => entry.image_path) })) {
      return refusal('products:image')
    }
  }
  return null
}

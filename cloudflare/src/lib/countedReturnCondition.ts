import type { D1Compat } from './db'
import type { ProductMergePhysicalResolution, ProductMergePhysicalSource } from './productMergePhysicalOrigins'
import { parseStockConditionTag, type StockConditionTag } from './stockCondition'

export type CountedReturnCondition = 'ordinary' | StockConditionTag
export type OriginalReturnCondition = {
  sale_item_id: number; sale_id: number; product_id: number; branch_id: number | null; damaged_lot_id: number | null
  original_product_id: number | null; original_branch_id: number | null; original_batch_id: number | null; original_condition_tag: string | null
}

/** A posted line naming a product (or, for a line sold from tagged stock, a receipt) other than its sale item's
 *  own -- typically the keeper a later product merge moved the stock to. The line is resolved on the sale item's
 *  own identity, so refund, condition and request digest never depend on which keeper the client named. The
 *  client never chooses the keeper: the route proves every claim from product-merge records
 *  (assertReturnKeeperClaimsProven) before it writes anything. */
export type ReturnKeeperClaim = Readonly<{
  index: number; productId: number; batchId: number | null; originalProductId: number; originalBatchId: number | null
}>

export class ReturnKeeperClaimError extends Error {
  constructor(readonly code: 'return_condition_sale_identity_conflict' | 'return_condition_receipt_identity_conflict') {
    super(code); this.name = 'ReturnKeeperClaimError'
  }
}
export const returnKeeperClaimError = (claim: ReturnKeeperClaim): ReturnKeeperClaimError =>
  new ReturnKeeperClaimError(claim.batchId === null ? 'return_condition_sale_identity_conflict' : 'return_condition_receipt_identity_conflict')

export async function resolveCountedReturnConditions(db: D1Compat, saleId: number | null, items: Array<Record<string, unknown>>,
  keeperClaims?: ReturnKeeperClaim[]): Promise<Array<Record<string, unknown>>> {
  const ids = [...new Set(items.map(item => Number(item.sale_item_id)).filter(id => Number.isSafeInteger(id) && id > 0))]
  const rows = ids.length ? await db.prepare(`SELECT si.id AS sale_item_id,si.sale_id,si.product_id,si.branch_id,si.damaged_lot_id,
      ci.product_id AS original_product_id,ci.branch_id AS original_branch_id,ci.batch_id AS original_batch_id,ci.condition_tag AS original_condition_tag
      FROM sale_items si LEFT JOIN counted_sale_item_conditions ci ON ci.sale_item_id=si.id
      WHERE si.id IN(SELECT CAST(value AS INTEGER) FROM json_each(@ids))`).all<OriginalReturnCondition>({ids:JSON.stringify(ids)}) : []
  return resolveCountedReturnConditionsFromSnapshot(saleId,items,rows,keeperClaims)
}

/** Without a keeperClaims collector a line naming another product or receipt is refused, as it always was. With
 *  one, the line is normalised to its sale item's identity and the claim is recorded for the caller to prove. */
export function resolveCountedReturnConditionsFromSnapshot(saleId:number|null,items:Array<Record<string,unknown>>,rows:readonly OriginalReturnCondition[],
  keeperClaims?: ReturnKeeperClaim[]):Array<Record<string,unknown>> {
  const originals = new Map(rows.map(row => [row.sale_item_id,row]))
  return items.map((item, index) => {
    const original = originals.get(Number(item.sale_item_id))
    const postedProduct = item.product_id == null ? null : Number(item.product_id)
    const claimsProduct = !!original && postedProduct !== null && postedProduct !== original.product_id
    if (Number(item.sale_item_id) && (!original || original.sale_id !== saleId
      || (claimsProduct && (!keeperClaims || !Number.isSafeInteger(postedProduct) || postedProduct! <= 0)))) throw new Error('return_condition_sale_identity_conflict')
    if (original?.damaged_lot_id && (!original.original_condition_tag || original.original_product_id !== original.product_id
      || original.original_branch_id !== original.branch_id)) throw new Error('return_original_condition_unproven')
    const oldTag = parseStockConditionTag(item.condition_tag)
    if (!oldTag.ok) throw new Error(oldTag.error)
    const chosen = item.stock_condition == null || item.stock_condition === '' ? null : String(item.stock_condition)
    const chosenTag = chosen === 'ordinary' ? null : parseStockConditionTag(chosen)
    if (chosen !== null && chosen !== 'ordinary' && (!chosenTag?.ok || !chosenTag.tag)) throw new Error('return_condition_invalid')
    const rawAction = String(item.stock_action ?? '').trim().toLowerCase()
    if (chosen === 'ordinary' && (rawAction === 'damaged' || oldTag.tag)) throw new Error('return_condition_conflict')
    if (chosen && oldTag.tag && chosen !== oldTag.tag) throw new Error('return_condition_conflict')
    const condition: CountedReturnCondition = (chosen || oldTag.tag || original?.original_condition_tag || (rawAction === 'damaged' ? 'damaged' : 'ordinary')) as CountedReturnCondition
    const action = rawAction === 'none' || (rawAction === '' && item.return_to_stock === false) ? 'none' : condition === 'ordinary' ? 'restock' : 'damaged'
    const claimsReceipt = !!original?.damaged_lot_id && item.batch_id != null && Number(item.batch_id) !== original.original_batch_id
    if (claimsReceipt && (!keeperClaims || !Number.isSafeInteger(Number(item.batch_id)) || Number(item.batch_id) <= 0)) throw new Error('return_condition_receipt_identity_conflict')
    if (claimsProduct || claimsReceipt) keeperClaims!.push(Object.freeze({ index, productId: postedProduct ?? original!.product_id,
      batchId: claimsReceipt ? Number(item.batch_id) : null, originalProductId: original!.product_id,
      originalBatchId: claimsReceipt ? original!.original_batch_id : null }))
    return { ...item, ...(claimsProduct ? {product_id:original!.product_id} : {}), counted_original_condition:!!original?.damaged_lot_id, stock_action:action, stock_condition:action === 'none' ? null : condition,
      ...(action === 'damaged' ? {condition_tag:condition,damaged_disposition:item.damaged_disposition || 'keep'} : {condition_tag:null}),
      ...(original?.damaged_lot_id ? {batch_id:original.original_batch_id} : {}) }
  })
}

const claimSource = (productId: number, branchId: number, batchId: number | null): ProductMergePhysicalSource => Object.freeze({
  memberKey: `keeper-claim:${productId}:${branchId}:${batchId ?? 'none'}`, productId, branchId, batchId, damagedLotId: null, conditionTag: 'ordinary' })

/** The physical tuples a claim is proven with: the claimed identity and the sale item's own, at the line's branch. */
export function returnKeeperClaimSources(claims: readonly ReturnKeeperClaim[], branchOf: (index: number) => number): ProductMergePhysicalSource[] {
  const sources = new Map<string, ProductMergePhysicalSource>()
  for (const claim of claims) for (const source of [claimSource(claim.productId, branchOf(claim.index), claim.batchId),
    claimSource(claim.originalProductId, branchOf(claim.index), claim.originalBatchId)]) sources.set(source.memberKey, source)
  return [...sources.values()]
}

/** A claim is proven when the claimed product/receipt is where the merge records put the sale item's own stock:
 *  the same physical effect, reached along a tail of the sale item's own merge path (so a keeper of some other
 *  product that happens to merge into the same place is not accepted). */
export function assertReturnKeeperClaimsProven(claims: readonly ReturnKeeperClaim[], branchOf: (index: number) => number,
  resolution: ProductMergePhysicalResolution): void {
  const byKey = new Map(resolution.sources.map(source => [source.original.memberKey, source]))
  for (const claim of claims) {
    const claimed = byKey.get(claimSource(claim.productId, branchOf(claim.index), claim.batchId).memberKey)
    const original = byKey.get(claimSource(claim.originalProductId, branchOf(claim.index), claim.originalBatchId).memberKey)
    if (!claimed || !original || claimed.path.length > original.path.length
      || claimed.effect.productId !== original.effect.productId || claimed.effect.batchId !== original.effect.batchId
      || JSON.stringify(original.path.slice(original.path.length - claimed.path.length)) !== JSON.stringify(claimed.path)) throw returnKeeperClaimError(claim)
  }
}

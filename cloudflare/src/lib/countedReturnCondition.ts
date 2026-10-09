import type { D1Compat } from './db'
import { parseStockConditionTag, type StockConditionTag } from './stockCondition'

export type CountedReturnCondition = 'ordinary' | StockConditionTag
export type OriginalReturnCondition = {
  sale_item_id: number; sale_id: number; product_id: number; branch_id: number | null; damaged_lot_id: number | null
  original_product_id: number | null; original_branch_id: number | null; original_batch_id: number | null; original_condition_tag: string | null
}

export async function resolveCountedReturnConditions(db: D1Compat, saleId: number | null, items: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const ids = [...new Set(items.map(item => Number(item.sale_item_id)).filter(id => Number.isSafeInteger(id) && id > 0))]
  const rows = ids.length ? await db.prepare(`SELECT si.id AS sale_item_id,si.sale_id,si.product_id,si.branch_id,si.damaged_lot_id,
      ci.product_id AS original_product_id,ci.branch_id AS original_branch_id,ci.batch_id AS original_batch_id,ci.condition_tag AS original_condition_tag
      FROM sale_items si LEFT JOIN counted_sale_item_conditions ci ON ci.sale_item_id=si.id
      WHERE si.id IN(SELECT CAST(value AS INTEGER) FROM json_each(@ids))`).all<OriginalReturnCondition>({ids:JSON.stringify(ids)}) : []
  return resolveCountedReturnConditionsFromSnapshot(saleId,items,rows)
}

export function resolveCountedReturnConditionsFromSnapshot(saleId:number|null,items:Array<Record<string,unknown>>,rows:readonly OriginalReturnCondition[]):Array<Record<string,unknown>> {
  const originals = new Map(rows.map(row => [row.sale_item_id,row]))
  return items.map(item => {
    const original = originals.get(Number(item.sale_item_id))
    if (Number(item.sale_item_id) && (!original || original.sale_id !== saleId
      || (item.product_id != null && Number(item.product_id) !== original.product_id))) throw new Error('return_condition_sale_identity_conflict')
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
    if (original?.damaged_lot_id && item.batch_id != null && Number(item.batch_id) !== original.original_batch_id) throw new Error('return_condition_receipt_identity_conflict')
    return { ...item, counted_original_condition:!!original?.damaged_lot_id, stock_action:action, stock_condition:action === 'none' ? null : condition,
      ...(action === 'damaged' ? {condition_tag:condition,damaged_disposition:item.damaged_disposition || 'keep'} : {condition_tag:null}),
      ...(original?.damaged_lot_id ? {batch_id:original.original_batch_id} : {}) }
  })
}

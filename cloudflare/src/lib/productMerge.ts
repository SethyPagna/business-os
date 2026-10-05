import { meanMoney4, roundMoney4 } from './moneyPrecision'

export const MERGE_COST_FIELDS = ['cost_price_usd', 'cost_price_khr'] as const
export const MERGE_PRICE_FIELDS = [
  'selling_price_usd',
  'selling_price_khr',
  'wholesale_price_usd',
  'wholesale_price_khr',
] as const

// Owner, 5 Oct 2026: copying another product's selling or wholesale price onto
// the kept product during a merge is a product edit. Merge permission alone moves
// no price. The fold computes the keeper's FINAL price columns (the group maximum,
// or the Resolve grid's chosen Final) and refuses when any differs from the
// keeper's own today and the actor cannot edit products (full tier).
export const MERGE_PRICE_EDIT_CODE = 'product_edit_permission_required'
export const MERGE_PRICE_EDIT_MESSAGE = 'Copying a price from another product during a merge needs the permission to edit products. Nothing was changed.'

export type MergePriceCopyChange = { field: typeof MERGE_PRICE_FIELDS[number]; from: number; to: number }

/** The price columns whose final value differs from the keeper's current one (4 decimal places, as every merge comparison). */
export function mergePriceCopyChanges(
  before: Record<string, unknown> | null | undefined,
  final: Partial<Record<typeof MERGE_PRICE_FIELDS[number], unknown>>,
): MergePriceCopyChange[] {
  const out: MergePriceCopyChange[] = []
  for (const field of MERGE_PRICE_FIELDS) {
    const from = Number(before?.[field]) || 0
    const to = Number(final[field]) || 0
    if (roundMoney4(from) !== roundMoney4(to)) out.push({ field, from, to })
  }
  return out
}

export function mergePriceEditError(): Error & { code: string; status: number } {
  return Object.assign(new Error(MERGE_PRICE_EDIT_MESSAGE), { code: MERGE_PRICE_EDIT_CODE, status: 403 })
}

export function isMergePriceEditError(error: unknown): boolean {
  const candidate = error as { code?: unknown; status?: unknown } | null
  return candidate?.code === MERGE_PRICE_EDIT_CODE && candidate?.status === 403
}

export type MergeMoneyField = typeof MERGE_COST_FIELDS[number] | typeof MERGE_PRICE_FIELDS[number]

export type ProductMergeNumericIssue = {
  field: MergeMoneyField
  rowId: number | null
  value: unknown
  code: 'negative' | 'malformed'
}

export type ProductMergeEconomics = {
  merged: Partial<Record<MergeMoneyField, number>>
  distinctCosts: Partial<Record<typeof MERGE_COST_FIELDS[number], number[]>>
  issues: ProductMergeNumericIssue[]
}

type NumericValue = { kind: 'missing' } | { kind: 'value'; value: number } | { kind: 'invalid'; code: 'negative' | 'malformed' }

// Money arrives from both SQLite (number) and import paths (decimal text).
// Accept ordinary non-negative decimals only: scientific notation, Infinity,
// NaN and partial parses are data errors and block the merge. Blank/null means
// "not recorded"; it is different from an explicit zero.
export function parseMergeMoney(value: unknown): NumericValue {
  if (value === null || value === undefined) return { kind: 'missing' }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return { kind: 'missing' }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      return { kind: 'invalid', code: text.startsWith('-') ? 'negative' : 'malformed' }
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? { kind: 'value', value: parsed } : { kind: 'invalid', code: 'malformed' }
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'invalid', code: 'malformed' }
  if (value < 0) return { kind: 'invalid', code: 'negative' }
  return { kind: 'value', value }
}

function roundMoneyUp(value: number, places: number): number {
  const scale = 10 ** places
  return Math.ceil(value * scale - 1e-9) / scale || 0
}

export function resolveProductMergeEconomics(rows: ReadonlyArray<Record<string, unknown>>, legacyUp4 = false): ProductMergeEconomics {
  const merged: Partial<Record<MergeMoneyField, number>> = {}
  const distinctCosts: ProductMergeEconomics['distinctCosts'] = {}
  const issues: ProductMergeNumericIssue[] = []

  for (const field of [...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS]) {
    const values: number[] = []
    for (const row of rows) {
      const parsed = parseMergeMoney(row?.[field])
      if (parsed.kind === 'missing') continue
      if (parsed.kind === 'invalid') {
        issues.push({ field, rowId: Number.isInteger(Number(row?.id)) ? Number(row.id) : null, value: row?.[field], code: parsed.code })
        continue
      }
      if (!legacyUp4) {
        try { roundMoney4(parsed.value) } catch {
          issues.push({ field, rowId: Number.isInteger(Number(row?.id)) ? Number(row.id) : null, value: row?.[field], code: 'malformed' })
          continue
        }
      }
      values.push(parsed.value)
    }
    if (!values.length) continue
    if ((MERGE_COST_FIELDS as readonly string[]).includes(field)) {
      // The owner's rule is cluster-wide: DISTINCT valid non-zero costs are
      // collected before one mean and one final rounding. Repeated 4s do not
      // overweight 5, and 4/5/6 becomes 5 rather than pairwise 5.25.
      const positive = [...new Set(values.filter((value) => value > 0))]
      distinctCosts[field as typeof MERGE_COST_FIELDS[number]] = positive
      merged[field] = positive.length
        ? legacyUp4
          ? roundMoneyUp(positive.reduce((sum, value) => sum + value, 0) / positive.length, 4)
          : meanMoney4(positive)
        : 0
    } else {
      merged[field] = Math.max(...values)
    }
  }

  return { merged, distinctCosts, issues }
}

export type ProductMergeClusterPlanMember = {
  id: number
  updated_at: string | null
  money: Partial<Record<MergeMoneyField, number | null>>
}

export type ProductMergeClusterPlan = {
  version: 1 | 2
  identityKey: string
  keeperId: number
  memberIds: number[]
  members: ProductMergeClusterPlanMember[]
}

const ALL_MERGE_MONEY_FIELDS = [...MERGE_COST_FIELDS, ...MERGE_PRICE_FIELDS] as const

function planMoneyValue(value: unknown): number | null {
  const parsed = parseMergeMoney(value)
  if (parsed.kind === 'missing') return null
  if (parsed.kind === 'invalid') throw new Error('A merge cluster plan cannot contain invalid money.')
  return parsed.value
}

function samePlanMoney(left: unknown, right: unknown): boolean {
  try { return Object.is(planMoneyValue(left), planMoneyValue(right)) }
  catch { return false }
}

export function createProductMergeClusterPlan(
  identityKey: string,
  keeperId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
  version: 1 | 2 = 2,
): ProductMergeClusterPlan {
  if (!identityKey || !Number.isSafeInteger(keeperId) || keeperId <= 0) throw new Error('A merge cluster plan needs an identity and keeper.')
  const economics = resolveProductMergeEconomics(rows, version === 1)
  if (economics.issues.length) throw new Error(productMergeNumericError(economics.issues))
  const members = rows.map((row): ProductMergeClusterPlanMember => {
    const id = Number(row.id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A merge cluster plan contains an invalid product id.')
    const money: ProductMergeClusterPlanMember['money'] = {}
    for (const field of ALL_MERGE_MONEY_FIELDS) money[field] = planMoneyValue(row[field])
    return { id, updated_at: row.updated_at == null ? null : String(row.updated_at), money }
  }).sort((a, b) => a.id - b.id)
  const memberIds = members.map((member) => member.id)
  if (new Set(memberIds).size !== memberIds.length || !memberIds.includes(keeperId)) throw new Error('A merge cluster plan contains duplicate ids or omits its keeper.')
  return { version, identityKey, keeperId, memberIds, members }
}

export function parseProductMergeClusterPlan(value: unknown): ProductMergeClusterPlan | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ProductMergeClusterPlan>
  if ((candidate.version !== 1 && candidate.version !== 2) || typeof candidate.identityKey !== 'string' || !candidate.identityKey) return null
  if (!Number.isSafeInteger(candidate.keeperId) || Number(candidate.keeperId) <= 0 || !Array.isArray(candidate.members)) return null
  try {
    const rebuilt = createProductMergeClusterPlan(candidate.identityKey, Number(candidate.keeperId), candidate.members.map((member) => {
      if (!member || typeof member !== 'object') throw new Error('invalid member')
      const typed = member as ProductMergeClusterPlanMember
      return { id: typed.id, updated_at: typed.updated_at, ...(typed.money || {}) }
    }), candidate.version)
    if (!Array.isArray(candidate.memberIds) || candidate.memberIds.length !== rebuilt.memberIds.length) return null
    if (candidate.memberIds.some((id, index) => Number(id) !== rebuilt.memberIds[index])) return null
    return rebuilt
  } catch { return null }
}

export function resolveProductMergeClusterPlanEconomics(plan: ProductMergeClusterPlan): ProductMergeEconomics {
  // A previously approved v1 plan must retain its original ceil4 economics.
  return resolveProductMergeEconomics(plan.members.map((member) => ({ id: member.id, ...member.money })), plan.version === 1)
}

export function productMergePlanSourceMemberMatches(plan: ProductMergeClusterPlan, row: Record<string, unknown>): boolean {
  const member = plan.members.find((candidate) => candidate.id === Number(row.id))
  if (!member || member.updated_at !== (row.updated_at == null ? null : String(row.updated_at))) return false
  return ALL_MERGE_MONEY_FIELDS.every((field) => samePlanMoney(member.money[field], row[field]))
}

// U-cost (migration 0195): once a fold lands, the on-hand triggers re-derive
// the keeper's catalog USD cost as the quantity-weighted mean of its on-hand
// lots, which need not equal the plan's merged figure. A caller that has read
// that derivation (CATALOG_COST_DERIVE_SQL, same instant) passes it; the
// keeper's USD cost then matches when it equals EITHER the plan figure (no
// derivable lots, stored value kept) OR the derived figure. Every other money
// field, and the KHR cost the triggers never write, still pins to the plan.
export function productMergePlanKeeperMatches(
  plan: ProductMergeClusterPlan,
  row: Record<string, unknown>,
  derivedCostUsd?: number | null,
): boolean {
  if (Number(row.id) !== plan.keeperId) return false
  const economics = resolveProductMergeClusterPlanEconomics(plan)
  const source = plan.members.find((member) => member.id === plan.keeperId)
  if (!source || economics.issues.length) return false
  return ALL_MERGE_MONEY_FIELDS.every((field) => samePlanMoney(economics.merged[field] ?? source.money[field], row[field])
    || (field === 'cost_price_usd' && derivedCostUsd != null && samePlanMoney(derivedCostUsd, row[field])))
}

export function productMergeNumericError(issues: ProductMergeNumericIssue[]): string {
  const first = issues[0]
  if (!first) return ''
  const row = first.rowId == null ? '' : ` on product #${first.rowId}`
  return `${first.field}${row} is ${first.code === 'negative' ? 'negative' : 'not a valid decimal'}. Correct it before merging.`
}

export type ProductMergeCasRow = {
  id: number
  name: string | null
  barcode: string | null
  is_active: number
  updated_at: string | null
}

export type ProductMergeSourceExtent = {
  shelfRows: number
  shelfQuantity: number
  lotRows: number
  movements: number
  // Absent when the snapshot came from a caller that does not read lot stock;
  // those callers carry their own stock-state assertions.
  lotStockRows?: number
  lotQuantity?: number
}

// Named inside the JSON-path error SQLite raises, so the route can tell this
// abort from the other merge guards (which all read as "malformed JSON").
export const MERGE_CONFLICT_RETRY = 'merge_conflict_retry'

// The fold plans from reads taken before its write batch. A stock-in, sale or
// transfer landing on the DISCARDED product in between would leave its units on
// a deactivated row, because the fold deletes the shelf rows it read and not the
// ones it did not. This read-only statement aborts the whole batch (the
// closed-session statements with it) when the discarded product's shelf, lots or
// movement count differ from what was read; the caller answers a retryable 409.
export function productMergeSourceUnmovedAssertion(productId: number, extent: ProductMergeSourceExtent): { sql: string; params: Record<string, unknown> } {
  const readsLotStock = extent.lotQuantity != null && extent.lotStockRows != null
  const lotStockTerms = readsLotStock
    ? `
      AND (SELECT COUNT(*) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = @id) = @lotStockRows
      AND (SELECT COALESCE(SUM(bbs.quantity), 0) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = @id) = @lotQuantity`
    : ''
  return {
    sql: `SELECT CASE WHEN
      (SELECT COUNT(*) FROM branch_stock WHERE product_id = @id) = @shelfRows
      AND (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id) = @shelfQuantity
      AND (SELECT COUNT(*) FROM product_batches WHERE variant_product_id = @id) = @lotRows
      AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = @id) = @movements${lotStockTerms}
      THEN 1 ELSE json_extract('[1]', '$[${MERGE_CONFLICT_RETRY}]') END AS merge_source_guard`,
    params: {
      id: productId,
      shelfRows: extent.shelfRows,
      shelfQuantity: extent.shelfQuantity,
      lotRows: extent.lotRows,
      movements: extent.movements,
      ...(readsLotStock ? { lotStockRows: extent.lotStockRows, lotQuantity: extent.lotQuantity } : {}),
    },
  }
}

// Product ids are immutable, so this key remains stable across retries and
// lets a bounded client deduplicate receipts after a lost response.
export function productMergeCaseKey(keeperId: number, mergedId: number): string {
  if (!Number.isSafeInteger(keeperId) || keeperId <= 0 || !Number.isSafeInteger(mergedId) || mergedId <= 0 || keeperId === mergedId) {
    throw new Error('A product merge case requires two different positive integer ids.')
  }
  return `${keeperId}:${mergedId}`
}

// D1 batch() is transactional, but a zero-row UPDATE does not fail a batch.
// This read-only statement deliberately raises a SQLite JSON error when either
// row differs from the state the fold inspected, rolling the entire batch back.
export function productMergeCasAssertion(rows: readonly ProductMergeCasRow[]): { sql: string; params: Record<string, unknown> } {
  if (rows.length !== 2) throw new Error('A product merge CAS requires exactly two rows.')
  const [a, b] = rows
  return {
    sql: `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM products WHERE id=@aId AND is_active=@aActive
        AND COALESCE(name,'')=COALESCE(@aName,'') AND COALESCE(barcode,'')=COALESCE(@aBarcode,'')
        AND COALESCE(updated_at,'')=COALESCE(@aUpdated,''))
      AND EXISTS(SELECT 1 FROM products WHERE id=@bId AND is_active=@bActive
        AND COALESCE(name,'')=COALESCE(@bName,'') AND COALESCE(barcode,'')=COALESCE(@bBarcode,'')
        AND COALESCE(updated_at,'')=COALESCE(@bUpdated,''))
      THEN 1 ELSE json_extract('', '$') END AS merge_guard`,
    params: {
      aId: a.id, aActive: a.is_active, aName: a.name, aBarcode: a.barcode, aUpdated: a.updated_at,
      bId: b.id, bActive: b.is_active, bName: b.name, bBarcode: b.barcode, bUpdated: b.updated_at,
    },
  }
}

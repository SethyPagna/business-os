import type { ReactNode } from 'react'
import { getMergePreview, mergePossiblySameProducts, type ProductResolveChoices } from '../../api/productWriteTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { isRetryableFailure } from '../../utils/retryableFailure.ts'
import { roundMoney4 } from '../../utils/moneyPrecision.ts'
import { identityBarcodeKey, isRealBarcode } from '../../utils/productDetailRule.ts'
import type { ProductConflictCluster, ProductConflictProduct } from '../../utils/selectedConflictMerge.ts'
import type { ResolveCell, ResolveChoice, ResolveColumn, ResolveOption, ResolveRow } from '../shared/ResolveGrid.tsx'
import type { ResolveAdapter, ResolveAfterItem, ResolveChange, ResolveDraft } from '../shared/ResolveModal.tsx'

export type { ProductResolveChoices } from '../../api/productWriteTransport.ts'

// The products side of the one conflict resolver. Every product of a group
// opens in the shared ResolveModal; Resolve merges the others into one of
// them, one server fold per product (POST .../possible-duplicates/merge with
// keep:true), each in History with its own Undo.
//
// The surviving record is implicit (owner, 30 Sep 2026: "no need product
// kept"): the lowest included id. It never changes when a field is picked, so
// picking never re-reads the server; only Merge in / Keep separate does.
//
// Rows (UI-CONFLICTS 3.4), each a choice the server applies as sent
// (`choices`, frozen with the plan) when the preview says choicesSupported:
//   Name, Brand, Category, Unit  the survivor's value, else the first record
//                                that has one; Final can be typed.
//   Barcode                      a real barcode over an empty or broken one:
//                                the survivor's, else the first real one. The
//                                others stay on their merged records.
//   Cost                         the group average (server economics), a
//                                record's or a typed one; cost permissions.
//   Selling, Wholesale           the highest; a record's or a typed one.
//   Image                        the survivor's, else the first record's.
//   Stock                        Carry or Write off per merged product.
// An older server that cannot apply choices gets today's computed rows: name
// and barcode follow the survivor, selling is the highest.

type Translate = (key: string) => string | undefined

// resolveCellKey (ResolveGrid.tsx): the grid's key for a per-record choice.
// Written out here so this module loads without JSX (the node unit tests);
// tests/productResolveAdapter.test.ts pins the two against each other.
export const productCellKey = (rowKey: string, columnId: string): string => `${rowKey}|${columnId}`

/** A group member as the preview reads it (every products column). */
export type ProductResolveRecord = ProductConflictProduct & {
  brand?: string | null
  brands?: string | null
  category?: string | null
  categories?: string | null
  unit?: string | null
}

type StockBranch = { branchId: number; branchName: string | null; quantity: number }
type StockImpact = { totalQuantity: number; branches: StockBranch[] }

export type ProductResolvePreview = {
  reviewedDigest: string
  groupProducts: ProductResolveRecord[]
  stockImpact: StockImpact
  needsStockChoice: boolean
  blocked: { code: string; operationId?: string } | null
  keeperStock: StockImpact | null
  groupCost: { cost_price_usd?: number; cost_price_khr?: number } | null
  /** Stock-in sessions whose Undo this merge closes (operation ids). */
  closesStockSessions: string[]
  choicesSupported: boolean
}

export type ProductResolveData = {
  reviewedDigest: string
  /** Every product of the group in id order: one grid column each. */
  ids: number[]
  products: Map<number, ProductResolveRecord>
  /** The survivor the previews were read against. */
  keeperId: number
  /** Per other product, read against keeperId. */
  previews: Map<number, ProductResolvePreview>
  /** The server applies per-field choices (else the rows stay computed). */
  choicesSupported: boolean
}

export type ProductResolveCost = { cost_price_usd: number; cost_price_khr?: number | null }

export type ProductResolveToken = {
  requestId: string
  reviewedDigest: string
  keepId: number
  steps: Array<{ mergeId: number; name: string; stock?: 'merge' | 'write_off' }>
  /** Sent only by a user with the cost edit permission. */
  cost: ProductResolveCost | null
  /** The Final column, sent on every step and every retry of the request. */
  choices: ProductResolveChoices | null
}

type MergeKeep = {
  cost_price_usd?: number
  cost_price_khr?: number | null
  resolve?: { requestId: string; reviewedDigest: string; steps: Array<{ mergeId: number; stock?: 'merge' | 'write_off' }> }
  choices?: ProductResolveChoices
}

export type ProductResolveApi = {
  preview: (keepId: number, mergeId: number, options: { keep: true; groupIds: number[]; signal?: AbortSignal }) => Promise<unknown>
  merge: (keepId: number, mergeId: number, stock: 'merge' | 'write_off' | undefined, keep: MergeKeep) => Promise<unknown>
}

export type ProductResolveOptions = {
  cluster: ProductConflictCluster
  t: Translate
  canViewCosts: boolean
  canEditCosts: boolean
  canEditProducts?: boolean
  /**
   * Taking another record's selling or wholesale price is a product edit (owner,
   * 5 Oct 2026; the Worker refuses it with product_edit_permission_required). The
   * host passes the FULL-tier answer; absent means "same as canEditProducts".
   * Without it the price rows are locked on the survivor's own price.
   */
  canCopyPrices?: boolean
  /** Asked again right before writing: permissions can change while the grid is open. */
  canMerge: () => boolean
  /** A merge step committed: the host's list is out of date even if a later step fails. */
  onWritten?: () => void
  /** The picture for an image cell (the host renders the thumbnail). */
  imageDisplay?: (path: string) => ReactNode
  api?: ProductResolveApi
}

const DEFAULT_API: ProductResolveApi = {
  preview: (keepId, mergeId, options) => getMergePreview(keepId, mergeId, options),
  merge: (keepId, mergeId, stock, keep) => mergePossiblySameProducts(keepId, mergeId, stock, keep),
}

const MAX_GROUP = 12
// Mirrors RESOLVE_NAME_MAX / RESOLVE_TEXT_MAX in cloudflare/src/lib/productResolveChoices.ts.
export const RESOLVE_TEXT_MAX = 200

// Refusals that mean the products moved under the review: read them again.
const STALE_CODES = new Set(['merge_state_conflict', 'stock_choice_required', 'product_merge_not_duplicates', 'product_merge_inactive'])

function tr(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function formatProductMoney(value: unknown): string {
  const n = Number(value) || 0
  return `$${Number(n.toFixed(4))}`
}

function productLabel(product: { name?: unknown } | undefined, id: number): string {
  const name = String(product?.name ?? '').trim()
  return name ? `${name} (#${id})` : `#${id}`
}

function readImpact(value: unknown): StockImpact {
  const raw = (value && typeof value === 'object' ? value : {}) as { totalQuantity?: unknown; branches?: unknown }
  const branches = Array.isArray(raw.branches) ? raw.branches : []
  return {
    totalQuantity: Number(raw.totalQuantity) || 0,
    branches: branches.map((entry) => {
      const branch = (entry ?? {}) as { branchId?: unknown; branchName?: unknown; quantity?: unknown }
      return { branchId: Number(branch.branchId), branchName: branch.branchName == null ? null : String(branch.branchName), quantity: Number(branch.quantity) || 0 }
    }).filter((branch) => Number.isSafeInteger(branch.branchId)),
  }
}

function readPreview(value: unknown): ProductResolvePreview {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const blocked = raw.blocked && typeof raw.blocked === 'object' ? raw.blocked as { code?: unknown; operationId?: unknown } : null
  const groupCost = raw.groupCost && typeof raw.groupCost === 'object' ? raw.groupCost as Record<string, unknown> : null
  return {
    reviewedDigest: String(raw.reviewedDigest ?? ''),
    groupProducts: Array.isArray(raw.groupProducts) ? raw.groupProducts as ProductResolveRecord[] : [],
    stockImpact: readImpact(raw.stockImpact),
    needsStockChoice: Boolean(raw.needsStockChoice),
    blocked: blocked ? { code: String(blocked.code ?? ''), ...(blocked.operationId ? { operationId: String(blocked.operationId) } : {}) } : null,
    keeperStock: raw.keeperStock ? readImpact(raw.keeperStock) : null,
    closesStockSessions: Array.isArray(raw.closesStockSessions) ? raw.closesStockSessions.map(String) : [],
    groupCost: groupCost && 'cost_price_usd' in groupCost
      ? { cost_price_usd: Number(groupCost.cost_price_usd) || 0, cost_price_khr: Number(groupCost.cost_price_khr) || 0 }
      : null,
    choicesSupported: raw.choicesSupported === true,
  }
}

/**
 * The barcode the survivor ends with when the server cannot take a choice:
 * its own stored one; with none, the first merged product's real barcode.
 * Mirrors keeperFollowsBarcode in cloudflare/src/lib/productIdentity.ts.
 */
export function finalProductBarcode(keeper: { barcode?: unknown } | undefined, merged: Array<{ barcode?: unknown }>): string {
  const own = String(keeper?.barcode ?? '')
  if (own.trim()) return own
  return String(merged.find((product) => isRealBarcode(product.barcode))?.barcode ?? '').trim()
}

/** The merged products' barcodes the survivor does not carry: they stay on their merged records. */
export function absorbedProductBarcodes(finalBarcode: string, merged: Array<{ barcode?: unknown }>): string[] {
  return merged
    .map((product) => String(product.barcode ?? '').trim())
    .filter((raw) => raw && !(finalBarcode.trim() && identityBarcodeKey(raw) === identityBarcodeKey(finalBarcode)))
}

// ---- The Final column as the server writes it (parity with
// cloudflare/src/lib/productResolveChoices.ts resolveChoiceValues, pinned by
// the shared fixture scripts/fixtures/product-resolve-choices-parity.json).

export type ProductResolveFinal = Partial<{
  name: string
  barcode: string | null
  brand: string | null
  category: string | null
  unit: string | null
  selling_price_usd: number
  wholesale_price_usd: number
  image_path: string | null
}>

const textOrNull = (value: unknown): string | null => {
  if (value == null) return null
  const text = String(value)
  return text.trim() ? text : null
}

const storedMoney = (value: unknown): number => (value == null || value === '' ? 0 : Number(value) || 0)

export function productResolveFinalValues(choices: ProductResolveChoices, records: ReadonlyArray<ProductResolveRecord>): ProductResolveFinal {
  const byId = new Map(records.map((record) => [Number(record.id), record]))
  const out: ProductResolveFinal = {}
  for (const [field, choice] of Object.entries(choices) as Array<[keyof ProductResolveChoices, ProductResolveChoices[keyof ProductResolveChoices]]>) {
    if (!choice) continue
    const row = 'source_id' in choice ? byId.get(choice.source_id) : undefined
    const custom = 'custom' in choice ? choice.custom : undefined
    if ('source_id' in choice && !row) continue
    switch (field) {
      case 'name': out.name = row ? String(row.name ?? '') : String(custom).trim(); break
      case 'barcode': out.barcode = row?.barcode == null ? null : String(row.barcode); break
      case 'brand': out.brand = row ? textOrNull(row.brand) : textOrNull(custom); break
      case 'category': out.category = row ? textOrNull(row.category) : textOrNull(custom); break
      case 'unit': out.unit = row ? textOrNull(row.unit) : textOrNull(custom); break
      case 'selling_price_usd': out.selling_price_usd = row ? storedMoney(row.selling_price_usd) : Number(custom); break
      case 'wholesale_price_usd': out.wholesale_price_usd = row ? storedMoney(row.wholesale_price_usd) : Number(custom); break
      case 'image': out.image_path = row ? textOrNull(row.image_path) : null; break
    }
  }
  return out
}

// ---- Per-field rows

type TextField = 'name' | 'brand' | 'category' | 'unit'
type MoneyField = 'selling_price_usd' | 'wholesale_price_usd'
type ChoiceField = keyof ProductResolveChoices

// Row key -> the field the server takes. Row keys stay short: they are grid
// keys, draft keys and parked-chip keys.
const FIELD_OF_ROW: Record<string, ChoiceField> = {
  name: 'name', barcode: 'barcode', brand: 'brand', category: 'category', unit: 'unit',
  selling: 'selling_price_usd', wholesale: 'wholesale_price_usd', image: 'image',
}

type Context = {
  data: ProductResolveData
  draft: ResolveDraft
  included: number[]
  keeperId: number | null
  merged: number[]
}

function includedIds(ids: number[], draft: ResolveDraft): number[] {
  return ids.filter((id) => draft.columns[String(id)]?.disposition !== 'separate')
}

/** The surviving record: the lowest included id. */
export function productSurvivor(included: readonly number[]): number | null {
  return included.length ? Math.min(...included) : null
}

function contextOf(data: ProductResolveData, draft: ResolveDraft): Context {
  const included = includedIds(data.ids, draft).filter((id) => data.products.has(id))
  const keeperId = productSurvivor(included)
  return { data, draft, included, keeperId, merged: included.filter((id) => id !== keeperId) }
}

const recordOf = (ctx: Context, id: number) => ctx.data.products.get(id)
const survivorFirst = (ctx: Context): number[] => (ctx.keeperId === null ? ctx.included : [ctx.keeperId, ...ctx.merged])

function pickedSource(ctx: Context, rowKey: string): number | null {
  const choice = ctx.draft.selection[rowKey]
  if (!choice || !('source' in choice)) return null
  const id = Number(choice.source)
  return ctx.included.includes(id) ? id : null
}

function typedValue(ctx: Context, rowKey: string): string | null {
  const choice = ctx.draft.selection[rowKey]
  return choice && 'custom' in choice ? choice.custom : null
}

function validName(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= RESOLVE_TEXT_MAX
}

function validText(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length <= RESOLVE_TEXT_MAX && !trimmed.includes('||')
}

function typedMoney(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed || !Number.isFinite(Number(trimmed)) || Number(trimmed) < 0) return null
  try { return roundMoney4(trimmed) } catch { return null }
}

function defaultTextSource(ctx: Context, field: TextField): number | null {
  const order = survivorFirst(ctx)
  return order.find((id) => String(recordOf(ctx, id)?.[field] ?? '').trim()) ?? ctx.keeperId
}

function defaultBarcodeSource(ctx: Context): number | null {
  const order = survivorFirst(ctx)
  return order.find((id) => isRealBarcode(recordOf(ctx, id)?.barcode)) ?? ctx.keeperId
}

// Highest wins (the merge rule); on a tie the survivor, then the lowest id.
function defaultMoneySource(ctx: Context, field: MoneyField): number | null {
  let best: number | null = null
  for (const id of survivorFirst(ctx)) {
    if (best === null || storedMoney(recordOf(ctx, id)?.[field]) > storedMoney(recordOf(ctx, best)?.[field])) best = id
  }
  return best
}

function defaultImageSource(ctx: Context): number | null {
  return survivorFirst(ctx).find((id) => String(recordOf(ctx, id)?.image_path ?? '').trim()) ?? ctx.keeperId
}

/** The effective choice per field: an explicit pick, a valid typed value, else the default. */
function productResolveChoices(ctx: Context, canEditProducts: boolean, canCopyPrices: boolean): ProductResolveChoices {
  const out: ProductResolveChoices = {}
  const source = (rowKey: string, fallback: number | null) => {
    const id = pickedSource(ctx, rowKey) ?? fallback
    return id === null ? undefined : { source_id: id }
  }
  for (const field of ['name', 'brand', 'category', 'unit'] as const) {
    const typed = canEditProducts ? typedValue(ctx, field) : null
    if (typed !== null && (field === 'name' ? validName(typed) : validText(typed))) out[field] = { custom: typed.trim() }
    else {
      const choice = source(field, defaultTextSource(ctx, field))
      if (choice) out[field] = choice
    }
  }
  const barcode = source('barcode', defaultBarcodeSource(ctx))
  if (barcode) out.barcode = barcode
  for (const [rowKey, field] of [['selling', 'selling_price_usd'], ['wholesale', 'wholesale_price_usd']] as const) {
    // Without the product-edit grant a price can only stay the survivor's own: no
    // typed value, no pick of another record, no group maximum.
    if (!canCopyPrices) {
      if (ctx.keeperId !== null) out[field] = { source_id: ctx.keeperId }
      continue
    }
    const typed = canEditProducts ? typedValue(ctx, rowKey) : null
    const money = typed === null ? null : typedMoney(typed)
    if (money !== null) out[field] = { custom: money }
    else {
      const choice = source(rowKey, defaultMoneySource(ctx, field))
      if (choice) out[field] = choice
    }
  }
  const image = source('image', defaultImageSource(ctx))
  if (image) out.image = image
  return out
}

type StockAnswer = 'merge' | 'write_off'

function stockAnswer(ctx: Context, id: number): StockAnswer | undefined {
  if (!ctx.data.previews.get(id)?.needsStockChoice) return undefined
  const choice = ctx.draft.selection[productCellKey('stock', String(id))]
  return choice && 'option' in choice && choice.option === 'write_off' ? 'write_off' : 'merge'
}

type CostPick = { kind: 'rule' } | { kind: 'source'; id: number } | { kind: 'custom'; value: number }

function costPick(ctx: Context, canEdit: boolean): CostPick {
  const choice = ctx.draft.selection.cost
  if (canEdit && choice && 'source' in choice && ctx.included.includes(Number(choice.source))) return { kind: 'source', id: Number(choice.source) }
  if (canEdit && choice && 'custom' in choice) {
    const value = Number(choice.custom)
    if (choice.custom.trim() !== '' && Number.isFinite(value) && value >= 0) return { kind: 'custom', value }
  }
  return { kind: 'rule' }
}

function ruleCost(ctx: Context): { cost_price_usd: number; cost_price_khr: number } {
  const fromPreview = ctx.merged.map((id) => ctx.data.previews.get(id)?.groupCost).find(Boolean)
  const keeper = ctx.keeperId === null ? undefined : recordOf(ctx, ctx.keeperId)
  return {
    cost_price_usd: Number(fromPreview?.cost_price_usd ?? keeper?.cost_price_usd ?? 0) || 0,
    cost_price_khr: Number(fromPreview?.cost_price_khr ?? keeper?.cost_price_khr ?? 0) || 0,
  }
}

function chosenCost(ctx: Context, canEdit: boolean): ProductResolveCost {
  const pick = costPick(ctx, canEdit)
  if (pick.kind === 'source') {
    const product = recordOf(ctx, pick.id)
    return { cost_price_usd: Number(product?.cost_price_usd) || 0, cost_price_khr: product?.cost_price_khr == null ? null : Number(product.cost_price_khr) || 0 }
  }
  if (pick.kind === 'custom') return { cost_price_usd: pick.value }
  return ruleCost(ctx)
}

type BranchLine = { branchId: number; name: string; before: number; after: number }

function stockPlan(ctx: Context): { before: number; after: number; branches: BranchLine[] } {
  const keeperStock = ctx.merged.map((id) => ctx.data.previews.get(id)?.keeperStock).find(Boolean)
  const keeper = ctx.keeperId === null ? undefined : recordOf(ctx, ctx.keeperId)
  const lines = new Map<number, BranchLine>()
  const line = (branch: StockBranch) => {
    if (!lines.has(branch.branchId)) lines.set(branch.branchId, { branchId: branch.branchId, name: branch.branchName || `#${branch.branchId}`, before: 0, after: 0 })
    return lines.get(branch.branchId)!
  }
  for (const branch of keeperStock?.branches ?? []) { const entry = line(branch); entry.before += branch.quantity; entry.after += branch.quantity }
  const before = keeperStock ? keeperStock.totalQuantity : Number(keeper?.stock_quantity) || 0
  let after = before
  for (const id of ctx.merged) {
    const preview = ctx.data.previews.get(id)
    if (!preview || stockAnswer(ctx, id) === 'write_off') continue
    after += preview.stockImpact.totalQuantity
    for (const branch of preview.stockImpact.branches) line(branch).after += branch.quantity
  }
  return { before, after, branches: [...lines.values()].sort((a, b) => a.branchId - b.branchId) }
}

function stockText(total: number, branches: Array<{ name: string; quantity: number }>, t: Translate): string {
  const pcs = tr(t, 'pcs', 'pcs')
  const parts = branches.filter((branch) => branch.quantity !== 0).map((branch) => `${branch.name} ${branch.quantity}`)
  return parts.length ? `${total} ${pcs} · ${parts.join(' · ')}` : `${total} ${pcs}`
}

function productStockText(ctx: Context, id: number, t: Translate): string {
  const preview = ctx.data.previews.get(id)
  if (id === ctx.keeperId) {
    const keeperStock = ctx.merged.map((other) => ctx.data.previews.get(other)?.keeperStock).find(Boolean)
    if (keeperStock) return stockText(keeperStock.totalQuantity, keeperStock.branches.map((b) => ({ name: b.branchName || `#${b.branchId}`, quantity: b.quantity })), t)
  } else if (preview) {
    return stockText(preview.stockImpact.totalQuantity, preview.stockImpact.branches.map((b) => ({ name: b.branchName || `#${b.branchId}`, quantity: b.quantity })), t)
  }
  return stockText(Number(recordOf(ctx, id)?.stock_quantity) || 0, [], t)
}

function blockedMessage(ctx: Context, id: number, t: Translate): string | null {
  const blocked = ctx.data.previews.get(id)?.blocked
  if (!blocked?.code) return null
  const name = productLabel(recordOf(ctx, id), id)
  if (blocked.code === 'resolve_plan_budget') return tr(t, 'resolve_plan_budget', 'Product resolving is unavailable on this deployment. No changes were saved.')
  if (blocked.code === 'invalid_merge_numeric') {
    return fill(tr(t, 'resolve_product_numeric', '{name} has a price or cost that is not a valid number. Correct it, then resolve.'), { name })
  }
  if (blocked.code === 'product_merge_not_duplicates') {
    return fill(tr(t, 'resolve_product_not_listed', '{name} is no longer listed with the kept product. Refresh the Duplicates list.'), { name })
  }
  return null
}

// The Worker's refusals arrive in English, and a dropped connection or a fault
// says nothing an operator can use ("Failed to fetch"). Every failure this flow
// can meet is said in the operator's language, by code first, then by kind.
// The code and status stay on the error: isStale reads the code and the modal
// offers Continue only for a network error or a 5xx.
function localizedRefusal(error: unknown, t: Translate, partial: boolean): unknown {
  const problem = error as { code?: unknown; status?: unknown; errorId?: unknown; message?: unknown } | null
  const code = typeof problem?.code === 'string' ? problem.code : ''
  const errorId = String(problem?.errorId ?? '') || (String(problem?.message ?? '').match(/Reference: ([\w-]+)/)?.[1] ?? '')
  const status = Number(problem?.status)
  const message = code === 'product_merge_not_duplicates'
    ? tr(t, 'selected_conflict_product_merge_not_duplicates', 'These products are not a current duplicate group. Refresh the Duplicates list and try again.')
    : code === 'resolve_plan_budget'
      ? partial ? tr(t, 'resolve_partial_refusal_budget', 'Product resolving is unavailable on this deployment.') : tr(t, 'resolve_plan_budget', 'Product resolving is unavailable on this deployment. No changes were saved.')
    : code === 'cost_permission_required'
      ? tr(t, 'resolve_cost_locked', 'Changing the cost needs the cost edit permission.')
    : code === 'product_edit_permission_required'
      ? tr(t, 'merge_needs_product_edit', 'This merge changes product details or prices, which needs the permission to edit products. Nothing was changed.')
    : code === 'merge_failed'
      ? fill(tr(t, 'resolve_refusal_merge_failed', 'The server could not merge these products. Reference: {errorId}'), { errorId })
    : code === 'merge_conflict_retry'
      ? partial ? tr(t, 'resolve_partial_refusal_retry', 'Stock changed while merging. Review the remaining records again.') : tr(t, 'resolve_refusal_retry', 'Stock changed while merging. Nothing was saved. Try again.')
    : code === 'merge_case_exceeds_safe_limit'
      ? partial ? tr(t, 'resolve_partial_refusal_too_large', 'This product has too many linked records for one safe merge.') : tr(t, 'resolve_refusal_too_large', 'This product has too many linked records for one safe merge. Nothing was saved.')
    : code === 'invalid_merge_numeric'
      ? tr(t, 'resolve_refusal_numeric', 'A price or cost is not a valid number. Correct it, then resolve.')
    : code === 'resolve_request_conflict'
      ? tr(t, 'resolve_refusal_request_conflict', 'This resolve was already started with different choices. Review again.')
    : code === 'invalid_resolve_plan'
      ? tr(t, 'resolve_refusal_invalid_plan', 'These choices are not valid. Review again.')
    : STALE_CODES.has(code)
      ? partial ? tr(t, 'resolve_partial_refusal_changed', 'These records changed. Review the remaining records again.') : tr(t, 'resolve_refusal_changed', 'These records changed. Nothing was saved. Review again.')
    : status === 403
      ? partial ? tr(t, 'resolve_partial_refusal_permission', 'You do not have permission to finish this merge.') : tr(t, 'resolve_refusal_permission', 'You do not have permission to do this. Nothing was saved.')
    : status === 404
      ? tr(t, 'resolve_refusal_missing', 'One of these products no longer exists. Refresh and try again.')
    : status >= 400 && status < 500 && status !== 408 && status !== 429
      ? tr(t, 'resolve_refusal_invalid_plan', 'These choices are not valid. Review again.')
    : status >= 500
      ? tr(t, 'resolve_refusal_server', 'The server had a problem.')
    : isRetryableFailure(error)
      ? tr(t, 'resolve_refusal_network', 'Could not reach the server.')
      : ''
  if (!message) return error
  // Nothing on the wire said whether the write landed, and the new wording no longer carries the network signature isRetryableFailure reads.
  const outcome = !Number.isFinite(status) && isRetryableFailure(error) ? { outcome: 'unknown' } : {}
  return Object.assign(new Error(message), { code, status: problem?.status, ...outcome, ...(errorId ? { errorId } : {}) })
}

type Plan = { ctx: Context; rows: ResolveRow[]; choices: ProductResolveChoices | null; final: ProductResolveFinal; absorbed: string[] }

function buildPlan(data: ProductResolveData, draft: ResolveDraft, options: ProductResolveOptions): Plan {
  const { t, canViewCosts, canEditCosts } = options
  const canEditProducts = options.canEditProducts === true
  const canCopyPrices = options.canCopyPrices ?? canEditProducts
  const ctx = contextOf(data, draft)
  const { included, keeperId } = ctx
  const product = (id: number) => data.products.get(id)
  const cells = (text: (id: number) => string, extra?: (id: number) => Partial<ResolveCell>): Record<string, ResolveCell> => (
    Object.fromEntries(data.ids.map((id) => [String(id), { text: text(id), ...(extra?.(id) ?? {}) }]))
  )
  const identical = (row: Record<string, ResolveCell>, finalText: string): boolean => included.every((id) => (row[String(id)]?.text ?? '') === finalText)
  const keeper = keeperId === null ? undefined : product(keeperId)
  const mergedProducts = ctx.merged.map((id) => product(id)).filter((entry): entry is ProductResolveRecord => Boolean(entry))
  const choices = data.choicesSupported ? productResolveChoices(ctx, canEditProducts, canCopyPrices) : null
  const final = choices ? productResolveFinalValues(choices, [...data.products.values()]) : {}
  const rowChoice = (rowKey: string): ResolveChoice | undefined => {
    const choice = choices?.[FIELD_OF_ROW[rowKey]]
    if (!choice) return undefined
    return 'source_id' in choice ? { source: String(choice.source_id) } : { custom: String(typedValue(ctx, rowKey) ?? choice.custom) }
  }
  const suggestions = (field: TextField) => [...new Set(included.map((id) => String(product(id)?.[field] ?? '').trim()).filter(Boolean))]
  const rows: ResolveRow[] = []

  const textRow = (field: TextField, label: string) => {
    const row = cells((id) => String(product(id)?.[field] ?? '').trim())
    const finalText = String(final[field] ?? '').trim()
    rows.push({
      key: field,
      label,
      kind: 'choice',
      cells: row,
      final: { text: finalText },
      choice: rowChoice(field),
      identical: identical(row, finalText),
      copyable: true,
      ...(canEditProducts ? { custom: field === 'name'
        ? { kind: 'text', validate: (value) => (validName(value) ? null : tr(t, 'resolve_name_invalid', 'Enter a name of 1 to 200 characters.')) }
        : { kind: 'suggest', suggestions: suggestions(field), validate: (value: string) => (validText(value) ? null : tr(t, 'resolve_text_invalid', 'Use at most 200 characters, without ||.')) } } : {}),
    })
  }

  if (choices) textRow('name', tr(t, 'name', 'Name'))
  else {
    const nameRow = cells((id) => String(product(id)?.name ?? ''))
    const finalName = String(keeper?.name ?? '')
    rows.push({ key: 'name', label: tr(t, 'name', 'Name'), kind: 'computed', cells: nameRow, final: { text: finalName }, identical: identical(nameRow, finalName), copyable: true })
  }

  const barcodeRow = cells((id) => String(product(id)?.barcode ?? '').trim())
  const finalBarcode = choices ? String(final.barcode ?? '').trim() : finalProductBarcode(keeper, mergedProducts).trim()
  rows.push({
    key: 'barcode',
    label: tr(t, 'barcode', 'Barcode'),
    kind: choices ? 'choice' : 'computed',
    cells: barcodeRow,
    final: { text: finalBarcode },
    ...(choices ? { choice: rowChoice('barcode') } : {}),
    identical: identical(barcodeRow, finalBarcode),
    copyable: true,
  })

  if (choices) {
    textRow('brand', tr(t, 'brand', 'Brand'))
    textRow('category', tr(t, 'category', 'Category'))
    textRow('unit', tr(t, 'unit', 'Unit'))
  }

  if (canViewCosts) {
    const pick = costPick(ctx, canEditCosts)
    const cost = chosenCost(ctx, canEditCosts)
    const costRow = cells((id) => formatProductMoney(product(id)?.cost_price_usd))
    const finalText = formatProductMoney(cost.cost_price_usd)
    const ruleOption: ResolveOption = { id: 'rule', label: tr(t, 'resolve_cost_rule', 'Average of the costs') }
    rows.push({
      key: 'cost',
      label: tr(t, 'cost', 'Cost'),
      kind: 'choice',
      cells: costRow,
      options: [ruleOption],
      final: { text: finalText },
      choice: pick.kind === 'rule' ? { option: 'rule' } : pick.kind === 'source' ? { source: String(pick.id) } : { custom: String(pick.value) },
      identical: identical(costRow, finalText),
      ...(canEditCosts
        ? { custom: { kind: 'money' as const, validate: (value: string) => (value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? null : tr(t, 'resolve_cost_invalid', 'Enter a cost of zero or more.')) } }
        : { locked: tr(t, 'resolve_cost_locked', 'Changing the cost needs the cost edit permission.') }),
    })
  }

  const moneyRow = (rowKey: 'selling' | 'wholesale', field: MoneyField, label: string) => {
    const row = cells((id) => formatProductMoney(product(id)?.[field]))
    const finalText = formatProductMoney(final[field])
    rows.push({
      key: rowKey,
      label,
      kind: 'choice',
      cells: row,
      final: { text: finalText },
      choice: rowChoice(rowKey),
      identical: identical(row, finalText),
      ...(canCopyPrices
        ? (canEditProducts ? { custom: { kind: 'money' as const, validate: (value: string) => (typedMoney(value) === null ? tr(t, 'resolve_price_invalid', 'Enter a price of zero or more.') : null) } } : {})
        : { locked: tr(t, 'resolve_price_locked', 'Taking a price from another product needs the permission to edit products.') }),
    })
  }

  if (choices) {
    moneyRow('selling', 'selling_price_usd', tr(t, 'selling_price', 'Selling price'))
    moneyRow('wholesale', 'wholesale_price_usd', tr(t, 'wholesale_price', 'Wholesale price'))
    const imageOf = (id: number) => String(product(id)?.image_path ?? '').trim()
    const picture = (path: string): Partial<ResolveCell> => (path && options.imageDisplay ? { display: options.imageDisplay(path) } : {})
    const imageRow = cells(imageOf, (id) => picture(imageOf(id)))
    const finalImage = String(final.image_path ?? '').trim()
    rows.push({
      key: 'image',
      label: tr(t, 'image', 'Image'),
      kind: 'choice',
      cells: imageRow,
      final: { text: finalImage, ...picture(finalImage) },
      choice: rowChoice('image'),
      identical: identical(imageRow, finalImage),
    })
  } else {
    const sellingRow = cells((id) => formatProductMoney(product(id)?.selling_price_usd))
    const sellingText = formatProductMoney(Math.max(0, ...included.map((id) => Number(product(id)?.selling_price_usd) || 0)))
    rows.push({ key: 'selling', label: tr(t, 'selling_price', 'Selling price'), kind: 'computed', cells: sellingRow, final: { text: sellingText }, identical: identical(sellingRow, sellingText) })
  }

  const stockOptions: ResolveOption[] = [
    { id: 'merge', label: tr(t, 'resolve_stock_carry', 'Carry') },
    { id: 'write_off', label: tr(t, 'resolve_stock_write_off', 'Write off') },
  ]
  const stockRow = cells((id) => productStockText(ctx, id, t), (id) => {
    if (id === keeperId || !ctx.merged.includes(id) || !data.previews.get(id)?.needsStockChoice) return {}
    return { options: stockOptions, choice: stockAnswer(ctx, id) }
  })
  const stock = stockPlan(ctx)
  rows.push({
    key: 'stock',
    label: tr(t, 'stock', 'Stock'),
    kind: 'computed',
    cells: stockRow,
    final: { text: stockText(stock.after, stock.branches.map((branch) => ({ name: branch.name, quantity: branch.after })), t) },
    identical: false,
  })

  return { ctx, rows, choices, final, absorbed: absorbedProductBarcodes(finalBarcode, mergedProducts) }
}

export function createProductResolveAdapter(options: ProductResolveOptions): ResolveAdapter<ProductResolveData, ProductResolveToken> {
  const { cluster, t } = options
  const api = options.api ?? DEFAULT_API
  const listedProducts = new Map<number, ProductResolveRecord>(cluster.products.map((product) => [Number(product.id), product]))
  const ids = [...listedProducts.keys()].sort((a, b) => a - b)
  // A merge that stopped part way resumes from the step that did not answer.
  const progress = new WeakMap<ProductResolveToken, { index: number; keeper: Record<string, unknown> | null; absorbed: string[] }>()

  const afterItems = (keeper: Record<string, unknown> | null, token: ProductResolveToken, absorbed: string[]): ResolveAfterItem[] => {
    const items: ResolveAfterItem[] = []
    if (keeper) {
      items.push({ label: tr(t, 'name', 'Name'), value: String(keeper.name ?? '') })
      items.push({ label: tr(t, 'barcode', 'Barcode'), value: String(keeper.barcode ?? '') })
      if ('brand' in keeper) items.push({ label: tr(t, 'brand', 'Brand'), value: String(keeper.brand ?? '') })
      if ('category' in keeper) items.push({ label: tr(t, 'category', 'Category'), value: String(keeper.category ?? '') })
      if ('cost_price_usd' in keeper && options.canViewCosts) items.push({ label: tr(t, 'cost', 'Cost'), value: formatProductMoney(keeper.cost_price_usd) })
      items.push({ label: tr(t, 'selling_price', 'Selling price'), value: formatProductMoney(keeper.selling_price_usd) })
      if ('wholesale_price_usd' in keeper) items.push({ label: tr(t, 'wholesale_price', 'Wholesale price'), value: formatProductMoney(keeper.wholesale_price_usd) })
      const branches = Array.isArray(keeper.branch_stock) ? readImpact({ branches: keeper.branch_stock }).branches : []
      items.push({ label: tr(t, 'stock', 'Stock'), value: stockText(Number(keeper.stock_quantity) || 0, branches.map((b) => ({ name: b.branchName || `#${b.branchId}`, quantity: b.quantity })), t) })
    }
    items.push({ label: tr(t, 'resolve_products_merged', 'Merged products'), value: token.steps.map((step) => step.name).join(', ') })
    if (absorbed.length) items.push({ label: tr(t, 'resolve_barcodes_kept_on_merged', 'Barcodes kept on the merged records'), value: absorbed.join(', ') })
    return items
  }

  return {
    async load(signal, edits) {
      const included = includedIds(ids, edits)
      const keeperId = productSurvivor(included) ?? ids[0]
      const empty = { ids, products: new Map(listedProducts), keeperId, previews: new Map<number, ProductResolvePreview>(), reviewedDigest: '', choicesSupported: false }
      if (included.length > MAX_GROUP) return empty
      const others = included.filter((id) => id !== keeperId)
      const answers = await Promise.all(others.map((id) => api.preview(keeperId, id, { keep: true, groupIds: included, signal })))
      const previews = new Map(others.map((id, index) => [id, readPreview(answers[index])]))
      const first = previews.values().next().value as ProductResolvePreview | undefined
      if ([...previews.values()].some((preview) => preview.reviewedDigest !== first?.reviewedDigest)) {
        throw Object.assign(new Error(tr(t, 'resolve_stale_banner', 'These records changed. Reload and review again.')), { code: 'merge_state_conflict' })
      }
      const products = new Map(listedProducts)
      for (const record of first?.groupProducts ?? []) products.set(Number(record.id), record)
      const choicesSupported = previews.size > 0 && [...previews.values()].every((preview) => preview.choicesSupported)
      return { ids, products, keeperId, previews, reviewedDigest: first?.reviewedDigest ?? '', choicesSupported }
    },

    initialSelection() {
      return { selection: {}, columns: {} }
    },

    columns(data, draft): ResolveColumn[] {
      return data.ids.map((id) => ({
        id: String(id),
        title: String(data.products.get(id)?.name ?? '').trim() || `#${id}`,
        subtitle: `#${id}`,
        disposition: draft.columns[String(id)]?.disposition === 'separate' ? 'separate' : 'include',
        dispositions: ['include', 'separate'],
      }))
    },

    rows(data, draft) {
      return buildPlan(data, draft, options).rows
    },

    blockers(data, draft) {
      const { ctx } = buildPlan(data, draft, options)
      const out: string[] = []
      if (ctx.included.length > MAX_GROUP) out.push(fill(tr(t, 'resolve_merge_max', 'Merge at most {n} records at a time.'), { n: MAX_GROUP }))
      if (ctx.included.length < 2) out.push(tr(t, 'resolve_merge_needs_two', 'Merge in at least two records.'))
      for (const id of ctx.merged) {
        const message = blockedMessage(ctx, id, t)
        if (message && !out.includes(message)) out.push(message)
      }
      return out
    },

    // The previews are read against the survivor and the group: only taking
    // a product in or out reads them again, never a field pick.
    reloadWhen(before, after) {
      return includedIds(ids, before).join(',') !== includedIds(ids, after).join(',')
    },

    async review(data, draft) {
      const { ctx, rows, choices, absorbed } = buildPlan(data, draft, options)
      const keepId = ctx.keeperId
      if (keepId === null || !ctx.merged.length) throw new Error(tr(t, 'resolve_merge_needs_two', 'Merge in at least two records.'))
      const name = (id: number) => productLabel(data.products.get(id), id)
      const steps = ctx.merged.map((id) => {
        const stock = stockAnswer(ctx, id)
        return { mergeId: id, name: name(id), ...(stock ? { stock } : {}) }
      })
      const cost = options.canViewCosts && options.canEditCosts && costPick(ctx, true).kind !== 'rule' ? chosenCost(ctx, true) : null

      const changes: ResolveChange[] = []
      for (const row of rows) {
        if (row.key === 'stock' || (row.key === 'name' && row.kind === 'computed')) continue
        const before = row.cells[String(keepId)]?.text ?? ''
        if (before === row.final.text) continue
        if (row.key === 'image') {
          const source = choices?.image && 'source_id' in choices.image ? choices.image.source_id : keepId
          changes.push({ label: row.label, before: before ? name(keepId) : '', after: row.final.text ? name(source) : '' })
        } else changes.push({ label: row.label, before, after: row.final.text })
      }
      const stock = stockPlan(ctx)
      const stockLabel = tr(t, 'stock', 'Stock')
      const pcs = tr(t, 'pcs', 'pcs')
      if (stock.before !== stock.after) changes.push({ label: stockLabel, before: `${stock.before} ${pcs}`, after: `${stock.after} ${pcs}` })
      for (const branch of stock.branches) {
        if (branch.before !== branch.after) changes.push({ label: `${stockLabel} · ${branch.name}`, before: `${branch.before} ${pcs}`, after: `${branch.after} ${pcs}` })
      }

      const warnings: string[] = []
      for (const id of ctx.merged) {
        if (stockAnswer(ctx, id) !== 'write_off') continue
        warnings.push(fill(tr(t, 'resolve_stock_write_off_warning', 'The stock of {name} ({quantity} pcs) will be written off.'), { name: name(id), quantity: data.previews.get(id)?.stockImpact.totalQuantity ?? 0 }))
      }
      const closing = new Set(ctx.merged.flatMap((id) => data.previews.get(id)?.closesStockSessions ?? []))
      if (closing.size) warnings.push(fill(tr(t, 'resolve_closes_stock_sessions', 'Undo closes for {n} stock-in session(s) that include these products.'), { n: closing.size }))
      if (absorbed.length) {
        const ownBarcode = String(data.products.get(keepId)?.barcode ?? '').trim()
        const finalBarcode = rows.find((row) => row.key === 'barcode')?.final.text ?? ''
        warnings.push(!ownBarcode || identityBarcodeKey(ownBarcode) === identityBarcodeKey(finalBarcode)
          ? fill(tr(t, 'resolve_barcodes_kept_warning', 'Barcodes {barcodes} stay on the merged records; the kept product keeps its own.'), { barcodes: absorbed.join(', ') })
          : `${tr(t, 'resolve_barcodes_kept_on_merged', 'Barcodes kept on the merged records')}: ${absorbed.join(', ')}`)
      }
      const finalName = rows.find((row) => row.key === 'name')?.final.text
      return {
        message: fill(tr(t, 'resolve_product_confirm', 'Merge {products} into {name}.'), { products: ctx.merged.map(name).join(', '), name: productLabel({ name: finalName }, keepId) }),
        changes,
        warnings,
        token: { keepId, steps, cost, choices, requestId: createClientRequestId('resolve'), reviewedDigest: data.reviewedDigest },
        undoable: true,
      }
    },

    async apply(token, _signal, onProgress) {
      if (!options.canMerge()) throw Object.assign(new Error(tr(t, 'access_denied', 'Access Denied')), { code: 'access_denied', outcome: 'not_applied' })
      const total = token.steps.length
      const state = progress.get(token) ?? { index: 0, keeper: null, absorbed: [] }
      for (let index = state.index; index < total; index += 1) {
        const step = token.steps[index]
        const keep: MergeKeep = {
          ...(token.cost ? { cost_price_usd: token.cost.cost_price_usd, cost_price_khr: token.cost.cost_price_khr ?? null } : {}),
          resolve: { requestId: token.requestId, reviewedDigest: token.reviewedDigest, steps: token.steps.map(({ mergeId, stock }) => ({ mergeId, ...(stock ? { stock } : {}) })) },
          ...(token.choices ? { choices: token.choices } : {}),
        }
        let response: { keeper?: Record<string, unknown> | null } | null
        try {
          response = await api.merge(token.keepId, step.mergeId, step.stock, keep) as typeof response
        } catch (error) {
          throw localizedRefusal(error, t, state.index > 0)
        }
        const keeper = response?.keeper && typeof response.keeper === 'object' ? response.keeper : null
        state.index = index + 1
        if (keeper) {
          state.keeper = keeper
          for (const barcode of Array.isArray(keeper.absorbed_barcodes) ? keeper.absorbed_barcodes : []) {
            if (!state.absorbed.includes(String(barcode))) state.absorbed.push(String(barcode))
          }
        }
        progress.set(token, state)
        options.onWritten?.()
        onProgress(state.index, total)
      }
      progress.delete(token)
      return { after: afterItems(state.keeper, token, state.absorbed), done: total, total }
    },

    isStale(error) {
      const code = (error as { code?: unknown } | null)?.code
      return typeof code === 'string' && STALE_CODES.has(code)
    },
  }
}

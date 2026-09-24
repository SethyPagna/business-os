import { getMergePreview, mergePossiblySameProducts } from '../../api/productWriteTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { identityBarcodeKey, isRealBarcode } from '../../utils/productDetailRule.ts'
import type { ProductConflictCluster, ProductConflictProduct } from '../../utils/selectedConflictMerge.ts'
import type { ResolveCell, ResolveColumn, ResolveOption, ResolveRow } from '../shared/ResolveGrid.tsx'
import type { ResolveAdapter, ResolveAfterItem, ResolveChange, ResolveDraft } from '../shared/ResolveModal.tsx'

// The products side of the one conflict resolver (owner asks N1, N3, N4 of
// 23 Sep 2026). A duplicate group opens in the shared ResolveModal with the
// product the reviewer marked Keep; Resolve merges every other included
// product into it, one server fold per product (POST .../possible-duplicates/
// merge with keep:true), each one in History with its own Undo, exactly like
// the pair merge it reuses.
//
// Rows:
//   Product kept  the reviewer's Keep; changing it reads the group again.
//   Name          N1: follows the kept product (locked).
//   Barcode       N1: the kept product's stored barcode; a kept product with
//                 none takes the first merged product's real barcode. Every
//                 other barcode stays on its merged record (named in the
//                 confirm and in the audit row) -- never a refusal.
//   Cost          N4: the merge rule's cost for the group (mean of distinct
//                 costs), a record's cost or a typed one. Hidden without cost
//                 view; locked without cost edit (the Worker enforces it too).
//   Selling       the highest selling price is kept (the merge rule).
//   Stock         per merged product with stock: Carry (onto the kept
//                 product, keeping lots and branches) or Write off.

type Translate = (key: string) => string | undefined

// resolveCellKey (ResolveGrid.tsx): the grid's key for a per-record choice.
// Written out here so this module loads without JSX (the node unit tests);
// tests/productResolveAdapter.test.ts pins the two against each other.
export const productCellKey = (rowKey: string, columnId: string): string => `${rowKey}|${columnId}`

type StockBranch = { branchId: number; branchName: string | null; quantity: number }
type StockImpact = { totalQuantity: number; branches: StockBranch[] }

export type ProductResolvePreview = {
  reviewedDigest: string
  groupProducts: ProductConflictProduct[]
  stockImpact: StockImpact
  needsStockChoice: boolean
  blocked: { code: string; operationId?: string } | null
  keeperStock: StockImpact | null
  groupCost: { cost_price_usd?: number; cost_price_khr?: number } | null
}

export type ProductResolveData = {
  reviewedDigest: string
  /** Every product of the group in id order: one grid column each. */
  ids: number[]
  products: Map<number, ProductConflictProduct>
  /** The kept product the previews were read against. */
  keeperId: number
  /** Per other product, read against keeperId. */
  previews: Map<number, ProductResolvePreview>
}

export type ProductResolveCost = { cost_price_usd: number; cost_price_khr?: number | null }

export type ProductResolveToken = {
  requestId: string
  reviewedDigest: string
  keepId: number
  steps: Array<{ mergeId: number; name: string; stock?: 'merge' | 'write_off' }>
  /** Sent only by a user with the cost edit permission. */
  cost: ProductResolveCost | null
}

export type ProductResolveApi = {
  preview: (keepId: number, mergeId: number, options: { keep: true; groupIds: number[]; signal?: AbortSignal }) => Promise<unknown>
  merge: (keepId: number, mergeId: number, stock: 'merge' | 'write_off' | undefined, keep: { cost_price_usd?: number; cost_price_khr?: number | null; resolve?: { requestId: string; reviewedDigest: string; steps: Array<{ mergeId: number; stock?: 'merge' | 'write_off' }> } }) => Promise<unknown>
}

export type ProductResolveOptions = {
  cluster: ProductConflictCluster
  /** The product the reviewer marked Keep on the card. */
  keeperId: number
  t: Translate
  canViewCosts: boolean
  canEditCosts: boolean
  /** Asked again right before writing: permissions can change while the grid is open. */
  canMerge: () => boolean
  /** A merge step committed: the host's list is out of date even if a later step fails. */
  onWritten?: () => void
  api?: ProductResolveApi
}

const DEFAULT_API: ProductResolveApi = {
  preview: (keepId, mergeId, options) => getMergePreview(keepId, mergeId, options),
  merge: (keepId, mergeId, stock, keep) => mergePossiblySameProducts(keepId, mergeId, stock, keep),
}

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

function productLabel(product: ProductConflictProduct | undefined, id: number): string {
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
    groupProducts: Array.isArray(raw.groupProducts) ? raw.groupProducts as ProductConflictProduct[] : [],
    stockImpact: readImpact(raw.stockImpact),
    needsStockChoice: Boolean(raw.needsStockChoice),
    blocked: blocked ? { code: String(blocked.code ?? ''), ...(blocked.operationId ? { operationId: String(blocked.operationId) } : {}) } : null,
    keeperStock: raw.keeperStock ? readImpact(raw.keeperStock) : null,
    groupCost: groupCost && 'cost_price_usd' in groupCost
      ? { cost_price_usd: Number(groupCost.cost_price_usd) || 0, cost_price_khr: Number(groupCost.cost_price_khr) || 0 }
      : null,
  }
}

/**
 * N1: the barcode the kept product ends with -- its own stored one; with none,
 * the first merged product's real barcode (the order the folds run in).
 * Mirrors keeperFollowsBarcode in cloudflare/src/lib/productIdentity.ts.
 */
export function finalProductBarcode(keeper: { barcode?: unknown } | undefined, merged: Array<{ barcode?: unknown }>): string {
  const own = String(keeper?.barcode ?? '')
  if (own.trim()) return own
  return String(merged.find((product) => isRealBarcode(product.barcode))?.barcode ?? '').trim()
}

/** The merged products' barcodes the kept product does not carry: they stay on their merged records. */
export function absorbedProductBarcodes(finalBarcode: string, merged: Array<{ barcode?: unknown }>): string[] {
  return merged
    .map((product) => String(product.barcode ?? '').trim())
    .filter((raw) => raw && !(finalBarcode.trim() && identityBarcodeKey(raw) === identityBarcodeKey(finalBarcode)))
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

function keeperOf(included: number[], draft: ResolveDraft, fallback: number): number | null {
  const picked = draft.selection.record
  const source = picked && 'source' in picked ? Number(picked.source) : Number.NaN
  if (included.includes(source)) return source
  if (included.includes(fallback)) return fallback
  return included[0] ?? null
}

function contextOf(data: ProductResolveData, draft: ResolveDraft): Context {
  const included = includedIds(data.ids, draft).filter((id) => data.products.has(id))
  const keeperId = keeperOf(included, draft, data.keeperId)
  return { data, draft, included, keeperId, merged: included.filter((id) => id !== keeperId) }
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
  const keeper = ctx.keeperId === null ? undefined : ctx.data.products.get(ctx.keeperId)
  return {
    cost_price_usd: Number(fromPreview?.cost_price_usd ?? keeper?.cost_price_usd ?? 0) || 0,
    cost_price_khr: Number(fromPreview?.cost_price_khr ?? keeper?.cost_price_khr ?? 0) || 0,
  }
}

function chosenCost(ctx: Context, canEdit: boolean): ProductResolveCost {
  const pick = costPick(ctx, canEdit)
  if (pick.kind === 'source') {
    const product = ctx.data.products.get(pick.id)
    return { cost_price_usd: Number(product?.cost_price_usd) || 0, cost_price_khr: product?.cost_price_khr == null ? null : Number(product.cost_price_khr) || 0 }
  }
  if (pick.kind === 'custom') return { cost_price_usd: pick.value }
  return ruleCost(ctx)
}

type BranchLine = { branchId: number; name: string; before: number; after: number }

function stockPlan(ctx: Context): { before: number; after: number; branches: BranchLine[] } {
  const keeperStock = ctx.merged.map((id) => ctx.data.previews.get(id)?.keeperStock).find(Boolean)
  const keeper = ctx.keeperId === null ? undefined : ctx.data.products.get(ctx.keeperId)
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
  return stockText(Number(ctx.data.products.get(id)?.stock_quantity) || 0, [], t)
}

function blockedMessage(ctx: Context, id: number, t: Translate): string | null {
  const blocked = ctx.data.previews.get(id)?.blocked
  if (!blocked?.code) return null
  const name = productLabel(ctx.data.products.get(id), id)
  if (blocked.code === 'stock_session_reversible') {
    return fill(tr(t, 'merge_stock_session_blocked', 'One of these products is still part of a stock-in session that can be undone ({id}). Merging now would break that Undo — undo it or let it settle first.'), { id: blocked.operationId ?? '' })
  }
  if (blocked.code === 'invalid_merge_numeric') {
    return fill(tr(t, 'resolve_product_numeric', '{name} has a price or cost that is not a valid number. Correct it, then resolve.'), { name })
  }
  if (blocked.code === 'product_merge_not_duplicates') {
    return fill(tr(t, 'resolve_product_not_listed', '{name} is no longer listed with the kept product. Refresh the Duplicates list.'), { name })
  }
  return null
}

// The Worker's refusals arrive in English; the ones this flow can meet are
// said in the operator's language. The code stays on the error (isStale reads it).
function localizedRefusal(error: unknown, t: Translate): unknown {
  const problem = error as { code?: unknown; operationId?: unknown } | null
  const code = typeof problem?.code === 'string' ? problem.code : ''
  const message = code === 'product_merge_not_duplicates'
    ? tr(t, 'selected_conflict_product_merge_not_duplicates', 'These products are not a current duplicate group. Refresh the Duplicates list and try again.')
    : code === 'cost_permission_required'
      ? tr(t, 'resolve_cost_locked', 'Changing the cost needs the cost edit permission.')
      : code === 'stock_session_reversible'
        ? fill(tr(t, 'merge_stock_session_blocked', 'One of these products is still part of a stock-in session that can be undone ({id}). Merging now would break that Undo — undo it or let it settle first.'), { id: String(problem?.operationId ?? '') })
        : ''
  return message ? Object.assign(new Error(message), { code }) : error
}

type Plan = { ctx: Context; rows: ResolveRow[]; finalBarcode: string; absorbed: string[] }

function buildPlan(data: ProductResolveData, draft: ResolveDraft, options: ProductResolveOptions): Plan {
  const { t, canViewCosts, canEditCosts } = options
  const ctx = contextOf(data, draft)
  const { included, keeperId } = ctx
  const product = (id: number) => data.products.get(id)
  const cells = (text: (id: number) => string, extra?: (id: number) => Partial<ResolveCell>): Record<string, ResolveCell> => (
    Object.fromEntries(data.ids.map((id) => [String(id), { text: text(id), ...(extra?.(id) ?? {}) }]))
  )
  const identical = (row: Record<string, ResolveCell>, finalText: string): boolean => included.every((id) => (row[String(id)]?.text ?? '') === finalText)
  const followsKept = tr(t, 'resolve_follows_kept', 'Follows the kept product')
  const keeper = keeperId === null ? undefined : product(keeperId)
  const mergedProducts = ctx.merged.map((id) => product(id)).filter((entry): entry is ProductConflictProduct => Boolean(entry))

  const rows: ResolveRow[] = [{
    key: 'record',
    label: tr(t, 'resolve_product_kept', 'Product kept'),
    hint: tr(t, 'resolve_product_kept_hint', 'This product stays. The others fold into it: stock, received-date records, photos, sales and returns move onto it, and each merge can be undone from History.'),
    kind: 'choice',
    cells: cells((id) => `#${id}`),
    final: { text: keeperId === null ? '' : `#${keeperId}` },
    ...(keeperId === null ? {} : { choice: { source: String(keeperId) } }),
    identical: false,
  }]

  const nameRow = cells((id) => String(product(id)?.name ?? ''))
  const finalName = String(keeper?.name ?? '')
  // Computed rows cannot be picked: the reason rides in the hint (one icon,
  // so the label column stays readable on a phone).
  rows.push({ key: 'name', label: tr(t, 'name', 'Name'), hint: followsKept, kind: 'computed', cells: nameRow, final: { text: finalName }, identical: identical(nameRow, finalName), copyable: true })

  const finalBarcode = finalProductBarcode(keeper, mergedProducts)
  const absorbed = absorbedProductBarcodes(finalBarcode, mergedProducts)
  const barcodeRow = cells((id) => String(product(id)?.barcode ?? '').trim())
  rows.push({
    key: 'barcode',
    label: tr(t, 'barcode', 'Barcode'),
    hint: tr(t, 'resolve_product_barcode_hint', 'The kept product keeps its barcode. If it has none it takes the merged product\'s. The other barcodes stay on the merged records, so their history keeps them.'),
    kind: 'computed',
    cells: barcodeRow,
    final: { text: finalBarcode.trim() },
    identical: identical(barcodeRow, finalBarcode.trim()),
    copyable: true,
  })

  if (canViewCosts) {
    const pick = costPick(ctx, canEditCosts)
    const cost = chosenCost(ctx, canEditCosts)
    const costRow = cells((id) => formatProductMoney(product(id)?.cost_price_usd))
    const finalText = formatProductMoney(cost.cost_price_usd)
    const ruleOption: ResolveOption = { id: 'rule', label: tr(t, 'resolve_cost_rule', 'Average of the costs') }
    rows.push({
      key: 'cost',
      label: tr(t, 'cost', 'Cost'),
      hint: tr(t, 'resolve_cost_hint', 'By default the kept product takes the average of the different costs (a zero cost is not a cost). You can pick one product\'s cost or type one.'),
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

  const sellingRow = cells((id) => formatProductMoney(product(id)?.selling_price_usd))
  const selling = Math.max(0, ...included.map((id) => Number(product(id)?.selling_price_usd) || 0))
  const sellingText = formatProductMoney(selling)
  rows.push({
    key: 'selling',
    label: tr(t, 'selling_price', 'Selling price'),
    hint: tr(t, 'resolve_selling_hint', 'The highest selling price is kept.'),
    kind: 'computed',
    cells: sellingRow,
    final: { text: sellingText },
    identical: identical(sellingRow, sellingText),
  })

  const stockOptions: ResolveOption[] = [
    { id: 'merge', label: tr(t, 'resolve_stock_carry', 'Carry') },
    { id: 'write_off', label: tr(t, 'resolve_stock_write_off', 'Write off') },
  ]
  const stockRow = cells((id) => productStockText(ctx, id, t), (id) => {
    if (id === keeperId || !ctx.merged.includes(id) || !data.previews.get(id)?.needsStockChoice) return {}
    return { options: stockOptions, choice: stockAnswer(ctx, id) }
  })
  const stock = stockPlan(ctx)
  const stockFinal = stockText(stock.after, stock.branches.map((branch) => ({ name: branch.name, quantity: branch.after })), t)
  rows.push({
    key: 'stock',
    label: tr(t, 'stock', 'Stock'),
    hint: tr(t, 'resolve_stock_hint', 'Carry moves a product\'s stock onto the kept product, keeping its received dates and branches. Write off clears it with a ledger entry.'),
    kind: 'computed',
    cells: stockRow,
    final: { text: stockFinal },
    identical: false,
  })

  return { ctx, rows, finalBarcode: finalBarcode.trim(), absorbed }
}

export function createProductResolveAdapter(options: ProductResolveOptions): ResolveAdapter<ProductResolveData, ProductResolveToken> {
  const { cluster, t } = options
  const api = options.api ?? DEFAULT_API
  const listedProducts = new Map(cluster.products.map((product) => [Number(product.id), product]))
  const ids = [...listedProducts.keys()].sort((a, b) => a - b)
  // A merge that stopped part way resumes from the step that did not answer.
  const progress = new WeakMap<ProductResolveToken, { index: number; keeper: Record<string, unknown> | null; absorbed: string[] }>()

  const afterItems = (keeper: Record<string, unknown> | null, token: ProductResolveToken, absorbed: string[]): ResolveAfterItem[] => {
    const items: ResolveAfterItem[] = [{ label: tr(t, 'resolve_product_kept', 'Product kept'), value: productLabel({ id: token.keepId, name: keeper?.name == null ? null : String(keeper.name) } as ProductConflictProduct, token.keepId) }]
    if (keeper) {
      items.push({ label: tr(t, 'barcode', 'Barcode'), value: String(keeper.barcode ?? '') })
      if ('cost_price_usd' in keeper && options.canViewCosts) items.push({ label: tr(t, 'cost', 'Cost'), value: formatProductMoney(keeper.cost_price_usd) })
      items.push({ label: tr(t, 'selling_price', 'Selling price'), value: formatProductMoney(keeper.selling_price_usd) })
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
      const keeperId = keeperOf(included, edits, options.keeperId) ?? options.keeperId
      const groupIds = included.includes(keeperId) ? included : [keeperId, ...included]
      if (groupIds.length > 12) return { ids, products: new Map(listedProducts), keeperId, previews: new Map(), reviewedDigest: '' }
      const others = included.filter((id) => id !== keeperId)
      const answers = await Promise.all(others.map((id) => api.preview(keeperId, id, { keep: true, groupIds, signal })))
      const previews = new Map(others.map((id, index) => [id, readPreview(answers[index])]))
      const first = previews.values().next().value as ProductResolvePreview | undefined
      if ([...previews.values()].some((preview) => preview.reviewedDigest !== first?.reviewedDigest)) {
        throw Object.assign(new Error(tr(t, 'resolve_stale_banner', 'These records changed. Reload and review again.')), { code: 'merge_state_conflict' })
      }
      const products = new Map(listedProducts)
      for (const product of first?.groupProducts ?? []) products.set(Number(product.id), product)
      return { ids, products, keeperId, previews, reviewedDigest: first?.reviewedDigest ?? '' }
    },

    initialSelection() {
      return { selection: {}, columns: {} }
    },

    columns(data, draft): ResolveColumn[] {
      const { keeperId } = contextOf(data, draft)
      return data.ids.map((id) => {
        const product = data.products.get(id)
        const kept = id === keeperId
        return {
          id: String(id),
          title: String(product?.name ?? '').trim() || `#${id}`,
          subtitle: kept ? `#${id} · ${tr(t, 'resolve_product_kept', 'Product kept')}` : `#${id}`,
          disposition: draft.columns[String(id)]?.disposition === 'separate' ? 'separate' : 'include',
          dispositions: ['include', 'separate'],
        }
      })
    },

    rows(data, draft) {
      return buildPlan(data, draft, options).rows
    },

    blockers(data, draft) {
      const { ctx } = buildPlan(data, draft, options)
      const out: string[] = []
      if (ctx.included.length > 12) out.push(fill(tr(t, 'resolve_merge_max', 'Merge at most {n} records at a time.'), { n: 12 }))
      if (ctx.included.length < 2) out.push(tr(t, 'resolve_merge_needs_two', 'Merge in at least two records.'))
      for (const id of ctx.merged) {
        const message = blockedMessage(ctx, id, t)
        if (message && !out.includes(message)) out.push(message)
      }
      return out
    },

    // The previews are read against one kept product and one group: a new
    // Keep or a product taken in or out reads them again.
    reloadWhen(before, after) {
      const keeperBefore = keeperOf(includedIds(ids, before), before, options.keeperId)
      const keeperAfter = keeperOf(includedIds(ids, after), after, options.keeperId)
      return keeperBefore !== keeperAfter || includedIds(ids, before).join(',') !== includedIds(ids, after).join(',')
    },

    async review(data, draft) {
      const { ctx, rows, absorbed } = buildPlan(data, draft, options)
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
        if (row.key === 'record' || row.key === 'name' || row.key === 'stock') continue
        const before = row.cells[String(keepId)]?.text ?? ''
        if (before !== row.final.text) changes.push({ label: row.label, before, after: row.final.text })
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
      if (absorbed.length) {
        warnings.push(fill(tr(t, 'resolve_barcodes_kept_warning', 'Barcodes {barcodes} stay on the merged records; the kept product keeps its own.'), { barcodes: absorbed.join(', ') }))
      }
      return {
        message: fill(tr(t, 'resolve_product_confirm', 'Merge {products} into {name}.'), { products: ctx.merged.map(name).join(', '), name: name(keepId) }),
        changes,
        warnings,
        token: { keepId, steps, cost, requestId: createClientRequestId('resolve'), reviewedDigest: data.reviewedDigest },
        undoable: true,
      }
    },

    async apply(token, _signal, onProgress) {
      if (!options.canMerge()) throw new Error(tr(t, 'access_denied', 'Access Denied'))
      const total = token.steps.length
      const state = progress.get(token) ?? { index: 0, keeper: null, absorbed: [] }
      for (let index = state.index; index < total; index += 1) {
        const step = token.steps[index]
        const keep = {
          ...(token.cost ? { cost_price_usd: token.cost.cost_price_usd, cost_price_khr: token.cost.cost_price_khr ?? null } : {}),
          resolve: { requestId: token.requestId, reviewedDigest: token.reviewedDigest, steps: token.steps.map(({ mergeId, stock }) => ({ mergeId, ...(stock ? { stock } : {}) })) },
        }
        let response: { keeper?: Record<string, unknown> | null } | null
        try {
          response = await api.merge(token.keepId, step.mergeId, step.stock, keep) as typeof response
        } catch (error) {
          throw localizedRefusal(error, t)
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

import { divideMoney4, multiplyMoney4, percentageMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4, sumMoney4 } from './moneyPrecision'
import { evaluateCartPromotionAdjustments, type PromotionRule } from './promotionRules'

/** Pure server-owned capture evaluator. Routes must supply authorized captured
 * rows and guard those rows/rule membership in their mutation transaction.
 * This is deliberately not an admission parser for client snapshot JSON. */
export const SALE_ITEM_PRICING_VERSION = 1
export const MAX_PRICING_LINES = 200
export const MAX_PRICING_RULES = 100
export const MAX_PRICING_UNITS = 10_000
export const MAX_PRICING_SNAPSHOT_BYTES = 128_000

export type PricingSource = 'selling' | 'wholesale' | 'promotion' | 'manual'
export type ManualPricing = { type: 'none' | 'fixed' | 'percent'; value: number }
export type CapturedPricingLine = {
  line_key: string
  source: PricingSource
  product: Record<string, unknown>
  selling_price_input_usd: number | null
  manual: ManualPricing
}
export type CapturedPricingPool = {
  version: 1
  pool_key: string
  evaluation_time: string
  exchange_rate: number
  rules: PromotionRule[]
  lines: CapturedPricingLine[]
}
export type ExactLinePricing = {
  gross_usd: number
  product_discount_usd: number
  manual_discount_usd: number
  total_usd: number
  total_khr: number
  base_price_usd: number
  applied_price_usd: number
  base_price_khr: number
  applied_price_khr: number
  rule_id: number | null
}
export type SaleItemPricingSnapshot = {
  version: 1
  line_key: string
  pool: CapturedPricingPool
  quantities: Record<string, number>
  amounts: ExactLinePricing
  allocation_context: ReceiptAllocationContext
  receipt_allocation: ReceiptLineAllocation
}
export type ReceiptAllocationContext = {version:1;lines:{line_key:string;amount:number}[];discount_usd:number;membership_discount_usd:number;tax_usd:number}
export type ReceiptLineAllocation = {discount_usd:number;membership_discount_usd:number;tax_usd:number;net_entitlement_usd:number}

/** Persist only evaluator inputs. Full SELECT * rows belong exclusively to the
 * transaction guard, never to cashier-visible pricing response snapshots. */
export function capturePricingProduct(row: Record<string,unknown>): Record<string,unknown> {
  const fields=['id','category','categories','brand','brands','selling_price_usd','selling_price_khr','wholesale_price_usd',
    'discount_enabled','discount_type','discount_percent','discount_amount_usd','discount_amount_khr','discount_starts_at','discount_ends_at',
    'discount_label','discount_badge_color']
  return Object.fromEntries(fields.filter(field=>Object.prototype.hasOwnProperty.call(row,field)).map(field=>[field,row[field]]))
}

function invalid(): never { throw new Error('sale_item_pricing_invalid') }
function key(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) invalid()
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid()
  roundMoney4(value)
  return value
}
function canonical(value: unknown): number {
  const number = nonnegative(value)
  if (roundMoney4(number) !== number) invalid()
  return number
}
function canonicalUsdProduct(line: CapturedPricingLine, rate: number): Record<string, unknown> {
  const product = { ...line.product }
  const original = line.source === 'wholesale' ? product.wholesale_price_usd : product.selling_price_usd
  const selling = line.selling_price_input_usd == null
    ? canonical(original) : sellingPriceCeilCent(nonnegative(line.selling_price_input_usd))
  // Captured historical catalogue values are never silently ceiling-normalized.
  // The evaluator currently ceilings its fresh base; refuse ambiguous >cent bases.
  if (sellingPriceCeilCent(selling) !== selling) invalid()
  product.selling_price_usd = selling
  product.selling_price_khr = multiplyMoney4(selling, rate)
  if (line.source !== 'promotion') product.discount_enabled = false
  const fixed = nonnegative(product.discount_amount_usd ?? 0)
  const fixedKhr = nonnegative(product.discount_amount_khr ?? 0)
  product.discount_amount_usd = fixed || (fixedKhr ? divideMoney4(fixedKhr, rate) : 0)
  product.discount_amount_khr = multiplyMoney4(Number(product.discount_amount_usd), rate)
  nonnegative(product.discount_percent ?? 0)
  return product
}

/** Quantities are not money-rounded. Work is bounded before the promotion
 * evaluator expands whole units for next-item allocation. Stable key sorting
 * makes equal-price allocation independent of request/DB row ordering. */
export function evaluateCapturedPricingPool(pool: CapturedPricingPool, quantities: Record<string, number>): Map<string, ExactLinePricing> {
  if (new TextEncoder().encode(JSON.stringify({pool,quantities})).length > MAX_PRICING_SNAPSHOT_BYTES) invalid()
  if (!pool || pool.version !== 1 || !Array.isArray(pool.lines) || !Array.isArray(pool.rules)
    || pool.lines.length < 1 || pool.lines.length > MAX_PRICING_LINES || pool.rules.length > MAX_PRICING_RULES) invalid()
  key(pool.pool_key)
  if (typeof pool.evaluation_time !== 'string' || !Number.isFinite(Date.parse(pool.evaluation_time))) invalid()
  if (typeof pool.exchange_rate !== 'number' || !Number.isFinite(pool.exchange_rate) || pool.exchange_rate <= 0) invalid()
  const rate = pool.exchange_rate
  const lines = [...pool.lines].sort((a,b) => a.line_key < b.line_key ? -1 : a.line_key > b.line_key ? 1 : 0)
  const seen = new Set<string>()
  let units = 0
  const prepared = lines.map(line => {
    key(line.line_key)
    if (seen.has(line.line_key) || !['selling','wholesale','promotion','manual'].includes(line.source)) invalid()
    seen.add(line.line_key)
    if (!line.product || typeof line.product !== 'object' || !Number.isSafeInteger(line.product.id) || Number(line.product.id) <= 0) invalid()
    const quantity = quantities[line.line_key]
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_PRICING_UNITS) invalid()
    units += Math.ceil(quantity)
    if (units > MAX_PRICING_UNITS) invalid()
    if (!line.manual || !['none','fixed','percent'].includes(line.manual.type)) invalid()
    nonnegative(line.manual.value)
    if (line.manual.type === 'fixed') canonical(line.manual.value)
    if ((line.manual.type === 'none' && line.manual.value !== 0) || (line.manual.type === 'percent' && line.manual.value > 100)) invalid()
    return { line_id: line.line_key, product: canonicalUsdProduct(line,rate), quantity }
  })
  if (Object.keys(quantities).length !== seen.size || Object.keys(quantities).some(k => !seen.has(k))) invalid()
  const ruleIds = new Set<number>()
  const rules = pool.rules.map(rule => {
    if (!Number.isSafeInteger(rule.id) || rule.id <= 0 || ruleIds.has(rule.id)) invalid()
    ruleIds.add(rule.id)
    if (!['quantity_save','percent_off','fixed_off','spend_save','quantity_percent','next_item'].includes(rule.rule_type)
      || !['products','category','brand'].includes(rule.scope_type) || typeof rule.is_active !== 'boolean') invalid()
    for (const value of [rule.save_usd,rule.save_khr,rule.min_spend_usd,rule.min_spend_khr,rule.min_quantity,rule.percent_off]) nonnegative(value)
    if (rule.percent_off > 100 || rule.min_quantity > MAX_PRICING_UNITS || !Array.isArray(rule.product_ids) || rule.product_ids.length > 10_000) invalid()
    const save = rule.save_usd || (rule.save_khr ? divideMoney4(rule.save_khr,rate) : 0)
    const spend = rule.min_spend_usd || (rule.min_spend_khr ? divideMoney4(rule.min_spend_khr,rate) : 0)
    return { ...rule, save_usd:save, save_khr:multiplyMoney4(save,rate), min_spend_usd:spend, min_spend_khr:multiplyMoney4(spend,rate) }
  })
  const promotions = evaluateCartPromotionAdjustments(prepared.filter((_,i) => lines[i].source === 'promotion'),rules,rate,pool.evaluation_time,1)
  const result = new Map<string, ExactLinePricing>()
  prepared.forEach((line,i) => {
    const gross = multiplyMoney4(Number(line.product.selling_price_usd),line.quantity)
    const promo = promotions.get(line.line_id)
    const productDiscount = Math.min(gross,canonical(promo?.line_discount_usd ?? 0))
    const afterProduct = subtractMoney4(gross,productDiscount)
    const manual = lines[i].manual
    const manualDiscount = Math.min(afterProduct, manual.type === 'fixed'
      ? multiplyMoney4(manual.value,line.quantity) : manual.type === 'percent' ? percentageMoney4(afterProduct,manual.value) : 0)
    const total = subtractMoney4(afterProduct,manualDiscount)
    const base = divideMoney4(afterProduct,line.quantity), applied = divideMoney4(total,line.quantity)
    result.set(line.line_id,{ gross_usd:gross, product_discount_usd:productDiscount, manual_discount_usd:manualDiscount,
      total_usd:total,total_khr:multiplyMoney4(total,rate),base_price_usd:base,applied_price_usd:applied,
      base_price_khr:multiplyMoney4(base,rate),applied_price_khr:multiplyMoney4(applied,rate),rule_id:promo?.rule_id ?? null })
  })
  return result
}

export function serializeSaleItemPricing(pool: CapturedPricingPool, quantities: Record<string,number>, lineKey: string, allocation: ReceiptAllocationContext): string {
  const amounts = evaluateCapturedPricingPool(pool,quantities).get(lineKey)
  if (!amounts) invalid()
  const receiptAllocation=allocateReceiptLines(allocation).get(lineKey)
  if (!receiptAllocation || allocation.lines.find(line=>line.line_key===lineKey)?.amount!==amounts.total_usd) invalid()
  const json = JSON.stringify({version:1,line_key:lineKey,pool,quantities,amounts,allocation_context:allocation,receipt_allocation:receiptAllocation} satisfies SaleItemPricingSnapshot)
  if (new TextEncoder().encode(json).length > MAX_PRICING_SNAPSHOT_BYTES) invalid()
  return json
}

/** Call only for trusted persisted snapshots, never client-provided authority. */
export function parseSaleItemPricing(json: string | null | undefined): SaleItemPricingSnapshot | null {
  if (json == null) return null
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_PRICING_SNAPSHOT_BYTES) invalid()
  let value: SaleItemPricingSnapshot
  try { value = JSON.parse(json) } catch { return invalid() }
  if (value?.version !== 1) invalid()
  const evaluated = evaluateCapturedPricingPool(value.pool,value.quantities).get(value.line_key)
  if (!evaluated || !value.amounts || Object.keys(evaluated).some(k => evaluated[k as keyof ExactLinePricing] !== value.amounts[k as keyof ExactLinePricing])) invalid()
  const allocated=allocateReceiptLines(value.allocation_context).get(value.line_key)
  if (!allocated || !value.receipt_allocation || value.allocation_context.lines.find(line=>line.line_key===value.line_key)?.amount!==evaluated.total_usd
    || Object.keys(allocated).some(k=>allocated[k as keyof ReceiptLineAllocation]!==value.receipt_allocation[k as keyof ReceiptLineAllocation])) invalid()
  return value
}

/** Exact largest-remainder allocation at the four-place integer scale.
 * The supplied total is a captured canonical amount, not a new pricing input. */
export function allocateLineMoney4(total: number, weights: readonly { line_key:string; amount:number }[]): Map<string,number> {
  canonical(total)
  if (!weights.length || weights.length > MAX_PRICING_LINES) invalid()
  const seen = new Set<string>()
  const scale = (amount:number) => BigInt(amount.toFixed(4).replace('.',''))
  const rows = weights.map(row => {
    key(row.line_key); canonical(row.amount)
    if (seen.has(row.line_key)) invalid()
    seen.add(row.line_key)
    return {key:row.line_key,weight:scale(row.amount),units:0n,remainder:0n}
  })
  const denominator = rows.reduce((sum,row) => sum+row.weight,0n), units=scale(total)
  if (!denominator && units) invalid()
  if (denominator) for (const row of rows) { const value=units*row.weight; row.units=value/denominator; row.remainder=value%denominator }
  let left=units-rows.reduce((sum,row) => sum+row.units,0n)
  rows.sort((a,b) => a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  for (const row of rows) if (left > 0n) { row.units++; left-- }
  const result = new Map(rows.map(row => [row.key,roundMoney4(`${row.units/10000n}.${(row.units%10000n).toString().padStart(4,'0')}`)]))
  if (sumMoney4([...result.values()]) !== total || left !== 0n) invalid()
  return result
}

export function allocateReceiptLines(context: ReceiptAllocationContext): Map<string,ReceiptLineAllocation> {
  if (!context || context.version!==1 || !Array.isArray(context.lines)) invalid()
  const original=sumMoney4(context.lines.map(line=>canonical(line.amount)))
  const discount=canonical(context.discount_usd), member=canonical(context.membership_discount_usd), tax=canonical(context.tax_usd)
  if (discount>original) invalid()
  const discounts=allocateLineMoney4(discount,context.lines)
  const afterStore=context.lines.map(line=>({line_key:line.line_key,amount:subtractMoney4(line.amount,discounts.get(line.line_key)!)}))
  if (member>sumMoney4(afterStore.map(line=>line.amount))) invalid()
  const memberships=allocateLineMoney4(member,afterStore)
  const afterMember=afterStore.map(line=>({line_key:line.line_key,amount:subtractMoney4(line.amount,memberships.get(line.line_key)!)}))
  const taxes=allocateLineMoney4(tax,afterMember)
  return new Map(afterMember.map(line=>[line.line_key,{discount_usd:discounts.get(line.line_key)!,membership_discount_usd:memberships.get(line.line_key)!,
    tax_usd:taxes.get(line.line_key)!,net_entitlement_usd:sumMoney4([line.amount,taxes.get(line.line_key)!])}]))
}

/** Guard the exact authorized SELECT * capture, including newly inserted active
 * rules. Execute in the same batch BEFORE any sale/stock/audit mutation. The
 * caller must read all active rules (not just the winner or currently in-window
 * rules); omission would make a newly applicable discount invisible. */
export function pricingSourceGuard(products: readonly Record<string,unknown>[], activeRules: readonly Record<string,unknown>[]): {sql:string;params:Record<string,unknown>} {
  if (!products.length || products.length > MAX_PRICING_LINES || activeRules.length > MAX_PRICING_RULES) invalid()
  if (activeRules.some(row => row.is_active !== 1)) invalid()
  const make = (rows:readonly Record<string,unknown>[],table:string,param:string) => {
    if (!rows.length) return '0'
    const keys=Object.keys(rows[0]).sort(), ids=new Set<number>()
    if (!keys.includes('id') || keys.some(name => !/^[a-z][a-z0-9_]*$/.test(name))) invalid()
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || Number(row.id)<=0 || ids.has(Number(row.id))
        || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(keys)) invalid()
      ids.add(Number(row.id))
    }
    return `EXISTS (SELECT 1 FROM json_each(@${param}) expected LEFT JOIN ${table} current ON current.id=json_extract(expected.value,'$.id') WHERE current.id IS NULL OR ${keys.map(name => `current.${name} IS NOT json_extract(expected.value,'$.${name}')`).join(' OR ')})`
  }
  const productConflict=make(products,'products','pricing_products'), ruleConflict=make(activeRules,'promotion_rules','pricing_rules')
  const params={pricing_products:JSON.stringify(products),pricing_rules:JSON.stringify(activeRules),pricing_rule_count:activeRules.length}
  if (new TextEncoder().encode(params.pricing_products+params.pricing_rules).length>512_000) invalid()
  return {sql:`SELECT CASE WHEN ${productConflict} OR ${ruleConflict} OR (SELECT COUNT(*) FROM promotion_rules WHERE is_active=1)<>@pricing_rule_count THEN json_extract('sale_pricing_source_conflict','$') ELSE 1 END`,params}
}

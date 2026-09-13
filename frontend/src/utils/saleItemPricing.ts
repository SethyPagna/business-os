import { divideMoney4, multiplyMoney4, percentageMoney4, roundMoney4, sellingPriceCeilCent, subtractMoney4, sumMoney4 } from './moneyPrecision.ts'
import { evaluateCartPromotionAdjustments, type PromotionRule } from './promotionRules.ts'

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
  display_price_mode?: 'selling'|'wholesale'
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

export class SaleItemPricingError extends Error {
  readonly code='sale_item_pricing_invalid'
  constructor() { super('Captured item pricing needs review.'); this.name='SaleItemPricingError' }
}
function invalid(): never { throw new SaleItemPricingError() }
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
    if (Object.prototype.hasOwnProperty.call(line,'display_price_mode')&&!['selling','wholesale'].includes(line.display_price_mode as string)) invalid()
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

/** A v1 parent never permits a partial/mixed snapshot cohort. This validates
 * saved line identity, quantities, pool membership and receipt inputs together,
 * not merely a self-consistent JSON document detached from its owning row. */
export function capturedPricingMetadata(pool:CapturedPricingPool,lineKey:string,amounts:ExactLinePricing): {price_mode:PricingSource;product_discount_type:string|null;product_discount_label:string|null} {
  const capture=pool.lines.find(line=>line.line_key===lineKey)
  if (!capture) invalid()
  if (amounts.product_discount_usd===0) return {price_mode:capture.source,product_discount_type:null,product_discount_label:null}
  if (capture.source!=='promotion') invalid()
  const rule=amounts.rule_id===null?null:pool.rules.find(rule=>rule.id===amounts.rule_id)
  if (amounts.rule_id!==null && !rule) invalid()
  const type=rule?.rule_type ?? (String(capture.product.discount_type||'percent').toLowerCase()==='fixed'?'fixed':'percent')
  const label=String(rule?.title ?? capture.product.discount_label ?? '').trim() || null
  return {price_mode:capture.source,product_discount_type:type,product_discount_label:label}
}

/** A presentation tag is never an input to pricing, discount or pool rules. */
export function capturedDisplayPriceMode(snapshot:SaleItemPricingSnapshot):PricingSource {
  const line=snapshot.pool.lines.find(line=>line.line_key===snapshot.line_key)
  if(!line)invalid()
  return line.display_price_mode??line.source
}

export type CapturedProductIdentityBinding={sale_id:number;sale_item_id:number;captured_product_id:number;current_product_id:number}
export function validateCapturedSaleBasket(lines: readonly Record<string,unknown>[], header: Record<string,unknown>, identityBindings:readonly CapturedProductIdentityBinding[]=[]): SaleItemPricingSnapshot[] {
  if (!lines.length || lines.length>MAX_PRICING_LINES) invalid()
  const snapshots=lines.map(line=>{
    const snapshot=parseSaleItemPricing(line.pricing_snapshot_json as string|null)
    if (!snapshot || snapshot.pool.exchange_rate!==header.exchange_rate) invalid()
    const capture=snapshot.pool.lines.find(row=>row.line_key===snapshot.line_key)
    const binding=identityBindings.filter(binding=>binding.sale_item_id===line.id&&binding.sale_id===header.id
      &&binding.sale_id===line.sale_id&&binding.captured_product_id===capture?.product.id&&binding.current_product_id===line.product_id)
    if (!capture || (capture.product.id!==line.product_id&&binding.length!==1) || snapshot.quantities[snapshot.line_key]!==line.quantity) invalid()
    for (const [key,value] of Object.entries(capturedPricingMetadata(snapshot.pool,snapshot.line_key,snapshot.amounts)))
      if ((line[key]??null)!==value) invalid()
    for (const field of ['total_usd','total_khr','base_price_usd','base_price_khr','applied_price_usd','applied_price_khr'] as const)
      if (line[field]!==snapshot.amounts[field]) invalid()
    if ((line.manual_discount_type ?? 'none')!==capture.manual.type || line.manual_discount_value!==capture.manual.value) invalid()
    for (const [field,amount] of [['product_discount_usd',snapshot.amounts.product_discount_usd],['manual_discount_usd',snapshot.amounts.manual_discount_usd]] as const) {
      const unit=divideMoney4(amount,Number(line.quantity))
      if (line[field]!==unit || line[field.replace('_usd','_khr')]!==multiplyMoney4(unit,snapshot.pool.exchange_rate)) invalid()
    }
    return snapshot
  })
  const byKey=new Map(snapshots.map(snapshot=>[snapshot.line_key,snapshot]))
  if (byKey.size!==snapshots.length) invalid()
  const allocation=snapshots[0].allocation_context
  if (allocation.discount_usd!==header.discount_usd || allocation.membership_discount_usd!==header.membership_discount_usd || allocation.tax_usd!==header.tax_usd
    || allocation.lines.length!==lines.length) invalid()
  for (const entry of allocation.lines) if (byKey.get(entry.line_key)?.amounts.total_usd!==entry.amount) invalid()
  const poolContexts=new Map<string,string>()
  for (const snapshot of snapshots) {
    const context=JSON.stringify({pool:snapshot.pool,quantities:snapshot.quantities})
    if (poolContexts.has(snapshot.pool.pool_key) && poolContexts.get(snapshot.pool.pool_key)!==context) invalid()
    poolContexts.set(snapshot.pool.pool_key,context)
    if (JSON.stringify(snapshot.allocation_context)!==JSON.stringify(allocation)) invalid()
    for (const member of snapshot.pool.lines) {
      const other=byKey.get(member.line_key)
      if (!other || JSON.stringify(other.pool)!==JSON.stringify(snapshot.pool) || JSON.stringify(other.quantities)!==JSON.stringify(snapshot.quantities)) invalid()
    }
  }
  if (sumMoney4(snapshots.map(snapshot=>snapshot.amounts.total_usd))!==header.subtotal_usd) invalid()
  return snapshots
}

export function materializeCapturedPricingRow(row: Record<string,unknown>, pool: CapturedPricingPool, quantities: Record<string,number>, lineKey:string, allocation:ReceiptAllocationContext): Record<string,unknown> {
  const json=serializeSaleItemPricing(pool,quantities,lineKey,allocation), snapshot=parseSaleItemPricing(json)!
  const capture=pool.lines.find(line=>line.line_key===lineKey)!, amounts=snapshot.amounts, quantity=quantities[lineKey]
  const productDiscount=divideMoney4(amounts.product_discount_usd,quantity), manualDiscount=divideMoney4(amounts.manual_discount_usd,quantity)
  return {...row,...capturedPricingMetadata(pool,lineKey,amounts),quantity,pricing_snapshot_json:json,
    applied_price_usd:amounts.applied_price_usd,applied_price_khr:amounts.applied_price_khr,
    base_price_usd:amounts.base_price_usd,base_price_khr:amounts.base_price_khr,total_usd:amounts.total_usd,total_khr:amounts.total_khr,
    product_discount_usd:productDiscount,product_discount_khr:multiplyMoney4(productDiscount,pool.exchange_rate),
    manual_discount_usd:manualDiscount,manual_discount_khr:multiplyMoney4(manualDiscount,pool.exchange_rate),
    manual_discount_type:capture.manual.type==='none'?null:capture.manual.type,manual_discount_value:capture.manual.value,price_mode:capture.source}
}

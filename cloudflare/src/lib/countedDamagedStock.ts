import { MAX_MONEY_SUM_ITEMS, MoneyPrecisionError, subtractDecimalSum } from './moneyPrecision'

type StockWriteStatement = { sql: string; params: Record<string, unknown> }

export type CountedTaggedIdentity = { lotId: number; productId: number; branchId: number; batchId: number | null }
export type CountedCreatedReceipt = Readonly<{ productId: number; branchId: number; batchKey: string; batchId: number }>
export type CountedProductCreation = { productId: number; name: string; costUsd: number | null; costKhr: number | null; observed: string }

const MAX_COUNTED_ROWS = 10_000
type ProductFacts = [number, number, number, number | null, number | null, string]
type BranchFacts = [number, number, string, string]
type ReceiptFacts = [number, number, number | null, number | null, number | null, string | null, string | null, string, number | string | null, string | null, number | null, number]
type TagFacts = [number, number | null, number, number, string, string | null, number | null, number | null, number | null, string | null]
type CountedFacts = { product: ProductFacts; branch: BranchFacts | null; branches: [number, number][]; receipts: ReceiptFacts[]; tags: TagFacts[] }
type SharedCountedProjection = { product: ProductFacts; branches: [number, number][] }
type CountedBatchBinding = { products: Map<number, SharedCountedProjection>; receipts: Map<number, ReceiptFacts[]>; guards: () => StockWriteStatement[]; physical?: (key: string, statement: StockWriteStatement, creates: boolean) => void }

function losslessNumberSql(expression: string): string {
  return `CASE WHEN typeof(${expression})='real' THEN json(printf('%!.26g',${expression})) ELSE ${expression} END`
}

/** Add to an existing facts SELECT; every capacity term and metadata preimage
 * is bounded and returned individually, never as a floating SQL sum. */
export function countedStockFactsSql(product: string, branch: string, additionalReceiptIds: string = "'[]'"): string {
  return `(SELECT json_object(
    'product',json_array(counted_product.id,${losslessNumberSql('counted_product.is_active')},${losslessNumberSql('counted_product.stock_quantity')},${losslessNumberSql('counted_product.cost_price_usd')},${losslessNumberSql('counted_product.cost_price_khr')},counted_product.name),
    'branch',(SELECT json_array(counted_branch.id,${losslessNumberSql('counted_branch.is_active')},counted_branch.name,counted_branch.role) FROM branches counted_branch WHERE counted_branch.id=${branch}),
    'branches',(SELECT json_group_array(json_array(branch_id,${losslessNumberSql('quantity')})) FROM (
      SELECT branch_id,quantity FROM branch_stock WHERE product_id=${product} ORDER BY branch_id LIMIT ${MAX_COUNTED_ROWS + 1})),
    'receipts',(SELECT json_group_array(json_array(id,variant_product_id,${losslessNumberSql('is_active')},${losslessNumberSql('quantity')},${losslessNumberSql('unit_cost_usd')},received_at,expiry_date,batch_key,${losslessNumberSql('batch_number')},lot_code,${losslessNumberSql('received_quantity')},fifo_rank)) FROM (
      SELECT counted_receipt.id,counted_receipt.variant_product_id,counted_receipt.is_active,counted_branch_receipt.quantity,counted_receipt.unit_cost_usd,counted_receipt.received_at,counted_receipt.expiry_date,counted_receipt.batch_key,counted_receipt.batch_number,counted_receipt.lot_code,counted_receipt.received_quantity,
        ROW_NUMBER() OVER (ORDER BY (counted_receipt.received_at IS NULL),counted_receipt.received_at,counted_receipt.batch_number,counted_receipt.id) fifo_rank
      FROM product_batches counted_receipt LEFT JOIN branch_batch_stock counted_branch_receipt ON counted_branch_receipt.batch_id=counted_receipt.id AND counted_branch_receipt.branch_id=${branch}
      WHERE counted_receipt.variant_product_id=${product} AND (counted_branch_receipt.batch_id IS NOT NULL OR counted_receipt.id IN (SELECT CAST(value AS INTEGER) FROM json_each(${additionalReceiptIds}))) ORDER BY counted_receipt.id LIMIT ${MAX_COUNTED_ROWS + 1})),
    'tags',(SELECT json_group_array(json_array(id,batch_id,${losslessNumberSql('quantity')},${losslessNumberSql('quantity_remaining')},condition_tag,source,return_id,return_item_id,${losslessNumberSql('unit_cost_usd')},created_at)) FROM (
      SELECT id,batch_id,quantity,quantity_remaining,condition_tag,source,return_id,return_item_id,unit_cost_usd,created_at
      FROM damaged_stock_lots WHERE product_id=${product} AND branch_id=${branch} ORDER BY id LIMIT ${MAX_COUNTED_ROWS + 1}))
    ) FROM products counted_product WHERE counted_product.id=${product})`
}

export function countedProductCreationFactsSql(product: string, branch: string): string {
  return `json_object('occupied',EXISTS(SELECT 1 FROM products WHERE id=${product})
    OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=${product})
    OR EXISTS(SELECT 1 FROM product_batches WHERE variant_product_id=${product})
    OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=${product})
    OR EXISTS(SELECT 1 FROM product_cost_entries WHERE product_id=${product}),
    'branch',(SELECT json_array(id,is_active,name,role) FROM branches WHERE id=${branch}))`
}

function exactQuantity(text: string): number {
  const value = Number(text)
  if (!Number.isFinite(value) || subtractDecimalSum(value, [text]) !== '0') throw new MoneyPrecisionError('invalid_decimal')
  return value
}

export function subtractCountedQuantity(total: number, values: readonly number[]): number {
  let result = subtractDecimalSum(total, [])
  for (let offset = 0; offset < values.length; offset += MAX_MONEY_SUM_ITEMS) {
    result = subtractDecimalSum(result, values.slice(offset, offset + MAX_MONEY_SUM_ITEMS))
  }
  return exactQuantity(result)
}

export function sumCountedQuantities(values: readonly number[]): number {
  return subtractCountedQuantity(0, values.map(value => -value))
}

export class CountedStockConflictError extends Error {
  readonly code = 'counted_quantity_conflict'
  readonly statusCode = 409
  constructor() { super('The exact stock or condition source changed. Refresh before retrying.'); this.name = 'CountedStockConflictError' }
}

export function isCountedStockConflict(error: unknown): boolean {
  return error instanceof CountedStockConflictError || ['$[counted_quantity_conflict]', '$[counted_ordinary_null_conflict]'].some(marker => (error instanceof Error ? error.message : String(error)).includes(marker))
}

/** One ordered stock plan. Its initial membership guard precedes all writes;
 * following operations use projected balances from preceding operations in
 * this same atomic batch. Generated tag identities need no guessed row id. */
export class CountedStockPlan {
  private readonly facts: CountedFacts
  private readonly observed: string
  private readonly createsProduct: boolean
  private guarded = false
  private addedTags: { batchId: number | null; quantity: number }[] = []
  private readonly createdReceipts = new Map<string, number>()
  private readonly createdReceiptIdentities = new Map<string, CountedCreatedReceipt>()
  private readonly createdReceiptTags = new Map<string, number[]>()
  private readonly additionalReceiptIds: string
  readonly productId: number
  readonly branchId: number

  constructor(input: string | CountedProductCreation, branchId: number, private readonly batch?: CountedBatchBinding) {
    this.createsProduct = typeof input !== 'string'
    this.observed = typeof input === 'string' ? input : input.observed
    const captured = JSON.parse(this.observed)
    if (typeof input === 'string') this.facts = captured as CountedFacts
    else {
      if (batch || !Number.isSafeInteger(input.productId) || input.productId <= 0 || typeof input.name !== 'string'
        || !captured || captured.occupied !== 0 || !Array.isArray(captured.branch)
        || captured.branch[0] !== branchId || captured.branch[1] !== 1) throw new CountedStockConflictError()
      this.facts = { product: [input.productId, 1, 0, input.costUsd, input.costKhr, input.name],
        branch: captured.branch, branches: [], receipts: [], tags: [] }
    }
    if (!this.facts || !Array.isArray(this.facts.product) || !Array.isArray(this.facts.branches)
      || !Array.isArray(this.facts.receipts) || !Array.isArray(this.facts.tags)) throw new CountedStockConflictError()
    this.productId = this.facts.product[0]
    this.branchId = branchId
    this.additionalReceiptIds = JSON.stringify(this.facts.receipts.filter(row => row[3] === null).map(row => row[0]))
    if ([this.facts.branches, this.facts.receipts, this.facts.tags].some(rows => rows.length > MAX_COUNTED_ROWS)) throw new MoneyPrecisionError('too_many_terms')
    for (const quantity of [this.facts.product[2], ...this.facts.branches.map(row => row[1]),
      ...this.facts.receipts.flatMap(row => row[3] === null ? [] : [row[3]]), ...this.facts.tags.flatMap(row => [row[2], row[3]])]) {
      if (!Number.isFinite(quantity) || quantity < 0) throw new CountedStockConflictError()
      subtractCountedQuantity(quantity, [])
    }
    if (subtractCountedQuantity(this.facts.product[2], this.facts.branches.map(row => row[1])) !== 0) throw new CountedStockConflictError()
    if (batch) {
      const shared = batch.products.get(this.productId)
      if (shared) {
        if (JSON.stringify(shared.product) !== JSON.stringify(this.facts.product)
          || JSON.stringify(shared.branches) !== JSON.stringify(this.facts.branches)) throw new CountedStockConflictError()
        this.facts.product = shared.product
        this.facts.branches = shared.branches
      } else batch.products.set(this.productId, { product: this.facts.product, branches: this.facts.branches })
      for (const receipt of this.facts.receipts) {
        const peers = batch.receipts.get(receipt[0]) ?? []
        if (peers.length && JSON.stringify(peers[0].filter((_, index) => index !== 3 && index !== 11)) !== JSON.stringify(receipt.filter((_, index) => index !== 3 && index !== 11))) throw new CountedStockConflictError()
        peers.push(receipt)
        batch.receipts.set(receipt[0], peers)
      }
    }
  }

  get branchQuantity(): number { return this.facts.branches.find(row => row[0] === this.branchId)?.[1] ?? 0 }

  projectedPhysicalTargets(): {
    product: { product_id: number; after: number }
    branches: Array<{ product_id: number; branch_id: number; after: number }>
    receipts: Array<{ batch_id: number | null; batch_key: string | null; product_id: number; branch_id: number; after: number }>
  } {
    return {
      product: { product_id: this.productId, after: this.facts.product[2] },
      branches: this.facts.branches.map(row => ({ product_id: this.productId, branch_id: row[0], after: row[1] })),
      receipts: [...this.facts.receipts.filter(row => row[3] !== null).map(row => ({ batch_id: row[0], batch_key: null, product_id: this.productId, branch_id: this.branchId, after: row[3]! })),
        ...[...this.createdReceipts].map(([batch_key, after]) => ({ batch_id: null, batch_key, product_id: this.productId, branch_id: this.branchId, after }))],
    }
  }

  projectedTaggedSource(lotId: number): (CountedTaggedIdentity & {conditionTag:string;quantityRemaining:number}) | null {
    const tag=this.facts.tags.find(row=>row[0]===lotId)
    if (!tag) return null
    this.assertSource(tag[1])
    return {lotId,productId:this.productId,branchId:this.branchId,batchId:tag[1],conditionTag:tag[4],quantityRemaining:tag[3]}
  }

  projectedReceiptSources(): Array<{batchId:number;lotCode:string|null;receivedAt:string|null;expiryDate:string|null;fifoRank:number;available:number}> {
    return this.facts.receipts.filter(row=>row[2]===1 && row[3]!==null && row[3]>0).map(row=>({
      batchId:row[0],lotCode:row[9],receivedAt:row[5],expiryDate:row[6],fifoRank:row[11],available:this.ordinaryQuantity(row[0]),
    }))
  }

  ordinaryQuantity(batchId: number | null): number {
    this.assertSource(batchId)
    return subtractCountedQuantity(this.capacity(batchId), this.quantities(batchId))
  }

  private quantities(batchId?: number | null): number[] {
    return [...this.facts.tags.filter(row => batchId === undefined || row[1] === batchId).map(row => row[3]),
      ...this.addedTags.filter(row => batchId === undefined || row.batchId === batchId).map(row => row.quantity),
      ...(batchId === undefined ? [...this.createdReceiptTags.values()].flat() : [])]
  }

  private capacity(batchId: number | null): number {
    return batchId === null
      ? subtractCountedQuantity(subtractCountedQuantity(this.branchQuantity, this.facts.receipts.map(row => row[3] ?? 0)), [...this.createdReceipts.values()])
      : this.facts.receipts.find(row => row[0] === batchId)?.[3] ?? 0
  }

  private assertSource(batchId: number | null): void {
    if (this.facts.product[1] !== 1 || this.facts.branch?.[0] !== this.branchId || this.facts.branch[1] !== 1
      || !this.facts.branches.some(row => row[0] === this.branchId)
      || (batchId !== null && !this.facts.receipts.some(row => row[0] === batchId && row[1] === this.productId && row[2] === 1))) throw new CountedStockConflictError()
    this.assertCapacity(batchId)
  }

  private assertCapacity(batchId: number | null): void {
    if (this.capacity(null) < 0
      || subtractCountedQuantity(this.branchQuantity, this.quantities()) < 0
      || subtractCountedQuantity(this.capacity(batchId), this.quantities(batchId)) < 0) throw new CountedStockConflictError()
  }

  private preimageGuard(): StockWriteStatement[] {
    if (this.batch) return this.batch.guards()
    return this.takeInitialGuard()
  }

  takeInitialGuard(): StockWriteStatement[] {
    const predicate = this.takeInitialPredicate()
    return predicate ? [{ sql: `SELECT CASE WHEN ${predicate.sql}
      THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`, params: predicate.params }] : []
  }

  takeInitialPredicate(): StockWriteStatement | null {
    if (this.guarded) return null
    this.guarded = true
    const factsSql = this.createsProduct ? countedProductCreationFactsSql('@productId', '@branchId')
      : countedStockFactsSql('@productId', '@branchId', '@additionalReceiptIds')
    return { sql: `${factsSql}=@observed`,
      params: { productId: this.productId, branchId: this.branchId, observed: this.observed, additionalReceiptIds: this.additionalReceiptIds } }
  }

  private physical(out: StockWriteStatement[], key: string, statement: StockWriteStatement, creates = false): void {
    if (this.batch?.physical) this.batch.physical(key, statement, creates)
    else out.push(statement)
  }

  requiresReceiptActivation(batchId: number): boolean {
    const receipt = this.facts.receipts.find(row => row[0] === batchId && row[1] === this.productId)
    if (!receipt || (receipt[2] !== null && receipt[2] !== 0 && receipt[2] !== 1)) throw new CountedStockConflictError()
    return receipt[2] !== 1
  }

  projectedReceiptByKey(batchKey: string): number | null {
    return this.facts.receipts.find(row => row[7] === batchKey)?.[0] ?? null
  }

  receiveProjectedCreatedReceipt(batchKey: string, quantity: number, reservedBatchId?: number): { guards: StockWriteStatement[]; statements: StockWriteStatement[]; createdReceipt: CountedCreatedReceipt | null } {
    if (!batchKey || this.createdReceipts.has(batchKey) || this.projectedReceiptByKey(batchKey) !== null) throw new CountedStockConflictError()
    if (reservedBatchId !== undefined && (!Number.isSafeInteger(reservedBatchId) || reservedBatchId <= 0 || this.facts.receipts.some(row => row[0] === reservedBatchId))) throw new CountedStockConflictError()
    const statements = this.changeOrdinary(null, quantity, 'receive')
    this.createdReceipts.set(batchKey, quantity)
    const createdReceipt = reservedBatchId === undefined ? null : Object.freeze({ productId: this.productId, branchId: this.branchId, batchKey, batchId: reservedBatchId })
    if (createdReceipt) this.createdReceiptIdentities.set(batchKey, createdReceipt)
    const params = { productId: this.productId, branchId: this.branchId, newReceiptKey: batchKey, nextReceipt: quantity }
    this.physical(statements, `receipt:event:${this.productId}:${this.branchId}:${batchKey}`, {
      sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
        VALUES((SELECT id FROM product_batches WHERE variant_product_id=@productId AND batch_key=@newReceiptKey),@branchId,@nextReceipt)
        ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP`, params,
    }, true)
    this.assertSource(null)
    return { guards: [{ sql: `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM product_batches
      WHERE variant_product_id=@productId AND batch_key=@newReceiptKey)
      THEN 1 ELSE json_extract('[1]','$[counted_quantity_conflict]') END`, params }], statements, createdReceipt }
  }

  holdCreatedReceipt(receipt: CountedCreatedReceipt, quantity: number): StockWriteStatement[] {
    if (this.createdReceiptIdentities.get(receipt.batchKey) !== receipt || !Number.isFinite(quantity) || quantity <= 0) throw new CountedStockConflictError()
    const tagged = this.createdReceiptTags.get(receipt.batchKey) ?? []
    if (subtractCountedQuantity(this.createdReceipts.get(receipt.batchKey)!, [...tagged, quantity]) < 0
      || subtractCountedQuantity(this.branchQuantity, [...this.quantities(), quantity]) < 0) throw new CountedStockConflictError()
    this.createdReceiptTags.set(receipt.batchKey, [...tagged, quantity])
    return this.preimageGuard()
  }

  changeOrdinary(batchId: number | null, quantity: number, action: 'consume' | 'receive' | 'activateAndReceive'): StockWriteStatement[] {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new CountedStockConflictError()
    const receiving = action !== 'consume'
    const activating = action === 'activateAndReceive'
    if (this.facts.product[1] !== 1 || this.facts.branch?.[0] !== this.branchId || this.facts.branch[1] !== 1) throw new CountedStockConflictError()
    if (activating && (batchId === null || !this.requiresReceiptActivation(batchId))) throw new CountedStockConflictError()
    const capturedReceipt = batchId === null ? null : this.facts.receipts.find(row => row[0] === batchId && row[1] === this.productId)
    if (batchId !== null && (!capturedReceipt || (!activating && capturedReceipt[2] !== 1))) throw new CountedStockConflictError()
    if (receiving) {
      if (this.facts.branches.some(row => row[0] === this.branchId)) {
        if (activating) this.assertCapacity(batchId)
        else this.assertSource(batchId)
      }
      else if (this.facts.receipts.some(row => (row[3] ?? 0) > 0) || this.quantities().some(value => value > 0)) throw new CountedStockConflictError()
    }
    if (!receiving && this.ordinaryQuantity(batchId) < quantity) throw new CountedStockConflictError()
    const out = this.preimageGuard()
    if (activating) {
      out.push({ sql: 'UPDATE product_batches SET is_active=1 WHERE id=@batchId AND variant_product_id=@productId AND is_active IS @inactiveReceipt', params: { batchId, productId: this.productId, inactiveReceipt: capturedReceipt![2] } })
      const peers = this.batch?.receipts.get(batchId!) ?? [this.facts.receipts.find(row => row[0] === batchId)!]
      for (const receipt of peers) receipt[2] = 1
    }
    let branch = this.facts.branches.find(row => row[0] === this.branchId)
    if (!branch) {
      if (!receiving) throw new CountedStockConflictError()
      branch = [this.branchId, 0]
      this.facts.branches.push(branch)
      this.facts.branches.sort((a, b) => a[0] - b[0])
    }
    const delta = receiving ? -quantity : quantity
    branch[1] = subtractCountedQuantity(branch[1], [delta])
    this.facts.product[2] = subtractCountedQuantity(this.facts.product[2], [delta])
    if (branch[1] < 0 || this.facts.product[2] < 0) throw new CountedStockConflictError()
    const params = { productId: this.productId, branchId: this.branchId, batchId, nextBranch: branch[1], nextProduct: this.facts.product[2],
      ...(this.createsProduct ? { createdProductName: this.facts.product[5] } : {}) }
    if (batchId !== null) {
      const receipt = this.facts.receipts.find(row => row[0] === batchId)!
      receipt[3] = subtractCountedQuantity(receipt[3] ?? 0, [delta])
      this.physical(out, `receipt:${batchId}:${this.branchId}`, { sql: receiving
        ? 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(@batchId,@branchId,@nextReceipt) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP'
        : 'UPDATE branch_batch_stock SET quantity=@nextReceipt,updated_at=CURRENT_TIMESTAMP WHERE batch_id=@batchId AND branch_id=@branchId', params: { ...params, nextReceipt: receipt[3] } }, receiving)
    }
    const receivingProduct = this.createsProduct ? `CASE WHEN EXISTS(SELECT 1 FROM products
      WHERE id=@productId AND is_active=1 AND name IS @createdProductName) THEN @productId
      ELSE json_extract('[1]','$[counted_quantity_conflict]') END` : '@productId'
    this.physical(out, `branch:${this.productId}:${this.branchId}`, { sql: receiving
      ? `INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(${receivingProduct},@branchId,@nextBranch) ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`
      : 'UPDATE branch_stock SET quantity=@nextBranch WHERE product_id=@productId AND branch_id=@branchId', params }, receiving)
    this.physical(out, `product:${this.productId}`, { sql: 'UPDATE products SET stock_quantity=@nextProduct,updated_at=CURRENT_TIMESTAMP WHERE id=@productId', params })
    this.assertSource(batchId)
    return out
  }

  hold(batchId: number | null, quantity: number): StockWriteStatement[] {
    this.assertSource(batchId)
    if (!Number.isFinite(quantity) || quantity <= 0
      || subtractCountedQuantity(this.branchQuantity, [...this.quantities(), quantity]) < 0
      || subtractCountedQuantity(this.capacity(batchId), [...this.quantities(batchId), quantity]) < 0) throw new CountedStockConflictError()
    this.addedTags.push({ batchId, quantity })
    return this.preimageGuard()
  }

  change(identity: CountedTaggedIdentity, quantity: number, action: 'clear' | 'consume' | 'restore' | 'retag'): StockWriteStatement[] {
    if (identity.productId !== this.productId || identity.branchId !== this.branchId || !Number.isFinite(quantity) || quantity <= 0) throw new CountedStockConflictError()
    this.assertSource(identity.batchId)
    const lot = this.facts.tags.find(row => row[0] === identity.lotId && row[1] === identity.batchId)
    if (!lot) throw new CountedStockConflictError()
    const increasing = action === 'restore' || action === 'retag'
    const remaining = subtractCountedQuantity(lot[3], [increasing ? -quantity : quantity])
    if (remaining < 0 || subtractCountedQuantity(lot[2], [remaining]) < 0) throw new CountedStockConflictError()
    const out = this.preimageGuard()
    lot[3] = remaining
    out.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=@nextRemaining,updated_at=CURRENT_TIMESTAMP WHERE id=@lotId', params: { ...identity, nextRemaining: remaining } })
    if (action === 'consume' || action === 'restore') {
      const delta = action === 'consume' ? quantity : -quantity
      const branch = this.facts.branches.find(row => row[0] === this.branchId)!
      branch[1] = subtractCountedQuantity(branch[1], [delta])
      this.facts.product[2] = subtractCountedQuantity(this.facts.product[2], [delta])
      if (branch[1] < 0 || this.facts.product[2] < 0) throw new CountedStockConflictError()
      if (identity.batchId !== null) {
        const receipt = this.facts.receipts.find(row => row[0] === identity.batchId)!
        receipt[3] = subtractCountedQuantity(receipt[3] ?? 0, [delta])
        this.physical(out, `receipt:${identity.batchId}:${this.branchId}`, { sql: action === 'restore'
          ? 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(@batchId,@branchId,@nextReceipt) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP'
          : 'UPDATE branch_batch_stock SET quantity=@nextReceipt,updated_at=CURRENT_TIMESTAMP WHERE batch_id=@batchId AND branch_id=@branchId', params: { ...identity, nextReceipt: receipt[3] } }, action === 'restore')
      }
      this.physical(out, `branch:${this.productId}:${this.branchId}`, { sql: 'UPDATE branch_stock SET quantity=@nextBranch WHERE product_id=@productId AND branch_id=@branchId', params: { ...identity, nextBranch: branch[1] } })
      this.physical(out, `product:${this.productId}`, { sql: 'UPDATE products SET stock_quantity=@nextProduct,updated_at=CURRENT_TIMESTAMP WHERE id=@productId', params: { ...identity, nextProduct: this.facts.product[2] } })
    }
    this.assertSource(identity.batchId)
    return out
  }
}

/** One optimistic generation for every product/branch in one commit. All
 * preimages precede mutations; branches of one product share its projection. */
export class CountedStockBatchPlan {
  private readonly plans = new Map<string, CountedStockPlan>()
  private guarded = false
  private readonly physicalWrites = new Map<string, { statement: StockWriteStatement; creates: boolean }>()
  private finalized = false

  constructor(observed: readonly { facts: string; branchId: number }[], options: { deferPhysicalWrites?: boolean } = {}) {
    const binding: CountedBatchBinding = { products: new Map(), receipts: new Map(), guards: () => this.takePreimageGuards() }
    if (options.deferPhysicalWrites) binding.physical = (key, statement, creates) => {
      if (this.finalized) throw new CountedStockConflictError()
      const previous = this.physicalWrites.get(key)
      this.physicalWrites.set(key, { statement: previous?.creates && !creates
        ? { sql: previous.statement.sql, params: statement.params } : statement, creates: creates || !!previous?.creates })
    }
    const snapshots = new Map<string, string>()
    for (const row of observed) {
      const plan = new CountedStockPlan(row.facts, row.branchId, binding)
      const key = `${plan.productId}:${row.branchId}`
      if (this.plans.has(key)) {
        if (snapshots.get(key) !== row.facts) throw new CountedStockConflictError()
        continue
      }
      this.plans.set(key, plan)
      snapshots.set(key, row.facts)
    }
  }

  get(productId: number, branchId: number): CountedStockPlan {
    const plan = this.plans.get(`${productId}:${branchId}`)
    if (!plan) throw new CountedStockConflictError()
    return plan
  }

  projectedPhysicalTargets(): ReturnType<CountedStockPlan['projectedPhysicalTargets']>[] {
    return [...this.plans.values()].map(plan => plan.projectedPhysicalTargets())
  }

  takeFinalPhysicalWrites(): StockWriteStatement[] {
    if (this.finalized) return []
    this.finalized = true
    return ['receipt:', 'branch:', 'product:'].flatMap(prefix =>
      [...this.physicalWrites.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value.statement))
  }

  takePreimageGuards(): StockWriteStatement[] {
    if (this.guarded) return []
    this.guarded = true
    return [...this.plans.values()].flatMap(plan => plan.takeInitialGuard())
  }
}

export function planExactCountedOrdinaryChange(exact: CountedStockPlan, batchId: number | null, quantity: number, action: 'consume' | 'receive' | 'activateAndReceive'): StockWriteStatement[] {
  return exact.changeOrdinary(batchId, quantity, action)
}

export function planExactCountedTagCapacity(exact: CountedStockPlan, productId: number, branchId: number, batchId: number | null, quantity: number): StockWriteStatement[] {
  if (exact.productId !== productId || exact.branchId !== branchId) throw new CountedStockConflictError()
  return exact.hold(batchId, quantity)
}

export function planExactCountedTaggedChange(exact: CountedStockPlan, identity: CountedTaggedIdentity, quantity: number, action: 'clear' | 'consume' | 'restore' | 'retag'): StockWriteStatement[] {
  return exact.change(identity, quantity, action)
}

export function ordinarySubsetSql(product: string, branch: string, batch?: string): string {
  return `(SELECT COALESCE(SUM(d.quantity_remaining),0) FROM damaged_stock_lots d WHERE d.product_id=${product} AND d.branch_id=${branch}${batch === undefined ? '' : ` AND d.batch_id IS ${batch}`})`
}

export function ordinaryNullCapacityGuard(productId: number, branchId: number, quantity: number): StockWriteStatement {
  return { sql: `SELECT CASE WHEN COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@productId AND branch_id=@branchId),0)
    -COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=@productId AND bbs.branch_id=@branchId),0)
    -${ordinarySubsetSql('@productId', '@branchId', 'NULL')}>=@quantity
    THEN 1 ELSE json_extract('[1]','$[counted_ordinary_null_conflict]') END`, params: { productId, branchId, quantity } }
}

export function tagCapacityGuard(productId: number, branchId: number, batchId: number | null, quantity: number): StockWriteStatement[] {
  const params = { productId, branchId, batchId, quantity }
  const guards: StockWriteStatement[] = [{ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM branch_stock bs JOIN branches b ON b.id=bs.branch_id
    WHERE bs.product_id=@productId AND bs.branch_id=@branchId AND b.is_active=1
    AND bs.quantity-${ordinarySubsetSql('@productId', '@branchId')}>=@quantity)
    THEN 1 ELSE json_extract('[1]','$[counted_tag_capacity_conflict]') END`, params }]
  if (batchId === null) guards.push(ordinaryNullCapacityGuard(productId, branchId, quantity))
  else guards.push({ sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
    WHERE pb.id=@batchId AND pb.variant_product_id=@productId AND pb.is_active=1 AND bbs.branch_id=@branchId
    AND bbs.quantity-${ordinarySubsetSql('@productId', '@branchId', '@batchId')}>=@quantity)
    THEN 1 ELSE json_extract('[1]','$[counted_tag_capacity_conflict]') END`, params })
  return guards
}

export function planCountedTaggedChange(identity: CountedTaggedIdentity, quantity: number, action: 'clear' | 'consume' | 'restore'): StockWriteStatement[] {
  if (![identity.lotId, identity.productId, identity.branchId].every(id => Number.isSafeInteger(id) && id > 0)
    || (identity.batchId !== null && (!Number.isSafeInteger(identity.batchId) || identity.batchId <= 0))
    || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid counted tagged stock identity or quantity')
  const params = { ...identity, quantity }
  const restore = action === 'restore'
  const statements: StockWriteStatement[] = [{
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM damaged_stock_lots d JOIN products p ON p.id=d.product_id
      JOIN branches b ON b.id=d.branch_id
      WHERE d.id=@lotId AND d.product_id=@productId AND d.branch_id=@branchId AND d.batch_id IS @batchId
        AND p.is_active=1 AND b.is_active=1 ${restore ? 'AND d.quantity_remaining+@quantity<=d.quantity' : 'AND d.quantity_remaining>=@quantity'}
        AND EXISTS(SELECT 1 FROM branch_stock bs WHERE bs.product_id=@productId AND bs.branch_id=@branchId)
        AND (@batchId IS NULL OR EXISTS(SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
          WHERE pb.id=@batchId AND pb.variant_product_id=@productId AND pb.is_active=1 AND bbs.branch_id=@branchId)))
      THEN 1 ELSE json_extract('[1]','$[counted_tagged_conflict]') END`, params,
  }]
  {
    const capacity = `
      COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@productId AND branch_id=@branchId),0)>=${ordinarySubsetSql('@productId', '@branchId')}
      AND CASE WHEN @batchId IS NULL THEN
        COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@productId AND branch_id=@branchId),0)-
        COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id WHERE pb.variant_product_id=@productId AND bbs.branch_id=@branchId),0)
      ELSE COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@batchId AND branch_id=@branchId),0) END
      >=${ordinarySubsetSql('@productId', '@branchId', '@batchId')}
      `
    statements[0].sql = statements[0].sql.replace('THEN 1 ELSE', `AND (${capacity}) THEN 1 ELSE`)
  }
  statements.push({ sql: `UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining${restore ? '+' : '-'}@quantity,updated_at=CURRENT_TIMESTAMP WHERE id=@lotId`, params })
  if (action !== 'clear') {
    if (identity.batchId !== null) statements.push({ sql: `UPDATE branch_batch_stock SET quantity=quantity${restore ? '+' : '-'}@quantity WHERE batch_id=@batchId AND branch_id=@branchId`, params })
    statements.push({ sql: `UPDATE branch_stock SET quantity=quantity${restore ? '+' : '-'}@quantity WHERE product_id=@productId AND branch_id=@branchId`, params },
      { sql: `UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@productId),updated_at=CURRENT_TIMESTAMP WHERE id=@productId`, params })
  }
  return statements
}

type StockWriteStatement = { sql: string; params: Record<string, unknown> }

export type CountedTaggedIdentity = { lotId: number; productId: number; branchId: number; batchId: number | null }

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

-- A batch is an identifier for every product, not an optional receipt.
-- Backfill one stable "day added" batch for legacy products that have none.
INSERT INTO product_batches (variant_product_id, batch_key, lot_code, expiry_date, received_at, is_active, notes, batch_number, created_at, updated_at)
SELECT
  p.id,
  'initial:' || p.id,
  'Added ' || substr(COALESCE(p.created_at, CURRENT_TIMESTAMP), 1, 10),
  NULL,
  COALESCE(p.created_at, CURRENT_TIMESTAMP),
  1,
  'Default batch created for existing product',
  1,
  COALESCE(p.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = p.id
);

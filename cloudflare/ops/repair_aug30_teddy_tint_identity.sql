-- One-time correction for duplicate catalog barcodes on receipt 4351.
-- N.35/O.35 and N.40/O.40 share manufacturer barcodes in the catalog; the
-- legacy mapping's canonical target name is therefore required in addition
-- to barcode. Every mutation is guarded by the still-wrong effect mapping,
-- so a successful rerun changes nothing.

UPDATE products SET stock_quantity=stock_quantity+1
WHERE id=4288 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:2' AND product_id=4288
);

UPDATE products SET stock_quantity=stock_quantity+1
WHERE id=4289 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);
UPDATE branch_stock SET quantity=quantity+1
WHERE product_id=4289 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);
UPDATE branch_batch_stock SET quantity=quantity+1,updated_at=CURRENT_TIMESTAMP
WHERE batch_id=4289 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);

UPDATE products SET stock_quantity=stock_quantity-1
WHERE id=4282 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:2' AND product_id=4288
);
UPDATE branch_stock SET quantity=quantity-1
WHERE product_id=4282 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:2' AND product_id=4288
);
UPDATE branch_batch_stock SET quantity=quantity-1,updated_at=CURRENT_TIMESTAMP
WHERE batch_id=4282 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:2' AND product_id=4288
);

UPDATE products SET stock_quantity=stock_quantity-1
WHERE id=4283 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);
UPDATE branch_stock SET quantity=quantity-1
WHERE product_id=4283 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);
UPDATE branch_batch_stock SET quantity=quantity-1,updated_at=CURRENT_TIMESTAMP
WHERE batch_id=4283 AND branch_id=2 AND EXISTS (
  SELECT 1 FROM legacy_inventory_effects
  WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289
);

UPDATE sale_items SET product_id=4283,product_name='Maybelline Teddy Tint Lipstick N.40',batch_id=4283
WHERE sale_id=(SELECT id FROM sales WHERE receipt_number='4351@2026-08-28') AND product_id=4289;
UPDATE sale_items SET product_id=4282,product_name='Maybelline Teddy Tint Lipstick N.35',batch_id=4282
WHERE sale_id=(SELECT id FROM sales WHERE receipt_number='4351@2026-08-28') AND product_id=4288;

UPDATE legacy_sale_item_corrections
SET product_id=4283,product_name='Maybelline Teddy Tint Lipstick N.40',batch_id=4283
WHERE receipt_number='4351@2026-08-28' AND line_ordinal=1 AND product_id=4289;
UPDATE legacy_sale_item_corrections
SET product_id=4282,product_name='Maybelline Teddy Tint Lipstick N.35',batch_id=4282
WHERE receipt_number='4351@2026-08-28' AND line_ordinal=2 AND product_id=4288;

UPDATE inventory_movements SET product_id=4283,product_name='Maybelline Teddy Tint Lipstick N.40',batch_id=4283
WHERE reason='Old-system sale 4351@2026-08-28' AND product_id=4289;
UPDATE inventory_movements SET product_id=4282,product_name='Maybelline Teddy Tint Lipstick N.35',batch_id=4282
WHERE reason='Old-system sale 4351@2026-08-28' AND product_id=4288;

UPDATE legacy_inventory_effects SET product_id=4283,batch_id=4283
WHERE source_key='legacy-sale:4351@2026-08-28:1' AND product_id=4289;
UPDATE legacy_inventory_effects SET product_id=4282,batch_id=4282
WHERE source_key='legacy-sale:4351@2026-08-28:2' AND product_id=4288;

UPDATE sales SET items=(
  SELECT json_group_array(json_object(
    'product_id',si.product_id,'product_name',si.product_name,'sku',si.sku,
    'quantity',si.quantity,'returned_quantity',si.returned_quantity,
    'applied_price_usd',si.applied_price_usd,'applied_price_khr',si.applied_price_khr,
    'total_usd',si.total_usd,'total_khr',si.total_khr,
    'cost_price_usd',si.cost_price_usd,'cost_price_khr',si.cost_price_khr,
    'base_price_usd',si.base_price_usd,'base_price_khr',si.base_price_khr,
    'product_discount_type',si.product_discount_type,'product_discount_label',si.product_discount_label,
    'product_discount_usd',si.product_discount_usd,'product_discount_khr',si.product_discount_khr,
    'manual_discount_type',si.manual_discount_type,'manual_discount_value',si.manual_discount_value,
    'manual_discount_usd',si.manual_discount_usd,'manual_discount_khr',si.manual_discount_khr,
    'branch_id',si.branch_id,'batch_id',si.batch_id,'batch_label',si.batch_label,
    'batch_expiry_date',si.batch_expiry_date
  )) FROM sale_items si WHERE si.sale_id=sales.id ORDER BY si.id
)
WHERE receipt_number='4351@2026-08-28';

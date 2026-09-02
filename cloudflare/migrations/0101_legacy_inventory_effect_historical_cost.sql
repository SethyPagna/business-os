-- Legacy sale corrections must preserve the source sale-item cost in the
-- inventory movement they create. Product cost is current catalog state and
-- may have changed since the historical sale; it is only a fallback for old
-- effect rows and source records that genuinely have no recorded cost.

ALTER TABLE legacy_inventory_effects ADD COLUMN unit_cost_usd REAL;
ALTER TABLE legacy_inventory_effects ADD COLUMN unit_cost_khr REAL;

DROP TRIGGER IF EXISTS trg_legacy_inventory_effect_apply;

CREATE TRIGGER trg_legacy_inventory_effect_apply
AFTER INSERT ON legacy_inventory_effects
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.product_id;

  UPDATE branch_stock
  SET quantity = quantity + NEW.quantity_delta
  WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;

  UPDATE branch_batch_stock
  SET quantity = quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE NEW.batch_id IS NOT NULL
    AND batch_id = NEW.batch_id AND branch_id = NEW.branch_id;

  INSERT INTO inventory_movements (
    product_id, product_name, branch_id, branch_name, movement_type,
    quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
    reason, reference_id, user_id, user_name, created_at, batch_id
  )
  SELECT
    p.id, p.name, b.id, b.name, NEW.movement_type,
    NEW.movement_quantity,
    COALESCE(NEW.unit_cost_usd, p.cost_price_usd, 0),
    COALESCE(NEW.unit_cost_khr, p.cost_price_khr, 0),
    NEW.movement_quantity * COALESCE(NEW.unit_cost_usd, p.cost_price_usd, 0),
    NEW.movement_quantity * COALESCE(NEW.unit_cost_khr, p.cost_price_khr, 0),
    NEW.reason, NEW.reference_id, NULL, 'Old system', NEW.occurred_at,
    NEW.batch_id
  FROM products p
  JOIN branches b ON b.id = NEW.branch_id
  WHERE p.id = NEW.product_id;
END;

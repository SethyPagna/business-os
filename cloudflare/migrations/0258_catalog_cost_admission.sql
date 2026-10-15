-- PRE: 0243 installed; no transient stock permit. No monetary data is rewritten.
-- POST: old Worker cost tails refuse; current cost writes share their stock transaction permit.
-- RECOVERY: retain this fence on Worker rollback; do not replay a stock write without its receipt.
SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='stock_schema_epoch' AND value='legacy-separate-pool-v1')
  AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='stock_transaction_permit')
  THEN 1 ELSE json_extract('[1]','$[stock_schema_installation_conflict]') END;

CREATE TRIGGER catalog_cost_admission_product_update_0258
BEFORE UPDATE OF cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_lot_update_0258
BEFORE UPDATE OF unit_cost_usd ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_entry_insert_0258
BEFORE INSERT ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_entry_update_0258
BEFORE UPDATE ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER catalog_cost_admission_entry_delete_0258
BEFORE DELETE ON product_cost_entries
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

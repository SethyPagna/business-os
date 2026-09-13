-- Wave 1: additive contract only. No existing writer is activated.
-- No UPDATE/backfill: every historical amount and revision remains unchanged.
-- Rollback after activation is application rollback, NOT dropping these fields.
-- Preserve a complete pre-migration backup and verify old-column fingerprints.

ALTER TABLE sales ADD COLUMN money_precision_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN calculated_total_usd REAL;
ALTER TABLE sales ADD COLUMN rounding_adjustment_usd REAL NOT NULL DEFAULT 0;

CREATE TRIGGER sales_money_precision_insert
BEFORE INSERT ON sales
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_total_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_total_usd) IN ('integer', 'real') AND NEW.calculated_total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_total_usd = CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_usd) IN ('integer', 'real') AND NEW.total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_usd = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_total_usd >= 0 AND NEW.total_usd >= 0
      AND CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) <= 50
      AND ((CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_sales');
END;

CREATE TRIGGER sales_money_precision_update
BEFORE UPDATE ON sales
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_total_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_total_usd) IN ('integer', 'real') AND NEW.calculated_total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_total_usd = CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_usd) IN ('integer', 'real') AND NEW.total_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_usd = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_total_usd >= 0 AND NEW.total_usd >= 0
      AND CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) <= 50
      AND ((CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_sales');
END;

ALTER TABLE returns ADD COLUMN money_precision_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE returns ADD COLUMN calculated_refund_usd REAL;
ALTER TABLE returns ADD COLUMN rounding_adjustment_usd REAL NOT NULL DEFAULT 0;

CREATE TRIGGER returns_money_precision_insert
BEFORE INSERT ON returns
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_refund_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_refund_usd) IN ('integer', 'real') AND NEW.calculated_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_refund_usd = CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_refund_usd) IN ('integer', 'real') AND NEW.total_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_refund_usd = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_refund_usd >= 0 AND NEW.total_refund_usd >= 0
      AND CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) < 100
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_returns');
END;

CREATE TRIGGER returns_money_precision_update
BEFORE UPDATE ON returns
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_refund_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version = 1
      AND typeof(NEW.calculated_refund_usd) IN ('integer', 'real') AND NEW.calculated_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.calculated_refund_usd = CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_refund_usd) IN ('integer', 'real') AND NEW.total_refund_usd BETWEEN -100000000000 AND 100000000000 AND NEW.total_refund_usd = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND NEW.calculated_refund_usd >= 0 AND NEW.total_refund_usd >= 0
      AND CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_refund_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_refund_usd * 10000) AS INTEGER)
      AND ABS(CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER)) < 100
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_returns');
END;

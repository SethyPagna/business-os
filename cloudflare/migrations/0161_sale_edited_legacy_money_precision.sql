-- Reviewed edits may record header rounding without inventing item provenance.
-- No UPDATE/backfill. Capture a complete backup and compare all existing rows
-- before/after applying. Roll back the application, not these saved amounts.
-- New inserts retain 0158's stricter policy: legacy metadata is UPDATE-only.
DROP TRIGGER sales_money_precision_update;
CREATE TRIGGER sales_money_precision_update_0161
BEFORE UPDATE ON sales
WHEN NOT COALESCE((typeof(NEW.money_precision_version) = 'integer' AND (
    (NEW.money_precision_version = 0 AND NEW.calculated_total_usd IS NULL AND NEW.rounding_adjustment_usd = 0)
    OR (NEW.money_precision_version IN (0, 1)
      AND typeof(NEW.calculated_total_usd) IN ('integer', 'real') AND NEW.calculated_total_usd BETWEEN 0 AND 100000000000 AND NEW.calculated_total_usd = CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.total_usd) IN ('integer', 'real') AND NEW.total_usd BETWEEN 0 AND 100000000000 AND NEW.total_usd = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) / 10000.0
      AND typeof(NEW.rounding_adjustment_usd) IN ('integer', 'real') AND NEW.rounding_adjustment_usd BETWEEN -0.005 AND 0.005 AND NEW.rounding_adjustment_usd = CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
      AND CAST(ROUND(NEW.total_usd * 10000) AS INTEGER) % 100 = 0
      AND CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(NEW.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
      AND ((CAST(ROUND(NEW.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(NEW.total_usd * 10000) AS INTEGER)
    )
  )), 0)
BEGIN
  SELECT RAISE(ABORT, 'money_precision_invalid_sales');
END;

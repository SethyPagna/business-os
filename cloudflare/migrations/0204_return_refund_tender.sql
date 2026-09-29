-- Owner rulings 29 Sep 2026: a refund records the currency it was paid in, and the part of it
-- that lowered a Not Paid sale's debt instead of leaving a drawer. Rows before this read as a dollar refund.
ALTER TABLE returns ADD COLUMN refund_currency TEXT;
ALTER TABLE returns ADD COLUMN owed_reduction_usd REAL NOT NULL DEFAULT 0;

CREATE TRIGGER returns_refund_tender_insert
BEFORE INSERT ON returns
WHEN NOT COALESCE((
    (NEW.refund_currency IS NULL OR NEW.refund_currency IN ('USD', 'KHR'))
    AND typeof(NEW.owed_reduction_usd) IN ('integer', 'real')
    AND NEW.owed_reduction_usd >= 0
    AND (NEW.owed_reduction_usd = 0 OR NEW.owed_reduction_usd <= NEW.total_refund_usd)
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'returns_refund_tender_invalid');
END;

CREATE TRIGGER returns_refund_tender_update
BEFORE UPDATE OF refund_currency, owed_reduction_usd, total_refund_usd ON returns
WHEN NOT COALESCE((
    (NEW.refund_currency IS NULL OR NEW.refund_currency IN ('USD', 'KHR'))
    AND typeof(NEW.owed_reduction_usd) IN ('integer', 'real')
    AND NEW.owed_reduction_usd >= 0
    AND (NEW.owed_reduction_usd = 0 OR NEW.owed_reduction_usd <= NEW.total_refund_usd)
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'returns_refund_tender_invalid');
END;

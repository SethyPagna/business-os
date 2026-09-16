-- Additional cash placed into a shift drawer after the opening float.
--
-- This is a native cash movement, per currency. It is deliberately separate
-- from opening and closing counts: an employee can start with an opening
-- float, use it up, then add more money without rewriting either registered
-- count. The reconciliation kernel adds it to expected cash and every report
-- carries the same value. Existing rows have no additional movement, so the
-- zero default preserves their prior figures.
ALTER TABLE shift_sessions ADD COLUMN additional_cash_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE shift_sessions ADD COLUMN additional_cash_khr REAL NOT NULL DEFAULT 0;

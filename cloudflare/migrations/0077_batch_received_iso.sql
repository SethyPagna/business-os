-- 0077: repair product_batches.received_at rows stored as the RAW
-- mm/dd/yyyy display string instead of ISO.
--
-- The Aug-28 catalog import read the template's `batch(mm/dd/yyyy)` cell
-- and stored it verbatim (importEngine.ts's received_date parse had no
-- normalizeToIsoDate), so every imported lot carried e.g. '08/24/2026'
-- while every manually received lot carries '2026-08-28...'. SQL date()
-- returns NULL for the slash form, ordering is lexicographic garbage, and
-- the D1b received-DAY grouping can never match those lots. Production
-- held 6,031 such rows at the time of writing; the engine now normalizes
-- at parse time, this repairs what was already stored.
--
-- Idempotent by shape: the WHERE only matches the two-digit slash form, and
-- the rewrite produces ISO which the predicate no longer matches. Rows in
-- any other shape (ISO dates, ISO datetimes, NULL) are untouched.
UPDATE product_batches
SET received_at = substr(received_at, 7, 4) || '-' || substr(received_at, 1, 2) || '-' || substr(received_at, 4, 2)
WHERE received_at LIKE '__/__/____';

-- Same repair for the m/d shapes a hand-typed cell could have produced
-- (padded during the rewrite). Handled as separate statements because
-- substr positions differ per shape; each predicate is disjoint from the
-- ISO output of every other.
UPDATE product_batches
SET received_at = substr(received_at, 6, 4) || '-0' || substr(received_at, 1, 1) || '-' || substr(received_at, 3, 2)
WHERE received_at LIKE '_/__/____';

UPDATE product_batches
SET received_at = substr(received_at, 6, 4) || '-' || substr(received_at, 1, 2) || '-0' || substr(received_at, 4, 1)
WHERE received_at LIKE '__/_/____';

UPDATE product_batches
SET received_at = substr(received_at, 5, 4) || '-0' || substr(received_at, 1, 1) || '-0' || substr(received_at, 3, 1)
WHERE received_at LIKE '_/_/____';

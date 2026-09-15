-- 0166: merge the production customer groups that share the same name AND
-- the same phone (including groups that share an EMPTY phone, e.g. the 9
-- groups the coordinator found 2026-09-15: "ah ling" 099 503 494 -> ids
-- 25000,25001; "sok han" 088 444 9557 -> 25040,25041; and seven groups with
-- an empty phone -- "be me" 19739,24990; "general" 24969,24974,25004; "je
-- meng" 20200,24980; "malis phouk" 24533,24989; "ra" 20178,24991; "sokha
-- lin" 20582,24988; "za" 20852,24998).
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0165 is the
-- prior migration). TABLE-DRIVEN, same shape as 0165: the cluster is
-- computed IN SQL from live `customers` data (LOWER(TRIM(name)) +
-- TRIM(COALESCE(phone,''))) at apply time via customer_merge_map_0166, not
-- hand-listed ids, so a stale id list can never merge the wrong row (and a
-- customer with a genuinely different name+phone pair is never touched, no
-- matter how many rows exist).
--
-- Verified by scripts/verify-0165-0166-merges.cjs and
-- scripts/test-migration-0165-0166-pure.cjs.
--
-- ============================== KEEPER RULE ==============================
-- Cluster = customers sharing LOWER(TRIM(name)) + TRIM(COALESCE(phone,'')),
--   cluster size > 1. Keeper = lowest id (oldest record; matches the
--   supplier-cluster keeper rule in 0164 and buildContactMergePlan's
--   ascending-id backfill order). No barcode-style "real vs no-code" split
--   exists for customers -- phone is either present (and must match
--   EXACTLY for the two rows to cluster at all) or blank on every row in
--   the cluster.
-- Keeper backfill: any of phone/email/address/company/notes/gender/
--   membership_number that is NULL or '' on the keeper is filled from the
--   lowest-id loser that carries a non-blank value for that field --
--   mirrors contactMergeValueIsBlank (only NULL/empty string is blank,
--   never a trimmed whitespace value) and never touches the keeper's name.
--
-- ============================== LOYALTY ==================================
-- Loyalty balance is COMPUTED from a customer's sales (see
-- lib/loyalty*.ts) -- there is no stored balance column on `customers` to
-- add across the cluster, so merging carries no separate loyalty-transfer
-- step. loyalty_point_adjustments rows (the audit trail of manual
-- adjustments) are repointed like every other customer_id column below, so
-- the keeper's computed balance correctly includes them after the merge.
--
-- ============================== REPOINTED TABLES =========================
-- sales.customer_id, returns.customer_id, customer_receivables.customer_id,
-- loyalty_point_adjustments.customer_id, customer_share_submissions.
-- customer_id -- every customer_id-bearing table in the schema (swept via
-- `PRAGMA table_info` over every table, not assumed) -- repointed 1:1, no
-- unique constraint on any of them forbids a blind repoint.
-- portal_accounts.contact_id was checked and does NOT reference customers
-- (portal_accounts is the storefront login table; contact_id is a separate,
-- unrelated link) -- left untouched, correctly.
--
-- ============================== IDEMPOTENCE ==============================
-- Same construction as 0165: the map INSERT recomputes clusters from LIVE
-- customers data and guards on NOT EXISTS; after losers are deleted the
-- clustering CTE sees only keepers, so a second run inserts nothing and
-- every downstream statement (scoped by `IN (SELECT loser_id FROM
-- customer_merge_map_0166)`) becomes a no-op.
--
-- ============================== RECOVERY ==================================
-- Every merged loser's full pre-image lives in customer_merge_map_0166.
-- loser_json (also duplicated into audit_logs.old_value, user_name =
-- 'migration:0166_customer_same_name_phone_merge', record_id = the loser
-- id). Reinserting the row restores the customer record itself (sales/
-- returns/receivables history is NOT reversed automatically -- consolidating
-- a genuine duplicate is the intended, permanent effect, same as 0164/0165):
--   INSERT INTO customers (id, name, phone, email, address, company, notes,
--     created_at, membership_number, updated_at, gender, phone_normalized)
--   SELECT CAST(m.loser_id AS INTEGER), json_extract(m.loser_json,'$.name'),
--     json_extract(m.loser_json,'$.phone'), json_extract(m.loser_json,'$.email'),
--     json_extract(m.loser_json,'$.address'), json_extract(m.loser_json,'$.company'),
--     json_extract(m.loser_json,'$.notes'), json_extract(m.loser_json,'$.created_at'),
--     json_extract(m.loser_json,'$.membership_number'), json_extract(m.loser_json,'$.updated_at'),
--     json_extract(m.loser_json,'$.gender'), json_extract(m.loser_json,'$.phone_normalized')
--   FROM customer_merge_map_0166 m WHERE m.loser_id = <loser id>
--     AND NOT EXISTS (SELECT 1 FROM customers WHERE id = CAST(m.loser_id AS INTEGER));
--
-- ============================== PRE-ASSERTION =============================
--   SELECT LOWER(TRIM(name)), TRIM(COALESCE(phone,'')), COUNT(*) FROM customers
--     GROUP BY 1,2 HAVING COUNT(*) > 1; -- expect the 9 groups above (ids may drift)
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0166_customer_same_name_phone_merge'; -- 0
--   SELECT SUM(total_usd) FROM sales WHERE customer_id IN (25000,25001,25040,25041,19739,24990,24969,24974,25004,20200,24980,24533,24989,20178,24991,20582,24988,20852,24998); -- record for the post-merge per-keeper check
--
-- ============================== POST-ASSERTION ============================
--   SELECT COUNT(*) FROM customer_merge_map_0166; -- one row per merged loser (>= 9)
--   SELECT COUNT(*) FROM customers WHERE id IN (SELECT loser_id FROM customer_merge_map_0166); -- 0
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0166_customer_same_name_phone_merge'; -- = map row count
--   SELECT COUNT(*) FROM sales WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166); -- 0
--   SELECT COUNT(*) FROM returns WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166); -- 0
--   SELECT COUNT(*) FROM customer_receivables WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166); -- 0
--   -- per-keeper sales sum after merge must equal the sum across its whole pre-merge cluster (JS-side check in verify script)
--   SELECT COUNT(*) FROM customer_merge_map_0166; -- unchanged after re-applying this file (idempotent)

CREATE TABLE IF NOT EXISTS customer_merge_map_0166 (
  loser_id INTEGER PRIMARY KEY,
  keeper_id INTEGER NOT NULL,
  cluster_key TEXT NOT NULL,
  loser_json TEXT NOT NULL,
  applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customer_merge_map_0166 (loser_id, keeper_id, cluster_key, loser_json)
WITH cluster_rows AS (
  SELECT id, LOWER(TRIM(name)) || CHAR(1) || TRIM(COALESCE(phone, '')) AS cluster_key
  FROM customers
),
keepers AS (
  SELECT cluster_key, MIN(id) AS keeper_id, COUNT(*) AS n
  FROM cluster_rows GROUP BY cluster_key HAVING COUNT(*) > 1
)
SELECT
  cr.id,
  k.keeper_id,
  cr.cluster_key,
  (SELECT json_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'address', c.address,
      'company', c.company, 'notes', c.notes, 'created_at', c.created_at,
      'membership_number', c.membership_number, 'updated_at', c.updated_at,
      'gender', c.gender, 'phone_normalized', c.phone_normalized)
   FROM customers c WHERE c.id = cr.id)
FROM cluster_rows cr
JOIN keepers k ON k.cluster_key = cr.cluster_key
WHERE cr.id <> k.keeper_id
  AND NOT EXISTS (SELECT 1 FROM customer_merge_map_0166 m WHERE m.loser_id = cr.id);

-- Keeper backfill (phone/email/address/company/notes/gender/membership_number)
-- happens AFTER the loser rows are deleted below, not here -- membership_
-- number sits under idx_customers_membership_lower_pg, a UNIQUE index on
-- lower(membership_number) (migration 0015). Writing a loser's membership_
-- number onto the keeper WHILE that same loser row (still holding that exact
-- value) has not been deleted yet collides with itself under that unique
-- index (SQLITE_CONSTRAINT_UNIQUE) -- confirmed by rehearsal against the
-- production replica. Deleting losers first, then backfilling the keeper
-- from their preserved loser_json, avoids the transient self-collision.

-- Repoint every customer_id-bearing table.
UPDATE sales SET customer_id = (SELECT keeper_id FROM customer_merge_map_0166 WHERE loser_id = sales.customer_id) WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166);
UPDATE returns SET customer_id = (SELECT keeper_id FROM customer_merge_map_0166 WHERE loser_id = returns.customer_id) WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166);
UPDATE customer_receivables SET customer_id = (SELECT keeper_id FROM customer_merge_map_0166 WHERE loser_id = customer_receivables.customer_id) WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166);
UPDATE loyalty_point_adjustments SET customer_id = (SELECT keeper_id FROM customer_merge_map_0166 WHERE loser_id = loyalty_point_adjustments.customer_id) WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166);
UPDATE customer_share_submissions SET customer_id = (SELECT keeper_id FROM customer_merge_map_0166 WHERE loser_id = customer_share_submissions.customer_id) WHERE customer_id IN (SELECT loser_id FROM customer_merge_map_0166);

-- One audit_logs row per merged loser, carrying its full pre-image (recovery).
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0166_customer_same_name_phone_merge', 'customer_same_name_phone_merge', 'customer', CAST(m.keeper_id AS TEXT),
  'customers', CAST(m.loser_id AS TEXT), m.loser_json,
  json_object('keeper_id', m.keeper_id, 'cluster_key', m.cluster_key)
FROM customer_merge_map_0166 m
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.user_name = 'migration:0166_customer_same_name_phone_merge' AND a.record_id = CAST(m.loser_id AS TEXT)
);

DELETE FROM customers WHERE id IN (SELECT loser_id FROM customer_merge_map_0166);

-- Keeper backfill: blank fields filled from the lowest-id loser carrying a
-- non-blank value. Name is never touched. Runs AFTER the DELETE above (see
-- the note before the repoint block) so membership_number's unique index
-- never sees the keeper and a not-yet-deleted loser holding the same value.
UPDATE customers SET
  phone = CASE WHEN COALESCE(NULLIF(phone, ''), '') <> '' THEN phone ELSE (
    SELECT json_extract(m.loser_json, '$.phone') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.phone'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  email = CASE WHEN COALESCE(NULLIF(email, ''), '') <> '' THEN email ELSE (
    SELECT json_extract(m.loser_json, '$.email') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.email'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  address = CASE WHEN COALESCE(NULLIF(address, ''), '') <> '' THEN address ELSE (
    SELECT json_extract(m.loser_json, '$.address') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.address'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  company = CASE WHEN COALESCE(NULLIF(company, ''), '') <> '' THEN company ELSE (
    SELECT json_extract(m.loser_json, '$.company') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.company'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  notes = CASE WHEN COALESCE(NULLIF(notes, ''), '') <> '' THEN notes ELSE (
    SELECT json_extract(m.loser_json, '$.notes') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.notes'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  gender = CASE WHEN COALESCE(NULLIF(gender, ''), '') <> '' THEN gender ELSE (
    SELECT json_extract(m.loser_json, '$.gender') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.gender'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  membership_number = CASE WHEN COALESCE(NULLIF(membership_number, ''), '') <> '' THEN membership_number ELSE (
    SELECT json_extract(m.loser_json, '$.membership_number') FROM customer_merge_map_0166 m
    WHERE m.keeper_id = customers.id AND COALESCE(NULLIF(json_extract(m.loser_json, '$.membership_number'), ''), '') <> ''
    ORDER BY m.loser_id ASC LIMIT 1) END,
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT DISTINCT keeper_id FROM customer_merge_map_0166);

-- 0164: merge the known production supplier duplicate clusters into their
-- oldest record ("j secrat" -> 20, "lang"/"Lang" -> 23).
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0163 is the
-- prior migration). Verified by scripts/verify-0164-supplier-clusters.cjs,
-- which seeds these exact clusters into a fresh local SQLite, runs this
-- file, compares the result against lib/contactMerge.ts buildContactMergePlan
-- (the writer the real Contacts -> Conflicts "/suppliers/merge" route uses)
-- applied pairwise to an identically seeded twin, and re-runs the file to
-- prove it is a no-op.
--
-- Why: P4-2's owner ruling ("for supplier prevent this issue from happening
-- just merge directly if same" / "also for migrations and merge. i want you
-- to do it for me.") supersedes P3-9's 409 same-name prompt (2deb30ec, live
-- 2e016e08) going forward for every future write (see routes/contacts.ts
-- checkContactDuplicateBlock, this same commit). This migration is the
-- one-time backfill for the duplicate rows that prompt already let through
-- before the auto-resolve existed.
--
-- CORRECTED cluster membership (coordinator, --remote SELECT-only,
-- 2026-09-15, superseding this file's first draft which used a wrong id
-- range for "lang"):
--   "j secrat": keeper 20, losers 38-46 (9 rows) -- unchanged from the
--   first draft, confirmed correct.
--   "lang"/"Lang": keeper 23, losers 33-37 ONLY (5 rows). Ids 24-32 are NINE
--   DIFFERENT suppliers (24 japen, 25 kaka, 26 UTB, 27 Malaysia, 28 naomi,
--   29 autralia, 30 france, 31 srun, 32 piset) that the first draft would
--   have wrongly deleted and repointed onto "Lang". They are NOT part of
--   this migration and must stay completely untouched.
--   Verified (coordinator, read-only): no other row anywhere carries
--   LOWER(TRIM(name)) IN ('j secrat', 'lang') outside these 14 ids.
--   All contact fields (phone/email/company/contact_person/address/notes)
--   are NULL on every row in both clusters, so the keeper backfill below is
--   a no-op in production today; it stays in the migration because the
--   twin-writer comparison in the verify script exercises it (and a future
--   re-run against a database where that is no longer true must still
--   backfill correctly).
--
-- NAME GUARD: every statement in every block additionally requires
--   LOWER(TRIM((SELECT name FROM suppliers WHERE id = <loser>)))
--     = LOWER(TRIM((SELECT name FROM suppliers WHERE id = <keeper>)))
-- so a wrong or stale id in this list is a no-op BY CONSTRUCTION -- not
-- merely because the row happens to be absent. This is the direct fix for
-- the first draft's bug: it had no such guard, so a wrong id (the "23-37"
-- range) would have matched and merged real, unrelated suppliers on id
-- alone. With the guard, even if this file is ever hand-edited to include
-- a wrong id again, that block becomes inert rather than merging the wrong
-- row.
--
-- What each block does, per loser id, mirroring buildContactMergePlan
-- exactly for table = 'suppliers' (cloudflare/src/lib/contactMerge.ts):
--   1. one audit_logs row carrying the loser's full pre-image (old_value),
--      the same recovery-first shape as 0163 -- NOT the single merge-summary
--      audit row buildContactMergePlan itself writes; this migration writes
--      one per merged id, on purpose, so each fold is independently
--      recoverable.
--   2. returns.supplier_id / supplier_name repointed to the keeper, by id.
--   3. product_batches.supplier_id / supplier_name repointed to the keeper,
--      by id.
--   4. products.supplier repointed to the keeper's name wherever it holds
--      the loser's name (case-/whitespace-insensitive), matching the
--      writer's name-based products repoint.
--   5. product_batches.supplier_name repointed the same way for orphaned
--      rows (supplier_id IS NULL) that still carry the loser's name text.
--   6. supplier_invoices repointed both by id and, for orphaned rows, by
--      name -- the table exists since migration 0088, so this always runs
--      (buildContactMergePlan only does this conditionally because a fresh
--      D1 database might predate 0088; this migration's own chain does not).
--   7. keeper backfill: any of phone/email/address/company/contact_person/
--      notes/gender that is NULL or '' on the keeper is filled from the
--      loser's value, in ascending loser-id order -- the same blank-check
--      buildContactMergePlan uses (contactMergeValueIsBlank: only NULL or
--      empty string is blank, never a whitespace-trimmed value). Name is
--      never touched on the keeper.
--   8. DELETE FROM suppliers WHERE id = <loser> AND <name guard>.
-- Every read of "the keeper's current name" and "the loser's current row"
-- uses a live subquery (SELECT ... FROM suppliers WHERE id = ...), not a
-- literal captured ahead of time, so later blocks in the same run see any
-- earlier backfill and so a second run (loser row already gone) makes
-- every later subquery return NULL and every guarded WHERE clause false --
-- idempotent by construction, not by a separate "already applied" flag.
--
-- PRE-ASSERTION (run before applying; expect both keepers present, all 14
-- losers present with names matching their keeper, zero audit rows already
-- stamped by this migration, and ids 24-32 present as NINE DIFFERENT,
-- unrelated suppliers that this file must never touch):
--   SELECT id, name FROM suppliers WHERE id IN (20, 23) ORDER BY id;
--   SELECT id, name FROM suppliers WHERE id BETWEEN 38 AND 46 ORDER BY id;   -- 9 rows, name ~ 'j secrat'
--   SELECT id, name FROM suppliers WHERE id BETWEEN 33 AND 37 ORDER BY id;   -- 5 rows, name ~ 'lang'
--   SELECT id, name FROM suppliers WHERE id BETWEEN 24 AND 32 ORDER BY id;   -- 9 DIFFERENT suppliers, must stay untouched
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters';   -- 0
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- pre-apply count for the 14 correct loser ids
--   SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- pre-apply count, same 14 ids
--   SELECT COUNT(*) FROM returns WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- 0 per the coordinator's read
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (24,25,26,27,28,29,30,31,32);   -- must be UNCHANGED after apply (control)
--   SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IN (24,25,26,27,28,29,30,31,32);   -- must be UNCHANGED after apply (control)
--
-- POST-ASSERTION (expect exactly the 14 loser ids gone from suppliers; both
-- keepers still present; every product_batches/returns/supplier_invoices row
-- that referenced one of the 14 loser ids now points at its keeper; ids
-- 24-32 and everything referencing them completely unchanged from the
-- PRE-ASSERTION reads above; 14 audit rows added):
--   SELECT COUNT(*) FROM suppliers WHERE id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- 0
--   SELECT id, name FROM suppliers WHERE id IN (20, 23) ORDER BY id;   -- both still present
--   SELECT id, name FROM suppliers WHERE id IN (24,25,26,27,28,29,30,31,32) ORDER BY id;   -- all 9 still present, unchanged names
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM returns WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (24,25,26,27,28,29,30,31,32);   -- unchanged vs PRE-ASSERTION
--   SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IN (24,25,26,27,28,29,30,31,32);   -- unchanged vs PRE-ASSERTION
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters';   -- 14
--
-- RECOVERY: each merged id's audit_logs row (user_name =
-- 'migration:0164_supplier_duplicate_clusters', record_id = the loser id)
-- carries the loser's full pre-image in old_value. Reinserting the row
-- restores the supplier record itself:
--   INSERT INTO suppliers (id, name, phone, email, address, company, contact_person, notes, gender, created_at)
--   SELECT CAST(a.record_id AS INTEGER),
--          json_extract(a.old_value, '$.name'), json_extract(a.old_value, '$.phone'),
--          json_extract(a.old_value, '$.email'), json_extract(a.old_value, '$.address'),
--          json_extract(a.old_value, '$.company'), json_extract(a.old_value, '$.contact_person'),
--          json_extract(a.old_value, '$.notes'), json_extract(a.old_value, '$.gender'),
--          json_extract(a.old_value, '$.created_at')
--   FROM audit_logs a
--   WHERE a.user_name = 'migration:0164_supplier_duplicate_clusters' AND a.record_id = '<loser id>'
--     AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = CAST(a.record_id AS INTEGER));
--   DELETE FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '<loser id>';
-- This restores the supplier row itself. It deliberately does NOT reverse
-- the downstream repoints (product_batches/returns/products/supplier_invoices
-- now pointing at the keeper): consolidating a known duplicate is this
-- migration's intended, permanent effect per the owner's ruling, and the
-- pre-image alone is not enough to know which specific downstream rows this
-- migration touched versus rows that already pointed at the keeper before
-- it ran. If a specific merge in this list turns out to be wrong, restore
-- the supplier row from its audit entry above, then manually repoint only
-- the downstream rows that are provably wrong (cross-referenced by their own
-- updated_at against this migration's apply time), rather than reversing
-- the whole cluster.
--
-- Loser list is exactly 38,39,40,41,42,43,44,45,46 (-> 20) and
-- 33,34,35,36,37 (-> 23). Fourteen blocks, fourteen audit rows. Ids 24-32
-- do not appear anywhere below.

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 38
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 38
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '38');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 38)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 38)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 38)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 38) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 38) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 38) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 38) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 38) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 38) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 38) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 38
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 38))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 39
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 39
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '39');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 39)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 39)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 39)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 39) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 39) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 39) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 39) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 39) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 39) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 39) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 39
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 39))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 40
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 40
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '40');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 40)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 40)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 40)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 40) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 40) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 40) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 40) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 40) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 40) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 40) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 40
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 40))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 41
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 41
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '41');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 41)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 41)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 41)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 41) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 41) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 41) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 41) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 41) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 41) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 41) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 41
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 41))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 42
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 42
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '42');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 42)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 42)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 42)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 42) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 42) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 42) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 42) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 42) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 42) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 42) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 42
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 42))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 43
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 43
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '43');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 43)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 43)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 43)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 43) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 43) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 43) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 43) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 43) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 43) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 43) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 43
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 43))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 44
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 44
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '44');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 44)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 44)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 44)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 44) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 44) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 44) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 44) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 44) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 44) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 44) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 44
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 44))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 45
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 45
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '45');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 45)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 45)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 45)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 45) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 45) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 45) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 45) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 45) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 45) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 45) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 45
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 45))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 46
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 46
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '46');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 46)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 46)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 46)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 46) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 46) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 46) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 46) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 46) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 46) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 46) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 20
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

DELETE FROM suppliers WHERE id = 46
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 46))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 20)));

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 33
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 33
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '33');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 33)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 33)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 33)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 33) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 33) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 33) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 33) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 33) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 33) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 33) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

DELETE FROM suppliers WHERE id = 33
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 33))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 34
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 34
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '34');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 34)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 34)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 34)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 34) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 34) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 34) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 34) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 34) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 34) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 34) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

DELETE FROM suppliers WHERE id = 34
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 34))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 35
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 35
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '35');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 35)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 35)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 35)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 35) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 35) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 35) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 35) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 35) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 35) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 35) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

DELETE FROM suppliers WHERE id = 35
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 35))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 36
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 36
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '36');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 36)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 36)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 36)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 36) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 36) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 36) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 36) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 36) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 36) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 36) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

DELETE FROM suppliers WHERE id = 36
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 36))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 37
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 37
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '37');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 37)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 37)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)))
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 37)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 37) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 37) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 37) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 37) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 37) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 37) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 37) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

DELETE FROM suppliers WHERE id = 37
  AND LOWER(TRIM((SELECT name FROM suppliers WHERE id = 37))) = LOWER(TRIM((SELECT name FROM suppliers WHERE id = 23)));

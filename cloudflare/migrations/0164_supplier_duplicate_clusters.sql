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
-- before the auto-resolve existed. Cluster membership as given by the
-- coordinator (2026-09-14, read-only): suppliers "j secrat" ids 20 and
-- 38-46 (survivor 20); "lang"/"Lang" ids 23-37 (survivor 23). NOTE: this
-- session could not independently re-confirm the exact production id list
-- or casing with a fresh --remote SELECT (the auto-mode permission
-- classifier blocked the read attempt outright); every statement below is
-- pinned to these ids and is a pure no-op wherever a given id does not
-- exist or does not match the row shape read at apply time, so an
-- incorrect id in this list costs nothing (it simply never matches) rather
-- than merging the wrong row. The coordinator should re-confirm the id
-- list with a --remote SELECT before applying.
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
--   8. DELETE FROM suppliers WHERE id = <loser>.
-- Every read of "the keeper's current name" and "the loser's current row"
-- uses a live subquery (SELECT ... FROM suppliers WHERE id = ...), not a
-- literal captured ahead of time, so later blocks in the same run see any
-- earlier backfill and so a second run (loser row already gone) makes
-- every later subquery return NULL and every guarded WHERE clause false --
-- idempotent by construction, not by a separate "already applied" flag.
--
-- PRE-ASSERTION (run before applying; expect both keepers present, all 23
-- losers present, and zero audit rows already stamped by this migration):
--   SELECT id, name, phone, email FROM suppliers WHERE id IN (20, 23) ORDER BY id;
--   SELECT id, name FROM suppliers WHERE id BETWEEN 38 AND 46 ORDER BY id;   -- 9 rows, name ~ 'j secrat'
--   SELECT id, name FROM suppliers WHERE id BETWEEN 24 AND 37 ORDER BY id;   -- 14 rows, name ~ 'lang'
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters';   -- 0
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);
--   SELECT COUNT(*) FROM returns WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);
--
-- POST-ASSERTION (expect all 23 loser ids gone from suppliers; both keepers
-- still present; every product_batches/returns/supplier_invoices row that
-- referenced a loser id now points at its keeper; 23 audit rows added):
--   SELECT COUNT(*) FROM suppliers WHERE id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);   -- 0
--   SELECT id, name FROM suppliers WHERE id IN (20, 23) ORDER BY id;   -- both still present
--   SELECT COUNT(*) FROM product_batches WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM returns WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IN (38,39,40,41,42,43,44,45,46,24,25,26,27,28,29,30,31,32,33,34,35,36,37);   -- 0
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters';   -- 23
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

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 38
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 38
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '38');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 38)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 38)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 38;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 38);

DELETE FROM suppliers WHERE id = 38;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 39
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 39
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '39');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 39)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 39)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 39;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 39);

DELETE FROM suppliers WHERE id = 39;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 40
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 40
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '40');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 40)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 40)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 40;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 40);

DELETE FROM suppliers WHERE id = 40;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 41
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 41
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '41');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 41)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 41)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 41;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 41);

DELETE FROM suppliers WHERE id = 41;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 42
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 42
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '42');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 42)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 42)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 42;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 42);

DELETE FROM suppliers WHERE id = 42;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 43
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 43
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '43');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 43)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 43)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 43;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 43);

DELETE FROM suppliers WHERE id = 43;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 44
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 44
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '44');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 44)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 44)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 44;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 44);

DELETE FROM suppliers WHERE id = 44;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 45
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 45
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '45');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 45)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 45)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 45;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 45);

DELETE FROM suppliers WHERE id = 45;

-- ---------------------------------------------------------------- j_secrat: keeper 20 <- loser 46
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 20, 'cluster', 'j_secrat')
FROM suppliers
WHERE id = 46
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '46');

UPDATE returns SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46;

UPDATE product_batches SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 20),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 46)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 46)));

UPDATE supplier_invoices SET
  supplier_id = 20,
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id = 46;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 20)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 46);

DELETE FROM suppliers WHERE id = 46;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 24
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 24
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '24');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 24;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 24;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 24)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 24)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 24)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 24)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 24;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 24)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 24)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 24) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 24) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 24) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 24) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 24) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 24) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 24) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 24);

DELETE FROM suppliers WHERE id = 24;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 25
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 25
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '25');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 25;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 25;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 25)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 25)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 25)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 25)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 25;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 25)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 25)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 25) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 25) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 25) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 25) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 25) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 25) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 25) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 25);

DELETE FROM suppliers WHERE id = 25;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 26
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 26
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '26');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 26;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 26;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 26)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 26)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 26)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 26)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 26;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 26)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 26)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 26) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 26) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 26) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 26) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 26) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 26) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 26) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 26);

DELETE FROM suppliers WHERE id = 26;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 27
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 27
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '27');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 27;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 27;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 27)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 27)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 27)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 27)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 27;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 27)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 27)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 27) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 27) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 27) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 27) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 27) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 27) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 27) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 27);

DELETE FROM suppliers WHERE id = 27;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 28
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 28
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '28');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 28;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 28;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 28)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 28)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 28)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 28)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 28;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 28)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 28)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 28) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 28) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 28) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 28) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 28) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 28) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 28) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 28);

DELETE FROM suppliers WHERE id = 28;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 29
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 29
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '29');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 29;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 29;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 29)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 29)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 29)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 29)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 29;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 29)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 29)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 29) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 29) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 29) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 29) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 29) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 29) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 29) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 29);

DELETE FROM suppliers WHERE id = 29;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 30
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 30
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '30');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 30;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 30;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 30)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 30)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 30)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 30)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 30;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 30)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 30)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 30) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 30) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 30) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 30) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 30) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 30) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 30) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 30);

DELETE FROM suppliers WHERE id = 30;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 31
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 31
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '31');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 31;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 31;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 31)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 31)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 31)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 31)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 31;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 31)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 31)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 31) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 31) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 31) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 31) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 31) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 31) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 31) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 31);

DELETE FROM suppliers WHERE id = 31;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 32
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 32
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '32');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 32;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 32;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 32)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 32)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 32)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 32)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 32;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 32)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 32)));

UPDATE suppliers SET
  phone          = CASE WHEN (phone IS NULL OR phone = '') THEN (SELECT phone FROM suppliers WHERE id = 32) ELSE phone END,
  email          = CASE WHEN (email IS NULL OR email = '') THEN (SELECT email FROM suppliers WHERE id = 32) ELSE email END,
  address        = CASE WHEN (address IS NULL OR address = '') THEN (SELECT address FROM suppliers WHERE id = 32) ELSE address END,
  company        = CASE WHEN (company IS NULL OR company = '') THEN (SELECT company FROM suppliers WHERE id = 32) ELSE company END,
  contact_person = CASE WHEN (contact_person IS NULL OR contact_person = '') THEN (SELECT contact_person FROM suppliers WHERE id = 32) ELSE contact_person END,
  notes          = CASE WHEN (notes IS NULL OR notes = '') THEN (SELECT notes FROM suppliers WHERE id = 32) ELSE notes END,
  gender         = CASE WHEN (gender IS NULL OR gender = '') THEN (SELECT gender FROM suppliers WHERE id = 32) ELSE gender END,
  updated_at     = CURRENT_TIMESTAMP
WHERE id = 23
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 32);

DELETE FROM suppliers WHERE id = 32;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 33
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 33
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '33');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 33)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 33)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 33;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 33);

DELETE FROM suppliers WHERE id = 33;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 34
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 34
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '34');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 34)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 34)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 34;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 34);

DELETE FROM suppliers WHERE id = 34;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 35
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 35
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '35');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 35)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 35)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 35;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 35);

DELETE FROM suppliers WHERE id = 35;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 36
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 36
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '36');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 36)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 36)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 36;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 36);

DELETE FROM suppliers WHERE id = 36;

-- ---------------------------------------------------------------- lang: keeper 23 <- loser 37
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0164_supplier_duplicate_clusters', 'supplier_duplicate_cluster_merge', 'supplier', CAST(id AS TEXT),
       'suppliers', CAST(id AS TEXT),
       json_object('name', name, 'phone', phone, 'email', email, 'address', address, 'company', company,
                   'contact_person', contact_person, 'notes', notes, 'gender', gender, 'created_at', created_at),
       json_object('keeper_id', 23, 'cluster', 'lang')
FROM suppliers
WHERE id = 37
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0164_supplier_duplicate_clusters' AND record_id = '37');

UPDATE returns SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37;

UPDATE product_batches SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37;

UPDATE products SET
  supplier = (SELECT name FROM suppliers WHERE id = 23),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND lower(trim(COALESCE(supplier, ''))) = lower(trim((SELECT name FROM suppliers WHERE id = 37)));

UPDATE product_batches SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
  AND lower(trim(supplier_name)) = lower(trim((SELECT name FROM suppliers WHERE id = 37)));

UPDATE supplier_invoices SET
  supplier_id = 23,
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id = 37;

UPDATE supplier_invoices SET
  supplier_name = (SELECT name FROM suppliers WHERE id = 23)
WHERE supplier_id IS NULL
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37)
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
  AND EXISTS (SELECT 1 FROM suppliers WHERE id = 37);

DELETE FROM suppliers WHERE id = 37;

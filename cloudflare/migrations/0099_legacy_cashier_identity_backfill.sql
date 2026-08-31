-- 0099: legacy cashier identity backfill. Links the migrated legacy cashiers to
-- their real user accounts by id (the source of truth) and normalizes the
-- denormalized cashier_name snapshot to the account's CURRENT username, so the
-- historical data matches what importEngine now resolves at import time and what
-- the POS now stores for new sales (username + cashier_id FK).
--
-- Depends on 0098 (user_aliases). "Aza" and "Dev-Usmart" are legacy nicknames
-- that equal no username ("aza" != username "Za"; "Dev-Usmart" maps to admin),
-- so they resolve ONLY through the alias table. "Sethyka" and "Rath" resolve
-- directly by username. Every UPDATE resolves the target id/username LIVE from
-- users/user_aliases -- never a hard-coded id -- so it is environment-safe
-- across dev/prod and survives a later username rename (the alias is keyed by
-- the stable user_id).
--
-- Scope is deliberately narrow. Only the identified legacy cohorts are touched:
-- the deleted-items audit rows (2,234: Aza/Sethyka/Dev-Usmart/Rath) and the 40
-- Aug-30 legacy sales imported under the nickname "Aza". The ~14.9k bulk-import
-- sales carry no source-of-record cashier and stay NULL; nothing here invents
-- attribution for them. (Aug-31's 14 sales are not yet imported; the fixed
-- import-aug31 script attributes them to Rath at apply time, so no backfill is
-- needed here.)
--
-- Every statement below is independently idempotent: after the first run the
-- cashier_name no longer equals the legacy value (or cashier_id is already set),
-- so a re-run of the data statements changes nothing. The one-time ADD COLUMN
-- relies on the migration runner's apply-once semantics, same as 0093.

-- (1) Deleted-items audit snapshot had a cashier NAME only; add the id link.
ALTER TABLE legacy_deleted_sale_items ADD COLUMN cashier_id INTEGER;

-- (2) Resolve each deleted-item row's cashier_id from username / name / alias,
--     filling only rows not yet linked. The known cohort is unambiguous.
UPDATE legacy_deleted_sale_items
SET cashier_id = (
  SELECT u.id FROM users u
  WHERE lower(trim(u.username)) = lower(trim(legacy_deleted_sale_items.cashier_name))
     OR lower(trim(u.name))     = lower(trim(legacy_deleted_sale_items.cashier_name))
     OR EXISTS (
       SELECT 1 FROM user_aliases a
       WHERE a.user_id = u.id
         AND lower(trim(a.alias)) = lower(trim(legacy_deleted_sale_items.cashier_name))
     )
  LIMIT 1
)
WHERE cashier_id IS NULL
  AND cashier_name IS NOT NULL
  AND trim(cashier_name) != '';

-- (3) Normalize the deleted-items cashier_name snapshot to the linked username.
UPDATE legacy_deleted_sale_items
SET cashier_name = (SELECT u.username FROM users u WHERE u.id = legacy_deleted_sale_items.cashier_id)
WHERE cashier_id IS NOT NULL
  AND cashier_name != (SELECT u.username FROM users u WHERE u.id = legacy_deleted_sale_items.cashier_id);

-- (4) Aug-30 legacy sales: 40 receipts imported with the nickname "Aza" and no
--     id link. Resolve to the real account through the alias (aza -> "Za") and
--     normalize the display name to that account's current username.
UPDATE sales
SET cashier_id = (SELECT user_id FROM user_aliases WHERE lower(trim(alias)) = 'aza' LIMIT 1),
    cashier_name = (
      SELECT u.username FROM users u
      JOIN user_aliases a ON a.user_id = u.id
      WHERE lower(trim(a.alias)) = 'aza' LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE cashier_name = 'Aza'
  AND EXISTS (SELECT 1 FROM user_aliases WHERE lower(trim(alias)) = 'aza');

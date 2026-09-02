-- Canonical legacy cashier overrides (Sep 2 2026).
--
-- 0098 originally omitted labels that happened to equal a username. That is
-- incorrect for the reviewed old-system identity rule: Sethyka and Pagna both
-- mean James. This migration is needed for already-migrated databases; 0098 is
-- also corrected so a fresh database reaches the same state.

WITH canonical(uname, alias) AS (
  VALUES
    ('Za', 'aza'),
    ('Rath', 'rout'),
    ('Rath', 'routh'),
    ('james', 'sethyka'),
    ('james', 'pagna'),
    ('admin', 'super admin'),
    ('admin', 'dev-usmart')
)
UPDATE user_aliases
SET user_id = (
  SELECT u.id
  FROM canonical c
  JOIN users u ON lower(trim(u.username)) = lower(trim(c.uname))
  WHERE lower(trim(c.alias)) = lower(trim(user_aliases.alias))
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM canonical c
  JOIN users u ON lower(trim(u.username)) = lower(trim(c.uname))
  WHERE lower(trim(c.alias)) = lower(trim(user_aliases.alias))
);

WITH canonical(uname, alias) AS (
  VALUES
    ('Za', 'aza'),
    ('Rath', 'rout'),
    ('Rath', 'routh'),
    ('james', 'sethyka'),
    ('james', 'pagna'),
    ('admin', 'super admin'),
    ('admin', 'dev-usmart')
)
INSERT OR IGNORE INTO user_aliases (user_id, alias)
SELECT u.id, c.alias
FROM canonical c
JOIN users u ON lower(trim(u.username)) = lower(trim(c.uname));

-- 0099 already normalized the seven deleted-item audit rows to the inactive
-- username `sethyka` in production. Correct only rows whose current label has
-- an explicit alias; unrelated historical names remain untouched.
UPDATE legacy_deleted_sale_items
SET cashier_id = (
      SELECT a.user_id FROM user_aliases a
      WHERE lower(trim(a.alias)) = lower(trim(legacy_deleted_sale_items.cashier_name))
      LIMIT 1
    ),
    cashier_name = (
      SELECT u.username
      FROM user_aliases a JOIN users u ON u.id = a.user_id
      WHERE lower(trim(a.alias)) = lower(trim(legacy_deleted_sale_items.cashier_name))
      LIMIT 1
    )
WHERE lower(trim(COALESCE(cashier_name, ''))) IN ('aza','rout','routh','sethyka','pagna','super admin','dev-usmart')
  AND EXISTS (
    SELECT 1 FROM user_aliases a
    WHERE lower(trim(a.alias)) = lower(trim(legacy_deleted_sale_items.cashier_name))
  );

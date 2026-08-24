-- Backing table for the admin "Possible Duplicates" review panel's Dismiss
-- action (lib/contactDuplicates.ts's findDuplicateContactClusters, routes/
-- contacts.ts's GET .../duplicates -- both already existed with no
-- frontend surface until this session). A cluster is computed fresh on
-- every sweep (grouped live off name/phone, never stored), so without
-- persisting a "not actually a duplicate" decision somewhere, dismissing
-- a name-collision cluster (the common false-positive case -- two
-- genuinely different people who happen to share a name) would only last
-- until the next page load.
--
-- Scoped to the (table, cluster type, cluster value) the panel already
-- groups by -- e.g. ('customers', 'name', 'sok dara') -- not to a specific
-- pair of ids. Simpler than per-pair dismissal and matches what the panel
-- actually renders one row for; the tradeoff (documented in
-- contactDuplicates.ts) is that a dismissal doesn't follow if a THIRD
-- contact later joins the same name/phone -- it resurfaces as a fresh
-- cluster for a human to glance at again, which is the safer direction
-- for a dismissal to fail in.
CREATE TABLE IF NOT EXISTS contact_duplicate_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_table TEXT NOT NULL,
  cluster_type TEXT NOT NULL,
  cluster_value TEXT NOT NULL,
  dismissed_by_id INTEGER,
  dismissed_by_name TEXT,
  dismissed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_dup_dismissals_key
  ON contact_duplicate_dismissals(contact_table, cluster_type, cluster_value);

-- Backing table for the Products "Duplicates" review section's Dismiss
-- action (lib/productIdentity.ts's findPossiblySameProductClusters,
-- routes/products.ts's GET /possible-duplicates). Mirrors
-- 0034_contact_duplicate_dismissals.sql for the product-catalog sweep:
-- clusters are computed live off barcode/name_key on every sweep, never
-- stored, so a "reviewed, genuinely two different items" decision (the
-- common case -- e.g. an EDP and an EDT sharing one manufacturer barcode,
-- or two shades under one display name) must persist somewhere or it
-- resurfaces on every page load.
--
-- Scoped to (cluster type, cluster value) -- e.g. ('barcode',
-- '0840122906435') or ('name', 'rare hand cream 53ml') -- not to specific
-- product ids, so a dismissal covers the cluster the reviewer actually
-- looked at; if a THIRD product later joins the same barcode/name it
-- resurfaces as a fresh cluster, the safer direction to fail in.
CREATE TABLE IF NOT EXISTS product_duplicate_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_type TEXT NOT NULL,
  cluster_value TEXT NOT NULL,
  dismissed_by_id INTEGER,
  dismissed_by_name TEXT,
  dismissed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_dup_dismissals_key
  ON product_duplicate_dismissals(cluster_type, cluster_value);

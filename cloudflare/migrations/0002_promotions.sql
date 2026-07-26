-- Adds the promotions table (Announcement Strip feature), matching the
-- table added to the live Postgres schema in backend/src/postgresDatabase.ts.
-- 0001_init.sql was generated from backend/src/db/postgresSchema.sql before
-- that table existed in the Docker/Postgres path, so it never made it into
-- the D1 schema until now -- this migration closes that gap.

CREATE TABLE promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT,
  image_path TEXT,
  link_type TEXT DEFAULT 'none',
  link_product_id INTEGER,
  link_url TEXT,
  badge_text TEXT,
  badge_color TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_promotions_active_sort ON promotions(is_active, sort_order, id);

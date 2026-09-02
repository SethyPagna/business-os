-- Categories and units are canonical lookup values, not free-form contacts.
-- Production was verified before this migration: both lookup tables contain
-- zero rows, while existing product text remains independent and is carried
-- only through an explicit rename/merge choice. Therefore these expression
-- indexes cannot collide with existing lookup rows and safely close the
-- concurrent create/rename race at the database boundary.
--
-- Do not copy this policy to suppliers or customers: their stable ids are the
-- identity and two legitimate records may share the same display name.
DROP INDEX IF EXISTS idx_categories_name_lower_pg;
DROP INDEX IF EXISTS idx_units_name_lower_pg;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_normalized_unique
  ON categories(lower(trim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_units_name_normalized_unique
  ON units(lower(trim(name)));

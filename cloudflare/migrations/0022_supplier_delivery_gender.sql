-- Extends the customer-only `gender` column (migration 0017) to
-- `suppliers` and `delivery_contacts` so all three contact types have the
-- same optional, single-value gender field -- previously only customers
-- had it, which meant suppliers/delivery contacts imported or edited with
-- a Gender column had nowhere for that value to land. Same shape as
-- 0017: nullable free-text, not a CHECK/ENUM (D1/SQLite has no native
-- enum), normalized at the edges to 'male' | 'female' | 'other' | null by
-- the same normalizeContactGender() importEngine.ts already uses for
-- customers, and offered as a Male/Female/Other/Unspecified dropdown in
-- SupplierFormModal/DeliveryFormModal exactly like CustomerFormModal's.
-- No backfill needed: every existing row starts NULL ("Unspecified").

ALTER TABLE suppliers ADD COLUMN gender TEXT;
ALTER TABLE delivery_contacts ADD COLUMN gender TEXT;

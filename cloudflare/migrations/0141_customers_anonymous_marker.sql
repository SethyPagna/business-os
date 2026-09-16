-- An anonymous checkout identity is not a customer profile. Keep the marker
-- explicit so a real person or business named "General" is never inferred to
-- be anonymous from display text or a missing phone number.
--
-- This schema migration intentionally marks no rows. Production identities
-- must be reviewed and marked separately with exact row/version guards.
ALTER TABLE customers
  ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0
  CHECK (is_anonymous IN (0, 1));

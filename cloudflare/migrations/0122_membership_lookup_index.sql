-- Match the authenticated lookup and collision check expression exactly.
-- Non-unique: legacy IDs remain untouched; existing unique index still rules writes.
CREATE INDEX IF NOT EXISTS idx_customers_membership_normalized
ON customers(lower(trim(membership_number)));

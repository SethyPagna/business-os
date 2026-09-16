-- Preserve append-only sale amendments in ordinary use, while restoring them
-- with the rest of the business ledger under the existing maintenance gate.
-- No data changes. Recovery: retain the trigger and roll back application code.
DROP TRIGGER IF EXISTS sale_amendments_append_only_delete;
CREATE TRIGGER sale_amendments_append_only_delete
BEFORE DELETE ON sale_amendments
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'sale amendments are immutable');
END;

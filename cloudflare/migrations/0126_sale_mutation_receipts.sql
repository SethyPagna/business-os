-- Durable, actor-scoped idempotency receipts for monetary sale mutations.
-- Schema only: this migration changes no sale, tender, stock, or accounting value.
-- Pre/post: sales and sale_items counts and all money/stock sums must be identical.
-- Recovery: roll back code while retaining these receipts; never discard replay provenance.
CREATE TABLE sale_mutation_receipts (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  mutation_kind TEXT NOT NULL CHECK(mutation_kind IN ('settlement', 'add_items', 'amendment')),
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  sale_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, mutation_kind, request_id)
);

CREATE INDEX idx_sale_mutation_receipts_sale ON sale_mutation_receipts(sale_id, created_at);
CREATE INDEX idx_sale_mutation_receipts_history ON sale_mutation_receipts(history_id) WHERE history_id IS NOT NULL;

-- Dynamic row ids (new sale lines and amendment-ledger entries) are captured
-- inside the mutation batch with SQLite's last_insert_rowid(). A retry can
-- therefore reconstruct the first committed outcome without re-running it.
CREATE TABLE sale_mutation_members (
  operation_id TEXT NOT NULL REFERENCES sale_mutation_receipts(id),
  entity_kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(operation_id, entity_kind, ordinal)
);

CREATE INDEX idx_sale_mutation_members_entity ON sale_mutation_members(entity_kind, entity_id);

CREATE TABLE sale_mutation_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

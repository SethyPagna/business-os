-- Durable draft receipts for one global Products > Conflicts action review.
-- Draft rows are read-only until an actor finalizes and applies a reviewed
-- manifest. Apply then records one atomic member receipt per destructive fold
-- and one resumable group history whose children restore exact linked state.
-- Pre-release assertions: every non-null member undo_snapshot_id resolves to a
-- product.merge.group.child snapshot; every group action_history_id resolves to
-- one server-managed product.merge.group action; group/member status partitions
-- and review counts balance. Recovery: roll back the route while retaining
-- receipts and snapshots. Never drop receipt rows as a product-data rollback;
-- use the registered group Undo path for applied members.

CREATE TABLE product_conflict_action_reviews (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
  resolution_version INTEGER NOT NULL CHECK (resolution_version = 2),
  draft_digest TEXT NOT NULL,
  finalize_digest TEXT,
  manifest_digest TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'running', 'completed', 'interrupted', 'expired')),
  requested_group_count INTEGER NOT NULL CHECK (requested_group_count >= 1 AND requested_group_count <= 1600),
  actionable_group_count INTEGER NOT NULL CHECK (actionable_group_count >= 0),
  blocked_group_count INTEGER NOT NULL CHECK (blocked_group_count >= 0),
  total_member_count INTEGER NOT NULL CHECK (total_member_count >= 2 AND total_member_count <= 4000),
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE product_conflict_action_groups (
  review_id TEXT NOT NULL REFERENCES product_conflict_action_reviews(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 1600),
  group_key TEXT NOT NULL,
  source_group_keys_json TEXT NOT NULL CHECK (json_valid(source_group_keys_json) AND json_type(source_group_keys_json) = 'array'),
  member_ids_json TEXT NOT NULL CHECK (json_valid(member_ids_json) AND json_type(member_ids_json) = 'array'),
  eligibility_basis TEXT CHECK (eligibility_basis IS NULL OR eligibility_basis IN ('name', 'barcode')),
  eligibility_value TEXT,
  status TEXT NOT NULL CHECK (status IN ('actionable', 'blocked', 'ready', 'running', 'partial', 'completed', 'refused', 'reversed')),
  blocker_code TEXT,
  blocker_message TEXT,
  state_digest TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  final_plan_json TEXT CHECK (final_plan_json IS NULL OR json_valid(final_plan_json)),
  operation_id TEXT UNIQUE,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  reversal_generation INTEGER NOT NULL DEFAULT 0 CHECK (reversal_generation >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, ordinal),
  UNIQUE (review_id, group_key),
  CHECK ((status = 'blocked') = (blocker_code IS NOT NULL)),
  CHECK ((blocker_code IS NULL) = (blocker_message IS NULL))
);

CREATE TABLE product_conflict_action_group_members (
  review_id TEXT NOT NULL,
  group_ordinal INTEGER NOT NULL,
  member_ordinal INTEGER NOT NULL CHECK (member_ordinal >= 0 AND member_ordinal < 4000),
  -- A reviewed id can disappear between client discovery and authoritative
  -- preview. Retain that id in the blocked receipt instead of failing the
  -- whole review through a products FK.
  product_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'candidate' CHECK (role IN ('candidate', 'keeper', 'merged')),
  status TEXT NOT NULL DEFAULT 'reviewed'
    CHECK (status IN ('reviewed', 'planned', 'committed', 'history_pending', 'undo_ready', 'refused', 'reversed')),
  state_digest TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  operation_id TEXT UNIQUE,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  undo_snapshot_id INTEGER REFERENCES undo_snapshots(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, group_ordinal, member_ordinal),
  UNIQUE (review_id, product_id),
  FOREIGN KEY (review_id, group_ordinal)
    REFERENCES product_conflict_action_groups(review_id, ordinal) ON DELETE CASCADE
);

CREATE INDEX idx_product_conflict_action_reviews_actor_status
ON product_conflict_action_reviews(actor_id, status, updated_at, id);

CREATE INDEX idx_product_conflict_action_reviews_actor_expiry
ON product_conflict_action_reviews(actor_id, expires_at, id);

CREATE INDEX idx_product_conflict_action_groups_page
ON product_conflict_action_groups(review_id, ordinal, status);

CREATE INDEX idx_product_conflict_action_members_product
ON product_conflict_action_group_members(product_id, review_id);

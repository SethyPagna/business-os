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
    CHECK (status IN ('draft', 'finalized', 'running', 'completed', 'interrupted', 'approval_pending', 'expired')),
  requested_action_count INTEGER NOT NULL CHECK (requested_action_count >= 1 AND requested_action_count <= 1600),
  requested_group_count INTEGER NOT NULL CHECK (requested_group_count >= 0 AND requested_group_count <= 1600),
  requested_removal_count INTEGER NOT NULL CHECK (requested_removal_count >= 0 AND requested_removal_count <= 1600),
  actionable_group_count INTEGER NOT NULL CHECK (actionable_group_count >= 0),
  blocked_group_count INTEGER NOT NULL CHECK (blocked_group_count >= 0),
  total_member_count INTEGER NOT NULL CHECK (total_member_count >= 0 AND total_member_count <= 4000),
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id),
  CHECK (requested_action_count = requested_group_count + requested_removal_count)
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

CREATE TABLE product_remove_operations (
  operation_id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  requester_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct', 'conflict_review')),
  request_id TEXT NOT NULL,
  review_id TEXT REFERENCES product_conflict_action_reviews(id) ON DELETE CASCADE,
  action_ordinal INTEGER,
  product_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  state_digest TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND json_type(plan_json) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('reviewed', 'blocked', 'ready', 'approval_pending', 'undo_ready', 'refused', 'reversed')),
  blocker_code TEXT,
  error_message TEXT,
  pending_action_id INTEGER REFERENCES pending_actions(id) ON DELETE SET NULL,
  undo_snapshot_id INTEGER REFERENCES undo_snapshots(id) ON DELETE SET NULL,
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  last_transition_request_id TEXT,
  last_transition_direction TEXT CHECK (last_transition_direction IS NULL OR last_transition_direction IN ('apply', 'undo', 'redo')),
  last_transition_from_generation INTEGER,
  last_transition_to_generation INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, source, request_id),
  UNIQUE (review_id, action_ordinal),
  UNIQUE (review_id, product_id),
  CHECK ((source = 'conflict_review') = (review_id IS NOT NULL AND action_ordinal IS NOT NULL)),
  CHECK ((status = 'blocked') = (blocker_code IS NOT NULL))
);

CREATE INDEX idx_product_conflict_action_reviews_actor_status
ON product_conflict_action_reviews(actor_id, status, updated_at, id);

CREATE INDEX idx_product_conflict_action_reviews_actor_expiry
ON product_conflict_action_reviews(actor_id, expires_at, id);

CREATE INDEX idx_product_conflict_action_groups_page
ON product_conflict_action_groups(review_id, ordinal, status);

CREATE INDEX idx_product_conflict_action_members_product
ON product_conflict_action_group_members(product_id, review_id);

CREATE INDEX idx_product_remove_operations_review_status
ON product_remove_operations(review_id, action_ordinal, status);

CREATE INDEX idx_product_remove_operations_product
ON product_remove_operations(product_id, status, operation_id);

-- Bulk-delete jobs: the delete-side counterpart to import_jobs. Backs
-- POST /api/products/bulk-delete-jobs (products first; ENTITY_CONFIGS in
-- lib/bulkDeleteEngine.ts is written so another entity type can register
-- into the same table+queue later without a new migration).
--
-- Why not just add rows to import_jobs? That table's schema is really
-- shaped for CSV/analyze-then-apply imports (total_images, policy_json for
-- import policy, etc.) -- reusing it for deletes would mean either ignoring
-- half its columns or overloading their meaning. A dedicated table with
-- exactly the columns a delete job needs is clearer to read a year from
-- now, at the cost of one small migration. The QUEUE is still shared with
-- imports (see wrangler.toml's IMPORT_QUEUE binding and queue.ts) rather
-- than provisioning a new Cloudflare Queue resource, since that requires a
-- `wrangler queues create` step this environment can't run.
--
-- ids_json holds the full id list up front (a 10k-row TEXT payload of
-- integers is tens of KB, comfortably inside D1's row-size limit) so the
-- queue consumer is stateless between invocations: it re-reads ids_json,
-- slices from `cursor`, and only needs to persist `cursor`/counts as it
-- goes -- same resumability shape as import_jobs' chunk state, without a
-- separate chunk-state table.
CREATE TABLE bulk_delete_jobs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,           -- 'products' today; see ENTITY_CONFIGS
  status TEXT DEFAULT 'pending' NOT NULL, -- pending | processing | completed | failed | cancelled
  reason TEXT NOT NULL,                -- same mandatory-reason rule as single delete
  ids_json TEXT NOT NULL,              -- JSON array of the ids to delete, fixed at job creation
  total_count INTEGER NOT NULL,
  processed_count INTEGER DEFAULT 0 NOT NULL, -- doubles as the resume cursor into ids_json
  failed_count INTEGER DEFAULT 0 NOT NULL,
  failed_ids_json TEXT DEFAULT '[]',   -- ids D1 rejected (e.g. FK issue) -- surfaced back to the UI, not silently dropped
  cancel_requested INTEGER DEFAULT 0 NOT NULL,
  last_error TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX idx_bulk_delete_jobs_status ON bulk_delete_jobs(status, updated_at);

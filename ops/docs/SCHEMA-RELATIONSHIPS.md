# Business OS Relational Schema And Data-Layer Audit

Last updated: 2026-05-27

Current plan position: Phase 6 schema audit green; Phase 8.4 loader/action
stability sweep active; Phase 26 preserved at 51 completed moves; Phase 28
active with R2 prune follow-up; Phase 29 active as the recurring
whole-codebase/schema/cleanup guardrail.

## Scope

This document is the working relational schema map for Business OS. It was built from repeated scans of:

- `backend/src/db/postgresSchema.sql`
- `backend/src/postgresDatabase.js`
- `backend/src/systemJobs.js`
- `backend/src/routes/**/*.js`
- `backend/src/services/**/*.js`
- `backend/src/backupSchema.js`
- `frontend/src/api/localDb.ts`
- `frontend/src/api/methods.js`
- runtime configuration in `ops/docker/compose.scale.yml`

The repeatable generated companion report is `ops/docs/reference/SCHEMA-AUDIT.md`.
Regenerate it with:

```powershell
node ops\scripts\backend\schema-audit.ts
```

The canonical server database is Postgres. The backend still exposes a synchronous SQLite-like compatibility API through `postgresDatabase.js`, so many SQL statements are written in SQLite-ish style and translated before execution. The frontend mirrors a subset into IndexedDB/Dexie for offline fallback and queueing. Redis is used for import/media queues and runtime cache. Object files live in MinIO/R2-compatible object storage and are referenced by database rows.

## Verification Passes

1. Canonical schema pass: parsed all `CREATE TABLE`, `PRIMARY KEY`, and `CREATE INDEX` statements from `backend/src/db/postgresSchema.sql`.
2. Runtime schema pass: cross-checked `postgresDatabase.js` and `systemJobs.js` for `ALTER TABLE`, `CREATE TABLE IF NOT EXISTS`, and indexes not fully represented in the dump.
3. Relationship pass: scanned backend routes/services for joins, `*_id` filters, manual cascade deletes, and denormalized snapshot fields.
4. Implicit schema pass: scanned JSON/text payload columns, dynamic custom-table creation, backup table order, Dexie offline stores, Redis queue/cache, and object-storage references.
5. Plan update pass: updated this document and the optimization roadmap with new repeated schema-analysis mini phases and recommendations.
6. Automated verification pass: added `ops/scripts/backend/schema-audit.ts`, which parses canonical SQL, runtime DDL, Dexie stores, and backup table coverage, then regenerates `ops/docs/reference/SCHEMA-AUDIT.md`.

## Repeated Verification Protocol

Phase 29 requires this schema/data-flow protocol to run at least three times
before any deep schema rewrite, broad folder merge, source deletion, or language
conversion:

1. Inventory tracked source across `backend`, `frontend`, `ops`, `run`, root
   config, Docker, package scripts, Cloudflare docs/scripts, and release
   packaging.
2. Measure generated/runtime bulk separately: `node_modules`, `frontend/dist`,
   `ops/runtime`, `business-os-data`, generated `release` kits, Playwright
   artifacts, logs, and generated reports.
3. Extract schema from canonical SQL, runtime DDL, backup schema, route/service
   SQL, Dexie stores, Redis queue/cache usage, object-storage paths, custom
   tables, and JSON/text payload columns.
4. Update the relational map with every entity, attributes, primary/logical
   keys, unique constraints, implicit/declared foreign keys, many-to-many joins,
   polymorphic references, JSON schemas, backup coverage, restore behavior, and
   delete behavior.
5. Cross-check this document against `backend/src/db/postgresSchema.sql`,
   runtime DDL, `backupSchema.js`, route/service joins, frontend API/Dexie, and
   generated `SCHEMA-AUDIT.md`.
6. Re-scan missed implicit schemas: settings payloads, action-history payloads,
   audit payloads, custom fields/tables, import job JSON, AI logs, media/file
   paths, Cloudflare R2 metadata, and Google Drive backup metadata.
7. Rank optimization candidates: missing indexes, missing primary keys,
   idempotency uniqueness, foreign-key candidates, orphan risks, duplicated
   snapshot fields, JSON-to-`jsonb` candidates, query hot paths, and backup
   gaps.
8. Scan code flow for nested loops, repeated `O(n*m)` transforms, broad
   refreshes, repeated API waterfalls, duplicate helpers, stale code, unused
   scripts, compatibility wrappers, and oversized modules.
9. Execute only safe cleanup: ignored/generated files, old runtime reports,
   old backup packages beyond retention, and reinstallable dependencies. Source
   deletion must wait for reference proof and tests.
10. Evaluate language/runtime candidates only with measurable proof: TypeScript
    type safety, SQL/DuckDB set-based speed, workers for browser CPU work,
    PowerShell for Windows orchestration, and Rust/Go/Python/WASM only when
    packaging and benchmarks justify them.
11. Update roadmap/reference docs with findings, rejected rewrites, cleanup
    results, and next executable slices.
12. Repeat the full protocol after updates to catch contradictions, missed
    relationships, stale cleanup assumptions, and broken references.

Move 273 closed the active primary-key gap backlog for `import_jobs` and
`settings`: canonical DDL now declares `import_jobs.id` and `settings.key`
primary keys, runtime startup applies those constraints only after duplicate,
null, and blank-key checks, and live strict preflight confirms both primary keys
are present.

### Phase 29 Coverage Tables

| Coverage area | Current source of truth | Verification output |
| --- | --- | --- |
| Entity catalog and attributes | This document plus `backend/src/db/postgresSchema.sql` | `ops/docs/reference/SCHEMA-AUDIT.md` |
| Implicit relationships | Route/service joins, `*_id` filters, manual cascade code | `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md` |
| JSON/text schemas | Settings, action history, audit logs, imports, AI logs, custom fields | `ops/docs/reference/SCHEMA-AUDIT.md` |
| Backup and restore coverage | `backend/src/backupSchema.js`, backup tests, runtime backup roots | `ops/docs/reference/CLEANUP-SWEEP.md` and `SCHEMA-AUDIT.md` |
| Orphan-check backlog | Schema recommendations and integrity scripts | `ops/docs/reference/SCHEMA-AUDIT.md` |
| Index/FK/constraint recommendations | Phase 6 and Phase 29 recommendation matrix | `ops/docs/OPTIMIZATION-ROADMAP.md` |

## Core Finding

Business OS already has a broad relational shape, but it mostly relies on application-enforced relationships instead of database foreign keys. That gives operational flexibility during rapid schema evolution and import/restore flows, but it also makes orphan detection, deletion safety, and query planning harder than necessary.

The strongest next rewire is not a dramatic rewrite. It is a staged relational hardening program:

- add missing primary keys and unique indexes for identity tables,
- add non-valid foreign keys first, then validate after cleanup,
- move high-volume JSON/text fields to `jsonb` where Postgres queries them,
- add focused indexes for current API access patterns,
- keep denormalized receipt/snapshot fields only where historical audit fidelity requires them.

## Entity Catalog

Legend:

- PK: declared primary key, or logical key when the database uses only a unique index.
- FK: relationship currently implied by code unless marked "declared".
- JSON text: text column that stores serialized JSON.
- Snapshot: denormalized value intentionally copied for historical display.

| Entity | Key / constraints | Attributes | Main relationships and notes |
| --- | --- | --- | --- |
| `organizations` | PK `id`; runtime unique `public_id`, `slug` | `id`, `name`, `slug`, `public_id`, `is_active`, `setup_enabled`, `created_at` | Parent for `organization_groups` and `users`. Runtime bootstrap creates/updates the default organization. |
| `organization_groups` | PK `id`; runtime unique `(organization_id, slug)` | `id`, `organization_id`, `name`, `slug`, `is_default`, `is_active`, `created_at` | Many groups belong to one organization. Referenced by `users.organization_group_id`. |
| `roles` | PK `id`; runtime unique `code` where present | `id`, `name`, `permissions`, `created_at`, `code`, `is_system`, `updated_at` | One role has many users. `permissions` is JSON text. Admin/manager/employee seeded at runtime. |
| `users` | PK `id`; runtime unique lower trimmed `username` where not deleted; runtime unique `google_subject` where active | `id`, `username`, `name`, `password`, `role_id`, `permissions`, `otp_enabled`, `otp_secret`, `is_active`, `created_at`, `phone`, `email`, `avatar_path`, `phone_verified`, `email_verified`, `supabase_user_id`, `google_subject`, `google_email`, `google_email_verified`, `google_linked_at`, `deleted_at`, `firebase_user_id`, `otp_pending_secret`, `otp_pending_created_at`, `phone_lookup`, `organization_id`, `organization_group_id`, `updated_at` | Belongs to role/organization/group. Has sessions, verification codes, audit/action history, import jobs, AI logs, file assets. `permissions` is JSON text. |
| `user_sessions` | PK `id`; unique `token_hash` | `id`, `user_id`, `token_hash`, `device_name`, `device_tz`, `client_time`, `user_agent`, `last_ip`, `last_seen_at`, `expires_at`, `revoked_at`, `created_at` | Many sessions per user. Token uniqueness is enforced for direct session lookup and replay-safety; FK to users remains a relationship-hardening candidate. |
| `verification_codes` | PK `id` | `id`, `user_id`, `purpose`, `channel`, `destination`, `code_hash`, `code_salt`, `meta_json`, `expires_at`, `consumed_at`, `created_at` | Many codes per user. `meta_json` is JSON text. Excluded from backups. |
| `settings` | PK `key`; unique index `idx_settings_key_unique` retained for compatibility | `key`, `value`, `updated_at` | Key-value store for app, portal, receipt, feature, and integration settings. `value` often stores JSON or scalar text. |
| `categories` | PK `id`; indexed lower `name` | `id`, `name`, `color`, `created_at`, `updated_at` | Product category lookup table. Products currently store category by text name, not `category_id`. |
| `units` | PK `id`; indexed lower `name` | `id`, `name`, `created_at`, `color`, `updated_at` | Product unit lookup table. Products currently store unit by text name, not `unit_id`. |
| `suppliers` | PK `id` | `id`, `name`, `phone`, `email`, `address`, `company`, `contact_person`, `notes`, `created_at`, `updated_at` | Products and supplier returns store supplier name/id snapshots. Products currently use text `supplier`. |
| `customers` | PK `id`; indexed lower `membership_number` | `id`, `name`, `phone`, `email`, `address`, `company`, `notes`, `created_at`, `membership_number`, `updated_at` | One customer can have many sales, returns, loyalty calculations, and portal submissions. Membership number is lookup key. Recommend partial unique lower membership index. |
| `delivery_contacts` | PK `id` | `id`, `name`, `phone`, `area`, `address`, `notes`, `created_at`, `updated_at` | Referenced by delivery sales through `sales.delivery_contact_id`, with name/phone/address snapshots. |
| `branches` | PK `id` | `id`, `name`, `location`, `phone`, `manager`, `notes`, `is_default`, `is_active`, `created_at`, `updated_at` | One branch has many stock rows, sales, returns, transfers, RFID sessions, and movement rows. Recommend partial unique default branch guard if only one default is intended. |
| `products` | PK `id`; unique partial `client_request_id`; indexed `sku`, `barcode`, lower `name`, lower `brand`, lower `category`, lower `unit`, lower `supplier`, `(parent_id, is_group)`, `(is_active, stock_quantity, name)`; runtime partial `expiry_date` index | `id`, `name`, `sku`, `barcode`, `category`, `unit`, `description`, `selling_price_usd`, `selling_price_khr`, `purchase_price_usd`, `purchase_price_khr`, `cost_price_usd`, `cost_price_khr`, `stock_quantity`, `rfid_confirmed_qty`, `low_stock_threshold`, `out_of_stock_threshold`, `image_path`, `is_active`, `supplier`, `custom_fields`, `parent_id`, `created_at`, `updated_at`, `brand`, `client_request_id`, `special_price_usd`, `special_price_khr`, `is_group`, `discount_enabled`, `discount_type`, `discount_percent`, `discount_amount_usd`, `discount_amount_khr`, `discount_label`, `discount_badge_color`, `discount_starts_at`, `discount_ends_at`, `expiry_date`, `expiry_alert_days` | Central product table. Self relationship via `parent_id` for group/variant families. Text lookup fields point to `categories`, `units`, and supplier/brand settings by value. `custom_fields` is JSON text. `stock_quantity` is denormalized from branch/batch stock. |
| `product_images` | PK `id`; index `(product_id, sort_order, id)` | `id`, `product_id`, `image_path`, `sort_order`, `created_at` | Many images per product. `image_path` references object/file path, often also represented in `file_assets.public_path`. Parent-first gallery ordering index is present. |
| `branch_stock` | PK `id`; unique `(product_id, branch_id)`; index `(branch_id, quantity DESC, product_id)` | `id`, `product_id`, `branch_id`, `quantity`, `rfid_confirmed_qty` | Join table between products and branches. Drives inventory availability. Recommend FK to products and branches. |
| `product_batches` | PK `id`; unique `(variant_product_id, batch_key)`; index `(variant_product_id, expiry_date, received_at, id)` | `id`, `variant_product_id`, `batch_key`, `lot_code`, `expiry_date`, `received_at`, `is_active`, `notes`, `synthetic`, `created_at`, `updated_at` | Many batches per variant product. Runtime-created and present in schema tail. |
| `branch_batch_stock` | PK `id`; unique `(batch_id, branch_id)`; index `(branch_id, quantity DESC, batch_id)` | `id`, `batch_id`, `branch_id`, `quantity`, `created_at`, `updated_at` | Batch-level stock by branch. Parallels `branch_stock` at finer granularity. |
| `sales` | PK `id`; unique partial `client_request_id`; indexes `(created_at DESC, id DESC)`, `(sale_status, created_at DESC, id DESC)` | `id`, `receipt_number`, `cashier_id`, `cashier_name`, `branch_id`, `branch_name`, `customer_name`, `customer_phone`, `customer_address`, `payment_method`, `payment_currency`, `exchange_rate`, `subtotal_usd`, `subtotal_khr`, `discount_usd`, `discount_khr`, `tax_usd`, `tax_khr`, `total_usd`, `total_khr`, `amount_paid_usd`, `amount_paid_khr`, `change_usd`, `change_khr`, `is_delivery`, `delivery_contact_id`, `delivery_contact_name`, `delivery_contact_phone`, `delivery_contact_address`, `delivery_fee_usd`, `delivery_fee_khr`, `delivery_fee_paid_by`, `sale_status`, `notes`, `items`, `device_name`, `device_tz`, `created_at`, `customer_id`, `membership_discount_usd`, `membership_discount_khr`, `membership_points_redeemed`, `updated_at`, `client_request_id` | One sale has many `sale_items` and returns. Many columns are receipt snapshots. `items` is legacy JSON text snapshot. Non-empty `client_request_id` is unique for idempotent create replay. |
| `sale_items` | PK `id`; indexes `(product_id, branch_id, sale_id)`, `(sale_id, id)` | `id`, `sale_id`, `product_id`, `product_name`, `sku`, `quantity`, `unit`, `applied_price_usd`, `applied_price_khr`, `cost_price_usd`, `cost_price_khr`, `total_usd`, `total_khr`, `branch_id`, `price_mode`, `product_discount_type`, `product_discount_label`, `product_discount_usd`, `product_discount_khr` | Many items per sale; optional product/branch references plus product snapshots for receipt correctness. Parent-first detail-read index is present. |
| `sale_item_batch_allocations` | PK `id`; index `(sale_item_id, released_at)` | `id`, `sale_item_id`, `batch_id`, `branch_id`, `quantity`, `lot_code`, `expiry_date`, `released_at`, `created_at` | Many batch allocations per sale item. Links sale depletion to product batches. |
| `returns` | PK `id`; unique partial `client_request_id`; indexes `(created_at DESC, id DESC)`, `(status, created_at DESC, id DESC)` | `id`, `return_number`, `sale_id`, `receipt_number`, `cashier_id`, `cashier_name`, `customer_name`, `branch_id`, `branch_name`, `reason`, `return_type`, `notes`, `total_refund_usd`, `total_refund_khr`, `exchange_rate`, `status`, `device_name`, `device_tz`, `created_at`, `customer_id`, `return_scope`, `supplier_id`, `supplier_name`, `supplier_settlement`, `supplier_compensation_usd`, `supplier_compensation_khr`, `supplier_loss_usd`, `supplier_loss_khr`, `updated_at`, `client_request_id` | Customer returns usually link to `sales`; supplier returns link to `suppliers`. Contains snapshots for audit/receipt. Non-empty `client_request_id` is unique for idempotent create replay. |
| `return_items` | PK `id`; index `(return_id, id)` | `id`, `return_id`, `sale_item_id`, `product_id`, `product_name`, `quantity`, `applied_price_usd`, `applied_price_khr`, `cost_price_usd`, `cost_price_khr`, `total_usd`, `total_khr`, `return_to_stock`, `branch_id` | Many items per return; optional links to sale item/product/branch. Parent-first detail-read index is present. |
| `return_item_batch_allocations` | PK `id`; index `(return_item_id, reversed_at)` | `id`, `return_item_id`, `sale_item_id`, `batch_id`, `branch_id`, `quantity`, `lot_code`, `expiry_date`, `reversed_at`, `created_at` | Reverses batch allocations for returns. |
| `inventory_movements` | PK `id`; indexes by created/product/branch/user | `id`, `product_id`, `product_name`, `branch_id`, `branch_name`, `movement_type`, `quantity`, `unit_cost_usd`, `unit_cost_khr`, `total_cost_usd`, `total_cost_khr`, `reason`, `reference_id`, `user_id`, `user_name`, `created_at`, runtime `batch_id`, runtime `lot_code`, runtime `expiry_date` | Append-style stock ledger with snapshots. `reference_id` is polymorphic: sale, return, transfer, manual move, import depending on `movement_type`. |
| `stock_transfers` | PK `id`; unique partial `client_request_id` | `id`, `from_branch_id`, `to_branch_id`, `product_id`, `product_name`, `quantity`, `notes`, `user_id`, `user_name`, `created_at`, `client_request_id` | Branch-to-branch stock movement. Creates inventory movement rows. |
| `stock_row_moves` | PK `id` | `id`, `source_product_id`, `source_product_name`, `destination_product_id`, `destination_product_name`, `branch_id`, `branch_name`, `quantity`, `reason`, `note`, `user_id`, `user_name`, `created_at` | Moves quantity between product rows in one branch. Strong candidate for FKs after cleanup. |
| `rfid_tags` | PK `id`; runtime unique `epc_id`; index `(product_id, branch_id, status)` | `id`, `epc_id`, `tid`, `product_id`, `branch_id`, `status`, `last_seen`, `last_seen_session_id`, `created_at`, `updated_at`, `created_by`, `updated_by` | Physical tag registry for product/branch. |
| `rfid_scan_sessions` | PK `id` | `id`, `branch_id`, `area`, `reader_id`, `status`, `ledger_qty`, `confirmed_qty`, `missing_count`, `extra_count`, `wrong_location_count`, `unknown_count`, `started_at`, `finished_at`, `applied_at`, `created_by`, `created_by_name` | One scan session has many RFID events and session items. |
| `rfid_events` | PK `id`; indexes `(session_id, epc_id, seen_at DESC)`, unique partial `dedupe_key` | `id`, `session_id`, `epc_id`, `tid`, `product_id`, `branch_id`, `event_type`, `antenna`, `rssi`, `seen_at`, `raw_json`, `dedupe_key` | Raw RFID event log. `raw_json` is JSON text. `dedupe_key` is authoritative per session/tag/event type; duplicate event inserts are ignored while `rfid_session_items.read_count` still tracks repeated reads. |
| `rfid_session_items` | PK `id`; unique `(session_id, epc_id)` | `id`, `session_id`, `epc_id`, `tid`, `product_id`, `expected_branch_id`, `seen_branch_id`, `status`, `review_note`, `first_seen`, `last_seen`, `read_count` | Per-session evaluated tag state. |
| `file_assets` | PK `id`; unique `public_path` | `id`, `original_name`, `stored_name`, `public_path`, `mime_type`, `media_type`, `byte_size`, `width`, `height`, `source`, `created_by_id`, `created_by_name`, `created_at`, `updated_at`, `original_byte_size`, `optimized_byte_size`, `optimization_status`, `optimization_note`, `duration_seconds` | Metadata for uploaded/optimized files. Actual bytes live in object storage. Usage is polymorphic through path columns and JSON fields. |
| `ai_provider_configs` | PK `id` | `id`, `name`, `provider`, `provider_type`, `account_email`, `project_name`, `api_key_encrypted`, `default_model`, `supported_models_json`, `endpoint_override`, `notes`, `enabled`, `last_status`, `last_error`, `last_checked_at`, `created_by_id`, `created_by_name`, `created_at`, `updated_at`, `priority`, `requests_per_minute`, `max_input_chars`, `max_completion_tokens`, `timeout_ms`, `cooldown_seconds` | AI provider credential/config table. `supported_models_json` is JSON text. |
| `ai_response_logs` | PK `id` | `id`, `surface`, `provider_config_id`, `provider_name`, `provider`, `model`, `actor_user_id`, `actor_user_name`, `actor_label`, `prompt_text`, `question_text`, `profile_json`, `candidate_products_json`, `recommendations_json`, `citations_json`, `answer_text`, `created_at` | AI answer audit trail. Multiple JSON text columns capture request/answer context. |
| `customer_share_submissions` | PK `id`; index `(status, created_at DESC, id DESC)` | `id`, `customer_id`, `membership_number`, `customer_name`, `platform`, `note`, `screenshots_json`, `status`, `reward_points`, `review_note`, `reviewed_by_id`, `reviewed_by_name`, `reviewed_at`, `created_at` | Public portal submissions; screenshots are JSON text path list. |
| `audit_logs` | PK `id` | `id`, `user_id`, `user_name`, `action`, `entity`, `entity_id`, `details`, `table_name`, `record_id`, `old_value`, `new_value`, `device_name`, `device_tz`, `client_time`, `created_at` | Polymorphic audit log. `entity/entity_id` and `table_name/record_id` point across the domain; values may be JSON text. |
| `action_history` | PK `id`; indexes `(created_at DESC, id DESC)`, `(scope, updated_at DESC, id DESC)`, `(scope, created_by_id, updated_at DESC, id DESC)` | `id`, `scope`, `entity`, `entity_id`, `label`, `undo_label`, `redo_label`, `reversible`, `status`, `undo_payload`, `redo_payload`, `last_error`, `created_by_id`, `created_by_name`, `created_at`, `updated_at` | Reversible UI action log. `undo_payload` and `redo_payload` are JSON text. Scope/user indexes match the action-history bar and admin user-filter reads. |
| `custom_tables` | PK `id` | `id`, `name`, `columns`, `created_at`, `updated_at` | Registry for dynamic custom `ct_*` tables. `columns` is JSON text schema. |
| `custom_fields` | PK `id` | `id`, `entity_type`, `field_name`, `field_type`, `required`, `default_value`, `options`, `sort_order`, `created_at` | Metadata for dynamic fields. `options` is usually JSON/text list. Products also carry row-level `custom_fields` JSON text. |
| Dynamic `ct_*` tables | Runtime `id SERIAL PRIMARY KEY` | user-defined columns plus `created_at`, `updated_at` | Created by `customTables.js` from sanitized names and whitelisted column types. Not present in static dump. Backup handles custom table rows separately. |
| `import_jobs` | PK `id` | `id`, `type`, `status`, `phase`, `queue_driver`, `total_rows`, `processed_rows`, `failed_rows`, `total_images`, `processed_images`, `failed_images`, `warning_count`, `policy_json`, `summary_json`, `cancel_requested`, `last_error`, `created_by_id`, `created_by_name`, `created_at`, `updated_at`, `started_at`, `finished_at` | Parent for import files/batches/errors. `policy_json` and `summary_json` are JSON text. |
| `import_job_files` | PK `id`; index `(job_id, kind, id)` | `id`, `job_id`, `kind`, `original_name`, `stored_path`, `relative_path`, `mime_type`, `byte_size`, `status`, `error_message`, `created_at`, `updated_at` | Many files per import job. Stored path points to local/object import staging. Parent-first cleanup/review index is present. |
| `import_job_batches` | PK `id`; unique `(job_id, batch_index)` | `id`, `job_id`, `batch_index`, `start_row`, `end_row`, `status`, `attempts`, `error_message`, `started_at`, `finished_at`, `created_at`, `updated_at` | Many batches per import job. |
| `import_job_errors` | PK `id`; index `(job_id, batch_id, id)` | `id`, `job_id`, `batch_id`, `row_number`, `file_name`, `code`, `message`, `raw_json`, `created_at` | Many errors per job/batch. `raw_json` is JSON text. Parent-first cleanup/review index is present. |
| `google_drive_sync_entries` | PK `id`; unique `relative_path` | `id`, `relative_path`, `item_type`, `remote_file_id`, `mime_type`, `md5_checksum`, `byte_size`, `local_modified_at`, `last_synced_at`, `upload_session_url`, `upload_offset`, `content_sha256`, `last_error`, `retry_count` | Tracks Drive backup/sync state. |
| `business_os_migration_status` | PK `id` | `id`, `source_hash`, `status`, `summary_json`, `created_at`, `updated_at` | Cutover/migration audit. `summary_json` is actual `jsonb`. |
| `system_jobs` | Runtime PK `id`; indexes `(created_at DESC, id DESC)`, `(status, updated_at DESC)` | `id`, `type`, `status`, `phase`, `progress`, `message`, `result_json`, runtime `metrics_json`, runtime `retry_count`, runtime `cancellable`, runtime `cancel_requested_at`, `error`, `created_at`, `started_at`, `finished_at`, `updated_at` | Runtime-persisted job state for backup/restore/doctor-style background tasks. It is intentionally excluded from backups because queued/running jobs are not portable across restores. `result_json` and `metrics_json` are JSON text. |

## Relationship Map

### Organization And Identity

- `organizations` 1-to-many `organization_groups`
- `organizations` 1-to-many `users`
- `organization_groups` 1-to-many `users`
- `roles` 1-to-many `users`
- `users` 1-to-many `user_sessions`
- `users` 1-to-many `verification_codes`
- `users` 1-to-many `audit_logs`, `action_history`, `file_assets`, `import_jobs`, `ai_response_logs`

These are all code-enforced today. No declared FKs were found in the canonical schema.

### Product, Inventory, Batches, And RFID

- `products` 1-to-many `product_images`
- `products` many-to-many `branches` through `branch_stock`
- `products` 1-to-many `product_batches`
- `product_batches` many-to-many `branches` through `branch_batch_stock`
- `sale_items` 1-to-many `sale_item_batch_allocations`
- `return_items` 1-to-many `return_item_batch_allocations`
- `products` 1-to-many `inventory_movements`
- `branches` 1-to-many `inventory_movements`
- `products` self relationship through `products.parent_id`
- `rfid_scan_sessions` 1-to-many `rfid_events`
- `rfid_scan_sessions` 1-to-many `rfid_session_items`
- `rfid_tags` belongs to product and branch by `product_id`, `branch_id`

The current product taxonomy is hybrid: `categories` and `units` are lookup tables, but `products.category` and `products.unit` store text labels instead of foreign keys. Brands are stored in settings plus product text values.

### Sales, Returns, And Accounting

- `sales` 1-to-many `sale_items`
- `sales` 1-to-many `returns`
- `returns` 1-to-many `return_items`
- `sale_items` 1-to-many `return_items`
- `customers` 1-to-many `sales`
- `customers` 1-to-many `returns`
- `suppliers` 1-to-many supplier-scope `returns`
- `branches` 1-to-many `sales`, `sale_items`, `returns`, `return_items`
- `delivery_contacts` 1-to-many `sales`

Many sale/return fields are intentional snapshots: cashier name, customer name, branch name, delivery address, product name, SKU, applied prices, cost prices, and receipt numbers. These should not be normalized away unless historical receipt fidelity is preserved.

### Files And Object Storage

- `file_assets.public_path` is the catalog of uploaded assets.
- `products.image_path`, `product_images.image_path`, `users.avatar_path`, settings values, portal content settings, and `customer_share_submissions.screenshots_json` can all reference upload paths.
- Actual bytes are in object storage (`OBJECT_STORAGE_DRIVER`, MinIO/R2 config). `file_assets` is metadata, not ownership by itself.

This is a polymorphic path-based association. It needs a usage index/table if file cleanup and authorization become more complex.

### Import, Jobs, And Runtime Queues

- `import_jobs` 1-to-many `import_job_files`
- `import_jobs` 1-to-many `import_job_batches`
- `import_job_batches` 1-to-many `import_job_errors`
- `import_jobs` 1-to-many `import_job_errors`
- Redis queue (`redis-queue`) drives import/media workers; DB tables hold durable job state and audit.
- `system_jobs` stores runtime background job state; in-memory `jobs` map is the live executor cache. Job rows are not included in backup packages.

### Dynamic And Polymorphic Areas

- `audit_logs.entity/entity_id` and `table_name/record_id` are polymorphic.
- `action_history.scope/entity/entity_id` is polymorphic.
- `inventory_movements.reference_id` is polymorphic based on `movement_type`.
- `custom_tables` creates runtime physical tables named `ct_*`.
- Multiple `*_json` text columns hold nested structures that are not enforced by Postgres.

## Indexed Access Patterns Observed

Current indexes already support:

- product lookup by name/brand/category/unit/supplier/barcode/SKU,
- product grouping by parent/is_group,
- branch stock by `(product_id, branch_id)` and branch quantity scans,
- sales and returns by created/status,
- sale item product/branch lookups,
- inventory movement timeline by product, branch, user, and created date,
- import batch uniqueness,
- file asset public path uniqueness,
- customer membership lookup,
- RFID session/tag lookup basics,
- system job created/status scans.

Gaps:

- `import_jobs.id` is a logical key but not a declared primary key in the dump.
- `settings.key` is unique but not a primary key.
- `sales.client_request_id`, `returns.client_request_id`, and `products.client_request_id` are idempotency keys with unique partial indexes for non-empty values.
- `user_sessions.token_hash` is security-critical and now has a unique index.
- JSON text columns that are queried or filtered cannot use JSONB indexes.

## Normalization And Denormalization Analysis

Keep denormalized snapshots for:

- sales receipt identity and prices,
- return receipt identity and prices,
- inventory movement product/branch names,
- audit/action human-readable labels,
- import error raw row payloads.

Normalize or dual-write toward IDs for:

- product category/unit/supplier/brand values,
- product image ownership,
- file asset usage,
- import job child ownership,
- branch/product stock references,
- RFID product/branch/session references.

Convert to `jsonb` where queryable or structurally important:

- `users.permissions`
- `roles.permissions`
- `products.custom_fields`
- `settings.value` only if split into typed settings; otherwise keep key-value text
- `action_history.undo_payload`, `action_history.redo_payload`
- `import_jobs.policy_json`, `import_jobs.summary_json`
- `import_job_errors.raw_json`
- `ai_provider_configs.supported_models_json`
- `ai_response_logs.profile_json`, `candidate_products_json`, `recommendations_json`, `citations_json`
- `customer_share_submissions.screenshots_json`
- `system_jobs.result_json`, `system_jobs.metrics_json`
- `rfid_events.raw_json`

## Optimized Schema Recommendations

### Backup Coverage Guardrail

The generated schema audit currently reports 45 static Postgres tables, 37
backup tables, 0 declared foreign key/reference constraints in scanned DDL, and
0 missing relationship-doc entities. The audit now reports 0 action-needed
backup coverage gaps after adding batch inventory tables, sale/return allocation
tables, and `stock_row_moves` to `BACKUP_TABLES`, and marking `system_jobs` as
intentional non-backup runtime state.

Move 269 added primary-key gap evidence to that generated audit. Move 273
closed the current static primary-key gaps:

| Table | Current logical identity | Recommendation |
| --- | --- | --- |
| `import_jobs` | Declared PK `id` | Keep strict preflight in the live verification loop and retain rollback SQL. |
| `settings` | Declared PK `key`; compatibility unique index `idx_settings_key_unique` retained | Keep strict preflight in the live verification loop and retain rollback SQL. |

Move 270 adds the read-only runtime preflight for those two candidates:

```powershell
npm.cmd --prefix ops run schema-pk-preflight
npm.cmd --prefix ops run schema-pk-preflight:strict
```

The latest live report is green after apply: `import_jobs.id` has 1 row, 0 null
keys, 0 duplicate groups, and `hasPrimaryKey: true`; `settings.key` has 119
rows, 0 null keys, 0 duplicate groups, and `hasPrimaryKey: true`.

Continue to classify future gaps as durable business state, reconstructable
state, or intentionally excluded runtime state before changing backup/restore
behavior.

### Immediate, Low-Risk DDL

1. Add primary keys where logical keys already exist:
   - `ALTER TABLE settings ADD PRIMARY KEY (key)` after checking no duplicate keys.
   - `ALTER TABLE import_jobs ADD PRIMARY KEY (id)` after checking no duplicate/null ids.
2. Completed idempotency indexes:
   - unique partial index on `sales(client_request_id)` where non-empty.
   - unique partial index on `returns(client_request_id)` where non-empty.
   - unique partial index on `products(client_request_id)` where non-empty.
3. Completed detail-read indexes:
   - `sale_items(sale_id, id)`
   - `return_items(return_id, id)`
   - `product_images(product_id, sort_order, id)`
   - `import_job_files(job_id, kind, id)`
   - `import_job_errors(job_id, batch_id, id)`
4. Completed action-history read indexes:
   - `action_history(scope, updated_at DESC, id DESC)`
   - `action_history(scope, created_by_id, updated_at DESC, id DESC)`
5. Completed security/session index:
   - unique `user_sessions(token_hash)`.
6. Completed RFID dedupe index:
   - unique partial `rfid_events(dedupe_key)` where non-empty, paired with
     event insert conflict-ignore behavior.

### Relationship Hardening

Add foreign keys as `NOT VALID` first, clean orphan rows, then validate:

- `users.role_id -> roles.id`
- `users.organization_id -> organizations.id`
- `users.organization_group_id -> organization_groups.id`
- `user_sessions.user_id -> users.id`
- `verification_codes.user_id -> users.id`
- `branch_stock.product_id -> products.id`
- `branch_stock.branch_id -> branches.id`
- `product_images.product_id -> products.id`
- `product_batches.variant_product_id -> products.id`
- `branch_batch_stock.batch_id -> product_batches.id`
- `branch_batch_stock.branch_id -> branches.id`
- `sales.customer_id -> customers.id`
- `sales.branch_id -> branches.id`
- `sales.delivery_contact_id -> delivery_contacts.id`
- `sale_items.sale_id -> sales.id`
- `sale_items.product_id -> products.id`
- `sale_items.branch_id -> branches.id`
- `returns.sale_id -> sales.id`
- `returns.customer_id -> customers.id`
- `returns.supplier_id -> suppliers.id`
- `return_items.return_id -> returns.id`
- `return_items.sale_item_id -> sale_items.id`
- `return_items.product_id -> products.id`
- `stock_transfers.from_branch_id -> branches.id`
- `stock_transfers.to_branch_id -> branches.id`
- `stock_transfers.product_id -> products.id`
- RFID product/branch/session references.

Use `ON DELETE SET NULL` for historical/audit references and `ON DELETE CASCADE` only for true child rows such as product images, branch stock, batch stock, sale/return item allocations, import job children, sessions, and verification codes.

### Product Taxonomy Rewire

Current category/unit/supplier/brand values are text-based. Recommended path:

1. Add nullable `category_id`, `unit_id`, `supplier_id`, and optional `brand_id` or `product_brands` table.
2. Backfill IDs from normalized lower text.
3. Keep text snapshot columns during migration.
4. Update writes to dual-write ID and label.
5. Switch reads/search filters to IDs where possible, while still supporting legacy text.
6. Later decide whether text labels remain as snapshots or generated display fields.

This directly supports the resource-efficiency work already started in Phase 8.4.

### Stock Model Rewire

Current stock has three overlapping sources:

- `products.stock_quantity`
- `branch_stock.quantity`
- `branch_batch_stock.quantity`

Recommended direction:

1. Treat `branch_batch_stock` as source of truth when a product has batches.
2. Treat `branch_stock` as source of truth for non-batched products or as a maintained rollup.
3. Treat `products.stock_quantity` as a maintained rollup only.
4. Add reconciliation jobs and constraints to verify rollup consistency.
5. Build indexed read models for common inventory and POS availability queries.

### File Usage Rewire

Add a `file_asset_usages` table:

- `id`
- `file_asset_id`
- `owner_table`
- `owner_id`
- `owner_field`
- `usage_type`
- `created_at`

This would replace repeated JSON/path scans for cleanup and allow safer authorization checks for uploads, images, videos, camera assets, receipt assets, portal media, and customer screenshots.

### JSONB And Typed Settings

Do not blindly convert every setting. Instead:

- Keep simple scalar settings in `settings`.
- Move large structured settings into typed tables or `jsonb` columns grouped by feature:
  - receipt settings,
  - portal layout/content,
  - AI provider settings,
  - import policy presets,
  - brand/category/unit color maps.

This reduces large settings reads and makes targeted invalidation easier.

### Query And Connection Improvements

- Keep Postgres as primary and gradually retire SQLite-style translation from hot paths.
- Introduce prepared query modules for high-volume product search, POS catalog, inventory stats, dashboard analytics, sales export, and portal search.
- Add `EXPLAIN (ANALYZE, BUFFERS)` snapshots for each high-volume query before and after index changes.
- Consider connection pooling/async `pg` for new high-throughput read paths, while preserving sync compatibility until the route layer is ready to migrate.

## Repeated Audit Loop For Future Sessions

Repeat these six passes for each schema rewire slice:

1. Scan files: schema dump, runtime DDL, routes, services, tests, frontend API, Dexie, backup config.
2. Read and map: identify entities, attributes, relationships, data flows, JSON payloads, and polymorphic references.
3. Draft/update schema: edit this document and any generated diagram.
4. Verify pass A: run `node ops\scripts\backend\schema-audit.ts` and cross-check against canonical SQL and runtime DDL.
5. Verify pass B: cross-check against route/service queries and backup/Dexie usage.
6. Analyze and recommend: update indexes, FK plan, normalization trade-offs, migration safety, and tests.

No structural database rewrite should proceed without a fresh backup, restore rehearsal, orphan check, and rollback path.

### Latest Orphan-Check Evidence

Move 252 adds a reusable comprehensive integrity command:

```powershell
npm.cmd --prefix backend run verify:integrity:comprehensive
```

It writes `ops/runtime/reports/data-integrity-comprehensive-latest.json` and is
non-mutating. The first live run on 2026-05-21 found the current data is not yet
ready for FK validation:

| Finding | Count | Migration impact |
| --- | ---: | --- |
| Return/sale product pairs where returned quantity exceeds sold quantity | 22 | Requires business-rule review before return FKs/constraints are tightened. |
| `product_batches.variant_product_id -> products.id` orphans | 700 | Batch rows need restore/relink/archive policy before product batch FK validation. |
| `branch_batch_stock.branch_id -> branches.id` orphans | 4 | Branch stock batch rows need branch relink or cleanup. |
| `return_items.product_id -> products.id` orphans | 22 | Return history needs snapshot-only policy or product relink before FK validation. |
| `inventory_movements.branch_id -> branches.id` orphans | 4 | Movement history needs branch snapshot policy or relink. |
| `stock_transfers.product_id -> products.id` orphans | 20 | Transfer history needs product snapshot policy or relink. |

Do not add `VALIDATE CONSTRAINT` steps for these relationships until the report
returns zero or the relationship is explicitly classified as historical
snapshot-only.

Move 253 extends that report with bounded samples:

- `overReturned.samples` shows the largest sale/product return overages first.
- Each `relationshipOrphans[]` row includes `childTable`, `childColumn`,
  `parentTable`, `parentColumn`, `count`, and capped `samples`.
- `--sample-limit` is clamped from 1 to 50, defaulting to 10.

Use those samples to choose an explicit policy per relationship: relink to a
restored parent, convert to snapshot-only history, archive generated residue, or
delete only after backup/restore rehearsal and focused verification.

Move 254 adds `cleanupClassification` to the same report. Current live
classification:

| Bucket | Total | Generated-like | Unclassified | Policy hint |
| --- | ---: | ---: | ---: | --- |
| Over-returned sale/product pairs | 22 | 22 | 0 | Review before delete/relink. |
| Product batches missing product | 700 | 303 | 397 | Mixed; do not auto-delete. |
| Branch batch stock missing branch | 4 | 4 | 0 | Relink branch or delete generated residue after backup. |
| Return items missing product | 22 | 22 | 0 | Snapshot-history or relink before FK. |
| Inventory movements missing branch | 4 | 4 | 0 | Snapshot-history or relink before FK. |
| Stock transfers missing product | 20 | 20 | 0 | Snapshot-history or relink before FK. |

The generated-like marker is a triage signal, not deletion authority. Deletion
still requires backup/restore rehearsal, exact row lists, and a post-clean
integrity report.

Move 255 adds bounded `candidateIds` to each classification row. These are
exact row handles, split into `generatedLike` and `unclassified`, capped by
`--sample-limit`. The latest sample-limit-5 report shows the first mixed
product-batch IDs as:

| Product-batch bucket | Candidate IDs |
| --- | --- |
| Generated-like | `5506`, `5507`, `5509`, `5510`, `5512` |
| Unclassified | `5505`, `5508`, `5511`, `5514`, `5517` |

Use these IDs only for review/rehearsal until a backup, rollback SQL, and
post-clean verification are prepared.

Move 256 adds the guarded cleanup command:

```powershell
npm.cmd --prefix ops run cleanup-integrity-backlog
npm.cmd --prefix ops run cleanup-integrity-backlog:apply
```

The command only targets generated-like integrity residue and writes ignored
runtime reports under `ops/runtime/reports`. A Docker-compatible backup was
created at `ops/runtime/docker-release/backups/20260521-053131` before apply.
After the Docker backup/start cycle, the active release database had no
generated-integrity backlog; the apply report deleted zero rows and
`verify:integrity:comprehensive` passed with zero relationship orphan rows and
zero cleanup-classification counts.

Keep the earlier nonzero backlog table as historical evidence from the first
live sweep. Use the latest comprehensive report for current migration readiness,
and use the backup package when comparing or restoring runtime state.

Move 257 then applied the broad generated-QA cleanup:

```powershell
npm.cmd --prefix ops run cleanup-test-data -- --all-qa --apply --output ops/runtime/reports/cleanup-test-data-all-qa-apply-latest.json
```

Post-clean checks:

| Check | Result |
| --- | --- |
| Broad QA dry-run postcheck | 0 matches |
| `QA Smoke` dry-run postcheck | 0 matches |
| `QA Action History` dry-run postcheck | 0 matches |
| Comprehensive integrity | Passed |

The active release database now has zero rows in the main product/sales/return
and inventory movement tables. This is clean for verification, but it also means
real business data should be restored or re-imported from a verified source
before production use.

Move 258 records that state in every comprehensive integrity report through
`datasetSummary`. The latest report status is `empty`, with zero rows in
products, batches, branch stock, sales, returns, inventory movements, and stock
transfers, plus retained action-history and audit-log counts. Treat this as a
readiness signal: schema/FK checks can proceed on a clean runtime, but business
validation needs a restored or imported dataset.

Move 259 adds the fast standalone check:

```powershell
npm.cmd --prefix ops run dataset-readiness
npm.cmd --prefix ops run dataset-readiness:loaded
```

Use `dataset-readiness` for non-failing status reports and
`dataset-readiness:loaded` before production-facing runs. The loaded gate is
expected to fail on the current empty runtime until a verified dataset is
restored or re-imported.

Move 260 adds backup discovery before restore:

```powershell
npm.cmd --prefix ops run restore-candidates
npm.cmd --prefix ops run restore-candidates:loaded
```

The scanner is file-only and non-mutating. It currently recommends
`ops/runtime/docker-release/backups/20260509-065427` because it is the largest
valid loaded backup, with 22,050 business rows. The newest backup
`ops/runtime/docker-release/backups/20260521-053131` is valid but only contains
55 QA-era business rows, so it should not be treated as the real import dataset
unless that tiny snapshot is explicitly intended.

Move 261 adds the restore rehearsal:

```powershell
npm.cmd --prefix ops run restore-rehearsal
```

The rehearsal restores the recommended backup into a temporary database, checks
restored counts against the dump counts, and drops the temporary database unless
`--keep-db` is supplied. The latest rehearsal passed for
`ops/runtime/docker-release/backups/20260509-065427` with exact count matches
for all tracked business tables.

Move 262 restores that rehearsed package into the live Docker runtime after
creating a fresh safety backup at
`ops/runtime/docker-release/backups/20260521-060128`. Post-restore verification
found stale release-image metadata and a restored-role password mismatch; both
were repaired without recording secrets. The restored dataset then went through
the documented cleanup gates:

| Gate | Result |
| --- | --- |
| Broad QA cleanup | Removed 2,368 restored smoke/deep-audit rows. |
| Detached batch cleanup | Removed 397 high-id orphan batches with no sale/return allocations plus 606 dependent branch-batch stock rows. |
| Broad QA dry-run postcheck | 0 matches. |
| `QA Smoke` dry-run postcheck | 0 matches. |
| `QA Action History` dry-run postcheck | 0 matches. |
| Generated-integrity dry-run postcheck | 0 matches. |
| Route contract | Passed, including public portal catalog search. |
| Comprehensive integrity | Passed; relationship orphan checks passed for 49 FK candidates. |

The latest `datasetSummary`/`dataset-readiness` status is `loaded`: products
`5539`, product batches `5491`, branch stock `5539`, sales `29`, sale items
`29`, returns `0`, return items `0`, inventory movements `3941`, stock transfers
`0`, action history `495`, and audit logs `2221`.

Use `npm.cmd --prefix ops run live-hygiene:check` after live browser, smoke,
public portal, and undo/redo checks. That gate verifies the schema-facing
cleanup state in one pass: no generated QA/action-history residue, no
generated-integrity backlog matches, a loaded transactional dataset, and a
passing comprehensive integrity report.

Use `npm.cmd --prefix ops run phase84:live-suite` when the full live sequence is
needed. It exercises the broad UI, verifies the public Cloudflare portal, then
runs the hygiene gate so schema/data residue is checked immediately after the
browser actions.

Move 263 rebuilds the Docker release from current source and restarts the live
runtime on `business-os:v6.0.0-202605210625`. This matters for schema work
because live verification now exercises the same Postgres query text as the
source tree. The broad UI check confirmed the sales export preview route returns
200 on the rebuilt image, comprehensive integrity still passes, and the latest
readiness report remains `loaded` with the restored product, batch, branch
stock, sales, sale item, and inventory movement rows intact.

Move 264 deletes only the regenerated offline release kit after the rebuilt
image is verified. No schema/data files are deleted by this move: the Docker
image, Postgres volume, restored upload assets, and latest backup packages stay
in place.

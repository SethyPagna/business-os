# F51 — canonical branch mutation plan

## Pinned scope

- **Audited commit:** `cef9382b7240ea93ba89862f07d89c6cf6041aaf`.
- **User rule:** exactly two intentional branch identities, `Shop` and `Warehouse`.
- **Allowed work:** a forward runtime guard only. Do not rename, delete, merge, reassign stock from, or otherwise repair existing data automatically.
- **Out of scope:** Sales/POS identity writers and import/media implementation ownership. This document records their required contract only.

The current `branchRoles` source is part of this audited commit. It identifies names after trim/lowercase, but it deliberately treats any non-Shop name as a permissible transfer source and any non-Warehouse name as a permissible transfer destination. That preserves an old multi-branch model; it does not enforce the new exactly-two rule.

## Observed writer matrix

| Surface | Exact evidence at `cef9382b` | Observed behavior | Required forward behavior |
| --- | --- | --- | --- |
| Direct branch create | `cloudflare/src/routes/branches.ts:1055-1133`; arbitrary `name` accepted at 1061-1064 and inserted at 1094-1105 | A Full user creates any third branch; a Review user queues the same request. | Refuse create before queueing/direct SQL. |
| Direct branch edit | `cloudflare/src/routes/branches.ts:1136-1181`; shared writer invoked at 1177 | An edit can rename, deactivate, or change default state on any row. | Permit metadata fields only on canonical rows; reject identity changes before shared SQL. |
| Direct branch delete | `cloudflare/src/routes/branches.ts:1184-1242`; deletion at 1236-1239 | Any non-default, zero-stock branch can be deleted. | Refuse deletes; legacy rows remain evidence, canonical rows remain the two intended identities. |
| Review create/update/delete | `cloudflare/src/lib/reviewApply.ts:263-298`, `304-316`, `332-349` | Approval bypasses the route and independently inserts, updates, or deletes branch rows. | Apply the same canonical validation in every applier; rejected approval must leave the pending row open and write nothing. |
| Undo / redo | `cloudflare/src/lib/undoAppliers.ts:1652-1680` calls `branchUpdateStatements` at 1669 | A saved historical `branch.update` payload can replay a rename/deactivation without the route/review queue. | Validate current branch plus payload before replay; stale historic identity payloads must fail atomically. |
| Shared edit SQL and display snapshots | `cloudflare/src/lib/branchWrites.ts:44-64`; name is written at 50-61 and snapshots cascade at 63 | A rename changes `sales`, `inventory_movements`, `returns`, and `stock_row_moves` labels. | Do not reach this writer when identity validation fails; retain this cascade for permitted metadata-only updates. |
| General product/inventory/sales import | `cloudflare/src/lib/importEngine.ts:1738-1764`, `2605-2638`, `3205-3212`, `4181-4228`, invoked at `5447-5463` | Unknown named branches are deferred in analysis and created at apply (`4199`); an empty catalog gets `Main Branch` (`4210`). | Existing canonical name resolves case-insensitively; unknown name is a row-level unresolved/review error. Blank input maps only to an existing canonical default. Never create a branch. |
| Dated stock-count import | `cloudflare/src/lib/datedStockCountResolve.ts:162-176`, insert at 173 | An unrecognized row name immediately creates an active branch. | Return that row as unresolved with its supplied branch value; no insert. |
| Factory reset / invariant seeding | `cloudflare/src/lib/coreDataInvariants.ts:236-247`, `cloudflare/src/routes/system.ts:790-825` | Factory reset clears `branches` then invariant seeding inserts one `Main Store` branch at 239-242. | Fresh/factory-reset state seeds exactly `Shop` and `Warehouse`, with an explicit canonical default. |
| Transfer policy | `cloudflare/src/lib/branchRoles.ts:39-45`, `cloudflare/src/lib/branchRoleGuards.ts:40-43`, used by `routes/branches.ts:401` and `653` | Unknown legacy branches can transfer stock, because only Shop-as-source and Warehouse-as-destination are refused. | Strictly allow Warehouse → Shop. Decide legacy-stock evacuation separately; do not silently move it. |

## Permissions and legacy rows

Current branch permissions authorize **an action**, not a canonical identity: direct route checks use `getActionTier(..., 'branches', 'add'|'edit'|'delete')` (`routes/branches.ts:1057-1059`, `1138-1140`, `1186-1188`). Review Required writes go through `maybeQueueForReview`; Full writes go direct. The undo applier requires full `branches` permission, but can replay a branch identity change (`undoAppliers.ts:1652-1669`). Therefore permissions must remain necessary but are insufficient for this rule.

An existing noncanonical row is a legacy-data condition, not permission to mutate it automatically. Preserve its ID and all linked history. The branch API may still read it so history/audit can be understood, but it must not allow it to become a renamed canonical branch, a new default, or a destination/source for ordinary two-branch transfers. A separate, user-authorized data-repair plan is required before any merge, rename, archival, or stock relocation.

## Minimal implementation slices and ownership

### A. Branch route, review, and undo writer — one owner

**Owned runtime files:**

- `cloudflare/src/lib/canonicalBranchIdentity.ts` (new pure helper)
- `cloudflare/src/routes/branches.ts`
- `cloudflare/src/lib/branchWrites.ts`
- `cloudflare/src/lib/reviewApply.ts`
- `cloudflare/src/lib/undoAppliers.ts`

**Owned tests:**

- `cloudflare/scripts/test-undo-appliers-pure.cjs`
- `cloudflare/scripts/test-review-gate-pure.cjs`
- one focused branch-route/source-or-SQLite test, preferably `cloudflare/scripts/test-canonical-branch-identity-pure.cjs`

The helper should recognize only trimmed/case-folded `shop` and `warehouse`, and expose: canonical-name recognition; a create/delete refusal; and an update assertion that compares the stored identity with the requested identity. It must not use `is_default` as identity. The route and review applier must load the current row before update. Undo must do the same before calling `branchUpdateStatements`.

For canonical `Shop` and `Warehouse`, permit editing `location`, `phone`, `manager`, and `notes`; keep branch IDs and all stock allocations untouched. This preserves addresses and operational contacts. Identity changes (`name`, activation state, and creation/deletion) must be rejected. Whether moving the default flag between the two canonical rows remains supported is a product choice; it does not identify the row and can be preserved if a single default is still required.

### B. Import writers — Accounting Media owner

**Owned runtime files:** `cloudflare/src/lib/importEngine.ts`, `cloudflare/src/lib/datedStockCountResolve.ts` and their import tests.

Replace apply-time auto-create behavior with canonical resolution only. Do not make `resolveAndCreateBranches` silently ignore a typo: preserve the original row and return a truthful unresolved/error result for review. A blank branch must resolve to the actual canonical default only when it exists; the old `DEFAULT_BRANCH_SENTINEL` → `Main Branch` recovery path must be removed. Dated count resolution must likewise retain an unresolved row and report no `branchesCreated` item.

### C. Factory-reset seeding — settings/system owner

**Owned runtime files:** `cloudflare/src/lib/coreDataInvariants.ts` and its focused reset/invariant test; `cloudflare/src/routes/system.ts` only if response data or tests need it.

After a true factory reset, seed both canonical rows in one operation, selecting the agreed default explicitly. Do not make ordinary cold starts rename or create branches merely because the database contains legacy rows.

### D. Transfer policy parity — Branch/Sales identity owner

**Owned runtime files:** `cloudflare/src/lib/branchRoles.ts`, `cloudflare/src/lib/branchRoleGuards.ts`, `frontend/src/utils/branchRoles.ts`, plus frontend and Worker parity tests.

Change transfer eligibility from the old permissive `other` behavior to the exact Warehouse → Shop pair. This preserves intended transfers. It should not implement a hidden legacy-stock relocation; that requires a separately approved repair workflow.

## Acceptance tests

1. **Canonical helper:** accepts `Shop`, ` shop ` and `WAREHOUSE` as identities, but never accepts `Depot`, `Main Store`, `Main Branch`, blank, or a third row as canonical.
2. **Direct route:** create and delete are rejected before SQL/audit/broadcast; a request to rename/deactivate Shop or Warehouse is rejected atomically; a metadata-only edit retains the canonical name, branch ID, all `branch_stock` rows, and permits address/phone/manager/notes updates.
3. **Review:** queued legacy create/rename/delete approval fails closed, leaves `pending_actions.status = 'open'`, and does not change branches, snapshots, or stock. A permitted canonical metadata update still applies and audits once.
4. **Undo:** an old `branch.update` payload trying `Shop → Depot` or changing active state throws before `branchUpdateStatements`; metadata-only undo/redo remains replayable and its snapshot cascade remains unchanged.
5. **Import:** product, inventory, sales, and dated-count inputs naming `Depot` or a typo produce unresolved/error review outcomes and add zero rows to `branches`, `branch_stock`, `branch_batch_stock`, or movements. Case-insensitive Shop/Warehouse inputs resolve to their existing IDs. Blank inputs use an existing canonical default and never create `Main Branch`.
6. **Factory reset:** the reset fixture finishes with exactly two active names, Shop and Warehouse, one default, and no `Main Store`/`Main Branch` row.
7. **Transfers:** Warehouse → Shop remains accepted; Shop → Warehouse and every transfer involving an unknown legacy branch are refused with the same backend/frontend rule.
8. **Regression gates:** `node scripts/test-undo-appliers-pure.cjs`, `node scripts/test-review-gate-pure.cjs`, `node scripts/test-branch-stock-integrity-pure.cjs`, the focused import tests, the Branch role parity test, and Cloudflare typecheck all pass.

## Validation performed for this plan

At the pinned commit, the following existing checks passed without source edits:

- `node scripts/test-undo-appliers-pure.cjs` — 20 checks.
- `node scripts/test-review-gate-pure.cjs` — 10 checks.
- `node scripts/test-branch-stock-integrity-pure.cjs` — passed.

This plan is documentation only. It changes no runtime, data, migration, remote state, or production deployment.

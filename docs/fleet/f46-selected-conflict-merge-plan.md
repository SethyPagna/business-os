# F46 selected product conflict merge plan

## Baseline and evidence

This contract was prepared from commit `89d713e64120fe389758e2a7525ec798c65cd81b`.

| Confirmed fact | Source locator |
| --- | --- |
| The Conflicts tab owns the selection and currently calls the pair flow serially. | `frontend/src/components/products/ProductDuplicatesTab.tsx:337`, `:507`, `:528` |
| Preview and apply are currently pair-only transports. | `frontend/src/api/productWriteTransport.ts:199`, `:210` |
| The Worker pair endpoints are preview at `:3982` and apply at `:4023`. | `cloudflare/src/routes/products.ts` |
| A pair fold is shared infrastructure and appends atomic history statements before its D1 batch. | `cloudflare/src/routes/products.ts:2737`, `:3248` |
| A pair write refuses more than 100 statements before writing. | `cloudflare/src/routes/products.ts:3253` |
| The catalog merge counts DB operations and uses 20 second and 700 statement request budgets. | `cloudflare/src/routes/products.ts:3590-3595` |
| Budget yields and infrastructure interruptions already have different response paths. | `cloudflare/src/routes/products.ts:3709`, `:3836-3882` |
| Atomic merge history and post-commit fingerprint finalization are shared helpers. | `cloudflare/src/lib/undoAppliers.ts:774`, `:818` |

The fixed product decisions are the Products → Conflicts surface, exact two-row eligible pairs, one combined review, explicit stock choice per stocked pair, and visible before/after values. The durable selected-run receipt described below is an implementation design decision: the current pair endpoint has no request receipt, so present product state cannot prove whether a timed-out request committed. The exact append-only migration number, component filenames, and EN/KM key names remain implementation-time allocations after the runtime base freezes; they do not require another product decision.

## Decision and scope

This plan covers **Products → Conflicts → Merge selected**. The action will open one combined review for the selected conflict groups, collect an explicit stock decision for every eligible stocked pair, and then run the reviewed pairs under one confirmation.

The implementation must keep the current narrow eligibility rule. A selected group is eligible only when it has exactly two active, non-group products, both names have the same nonblank normalized value, both barcodes have the same identity key, and the shared cost rule reports no outlier. The keeper remains deterministic: prefer the cleaner leading-zero barcode, then the row with more stock, then the lower product ID. Similar-name groups, shared-barcode/different-name groups, groups with more or fewer than two current members, and cost outliers remain visible as skipped work that needs manual review.

The existing single-pair action remains available. Import review and Review & Logs are outside this change: their decisions update import metadata and do not provide the product graph, stock, image, audit, or undo transaction required here.

No runtime path is owned by this planning change. Runtime ownership must be assigned after the active `products.ts` work is integrated and the source base is frozen.

## Current behavior to preserve

- `ProductDuplicatesTab.tsx` holds selected cluster keys and currently loops over eligible pairs one at a time. Each iteration fetches a separate preview and may open a separate stock dialog.
- `useMergeStockChoice.tsx` and `GET /api/products/possible-duplicates/merge-preview` expose the discarded row's branch and lot stock, the projected keeper prices, and the shared identity/cost result.
- `POST /api/products/possible-duplicates/merge` enforces `products:merge_duplicates` at `full`, checks product state and identity, refuses reversible stock sessions, requires `merge` or `write_off` when the discarded row holds stock, and requires `products:image` at `full` only when the fold changes image state.
- `foldDuplicateProductInto` commits one pair's graph changes, stock effects, `undo_snapshots`, `action_history`, and `audit_logs` in one D1 batch. Its write batch refuses more than 100 statements before the first write. History fingerprint finalization can report a committed merge with Undo still pending; it must never turn a durable merge into a reported failure.
- The whole-catalog merge route already provides a counted database adapter, a 20 second and 700 statement request budget, between-case yielding, automatic continuation for `merge_budget_reached`, and manual reconciliation for `merge_infrastructure_interrupted`.

## User flow

1. The user selects conflict cards and chooses **Merge selected**.
2. The client partitions the current selection for presentation only. It marks obviously ineligible groups as manual, then sends every proposed exact two-row pair to the server preview. Client eligibility is never authority.
3. One combined modal opens after the preview succeeds. It shows:
   - the kept and discarded product, including names, IDs, and barcodes;
   - stock before the merge by branch, quantity, and lot count;
   - keeper and discarded cost and price values before the merge and the projected keeper values after it;
   - the projected primary/gallery image effect when applicable;
   - manual or blocked groups with a specific reason;
   - for each discarded row that holds stock, unselected **Move stock to kept product** and **Write stock off** choices with the resulting per-branch quantities.
4. Apply stays disabled until every eligible stocked pair has an explicit choice. An unstocked pair sends `stock: null`; the server may treat that as the existing no-stock merge behavior.
5. One final confirmation freezes the reviewed manifest and choices, creates one stable `client_request_id`, and starts the bounded run. Changing any pair or choice before confirmation creates a new request ID.
6. The modal shows committed, pending, and refused pairs separately and reports progress as pairs completed out of the reviewed manifest. It does not clear selected or refused cards silently.
7. Cancel aborts the current HTTP request and reloads authoritative products because the request may already have committed a complete pair. A late response from an aborted or replaced run cannot update the current modal.
8. If the server reports that the preview is stale before any pair commits, the modal preserves the user's choices by case key, reloads the preview, highlights changed before/after values, and requires another confirmation. A preserved choice is applied only if the same case still needs that choice.

The combined modal is a review of independent pair transactions. It must not promise one selection-wide Undo. Each committed pair appears as its own action in Action History and can be undone independently.

## API contract

### Preview

Add `POST /api/products/possible-duplicates/merge-batch/preview`. A POST is used because the selected manifest is structured and bounded rather than suitable for a query string. This endpoint is read-only and must not use the offline write queue.

Request:

```json
{
  "cases": [
    {
      "case_key": "leadingzero:012345",
      "cluster_type": "leadingzero",
      "cluster_value": "012345",
      "product_ids": [41, 92]
    }
  ]
}
```

Validation:

- Accept exactly the documented keys and reject booleans, arrays in scalar fields, unsafe integers, repeated product IDs, repeated case keys, and empty normalized cluster values.
- Accept 1–12 proposed pairs and at most 24 distinct product IDs. Reject overlap when a product appears in any role in more than one case. These limits retain the existing 25-product request ceiling while leaving room for request bookkeeping.
- Require `products:merge_duplicates` at `full`.
- Re-read the current conflict clusters and product rows. Match normalized `cluster_type`, `cluster_value`, and the exact two-member set. Apply one backend implementation of the same eligibility and deterministic keeper rules used by the client.
- Read stock, lots, pricing, cost, primary/gallery images, reversible stock sessions, and the complete merge snapshot/fingerprint needed by `foldDuplicateProductInto`. Batch reads within the repository's binding limits.
- Mark image-changing cases as blocked when the actor lacks `products:image` at `full`. Do not broaden the general image or product permissions.

Response:

```json
{
  "success": true,
  "manifest_version": 1,
  "manifest_digest": "sha256-opaque-to-the-client",
  "cases": [
    {
      "ordinal": 0,
      "case_key": "leadingzero:012345",
      "keep_id": 41,
      "merge_id": 92,
      "needs_stock_choice": true,
      "before": {
        "keeper": {},
        "discarded": {},
        "stock": [],
        "costs": {},
        "prices": {},
        "images": {}
      },
      "after_by_stock_choice": {
        "merge": {},
        "write_off": {}
      },
      "state_digest": "sha256-opaque-to-the-client",
      "blocked": null
    }
  ],
  "skipped": []
}
```

`before` and both projections must contain display-ready structured values, not prose or formatted currency strings. At minimum they include both product identities, every cost and retail/wholesale field affected by the fold, per-branch quantity and lot counts, active state, and primary/gallery image effects. The UI formats USD, KHR, quantities, and translations.

`manifest_digest` is SHA-256 over canonical JSON containing `manifest_version` and the ordered, authoritative case descriptors, including each `state_digest`. Order is part of the manifest. Each `state_digest` covers all state that can change the fold or its result, including dependent stock, lots, linked rows, images, active/group state, normalized identity, and financial fields; product `updated_at` alone is insufficient. The digest is a consistency token, not a permission token, and the server recomputes it.

Skipped and blocked entries use stable codes plus fallback English messages. Expected codes include `not_exact_pair`, `overlapping_selection`, `incompatible_product_identity`, `invalid_merge_numeric`, `stock_session_reversible`, `image_permission_required`, `merge_case_exceeds_safe_limit`, and `merge_state_conflict`.

### Apply and continue

Add `POST /api/products/possible-duplicates/merge-batch`.

Request:

```json
{
  "client_request_id": "product-conflict-merge-uuid",
  "manifest_version": 1,
  "manifest_digest": "sha256-opaque-to-the-client",
  "cases": [
    {
      "ordinal": 0,
      "case_key": "leadingzero:012345",
      "keep_id": 41,
      "merge_id": 92,
      "state_digest": "sha256-opaque-to-the-client",
      "stock": "write_off"
    }
  ]
}
```

The request has the same pair and product limits as preview. `client_request_id` is required, 8–120 characters, and restricted to the repository's existing safe request-ID character set. `stock` is exactly `merge`, `write_off`, or `null`; `null` is valid only when authoritative stock does not require a choice. The canonical request digest includes the manifest, ordered cases, and every stock choice.

The route must use a durable run receipt rather than infer an unknown retry from current product state. Add the next available append-only migration at implementation time with:

- `product_conflict_merge_runs`: run ID, actor ID, request ID, request digest, manifest version/digest, canonical request JSON, status, result JSON, and timestamps, with `UNIQUE(actor_id, request_id)`;
- `product_conflict_merge_run_cases`: run ID, ordinal, case key, keeper/merged IDs, expected state digest, stock choice, deterministic operation ID, status, refusal/error fields, and timestamps, with unique `(run_id, ordinal)`, `(run_id, case_key)`, and operation ID.

The tables are receipts and continuation state, not a second history system. Add them to backup/restore and core-data invariants. Do not add selection-wide undo payloads.

On the first apply call, before inserting the receipt or changing a product, the server:

1. checks `products:merge_duplicates` at `full`;
2. strictly validates the complete body and rejects all pair overlap;
3. re-reads every case and recomputes the authoritative manifest;
4. rejects the complete request with zero writes if any case is missing, no longer an exact eligible pair, has a changed keeper, has a mismatched state/manifest digest, lacks a required stock choice, is blocked by a reversible stock session, exceeds a safe per-case limit, or would change images without `products:image` at `full`;
5. inserts the run and planned case rows only after every case passes.

If a run already exists for `(actor_id, client_request_id)`, compare its canonical request digest before doing any other work. An exact retry returns or continues the stored run. Different data returns `409 idempotency_conflict`, including changes to order, membership, keeper, digest, or stock choice. A continuation reads the stored initial manifest and validates only still-planned cases; it does not recompute already committed products as though they were still active.

Every pair uses a deterministic operation ID derived from the run ID and ordinal. Its call to `foldDuplicateProductInto` reuses the current case snapshot, CAS assertions, image assertion, 100-statement write cap, atomic history statements, and counted history finalizer. The pair's receipt transition to `committed` with its operation ID is appended to the same D1 batch as the product graph, stock, snapshot, action-history, and audit writes. Therefore either the complete pair and its provenance commit, or none of them do. The post-commit finalizer may attach the action-history ID and mark `undo_ready`; failure leaves the committed pair as `history_pending` and stops the run without reporting the merge as failed.

The request uses the existing counted database behavior, 20 second deadline, and 700-statement ceiling. Preview and initial-manifest reads, receipt statements, pair reads, the complete D1 write batch, fingerprint reads, and finalization all count. Never run pair writes with `Promise.all`. Predict the next complete pair and yield before it; never split one pair across requests. A normal `merge_budget_reached` response with proven progress and a positive finite continuation bound automatically calls the same endpoint with the same body, request ID, manifest digest, and abort signal. `merge_infrastructure_interrupted` stops automatic calls, returns unknown remaining counts as `null`, reloads authoritative state, and requires a new manual resume action against the durable run receipt.

Concurrent changes after the initial all-case preflight are handled by the existing per-pair CAS. If one pair has already committed and the next pair drifts, return the exact committed prefix and refuse or interrupt before changing that pair. Never label the whole request rolled back.

Response:

```json
{
  "success": true,
  "complete": false,
  "blockedOnly": false,
  "interrupted": true,
  "interruptionCode": "merge_budget_reached",
  "madeProgress": true,
  "requestId": "product-conflict-merge-uuid",
  "manifestDigest": "sha256-opaque-to-the-client",
  "committedCases": [
    {
      "caseKey": "leadingzero:012345",
      "keptId": 41,
      "mergedId": 92,
      "stockDisposition": "write_off",
      "operationId": "deterministic-operation-id",
      "actionHistoryId": 7001,
      "undoReady": true
    }
  ],
  "processedCaseKeys": ["leadingzero:012345"],
  "refusals": [],
  "pendingCaseKeys": ["barcode:9988"],
  "remainingCaseCount": 1,
  "maxAdditionalRequests": 1,
  "undoPendingOperationIds": []
}
```

`complete` is true only when every case in the reviewed manifest committed. `blockedOnly` is true only after an authoritative reconciliation proves that every uncommitted case has a deliberate refusal; it never changes `complete` to true. `remainingCaseCount` and `maxAdditionalRequests` are `null` after an infrastructure failure. An exact retry includes all stored committed cases and does not add product, stock, audit, snapshot, or action-history rows.

## Frontend and transport contract

- Replace the serial `bulkMerge` calls in `ProductDuplicatesTab.tsx` with a combined preview modal. Keep single-card `mergeWithChoice` unchanged.
- Extract the exact-pair eligibility and deterministic keeper rule into a pure frontend helper and mirror it with one backend helper. Keep the existing product identity parity tests; add a focused backend/frontend case table so the two implementations cannot drift.
- Add typed preview/apply functions to `productWriteTransport.ts`. Preview uses plain `apiFetch`; apply uses the server route directly with a stable request ID and abort signal, with no optimistic local product mutation and no offline queued replay. Invalidate products and inventory caches after a started request settles, including timeout, abort, and unknown outcome, before authoritative reload.
- Keep a monotonic run token/ref so an aborted preview, stale continuation, or late response cannot overwrite a newer selection or modal.
- Preserve case choices by case key during an explicit stale-preview reload, but clear a choice when pair membership, keeper, or `needs_stock_choice` changes. Require reconfirmation after any preview change.
- Render every new label and refusal through EN/KM language keys. Never expose raw codes, snake_case field names, or untranslated server prose as the primary UI.

## Audit, undo, and data integrity

- Each committed pair creates exactly one `undo_snapshots` row, one `action_history` row, and one `audit_logs` row in the same D1 batch as the fold and its case-receipt transition.
- The audit and snapshot record the actor, request/run IDs, manifest digest, case key and ordinal, keeper and merged IDs/names, stock disposition, exact before state, projected/actual after state, and merge context `selected conflict review`.
- Write-off continues to create the existing balancing inventory movements; moving stock preserves branch and lot identity. No separate fee, stock, or summary adjustment may duplicate the fold's effects.
- A pair with pending history fingerprint is visibly committed but has no enabled Undo until finalization succeeds. Retrying the run may complete finalization; it must not repeat the fold.
- Undo and redo keep the existing `products:merge_duplicates` full gate and snapshot fingerprint checks. A changed graph fails closed. There is no selection-wide Undo and no action claiming that a partially completed run was wholly applied.

## Focused acceptance tests

### Pure and transport tests

- Eligibility table: two active non-group rows with the same normalized nonblank name and identity barcode pass; similar names, different identity barcodes, blank names, cost outliers, inactive/group rows, and 3+ rows fail. Keeper ordering matches for clean versus extra-zero barcode, stock, and ID ties.
- Manifest parser rejects unknown keys, malformed scalar types, unsafe IDs, duplicate case keys, duplicate product IDs, cross-case overlap, more than 12 pairs, more than 24 products, reordered/tampered digests, and a stock choice on the wrong case.
- Canonical request hashing is stable for an exact retry and changes for order, membership, keeper, state digest, or stock choice.
- Transport creates one request ID outside the continuation loop and forwards the same request ID, body, digest, and abort signal on every normal-budget continuation. Preview never uses a write queue.
- UI tests require one combined modal and one final confirmation, no pair mutation before confirmation, explicit choices for all stocked pairs, visible before/after stock and money values, preserved manual/skipped reasons, and enabled Cancel while working.

### Worker route and SQLite tests

- Preview performs zero writes and returns authoritative before/after projections for two independent eligible pairs, including per-branch lots, differing permitted costs, retail/wholesale changes, and primary/gallery image effects.
- A merge-authorized actor without general image permission can preview/apply a no-image-effect manifest. The same actor gets a full preflight refusal with zero writes when any selected pair would change images. A user without `products:merge_duplicates` cannot preview or apply.
- Two independent pairs with different stock choices commit under one request. Each has the correct graph and inventory result plus exactly one snapshot, one action-history row, one audit row, and one committed case receipt. There is no selection-wide history row.
- Exact retry returns the same receipt and IDs with no extra writes. Reusing the request ID with a changed manifest or choice returns `409 idempotency_conflict`.
- Stale membership, keeper, financial field, stock/lot row, linked row, image, reversible session, or state digest discovered during initial preflight rejects the whole request before the run receipt or any business/history write.
- A race after preflight but before a pair batch causes the pair CAS to roll back that pair completely. If an earlier pair committed, the response lists it and leaves the raced and later pairs unchanged.
- An injected D1 failure in a pair batch leaves that pair's products, stock, receipt, snapshot, action history, and audit unchanged while preserving a previously committed pair.
- An injected post-commit history-finalizer failure returns the pair as committed with `undoReady: false`, records its operation ID, stops further pairs, and never retries the fold.
- Counted statements include initial preview verification, run/case receipts, pair reads, every batch member, fingerprint work, and finalization. The route yields before a complete next pair would cross 20 seconds or 700 statements, and no pair write batch exceeds 100 statements.
- A budget yield with progress returns a finite bound and continues the same authorized run. An injected overload/timeout returns `merge_infrastructure_interrupted`, nullable remaining counts, and no automatic retry.
- Backup/restore and core-data tests include both receipt tables. The append-only migration preserves all existing product, stock, snapshot, action-history, and audit rows and objects.

### Browser smoke

Use only synthetic local products. Select at least two eligible pairs, with one stocked discarded row and one unstocked row. Confirm that the combined modal shows the same authoritative before values as the database, requires one stock choice, previews both after outcomes, commits both after one confirmation, refreshes the conflict list, and exposes two independent Undo actions. Repeat the exact request and verify no duplicate history or stock movement. In a second tab, change one pending product after preview; the first tab must show the committed prefix and stale pair truthfully, preserve applicable choices during re-preview, and require reconfirmation. Inject a local timeout after one committed pair and verify authoritative reload plus manual resume without duplicate work.

## Expected runtime ownership after source freeze

The implementation owner should receive these paths as one bounded cross-layer slice:

- `frontend/src/components/products/ProductDuplicatesTab.tsx`
- a new combined review modal and pure selected-merge run helper under `frontend/src/components/products/`
- `frontend/src/api/productWriteTransport.ts`
- `cloudflare/src/routes/products.ts`
- a new pure selected-manifest/run helper under `cloudflare/src/lib/`
- the next available append-only D1 migration plus its backup/core-invariant entries
- focused frontend and Cloudflare tests for the contracts above

`cloudflare/src/lib/undoAppliers.ts` should remain shared infrastructure unless the runtime owner proves that the existing atomic statement builder cannot accept the case-receipt transition without a small, separately claimed extension. Import review, unrelated product editing, contact merging, sales, and production data are excluded.

## Release gate and recovery

Ship only after the focused suites, frontend and Worker typechecks, i18n verification, migration preservation checks, and synthetic browser smoke pass on the integrated candidate. No production merge is part of implementation verification.

If a release must be rolled back, the new endpoints and modal can be disabled while retaining the receipt tables. Already committed pairs remain ordinary per-pair merge actions with their existing audit and undo records. Never delete receipt or history rows to simulate a rollback.

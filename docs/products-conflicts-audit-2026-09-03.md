# Lane D — products conflicts: STATUS

**State: READ-ONLY. Nothing here is applyable. Both rehearsals are red.**
Last worked 2026-09-03; the working agent stopped on a session rate limit mid-run.

## The one-line summary

Every tier SQL file in this directory is prepared but unverified or actively failing.
`products-conflicts-tier1.sql`, `tier2.sql` and `tier3.sql` each now carry a DO-NOT-RUN
banner explaining its specific status. Do not run any of them against any database,
production or otherwise, and do not "fix" a red rehearsal by relaxing a guard.

## What the guard table actually is (this was misread once already)

`products_conflict_guard` is **an assertion mechanism, not a data table**:

```sql
CREATE TABLE IF NOT EXISTS products_conflict_guard (value INTEGER NOT NULL CHECK(value=1));
INSERT INTO products_conflict_guard(value) SELECT CASE WHEN <invariant> THEN 1 ELSE 0 END;
```

A held invariant inserts 1; a violated one inserts 0, trips `CHECK(value=1)`, and aborts
the batch. So **"CHECK constraint failed: value=1" means an invariant assertion FAILED** —
the safety mechanism working exactly as designed. It is never a SQL syntax problem, and the
correct response is never to weaken or drop the guard.

## The two red rehearsals

**tier1 — 6 families, 128 statements, authorized.**
In-script guards all PASSED: 5 guard rows, min value 1; branch 1 total 10615 and branch 2
total 12465 unchanged; no negative stock. But the harness's *independent* check reported
`stockQtyMismatch: 1`. So the SQL's own assertions are satisfied while an invariant they do
not cover is violated.
Suspected cause, **unconfirmed**: the denormalized `products.stock_quantity` on a survivor
row is not recomputed after that family's `branch_stock` rows are moved onto it. The guards
assert branch totals, which are unaffected by a stale denormalized column — which is
precisely why they pass and the harness does not.
Next step: dump the one mismatching family from the rehearsal copy and compare
`products.stock_quantity` against `SUM(branch_stock.quantity)` for the survivor.

**tier2 — 1400 families, 28014 statements, `authorized: false` in the report.**
Aborted with the guard assertion above. **Which invariant fails has not been identified.**
Note the authorization state is now stale in the other direction: the user's later ruling
("0/blank = missing → merge them") does authorize this bucket in principle, but a bucket
being authorized and its SQL being correct are different questions, and this SQL is not.

**tier3 — never rehearsed.** Generated after the last rehearsal pass; carries no evidence
of any kind.

## Unreconciled: two passes disagree on the same production data

Lane D's classifier and session 6d's disagree on counts drawn from one dataset. One of them
is wrong and it is not yet known which:

| bucket | Lane D | 6d |
|---|---|---|
| cost missing on one side | 1723 | 1682 |
| both costs set and different | 409 | 392 |
| stocked on both sides | 279 | 267 |
| costs identical | 10 | 0 |

The `identical` row is the loudest signal — 10 vs 0 is not a tolerance difference, it is a
definitional one. Reconcile the two classifiers before trusting either tier's family list.

## Standing user constraints (do not relax these)

- **Same barcode / different name conflicts: DO NOT TOUCH.** User: "keep. i do myself."
- **Similar-name conflicts: DO NOT TOUCH.** Same ruling.
- Authorized to merge: leading-zero barcode pairs whose cost also matches once the leading
  zero is removed; selling price takes the highest. Plus, by the later ruling, the
  `cost-differs-only-by-an-unset-0` bucket (0/blank read as missing).
- Both-costs-genuinely-differ pairs (185): **review list only, never auto-merge.**
- The 72 `every-row-has-stock` families have no answer under the user's "keep the one with
  stock" rule — every row qualifies. Route to review; do not invent a tiebreak.
- `cost-differs-by-rounding-only` (110): undecided, never ruled on. Route to review.

## Preconditions that DID verify clean

32 triggers, 3 `trg_products`, 0 blank name keys, 0 name-key drift, 0 doubled-whitespace
names, 0 stray-whitespace barcodes. The name-normalization delta between the two candidate
rules is **0 extra groups and 0 differing rows** — the whitespace concern raised earlier in
this round is empirically zero on production and is not in scope.

## Before anything here is ever applied

1. Both rehearsals green **and explained** — not green by guard removal.
2. The 6d count reconciliation closed.
3. A D1 Time Travel bookmark captured immediately beforehand.
4. A completed scheduled backup artifact observed in the bucket.
5. An explicit user go. There is no standing authorization for production D1 writes.

## Not written yet

`ANALYSIS.md`, `RISKS.md`, and the `cloudflare/scripts/test-*-pure.cjs` unit test for the
identity/merge rules. The lane is not finishable without them.

## Where the artifacts live

The generated SQL, the review CSVs and the rehearsal databases are **local scratch only**,
under `outputs/audit-58-20260903/` in the lane worktree — 762 MB, of which `work/` is raw
production table dumps (`products.json`, `sale_items.json`,
`latest_data_source_links.json`, …) and better-sqlite3 rehearsal copies. **None of it is
committed and none of it should be**: it is production business data, and it is fully
regenerable from `fetch_prod_tables.cjs` + `build_conflict_fix.cjs`.

What that means for whoever resumes: the tier SQL and the two review CSVs
(`conflicts-out-of-scope.csv`, `leading-zero-pairs.csv`) do not exist outside that
worktree. Regenerate them rather than hunting for them in git.

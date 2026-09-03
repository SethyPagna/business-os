# SPEC — Lane B: Stock transfer (entire-branch scope, ConfirmDialog, small-screen layout)

**Status:** implementation spec. Written read-only from the isolated worktree
`C:\Users\mrkl6\Downloads\bos-rc-workers\s58-lanes` at detached HEAD `c2bb7e6c`. No source file was
edited producing this document. Every claim carries a `file:line` that was actually read; unverified
things are listed under **Could not verify**.

**User's words (verbatim):**
> "for stock transfer, the select all is wrong, previously we merge the one by one and the many…the
> select all is a function made to transfer all products in said branch over to the other branch…
> only regarding this specific select all… also make the design better for small screens, as it seems
> minimized only showing select branch after select branch does it expand the float page…make it show
> normally… no minimize then sudden expansion…skip the minimize part… show the actual part properly…
> etc… make them user-friendly… compact…no block in pwa ios small screens."

**Approach is already ruled by the coordinator. Spec to it; do not redesign.**

---

## 0. Three premises in the brief that are FALSE at this HEAD

Read these before planning. Two of them change the shape of the work.

> **All three were accepted by d9 (coordinator) on 2026-09-03**, with rulings attached — see §0.4.

**P1 — `cloudflare/src/lib/planTier.ts` does not exist in this worktree.** Verified by
`ls cloudflare/src/lib/planTier.ts` (no such file) and a repo-wide grep for `planTier` (zero hits
outside `node_modules`). It exists only on other branches — `rc/p2-8-plans`, `rc/coordinated-2026-09-02`,
`rc/p2-4-pages`, `rc/p2-4b-products`, `rc/p2-9-pwa`, `rc/sec-10-reports`, `rc/sec-11-ios-pwa`,
`rc/sec-8b-plan-variants-pwa` (commits `7e1e688d`, `75092337`, `dafe83e6`).
`cloudflare/src/routes/branches.ts` invokes **no** plan gating and **no** rate limiting
(`cloudflare/src/index.ts:298` mounts `/api/branches` bare; `lib/rateLimit.ts` is imported only by
`ai.ts`, `auth.ts`, `files.ts`, `portal.ts`, `products.ts`, `system.ts`, `users.ts`).

The only limit a bulk transfer respects today is `cloudflare/src/routes/branches.ts:545`
`const MAX_BULK_TRANSFER_ITEMS = 200`, enforced at `:568-570`.

> **Consequence for this lane:** "respect `lib/planTier` limits" cannot be implemented here without
> first merging the branch that introduces it. Spec §2 therefore defines a **local** statement-chunk
> constant in the established house style, written so that swapping in
> `planTier`'s `d1BatchChunkStatements` (Paid 300 / Free 100, per
> `git show rc/p2-8-plans:cloudflare/src/lib/planTier.ts:151`) later is a one-line change.
> **Open decision A** (§7).

**P2 — there is no shared commit helper.** `POST /transfer` (`branches.ts:327`) and
`POST /transfer-bulk` (`branches.ts:547`) each build their own statement array inline, with the SQL
duplicated near-verbatim between `branches.ts:395-483` and `branches.ts:696-770`. What *is* shared is a
set of statement-builder primitives in `cloudflare/src/lib/productBatches.ts`, listed in §1.3. The
entire-branch mode must reuse **those primitives**, and the honest way to phrase the requirement is:
*produce the same statement groups the existing per-item loop produces.*

**P3 — `stock_transfers` is one flat row per product; there is no `transfer_items` table.**
`cloudflare/migrations/0001_init.sql:609-621`:
```sql
CREATE TABLE stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_branch_id INTEGER, to_branch_id INTEGER,
  product_id INTEGER, product_name TEXT, quantity REAL, notes TEXT,
  user_id INTEGER, user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  client_request_id TEXT
);
```
No `ALTER TABLE stock_transfers` exists in any later migration (grep over `cloudflare/migrations/`
returns none), and `grep -rn "transfer_items" cloudflare/migrations/` returns nothing. Today's bulk
route inserts **one `stock_transfers` row per item** inside the per-item loop
(`branches.ts:704-707`), so a 300-product bulk transfer already produces 300 history rows.

> **Consequence:** "ONE transfer record with items" is not reachable without a schema change.
> §2.5 specifies the no-migration option — set the already-present but **never-written**
> `stock_transfers.client_request_id` (grep of `branches.ts` for `client_request_id`: zero hits) to a
> single generated group id on every row of one entire-branch run, so the rows are one logical
> transfer and history can group them. **Open decision B** (§7) is whether to instead add a real
> `transfer_items` table by migration.

---

## 0.4 Rulings received after this spec's first draft (2026-09-03)

Every question this spec raised has been answered. Each ruling is recorded with who decided it, and
§7 keeps the original questions with their answers attached rather than deleting them.

| # | Ruling | Decided by |
|---|---|---|
| R1 | A batch is identified **by its date**, as today (numeric MMDDYYYY). Do not propose richer batch selection anywhere in transfer. | **USER** |
| R2 | Child rows **already carry full branch details**, so a transfer is *just adding quantity from one branch to another on the matching child row*. Model entire-branch to that framing — not as a heavier operation. | **USER** |
| R3 | **No manual lot choice in transfer at all.** The unreachable lot picker is not restored. Lot/batch + branch identity is still preserved end to end — enforced automatically, never asked about. | **USER** |
| R4 | Same name + same details → merge. **A different barcode OR a different cost → a NEW child row.** Cost is an identity field; a cost mismatch must never auto-merge. | **USER** |
| R5 | **"check all child rows if name is same"** — every operation that matches on name sweeps EVERY child row under that name, never the first or the visible one. See §3.1. | **USER** |
| R6 | P1 accepted: no `planTier` at this base. Use a local `TRANSFER_BATCH_CHUNK_STATEMENTS = 300` matching `importEngine.ts:4746`, with the one-line-swap comment for RC merge. | **d9** |
| R7 | P2 accepted: **extract the shared commit helper FIRST, as its own commit**, with a pure test proving both routes emit identical statements for the same input. Only then build `entire_branch` on the helper. See §1.3a. | **d9** |
| R8 | P3 accepted: **no migration.** Group the N flat `stock_transfers` rows with `client_request_id` as BOTH the transfer id and the idempotency key; a retry with the same key is a **no-op returning the existing rows**. The history read at `compat.ts:1047` groups by it when present. See §2.5 — **with one correction, itself approved by d9 on 2026-09-03: that column carries a partial UNIQUE index (`0001_init.sql:769`), so the value is composite — group id, `:`, product id — not shared. §2.5 carries the normative rules.** | **d9**, corrected here |
| R9 | **The physical removal of the dead `mode` region is DEFERRED — it is NOT part of this hotfix.** It stays in place; owner is the de-bloat lane (RC P2-7 / post-deploy board cleanup). See §2.1 and §2.6. | **d9** |

**USER's ruling, verbatim** (the authority for R1–R5):

> "can just keep batch into the date like currently in to days of batch, . it doesn't have to be
> complicated as currently, we do default all child rows have all branch details… so if we transfer
> it is just a matter of adding the stock from one branch to another…nothing really big deal.. the
> same name same details merge, different barcode or cost makes new child row etc… make sure check
> all child rows if name is same.."

**R2 decoded into this spec's terms — read this before §1.5.** "Entire branch" is not a new kind of
operation. It is the *existing* per-child-row quantity move, applied to every child row that has
stock at the source branch, with the item list computed on the server instead of in the browser. The
design in §1.5 must not acquire ceremony the user explicitly ruled out: no new record type, no
staging table, no two-phase reservation, no per-lot questions. The only genuinely new machinery is
(a) the enumeration query (§1.4), (b) chunked commit (§1.6), and (c) the group id (§2.5) — and (c) is
a column that already exists.

**R4 is already true in code — no change needed to establish it, only to preserve it.**
`productDetailSignature` (`cloudflare/src/lib/productDetailRule.ts:110-116`) is exactly
`barcode + cost_price_usd + cost_price_khr` (costs as integer cents, `:87-89`), joined with a literal
U+0001 separator, and it deliberately excludes selling/special price (`:101-108`). Its own comment
states the user's rule verbatim in engineering terms: two rows sharing a name **and** this signature
"are the same product and must merge into one row"; sharing a name but **not** it "are sibling child
rows inside that name's group". The transfer merge path consumes it through
`findIdentityMatch` (`productIdentity.ts:78`, called at `branches.ts:380`) and
`findIdentityMatches` (`productIdentity.ts:120`, called at `branches.ts:645`). **Entire-branch mode
must go through those same functions and must not add any looser fallback** — in particular it must
never fall back to matching on name alone when the signature does not match, which would auto-merge a
cost mismatch. Owner of the wider R4/R5 work: **hf/merge** (see §3.1); Lane B's obligation is only to
not weaken it.

---

## 1. Server side

### 1.1 What `POST /api/branches/transfer-bulk` does today

Route: `cloudflare/src/routes/branches.ts:547`.

**Permission gate** (`:549-558`) — `getActionTier(user, 'branches', 'transfer')`; `'none'` → 403;
`'review'` → 403 with *"Transferring stock requires Full Access to Branches — Review Required support
for this action is not built."* Deliberately blocked, not queued.

**Request shape.** Top level (`:559-563`): `fromBranchId`, `toBranchId`, `note`,
`items: Array`. Per item (`:577-590`): `productId`, `quantity`, `batchId` — and nothing else; any
other per-item key is silently dropped.

**Validation, in order:** `:565` missing branch ids → 400; `:566` same branch → 400; `:567` empty
items → 400; `:568-570` `rawItems.length > 200` → 400; `:581-583` per-item positive quantity and valid
id; `:584-586` **duplicate `productId` in one request → 400** (it explicitly refuses to sum);
`:617-620` missing products → 404 with a `productIds` array; `:622-643` insufficient stock → 400 with
both a human string and a structured `items` array; `:665-675` lot-belongs-to-product (404) and
lot-availability-at-source (400).

**Reads, already chunked for the bound-param limit** (`:596-612`):
```ts
selectInChunks(productIds, 0, (chunk) => …products…)          // :599
selectInChunks(productIds, 1, (chunk) => …branch_stock…)      // :606  reserved=1 for @branchId
```
plus `findIdentityMatches(db, products)` at `:645` — one batched call, not N.

**The per-item loop** (`:680-771`) pushes statement groups:

| condition | statements | file:line |
|---|---|---|
| always | **5** — `branch_stock` decrement at source; `branch_stock` upsert at dest; `stock_transfers` INSERT; `inventory_movements` `transfer_out`; `inventory_movements` `transfer_in` | `:696-722` |
| identity-merge target | **+2** — `products.stock_quantity` `MAX(0, −q)` on source, `+q` on dest | `:735-740` |
| explicit `batchId` | **+2** — clamped decrement + increment | `:742-746` |
| no `batchId` (every multi-select row) | **+2 per FIFO take** | `:747-770` |

**Commit:** one `await db.batch(statements)` at `:773` — a single atomic SQLite transaction
(`cloudflare/src/lib/db.ts:136-139`). **No statement-count chunking exists.** The floor is 5
statements/item → 1000 statements at the 200-item cap, and the realistic worst case with merges and
multi-lot spread is well above that.

**Return** (`:812`): `{ success: true, transferredCount: items.length, merges }`. No lot information,
unlike `/transfer` which returns `destBatchId` (`:513`).

**Post-batch** (`:775-811`): one audit row per item, `await Promise.all(...)` inline; four
broadcasts/cache bumps; Telegram in `waitUntil` doing **3 DB queries per item**.

### 1.2 The two N+1s inside the loop — the entire-branch blocker

Both are `await`ed **inside** the `for…of`, i.e. strictly sequential, and both happen **outside** the
atomic batch:

- `branches.ts:759` — `const sourceLots = await readFifoLotAvailability(db, item.productId, fromBranchId)`.
  One D1 round-trip **per item**. A batched equivalent already exists and is unused here:
  `readFifoLotAvailabilityForCart(db, pairs)` at `cloudflare/src/lib/productBatches.ts:548-581` —
  it fetches every `(product, branch)` pair in one `selectInChunks` query and groups by
  `` `${productId}:${branchId}` `` preserving FIFO order.
- `branches.ts:693` and `:763` — `await resolveDestinationBatch(...)` per item / per take. It can
  **INSERT** a cloned `product_batches` row (`productBatches.ts:440-470`), so it is a write executed
  outside the transaction.

At 200 items this is already 200+ sequential round-trips before the batch starts. For an entire
branch (potentially thousands of lots) it is the dominant cost and will exceed the Worker's budget.
**Fixing the FIFO N+1 is not optional for this lane.**

### 1.3 The shared primitives to reuse (do not re-write the SQL)

| helper | file:line | note |
|---|---|---|
| `readFifoLotAvailabilityForCart(db, pairs)` | `productBatches.ts:548` | batched; **use this** |
| `readFifoLotAvailability(db, productId, branchId)` | `productBatches.ts:526` | per-product; the N+1 |
| `allocateAcrossLots(lots, quantity)` | `productBatches.ts:590` | pure; returns `{ takes, uncovered }` |
| `resolveDestinationBatch(db, sourceBatch, destProductId)` | `productBatches.ts:434` | may INSERT a cloned lot |
| `decrementBatchStockStatement(batchId, branchId, qty)` | `productBatches.ts:478` | **clamped** `MAX(0, quantity - @quantity)` |
| `decrementBatchStockStrictStatement(...)` | `productBatches.ts:493` | **strict** `quantity - @quantity` |
| `incrementBatchStockStatement(...)` | `productBatches.ts:501` | upsert `ON CONFLICT(batch_id, branch_id) DO UPDATE … + @quantity` |
| `findIdentityMatches(db, sources)` | `productIdentity.ts:87` | batched merge-target lookup |
| `selectInChunks` / `chunkForBinding` / `D1_MAX_BOUND_PARAMS = 100` | `lib/sqlBinding.ts:64` / `:39` / `:25` | bound-param limit |

**Clamped vs strict is load-bearing.** Strict is used on the FIFO leg because the availability read
runs *outside* the batch: an underflow then trips `CHECK (quantity >= 0)` and aborts the whole
transaction rather than clamping and minting phantom destination stock
(`branches.ts:747-758` comment; `migrations/0058_stock_nonnegative_check.sql:38`).
**Entire-branch mode enumerates server-side and still commits in chunks, so the same race window
exists — keep using the STRICT statement on every auto-allocated leg.**

FIFO order (`productBatches.ts:532`):
`ORDER BY (pb.received_at IS NULL) ASC, pb.received_at ASC, pb.batch_number ASC, pb.id ASC`.

### 1.3a Sequencing — extract the shared helper FIRST, as its own commit (d9 ruling R7)

P2 established that `/transfer` (`branches.ts:395-483`) and `/transfer-bulk`
(`branches.ts:696-770`) each inline near-duplicate SQL and share nothing above the
`productBatches.ts` primitives. d9's ruling is that `entire_branch` is **not** built on top of that
duplication.

**Commit 1 — extraction only, zero behaviour change.**

Add to `cloudflare/src/lib/` (new file, e.g. `transferStatements.ts` — not into `productBatches.ts`,
which is consumed by sales and returns and should not gain route-shaped logic) a pure builder:

```ts
export type TransferLeg = {
  productId: number
  destProductId: number        // === productId unless an identity merge redirects it
  quantity: number
  lots: Array<{ sourceBatchId: number; destBatchId: number; quantity: number }>  // [] = no lot tracking
  strict: boolean              // true on every auto-allocated leg (see 1.3)
  // history/movement fields the two routes already write identically
}

/** The exact statement group one transferred product produces. Pure: no db access,
 *  no INSERTs performed here — batch cloning (resolveDestinationBatch) and every read
 *  happen in the caller, before the group is built. */
export function buildTransferStatements(leg: TransferLeg, ctx: TransferContext): Array<{ sql: string; params: Record<string, unknown> }>
```

Then rewrite **both** existing routes to call it. `/transfer`'s loop body
(`branches.ts:395-483`) and `/transfer-bulk`'s (`branches.ts:696-770`) become argument marshalling
plus one call. Nothing else in either route changes: the same reads, the same order, the same
`db.batch()` boundary, the same responses.

**Commit 1's test — the proof obligation.** A pure test
(`cloudflare/scripts/test-transfer-statements-shared-pure.cjs`) that, for the same input, asserts the
statement array is **identical** — same SQL strings in the same order with the same params — to what
each route emitted before the extraction. The practical way to do that without a golden file that
rots: drive both code paths in the same process against the real migration chain (the loader shape at
`test-lot-ledger-reconcile-pure.cjs:24-38`), capture each route's statements through a recording
`db.batch` stub, and `assert.deepStrictEqual` the two arrays. Cover: no-lot product, explicit-batch
product, FIFO multi-lot product, and an identity-merge redirect (all four shapes the current loop
handles).

**Commit 2 — `scope: 'entire_branch'` (§1.5) built on the helper.** It adds the enumeration query,
chunked commit and group id. It must add **no** new SQL string of its own: every statement it commits
comes out of `buildTransferStatements`. If commit 2 finds itself writing SQL, the extraction in
commit 1 was incomplete — go back and widen it rather than forking a third copy.

**Why the order matters here specifically:** building `entire_branch` first would make a third copy of
the SQL, and the copy would be the one exercising the newest, least-tested path (chunked commit) at
the highest volume (a whole branch). Extraction-first means the entire-branch path is, by
construction, the same code an iPhone already ran successfully through `/transfer-bulk`.

### 1.4 The enumeration query

Per-branch per-lot quantities live in **`branch_batch_stock`**, keyed `(batch_id, branch_id)`.
`product_batches` has **no** branch column; `branch_stock` has **no** lot column. There is no
`batch_branch_stock` table.

Authoritative schema — `cloudflare/migrations/0058_stock_nonnegative_check.sql:35-49` (a full table
rebuild that supersedes the `0001_init.sql` originals):
```sql
CREATE TABLE branch_batch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0 CHECK (quantity >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_branch_batch_stock_batch_branch_unique ON branch_batch_stock (batch_id, branch_id);
CREATE INDEX idx_branch_batch_stock_branch_qty ON branch_batch_stock (branch_id, quantity DESC, batch_id);
```
and `branch_stock` at the same file `:20-33` (unique `(product_id, branch_id)`, index
`(branch_id, quantity DESC, product_id)`). `product_batches` at `0001_init.sql:704-715`, with
`batch_number` added by `0016_product_batch_number.sql:22`.

**The entire-branch enumeration is `readFifoLotAvailability`'s query with the product predicate
dropped** — the index `idx_branch_batch_stock_branch_qty (branch_id, quantity DESC, batch_id)` covers
exactly this scan:

```sql
SELECT pb.variant_product_id AS product_id,
       p.name                AS product_name,
       pb.id                 AS batch_id,
       pb.lot_code, pb.expiry_date,
       bbs.quantity          AS available
FROM branch_batch_stock bbs
JOIN product_batches pb ON pb.id = bbs.batch_id AND pb.is_active = 1
JOIN products        p  ON p.id  = pb.variant_product_id AND p.is_active = 1
WHERE bbs.branch_id = @branchId AND bbs.quantity > 0
ORDER BY pb.variant_product_id ASC,
         (pb.received_at IS NULL) ASC, pb.received_at ASC, pb.batch_number ASC, pb.id ASC
```

**Untracked (legacy) stock must also move.** `allocateAcrossLots` returns `uncovered` for quantity the
lot ledger never tracked (`productBatches.ts:590-608` — "legacy stock the lot ledger never tracked …
it is just not attributable to a lot"). A branch can therefore hold `branch_stock.quantity` with **no
matching `branch_batch_stock` rows at all**. "Every product in said branch" must include those, so run
a **second** enumeration:

```sql
SELECT bs.product_id, p.name AS product_name, bs.quantity
FROM branch_stock bs
JOIN products p ON p.id = bs.product_id AND p.is_active = 1
WHERE bs.branch_id = @branchId AND bs.quantity > 0
```
and, per product, move `max(0, branch_stock.quantity − sum(lot availability))` on `branch_stock`
alone — exactly what the existing loop already does for `uncovered`.

### 1.5 The `scope: 'entire_branch'` diff shape

Extend the existing route; do **not** add a new one.

**Request** — one new optional top-level field, read alongside the existing four at `branches.ts:559-563`:

```ts
const scope = String(body.scope ?? 'items')   // 'items' (default, today's behaviour) | 'entire_branch'
```

**Branching, immediately after the `fromBranchId`/`toBranchId` checks at `:565-566`:**

```ts
if (scope === 'entire_branch') {
  // items[] is IGNORED. The list is computed here, from the DB.
  if (Array.isArray(body.items) && body.items.length) {
    return c.json({ error: 'scope=entire_branch computes its own item list; do not send items' }, 400)
  }
  // → §1.4 enumeration, §1.6 chunked commit
}
// else: today's path at :567 onward, byte-for-byte unchanged
```

The existing `:567` empty-items 400, the `:568-570` 200-item cap, the `:584-586` duplicate rejection,
and the whole `:596-643` validation block stay **exactly as they are** for `scope: 'items'`. Nothing
about today's iPhone-verified flow may change.

For `entire_branch`:

- **No 200-item cap** — that constant exists to bound one `db.batch()`, and this path chunks instead.
  Give it its own ceiling as a guard against a pathological branch:
  `const MAX_ENTIRE_BRANCH_PRODUCTS = 5000` at module scope beside `MAX_BULK_TRANSFER_ITEMS:545`,
  with a comment justifying the number. Over it → 400 telling the operator to use the item list.
  The 5000 is **calibrated against production, not guessed** (SELECT-only snapshot, 2026-09-03
  ~06:50Z, coordinator business-os-v1-ea): `branch_stock` rows with `quantity > 0` are
  **branch 1 — 1,292 rows / 10,615 units** and **branch 2 — 3,316 rows / 12,465 units**. So 5,000
  carries roughly **1.5x headroom** over the larger branch today, and an entire-branch transfer of
  branch 2 is about **12 chunks of 300**. These are a moving snapshot: re-measure when the catalogue
  grows, and treat 5,000 as a guard rail chosen against observed scale, not a capability limit.
- **Quantity per product = the full branch quantity.** There is nothing to validate against a client
  number; the enumeration *is* the source of truth. The insufficient-stock branch (`:622-643`) is
  therefore skipped — but keep the STRICT decrement so a concurrent sale still aborts the chunk rather
  than clamping.
- **`findIdentityMatches`** (`:645`) still runs, batched, over the enumerated products.
- **Lot identity is preserved per lot, never summed.** For each enumerated lot row emit
  `decrementBatchStockStrictStatement(lot.batchId, fromBranchId, lot.available)` +
  `incrementBatchStockStatement(destLotId, toBranchId, lot.available)`, where `destLotId` is
  `lot.batchId` when there is no merge and `resolveDestinationBatch(...)` when there is
  (`branches.ts:761-766`). Never aggregate a product's lots into one quantity, and never move a lot
  across a branch boundary other than source→destination
  (memory `batch-identity-invariant`).
- **`resolveDestinationBatch` must be pre-resolved, not called in the loop.** Collect the distinct
  `(sourceBatch, destProductId)` pairs that actually need it (merge cases only) and resolve them once
  each into a `Map` **before** building statements. Non-merge cases need no call at all.

**Statement group per product** — identical in content to today's loop, so the two paths cannot drift:

```
1. UPDATE branch_stock  … − qty  (source)            branches.ts:697
2. INSERT branch_stock  … + qty  ON CONFLICT (dest)  branches.ts:698-703
3. INSERT stock_transfers                            branches.ts:704-707
4. INSERT inventory_movements 'transfer_out'         branches.ts:708-712
5. INSERT inventory_movements 'transfer_in'          branches.ts:713-721
[+2 if merge]  products.stock_quantity −/+           branches.ts:735-740
[+2 per lot]   strict decrement + increment          branches.ts:767-770
```

**One movement per lot.** The coordinator's "one movement per lot" is a real change from today: the
current loop emits exactly **one** `transfer_out` / `transfer_in` pair per *item*, carrying
`batchId: sourceBatchForItem?.id ?? null` — which is **`null` for every FIFO-allocated item**
(`branches.ts:711`, `:720`), so multi-lot moves lose lot attribution in
`inventory_movements` today. For `entire_branch`, emit one `transfer_out`/`transfer_in` pair **per
lot**, each with its real `batch_id`, plus one pair with `batch_id: null` for any `uncovered` remainder.
This raises the per-product statement count and must be reflected in the chunk arithmetic (§1.6).

> This also means `entire_branch` produces a *more* faithful movement ledger than `scope: 'items'`.
> Flagged as **Finding F1** (§6) — the same fix arguably belongs on the item path.

### 1.6 Chunking and the all-or-nothing boundary

**Two distinct D1 limits; do not conflate them.**

- **Bound parameters** — `cloudflare/src/lib/sqlBinding.ts:25` `D1_MAX_BOUND_PARAMS = 100`, with
  `chunkForBinding(items, reservedParams, paramsPerItem)` (`:39`) and `selectInChunks` (`:64`). The
  header at `:1-24` documents the measured production failure and the trap that `@name` reused twice
  costs two slots — hence `reservedParams` is an explicit argument. Applies to the **reads**
  (`branches.ts:599`, `:606`, `:652`, `:657` already comply).
- **Statements per `db.batch()`** — the house constant is
  `cloudflare/src/lib/importEngine.ts:4746` `const D1_IMPORT_BATCH_CHUNK_SIZE = 300 // statements per
  db.batch() call, not rows …`, consumed by `runD1BatchInChunks` (`:4766`, with adaptive
  halve-and-retry on `isD1CpuLimitError`, `:4761`, `:4786-4795`) and
  **`runD1BatchGroupsInChunks` (`:4810`)**, which packs *whole groups* and never splits mid-group
  (`:4801-4834`). Same convention at `lib/bulkDeleteEngine.ts:144`
  (`BULK_DELETE_CHUNK_SIZE = 500`, whose comment explicitly cites `D1_IMPORT_BATCH_CHUNK_SIZE`) and
  `lib/backup.ts:1079` (`const CHUNK = 80`).

**Specification:**

- Build `groups: Array<Array<{sql, params}>>` — **one group per product**, containing that product's
  5 base + merge + per-lot statements. A group must never be split: a half-committed product is a
  ledger that does not balance.
- Commit with `runD1BatchGroupsInChunks(db, groups, TRANSFER_BATCH_CHUNK_STATEMENTS)`.
  Import it from `../lib/importEngine` or — preferably, since `branches.ts` should not depend on the
  import engine — **lift `runD1BatchGroupsInChunks` + `isD1CpuLimitError` into
  `cloudflare/src/lib/d1Batch.ts` and re-export from `importEngine.ts`** so both callers share one
  implementation. Pure move, no behaviour change. (**Open decision C**, §7.)
- Declare, at module scope in `branches.ts` beside `MAX_BULK_TRANSFER_ITEMS:545`:
  ```ts
  // Statements per db.batch() call, NOT products. One product is 5 base statements
  // plus 2 per merge and 2 per lot leg, so a lot-heavy product can be 15+. 300 matches
  // lib/importEngine.ts's D1_IMPORT_BATCH_CHUNK_SIZE, the measured ceiling for D1's
  // per-transaction CPU budget. Replace with planTier's d1BatchChunkStatements
  // (Paid 300 / Free 100) once that module lands on main.
  const TRANSFER_BATCH_CHUNK_STATEMENTS = 300
  ```

**The all-or-nothing boundary, stated plainly (this must reach the UI):**

- **Within one chunk:** fully atomic. `db.batch()` is one SQLite transaction
  (`cloudflare/src/lib/db.ts:136-139`); any statement throwing rolls the whole chunk back, and because
  groups are never split, every product in that chunk either fully moved or did not move at all.
- **Across chunks:** **not** atomic. Chunk 3 failing leaves chunks 1-2 committed. This is unavoidable
  — D1 has no cross-request transaction — so it must be *reported*, never hidden:
  - the route returns the counts of what actually committed;
  - on a mid-run failure it returns **HTTP 207-style partial success in a 200 body**, not a 500:
    `{ success: false, partial: true, transferredProducts, transferredLots, transferredUnits,
       failedAtChunk, remainingProducts, error }`;
  - the client shows that verbatim and **keeps the modal open** (memory `failed-action-keeps-form`),
    with a "Transfer the remaining N" retry that re-runs the same `scope: 'entire_branch'` call —
    which is naturally idempotent-ish because the enumeration re-reads live quantities and the already-
    moved lots now hold 0 at the source.
- Emit **one audit row per chunk**, not per item — today's `await Promise.all(items.map(audit))` at
  `branches.ts:775-783` would be thousands of awaited writes.
- The Telegram block (`branches.ts:791-811`) runs **3 DB queries per item** inside `waitUntil`. For
  `entire_branch` replace it with a single summary notification. Otherwise an entire-branch move fires
  thousands of queries after the response.

### 1.7 Response shape

```ts
// scope: 'items'  — UNCHANGED
{ success: true, transferredCount, merges }

// scope: 'entire_branch'
{
  success: true,
  scope: 'entire_branch',
  transferGroupId: string,     // see §2.5 / P3
  transferredProducts: number,
  transferredLots: number,     // rows moved out of branch_batch_stock
  transferredUnits: number,    // total quantity
  untrackedUnits: number,      // the `uncovered` remainder moved on branch_stock alone
  merges: Array<{ productId, productName, mergedIntoProductId, mergedIntoProductName }>,
  chunks: { total: number, committed: number },
}
```

### 1.8 A preview endpoint for the confirm dialog

The dialog in §2.3 must show product / lot / unit counts **before anything is written**. Add a read:

```
GET /api/branches/:id/transfer-preview?toBranchId=<n>
→ { products, lots, units, untrackedUnits, productsWithoutLots }
```

It runs the §1.4 enumeration as two `COUNT`/`SUM` aggregates — no row payload, so it is cheap and
cannot be truncated by a page size. Gate it with the same `getActionTier(user,'branches','transfer')`
check as the write (`branches.ts:549-558`) so the preview cannot leak counts to a user who could not
perform the move.

> Alternative considered and rejected: computing the counts client-side from the already-loaded
> `multiProducts`. That list is per-**product**, not per-**lot** (`getBranchStock` returns
> `branch_quantity`), so it cannot state a lot count; and it comes from a transport that resolves
> failures as an empty array (§6, F2), so it could confidently report "0 products".

---

## 2. Client side — `frontend/src/components/branches/TransferModal.tsx`

1200 lines, one mount point: `frontend/src/components/branches/Branches.tsx:1757-1770`
(`LazyTransferModal`, lazy-loaded at `Branches.tsx:221`). There is **no**
`frontend/src/components/inventory/TransferModal.tsx` — `frontend/src/components/inventory/` contains
`InventoryStockModals.tsx` and no transfer modal file.

### 2.1 Dead code that must be removed first — half this file never runs

`TransferModal.tsx:206`:
```ts
const [mode] = useState<TransferMode>('multiple')
```
**No setter is destructured and `setMode` appears nowhere in the file.** `mode` is therefore the
constant `'multiple'` for the component's entire life. Consequently every `mode === 'single'` /
`mode !== 'multiple'` branch is unreachable:

| dead region | file:line | what dies with it |
|---|---|---|
| single-mode stock fetch effect | `:268-327` (guard at `:269`) | `products`, `singleStockPage`, `singleStockTotalPages`, `loadingProducts` |
| `loadMoreSingleProducts` | `:329-361` | paging |
| tracked-batch-ids effect | `:369-391` (guard at `:370`) | `trackedBatchProductIds` |
| per-product lot fetch effect | `:399-435` | `productBatches`, `selectedBatchId`, `loadingBatches` |
| `filtered` | `:516-519` | — |
| `handleTransfer` | `:630-708` | **the entire single-transfer submit path** |
| single-mode picker JSX | `:847-907` (guard at `:847`) | search + result list + "Show more" |
| selected-product panel JSX | `:909-1039` (guard at `:909`) | quantity, "All", note, **and the whole lot/batch picker at `:933-988`** |

Verified: `handleTransfer` is referenced nowhere in the JSX — grep for `handleTransfer` in this file
returns its definition at `:630` and one mention inside a comment at `:712`.

**So the lot/batch picker — `Automatic (FIFO)` plus one row per lot, `:944-981` — is currently
unreachable in the shipped app.** So is `transferStock` (the single endpoint) from this modal.

This matches the user's "previously we merge the one by one and the many": the merge happened
(comment at `:202-205`: "One picker handles both one-product and many-product transfers … Keeping one
mode removes the two diverging search and loading paths"), but the single-mode code was left behind
rather than deleted, and the lot picker went with it.

> **DEFERRED — d9 ruling R9, 2026-09-03. Lane B does NOT delete this code.** The first draft said
> "Lane B deletes all of it (Golden Rule: no zombie code)". That is overruled for this hotfix:
> removing ≈428 unreachable lines adds diff surface to a batch that is going onto a **live production
> deploy**, for zero behaviour change. The region stays physically in place and is routed to the
> de-bloat lane (RC P2-7 / post-deploy board cleanup). Full hand-off brief in §2.6.
>
> **Two consequences Lane B's implementer must honour:**
> 1. **Write the Lane B diff to work *alongside* the dead region.** No change may depend on those
>    lines having been removed — in particular §2.4's layout work edits the live `mode === 'multiple'`
>    JSX at `:1041` onward and must leave the `:847-1039` block syntactically intact, and the
>    now-unused imports `getProductBatches`, `getTrackedBatchProductIds`, `type ProductBatch`
>    (`:17-18`) and `transferStock` (`:14`) **stay**, because their dead consumers stay.
> 2. **Say so in the commit message.** A reader of `TransferModal.tsx` after Lane B lands will still
>    see unreachable code; it is **known and tracked**, not an oversight. hf/search and hf/dates have
>    been told not to edit inside that region.

### 2.2 "Select all" today, and why it is wrong

`toggleSelectAllFiltered` — `TransferModal.tsx:589-615`:

```ts
const toggleSelectAllFiltered = () => {
  if (!debouncedSearch.trim() && !showAllProducts) {
    setShowAllProducts(true)
    if (!multiProducts.length) { selectAllAfterLoadRef.current = true; return }
    setSelectedQuantities(Object.fromEntries(
      multiProducts.filter((p) => Number(p.branch_quantity || 0) > 0)
                   .map((p) => [String(p.id), String(p.branch_quantity ?? '')]),
    ))
    return
  }
  … // otherwise: toggle only the rows visible under the current search (:603-614)
}
```

Rendered as a **checkbox** labelled `t('transfer_select_all')` at `:1064-1073`, whose `checked` state
is `allFilteredSelected` (`:569-570`).

Four things are wrong with it as an "everything in this branch" action:

1. **It is client-side and depends on a list that may be truncated or empty.** The rows come from
   `multiProducts`, loaded by `getBranchStock(fromBranch, {})` at `:465` — and
   `frontend/src/api/branchTransport.ts:73-80` gives that call the local fallback `() => []`. A
   403/500/timeout therefore **resolves as an empty array**, so "select all" would cheerfully select
   nothing and report success. (Same anti-pattern `frontend/src/api/batchesTransport.ts:113-120`
   documents at length as a correctness hole.)
2. **It sums across lots.** Each entry is `{ productId, quantity: branch_quantity }` — the branch
   *total*. The server then FIFO-allocates (`branches.ts:747-770`), so the lot composition is decided
   by the server's read rather than by what is actually there, and the confirm text says so:
   `t('confirm_bulk_transfer_details')` = *"…Available lots will be allocated FIFO."* (`:746`).
3. **It caps at 200.** `handleBulkTransfer` sends every checked row (`:740`) and the server rejects
   `> 200` (`branches.ts:568-570`). A branch with more than 200 products cannot be transferred at all,
   with an error the operator can do nothing about.
4. **It doubles as a display toggle.** The same checkbox also sets `showAllProducts` (`:591`), which is
   what makes the catalog appear at all (`:454`, `:544`). So "Select all" means both "reveal the list"
   and "tick everything" — two unrelated jobs on one control.

### 2.3 Specification — "Transfer entire branch"

**Replace the checkbox with a labelled button**, in the same toolbar row (`:1064-1091`):

```
[ Transfer entire branch ]   [ 12 selected ]
```

- Label: `t('transfer_entire_branch')` → *"Transfer entire branch"* (new key, §4).
- Disabled unless both `fromBranch` and `toBranch` are set, and while `savingBulk`.
- It is **not** a checkbox and it does **not** touch `selectedQuantities`. Selecting individual rows
  and transferring the whole branch are now two separate actions — which is what the user asked for
  ("only regarding this specific select all").
- The list-reveal job moves to its own plain control: `t('transfer_show_all_products')` → *"Show all
  products"*, a text button that sets `showAllProducts` only. That untangles concern #4.
- Keep the existing per-row checkboxes and the `{n} selected` view toggle at `:1074-1090` exactly as
  they are — the item path is unchanged.

**Flow:**

1. Click → `GET /api/branches/:fromBranch/transfer-preview?toBranchId=<toBranch>` (§1.8).
2. Open the shared **`ConfirmDialog`** — `frontend/src/components/shared/ConfirmDialog.tsx`.
   **Never `window.confirm`.** The modal uses it twice today (`:655` and `:746`) and both must go;
   `ConfirmDialog`'s header (`:5-12`) states it exists to replace exactly these.
   Import: `import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog'`.
   Follow the park-then-commit shape `StockAdjustModal` uses
   (`frontend/src/components/products/forms/StockAdjustModal.tsx:405-407` sets `pendingAdjust`, then
   `commitAdjust` runs the write).

   `items: ConfirmReviewItem[]` — **counts per branch, before anything is written**:

   | label | value |
   |---|---|
   | `t('from_branch')` | source branch name |
   | `t('to_branch')` | destination branch name |
   | `t('products')` | `preview.products` |
   | `t('lots')` | `preview.lots` |
   | `t('total_units')` | `preview.units` |
   | `t('transfer_untracked_units')` | `preview.untrackedUnits` (row hidden when 0) |

   `danger` = **true** — this empties a branch.
   `note` = `t('transfer_entire_branch_note')` → *"Every lot moves with its own identity. Lots are
   never combined."*
   `working={savingBulk}`, `confirmLabel = t('transfer_entire_branch_confirm')`, and pass `t`.

3. Confirm → `transferStockBulk({ fromBranchId, toBranchId, note, scope: 'entire_branch', userId, userName })`
   with **no `items`**. `frontend/src/api/branchTransport.ts:105-112` already spreads the payload
   through to `POST /api/branches/transfer-bulk`, so no transport change is needed beyond widening
   `BranchPayload`.
4. Raise the bulk timeout for this call: `TRANSFER_STOCK_BULK_MUTATION_TIMEOUT_MS = 20000`
   (`TransferModal.tsx:28`) is too short for a chunked whole-branch move. Add
   `TRANSFER_ENTIRE_BRANCH_TIMEOUT_MS = 120000` and use it only for this path.
5. **Partial result handling.** On `{ partial: true }` (§1.6): keep the modal open, surface
   `transferredProducts` / `remainingProducts`, and offer "Transfer the remaining N" which re-issues
   the same call. Do **not** call `onDone()` — note that `handleBulkTransfer:774` currently calls
   `onDone()` on success, and `Branches.tsx:1762-1767` closes the modal in `onDone`.
6. **Also replace the `window.confirm` on the ordinary item path** (`:746-750`) with the same
   `ConfirmDialog`, review rows: from, to, products (`items.length`), total units (`totalQuantity`,
   already computed at `:745`). This is one shared dialog component with two payloads, not two dialogs.

### 2.4 Small-screen layout

**Current progressive-disclosure behaviour, with evidence.**

Before a source branch is picked, the panel renders **only**:

- header (`:790-810`): title, a mobile-only `sm:hidden` Transfer button (`:793-800`), the `X` (`:801-808`);
- the two branch `AppSelect`s in a `grid grid-cols-2 gap-3` (`:813-845`);
- the desktop footer (`:1181-1195`), which is `hidden … sm:flex` — **so on a phone there is nothing
  below the two selects at all**.

Everything else is gated on `fromBranch`:

- `:847` `{fromBranch && mode === 'single' && !selectedProduct ? (…)}` — dead (§2.1);
- `:1041` `{fromBranch && mode === 'multiple' ? (…)}` — the search row, the Select-all row, the
  results box and the note field.

And even after a branch *is* chosen the list stays empty until you act again:

- `:454-455` — `const catalogRequested = Boolean(debouncedSearch.trim()) || showAllProducts; if (!catalogRequested) return undefined` — the branch-stock fetch does not even fire;
- `:544` — `if (!query && !showAllProducts) inStock = inStock.filter((p) => String(p.id) in selectedQuantities)` — with nothing typed and nothing selected the filtered list is empty;
- `:1096-1102` — so the box shows `t('transfer_search_or_select_all')`, *"Search products, or use
  Select all to show the full catalog"*.

That is exactly the reported "minimized, only showing select branch; after select branch does it
expand the float page" — and there are **two** disclosure steps, not one.

**Specification — render the real thing from the start.**

- **Delete both `fromBranch &&` render gates.** The search row, the action row, the results box and
  the note field render on open, at their final size.
- **Before a source branch is chosen**, the results box shows a single quiet line
  `t('transfer_pick_source_first')` → *"Pick a source branch to list its stock."* — one line inside
  the already-full-height box, so nothing moves when it fills. Give the box a stable `min-h` equal to
  its populated height so there is no reflow.
- **Delete the `catalogRequested` gate** (`:454-455`) and the `!query && !showAllProducts` filter
  (`:544`). Picking a source branch loads and shows its stock. That removes the second disclosure step
  and makes "Show all products" unnecessary as a *reveal* — keep it only as an explicit
  "include zero-stock rows" toggle, or drop it (**Open decision E**, §7).
- **Sticky search row.** The search input + scan button (`:1046-1062`) currently scroll away inside
  `<div className="flex-1 space-y-4 overflow-auto p-5">` (`:812`). Wrap it in the established sticky
  pattern (memory `sticky-search-date-rows`):
  `sticky top-0 z-30 -mx-1 bg-white/95 pb-2 backdrop-blur dark:bg-gray-800/95 sm:mx-0`
  (`bg-white`/`bg-gray-800` rather than the page's `gray-50`/`gray-900`, to match this panel's own
  ground at `:789`). Put the action row (Transfer entire branch / `{n} selected`) inside the same
  sticky wrapper so the primary bulk action never scrolls away.
  **This modal has no date-range row**, so that half of the convention does not apply here — say so
  rather than inventing one.
- **Grow vertically, never widen** (memory `ui-space-and-close-buttons`). Keep the panel at
  `sm:max-w-2xl` (`:789`). The results box is `max-h-64` (`:1093`) — raise it so the panel uses the
  height `modal-panel-safe` already grants, e.g. `max-h-[45vh] sm:max-h-[50vh]`, and let the flex
  column absorb the rest. Do **not** widen the panel.
- **One close affordance.** The header `X` at `:801-808` is the single close. **Delete the footer
  `Cancel` at `:1192-1194`** — a standalone Close/Cancel beside a real action is exactly the duplicate
  the standing rule forbids; the footer keeps only the primary Transfer button.
- **Branch selects on a phone.** `grid grid-cols-2 gap-3` (`:813`) puts two `AppSelect`s side by side
  at 375px, each ~165px wide, so a branch name like "Warehouse (Toul Kork)" truncates. Make it
  `grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3` — vertical growth, full-width text.
- **iOS PWA safe areas are already handled by the shared classes; keep them.**
  `frontend/src/styles/main.css:621-626` — `.modal-viewport-safe` pads all four sides with
  `env(safe-area-inset-*)`; `:627-631` — `.modal-panel-safe` caps `max-height` with `100dvh` (with a
  `100vh` fallback line first) minus the insets, and `max-width` likewise. Both are already on this
  modal (`:788`, `:789`). The remaining iOS gap is the **scroll container**: `:812` uses a bare
  `overflow-auto`, whereas the shared `.modal-scroll` utility (`main.css:591-597`) adds
  `-webkit-overflow-scrolling: touch`, `overscroll-behavior: contain`, `touch-action: pan-y` and
  `min-height: 0`. **Swap `flex-1 space-y-4 overflow-auto p-5` for `modal-scroll space-y-4 p-4`** —
  `overscroll-behavior: contain` is specifically what stops an inner scroll from dragging the whole
  page on iOS, and `min-height: 0` is what keeps a flex child from refusing to shrink (the classic
  "content is cut off / footer pushed off screen" iOS bug).
- **Nested scroll containers.** The results box (`:1093`, `max-h-64 overflow-auto`) is a scroller
  inside a scroller. On iOS that is the usual source of a stuck/blocked gesture. With the sticky
  search row and the panel-level `modal-scroll` in place, prefer **one** scroll region: let the results
  list grow and let `modal-scroll` do the scrolling, keeping the row height fixed. If a bounded list is
  kept for very long catalogs, it also needs `overscroll-behavior: contain`.
- **Row layout at 375px.** Each result row (`:1111-1141`) puts, in one flex line: checkbox, name+sku
  block, an "Available: N unit" span, and — when checked — a `w-20` number input. At 375px minus the
  modal's own `0.75rem` viewport padding and `px-4` row padding, that is roughly 315px for four
  children; the name block is the only flexible one and collapses to a couple of characters. Restack
  for phones: checkbox + name on the first line, availability + quantity input on a second
  (`flex-wrap` with the name block `basis-full sm:basis-auto`). The name already wraps rather than
  truncating (`:1122` `whitespace-normal break-words`) — keep that (memory `truncated-text-reveal`).
- **Duplicate primary action.** The mobile header button (`:793-800`) and the desktop footer button
  (`:1182-1191`) are the same action rendered twice, and the header one has a real inconsistency: its
  label reads `saving || savingBulk` while its `disabled` reads only `savingBulk …` (`:797`, `:799`).
  With `handleTransfer` deleted (§2.1) `saving` is dead, so fix it to `savingBulk` either way. Prefer
  a single footer visible at all breakpoints (`flex`, not `hidden … sm:flex`), pinned below the
  `modal-scroll` body — which needs no `position: sticky` because the panel is already
  `flex flex-col` + `modal-panel-safe`.
- **Test viewport 375 × 812 with the safe-area insets emulated**, per §5.

### 2.5 The transfer group id

Generate one `groupId` per entire-branch run and write it into the existing, currently-unused
`stock_transfers.client_request_id` column (`0001_init.sql:620`) as **`${groupId}:${productId}`** —
one distinct value per row, sharing a prefix. The column is genuinely unwritten today: none of the
three INSERT sites (`branches.ts:403`, `branches.ts:704`, `inventory.ts:1836`) mentions it, so every
existing transfer row holds `NULL`. The shared prefix makes the N rows one logical transfer that
history can group; the distinct suffix satisfies the partial UNIQUE index on that column and gives
per-product idempotency for free. Return the bare `groupId` as `transferGroupId` (§1.7).

> **DECIDED — d9, 2026-09-03 (ruling R8): this is the approach. No migration.** `client_request_id`
> is BOTH the transfer id and the idempotency key, and the guard below is **in scope now**, not
> deferred.

> ### ⚠ CORRECTION to R8 — the column is UNIQUE. Resolution APPROVED by d9, 2026-09-03.
>
> **`client_request_id` cannot hold the same value on N rows.**
> `cloudflare/migrations/0001_init.sql:769`:
> ```sql
> CREATE UNIQUE INDEX idx_stock_transfers_client_request_unique
>   ON stock_transfers (client_request_id)
>   WHERE ((client_request_id IS NOT NULL) AND (client_request_id <> ''));
> ```
> A partial **UNIQUE** index over every non-null, non-empty value. Writing one shared group id across
> the N rows of a run inserts the second row into a uniqueness violation and aborts the batch. R8 as
> literally worded is unimplementable; the first draft of this section missed the index too.
>
> **Specified resolution — keeps R8's intent and still needs no migration: make the value composite.**
> `client_request_id = \`${groupId}:${productId}\`` — one row, one value, unique by construction,
> with the group recoverable as everything before the **first** `:`.
>
> This is strictly better than the shared-value plan, because the existing unique index then *is* the
> idempotency guard, enforced by the database rather than by a `WHERE NOT EXISTS` subquery that races:
> a retry re-inserting `gid:pid` is rejected by the index. Use `INSERT OR IGNORE` (or catch the
> constraint) so a resumed chunk skips already-committed products without failing the batch.
>
> **Safety of the prefix convention, verified:** no writer sets `client_request_id` on
> `stock_transfers` today — all three INSERT sites (`branches.ts:403`, `branches.ts:704`,
> `inventory.ts:1836`) omit the column, so every existing row is `NULL`. The `:` split therefore
> cannot mis-parse legacy data. Generate `groupId` with `crypto.randomUUID()`, which contains no
> `:`, and split on the first `:` only.
>
> The alternative — `ALTER TABLE stock_transfers ADD COLUMN transfer_group_id TEXT` plus an index —
> was considered and **not** taken: it is a schema change, which R8 ruled out. **d9 approved the
> composite value on 2026-09-03. It is settled; do not reopen it.**

#### Normative rules for the transfer group id

These are requirements, not rationale. An implementation that violates any of them is wrong.

1. **Value.** Every `stock_transfers` row a run inserts sets `client_request_id` to the group id, a
   `:`, and the product id. Never a bare group id, never `NULL`, never an empty string — the unique
   index's partial predicate excludes `''`, so an empty value would silently opt out of the guard.
2. **Group id.** One per user-initiated run, `crypto.randomUUID()`, reused verbatim on every retry and
   every resumed chunk of that run. A uuid contains no `:`.
3. **Split rule.** The group is **everything before the FIRST `:`**; the remainder is the product id.
   Splitting on the first separator is mandatory precisely so that a productId — or any future suffix
   — can never corrupt the parse. Never split on the last `:`, and never `split(':')` with an
   implicit assumption of exactly two parts.
4. **Legacy rows.** Every pre-existing transfer row has `client_request_id = NULL` — verified: none of
   the three INSERT sites (`branches.ts:403`, `branches.ts:704`, `inventory.ts:1836`) writes the
   column. Any reader must treat `NULL` as "ungrouped, render one row per product" and must never
   assume the column is populated.
5. **The idempotency guard is the database index, not application code.** The partial UNIQUE index
   `idx_stock_transfers_client_request_unique` (`0001_init.sql:769`) makes a duplicate
   group-id/product-id pair impossible, including against a concurrent duplicate request. Do **not**
   add a `WHERE NOT EXISTS` subquery in its place: that races between its read and its write, and it
   would obscure where the real guarantee lives.
6. **Resumed chunks use `INSERT OR IGNORE`** for the `stock_transfers` insert, so an
   already-committed product is skipped instead of aborting the batch. Derive per-product outcomes
   from the entry read (rule 7), never from `changes()`.
7. **Entry read.** `SELECT id, product_id, quantity FROM stock_transfers WHERE client_request_id GLOB
   @gidGlob` with `@gidGlob` = the group id followed by `:*`.
8. **Required test — a same-key retry inserts 0 rows.** Called out by name by d9 and discharged by
   §5.2a **test 17**, which is written against exactly this requirement: re-running
   `scope: 'entire_branch'` with the same `client_request_id` commits nothing, returns the existing
   rows with `idempotent: true`, and leaves branch quantities byte-for-byte unchanged. A reviewer may
   treat rule 8 as discharged by test 17 — provided that test asserts the inserted-row count for the
   second call is literally **0**, not merely that quantities did not change.

**Idempotency — required behaviour, not an optional extra.** A retry carrying the same
`client_request_id` must be a **no-op that returns the existing rows**, never a second move of the
same stock. Concretely:

1. The client generates the group id once per user-initiated run (`crypto.randomUUID()`) and reuses
   it verbatim on every retry, including the chunk-resume retry in §1.6.
2. On entry, the route reads the run's existing rows —
   `SELECT id, product_id, quantity FROM stock_transfers WHERE client_request_id GLOB @gidGlob`
   with `@gidGlob = groupId || ':*'` (`GLOB` rather than `LIKE` so `_` and `%` in a uuid cannot act
   as wildcards; a uuid contains neither, but the habit is what keeps the next copy of this query
   safe). If rows exist and the run is complete, it returns the §1.7 response built from those rows
   with `idempotent: true` and commits **nothing**.
3. If rows exist for only *some* products — a run that died mid-chunk — the route skips those products
   during enumeration and commits only the remainder. This is what makes chunked commit safe to
   resume, and it is why the group id must be written in the **same statement group** as the stock
   move (§1.6), never in a separate pass: a `stock_transfers` row is the durable evidence that that
   product's stock already moved.
4. The insert needs no hand-written guard: with the composite value, the existing partial unique
   index `idx_stock_transfers_client_request_unique` (`0001_init.sql:769`) already makes a duplicate
   `gid:pid` impossible, including against a concurrent duplicate request — which a
   `WHERE NOT EXISTS` subquery would **not**, since it races between the read and the write. Write
   `INSERT OR IGNORE INTO stock_transfers (…)` so a resumed chunk skips an already-committed product
   instead of aborting the batch, and derive the run's real per-product outcome from step 2's read
   rather than from `changes()`.

**Index.** Already present and already unique — `0001_init.sql:769`, quoted in the correction box
above. The `GLOB `gid:*`` prefix read in step 2 is index-assisted for a literal prefix, so no new
index is required and R8's no-migration ruling holds unchanged.

**History read.** `cloudflare/src/routes/compat.ts:1047` (`GET /transfers`) groups rows by the
**group-id prefix** — everything before the first `:` of `client_request_id` — **when present**, and
falls back to the current one-row-per-product rendering when the column is `NULL`. That fallback is
not optional: every transfer row written before this lane has `NULL` there, because none of the three
INSERT sites (`branches.ts:403`, `branches.ts:704`, `inventory.ts:1836`) writes the column today.
Grouping must therefore be presence-conditional and must never assume the column is populated.

### 2.6 No manual lot choice — and the deferred code-removal follow-up

Two things the first draft collapsed together, now separated because they resolve differently.

**(a) The product ruling — settled, and it is the behaviour Lane B implements.**

> **DECIDED — USER, 2026-09-03 (ruling R3, §0.4): there is no manual lot choice in transfer.** The lot
> picker is **not** restored. Lot/batch and branch identity are still preserved end to end — moved
> lot-by-lot, never summed across lots or branches (§1.5) — but that is **enforced automatically and
> never asked about**. A batch is identified by its date, as today (R1). No lot UI, no lot column, no
> "choose a lot" step appears in any transfer surface, single or entire-branch.

This makes the transfer flow consistent with what the user described: child rows already carry full
branch details, so a transfer is just quantity moving from one branch to another on the matching child
row. The lot mechanics are an invariant the server upholds, not a decision the operator makes.

**(b) The physical code removal — deferred, explicitly OUT OF SCOPE for Lane B.**

**Follow-up item — owner: de-bloat lane (RC P2-7 / post-deploy board cleanup).** Self-contained brief,
so that lane needs to re-derive nothing:

- **File:** `frontend/src/components/branches/TransferModal.tsx` (1200 lines at `c2bb7e6c`).
- **Root cause:** `:206` `const [mode] = useState<TransferMode>('multiple')` — **no setter is
  destructured and `setMode` appears nowhere in the file**, so `mode` is a compile-time constant and
  every `mode === 'single'` / `mode !== 'multiple'` branch is unreachable.
- **Extent: ≈428 unreachable lines across eight regions** (~36% of the file) — the table in §2.1 lists
  each with its guard line. The two largest are `:630-708` `handleTransfer` (the entire single
  submit path; grep confirms it is referenced by **no JSX**, only its own definition at `:630` and a
  comment at `:712`) and `:909-1039` the selected-product panel, **which contains the complete
  per-lot picker at `:933-988` (`Automatic (FIFO)` plus one row per lot, `:944-981`)**.
- **Also dead with it:** the imports `transferStock` (`:14`) and `getProductBatches`,
  `getTrackedBatchProductIds`, `type ProductBatch` (`:17-18`), plus the state and effects listed in
  §2.1's table.
- **The lot picker is deleted, not restored** — settled by the USER in (a) above. That question is
  closed; the de-bloat lane does not need to reopen it.
- **CAUTION — sequencing.** Whoever eventually deletes this **must first confirm hf/search and
  hf/dates have landed**. Both were told not to edit inside the region; deleting it while either is
  in flight guarantees a conflict on a file that is already contended. Confirm Lane B has landed too,
  since Lane B edits the live JSX immediately after the dead block.
- **Expected behaviour delta: none.** This is a pure-deletion commit. Its test is that the existing
  frontend suite and `npm run build` stay green and the 375 × 812 pass from §5.3 still passes.

---

## 3. What must NOT change

- `scope: 'items'` behaviour, byte-for-byte. It is the path an iPhone used successfully at 05:45:57Z
  and it stays the default when `scope` is absent.
- The permission gate `getActionTier(user, 'branches', 'transfer')` and the deliberate
  review-tier **block** (`branches.ts:549-558`).
- Clamped-vs-strict lot decrements (`productBatches.ts:478` vs `:493`) and the reasoning at
  `branches.ts:747-758`.
- The FIFO ordering at `productBatches.ts:532`.
- The identity-merge redirect and its `merges` reporting (`branches.ts:645`, `:679`, `:687`,
  `TransferModal.tsx:764-773`) — memory `conflict-resolution-moves-all-links`.
- `ScanSearchButton`'s scan-then-choose behaviour at `TransferModal.tsx:863-867` and `:1057-1061`
  (`handleTransferProductScan:224-230` fills the search box and selects nothing) — memory
  `barcode-scan-select-then-confirm`.

---

### 3.1 Invariant — "check all child rows if name is same" (USER ruling R5)

> "make sure check all child rows if name is same.."

**Stated for implementers:** any lookup keyed on a product **name** must return *every* active child
row under that name and then discriminate by the detail signature (barcode + cost, R4). Never the
first row, never the visible row, never a positionally-indexed row. This is plausibly the same defect
class as session 16's positional `rows[0]` substitution.

**On Lane B's own path the invariant holds today — verified, and Lane B must not weaken it.**
`findIdentityMatches` (`productIdentity.ts:87-124`, called by the bulk route at `branches.ts:645`)
selects every `name_key IN (…) AND is_active = 1` row, buckets them by `name_key`, and sweeps the
whole bucket comparing `productDetailSignature`; a source with no signature match is simply absent
from the map and its transfer stays on its own `product_id`. Its comment at `:96-99` records that a
name_key's rows never split across a `selectInChunks` chunk — **that property must survive any
re-chunking this lane does.** The single-transfer counterpart `findIdentityMatch`
(`:63-82`) sweeps identically, `ORDER BY id ASC` for a deterministic tie-break.

**But the underlying name key is broken, and that is a real defect — DEFERRED to migration 0111.**
Three normalizations of "the same name" are in play and they disagree on internal whitespace:
`normalizeProductGroupName` (`productDetailRule.ts:53-55`) collapses `\s+`; the stored
`products.name_key` column does **not** (triggers `migrations/0010_product_name_grouping.sql:76`,
`:88`, backfill `:45`, all `lower(trim(name))`); and the search-side sibling expansion compares a
collapsed JS key against an uncollapsed SQL expression (`products.ts:490-492` vs `:518`). Because
`nameKeyOf` is `normalizeProductGroupName` (`productIdentity.ts:18-20`) and is compared against the
stored column at `:73`, **a product whose name contains a doubled internal space is never swept** —
its child rows are invisible to identity matching, and an entire-branch transfer of it will therefore
skip the merge redirect. Full write-up is in `SPEC-lane-a-fast-stock-in.md` §4.5 / finding F5.

**Disposition (d9, 2026-09-03): the real fix is DEFERRED out of the hotfix** — it needs a migration
rewriting the stored `name_key` plus the two `0010` triggers, which is too much schema change for a
batch going onto a live production deploy. **Registry slot `0111` is reserved for "name_key
whitespace normalisation"**, as a post-deploy lane.

**Interim mitigation shipping in this batch — hf/merge owns it, Lane B depends on it.** hf/merge's
child-row sweep **compares BOTH forms in JS** — `lower(trim(name))` and the collapsed
`trim + \s+→' ' + lower` — and unions the candidates, so the sweep is robust to the mismatch without
a schema change. Entire-branch mode inherits that robustness for free, because it goes through
`findIdentityMatches` and adds no name handling of its own.

> **⚠ Known limitation until 0111 lands.** USER ruling R5 is **only partially true in the system**.
> The JS mitigation covers the merge sweep. The stored `name_key` column and the SQL sibling
> expansion at `products.ts:518` remain mismatched, and **anything else keying on `name_key` is
> still blind to whitespace-differing names** (`productIdentity.ts:73`, `products.ts:1854`,
> `renameCascade.ts:288`/`:291`/`:339`). Do not report R5 as satisfied until 0111 has landed.
> Two comments that currently assert the opposite — `migrations/0010_product_name_grouping.sql:35-36`
> and `products.ts:484-487` — must be corrected by the 0111 lane, not left standing.

**Lane B does not fix it and must not work around it locally** — a lane-local name comparison would
become a fifth disagreeing rule.

---

## 4. i18n — both packs

New keys (add to `frontend/src/lang/en.json` **and** `frontend/src/lang/km.json`; verify the Khmer
from an authoritative source, do not guess — memory `khmer-translations-verify-from-internet`):

`transfer_entire_branch`, `transfer_entire_branch_confirm`, `transfer_entire_branch_note`,
`transfer_entire_branch_title`, `transfer_show_all_products`, `transfer_pick_source_first`,
`transfer_untracked_units`, `transfer_entire_branch_partial` (`"{done} of {total} products moved. {left} remain."`),
`transfer_entire_branch_retry`, `transfer_entire_branch_too_large`, `lots`, `total_units`.

Already present, reuse as-is (`en.json:4792-4839`): `transfer`, `transfer_bulk_button`,
`transfer_bulk_failed`, `transfer_bulk_success` (`{n}`), `transfer_bulk_merged_note` (`{n}`),
`transfer_same_branch_error`, `transfer_selected_count` (`{n}`), `transfer_only_available` (`{n}`),
`transfer_no_stock_products`, `from_branch`, `to_branch`.

Keys that become dead when §2.1's dead code is deleted — **remove from both packs**:
`transfer_mode_single` (`en.json:4814`), `transfer_mode_multiple` (`:4815`), and — only if Open
decision D removes the lot picker for good — `transfer_pick_batch`, `transfer_pick_batch_optional`,
`transfer_pick_batch_first`, `transfer_no_batches`, `transfer_auto_fifo`, `transfer_auto_fifo_hint`,
`transfer_optional_lot_hint`, `transfer_selected_lot`, `transfer_fifo_lot_notice`,
`transfer_change_product`, `transfer_search_or_select_all`.

`npm run verify:i18n` must pass.

---

## 5. Tests

### 5.1 Pure Worker test — `cloudflare/scripts/test-entire-branch-transfer-pure.cjs`

Follow the house convention, but **fix the one weakness of the existing transfer test**: the closest
sibling, `cloudflare/scripts/test-branch-transfer-lots-pure.cjs` (253 lines), hand-writes a 3-table
inline schema at `:87-114` and hand-copies migration 0058's `CHECK (quantity >= 0)` (`:97`, `:102`)
rather than running the migrations. This spec requires the **real chain**.

**Migration-chain loader** — the canonical form is
`cloudflare/scripts/test-lot-ledger-reconcile-pure.cjs:24-38`; the full-chain (no `stopAt`) variant is
`cloudflare/scripts/test-migration-chain-fresh-pure.cjs:17` and
`cloudflare/scripts/test-restore-maintenance-pure.cjs:35`:
```js
const migrationsDir = path.join(__dirname, '..', 'migrations')
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}
```

**Loading the Worker logic** — transpile-and-eval with a `require` shim, copied from
`test-branch-transfer-lots-pure.cjs:34-55`:
```js
function transpile(relPath) { … ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText }
function loadModule(relPath, requireShim) { const module = { exports: {} }; new Function('exports','require','module', transpile(relPath))(module.exports, requireShim, module); return module.exports }
```
The Hono handler itself cannot be executed (it needs `Env`, `c.get('user')`, D1 bindings). The house
answer is the same two-pronged approach that test uses: recompose the statement groups with the **real**
`lib/productBatches.ts` helpers and execute them, **plus** a source lock.

**better-sqlite3 wrapper** — a local `wrapDb(sqlite)` (`test-branch-transfer-lots-pure.cjs:59-85`)
exposing async `get/all/run` for both positional and `@named` params, and `batch()` as one
`sqlite.transaction(...)` that returns a rejected promise on throw. That last part is what makes the
rollback assertions real.

**Assertions:**

1. **Lot identity.** Branch A holds product P across 3 lots (5 / 7 / 2). After an entire-branch
   transfer to B: B's `branch_batch_stock` has exactly 3 rows for the **same** `batch_id`s with 5 / 7 / 2;
   A's are 0. Never one row of 14.
2. **Branch identity.** No `branch_batch_stock` row exists for any branch other than A and B.
3. **Counts.** `transferredProducts` / `transferredLots` / `transferredUnits` equal the enumeration.
4. **Untracked stock.** A product with `branch_stock.quantity = 4` and no `branch_batch_stock` rows
   moves: B gains 4 on `branch_stock`, `untrackedUnits === 4`, and `inventory_movements` records the
   pair with `batch_id IS NULL`.
5. **Partial coverage.** `branch_stock = 10` but lots only cover 6 → 6 move per lot, 4 as `uncovered`,
   total at B is 10.
6. **One movement per lot.** `inventory_movements` has one `transfer_out` and one `transfer_in` per lot,
   each carrying the correct `batch_id` (this is red against today's behaviour, §1.5).
7. **All-or-nothing per chunk.** With `TRANSFER_BATCH_CHUNK_STATEMENTS` forced low (e.g. 12) so the run
   spans ≥3 chunks, inject a failure in chunk 2 (e.g. drive a lot's source quantity negative so the
   `CHECK (quantity >= 0)` from `0058_stock_nonnegative_check.sql:38` fires) and assert:
   chunk 1's products are **fully** committed (all their lots, both movements, the `stock_transfers`
   row); chunk 2's products are **fully** absent — no product half-moved; chunk 3 never ran; the
   response reports `partial: true` with the right counts.
8. **Group is never split.** With the chunk size set below one product's own statement count, that
   product's group still commits as one `db.batch()` — mirroring
   `runD1BatchGroupsInChunks`'s documented rule (`importEngine.ts:4806-4809`: it "recurses at GROUP
   boundaries, never through the middle of one").
9. **Identity merge.** Source product P has an identity twin Q at the destination
   (`findIdentityMatches`) → destination `branch_stock` lands on Q, `products.stock_quantity` moves for
   both, `merges` reports it, and the destination lot is the resolved/cloned one from
   `resolveDestinationBatch`.
10. **`scope: 'items'` regression.** The existing per-item path produces byte-identical statements to
    today for a two-item request.
11. **Same-branch and empty-branch** → 400 / a zero-count success, whichever the route chooses.

**Source lock** (`test-branch-transfer-lots-pure.cjs:155-161` `routeBody(src, marker)` slices one
handler out of `branches.ts` so a regex cannot match a sibling route). Pin, inside
`routeBody(src, "app.post('/transfer-bulk',")`: `scope === 'entire_branch'`,
`readFifoLotAvailabilityForCart`, `decrementBatchStockStrictStatement`,
`incrementBatchStockStatement`, and `runD1BatchGroupsInChunks`.

> ⚠️ **The existing source locks will break.** `test-branch-transfer-lots-pure.cjs:229-231` and `:238`
> assert the literal strings `readFifoLotAvailability(db, item.productId, fromBranchId)` and
> `allocateAcrossLots(sourceLots, item.quantity)` inside the `/transfer-bulk` body. Replacing the
> per-item read with the batched one (§1.2) **will fail those assertions even though behaviour is
> unchanged.** Update them in the same commit; do not delete them.

**Reporting** — the house styles are `check(name, fn)` + `passed` counter with the first failure
throwing (`test-branch-transfer-lots-pure.cjs:147-149`, `test-lot-ledger-reconcile-pure.cjs:41`), or
per-check catch accumulating `failed` (`test-transfer-history-paging-pure.cjs:11-15`). Use the second
so every assertion runs. Exit non-zero on any failure
(`test-branch-transfer-lots-pure.cjs:247-252`). Add a `// Run: node scripts/…` header — these files
are registered in **no** `package.json` script and **no** GitHub workflow
(`cloudflare/package.json` has only `test:import-engine`, `test:import-image-match`,
`test:zip-reader`), so the header is the only invocation record.

### 5.2 Frontend tests — `frontend/tests/`

12. "Transfer entire branch" issues **no** `items` and sets `scope: 'entire_branch'`.
13. It opens `ConfirmDialog`, not `window.confirm`, and no request fires until Confirm — a
    source-shape assertion that `window.confirm` appears **zero** times in `TransferModal.tsx`.
14. The search row, action row and results box render before any branch is picked (no `fromBranch &&`
    render gate remains in the file).
15. A partial response keeps the modal open and does not call `onDone`.

### 5.2a Tests the sequencing adds (d9 rulings R7, R8)

16. **Commit 1's equivalence test** — `test-transfer-statements-shared-pure.cjs`, per §1.3a: for each
    of the four leg shapes, the statement array emitted through the extracted helper is
    `deepStrictEqual` to what the route emitted before extraction. This is the whole justification for
    doing the extraction first; without it, "no behaviour change" is an assertion rather than a fact.
17. **Idempotency — "a same-key retry inserts 0 rows"** (discharges normative rule 8 in §2.5; d9
    called this test out by name). Re-running `scope: 'entire_branch'` with the same
    `client_request_id` commits **nothing**: assert the second call inserts literally **0**
    `stock_transfers` rows — count the table before and after, do not infer it — returns the existing
    rows with `idempotent: true`, and leaves every `branch_stock` / `branch_batch_stock` quantity
    byte-for-byte unchanged. Also assert the composite value parses: the group taken from before the
    **first** `:` equals the run's group id, and the remainder is the product id.
18. **Resume** — kill the run after chunk 1 (inject a throw in the chunk loop), re-issue with the same
    group id, and assert the products committed in chunk 1 are skipped, the rest are committed exactly
    once, and total units moved equals the enumeration total.
19. **Identity sweep (R5)** — a source branch holding two child rows under one name that differ only by
    cost transfers as **two** rows and is **never** auto-merged; a pair that shares name + barcode +
    cost **is** redirected by `findIdentityMatches`. Guards R4 against a future looser fallback.

### 5.3 Gates

`cd frontend && npm run test:utils && npm run verify:i18n && npm run build`
`cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done`
Then a live 375 × 812 pass in the browser with safe-area insets emulated, including the confirm
dialog and a real entire-branch move against dev data.

**Source-lock caveat, unchanged and still binding:** the batched-FIFO refactor in §1.2/§1.5 will break
the regex source locks at `cloudflare/scripts/test-branch-transfer-lots-pure.cjs:229-231` and `:238`,
which assert against the literal text of the route body. They must be **UPDATED in the same commit**
that changes the route — never deleted, never commented out. A deleted source lock is how the
invariant they protect (lot-by-lot movement, strict decrement on auto-allocated legs) silently
regresses later.

---

## 6. Findings beyond the ask (do NOT silently fold in)

**F1 — `inventory_movements.batch_id` is `null` for every FIFO-allocated bulk transfer.**
`branches.ts:711` and `:720` bind `batchId: sourceBatchForItem?.id ?? null` / `destBatchIdForItem`,
and both are `null` whenever the item had no explicit `batchId` — which is *every* row of the
multi-select flow (the route's own comment at `:748-750` says so). The `branch_batch_stock` legs do
move per lot (`:767-770`), so the ledger balances, but the **movement history loses lot attribution**
for bulk transfers. Migration `0084_movements_batch_id.sql:11` added that column precisely to carry it.
§1.5 fixes this for `entire_branch`; the item path needs the same fix, separately.

**F2 — `getBranchStock` resolves failures as an empty list.**
`frontend/src/api/branchTransport.ts:73-80` passes `() => []` as the local fallback, so a 403/500/
timeout is indistinguishable from "this branch has no stock". This is the exact hole
`frontend/src/api/batchesTransport.ts:113-120` documents at length for the batch transports and
deliberately refuses. Moving enumeration server-side removes the risk for entire-branch mode but not
for the ordinary picker.

**F3 — neither transfer route sets `client_request_id`, so transfers have no idempotency key.**
The column exists (`0001_init.sql:620`) and is never written. A retried request after a timeout
double-moves stock. §2.5 makes a start on this for entire-branch mode.

**F4 — the Telegram block does 3 DB queries per item.** `branches.ts:791-811`, inside
`Promise.all` in `waitUntil`. At the 200-item cap that is 600 post-response queries.

**F5 — the audit write is one awaited row per item.** `branches.ts:775-783` — `await Promise.all(...)`
before the response, not `waitUntil`.

**F6 — roughly 400 lines of `TransferModal.tsx` are unreachable** (§2.1), including the entire lot
picker and the single-transfer submit path. This is the "no zombie code" Golden Rule and is a change
to the file's shape that a reviewer must be told about, not discover in the diff.

---

## 7. Decisions — all resolved 2026-09-03

The questions are kept verbatim so a later reader can see each was **settled, not overlooked**. Each
now carries its answer and who gave it.

**A. `planTier`.** It does not exist at this HEAD (P1). Ship `TRANSFER_BATCH_CHUNK_STATEMENTS = 300`
as a local constant now and swap it for `planTier`'s `d1BatchChunkStatements` when that module merges,
or block Lane B until it does? (Recommendation: local constant with the swap comment — blocking on an
unmerged branch stalls a user-visible fix.)

> **DECIDED — d9 (ruling R6): local `TRANSFER_BATCH_CHUNK_STATEMENTS = 300`, matching
> `importEngine.ts:4746`, carrying the one-line-swap comment for the RC merge.** As specified.

**B. "ONE transfer record with items."** `stock_transfers` is flat, one row per product, and there is
no `transfer_items` table (P3). Two options: (i) **no migration** — write one shared
`client_request_id` group id across the N rows (§2.5); (ii) **migration** — add a real
`transfer_items` table plus a parent `transfers` row, and rewrite the history read
(`cloudflare/src/routes/compat.ts:1047`) and the Transfers UI. (Recommendation: (i) now, (ii) as its
own lane — (ii) touches the history surface, which is outside this ask.)

> **DECIDED — d9 (ruling R8): option (i), no migration.** `client_request_id` serves as both the
> transfer id and the idempotency key; a retry with the same key is a **no-op returning the existing
> rows**; `compat.ts:1047` groups by it when present. The idempotency guard is **in scope now** —
> §2.5 was rewritten accordingly. Option (ii) is not pursued.

**C. Where `runD1BatchGroupsInChunks` lives.** It is currently in `lib/importEngine.ts:4810`. Lift it
into a new `lib/d1Batch.ts` shared by both callers, or have `branches.ts` import from `importEngine`?
(Recommendation: lift — a transfer route importing the import engine is a bad dependency.)

> **DECIDED — d9: lift it.** Consistent with ruling R7's extraction-first sequencing — do the lift in
> the same commit 1 as the transfer-statement helper, so commit 2 (`entire_branch`) introduces no new
> shared plumbing of its own.

**D. The lot picker.** `TransferModal.tsx:933-988` is a complete, working per-lot picker that is
currently unreachable (§2.1). Delete it as dead code, or **restore** it for the single-row case (pick
one row → choose its lot) as part of "make them user-friendly"? The user said the one-by-one and the
many were merged, which reads as "the merge was intended" — but merging away the lot choice may not
have been. **This is the one place where deleting is not obviously right.**

> **DECIDED — two separate answers, 2026-09-03. Do not collapse them.**
>
> - **The product question — USER (ruling R3): no manual lot choice in transfer at all.** The picker
>   is not restored. Lot/batch + branch identity stays preserved end to end, enforced automatically
>   and never asked about; a batch is identified by its date, as today (R1).
> - **The code question — d9 (ruling R9): the deletion is DEFERRED and is NOT part of Lane B.**
>   Removing ≈428 unreachable lines adds diff surface to a batch going onto a live production deploy,
>   for zero behaviour change. The region stays; owner is the de-bloat lane (RC P2-7 / post-deploy
>   cleanup), with the hand-off brief in §2.6 and the caution that hf/search and hf/dates must have
>   landed first.
>
> Lane B's diff must therefore be written to work **alongside** the dead region (§2.1).

**E. "Show all products".** With the `catalogRequested` gate removed (§2.4) the source branch's stock
loads immediately, so `showAllProducts` no longer has a reveal job. Keep it as an explicit
"include zero-stock rows" toggle, or drop it entirely?

> **DECIDED — implementer's call, within the standing conventions** (d9's ruling text did not cover this
> one, and it does not need a ruling: it is invisible to the server contract — flag it back if a
> specific answer was intended). Recommendation stands — keep it
> as an explicit "include zero-stock rows" toggle inside the shared `FilterMenu` (memory
> `filter-menu-selected-state`: chosen filters show only inside the FilterMenu, never as chips in the
> toolbar row), since "transfer entire branch" is defined on lots with qty > 0 and a zero-stock row is
> then purely informational.

**F. Confirm-dialog scope.** §2.3 replaces **both** `window.confirm` sites (`:655` on the dead single
path, `:746` on the live bulk path). If Open decision D deletes the single path, only one remains.
Confirm that replacing the ordinary bulk confirm is in scope for this lane and not a separate change.

> **DECIDED — d9: both sites are replaced, and the single path is NOT deleted (R9).** So the `:655`
> site remains physically present inside the dead region. Replace it there anyway, so that
> `window.confirm` appears **zero** times in the file and the source-shape assertion in test 13
> (§5.2) is a clean invariant rather than one with an exception carved into it. It is a
> like-for-like swap on unreachable code: no behaviour change, three lines of diff.

---

## 8. Could not verify

- **`cloudflare/src/lib/planTier.ts` contents.** Everything quoted about `d1BatchChunkStatements`
  comes from `git show rc/p2-8-plans:cloudflare/src/lib/planTier.ts:151` and describes code **not
  present at this HEAD**.
- **No test was executed** (read-only mandate). Pass/fail behaviour of the existing pure tests is
  described from source, not observed. In particular the claim that the source locks at
  `test-branch-transfer-lots-pure.cjs:229-231`/`:238` will break under the batched-read refactor is
  read off the regex literals, not confirmed by running it.
- **Live iOS PWA behaviour at 375px** — no browser run from this worktree. The safe-area/scroll
  analysis is read off `frontend/src/styles/main.css:591-597` and `:621-631` plus the class usage at
  `TransferModal.tsx:788`, `:789`, `:812`, `:1093`. **A live 375 × 812 pass is mandatory before this
  lane is called done.**
- **The 05:45:57Z iPhone bulk transfer** referenced in the brief was not located in any log from this
  worktree; the route analysis stands on the code alone.
- **`cloudflare/migrations/` has 100+ files.** The authoritative shape of `branch_batch_stock`,
  `branch_stock`, `product_batches` and `stock_transfers` was established by grepping every
  `CREATE TABLE`/`ALTER TABLE` for them and reading `0001_init.sql`, `0016`, `0058`, `0084`. A later
  migration altering one of them under a statement form the grep missed is unlikely but not excluded.
- **The body of `compat.ts:1047` `GET /transfers` beyond its filter parameters.** It was read far
  enough to confirm the route exists, takes `startDate`/`endDate`/`fromBranchId`/`toBranchId`, and
  does **not** reference `client_request_id` today (grep). The prefix-grouping change specified in
  §2.5 is therefore written against a route whose rendering shape was not fully read; re-read it
  before editing.
- **`getActionTier` semantics for `'branches','transfer'`** were read at the call sites
  (`branches.ts:329-338`, `:549-558`), not in `lib/permissions.ts`.

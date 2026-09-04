-- 0115_sale_amendments.sql (S4-30)
--
-- An append-only ledger of every change made to a sale AFTER it was
-- recorded, so the shop can correct a sale without losing what it used to
-- say.
--
-- THE ONE ARCHITECTURAL RULE, stated here because everything downstream
-- depends on it:
--
--   The canonical tables (`sales`, `sale_items`) keep holding the NET
--   state. This table records only HOW they got there.
--
-- That split is what makes the owner's two-views requirement work without
-- a second rendering path:
--
--   * the RECEIPT is customer-facing and already renders net state --
--     routes/sales.ts's list query overwrites the response's `items` with
--     live `sale_items` rows and the money columns come off the `sales`
--     row, and Sales.tsx hands that object straight to <Receipt>. So a
--     receipt printed after an amendment shows delivery $2.00 and quantity
--     2 as one finalized sale, with a removed line simply absent, and NOT
--     ONE LINE of the receipt renderer had to change.
--   * the SALE DETAIL is internal and reads THIS table on top of the same
--     net state, so staff see "$1.50, then +$0.50 by Sokha at 14:22".
--
-- The alternative -- storing deltas as the source of truth and summing
-- them to get current state -- would have forced every existing consumer
-- (stock, revenue, reports, returns, the receipt) through a new
-- reconstruction layer. Nothing else in this schema works that way.
--
-- APPEND-ONLY IS ENFORCED BY THE DATABASE, not by convention. The two
-- triggers below abort any UPDATE or DELETE. An audit trail that a later
-- bug (or a later session's "quick fix") can quietly rewrite is not an
-- audit trail, and "we always INSERT" is exactly the kind of rule that
-- holds until the first person who does not know it opens the file. A
-- correction is therefore a NEW compensating row (see `reverses_amendment_id`
-- and `via`), which is also how the shop itself thinks about it.
--
-- WHY NOT REUSE `action_history` / `undo_snapshots` (0097): those record an
-- ACTION so it can be REVERSED -- keyed by applier, opaque payload, and
-- their rows do get their status rewritten as an action is undone and
-- redone. This table records a FACT about a sale so it can be READ BACK on
-- that sale's own screen, and it must never be rewritten. Different
-- lifetimes, different readers, different mutability. They are wired
-- together (`undo_action_id`) rather than merged.

CREATE TABLE IF NOT EXISTS sale_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,

  -- Pairs the two halves of one act that needs two primitive entries. A
  -- "replace product X with Y" is stored as a `line_removed` plus a
  -- `line_added` sharing this id, so the stock math stays the two
  -- primitives it already is while the detail view can still render the
  -- pair as the single act the cashier performed.
  group_id TEXT,

  -- The closed set of things that may be amended. A CHECK, not a comment:
  -- every one of these is a rule about money or stock, and a typo that
  -- invented a sixth kind would be a ledger row no reader knows how to
  -- render. Adding a kind is deliberately a migration.
  kind TEXT NOT NULL CHECK (kind IN (
    'line_added',
    'line_quantity_increased',
    'line_quantity_decreased',
    'line_removed',
    'delivery_fee_changed'
  )),

  -- What the entry is about. sale_item_id is the line at the moment the
  -- entry was written; for `line_removed` that row no longer exists, which
  -- is exactly the point -- the ledger is the only remaining record of it,
  -- so product_id/product_name are snapshotted here and not looked up.
  sale_item_id INTEGER,
  product_id INTEGER,
  product_name TEXT,

  -- Quantity movement (line kinds). before/after are the LINE's quantity;
  -- delta is after - before. A removal is (2 -> 0, delta -2).
  quantity_before REAL,
  quantity_after REAL,
  quantity_delta REAL,

  -- Money movement (delivery_fee_changed). Same before/after/delta shape,
  -- so one renderer handles both families.
  amount_before_usd REAL,
  amount_after_usd REAL,
  amount_delta_usd REAL,

  -- The SALE's total either side of this entry. Stored, not derived: the
  -- detail view has to be able to show what the customer owed before and
  -- after without re-running the money math against columns that later
  -- entries have since changed again.
  total_before_usd REAL,
  total_after_usd REAL,

  -- How many units actually left (negative) or returned to (positive) the
  -- shelf for this entry. NOT the same as quantity_delta: an
  -- awaiting_payment sale holds no stock, and a stock-skipped sale (S4-2)
  -- moves none either. Recording both is what lets the detail view say
  -- "quantity +1, stock unchanged" truthfully.
  units_moved REAL NOT NULL DEFAULT 0,
  -- 1 when this entry deliberately moved no stock because the sale carries
  -- S4-2's sticky stock_skipped flag. Kept per-entry so the reason a row
  -- shows units_moved 0 is legible years later.
  stock_skipped INTEGER NOT NULL DEFAULT 0,

  -- 'amend' = a person amended the sale. 'undo'/'redo' = the entry was
  -- appended by lib/undoAppliers.ts replaying an earlier action. There is
  -- one ledger, and the Undo button writes INTO it rather than around it.
  via TEXT NOT NULL DEFAULT 'amend' CHECK (via IN ('amend', 'undo', 'redo')),
  -- The earlier entry this one compensates for, when it is a reversal.
  reverses_amendment_id INTEGER,
  -- The action_history row whose Undo button reverses this entry, when the
  -- amendment recorded one.
  undo_action_id INTEGER,

  note TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The detail view's own read: every entry for one sale, oldest first.
CREATE INDEX IF NOT EXISTS idx_sale_amendments_sale ON sale_amendments(sale_id, id);
-- "Has this sale ever been amended?" for the list badge, without reading rows.
CREATE INDEX IF NOT EXISTS idx_sale_amendments_sale_kind ON sale_amendments(sale_id, kind);

-- Append-only, enforced. RAISE(ABORT) rolls back the whole statement, so a
-- batch that tries to rewrite history fails as one unit rather than
-- half-applying.
CREATE TRIGGER IF NOT EXISTS sale_amendments_append_only_update
BEFORE UPDATE ON sale_amendments
BEGIN
  SELECT RAISE(ABORT, 'sale_amendments is append-only: correct an entry by appending a compensating entry, never by rewriting one');
END;

CREATE TRIGGER IF NOT EXISTS sale_amendments_append_only_delete
BEFORE DELETE ON sale_amendments
BEGIN
  SELECT RAISE(ABORT, 'sale_amendments is append-only: an entry is never deleted, not even when the sale line it describes is');
END;

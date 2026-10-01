CREATE TABLE stock_disposition_sources(
 id TEXT PRIMARY KEY, movement_id INTEGER NOT NULL UNIQUE REFERENCES inventory_movements(id),
 batch_id INTEGER NOT NULL UNIQUE REFERENCES product_batches(id), product_id INTEGER NOT NULL REFERENCES products(id),
 branch_id INTEGER NOT NULL REFERENCES branches(id), supplier_id INTEGER NOT NULL,
 quantity TEXT NOT NULL, free_quantity TEXT NOT NULL, gross4 INTEGER NOT NULL CHECK(gross4>=0),
 opening_paid4 INTEGER NOT NULL CHECK(opening_paid4=0), opening_debt4 INTEGER NOT NULL CHECK(opening_debt4=gross4),
 funding_state TEXT NOT NULL CHECK(funding_state='reconciled_unpaid')
);
CREATE TABLE stock_disposition_allocations(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES stock_disposition_sources(id),
 quantity TEXT NOT NULL, gross4 INTEGER NOT NULL CHECK(gross4>=0), coverage4 INTEGER NOT NULL CHECK(coverage4>=0 AND coverage4<=gross4),
 condition_tag TEXT NOT NULL CHECK(condition_tag IN ('broken','damaged','expired','opened','other'))
);
CREATE TABLE stock_disposition_events(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES stock_disposition_sources(id), allocation_id TEXT NOT NULL REFERENCES stock_disposition_allocations(id),
 generation INTEGER NOT NULL CHECK(generation>0), kind TEXT NOT NULL CHECK(kind IN ('hold','dispose')),
 quantity TEXT NOT NULL, gross4 INTEGER NOT NULL CHECK(gross4>=0), coverage4 INTEGER NOT NULL CHECK(coverage4>=0 AND coverage4<=gross4),
 net4 INTEGER NOT NULL CHECK(net4=gross4-coverage4), recognized4 INTEGER NOT NULL CHECK(recognized4=CASE WHEN kind='dispose' THEN net4 ELSE 0 END),
 remaining_quantity TEXT NOT NULL, remaining_gross4 INTEGER NOT NULL CHECK(remaining_gross4>=0),
 remaining_coverage4 INTEGER NOT NULL CHECK(remaining_coverage4>=0 AND remaining_coverage4<=remaining_gross4),
 reason TEXT NOT NULL, expense_category TEXT, actor_id INTEGER NOT NULL REFERENCES users(id), occurred_at TEXT NOT NULL,
 UNIQUE(source_id,generation)
);
CREATE TABLE stock_disposition_fees(
 event_id TEXT PRIMARY KEY REFERENCES stock_disposition_events(id), fee_id INTEGER NOT NULL UNIQUE REFERENCES fees(id) ON DELETE RESTRICT,
 amount4 INTEGER NOT NULL CHECK(amount4>0)
);
CREATE TABLE stock_disposition_receipts(
 id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL, request_json TEXT NOT NULL, response_json TEXT NOT NULL,
 event_id TEXT NOT NULL UNIQUE REFERENCES stock_disposition_events(id)
);
CREATE TABLE stock_disposition_guards(token TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TRIGGER stock_disposition_sources_no_update BEFORE UPDATE ON stock_disposition_sources BEGIN SELECT RAISE(ABORT,'disposition source immutable'); END;
CREATE TRIGGER stock_disposition_sources_no_delete BEFORE DELETE ON stock_disposition_sources BEGIN SELECT RAISE(ABORT,'disposition source immutable'); END;
CREATE TRIGGER stock_disposition_allocations_no_update BEFORE UPDATE ON stock_disposition_allocations BEGIN SELECT RAISE(ABORT,'disposition allocation immutable'); END;
CREATE TRIGGER stock_disposition_allocations_no_delete BEFORE DELETE ON stock_disposition_allocations BEGIN SELECT RAISE(ABORT,'disposition allocation immutable'); END;
CREATE TRIGGER stock_disposition_events_no_update BEFORE UPDATE ON stock_disposition_events BEGIN SELECT RAISE(ABORT,'disposition event immutable'); END;
CREATE TRIGGER stock_disposition_events_no_delete BEFORE DELETE ON stock_disposition_events BEGIN SELECT RAISE(ABORT,'disposition event immutable'); END;
CREATE TRIGGER stock_disposition_receipts_no_update BEFORE UPDATE ON stock_disposition_receipts BEGIN SELECT RAISE(ABORT,'disposition receipt immutable'); END;
CREATE TRIGGER stock_disposition_receipts_no_delete BEFORE DELETE ON stock_disposition_receipts BEGIN SELECT RAISE(ABORT,'disposition receipt immutable'); END;
CREATE TRIGGER stock_disposition_fees_no_update BEFORE UPDATE ON stock_disposition_fees BEGIN SELECT RAISE(ABORT,'disposition fee immutable'); END;
CREATE TRIGGER stock_disposition_fees_no_delete BEFORE DELETE ON stock_disposition_fees BEGIN SELECT RAISE(ABORT,'disposition fee immutable'); END;

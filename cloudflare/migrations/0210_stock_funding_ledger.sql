CREATE TABLE stock_funding_invoice_openings(
 invoice_id INTEGER PRIMARY KEY REFERENCES supplier_invoices(id), supplier_id INTEGER NOT NULL, branch_id INTEGER NOT NULL,
 gross4 INTEGER NOT NULL CHECK(gross4>=0), paid4 INTEGER NOT NULL CHECK(paid4>=0), debt4 INTEGER NOT NULL CHECK(debt4>=0 AND paid4+debt4=gross4),
 header_json TEXT NOT NULL CHECK(json_valid(header_json)), proof TEXT NOT NULL
);
CREATE TABLE stock_funding_sources(
 id TEXT PRIMARY KEY, movement_id INTEGER NOT NULL UNIQUE REFERENCES inventory_movements(id), batch_id INTEGER NOT NULL UNIQUE REFERENCES product_batches(id),
 product_id INTEGER NOT NULL REFERENCES products(id), branch_id INTEGER NOT NULL REFERENCES branches(id), supplier_id INTEGER NOT NULL,
 quantity TEXT NOT NULL, free_quantity TEXT NOT NULL, gross4 INTEGER NOT NULL CHECK(gross4>=0),
 opening_paid4 INTEGER NOT NULL CHECK(opening_paid4>=0), opening_debt4 INTEGER NOT NULL CHECK(opening_debt4>=0 AND opening_paid4+opening_debt4=gross4),
 reconciliation_proof TEXT NOT NULL, invoice_id INTEGER REFERENCES stock_funding_invoice_openings(invoice_id), actor_id INTEGER NOT NULL REFERENCES users(id),
 source_json TEXT NOT NULL CHECK(json_valid(source_json))
);
CREATE TABLE stock_funding_claims(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES stock_funding_sources(id), amount4 INTEGER NOT NULL CHECK(amount4>0), proof TEXT NOT NULL
);
CREATE TABLE stock_funding_events(
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES stock_funding_sources(id), generation INTEGER NOT NULL CHECK(generation>=0),
 kind TEXT NOT NULL CHECK(kind IN ('admit','pending','accept','cancel','payment','refund','shipping')),
 amount4 INTEGER NOT NULL CHECK(amount4>=0), claim_id TEXT REFERENCES stock_funding_claims(id), fee_id INTEGER UNIQUE REFERENCES fees(id),
 gross4 INTEGER NOT NULL CHECK(gross4>=0), paid4 INTEGER NOT NULL CHECK(paid4>=0), debt4 INTEGER NOT NULL CHECK(debt4>=0),
 credit4 INTEGER NOT NULL CHECK(credit4>=0 AND credit4<=gross4), asset4 INTEGER NOT NULL CHECK(asset4>=0),
 cash_in4 INTEGER NOT NULL CHECK(cash_in4>=0), cash_out4 INTEGER NOT NULL CHECK(cash_out4>=0), shipping4 INTEGER NOT NULL CHECK(shipping4>=0),
 proof TEXT NOT NULL, cash_method TEXT, cash_reference TEXT, cash_recorded_at TEXT,
 actor_id INTEGER NOT NULL REFERENCES users(id), occurred_at TEXT NOT NULL,
 CHECK(gross4=paid4+debt4+credit4-asset4-cash_in4),
 CHECK((kind='admit' AND generation=0 AND amount4=0) OR (kind!='admit' AND generation>0 AND amount4>0)),
 CHECK((kind IN ('pending','accept','cancel') AND claim_id IS NOT NULL) OR (kind NOT IN ('pending','accept','cancel') AND claim_id IS NULL)),
 CHECK((kind='shipping' AND fee_id IS NOT NULL) OR (kind!='shipping' AND fee_id IS NULL)),
 CHECK((kind IN ('refund','payment') AND cash_method='cash' AND cash_reference IS NOT NULL AND cash_recorded_at IS NOT NULL) OR (kind NOT IN ('refund','payment') AND cash_method IS NULL AND cash_reference IS NULL AND cash_recorded_at IS NULL)),
 UNIQUE(source_id,generation)
);
CREATE UNIQUE INDEX stock_funding_claim_closed ON stock_funding_events(claim_id) WHERE kind IN ('accept','cancel');
CREATE TABLE stock_funding_receipts(
 request_id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), request_digest TEXT NOT NULL, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
 response_json TEXT NOT NULL CHECK(json_valid(response_json) AND json_type(response_json)='object'), event_id TEXT NOT NULL UNIQUE REFERENCES stock_funding_events(id)
);
CREATE TABLE stock_funding_guards(token TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE VIEW stock_funding_dependencies AS SELECT id AS source_id,movement_id,batch_id,product_id,branch_id,supplier_id FROM stock_funding_sources;
CREATE VIEW stock_funding_latest AS SELECT e.* FROM stock_funding_events e WHERE NOT EXISTS(SELECT 1 FROM stock_funding_events n WHERE n.source_id=e.source_id AND n.generation>e.generation);
CREATE TRIGGER stock_funding_invoice_openings_no_update BEFORE UPDATE ON stock_funding_invoice_openings BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_invoice_openings_no_delete BEFORE DELETE ON stock_funding_invoice_openings BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_sources_no_update BEFORE UPDATE ON stock_funding_sources BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_sources_no_delete BEFORE DELETE ON stock_funding_sources BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_claims_no_update BEFORE UPDATE ON stock_funding_claims BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_claims_no_delete BEFORE DELETE ON stock_funding_claims BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_events_no_update BEFORE UPDATE ON stock_funding_events BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_events_no_delete BEFORE DELETE ON stock_funding_events BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_receipts_no_update BEFORE UPDATE ON stock_funding_receipts BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;
CREATE TRIGGER stock_funding_receipts_no_delete BEFORE DELETE ON stock_funding_receipts BEGIN SELECT RAISE(ABORT,'funding ledger immutable'); END;

-- Full-text indexes over customers/suppliers/delivery_contacts, replacing
-- the `lower(COALESCE(col, '')) LIKE '%term%'` OR-chain scans in
-- routes/contacts.ts's registerContactRoutes (and the /customers/
-- points-summary endpoint at the bottom of that file).
--
-- Why this was worth doing even though contact tables are typically much
-- smaller than the product catalog: it's the exact same query shape
-- migrations/0018_products_fts.sql's own comment already documented as
-- slow -- a leading '%' wildcard can never use an index, so every keystroke
-- (this route has no server debounce of its own; the frontend's 180ms
-- debounce is the only throttle) triggers a full table scan across every
-- searchable column, run TWICE per keystroke (once for COUNT(*), once for
-- the page itself, since registerContactRoutes builds both from the same
-- whereSql). At low traffic that's invisible; under concurrent multi-user
-- load -- several cashiers doing POS customer lookup plus someone
-- CSV-importing contacts at the same time, the exact "multi-user/peak
-- period" scenario this app is built for -- every one of those scans
-- competes for the same D1 read budget and CPU-per-request limit the
-- products-search investigation (progress.md's Part 100/106 notes) already
-- flagged as the more likely explanation for request failures under load
-- than any single query being slow in isolation. FTS5's inverted index
-- makes a MATCH query proportional to the number of matching tokens
-- instead of the size of the table, same benefit 0018 already got for
-- products, now extended to the other place in this app people search
-- on every keystroke.
--
-- Two tables per contact type, same split as products_fts/
-- products_fts_code and for the same reason: `unicode61` below gives
-- word-PREFIX matching (fast, right for free-text fields like name/email/
-- company), but a phone number is one dense unbroken token the same way a
-- barcode is -- prefix-only matching would never find "5678" typed against
-- a stored "012-345-5678" (that's not a prefix of anything). A second
-- `tokenize='trigram'` table over just the phone-shaped columns makes that
-- a true substring search, the same fix 0019 already applied to barcode/
-- sku. customers/delivery_contacts also fold their `address` column into
-- the trigram table (not just phone): address stores serialized Contact
-- Options JSON with up to 3 secondary phone/name/address entries (see
-- contactOptionUtils.ts) sitting right next to their JSON keys, and the
-- LIKE-based code this replaces already depended on plain substring
-- matching to find a customer by a SECONDARY phone number -- dropping to
-- word-prefix-only for that column would have been a real regression, not
-- just a missed improvement. suppliers has no such option-JSON column
-- reachable by phone-fragment search, so its trigram table is phone-only.
--
-- Column order in each *_fts table MUST match routes/contacts.ts's own
-- `searchable` arrays for that table (see buildContactMatchExpressions in
-- lib/contactSearch.ts, which relies on this for its bm25() weighting).
--
-- Same external-content-table pattern as 0018/0019 (index stores only
-- tokens + postings, points back at the base table's `id`; triggers below
-- keep it in sync on every write path -- manual create/edit/delete, CSV
-- import, undo/redo restore -- automatically, since they're id-keyed
-- triggers on the base table itself, not something each write path has to
-- know to call).

CREATE VIRTUAL TABLE customers_fts USING fts5(
  name, phone, email, company, membership_number, address,
  content='customers',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO customers_fts(rowid, name, phone, email, company, membership_number, address)
SELECT id, name, phone, email, company, membership_number, address FROM customers;
CREATE TRIGGER customers_fts_ai AFTER INSERT ON customers BEGIN
  INSERT INTO customers_fts(rowid, name, phone, email, company, membership_number, address)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.membership_number, new.address);
END;
CREATE TRIGGER customers_fts_ad AFTER DELETE ON customers BEGIN
  INSERT INTO customers_fts(customers_fts, rowid, name, phone, email, company, membership_number, address)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.membership_number, old.address);
END;
CREATE TRIGGER customers_fts_au AFTER UPDATE ON customers BEGIN
  INSERT INTO customers_fts(customers_fts, rowid, name, phone, email, company, membership_number, address)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.membership_number, old.address);
  INSERT INTO customers_fts(rowid, name, phone, email, company, membership_number, address)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.membership_number, new.address);
END;

CREATE VIRTUAL TABLE customers_fts_phone USING fts5(
  phone, address,
  content='customers',
  content_rowid='id',
  tokenize='trigram'
);
INSERT INTO customers_fts_phone(rowid, phone, address)
SELECT id, phone, address FROM customers;
CREATE TRIGGER customers_fts_phone_ai AFTER INSERT ON customers BEGIN
  INSERT INTO customers_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;
CREATE TRIGGER customers_fts_phone_ad AFTER DELETE ON customers BEGIN
  INSERT INTO customers_fts_phone(customers_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
END;
CREATE TRIGGER customers_fts_phone_au AFTER UPDATE ON customers BEGIN
  INSERT INTO customers_fts_phone(customers_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
  INSERT INTO customers_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

CREATE VIRTUAL TABLE suppliers_fts USING fts5(
  name, phone, email, company, contact_person,
  content='suppliers',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO suppliers_fts(rowid, name, phone, email, company, contact_person)
SELECT id, name, phone, email, company, contact_person FROM suppliers;
CREATE TRIGGER suppliers_fts_ai AFTER INSERT ON suppliers BEGIN
  INSERT INTO suppliers_fts(rowid, name, phone, email, company, contact_person)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.contact_person);
END;
CREATE TRIGGER suppliers_fts_ad AFTER DELETE ON suppliers BEGIN
  INSERT INTO suppliers_fts(suppliers_fts, rowid, name, phone, email, company, contact_person)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.contact_person);
END;
CREATE TRIGGER suppliers_fts_au AFTER UPDATE ON suppliers BEGIN
  INSERT INTO suppliers_fts(suppliers_fts, rowid, name, phone, email, company, contact_person)
  VALUES ('delete', old.id, old.name, old.phone, old.email, old.company, old.contact_person);
  INSERT INTO suppliers_fts(rowid, name, phone, email, company, contact_person)
  VALUES (new.id, new.name, new.phone, new.email, new.company, new.contact_person);
END;

CREATE VIRTUAL TABLE suppliers_fts_phone USING fts5(
  phone,
  content='suppliers',
  content_rowid='id',
  tokenize='trigram'
);
INSERT INTO suppliers_fts_phone(rowid, phone)
SELECT id, phone FROM suppliers;
CREATE TRIGGER suppliers_fts_phone_ai AFTER INSERT ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(rowid, phone) VALUES (new.id, new.phone);
END;
CREATE TRIGGER suppliers_fts_phone_ad AFTER DELETE ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(suppliers_fts_phone, rowid, phone) VALUES ('delete', old.id, old.phone);
END;
CREATE TRIGGER suppliers_fts_phone_au AFTER UPDATE ON suppliers BEGIN
  INSERT INTO suppliers_fts_phone(suppliers_fts_phone, rowid, phone) VALUES ('delete', old.id, old.phone);
  INSERT INTO suppliers_fts_phone(rowid, phone) VALUES (new.id, new.phone);
END;

CREATE VIRTUAL TABLE delivery_contacts_fts USING fts5(
  name, phone, area, address,
  content='delivery_contacts',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO delivery_contacts_fts(rowid, name, phone, area, address)
SELECT id, name, phone, area, address FROM delivery_contacts;
CREATE TRIGGER delivery_contacts_fts_ai AFTER INSERT ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(rowid, name, phone, area, address)
  VALUES (new.id, new.name, new.phone, new.area, new.address);
END;
CREATE TRIGGER delivery_contacts_fts_ad AFTER DELETE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(delivery_contacts_fts, rowid, name, phone, area, address)
  VALUES ('delete', old.id, old.name, old.phone, old.area, old.address);
END;
CREATE TRIGGER delivery_contacts_fts_au AFTER UPDATE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts(delivery_contacts_fts, rowid, name, phone, area, address)
  VALUES ('delete', old.id, old.name, old.phone, old.area, old.address);
  INSERT INTO delivery_contacts_fts(rowid, name, phone, area, address)
  VALUES (new.id, new.name, new.phone, new.area, new.address);
END;

CREATE VIRTUAL TABLE delivery_contacts_fts_phone USING fts5(
  phone, address,
  content='delivery_contacts',
  content_rowid='id',
  tokenize='trigram'
);
INSERT INTO delivery_contacts_fts_phone(rowid, phone, address)
SELECT id, phone, address FROM delivery_contacts;
CREATE TRIGGER delivery_contacts_fts_phone_ai AFTER INSERT ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;
CREATE TRIGGER delivery_contacts_fts_phone_ad AFTER DELETE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(delivery_contacts_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
END;
CREATE TRIGGER delivery_contacts_fts_phone_au AFTER UPDATE ON delivery_contacts BEGIN
  INSERT INTO delivery_contacts_fts_phone(delivery_contacts_fts_phone, rowid, phone, address)
  VALUES ('delete', old.id, old.phone, old.address);
  INSERT INTO delivery_contacts_fts_phone(rowid, phone, address)
  VALUES (new.id, new.phone, new.address);
END;

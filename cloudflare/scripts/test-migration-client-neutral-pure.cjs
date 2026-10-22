// Shared migrations run on EVERY client's database. This is the gate that keeps
// them client-neutral. Four parts:
//
//   1. the manifest: every file in cloudflare/migrations is listed with its
//      sha256 (append-only enforced), a class, and a one-line reason
//   2. the lint, run on every file numbered 270 or later (none yet)
//   3. positive controls: a fixture that breaks each rule must be refused, and a
//      fixture that is clean must pass, so a lint that refuses everything or
//      nothing cannot pass
//   4. calibration on the 215 existing files: the lint refuses the pinned-data
//      migrations that contaminate a new client, and it names, exactly, the
//      policy rewrites it cannot see (those rely on the class gate and review)
//
// Rules and the reason for each: docs/setup/migrations-multi-client.md.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { MIGRATIONS_DIR, migrationFiles, sha256, splitStatements } = require('./harness/migration_sql.cjs')
const { RULES, verifyManifest, lintMigration, loadDenylist } = require('./harness/migration_lint.cjs')

const MANIFEST_PATH = path.join(__dirname, '..', 'migrations-manifest.json')
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
const files = new Map(migrationFiles().map((f) => [f, fs.readFileSync(path.join(MIGRATIONS_DIR, f))]))
const lint = (sql, opts = {}) => lintMigration({ name: '0270_fixture.sql', sql, ...opts })
const rulesOf = (sql, opts) => [...new Set(lint(sql, opts).map((v) => v.rule))].sort()

// ---------------------------------------------------------------- 1. the real manifest

check('the manifest describes exactly the files in cloudflare/migrations, byte for byte', () => {
  assert.equal(manifest.version, 1)
  assert.equal(manifest.lintFrom, 270)
  assert.equal(manifest.baselineThrough, 269)
  const denylist = loadDenylist()
  const problems = verifyManifest(manifest, files, { denylist })
  assert.deepEqual(problems, [], `migration manifest problems:\n  ${problems.join('\n  ')}`)
  assert.equal(manifest.migrations.length, files.size)
})

const CLIENT_SPECIFIC = ['0072', '0099', '0103', '0109', '0110', '0111', '0112', '0117', '0153', '0163', '0164', '0165', '0166', '0168', '0173', '0174', '0176', '0178', '0179', '0183', '0251']

// 0030, 0064 and 0098 were CLIENT-SPECIFIC-DATA until 22 Oct 2026, when the owner approved editing them
// so the chain builds a new D1 and carries none of the first client's rows (test-fresh-d1-chain-native.cjs).
check('the legacy class split is pinned: 137 SCHEMA, 57 GENERIC-DATA, 21 CLIENT-SPECIFIC-DATA', () => {
  const count = (cls) => manifest.migrations.filter((m) => m.class === cls).length
  assert.equal(count('SCHEMA'), 137)
  assert.equal(count('GENERIC-DATA'), 57)
  assert.equal(count('CLIENT-SPECIFIC-DATA'), 21)
  const client = manifest.migrations.filter((m) => m.class === 'CLIENT-SPECIFIC-DATA').map((m) => m.name.slice(0, 4))
  assert.deepEqual(client, CLIENT_SPECIFIC, 'reclassifying a legacy migration is a decision: edit this list in the same commit and say why')
})

check('no file from 0270 on is CLIENT-SPECIFIC-DATA (none exist yet; the rule is exercised below)', () => {
  const late = manifest.migrations.filter((m) => Number(m.name.slice(0, 4)) >= manifest.lintFrom)
  assert.ok(late.every((m) => m.class !== 'CLIENT-SPECIFIC-DATA'))
})

// ---------------------------------------------------------------- 3. the manifest checker bites

const sample = (extra = {}) => {
  const body = new Map([
    ['0001_a.sql', Buffer.from('CREATE TABLE a (id INTEGER PRIMARY KEY, n TEXT);\n')],
    ['0002_b.sql', Buffer.from('UPDATE a SET n = lower(n) WHERE n IS NOT NULL;\n')],
    ...Object.entries(extra),
  ])
  const entries = [...body.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([name, bytes]) => ({
    name,
    sha256: sha256(bytes),
    class: /UPDATE|INSERT|DELETE/.test(bytes.toString()) ? 'GENERIC-DATA' : 'SCHEMA',
    reason: 'a fixture entry',
  }))
  return { manifest: { version: 1, lintFrom: 270, baselineThrough: 269, migrations: entries }, body }
}

check('manifest controls: the fixture itself is clean', () => {
  const { manifest: m, body } = sample()
  assert.deepEqual(verifyManifest(m, body), [])
})

check('manifest controls: editing an applied migration is refused (append-only)', () => {
  const { manifest: m, body } = sample()
  body.set('0001_a.sql', Buffer.from('CREATE TABLE a (id INTEGER PRIMARY KEY, n TEXT, extra TEXT);\n'))
  assert.match(verifyManifest(m, body).join('\n'), /0001_a\.sql: bytes differ from the manifest sha256/)
})

check('manifest controls: a new file with no entry is refused and the message prints the entry to fill in', () => {
  const { manifest: m, body } = sample()
  body.set('0270_new.sql', Buffer.from('ALTER TABLE a ADD COLUMN c TEXT;\n'))
  const problems = verifyManifest(m, body).join('\n')
  assert.match(problems, /0270_new\.sql: not in migrations-manifest\.json/)
  assert.match(problems, new RegExp(sha256(body.get('0270_new.sql'))))
})

check('manifest controls: deleting a migration is refused', () => {
  const { manifest: m, body } = sample()
  body.delete('0001_a.sql')
  assert.match(verifyManifest(m, body).join('\n'), /0001_a\.sql: in the manifest but the file is gone/)
})

check('manifest controls: duplicate, unsorted, unclassified, reasonless and multi-line entries are refused', () => {
  const { manifest: m, body } = sample()
  assert.match(verifyManifest({ ...m, migrations: [m.migrations[0], m.migrations[0], m.migrations[1]] }, body).join('\n'), /listed twice/)
  assert.match(verifyManifest({ ...m, migrations: [m.migrations[1], m.migrations[0]] }, body).join('\n'), /not in file-name order/)
  assert.match(verifyManifest({ ...m, migrations: [{ ...m.migrations[0], class: 'MAYBE' }, m.migrations[1]] }, body).join('\n'), /class must be one of/)
  assert.match(verifyManifest({ ...m, migrations: [{ ...m.migrations[0], reason: '' }, m.migrations[1]] }, body).join('\n'), /reason must be one non-empty line/)
  assert.match(verifyManifest({ ...m, migrations: [{ ...m.migrations[0], reason: 'two\nlines' }, m.migrations[1]] }, body).join('\n'), /reason must be one non-empty line/)
})

check('manifest controls: the class must tell the truth about whether rows are written', () => {
  const { manifest: m, body } = sample()
  assert.match(verifyManifest({ ...m, migrations: [m.migrations[0], { ...m.migrations[1], class: 'SCHEMA' }] }, body).join('\n'), /0002_b\.sql: class SCHEMA but the file writes rows/)
  assert.match(verifyManifest({ ...m, migrations: [{ ...m.migrations[0], class: 'GENERIC-DATA' }, m.migrations[1]] }, body).join('\n'), /0001_a\.sql: class GENERIC-DATA but the file writes no rows/)
})

check('manifest controls: from 0270 on, CLIENT-SPECIFIC-DATA is refused outright', () => {
  const { manifest: m, body } = sample({ '0270_x.sql': Buffer.from('UPDATE a SET n = n WHERE n IS NULL;\n') })
  const refused = { ...m, migrations: m.migrations.map((e) => (e.name === '0270_x.sql' ? { ...e, class: 'CLIENT-SPECIFIC-DATA' } : e)) }
  assert.match(verifyManifest(refused, body).join('\n'), /0270_x\.sql: shared migrations numbered 270\+ must be SCHEMA or GENERIC-DATA/)
  assert.deepEqual(verifyManifest(m, body), [], 'the same file classified GENERIC-DATA is fine')
})

check('manifest controls: a 0270+ file that breaks a rule is refused with the line and the rule, and a reasoned exemption silences only that rule', () => {
  const sql = 'UPDATE suppliers SET name = \'x\' WHERE id = 38;\nUPDATE products SET cost_price_usd = 0;\n'
  const { manifest: m, body } = sample({ '0270_x.sql': Buffer.from(sql) })
  const problems = verifyManifest(m, body)
  assert.ok(problems.some((p) => /0270_x\.sql:1 \[pinned-id\]/.test(p)), problems.join('\n'))
  assert.ok(problems.some((p) => /0270_x\.sql:2 \[unconditional-write\]/.test(p)), problems.join('\n'))
  const exempt = (rule, reason) => ({ ...m, migrations: m.migrations.map((e) => (e.name === '0270_x.sql' ? { ...e, exemptions: [{ rule, reason }] } : e)) })
  const after = verifyManifest(exempt('pinned-id', 'the singleton settings row has id 1 on every client'), body)
  assert.ok(!after.some((p) => /\[pinned-id\]/.test(p)) && after.some((p) => /\[unconditional-write\]/.test(p)))
  assert.match(verifyManifest(exempt('pinned-id', 'because'), body).join('\n'), /needs a reason of at least 20 characters/)
  assert.match(verifyManifest(exempt('denylist', 'a long enough reason for this'), body).join('\n'), /unknown or non-exemptable rule "denylist"/)
  const early = { ...m, migrations: m.migrations.map((e) => (e.name === '0001_a.sql' ? { ...e, exemptions: [{ rule: 'pinned-id', reason: 'a long enough reason for this' }] } : e)) }
  assert.match(verifyManifest(early, body).join('\n'), /exemptions are only for files numbered 270 or later/)
})

check('manifest controls: the client deny-list reaches a 0270+ file through verifyManifest', () => {
  const { manifest: m, body } = sample({ '0270_x.sql': Buffer.from('-- written for Acme Fixture Client\nALTER TABLE a ADD COLUMN c TEXT;\n') })
  assert.deepEqual(verifyManifest(m, body), [])
  assert.match(verifyManifest(m, body, { denylist: ['acme fixture client'] }).join('\n'), /0270_x\.sql:1 \[denylist\]/)
})

// ---------------------------------------------------------------- 3. the lint bites: positive controls

const MUST_REFUSE = [
  // literal-id: >= 1000 in WHERE / BETWEEN / IN / VALUES
  ['literal-id', 'a threshold in WHERE', "UPDATE products SET is_active = 0 WHERE stock_quantity > 5000;", ['literal-id']],
  ['literal-id', 'a BETWEEN bound', 'DELETE FROM fees WHERE amount_khr BETWEEN 100 AND 250000;', ['literal-id']],
  ['literal-id', 'an IN list', "UPDATE sales SET note = 'x' WHERE total_khr IN (1000, 2000, 3000);", ['literal-id']],
  ['literal-id', 'a VALUES list', "INSERT INTO settings (key, value) VALUES ('daily_cap', 20000) ON CONFLICT(key) DO NOTHING;", ['literal-id']],
  ['literal-id', 'the 2nd branch of an OR', "UPDATE products SET is_active = 0 WHERE is_active = 1 OR cost_price_usd = 12345;", ['literal-id']],
  // pinned-id: an id column compared to a literal, any size
  ['pinned-id', 'id = 38 (below 1000)', "UPDATE suppliers SET name = 'Merged' WHERE id = 38;", ['pinned-id']],
  ['pinned-id', 'an *_id IN list', 'DELETE FROM sale_items WHERE sale_id IN (315, 531);', ['pinned-id']],
  ['pinned-id', 'a SET to a literal branch id', "UPDATE sales SET branch_id = 2 WHERE status = 'x';", ['pinned-id']],
  ['pinned-id', 'a guard trigger that names two sale ids', "CREATE TRIGGER sale_lock BEFORE UPDATE ON sale_items WHEN NEW.sale_id IN (315, 531) BEGIN SELECT RAISE(ABORT, 'locked'); END;", ['pinned-id']],
  ['pinned-id', 'a partial index on one row', 'CREATE INDEX idx_one_row ON sales (customer_id) WHERE id = 7;', ['pinned-id']],
  // literal-rows
  ['literal-rows', 'a multi-row VALUES', "INSERT INTO suppliers (name) VALUES ('a'), ('b');", ['literal-rows']],
  ['literal-rows', 'ONE literal row into a business table', "INSERT INTO organizations (name, slug) SELECT 'Acme', 'acme' WHERE NOT EXISTS (SELECT 1 FROM organizations);", ['literal-rows']],
  ['literal-rows', 'a UNION ALL of FROM-less selects', "INSERT INTO user_aliases (user_id, alias) SELECT 1, seed.alias FROM (SELECT 'a' AS alias UNION ALL SELECT 'b') seed;", ['literal-rows']],
  ['literal-rows', 'a VALUES CTE feeding an UPDATE', "WITH m(a, b) AS (VALUES ('x', 'y'), ('z', 'w')) UPDATE customers SET name = (SELECT b FROM m WHERE a = customers.name) WHERE name IN (SELECT a FROM m);", ['literal-rows']],
  ['literal-rows', 'multi-row literals into a table the file created', "CREATE TABLE g (k TEXT); INSERT INTO g VALUES ('a'), ('b');", ['literal-rows']],
  // unconditional-write
  ['unconditional-write', 'UPDATE with no WHERE', 'UPDATE products SET cost_price_usd = 0;', ['unconditional-write']],
  ['unconditional-write', 'DELETE with no WHERE', 'DELETE FROM fees;', ['unconditional-write']],
  ['unconditional-write', 'a tautology WHERE', 'UPDATE products SET cost_price_usd = 0 WHERE 1 = 1;', ['unconditional-write']],
  ['unconditional-write', 'INSERT OR REPLACE', "INSERT OR REPLACE INTO settings (key, value) VALUES ('k', 'v');", ['unconditional-write']],
  ['unconditional-write', 'REPLACE INTO', "REPLACE INTO settings (key, value) VALUES ('k', 'v');", ['unconditional-write']],
  ['unconditional-write', 'an upsert that overwrites (the 0179 / 0251 shape)', "INSERT INTO settings (key, value) VALUES ('loyalty_points_enabled', 'false') ON CONFLICT(key) DO UPDATE SET value = excluded.value;", ['unconditional-write']],
  ['unconditional-write', 'an UPDATE with only a subquery WHERE', 'UPDATE products SET cost_price_usd = (SELECT 0 FROM branches WHERE id = branch_id);', ['unconditional-write']],
  // check-literal-id
  ['check-literal-id', 'a CHECK IN list of ids', 'CREATE TABLE r (sale_id INTEGER NOT NULL CHECK (sale_id IN (16951, 16952)));', ['check-literal-id']],
  ['check-literal-id', 'a CHECK equality to an id, on ALTER', 'ALTER TABLE r ADD COLUMN c INTEGER CHECK (c = 5000);', ['check-literal-id']],
]

const MUST_PASS = [
  ['DDL with bounds in CHECK and a partial index above 1000', "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT CHECK (length(body) <= 65536), qty INTEGER CHECK (qty BETWEEN 0 AND 1000000)); CREATE INDEX i ON t(body) WHERE qty > 1000; ALTER TABLE t ADD COLUMN c TEXT;"],
  ['a trigger with a CASE, an inner semicolon and a large bound', "CREATE TRIGGER trg AFTER INSERT ON t WHEN NEW.qty > 100000000000 BEGIN UPDATE t SET c = CASE WHEN NEW.qty > 5000 THEN 'a' ELSE 'b' END WHERE id = NEW.id; SELECT 1; END;"],
  ['several default settings, insert-if-absent', "INSERT INTO settings (key, value, updated_at) VALUES ('a', '1', CURRENT_TIMESTAMP), ('b', '2', CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING;"],
  ['a backfill with a rule predicate', 'UPDATE products SET name_key = lower(trim(name)) WHERE name_key IS NULL;'],
  ['a table rebuild', 'CREATE TABLE p_new (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO p_new (id, name) SELECT id, name FROM p; DROP TABLE p; ALTER TABLE p_new RENAME TO p;'],
  ['ids only in a comment and in a string', "-- repairs sale 16951 and id = 40124\nUPDATE sales SET note = 'order 16951' WHERE note = 'id = 40124';"],
  ['an FTS rebuild command', "INSERT INTO products_fts(products_fts) VALUES('rebuild');"],
  ['a LIMIT above 1000 and an id IN a subquery', 'DELETE FROM rate_limit_events WHERE id IN (SELECT id FROM rate_limit_events ORDER BY id LIMIT 5000);'],
  ['a system_flags insert-if-absent', "INSERT OR IGNORE INTO system_flags (key, value, updated_at) VALUES ('flag', '1', CURRENT_TIMESTAMP);"],
  ['a one-row FROM-less guard into a table the file created', 'CREATE TABLE _guard_0270 (ok INTEGER CHECK (ok = 1)); INSERT INTO _guard_0270 SELECT CASE WHEN (SELECT COUNT(*) FROM products) >= 0 THEN 1 ELSE 0 END; DROP TABLE _guard_0270;'],
  ['a trigger that compares columns, not ids', "CREATE TRIGGER sale_item_sale_immutable BEFORE UPDATE OF sale_id ON sale_items WHEN NEW.sale_id <> OLD.sale_id BEGIN SELECT RAISE(ABORT, 'immutable'); END;"],
  ['an UPDATE keyed on a bound parameter-free rule', "UPDATE sales SET status = 'completed' WHERE status = 'done' AND branch_id IN (SELECT id FROM branches);"],
]

check('positive controls: every rule has fixtures and each is refused for exactly that rule', () => {
  const covered = new Set(MUST_REFUSE.map(([rule]) => rule))
  for (const rule of ['literal-id', 'pinned-id', 'literal-rows', 'unconditional-write', 'check-literal-id']) assert.ok(covered.has(rule), `no fixture for ${rule}`)
  for (const [rule, label, sql, expected] of MUST_REFUSE) {
    assert.ok(RULES.includes(rule), `unknown rule ${rule}`)
    assert.deepEqual(rulesOf(sql), expected, `${rule}: ${label} -> ${JSON.stringify(rulesOf(sql))}`)
  }
})

check('negative controls: clean migrations pass, so the lint is not simply refusing everything', () => {
  for (const [label, sql] of MUST_PASS) assert.deepEqual(lint(sql), [], `${label} was refused: ${JSON.stringify(lint(sql))}`)
})

check('deny-list controls: a listed literal is refused wherever it sits, an unlisted file passes', () => {
  const sql = "-- for Acme Fixture Client only\nALTER TABLE t ADD COLUMN c TEXT;"
  assert.deepEqual(lint(sql), [])
  assert.deepEqual(rulesOf(sql, { denylist: ['acme fixture client'] }), ['denylist'])
  assert.deepEqual(rulesOf("INSERT OR IGNORE INTO settings (key, value) VALUES ('shop', 'ACME FIXTURE CLIENT') ON CONFLICT(key) DO NOTHING;", { denylist: ['Acme Fixture Client'] }), ['denylist'])
  assert.deepEqual(lint(sql, { denylist: ['', 'ab', '  '] }), [], 'blank or 2-character entries never match')
})

check('deny-list source: environment variable or a local file, empty by default, and the file is gitignored', () => {
  assert.deepEqual(loadDenylist({}, { readFileSync() { throw new Error('ENOENT') } }, path), [])
  assert.deepEqual(loadDenylist({ BOS_CLIENT_DENYLIST: 'Alpha Shop, Beta\nGamma' }, { readFileSync() { throw new Error('ENOENT') } }, path), ['Alpha Shop', 'Beta', 'Gamma'])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-denylist-'))
  const file = path.join(dir, 'deny.local')
  fs.writeFileSync(file, '# comment\nDelta Store\n\nEpsilon\n')
  assert.deepEqual(loadDenylist({ BOS_CLIENT_DENYLIST_FILE: file }), ['Delta Store', 'Epsilon'])
  fs.rmSync(dir, { recursive: true, force: true })
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8')
  assert.match(ignore, /^cloudflare\/scripts\/\.client-denylist\.local\s*$/m, 'the deny-list file must be gitignored: it holds client names')
})

check('exemption controls: an exemption silences its own rule and no other', () => {
  const sql = "UPDATE suppliers SET name = 'x' WHERE id = 38;\nUPDATE products SET cost_price_usd = 0;"
  assert.deepEqual(rulesOf(sql), ['pinned-id', 'unconditional-write'])
  assert.deepEqual(rulesOf(sql, { exemptions: [{ rule: 'pinned-id', reason: 'x' }] }), ['unconditional-write'])
  assert.deepEqual(rulesOf(sql, { exemptions: [{ rule: 'literal-id', reason: 'x' }] }), ['pinned-id', 'unconditional-write'])
})

check('class control: a file declared SCHEMA that writes rows is refused as class-understated', () => {
  const sql = 'UPDATE products SET name_key = lower(name) WHERE name_key IS NULL;'
  assert.deepEqual(lint(sql, { cls: 'GENERIC-DATA' }), [])
  assert.deepEqual(rulesOf(sql, { cls: 'SCHEMA' }), ['class-understated'])
})

check('splitter control: a trigger body with CASE ... END and inner semicolons is one statement, and comments and strings never split', () => {
  const sql = "CREATE TRIGGER t1 AFTER INSERT ON a WHEN NEW.x = ';' BEGIN UPDATE a SET y = CASE WHEN NEW.x > 1 THEN 'END;' ELSE 'b' END; INSERT INTO log VALUES (1); END;\n-- a ; comment\nSELECT 1;\n/* ; */ SELECT 2;"
  const statements = splitStatements(sql)
  assert.equal(statements.length, 3)
  assert.equal(statements[0].kind, 'create_trigger')
  assert.equal(statements[1].kind, 'select')
})

// ---------------------------------------------------------------- 4. calibration on the real 215

const SKIPPED_BACKFILLS = ['0010', '0016', '0037', '0038', '0039', '0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0132']

// What the lint says about each CLIENT-SPECIFIC-DATA migration, pinned. These
// are the files that would contaminate a new client; every one that is NOT empty
// below is refused if it were submitted today. Empty = the lint cannot see it.
const EXPECTED_CLIENT = {
  '0072': [],
  '0099': [],
  '0103': ['literal-rows'],
  '0109': ['unconditional-write'],
  '0110': [],
  '0111': [],
  '0112': ['literal-id', 'pinned-id'],
  '0117': [],
  '0153': ['literal-id', 'literal-rows', 'pinned-id'],
  '0163': ['literal-id', 'pinned-id'],
  '0164': ['pinned-id'],
  '0165': ['literal-rows'],
  '0166': [],
  '0168': ['literal-id', 'literal-rows', 'pinned-id'],
  '0173': ['literal-id', 'literal-rows', 'pinned-id'],
  '0174': ['literal-id', 'literal-rows', 'pinned-id'],
  '0176': ['literal-id', 'pinned-id'],
  '0178': [],
  '0179': ['literal-rows', 'unconditional-write'],
  '0183': ['literal-id', 'literal-rows'],
  '0251': ['unconditional-write'],
}

check('calibration: the lint refuses 14 of the 21 client-specific migrations and names the 7 policy rewrites it cannot see', () => {
  const got = {}
  for (const entry of manifest.migrations) {
    const number = entry.name.slice(0, 4)
    if (entry.class !== 'CLIENT-SPECIFIC-DATA') continue
    got[number] = rulesOf(files.get(entry.name).toString('utf8'), { cls: entry.class })
  }
  assert.deepEqual(got, EXPECTED_CLIENT)
  const blind = Object.keys(EXPECTED_CLIENT).filter((n) => EXPECTED_CLIENT[n].length === 0)
  assert.deepEqual(blind, ['0072', '0099', '0110', '0111', '0117', '0166', '0178'])
  assert.equal(Object.keys(EXPECTED_CLIENT).length - blind.length, 14)
})

check('calibration: the SCHEMA and GENERIC-DATA files trip only the three known shapes (derived-column backfills without WHERE, pinned ids in 0145/0146 CHECKs, and 0030\'s one neutral default row)', () => {
  const got = {}
  for (const entry of manifest.migrations) {
    if (entry.class === 'CLIENT-SPECIFIC-DATA') continue
    const rules = rulesOf(files.get(entry.name).toString('utf8'), { cls: entry.class })
    if (rules.length) got[entry.name.slice(0, 4)] = rules
  }
  const expected = {}
  for (const n of SKIPPED_BACKFILLS) expected[n] = ['unconditional-write']
  expected['0145'] = ['check-literal-id']
  expected['0146'] = ['check-literal-id']
  expected['0030'] = ['literal-rows']
  assert.deepEqual(got, expected)
})

check('the rule list in the lint is the rule list the manifest tooling and the doc know', () => {
  assert.deepEqual(RULES, ['literal-id', 'pinned-id', 'literal-rows', 'unconditional-write', 'check-literal-id', 'denylist', 'class-understated'])
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'setup', 'migrations-multi-client.md'), 'utf8')
  for (const rule of RULES) assert.ok(doc.includes(`\`${rule}\``), `docs/setup/migrations-multi-client.md does not describe the rule ${rule}`)
})

console.log(`\n${passed} checks passed (${files.size} migrations in the manifest)`)

// Proves that a SALE-LINK conflict (the Conflicts tab's fourth section) can
// always be resolved -- keeping one "as is" (dismissing it) is reversible, and
// the exact mismatch/missing SQL the route issues is valid against the real
// schema. Backs the user rule: a conflict can always be resolved in Conflicts.
//
// Two layers, no app harness (route handlers here are not fetch-tested):
//   (1) ROUND-TRIP -- build the REAL schema from the full migration chain, seed
//       a mismatch sale (linked to a customer whose phone differs from the
//       phone printed on the sale) and a missing sale (customer_id NULL naming a
//       contact that does not exist), then run the EXACT mismatch / missing
//       SELECTs from routes/contacts.ts (both the open form and the
//       includeDismissed form) and the exact dismiss upsert / undismiss delete,
//       asserting: open sweep flags it -> dismiss hides it from the open sweep
//       -> includeDismissed brings it back flagged dismissed:1 -> undismiss
//       returns it to the open sweep. Proves the modified SQL compiles/runs and
//       that keep is reversible for BOTH mismatch and missing.
//   (2) SOURCE GUARD -- assert the route + transport still carry the sale-link
//       reopen wiring so a later edit cannot quietly drop it.
//
// Run (from cloudflare/): node scripts/test-sale-link-conflict-reopen-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const db = openDb(loadAll())
const run = (sql, params) => db.prepare(sql).run(params || {})
const all = (sql, params) => db.prepare(sql).all(params || {})

// Mirror routes/contacts.ts's PHONE_KEY_SQL exactly (zero-stripped digits).
const PHONE_KEY_SQL = (col) =>
  `ltrim(replace(replace(replace(replace(trim(COALESCE(${col},'')),' ',''),'-',''),'(',''),')',''),'0')`
const salePhone = PHONE_KEY_SQL('s.customer_phone')
const custPhone = PHONE_KEY_SQL('c.phone')
const anyCustPhone = PHONE_KEY_SQL('c2.phone')

// The mismatch SELECT, verbatim from the route, parametrized on includeDismissed.
const mismatchSql = (includeDismissed) => `
  SELECT g.*,
    (SELECT COUNT(*) FROM customers c2 WHERE ${anyCustPhone} = g.phone_key) AS phone_owner_count,
    (SELECT c2.id FROM customers c2 WHERE ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_id,
    (SELECT c2.name FROM customers c2 WHERE ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_name,
    (SELECT c2.phone FROM customers c2 WHERE ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_phone,
    EXISTS (
      SELECT 1 FROM contact_duplicate_dismissals d
      WHERE d.contact_table = 'customers' AND d.cluster_type = 'link_mismatch'
        AND d.cluster_value = g.customer_id || '|' || g.phone_key
    ) AS dismissed
  FROM (
    SELECT s.customer_id, c.name AS customer_name, c.phone AS customer_phone,
           MAX(trim(s.customer_phone)) AS sale_phone, ${salePhone} AS phone_key,
           MAX(trim(COALESCE(s.customer_name,''))) AS sale_name,
           COUNT(*) AS sale_count, MIN(s.created_at) AS first_at, MAX(s.created_at) AS last_at,
           ROUND(COALESCE(SUM(s.total_usd),0),2) AS total_usd
    FROM sales s JOIN customers c ON c.id = s.customer_id
    WHERE ${salePhone} <> '' AND ${salePhone} <> ${custPhone}
    GROUP BY s.customer_id, ${salePhone}
  ) g
  ${includeDismissed ? '' : `WHERE NOT EXISTS (
    SELECT 1 FROM contact_duplicate_dismissals d
    WHERE d.contact_table = 'customers' AND d.cluster_type = 'link_mismatch'
      AND d.cluster_value = g.customer_id || '|' || g.phone_key
  )`}
  ORDER BY g.last_at DESC
  LIMIT 200`

// The missing SELECT, verbatim from the route, parametrized on includeDismissed.
const missingSql = (includeDismissed) => `
  SELECT g.*,
    (SELECT COUNT(*) FROM customers c2 WHERE g.phone_key <> '' AND ${anyCustPhone} = g.phone_key) AS phone_owner_count,
    (SELECT c2.id FROM customers c2 WHERE g.phone_key <> '' AND ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_id,
    (SELECT c2.name FROM customers c2 WHERE g.phone_key <> '' AND ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_name,
    (SELECT c2.phone FROM customers c2 WHERE g.phone_key <> '' AND ${anyCustPhone} = g.phone_key LIMIT 1) AS suggested_phone,
    EXISTS (
      SELECT 1 FROM contact_duplicate_dismissals d
      WHERE d.contact_table = 'customers' AND d.cluster_type = 'link_missing'
        AND d.cluster_value = lower(g.name) || '|' || g.phone_key
    ) AS dismissed
  FROM (
    SELECT MAX(trim(COALESCE(s.customer_name,''))) AS name,
           MAX(trim(COALESCE(s.customer_phone,''))) AS phone,
           ${salePhone} AS phone_key,
           COUNT(*) AS sale_count, MIN(s.created_at) AS first_at, MAX(s.created_at) AS last_at,
           ROUND(COALESCE(SUM(s.total_usd),0),2) AS total_usd
    FROM sales s
    WHERE s.customer_id IS NULL
      AND (trim(COALESCE(s.customer_name,'')) <> '' OR trim(COALESCE(s.customer_phone,'')) <> '')
    GROUP BY lower(trim(COALESCE(s.customer_name,''))), ${salePhone}
  ) g
  ${includeDismissed ? '' : `WHERE NOT EXISTS (
    SELECT 1 FROM contact_duplicate_dismissals d
    WHERE d.contact_table = 'customers' AND d.cluster_type = 'link_missing'
      AND d.cluster_value = lower(g.name) || '|' || g.phone_key
  )`}
  ORDER BY g.sale_count DESC, g.last_at DESC
  LIMIT 200`

// The exact dismiss upsert / undismiss delete the route issues.
const DISMISS_UPSERT = `
  INSERT INTO contact_duplicate_dismissals (contact_table, cluster_type, cluster_value, dismissed_by_id, dismissed_by_name, dismissed_at)
  VALUES ('customers', @kind, @value, @byId, @byName, CURRENT_TIMESTAMP)
  ON CONFLICT(contact_table, cluster_type, cluster_value) DO UPDATE SET
    dismissed_by_id = @byId, dismissed_by_name = @byName, dismissed_at = CURRENT_TIMESTAMP`
const UNDISMISS_DELETE = `
  DELETE FROM contact_duplicate_dismissals
  WHERE contact_table = 'customers' AND cluster_type = @kind AND cluster_value = @value`
const dismiss = (kind, value) => run(DISMISS_UPSERT, { kind, value, byId: null, byName: null })
const undismiss = (kind, value) => run(UNDISMISS_DELETE, { kind, value })

// Seed. Mismatch: sale linked to customer 301 (phone 012111222) but the sale
// itself prints phone 012999888 -> the sale's phone_key ('12999888') disagrees
// with the linked customer's ('12111222'). Missing: an unlinked sale naming
// "Walk In" / 012333444 with no matching contact row.
run(`INSERT INTO customers (id, name, phone) VALUES (301, 'Chan Nita', '012111222')`)
run(`INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, created_at)
     VALUES (301, 'Chan Nita', '012999888', 10, '2026-01-02 08:00:00')`)
run(`INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, created_at)
     VALUES (301, 'Chan Nita', '012999888', 5, '2026-01-03 08:00:00')`)
run(`INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, created_at)
     VALUES (NULL, 'Walk In', '012333444', 7, '2026-01-04 08:00:00')`)

// The dismissal keys the route stores (mismatch: customer_id|phone_key,
// missing: lower(name)|phone_key).
const MISMATCH_KEY = '301|12999888'
const MISSING_KEY = 'walk in|12333444'

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

check('open sweep surfaces the mismatch group, not dismissed', () => {
  const rows = all(mismatchSql(false), {})
  assert.strictEqual(rows.length, 1, 'one mismatch group')
  assert.strictEqual(rows[0].customer_id, 301)
  assert.strictEqual(rows[0].phone_key, '12999888')
  assert.strictEqual(rows[0].sale_count, 2, 'both same-phone sales grouped')
  assert.strictEqual(Number(rows[0].dismissed), 0, 'open group is not flagged kept')
})

check('open sweep surfaces the missing group, not dismissed', () => {
  const rows = all(missingSql(false), {})
  assert.strictEqual(rows.length, 1, 'one missing group')
  assert.strictEqual(rows[0].name, 'Walk In')
  assert.strictEqual(rows[0].phone_key, '12333444')
  assert.strictEqual(Number(rows[0].dismissed), 0, 'open group is not flagged kept')
})

check('keeping (dismiss) the mismatch group hides it from the open sweep', () => {
  dismiss('link_mismatch', MISMATCH_KEY)
  assert.strictEqual(all(mismatchSql(false), {}).length, 0, 'kept mismatch gone from open sweep')
})

check('keeping (dismiss) the missing group hides it from the open sweep', () => {
  dismiss('link_missing', MISSING_KEY)
  assert.strictEqual(all(missingSql(false), {}).length, 0, 'kept missing gone from open sweep')
})

check('includeDismissed brings both kept groups back, flagged dismissed:1', () => {
  const m = all(mismatchSql(true), {})
  assert.strictEqual(m.length, 1, 'kept mismatch surfaces under Show kept')
  assert.strictEqual(Number(m[0].dismissed), 1, 'flagged so the panel offers Reopen')
  const g = all(missingSql(true), {})
  assert.strictEqual(g.length, 1, 'kept missing surfaces under Show kept')
  assert.strictEqual(Number(g[0].dismissed), 1, 'flagged so the panel offers Reopen')
})

check('reopen (undismiss) returns the mismatch group to the open sweep', () => {
  undismiss('link_mismatch', MISMATCH_KEY)
  const rows = all(mismatchSql(false), {})
  assert.strictEqual(rows.length, 1, 'reopened mismatch is open again')
  assert.strictEqual(Number(rows[0].dismissed), 0)
})

check('reopen (undismiss) returns the missing group to the open sweep', () => {
  undismiss('link_missing', MISSING_KEY)
  const rows = all(missingSql(false), {})
  assert.strictEqual(rows.length, 1, 'reopened missing is open again')
  assert.strictEqual(Number(rows[0].dismissed), 0)
})

// ---- Layer 2: source guards -----------------------------------------------
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
const transportSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'contacts', 'contactDuplicates.ts'), 'utf8')

check('route still exposes link-conflicts undismiss + includeDismissed', () => {
  assert.ok(/link-conflicts\/undismiss/.test(routeSrc), 'undismiss route present')
  assert.ok(/link_mismatch/.test(routeSrc) && /link_missing/.test(routeSrc), 'both cluster types wired')
  assert.ok(/includeDismissed \? '' :/.test(routeSrc), 'GET filters open-only unless includeDismissed')
})

check('transport still exports undismissSaleLinkConflict + includeDismissed', () => {
  assert.ok(/export async function undismissSaleLinkConflict/.test(transportSrc), 'undismiss transport present')
  assert.ok(/includeDismissed=1/.test(transportSrc), 'getSaleLinkConflicts can ask for kept groups')
})

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nAll sale-link conflict reopen checks passed')

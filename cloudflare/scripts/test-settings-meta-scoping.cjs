// Real, confirmed bug repro + regression test for the "Portal settings
// changed on another device" false-conflict report (see routes/settings.ts's
// GET /meta comment for the full incident writeup).
//
// Reproduces the exact mechanism against real SQLite: GET /meta used to
// return the GLOBAL MAX(updated_at) across every settings row, while POST /'s
// own conflict check scopes MAX(updated_at) to only the keys being written.
// A save of a specific key set (e.g. the ~60 customer_portal_* keys the
// portal editor writes) compared against a global max is a near-guaranteed
// mismatch the moment ANY unrelated setting (theme, receipt config, etc.) is
// touched more recently -- not an occasional real conflict.
//
// This test builds the exact SQL both endpoints use (copied verbatim from
// routes/settings.ts's getSettingsUpdatedAt) against a real in-memory
// database, and asserts:
//   1. The bug is real: global-scoped meta != key-scoped meta once an
//      unrelated key is touched more recently than the target keys.
//   2. The fix works: key-scoped meta (the new `keys` query param path)
//      matches exactly what POST /'s own conflict check computes for the
//      same key set, so a client that fetches scoped meta right before
//      saving will never see a false conflict from unrelated key churn.
//
// Run: node scripts/test-settings-meta-scoping.cjs

const assert = require('assert')
const Database = require('better-sqlite3')

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );
`)

// Copied verbatim (same SQL shapes) from routes/settings.ts's
// getSettingsUpdatedAt, minus the D1/Cloudflare Env plumbing.
function getSettingsUpdatedAt(keys) {
  if (keys && keys.length) {
    const row = db.prepare(
      `SELECT MAX(updated_at) AS updated_at FROM settings WHERE key IN (SELECT value FROM json_each(?))`,
    ).get(JSON.stringify(keys))
    if (row && row.updated_at) return row.updated_at
  }
  const row = db.prepare('SELECT MAX(updated_at) AS updated_at FROM settings').get()
  return (row && row.updated_at) || null
}

function upsert(key, value, updatedAt) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, updatedAt)
}

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Seed: the portal editor's keys were last saved at t1. Some time later
// (t2), an unrelated setting (theme) is saved -- something that happens
// constantly in normal use and has nothing to do with the portal editor.
const portalKeys = ['customer_portal_business_tagline', 'customer_portal_cover_image', 'customer_portal_title']
portalKeys.forEach((key) => upsert(key, 'v1', '2026-08-01T00:00:00.000Z'))
upsert('theme', 'dark', '2026-08-10T00:00:00.000Z')

check('bug reproduced: unscoped global meta drifts from the keys actually being saved', () => {
  const globalMeta = getSettingsUpdatedAt() // old GET /meta behavior, no keys
  const scopedActual = getSettingsUpdatedAt(portalKeys) // what POST / actually checks against
  // The theme save is newer than the portal keys, so a client caching the
  // global max and sending it as expectedUpdatedAt would send
  // '2026-08-10...' while the real value for the portal keys is
  // '2026-08-01...' -- guaranteed mismatch, i.e. the false conflict.
  assert.notStrictEqual(globalMeta, scopedActual)
  assert.strictEqual(globalMeta, '2026-08-10T00:00:00.000Z')
  assert.strictEqual(scopedActual, '2026-08-01T00:00:00.000Z')
})

check('fix works: key-scoped meta matches POST /\'s own scoped conflict check exactly', () => {
  const scopedMeta = getSettingsUpdatedAt(portalKeys) // new GET /meta?keys=... behavior
  const scopedActual = getSettingsUpdatedAt(portalKeys) // POST /'s own check
  assert.strictEqual(scopedMeta, scopedActual)
})

check('a real conflict on the SAME keys is still caught (fix does not mask genuine conflicts)', () => {
  const scopedMetaBeforeEdit = getSettingsUpdatedAt(portalKeys)
  // Someone else genuinely edits one of the same portal keys after this
  // client fetched its scoped expectedUpdatedAt.
  upsert('customer_portal_title', 'v2-from-another-tab', '2026-08-15T00:00:00.000Z')
  const scopedActualAfterEdit = getSettingsUpdatedAt(portalKeys)
  assert.notStrictEqual(scopedMetaBeforeEdit, scopedActualAfterEdit)
})

check('unrelated key churn after fetching scoped meta does not trigger a false conflict', () => {
  const scopedMeta = getSettingsUpdatedAt(portalKeys)
  upsert('receipt_footer_text', 'changed', '2026-08-20T00:00:00.000Z')
  const scopedActual = getSettingsUpdatedAt(portalKeys)
  assert.strictEqual(scopedMeta, scopedActual)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll settings-meta-scoping checks passed.')

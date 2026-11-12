'use strict'
// W2-PAGES #7 (P-SET-1): GET /api/settings read the settings table twice (every row, then MAX(updated_at) over the non-system-owned rows). It now reads the table once and
// computes the stamp from the same rows with newestNonSystemOwnedStamp (lib/settingsSensitive.ts), the JS twin of NOT_SYSTEM_OWNED_SETTING_SQL.
// Pinned: (1) a differential against the SQL it replaces, on a fixture with `*_last_run`, `*_last_run:x`, both cron keys, a NULL updated_at, an upper-case key and
// a numeric stamp; (2) the route issues ONE statement over settings and no MAX; (3) the response is unchanged (rows, stamp, fallback to now) -- the full route
// behaviour is test-settings-system-owned-pure.cjs; (4) the naive mutant that forgets the system-owned filter is caught by the fixture.
// Run (from cloudflare/): node scripts/test-settings-single-scan-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const mod = { exports: {} }
new Function('module', 'exports', ts.transpileModule(read('src/lib/settingsSensitive.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports)
const { newestNonSystemOwnedStamp, NOT_SYSTEM_OWNED_SETTING_SQL, isSystemOwnedSettingKey } = mod.exports

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at)')
const insert = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
const sqlStamp = () => db.prepare(`SELECT MAX(updated_at) AS u FROM settings WHERE ${NOT_SYSTEM_OWNED_SETTING_SQL}`).get().u
const rowsNow = () => db.prepare('SELECT key, value, updated_at FROM settings').all()
const reset = (fixture) => { db.exec('DELETE FROM settings'); for (const [key, stamp] of fixture) insert.run(key, 'v', stamp) }

const FIXTURES = {
  'ordinary rows only': [['business_name', '2026-01-01 00:00:00'], ['theme', '2026-02-01 10:00:00']],
  'system-owned rows are newer and must be ignored': [['business_name', '2026-01-01 00:00:00'], ['cron_rotation_state', '2099-01-01 00:00:00'], ['cron_heavy_state', '2099-02-01 00:00:00'], ['audit_log_retention_last_run', '2099-03-01 00:00:00'], ['telegram_last_run:chat9', '2099-04-01 00:00:00']],
  'a NULL updated_at is ignored': [['a', null], ['b', '2026-03-03 00:00:00']],
  'an upper-case system-owned key': [['business_name', '2026-01-01 00:00:00'], ['CRON_ROTATION_STATE', '2099-05-05 00:00:00'], ['Foo_Last_Run', '2099-06-06 00:00:00']],
  'only system-owned rows': [['cron_rotation_state', '2099-01-01 00:00:00']],
  'empty table': [],
  'only NULL stamps': [['a', null], ['b', null]],
  'a numeric stamp loses to any text stamp (SQLite order)': [['a', 5], ['b', '2020-01-01 00:00:00']],
  'numeric stamps only': [['a', 5], ['b', 9]],
  'keys that merely contain last_run': [['last_run_notes', '2026-07-07 00:00:00'], ['x_last_runner', '2026-08-08 00:00:00']],
}
check('differential: the JS stamp equals the SQL MAX over the non-system-owned rows, for every fixture', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    reset(fixture)
    assert.equal(newestNonSystemOwnedStamp(rowsNow()), sqlStamp(), name)
  }
})
check('the system-owned fixture really exercises the filter (a naive MAX over every row differs)', () => {
  reset(FIXTURES['system-owned rows are newer and must be ignored'])
  const naive = rowsNow().map((r) => r.updated_at).reduce((a, b) => (b > a ? b : a))
  assert.notEqual(naive, sqlStamp())
  assert.equal(newestNonSystemOwnedStamp(rowsNow()), '2026-01-01 00:00:00')
  assert.ok(isSystemOwnedSettingKey('telegram_last_run:chat9'))
})
check('the route reads settings once for GET / and no longer asks MAX(updated_at) there', () => {
  const text = read('src/routes/settings.ts')
  const handler = text.slice(text.indexOf("app.get('/', async"), text.indexOf("app.get('/meta'"))
  assert.equal([...handler.matchAll(/FROM settings/g)].length, 1, 'one scan')
  assert.doesNotMatch(handler, /MAX\(updated_at\)/)
  assert.doesNotMatch(handler, /db\.batch/)
  assert.match(handler, /SELECT key, value, updated_at FROM settings/)
  assert.match(handler, /newestNonSystemOwnedStamp\(rows\) \|\| new Date\(\)\.toISOString\(\)/)
})
console.log(`${passed} checks passed.`)

#!/usr/bin/env node
// Offline checks for the settings-upsert job of .github/workflows/ops.yml
// (ops/scripts/ops-settings-upsert.mjs), which sets the owner's Telegram
// forum-topic ids (telegram_topic_*) in production D1. No network and no
// wrangler: every D1 answer below comes from running the job's own SQL on an
// in-memory SQLite that replays every migration, and every Worker rule is
// read from the Worker's own source (transpiled, never restated). Pins:
//   1. the allow-list IS the Worker's TELEGRAM_TOPIC_KEYS -- the keys
//      getTelegramConfig reads -- parsed from lib/telegram.ts, and refused
//      whole when that declaration changes shape;
//   2. the input is key=value pairs of allow-listed keys and digits-only
//      topic ids, refused before D1 is touched: keys outside the list, empty,
//      non-digit, zero, leading-zero or oversized values, quotes, semicolons,
//      look-alike digits;
//   3. the write is the route's own write: the upsert text of
//      routes/settings.ts POST /, the audit row audit() + changedFields()
//      store for the same save, and the D1 half of bumpVersion('settings');
//   4. one LF-only statement batch naming only the requested keys and three
//      tables, re-verified before it is sent;
//   5. dry run unless apply; read-back mismatches fail the run; the previous
//      values come back as an input this same task accepts;
//   6. the public log carries counts and PASS/FAIL, never a key or a value.
//
// Run (from cloudflare/): node scripts/test-ops-settings-upsert-pure.cjs
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { pathToFileURL } = require('url')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'cloudflare', 'src')
// Normalise CRLF: a Windows checkout (core.autocrlf=true) must read what CI reads.
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let passed = 0
const notes = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    process.exitCode = 1
    console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`)
  }
}

// A Worker module, transpiled the way the other pure tests load one. A
// relative import not handed in is a stub that throws when used, so only the
// real file's constants and the helpers a check calls ever run.
function loadWorker(rel, overrides = {}) {
  const file = path.join(SRC, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
  })
  const original = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (request.startsWith('.')) {
      return new Proxy({}, {
        get: (_, name) => (name === '__esModule' ? true : () => { throw new Error(`${rel}: stub ${request}.${String(name)} was called`) }),
      })
    }
    return original.call(this, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, file, path.dirname(file))
  } finally {
    Module._load = original
  }
  return mod.exports
}

// ------------------------------------------------------------ fixtures

const SEED_TS = '2026-09-01 00:00:00'
const plain = (rows) => rows.map((row) => ({ ...row }))

// Resets the rows this job can touch (and the audit trail) to a fixture.
// Non-Telegram settings seeded by the migrations stay, as a control.
function reset(db, { settings = {}, settingsVersion = null } = {}) {
  db.db.exec("DELETE FROM settings WHERE key LIKE 'telegram_topic_%'")
  db.db.exec('DELETE FROM audit_logs')
  db.db.exec("DELETE FROM cache_versions WHERE namespace = 'settings'")
  const insert = db.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  for (const [key, value] of Object.entries(settings)) insert.run(key, value, SEED_TS)
  if (settingsVersion !== null) {
    db.db.prepare("INSERT INTO cache_versions (namespace, version, updated_at) VALUES ('settings', ?, ?)").run(settingsVersion, SEED_TS)
  }
}

// D1 state after a save, with the clock taken out: a timestamp the save
// wrote becomes '<now>' once its shape is checked (CURRENT_TIMESTAMP).
function snapshot(db, TIMESTAMP) {
  const now = (value) => {
    if (value === SEED_TS || value === null) return value
    assert.ok(TIMESTAMP.test(value), `not a CURRENT_TIMESTAMP value: ${value}`)
    return '<now>'
  }
  return {
    settings: plain(db.db.prepare("SELECT key, value, updated_at FROM settings WHERE key LIKE 'telegram_topic_%' ORDER BY key").all())
      .map((r) => ({ ...r, updated_at: now(r.updated_at) })),
    // Every column but the id (AUTOINCREMENT differs between the two databases).
    audit: plain(db.db.prepare('SELECT * FROM audit_logs ORDER BY id').all())
      .map(({ id, ...r }) => ({ ...r, created_at: now(r.created_at) })),
    version: plain(db.db.prepare("SELECT version FROM cache_versions WHERE namespace = 'settings'").all()),
    tables: db.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n,
  }
}

// Splits SQL the way SQLite does (literals are data): ops-sql-guard's
// SQLite-mirroring scanner, ';' only in code.
function splitStatements(guard, sql) {
  const out = []
  let current = ''
  for (const part of guard.scanSql(sql)) {
    if (part.type !== 'code') {
      current += part.type === 'string' || part.type === 'ident' ? part.text : ' '
      continue
    }
    const pieces = part.text.split(';')
    current += pieces[0]
    for (const piece of pieces.slice(1)) {
      out.push(current.trim())
      current = piece
    }
  }
  out.push(current.trim())
  return out.filter(Boolean)
}

// What `wrangler d1 execute business-os --remote --json --command <sql>`
// prints for <sql>, from running it here: one result set per statement, the
// whole request one transaction (D1 runs a request's SQL as one transaction;
// a failing statement rolls every earlier one back and wrangler prints
// {"error": ...} and exits 1).
function fakeD1(guard, db, { beforeWrite, afterWrite } = {}) {
  const calls = []
  const d1 = async (sql) => {
    calls.push(sql)
    const statements = splitStatements(guard, sql)
    const isWrite = statements.length > 1
    if (isWrite && beforeWrite) {
      const r = beforeWrite(sql)
      if (r) return r
    }
    const sets = []
    db.db.exec('BEGIN')
    try {
      for (const statement of statements) {
        const start = db.db.prepare('SELECT total_changes() AS n').get().n
        const results = plain(db.db.prepare(statement).all())
        const changes = db.db.prepare('SELECT total_changes() AS n').get().n - start
        sets.push({ results, success: true, meta: { changes, changed_db: changes > 0, rows_written: changes, rows_read: results.length, duration: 0.1 } })
      }
      db.db.exec('COMMIT')
    } catch (err) {
      db.db.exec('ROLLBACK')
      return { code: 1, stdout: JSON.stringify({ error: { text: String(err.message) } }, null, 2), stderr: '', timedOut: false }
    }
    if (isWrite && afterWrite) afterWrite(db)
    return { code: 0, stdout: JSON.stringify(sets, null, 2), stderr: '', timedOut: false }
  }
  return { d1, calls }
}

// KV as lib/cache.ts uses it (env.CACHE), recording writes.
function fakeKv(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    puts: [],
    async get(key) { return values.has(key) ? values.get(key) : null },
    async put(key, value) { this.puts.push([key, value]); values.set(key, value) },
    async delete(key) { values.delete(key) },
  }
}

// ------------------------------------------------------------------ tests

async function main() {
  const mod = await load('ops/scripts/ops-settings-upsert.mjs')
  const common = await load('ops/scripts/ops-common.mjs')
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const d1export = await load('ops/scripts/ops-d1-export.mjs')

  const telegram = loadWorker('lib/telegram.ts')
  const sensitive = loadWorker('lib/settingsSensitive.ts')
  const dbStub = { getDb: (env) => env.DB_COMPAT }
  const auditMod = loadWorker('lib/audit.ts', { './db': dbStub })
  const cacheMod = loadWorker('lib/cache.ts', { './db': dbStub, './quotaGuard': { consumeQuota: async () => ({ zone: 'ok' }) } })

  const TELEGRAM_TS = read('cloudflare', 'src', 'lib', 'telegram.ts')
  const SETTINGS_TS = read('cloudflare', 'src', 'routes', 'settings.ts')
  const POST_HANDLER = SETTINGS_TS.slice(SETTINGS_TS.indexOf("app.post('/', async (c) => {"))
  const ALLOW = [...telegram.TELEGRAM_TOPIC_KEYS]
  const CONTEXT = { runId: '18112233445', commit: 'c5b28762c5b28762c5b28762c5b28762c5b28762' }

  const refused = (fn) => {
    let err
    try { fn() } catch (e) { err = e }
    assert.ok(err, 'accepted')
    assert.ok(err instanceof common.OpsError, `not an OpsError: ${err && err.message}`)
    return err
  }

  // One schema for every fixture: the real migrations, replayed once per database.
  const MIGRATIONS = loadAll()
  const dbW = openDb(MIGRATIONS) // the Worker's own save
  const dbO = openDb(MIGRATIONS) // this job
  const baseSettings = plain(dbO.db.prepare("SELECT key, value, updated_at FROM settings WHERE key NOT LIKE 'telegram_topic_%' ORDER BY key").all())

  await check('the allow-list is the Worker\'s TELEGRAM_TOPIC_KEYS, the keys getTelegramConfig reads', () => {
    assert.ok(ALLOW.length >= 7, `the Worker has ${ALLOW.length} topic keys`)
    assert.deepStrictEqual([...mod.loadTopicKeyAllowList()], ALLOW, 'the job must read the list the Worker exports')
    assert.deepStrictEqual([...mod.topicKeysFromSource(TELEGRAM_TS)], ALLOW)
    assert.ok(Object.isFrozen(mod.loadTopicKeyAllowList()))
    for (const key of ALLOW) assert.ok(mod.TOPIC_KEY.test(key), `${key} is outside the telegram_topic_* family`)
    // What makes these the keys the Worker READS: getTelegramConfig selects
    // SETTING_KEYS, which spreads the list, and maps it into config.topics.
    assert.ok(/const SETTING_KEYS = \[[^\]]*\.\.\.TELEGRAM_TOPIC_KEYS,\n\] as const/.test(TELEGRAM_TS), 'SETTING_KEYS no longer spreads TELEGRAM_TOPIC_KEYS')
    assert.ok(TELEGRAM_TS.includes('topics: Object.fromEntries(TELEGRAM_TOPIC_KEYS.map((key) => [key, parseTelegramTopicId(values[key])]))'), 'getTelegramConfig no longer reads every topic key')
    assert.ok(POST_HANDLER.includes('for (const key of TELEGRAM_TOPIC_KEYS) {'), 'the settings route no longer validates the same list')
    // grep telegram_topic in cloudflare/src: every key literal the Worker names is one this job may set.
    const named = new Set()
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.ts$/.test(entry.name)) for (const m of fs.readFileSync(full, 'utf8').matchAll(/'(telegram_topic_[a-z_]+)'/g)) named.add(m[1])
      }
    }
    walk(SRC)
    assert.deepStrictEqual([...named].filter((key) => !ALLOW.includes(key)), [], 'the Worker names a topic key the allow-list lacks')
    assert.deepStrictEqual(ALLOW.filter((key) => !named.has(key)), [])
  })

  await check('the allow-list parser refuses any other shape of that declaration (fail closed)', () => {
    const decl = TELEGRAM_TS.slice(TELEGRAM_TS.indexOf('export const TELEGRAM_TOPIC_KEYS = ['), TELEGRAM_TS.indexOf('] as const', TELEGRAM_TS.indexOf('export const TELEGRAM_TOPIC_KEYS')) + 10)
    assert.deepStrictEqual([...mod.topicKeysFromSource(decl.replace(/\n/g, '\r\n'))], ALLOW, 'a CRLF checkout reads the same list')
    const first = `'${ALLOW[0]}'`
    for (const [label, text] of [
      ['no declaration', 'export const OTHER = [] as const'],
      ['two declarations', `${decl}\n${decl}`],
      ['a spread', decl.replace(first, `...EXTRA, ${first}`)],
      ['a comment', decl.replace(first, `// note\n  ${first}`)],
      ['a key outside the family', decl.replace(first, "'telegram_chat_id'")],
      ['a duplicate', decl.replace(first, `${first}, ${first}`)],
      ['an upper-case key', decl.replace(first, first.toUpperCase())],
      ['a double-quoted key', decl.replace(first, `"${ALLOW[0]}"`)],
      ['an empty list', 'export const TELEGRAM_TOPIC_KEYS = [\n] as const'],
      ['no as const', decl.replace('] as const', ']')],
    ]) {
      const err = refused(() => mod.topicKeysFromSource(text))
      assert.strictEqual(err.code, 'allow-list-unreadable', label)
    }
    assert.strictEqual(refused(() => mod.loadTopicKeyAllowList(path.join(os.tmpdir(), 'no-such-telegram.ts'))).code, 'allow-list-unreadable')
  })

  const [K1, K2, K3] = ALLOW
  await check('settings input: allow-listed keys with digits-only topic ids are accepted, in the order typed', () => {
    assert.deepStrictEqual(mod.parseSettingsInput(`${K2}=12`, ALLOW), [{ key: K2, value: '12' }])
    const many = mod.parseSettingsInput(`  ${K3}=7, ${K1}=2147483647\t${K2}=1  `, ALLOW)
    assert.deepStrictEqual(many, [{ key: K3, value: '7' }, { key: K1, value: '2147483647' }, { key: K2, value: '1' }])
    const all = mod.parseSettingsInput(ALLOW.map((key, n) => `${key}=${n + 1}`).join(','), ALLOW)
    assert.deepStrictEqual(all.map((p) => p.key), ALLOW)
    assert.strictEqual(mod.MAX_TOPIC_ID, 2147483647)
  })

  await check('settings input: everything else is refused before D1, with a code and the pair number', () => {
    const cases = [
      [undefined, 'settings-input-missing', undefined],
      [12, 'settings-input-missing', undefined],
      ['', 'settings-input-empty', undefined],
      [' \t ', 'settings-input-empty', undefined],
      [' , ', 'settings-input-empty', undefined],
      [`${K1}=1 `.repeat(200), 'settings-input-too-long', undefined],
      [`${K1}=12;`, 'settings-input-invalid-character', undefined],
      [`${K1}=1; DROP TABLE settings`, 'settings-input-invalid-character', undefined],
      [`${K1}=1;DROP TABLE settings`, 'settings-input-invalid-character', undefined],
      [`${K1}='1'`, 'settings-input-invalid-character', undefined],
      [`${K1}="1"`, 'settings-input-invalid-character', undefined],
      [`${K1}=1' OR '1'='1`, 'settings-input-invalid-character', undefined],
      [`${K1}=1--`, 'settings-input-invalid-character', undefined],
      [`${K1}=1/*`, 'settings-input-invalid-character', undefined],
      [`${K1}=-5`, 'settings-input-invalid-character', undefined],
      [`${K1}=1.5`, 'settings-input-invalid-character', undefined],
      [`${K1}=1e3`, 'settings-value-not-digits', 1],
      [`${K1}=0x1f`, 'settings-value-not-digits', 1],
      [`${K1}=0x1F`, 'settings-input-invalid-character', undefined],
      [`${K1}=１２`, 'settings-input-invalid-character', undefined],
      [`${K1}=١٢`, 'settings-input-invalid-character', undefined],
      [`${K1}=12 `, 'settings-input-invalid-character', undefined],
      [`${K1}=1​2`, 'settings-input-invalid-character', undefined],
      [`${K1}=12\n${K2}=3`, 'settings-input-invalid-character', undefined],
      [`${K1.toUpperCase()}=12`, 'settings-input-invalid-character', undefined],
      [`${K1}`, 'settings-pair-malformed', 1],
      [`${K2}=3 =12`, 'settings-pair-malformed', 2],
      ['telegram_topic_nope=1', 'settings-key-not-allowed', 1],
      [`${K1}=1 telegram_chat_id=123`, 'settings-key-not-allowed', 2],
      ['telegram_bot_token=1', 'settings-key-not-allowed', 1],
      [`${K1}=1 ${K1}=2`, 'settings-key-duplicate', 2],
      [`${K1}=`, 'settings-value-empty', 1],
      [`${K2}=3 ${K1}=abc`, 'settings-value-not-digits', 2],
      [`${K1}=12=13`, 'settings-value-not-digits', 1],
      [`${K1}==12`, 'settings-value-not-digits', 1],
      [`${K1}=0`, 'settings-value-zero', 1],
      [`${K1}=000`, 'settings-value-zero', 1],
      [`${K1}=012`, 'settings-value-leading-zero', 1],
      [`${K1}=12345678901`, 'settings-value-too-long', 1],
      [`${K1}=2147483648`, 'settings-value-too-large', 1],
      [`${K1}=9999999999`, 'settings-value-too-large', 1],
    ]
    for (const [input, code, pair] of cases) {
      const err = refused(() => mod.parseSettingsInput(input, ALLOW))
      assert.strictEqual(err.code, code, `${JSON.stringify(input)}: ${err.code}`)
      assert.strictEqual(err.detail && err.detail.pair, pair, `${JSON.stringify(input)}: pair`)
    }
    // The counterexample in the run: every injection value above passes the
    // plausible wrong checks (an unanchored digit test, parseInt), so these
    // fixtures do tell the anchored rule from the loose one.
    for (const value of ['1; DROP TABLE settings', "1' OR '1'='1", '1--', '12;', '12=13', '1e3']) {
      assert.ok(/\d+/.test(value) && Number.isInteger(parseInt(value, 10)), `${value} would not fool a loose check`)
      assert.notStrictEqual(mod.topicIdProblem(value), null, value)
    }
  })

  await check('every accepted topic id is one the Worker stores and sends as that thread id', () => {
    const writeRule = typeof telegram.isTelegramTopicSettingValue === 'function'
      ? telegram.isTelegramTopicSettingValue
      : (raw) => raw === '' || /^\d+$/.test(raw)
    if (typeof telegram.isTelegramTopicSettingValue !== 'function') {
      assert.ok(POST_HANDLER.includes("if (raw !== '' && !/^\\d+$/.test(raw)) {"), 'the route\'s write rule moved; read it from its new home')
    }
    for (const value of ['1', '7', '42', '1000', '999999999', '2147483647']) {
      assert.strictEqual(mod.topicIdProblem(value), null, value)
      assert.ok(writeRule(value), `the Worker would refuse ${value}`)
      assert.strictEqual(telegram.parseTelegramTopicId(value), Number(value), `the Worker would not send ${value} as a thread id`)
    }
    // Why zero is refused although the route stores it: the Worker then sends to General.
    assert.ok(writeRule('0') && telegram.parseTelegramTopicId('0') === undefined)
  })

  await check('the apply input is exactly true or false', () => {
    assert.strictEqual(mod.parseApplyFlag('true'), true)
    assert.strictEqual(mod.parseApplyFlag('false'), false)
    for (const bad of ['True', 'TRUE', '1', 'yes', 'apply', ' true', 'true ', '', undefined, null, true]) {
      assert.strictEqual(refused(() => mod.parseApplyFlag(bad)).code, 'apply-input-invalid', JSON.stringify(bad))
    }
  })

  await check('the settings input comes from the run\'s event payload, never from the environment', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-settings-'))
    try {
      const write = (body) => { const f = path.join(dir, `e${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, body); return f }
      assert.strictEqual(mod.readSettingsInput(write(JSON.stringify({ inputs: { settings: `${K1}=5`, task: 'settings-upsert' } }))), `${K1}=5`)
      assert.strictEqual(mod.readSettingsInput(write(JSON.stringify({ inputs: { settings: '' } }))), '')
      for (const bad of [undefined, '', path.join(dir, 'missing.json'), write('not json'), write('{}'), write('{"inputs":{}}'), write('{"inputs":{"settings":5}}')]) {
        assert.strictEqual(refused(() => mod.readSettingsInput(bad)).code, 'settings-input-missing', String(bad))
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  await check('the state read is one guarded read-only SELECT answering every allow-listed key in order', () => {
    const sql = mod.buildStateSql(ALLOW)
    assert.strictEqual(guard.guardSql(sql).sql, sql, 'the read must already be in the guard\'s canonical form')
    assert.ok(!sql.includes('\n') && !sql.includes('\r'))
    reset(dbO, { settings: { [K1]: '5', [K2]: '', [K3]: null }, settingsVersion: 9 })
    const rows = plain(dbO.db.prepare(sql).all())
    assert.deepStrictEqual(rows.map((r) => r.key), ALLOW)
    const out = JSON.stringify([{ results: rows, success: true, meta: { changes: 0, rows_written: 0, changed_db: false } }])
    const state = mod.interpretState(out, ALLOW)
    assert.ok(state.ok, state.problems.join(','))
    assert.strictEqual(state.settingsVersion, 9)
    assert.deepStrictEqual(state.rows.slice(0, 4), [
      { key: K1, present: true, value: '5', updatedAt: SEED_TS },
      { key: K2, present: true, value: '', updatedAt: SEED_TS },
      { key: K3, present: true, value: null, updatedAt: SEED_TS },
      { key: ALLOW[3], present: false, value: null, updatedAt: null },
    ])
    reset(dbO)
    const empty = mod.interpretState(JSON.stringify([{ results: plain(dbO.db.prepare(sql).all()), success: true, meta: {} }]), ALLOW)
    assert.ok(empty.ok && empty.settingsVersion === null && empty.rows.every((r) => !r.present))
  })

  await check('the state interpreter refuses a malformed, reordered or written answer', () => {
    const good = ALLOW.map((key) => ({ key, present: 0, value: null, updated_at: null, settings_version: null }))
    const out = (rows, meta = {}) => JSON.stringify([{ results: rows, success: true, meta }])
    assert.ok(mod.interpretState(out(good), ALLOW).ok)
    for (const [label, text] of [
      ['not json', 'oops'],
      ['an error', JSON.stringify({ error: { text: 'D1_ERROR' } })],
      ['a write', out(good, { rows_written: 1 })],
      ['a row short', out(good.slice(1))],
      ['reordered', out([good[1], good[0], ...good.slice(2)])],
      ['present not 0/1', out([{ ...good[0], present: 2 }, ...good.slice(1)])],
      ['absent with a value', out([{ ...good[0], value: '5' }, ...good.slice(1)])],
      ['a numeric value', out([{ ...good[0], present: 1, value: 5 }, ...good.slice(1)])],
      ['versions disagree', out([{ ...good[0], settings_version: 3 }, ...good.slice(1)])],
      ['two result sets', JSON.stringify([{ results: good, success: true, meta: {} }, { results: good, success: true, meta: {} }])],
    ]) assert.ok(!mod.interpretState(text, ALLOW).ok, label)
  })

  await check('the upsert is the route\'s own statement (routes/settings.ts POST /, and every other writer of these keys)', () => {
    const upserts = (text) => [...text.matchAll(/`(INSERT INTO settings \(key, value, updated_at\) VALUES \(@key, @value, CURRENT_TIMESTAMP\)[^`]*)`/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim())
    const route = upserts(POST_HANDLER)
    assert.strictEqual(route.length, 1, 'POST / has one generic upsert')
    assert.strictEqual(mod.UPSERT_TEMPLATE, route[0], 'the job\'s upsert is not the route\'s')
    assert.strictEqual(mod.upsertStatement(K1, '12'), route[0].replace('@key', `'${K1}'`).replace('@value', "'12'"))
    // The /settopic writer (lib/telegramTopicSetting.ts), where that lane has landed it.
    const topicWriter = path.join(SRC, 'lib', 'telegramTopicSetting.ts')
    if (fs.existsSync(topicWriter)) {
      assert.deepStrictEqual(upserts(read('cloudflare', 'src', 'lib', 'telegramTopicSetting.ts')), [mod.UPSERT_TEMPLATE])
      notes.push('lib/telegramTopicSetting.ts (/settopic) writes the same upsert')
    } else {
      notes.push('lib/telegramTopicSetting.ts (/settopic) is not on this branch; the route is the only other writer here')
    }
    for (const bad of [['telegram_chat_id', '12'], [K1, "1'"], [K1, '0'], [K1, ''], [`${K1} `, '1']]) {
      assert.throws(() => mod.upsertStatement(...bad), (e) => e instanceof common.OpsError, `upsertStatement(${bad})`)
    }
  })

  await check('the route\'s audit call and version bump are the shape the batch reproduces', () => {
    const once = (needle, label) => assert.strictEqual(POST_HANDLER.split(needle).length - 1, 1, label)
    once("await audit(c.env, user?.id ?? null, actorSnapshot(user), 'update', 'settings', null, { keys: attemptedKeys },", 'audit(): update / settings / null entity id / { keys }')
    once('redact: (key) => isSensitiveSettingKey(key) || isSecretShapedAuditKey(key),', 'the redaction the route applies')
    once("c.executionCtx.waitUntil(bumpVersion(c.env, 'settings'))", 'the settings version bump')
    const auditTs = read('cloudflare', 'src', 'lib', 'audit.ts')
    assert.ok(auditTs.includes(`INSERT INTO audit_logs (${mod.AUDIT_COLUMNS})`), 'audit() writes another column list')
    const cacheTs = read('cloudflare', 'src', 'lib', 'cache.ts')
    assert.ok(/DO UPDATE SET version = MAX\(version \+ 1, @minimumVersion\), updated_at = CURRENT_TIMESTAMP/.test(cacheTs), 'bumpVersion\'s D1 half changed')
    for (const key of ALLOW) {
      assert.ok(!sensitive.isSensitiveSettingKey(key) && !auditMod.isSecretShapedAuditKey(key), `${key} is redacted by the route; the batch records it in clear`)
    }
  })

  // The Worker's own save of the same keys: routes/settings.ts POST / from
  // getSettingsValues() to bumpVersion(), with the real audit(),
  // changedFields(), isSensitiveSettingKey() and bumpVersion().
  const ROUTE_UPSERT = /`(INSERT INTO settings \(key, value, updated_at\) VALUES \(@key, @value, CURRENT_TIMESTAMP\)[^`]*)`/.exec(POST_HANDLER)[1]
  async function workerSave(db, requested, { details, kv }) {
    const env = { DB_COMPAT: db, CACHE: kv }
    const keys = requested.map((r) => r.key)
    const rows = db.prepare('SELECT key, value FROM settings WHERE key IN (SELECT value FROM json_each(@keysJson))').all({ keysJson: JSON.stringify(keys) })
    const before = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    const after = Object.fromEntries(requested.map((r) => [r.key, r.value]))
    await db.batch(requested.map((r) => ({ sql: ROUTE_UPSERT, params: { key: r.key, value: r.value } })))
    await auditMod.audit(env, null, mod.ACTOR, 'update', 'settings', null, details,
      auditMod.changedFields(before, after, { keys, redact: (key) => sensitive.isSensitiveSettingKey(key) || auditMod.isSecretShapedAuditKey(key) }))
    await cacheMod.bumpVersion(env, 'settings')
  }

  const K = (n) => ALLOW[n]
  const FIXTURES = [
    {
      label: 'production today: no topic row, settings version in KV (no D1 row)',
      settings: {},
      settingsVersion: null,
      input: `${K(4)}=34 ${K(1)}=12`,
    },
    {
      label: 'mixed: unchanged, changed, cleared, NULL and absent rows; settings version in D1',
      settings: { [K(1)]: '12', [K(2)]: '5', [K(0)]: '', [K(3)]: null },
      settingsVersion: 41,
      input: `${K(2)}=6, ${K(1)}=12, ${K(0)}=7, ${K(3)}=8, ${K(6)}=9`,
    },
    {
      label: 'hostile stored values: quotes, a statement, CR/LF, non-ASCII, one past the 2048-character summary',
      settings: { [K(1)]: "x'); DROP TABLE settings; --", [K(4)]: 'line1\nline2\r\n"q" ünïcödé 🎉 \\', [K(5)]: 'y'.repeat(3000) },
      settingsVersion: null,
      input: `${K(1)}=1 ${K(4)}=2 ${K(5)}=3`,
    },
  ]

  await check('parity: the batch leaves D1 exactly as the route\'s own save of the same keys does', async () => {
    for (const fx of FIXTURES) {
      const requested = mod.parseSettingsInput(fx.input, ALLOW)
      reset(dbO, fx)
      const { d1 } = fakeD1(guard, dbO)
      const result = await mod.runTask({ apply: true, rawInput: fx.input, allowList: ALLOW, d1, context: CONTEXT })
      assert.ok(result.ok, `${fx.label}: ${result.report.problems}`)
      const ours = snapshot(dbO, mod.TIMESTAMP)

      // The same batch TEXT, parsed by SQLite itself (D1 parses server-side).
      reset(dbO, fx)
      dbO.db.exec('BEGIN')
      dbO.db.exec(result.report.plannedSql)
      dbO.db.exec('COMMIT')
      assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), ours, `${fx.label}: SQLite parses the batch text differently from its statements`)

      reset(dbW, fx)
      const kv = fakeKv()
      await workerSave(dbW, requested, { details: JSON.parse(result.report.audit.details), kv })
      const theirs = snapshot(dbW, mod.TIMESTAMP)
      assert.deepStrictEqual(ours, theirs, `${fx.label}: D1 differs from the route's save`)
      assert.strictEqual(ours.tables, dbO.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n)
      assert.deepStrictEqual(plain(dbO.db.prepare("SELECT key, value, updated_at FROM settings WHERE key NOT LIKE 'telegram_topic_%' ORDER BY key").all()), baseSettings, 'another setting moved')
      if (fx.settingsVersion === null) {
        assert.deepStrictEqual(ours.version, [], 'no D1 version row is created while the version lives in KV')
        assert.deepStrictEqual(kv.puts, [['v2:settings', '1']], 'the Worker bumps KV here -- which a D1 batch cannot reach')
      } else {
        assert.deepStrictEqual(ours.version, [{ version: fx.settingsVersion + 1 }])
        assert.deepStrictEqual(kv.puts, [])
      }
      const row = ours.audit[0]
      assert.strictEqual(ours.audit.length, 1)
      assert.strictEqual(row.user_id, null)
      assert.strictEqual(row.user_name, 'ops:settings-upsert')
      const details = JSON.parse(row.details)
      assert.deepStrictEqual(Object.keys(details)[0], 'keys', 'the route\'s { keys } comes first')
      assert.deepStrictEqual(details.keys, requested.map((r) => r.key))
      assert.strictEqual(details.source, 'ops')
      assert.strictEqual(details.task, 'settings-upsert')
      assert.ok(typeof details.reason === 'string' && details.reason.length > 20, 'AuditLog.tsx shows details.reason')
      assert.strictEqual(details.run_id, CONTEXT.runId)
      assert.strictEqual(details.commit, CONTEXT.commit)
    }
    // Spot-check the two diffs the fixtures exist for.
    reset(dbO, FIXTURES[1])
    const mixed = await mod.runTask({ apply: true, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
    assert.strictEqual(mixed.report.audit.oldValue, JSON.stringify({ [K(2)]: '5', [K(0)]: '', [K(3)]: null, [K(6)]: null }))
    assert.strictEqual(mixed.report.audit.newValue, JSON.stringify({ [K(2)]: '6', [K(0)]: '7', [K(3)]: '8', [K(6)]: '9' }))
    reset(dbO, FIXTURES[2])
    const hostile = await mod.runTask({ apply: true, rawInput: FIXTURES[2].input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
    assert.ok(/\(3000 chars, #[0-9a-f]{8}\)/.test(hostile.report.audit.oldValue), 'a long stored value is summarised as audit() does')
    assert.ok(!hostile.report.plannedSql.includes('\r'), 'a stored CR reached the SQL text raw')
  })

  await check('nothing to change: the route would still write; the job writes nothing and says so', async () => {
    const fx = { settings: { [K(1)]: '12', [K(2)]: '5' }, settingsVersion: 3 }
    reset(dbW, fx)
    await workerSave(dbW, [{ key: K(1), value: '12' }], { details: { keys: [K(1)] }, kv: fakeKv() })
    const theirs = snapshot(dbW, mod.TIMESTAMP)
    assert.strictEqual(theirs.audit[0].old_value, null)
    assert.strictEqual(theirs.audit[0].new_value, null)
    const plan = mod.planChanges([{ key: K(1), value: '12' }], { rows: [{ key: K(1), present: true, value: '12', updatedAt: SEED_TS }] })
    assert.deepStrictEqual(mod.auditChange(plan), null, 'the builder would record NULL diffs, as the route does')
    reset(dbO, fx)
    const before = snapshot(dbO, mod.TIMESTAMP)
    const fake = fakeD1(guard, dbO)
    const result = await mod.runTask({ apply: true, rawInput: `${K(1)}=12`, allowList: ALLOW, d1: fake.d1, context: CONTEXT })
    assert.ok(result.ok)
    assert.strictEqual(result.report.action, 'nothing-to-change')
    assert.strictEqual(fake.calls.length, 1, 'one read, no write')
    assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), before)
  })

  await check('the batch is one LF-only statement list naming only the requested keys and three tables', async () => {
    reset(dbO, FIXTURES[1])
    const result = await mod.runTask({ apply: false, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
    const sql = result.report.plannedSql
    const requested = mod.parseSettingsInput(FIXTURES[1].input, ALLOW)
    assert.ok(!sql.includes('\r') && !sql.includes('\u0000'), 'LF-only, no NUL')
    assert.ok(sql.endsWith(';') && sql.split('\n').length === requested.length + 2, 'one statement per line')
    const statements = splitStatements(guard, sql)
    assert.strictEqual(statements.length, requested.length + 2)
    assert.deepStrictEqual(statements.slice(0, requested.length), requested.map((r) => mod.upsertStatement(r.key, r.value)))
    assert.ok(statements[requested.length].startsWith(`INSERT INTO audit_logs (${mod.AUDIT_COLUMNS}) VALUES (NULL, 'ops:settings-upsert', 'update', 'settings', NULL, '`))
    assert.ok(statements[requested.length].endsWith(') RETURNING id'))
    assert.strictEqual(statements[requested.length + 1], mod.SETTINGS_VERSION_BUMP)
    const code = guard.scanSql(sql).filter((p) => p.type === 'code').map((p) => p.text).join(' ')
    // The upsert's own DO UPDATE clause is not a second write target.
    const CONFLICT = 'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
    assert.strictEqual(code.split(CONFLICT).length - 1, requested.length, 'one conflict clause per upsert')
    const bare = code.split(CONFLICT).join(' ')
    const targets = [...bare.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO|DROP|ALTER|ATTACH|CREATE|PRAGMA)\s+(\w+)?/gi)].map((m) => `${m[1].toUpperCase()} ${m[2] || ''}`.trim())
    assert.deepStrictEqual(targets, [...requested.map(() => 'INSERT INTO settings'), 'INSERT INTO audit_logs', 'UPDATE cache_versions'])
    for (const key of ALLOW.filter((k) => !requested.some((r) => r.key === k))) assert.ok(!sql.includes(key), `${key} was not requested but is in the batch`)
    assert.deepStrictEqual(mod.batchShapeProblems(sql, ALLOW), [])
  })

  await check('the batch is re-verified before it is sent: any other statement, key or literal is refused', async () => {
    reset(dbO, FIXTURES[0])
    const result = await mod.runTask({ apply: false, rawInput: FIXTURES[0].input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
    const sql = result.report.plannedSql
    const lines = sql.split('\n')
    const tampered = [
      ['an extra statement', `${sql}\nDELETE FROM settings;`],
      ['a second statement on a line', sql.replace(mod.SETTINGS_VERSION_BUMP, `${mod.SETTINGS_VERSION_BUMP}; DELETE FROM settings`)],
      ['a key outside the list', sql.replace(`'${K(4)}'`, "'telegram_chat_id'")],
      ['a quote in a value', sql.replace("'34'", "'3''4'")],
      ['a non-digit value', sql.replace("'34'", "'3x'")],
      ['a comment', sql.replace('RETURNING id', 'RETURNING id -- x')],
      ['a CR', sql.replace('\n', '\r\n')],
      ['statements reordered', [lines[1], lines[0], ...lines.slice(2)].join('\n')],
      ['no audit row', [...lines.slice(0, -2), lines[lines.length - 1]].join('\n')],
      ['no version bump', lines.slice(0, -1).join('\n').replace(/RETURNING id$/, 'RETURNING id;')],
      ['another actor', sql.replace("'ops:settings-upsert'", "'admin'")],
      ['a user id', sql.replace("VALUES (NULL, 'ops:settings-upsert'", "VALUES (1, 'ops:settings-upsert'")],
      ['details naming another key', sql.replace(`"keys":["${K(4)}"`, `"keys":["${K(0)}"`)],
      ['a diff naming an unrequested key', sql.replace(`'{"${K(4)}":"34"`, `'{"${K(0)}":"34"`)],
      ['an unterminated literal', sql.replace("'34'", "'34")],
      ['the bump for another namespace', sql.replace("namespace = 'settings'", "namespace = 'sales'")],
    ]
    for (const [label, bad] of tampered) {
      assert.notStrictEqual(bad, sql, `${label}: the tamper did not apply`)
      assert.ok(mod.batchShapeProblems(bad, ALLOW).length > 0, `${label}: accepted`)
    }
  })

  await check('dry run is the default: one read, no write, and the plan and restore input are in the report', async () => {
    reset(dbO, FIXTURES[1])
    const before = snapshot(dbO, mod.TIMESTAMP)
    const fake = fakeD1(guard, dbO)
    const result = await mod.runTask({ apply: false, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fake.d1, context: CONTEXT })
    assert.ok(result.ok, result.report.problems.join(','))
    assert.strictEqual(result.report.action, 'dry-run')
    assert.strictEqual(fake.calls.length, 1, 'a dry run reads once and writes nothing')
    assert.strictEqual(guard.guardSql(fake.calls[0]).sql, fake.calls[0], 'the one call is the guarded read')
    assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), before)
    assert.deepStrictEqual(result.report.plan.map((p) => [p.key, p.before, p.after, p.changed]), [
      [K(2), '5', '6', true], [K(1), '12', '12', false], [K(0), '', '7', true], [K(3), null, '8', true], [K(6), null, '9', true],
    ])
    assert.deepStrictEqual(result.report.restore, {
      settingsInput: `${K(2)}=5`,
      clearInSettings: [K(0), K(3), K(6)],
      notRestorableByThisTask: [],
    })
    assert.ok(result.report.plannedSql.length > 0 && result.report.before.length === ALLOW.length)
    assert.strictEqual(mod.decideAction({ apply: false, plan: result.report.plan }), 'dry-run')
    assert.strictEqual(mod.decideAction({ apply: true, plan: result.report.plan }), 'write')
    assert.strictEqual(mod.decideAction({ apply: true, plan: result.report.plan.map((p) => ({ ...p, changed: false })) }), 'nothing-to-change')
    assert.strictEqual(mod.decideAction({ apply: 'true', plan: result.report.plan }), 'dry-run', 'only a real true applies')
  })

  await check('apply: one batch, then the values and the audit row are read back and match', async () => {
    reset(dbO, FIXTURES[1])
    const fake = fakeD1(guard, dbO)
    const result = await mod.runTask({ apply: true, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fake.d1, context: CONTEXT })
    assert.ok(result.ok, result.report.problems.join(','))
    assert.strictEqual(result.report.action, 'write')
    assert.strictEqual(fake.calls.length, 4, 'read, write, read back, read the audit row')
    assert.strictEqual(fake.calls[1], result.report.plannedSql)
    for (const n of [0, 2, 3]) assert.strictEqual(guard.guardSql(fake.calls[n]).sql, fake.calls[n], `call ${n + 1} is a guarded read`)
    assert.ok(result.report.write.ok && Number.isSafeInteger(result.report.write.auditId))
    assert.ok(result.report.readBack.ok)
    assert.strictEqual(result.report.settingsVersionAfter, 42)
    assert.deepStrictEqual(result.report.after.filter((r) => r.present).map((r) => [r.key, r.value]).sort(), [
      [K(0), '7'], [K(1), '12'], [K(2), '6'], [K(3), '8'], [K(6), '9'],
    ].sort())
    // A second apply finds nothing to change and writes nothing.
    const again = await mod.runTask({ apply: true, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fake.d1, context: CONTEXT })
    assert.ok(again.ok && again.report.action === 'nothing-to-change' && fake.calls.length === 5)
  })

  await check('apply writes the previous values to an encrypted file first; no file, no write', async () => {
    reset(dbO, FIXTURES[1])
    const fake = fakeD1(guard, dbO)
    const seen = []
    const checkpoint = async (report) => {
      seen.push({ calls: fake.calls.length, restore: report.restore, plan: report.plan.map((p) => [p.key, p.before]) })
      return 1234
    }
    const result = await mod.runTask({ apply: true, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fake.d1, context: CONTEXT, checkpoint })
    assert.ok(result.ok, result.report.problems.join(','))
    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0].calls, 1, 'the pre-write file comes after the read and before the write')
    assert.deepStrictEqual(seen[0].restore, { settingsInput: `${K(2)}=5`, clearInSettings: [K(0), K(3), K(6)], notRestorableByThisTask: [] })
    assert.deepStrictEqual(seen[0].plan, [[K(2), '5'], [K(1), '12'], [K(0), ''], [K(3), null], [K(6), null]])
    assert.ok(result.lines.some(([t, v]) => t === 'encrypted pre-write file: {bytes} bytes' && v.bytes === 1234))
    // A dry run, or an apply with nothing to change, writes no pre-write file.
    let extra = 0
    const count = async () => { extra += 1; return 1 }
    reset(dbO, FIXTURES[1])
    await mod.runTask({ apply: false, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT, checkpoint: count })
    await mod.runTask({ apply: true, rawInput: `${K(1)}=12`, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT, checkpoint: count })
    assert.strictEqual(extra, 0)
    // If the file cannot be written, nothing is.
    reset(dbO, FIXTURES[1])
    const before = snapshot(dbO, mod.TIMESTAMP)
    const blocked = fakeD1(guard, dbO)
    await assert.rejects(mod.runTask({
      apply: true, rawInput: FIXTURES[1].input, allowList: ALLOW, d1: blocked.d1, context: CONTEXT,
      checkpoint: async () => { throw new common.OpsError('bad-report-name') },
    }), (e) => e.code === 'bad-report-name')
    assert.strictEqual(blocked.calls.length, 1, 'a failed pre-write file stops the run before the write')
    assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), before)
  })

  await check('apply: any read-back mismatch fails the run', async () => {
    const run = async (fx, hooks) => {
      reset(dbO, fx)
      return mod.runTask({ apply: true, rawInput: fx.input, allowList: ALLOW, d1: fakeD1(guard, dbO, hooks).d1, context: CONTEXT })
    }
    const fx = FIXTURES[1]
    const cases = [
      ['a value did not land', { afterWrite: (db) => db.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('99', K(2)) }, 'readback-value-mismatch'],
      ['another topic key moved', { afterWrite: (db) => db.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(K(5), '1', SEED_TS) }, 'readback-other-key-changed'],
      ['the audit row differs', { afterWrite: (db) => db.db.exec("UPDATE audit_logs SET old_value = '{}'") }, 'readback-audit-mismatch'],
      ['the audit row is gone', { afterWrite: (db) => db.db.exec('DELETE FROM audit_logs') }, 'readback-audit-missing'],
      ['the version did not move', { afterWrite: (db) => db.db.exec("UPDATE cache_versions SET version = 41 WHERE namespace = 'settings'") }, 'readback-settings-version'],
      ['the timestamp is not the route\'s', { afterWrite: (db) => db.db.prepare('UPDATE settings SET updated_at = ? WHERE key = ?').run('2026-09-27T10:00:00.000Z', K(2)) }, 'readback-updated-at-shape'],
    ]
    for (const [label, hooks, code] of cases) {
      const result = await run(fx, hooks)
      assert.ok(!result.ok, `${label}: passed`)
      assert.ok(result.report.problems.includes(code), `${label}: ${result.report.problems}`)
      assert.ok(result.lines.some(([t, v]) => t === 'read-back: {readBack}' && v.readBack === 'FAIL'), label)
    }
  })

  await check('a failed write is reported, read back (nothing half-written), and fails the run', async () => {
    const fx = FIXTURES[1]
    reset(dbO, fx)
    const before = snapshot(dbO, mod.TIMESTAMP)
    const fail = () => ({ code: 1, stdout: JSON.stringify({ error: { text: 'D1_ERROR: network [code: 7500]' } }), stderr: '', timedOut: false })
    const result = await mod.runTask({ apply: true, rawInput: fx.input, allowList: ALLOW, d1: fakeD1(guard, dbO, { beforeWrite: fail }).d1, context: CONTEXT })
    assert.ok(!result.ok)
    assert.ok(result.report.problems.includes('write-wrangler-exit-nonzero'), result.report.problems.join(','))
    assert.ok(result.report.problems.includes('readback-value-mismatch'), 'the read-back shows nothing landed')
    assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), before)
    assert.ok(result.lines.some(([t, v]) => t === 'cloudflare error code: {code}' && v.code === 7500))
    // A statement D1 itself rejects rolls the whole request back.
    reset(dbO, fx)
    dbO.db.exec('CREATE TRIGGER ops_test_refuse BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, \'refused\'); END')
    try {
      const refusedRun = await mod.runTask({ apply: true, rawInput: fx.input, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
      assert.ok(!refusedRun.ok && refusedRun.report.problems.includes('write-wrangler-exit-nonzero'))
      assert.deepStrictEqual(snapshot(dbO, mod.TIMESTAMP), before, 'a refused audit row left settings written')
    } finally {
      dbO.db.exec('DROP TRIGGER ops_test_refuse')
    }
    // Output that is not the expected result sets.
    const build = { statements: ['a', 'b', 'c'], auditIndex: 1 }
    const set = (results = []) => ({ results, success: true, meta: {} })
    assert.ok(mod.interpretApplyOutput(JSON.stringify([set(), set([{ id: 7 }]), set()]), build).ok)
    for (const [label, text] of [
      ['not json', 'nope'],
      ['an error object', JSON.stringify({ error: { text: 'x' } })],
      ['too few sets', JSON.stringify([set(), set([{ id: 7 }])])],
      ['a failed set', JSON.stringify([set(), set([{ id: 7 }]), { ...set(), success: false }])],
      ['no audit id', JSON.stringify([set(), set(), set()])],
      ['a bad audit id', JSON.stringify([set(), set([{ id: '7' }]), set()])],
    ]) assert.ok(!mod.interpretApplyOutput(text, build).ok, label)
  })

  await check('the previous values come back as an input this same task accepts', () => {
    const plan = [
      { key: K(0), present: true, before: '15', after: '16', changed: true },
      { key: K(1), present: false, before: null, after: '3', changed: true },
      { key: K(2), present: true, before: '', after: '4', changed: true },
      { key: K(3), present: true, before: '007', after: '5', changed: true },
      { key: K(4), present: true, before: '9', after: '9', changed: false },
      { key: K(5), present: true, before: null, after: '6', changed: true },
    ]
    const restore = mod.restoreInstructions(plan)
    assert.deepStrictEqual(restore, {
      settingsInput: `${K(0)}=15`,
      clearInSettings: [K(1), K(2), K(5)],
      notRestorableByThisTask: [{ key: K(3), value: '007' }],
    })
    assert.deepStrictEqual(mod.parseSettingsInput(restore.settingsInput, ALLOW), [{ key: K(0), value: '15' }])
  })

  await check('the public log carries counts and PASS/FAIL only, never a key or a value', async () => {
    const distinct = `${K(1)}=987654 ${K(2)}=876543`
    const texts = []
    const render = (lines) => lines.map(([t, v]) => common.formatPublic(t, v)).join('\n')
    reset(dbO, { settings: { [K(1)]: '555111' }, settingsVersion: 2 })
    texts.push(render((await mod.runTask({ apply: false, rawInput: distinct, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })).lines))
    reset(dbO, { settings: { [K(1)]: '555111' }, settingsVersion: 2 })
    const applied = await mod.runTask({ apply: true, rawInput: distinct, allowList: ALLOW, d1: fakeD1(guard, dbO).d1, context: CONTEXT })
    texts.push(render(applied.lines))
    texts.push(render((await mod.runTask({ apply: true, rawInput: `${K(1)}=1 ${K(1)}=987654`, allowList: ALLOW, d1: async () => { throw new Error('no D1 on a refused input') }, context: CONTEXT })).lines))
    const all = texts.join('\n')
    for (const leak of ['987654', '876543', '555111', 'telegram', 'ops:settings', CONTEXT.runId]) assert.ok(!all.includes(leak), `${leak} reached the public log:\n${all}`)
    assert.ok(/apply: yes/.test(texts[1]) && /apply: no/.test(texts[0]))
    assert.ok(/to change: 2; already equal: 0/.test(texts[1]) && /write: PASS/.test(texts[1]) && /read-back: PASS/.test(texts[1]))
    assert.ok(/write: SKIPPED/.test(texts[0]))
    assert.ok(/settings input: FAIL at pair 2/.test(texts[2]) && /problem: settings-key-duplicate/.test(texts[2]))
    assert.ok(applied.ok)
    // The envelope header is cleartext: only public fields go in it.
    const meta = mod.reportMeta({ apply: true, context: CONTEXT, createdAt: '2026-09-27T00:00:00.000Z' })
    assert.deepStrictEqual(Object.keys(meta).sort(), ['commit', 'createdAt', 'kind', 'name', 'runId'])
    assert.deepStrictEqual([meta.kind, meta.name], ['settings-upsert', 'apply'])
    assert.strictEqual(mod.reportName({ apply: false, context: CONTEXT }), `settings-upsert-dry-run-${CONTEXT.runId}`)
  })

  await check('the job reuses the export job\'s D1 plumbing instead of restating it', () => {
    assert.strictEqual(mod.DATABASE, d1export.DATABASE)
    assert.deepStrictEqual(d1export.wranglerArgs('SELECT 1'), ['d1', 'execute', 'business-os', '--remote', '--json', '--command', 'SELECT 1'])
    const text = read('ops', 'scripts', 'ops-settings-upsert.mjs')
    assert.ok(/from '\.\/ops-d1-export\.mjs'/.test(text) && /\bwranglerArgs\(sql\)/.test(text) && /\binterpretD1Output\(/.test(text))
    assert.ok(/from '\.\/ops-sql-guard\.mjs'/.test(text) && /\bguardSql\(/.test(text))
  })

  for (const note of notes) console.log(`note: ${note}`)
  if (process.exitCode) console.error(`test-ops-settings-upsert-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-settings-upsert-pure: ${passed} checks passed`)
}

main().catch((err) => {
  process.exitCode = 1
  console.error(`test-ops-settings-upsert-pure: crashed: ${err && err.stack}`)
})

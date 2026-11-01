'use strict'
// ops/scripts/ops-read-switch.mjs (the read-switch task of .github/workflows/ops.yml), against the real migrations in SQLite.
// The job's D1 is a fake that runs each wrangler command the way D1 does: one transaction per request, a failing statement rolls
// the rest back. Held here: a dry run writes nothing; apply writes the same row the Worker's route writes (compared against the
// Worker's own serializer); the public lines name only switches and states; an unknown name, state or spelling is refused before
// D1 is touched; a swap that matches nothing aborts without an audit row; ON is refused while writes are held, OFF is not.
//
// Run: node scripts/test-ops-read-switch-pure.cjs
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1 } catch (err) { process.exitCode = 1; console.error(`FAIL ${name}\n  ${err && err.message ? err.message.split('\n').join('\n  ') : err}`) }
}

function loadSwitches() {
  const file = path.join(ROOT, 'cloudflare', 'src', 'lib', 'readSwitches.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, (id) => (id === './db' ? { getDb() { throw new Error('no db') } } : id === './analytics' ? { recordAnalytics() {} } : require(id)), mod, file, path.dirname(file))
  return mod.exports
}

function splitStatements(guard, sql) {
  const out = []
  let current = ''
  for (const part of guard.scanSql(sql)) {
    if (part.type !== 'code') { current += part.type === 'string' || part.type === 'ident' ? part.text : ' '; continue }
    const pieces = part.text.split(';')
    current += pieces[0]
    for (const piece of pieces.slice(1)) { out.push(current.trim()); current = piece }
  }
  out.push(current.trim())
  return out.filter(Boolean)
}

function fakeD1(guard, db) {
  const calls = []
  const d1 = async (sql) => {
    calls.push(sql)
    const sets = []
    db.db.exec('BEGIN')
    try {
      for (const statement of splitStatements(guard, sql)) {
        const start = db.db.prepare('SELECT total_changes() AS n').get().n
        const results = db.db.prepare(statement).all().map((row) => ({ ...row }))
        const changes = db.db.prepare('SELECT total_changes() AS n').get().n - start
        sets.push({ results, success: true, meta: { changes, rows_written: changes, rows_read: results.length, duration: 0.1 } })
      }
      db.db.exec('COMMIT')
    } catch (err) {
      db.db.exec('ROLLBACK')
      return { code: 1, stdout: JSON.stringify({ error: { text: String(err.message) } }), stderr: '', timedOut: false }
    }
    return { code: 0, stdout: JSON.stringify(sets), stderr: '', timedOut: false }
  }
  return { d1, calls }
}

async function main() {
  const mod = await load('ops/scripts/ops-read-switch.mjs')
  const common = await load('ops/scripts/ops-common.mjs')
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const worker = loadSwitches()
  const ALLOW = [...worker.KNOWN_READ_SWITCHES]
  const CONTEXT = { runId: '18112233445', commit: 'c5b28762c5b28762c5b28762c5b28762c5b28762' }
  const MIGRATIONS = loadAll()
  const db = openDb(MIGRATIONS)
  const reset = (row) => {
    db.db.exec("DELETE FROM system_flags WHERE key IN ('read_switches', 'maintenance')")
    db.db.exec('DELETE FROM audit_logs')
    if (row !== undefined) db.db.prepare("INSERT INTO system_flags (key, value) VALUES ('read_switches', ?)").run(row)
  }
  const stored = () => db.db.prepare("SELECT value FROM system_flags WHERE key = 'read_switches'").get()?.value ?? null
  const audits = () => db.db.prepare("SELECT user_id, user_name, action, entity, entity_id, details, old_value, new_value FROM audit_logs ORDER BY id").all().map((r) => ({ ...r }))
  const refused = (fn) => { let err; try { fn() } catch (e) { err = e } assert.ok(err instanceof common.OpsError, 'accepted'); return err }
  const run = (input, apply, fake, now) => mod.runTask({ apply, rawInput: input, allowList: ALLOW, d1: fake.d1, context: CONTEXT, now })
  const NOW = () => '2026-11-02T01:00:00.000Z'

  await check('the allow-list is the Worker\'s KNOWN_READ_SWITCHES, read from the source and frozen', () => {
    assert.deepStrictEqual([...mod.loadSwitchNames()], ALLOW)
    assert.ok(Object.isFrozen(mod.loadSwitchNames()))
    refused(() => mod.switchNamesFromSource("export const KNOWN_READ_SWITCHES = ['a', 'a'] as const"))
    refused(() => mod.switchNamesFromSource("export const KNOWN_READ_SWITCHES = [...OTHER, 'a'] as const"))
    refused(() => mod.switchNamesFromSource("export const KNOWN_READ_SWITCHES = ['A'] as const"))
    refused(() => mod.switchNamesFromSource('nothing here'))
  })

  await check('the input: name=state with a known name and an exact state; every other spelling is refused and the error names no input text', () => {
    assert.deepStrictEqual(mod.parseSwitchInput('probe=on', ALLOW), { name: 'probe', token: 'on' })
    assert.deepStrictEqual(mod.parseSwitchInput(' probe=off ', ALLOW), { name: 'probe', token: 'off' })
    assert.deepStrictEqual(mod.parseSwitchInput('probe=shadow:5', ALLOW), { name: 'probe', token: 'shadow:0.1' })
    assert.deepStrictEqual(mod.parseSwitchInput('probe=shadow:0.05', ALLOW), { name: 'probe', token: 'shadow:0.05' })
    for (const bad of ['probe=ON', 'probe=true', 'probe=shadow:0', 'probe=shadow:-1', 'probe=', '=on', 'probe', 'probe=on,probe=off', 'nope=on', 'PROBE=on', 'probe=on;DROP', "probe=on'--", '__proto__=on', 'probe=on\nprobe=off', 'x'.repeat(200), '']) {
      const err = refused(() => mod.parseSwitchInput(bad, ALLOW))
      assert.ok(!JSON.stringify(err).includes('DROP'), 'the error repeats nothing typed')
    }
    refused(() => mod.parseSwitchInput(undefined, ALLOW))
  })

  await check('a dry run reads the row and writes nothing: no write statement is sent, the row and the audit trail are untouched', async () => {
    reset(JSON.stringify({ epoch: 2, set_at: 'x', set_by: 1, switches: { probe: 'off' } }))
    const before = stored()
    const fake = fakeD1(guard, db)
    const result = await run('probe=on', false, fake, NOW)
    assert.strictEqual(result.ok, true, result.report.problems.join(','))
    assert.strictEqual(fake.calls.length, 1, 'one read, no write')
    assert.ok(/^SELECT value FROM system_flags/.test(fake.calls[0]))
    assert.strictEqual(stored(), before)
    assert.deepStrictEqual(audits(), [])
    assert.deepStrictEqual(result.report.plan, { from: 'off', to: 'on', epochAfter: 3 })
    assert.strictEqual(result.report.action, 'dry-run')
  })

  await check('apply writes the Worker\'s row byte for byte, one audit row, epoch + 1, and reads both back', async () => {
    reset(JSON.stringify({ epoch: 2, set_at: 'x', set_by: 1, switches: { probe: 'off', future_slice: 'on' } }))
    const previous = stored()
    const fake = fakeD1(guard, db)
    const result = await run('probe=on', true, fake, NOW)
    assert.strictEqual(result.ok, true, result.report.problems.join(','))
    const expected = worker.serializeReadSwitches(previous, { name: 'probe', entry: { state: 'on', rate: 0 } }, { epoch: 3, setAt: NOW(), setBy: 0 })
    assert.strictEqual(stored(), expected, 'the ops row equals what lib/readSwitches.ts serializes')
    assert.strictEqual(JSON.parse(stored()).switches.future_slice, 'on', 'a token of a newer build is carried over')
    const rows = audits()
    assert.strictEqual(rows.length, 1)
    assert.deepStrictEqual([rows[0].user_id, rows[0].user_name, rows[0].action, rows[0].entity, rows[0].entity_id], [null, 'ops:read-switch', 'read_switch_set', 'read_switch', 'probe'])
    assert.deepStrictEqual(JSON.parse(rows[0].details), { name: 'probe', from: 'off', to: 'on', epochBefore: 2, epochAfter: 3, source: 'ops', task: 'read-switch', run_id: CONTEXT.runId, commit: CONTEXT.commit })
    assert.deepStrictEqual([JSON.parse(rows[0].old_value), JSON.parse(rows[0].new_value)], [{ state: 'off', epoch: 2 }, { state: 'on', epoch: 3 }])
    assert.strictEqual(fake.calls.length, 3, 'read, one batch, read back')
    assert.ok(fake.calls[1].split('\n').every((line) => line.endsWith(';')), 'one statement per LF-only line')
    assert.ok(!fake.calls[1].includes('\r'))
  })

  await check('the ops serializer and the Worker\'s agree on a matrix of stored rows (parity)', () => {
    const rows = [null, '', 'garbage', '[]', '{}', '{"epoch":3.5,"switches":{"probe":"on"}}', '{"epoch":4,"switches":{"probe":"shadow:0.5","future":"on","Bad Name":"on"}}', '{"epoch":-1,"switches":null}', JSON.stringify({ epoch: 9, set_at: 'a', set_by: 2, switches: { probe: 'on' } })]
    for (const raw of rows) {
      for (const token of ['on', 'off', 'shadow:0.05']) {
        const ops = mod.nextValue(raw, ALLOW, { name: 'probe', token }, NOW())
        const entry = worker.parseFlipState(token)
        const theirs = worker.serializeReadSwitches(raw, { name: 'probe', entry }, { epoch: worker.parseReadSwitches(raw).epoch + 1, setAt: NOW(), setBy: 0 })
        assert.strictEqual(ops, theirs, String(raw))
      }
      assert.strictEqual(mod.epochOf(raw), worker.parseReadSwitches(raw).epoch)
      assert.strictEqual(mod.tokenIn(raw, 'probe'), worker.formatSwitchToken(worker.parseReadSwitches(raw).switches.probe))
    }
  })

  await check('no row, an unreadable row and a row from a racing writer: first flip creates epoch 1; garbage is replaced; a changed row aborts with no audit row', async () => {
    reset()
    const created = await run('probe=on', true, fakeD1(guard, db), NOW)
    assert.strictEqual(created.ok, true, created.report.problems.join(','))
    assert.strictEqual(JSON.parse(stored()).epoch, 1)
    reset('garbage {')
    const healed = await run('probe=on', true, fakeD1(guard, db), NOW)
    assert.strictEqual(healed.ok, true, healed.report.problems.join(','))
    assert.strictEqual(JSON.parse(stored()).epoch, 1)
    reset(JSON.stringify({ epoch: 2, switches: { probe: 'off' } }))
    const fake = fakeD1(guard, db)
    const racing = { d1: async (sql) => { if (/^INSERT INTO system_flags/.test(sql)) db.db.prepare("UPDATE system_flags SET value = ? WHERE key = 'read_switches'").run(JSON.stringify({ epoch: 3, switches: { probe: 'shadow:0.05' } })); return fake.d1(sql) } }
    const lost = await mod.runTask({ apply: true, rawInput: 'probe=on', allowList: ALLOW, d1: racing.d1, context: CONTEXT, now: NOW })
    assert.strictEqual(lost.ok, false)
    assert.ok(lost.report.problems.includes('write-wrangler-exit-nonzero'))
    assert.strictEqual(JSON.parse(stored()).epoch, 3, 'the racing writer\'s row stands')
    assert.deepStrictEqual(audits(), [], 'the aborted batch left no audit row')
  })

  await check('writes held (maintenance): OFF is applied, ON is refused and writes nothing', async () => {
    reset(JSON.stringify({ epoch: 1, switches: { probe: 'on' } }))
    db.db.prepare("INSERT OR REPLACE INTO system_flags (key, value) VALUES ('stock_transaction_permit', (SELECT value FROM system_flags WHERE key = 'stock_schema_epoch'))").run()
    db.db.prepare("INSERT INTO system_flags (key, value) VALUES ('maintenance', ?)").run(JSON.stringify({ mode: 'restore', token: 't', backupKey: 'k', startedAt: '2026-01-01T00:00:00.000Z', startedBy: 'x', phase: 'deleting', updatedAt: '2026-01-01T00:00:00.000Z' }))
    const off = await run('probe=off', true, fakeD1(guard, db), NOW)
    assert.strictEqual(off.ok, true, off.report.problems.join(','))
    assert.strictEqual(JSON.parse(stored()).switches.probe, 'off')
    const on = await run('probe=on', true, fakeD1(guard, db), NOW)
    assert.strictEqual(on.ok, false)
    assert.strictEqual(JSON.parse(stored()).switches.probe, 'off', 'ON changed nothing while writes are held')
    assert.strictEqual(audits().length, 1, 'only the OFF flip is recorded')
    db.db.exec("DELETE FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit')")
  })

  await check('already in the requested state: nothing is written even with apply', async () => {
    reset(JSON.stringify({ epoch: 5, switches: { probe: 'on' } }))
    const fake = fakeD1(guard, db)
    const result = await run('probe=on', true, fake, NOW)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.report.action, 'nothing-to-change')
    assert.strictEqual(fake.calls.length, 1)
    assert.deepStrictEqual(audits(), [])
  })

  await check('bad input is refused before D1 is touched', async () => {
    const fake = fakeD1(guard, db)
    const result = await run('nope=on', true, fake, NOW)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(fake.calls.length, 0)
    assert.ok(result.report.problems.includes('switch-name-not-allowed'))
  })

  await check('the public lines hold only the switch name, states, epochs, PASS/FAIL and codes: never a raw row, token or id', async () => {
    reset(JSON.stringify({ epoch: 2, set_at: 'SECRETTIME', set_by: 77, switches: { probe: 'off', future_slice: 'on' } }))
    const result = await run('probe=on', true, fakeD1(guard, db), NOW)
    const text = result.lines.map(([template, values]) => common.formatPublic ? common.formatPublic(template, values) : template.replace(/\{(\w+)\}/g, (_, k) => String(values[k]))).join('\n')
    for (const leak of ['SECRETTIME', '77', 'future_slice', 'epoch":', 'set_by', 'INSERT', 'system_flags']) assert.ok(!text.includes(leak), `the public log leaks ${leak}: ${text}`)
    assert.ok(/probe/.test(text) && /on/.test(text))
  })

  await check('workflow shape: the task exists, takes the switch from the event payload, never from an expression', () => {
    const yml = read('.github', 'workflows', 'ops.yml')
    assert.ok(/^ {2}read-switch:$/m.test(yml))
    assert.ok(/inputs\.task == 'read-switch'/.test(yml))
    assert.ok(!/inputs\.switch/.test(yml.replace(/#.*$/gm, '')), 'the switch input is read from the payload, not interpolated')
    assert.ok(/node ops\/scripts\/ops-read-switch\.mjs/.test(yml))
  })

  if (process.exitCode) console.error(`test-ops-read-switch-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-read-switch-pure: ${passed} checks passed`)
}

main().catch((e) => { console.error(`test-ops-read-switch-pure: crashed: ${e && e.stack}`); process.exitCode = 1 })

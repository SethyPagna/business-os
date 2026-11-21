// G38 S3b, T-B7: migration 0322 and the Telegram sign-in statements on workerd's own D1 binding (Miniflare), not node:sqlite.
//
// What it pins: the chain through 0321 applies through the binding; 0322 applies on an empty database and on a database
// holding accounts (one closed with a phone) in one batch; D1 applies INTEGER affinity before the typeof CHECKs when a JS
// number is bound; the close trigger clears phone and Telegram id.
// What it records (no assertion on the numbers): meta.rows_written and meta.rows_read for the migration and for the member INSERT
// (S-J2), the ticket INSERT (S-C3), the pending insert and update (S-P1), the claim (S-C1), the hourly stamp (S-S2) and a close
// with the trigger, written to scripts/harness/portal_telegram_rows_measured.json. The lead corrects section 9 from them.
//
// Run (under the native-tests lock): node scripts/test-portal-telegram-schema-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Miniflare } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const migrations = path.join(__dirname, '../migrations')
const TARGET = '0322_portal_telegram_lean.sql'
const OUT = path.join(__dirname, 'harness', 'portal_telegram_rows_measured.json')
const NOW = '2026-11-21T01:02:03.456Z'
const LATER = '2026-11-21T02:03:04.567Z'
const TICKET = `tg1:${'a'.repeat(64)}`
const TICKET_2 = `tg1:${'b'.repeat(64)}`
const SESSION_HASH = 'c'.repeat(64)

const statementsOf = (file) => split(fs.readFileSync(path.join(migrations, file), 'utf8')).filter((s) => s.trim())
  .filter((s) => !(file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(s.trim())))

async function applyChain(db, files) {
  const all = files.flatMap((file) => statementsOf(file).map((statement) => ({ file, statement })))
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100)
    try { await db.batch(chunk.map((x) => db.prepare(x.statement))) } catch (error) { error.message = `${chunk[0].file}+: ${error.message}`; throw error }
  }
}

const figure = (meta) => ({ rows_written: meta.rows_written, rows_read: meta.rows_read, changes: meta.changes })

async function run(db, label, sql, ...binds) {
  const result = await db.prepare(sql).bind(...binds).run()
  return { label, ...figure(result.meta) }
}

const S_J2 = `INSERT INTO portal_accounts (name, phone, member_code, status, link_version, telegram_user_id, telegram_verified_at,
  consent_version, consent_at, consent_locale, age_confirmed_at, created_at, updated_at, last_seen_at)
SELECT 'Synthetic Join', ?1, ?2, 'active', 0, ?3, ?4, 'test-consent', ?4, 'en', ?4, ?4, ?4, ?4
WHERE (SELECT COUNT(*) FROM (SELECT created_at FROM portal_accounts ORDER BY id DESC LIMIT ?5) WHERE datetime(created_at) > datetime(?4, ?6)) < ?5
  AND NOT EXISTS (SELECT 1 FROM portal_accounts WHERE phone = ?1)
  AND NOT EXISTS (SELECT 1 FROM portal_accounts WHERE telegram_user_id = ?3)
  AND NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = ?7)`

const S_C3 = `INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at)
SELECT a.id, ?1, ?2, ?3, ?3 FROM portal_accounts a
WHERE a.telegram_user_id = ?4 AND a.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM portal_sessions WHERE token_hash = ?1)
  AND (SELECT COUNT(*) FROM (SELECT 1 FROM portal_sessions s WHERE s.account_id = a.id AND datetime(s.created_at) > datetime(?3, ?5) LIMIT ?6)) < ?6`

const S_P1 = `INSERT INTO portal_telegram_pending (id, ticket_hash, flags, attempts, window_started_at, created_at, expires_at)
VALUES (?1, ?2, ?3, 1, ?4, ?4, ?5)
ON CONFLICT(id) DO UPDATE SET
  ticket_hash = excluded.ticket_hash, flags = excluded.flags, created_at = excluded.created_at, expires_at = excluded.expires_at,
  attempts = CASE WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(?4, ?6) THEN 1 ELSE portal_telegram_pending.attempts + 1 END,
  window_started_at = CASE WHEN datetime(portal_telegram_pending.window_started_at) <= datetime(?4, ?6) THEN ?4 ELSE portal_telegram_pending.window_started_at END
WHERE datetime(portal_telegram_pending.window_started_at) <= datetime(?4, ?6) OR portal_telegram_pending.attempts < ?7`

const S_C1 = `UPDATE portal_sessions SET token_hash = ?1, expires_at = ?2, last_seen_at = ?3
WHERE token_hash = ?4 AND revoked_at IS NULL AND datetime(expires_at) > datetime(?3)
  AND EXISTS (SELECT 1 FROM portal_accounts a WHERE a.id = portal_sessions.account_id AND a.status = 'active')
RETURNING account_id`

const S_S2 = `UPDATE portal_sessions SET last_seen_at = ?1
WHERE token_hash = ?2 AND substr(token_hash, 1, 4) <> 'tg1:' AND revoked_at IS NULL AND datetime(expires_at) > datetime(?1)
  AND (last_seen_at IS NULL OR datetime(last_seen_at) < datetime(?1, ?3))`

async function main() {
  const names = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()
  assert.ok(names.includes(TARGET))
  const before = names.filter((f) => f < TARGET)
  const target = statementsOf(TARGET)
  assert.equal(target.length, 5, 'N3 is five statements')

  const mf = new Miniflare({ modules: true, script: '', d1Databases: ['EMPTY', 'FIXTURE'] })
  const measured = { migration: {}, statements: [], notes: {} }
  try {
    const empty = await mf.getD1Database('EMPTY')
    const fixture = await mf.getD1Database('FIXTURE')
    await applyChain(empty, before)
    await applyChain(fixture, before)

    await fixture.batch([
      fixture.prepare("INSERT INTO portal_accounts (id, name, phone, member_code, status, created_at, updated_at) VALUES (1, 'Synthetic One', '012000001', 'W-7KQ4-M9XD', 'active', '2026-10-01 08:00:00', '2026-10-01 08:00:00')"),
      fixture.prepare("INSERT INTO portal_accounts (id, name, phone, member_code, status, created_at, updated_at) VALUES (2, 'Synthetic Closed', '012000002', 'W-7KQ4-M9XE', 'closed', '2026-10-02 08:00:00', '2026-10-02 08:00:00')"),
      fixture.prepare("INSERT INTO portal_accounts (id, name, phone, member_code, status, created_at, updated_at) VALUES (3, 'Synthetic Three', '012000003', 'W-7KQ4-M9XF', 'active', '2026-10-03 08:00:00', '2026-10-03 08:00:00')"),
    ])
    assert.equal((await fixture.prepare("SELECT COUNT(*) n FROM portal_accounts WHERE status = 'closed' AND phone IS NOT NULL").first()).n, 1, 'fixture: the closed-with-a-phone count is 1')

    for (const [label, db] of [['empty', empty], ['fixture', fixture]]) {
      const results = await db.batch(target.map((s) => db.prepare(s)))
      measured.migration[label] = {
        per_statement: results.map((r) => figure(r.meta)),
        rows_written_total: results.reduce((a, r) => a + (r.meta.rows_written || 0), 0),
        rows_read_total: results.reduce((a, r) => a + (r.meta.rows_read || 0), 0),
      }
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('portal_telegram_pending', 'idx_portal_accounts_telegram', 'portal_accounts_close_clears_identity')").first()).n, 3)
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM pragma_table_info('portal_accounts')").first()).n, 23)
    }
    assert.equal((await fixture.prepare('SELECT COUNT(*) n FROM portal_accounts').first()).n, 3)
    assert.equal((await fixture.prepare("SELECT phone FROM portal_accounts WHERE id = 2").first()).phone, '012000002', 'the trigger acts only on future UPDATEs')

    const db = fixture

    // T-B1 and T-B3 on workerd: what a bound JS number and text become before the typeof CHECKs.
    const accept = async (value, id) => {
      try { await db.prepare('INSERT INTO portal_accounts (name, telegram_user_id) VALUES (?1, ?2)').bind(`probe ${id}`, value).run(); return 'accepted' } catch (error) { return /CHECK/.test(String(error.message)) ? 'refused (CHECK)' : `error: ${error.message}` }
    }
    measured.notes.telegram_user_id_binding = {
      js_number_777: await accept(777, 'n777'),
      js_number_0: await accept(0, 'n0'),
      js_number_minus_1: await accept(-1, 'nm1'),
      js_number_2_pow_52: await accept(2 ** 52, 'p52'),
      js_number_2_pow_52_minus_1: await accept(2 ** 52 - 1, 'p52m1'),
      js_number_5_5: await accept(5.5, 'f55'),
      text_5: await accept('5', 't5'),
      text_x5: await accept('x5', 'tx5'),
    }
    assert.equal(measured.notes.telegram_user_id_binding.js_number_777, 'accepted', 'a bound JS integer passes the typeof CHECK')
    for (const refused of ['js_number_0', 'js_number_minus_1', 'js_number_2_pow_52', 'js_number_5_5', 'text_x5']) assert.equal(measured.notes.telegram_user_id_binding[refused], 'refused (CHECK)', refused)
    assert.equal(measured.notes.telegram_user_id_binding.js_number_2_pow_52_minus_1, 'accepted')
    await db.prepare("DELETE FROM portal_accounts WHERE name LIKE 'probe %'").run()

    try { measured.notes.recursive_triggers = (await db.prepare('PRAGMA recursive_triggers').first()) } catch (error) { measured.notes.recursive_triggers = `not measured: ${error.message}` }

    // The statements. Ids are far from the fixture's so each insert is a clean new row.
    const S = measured.statements
    const win = '-3600 seconds'
    S.push(await run(db, 'S-J2 member INSERT (new shopper)', S_J2, '012111111', 'W-7KQ4-M9Y0', 111, NOW, 30, win, TICKET))
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM portal_accounts WHERE telegram_user_id = 111').first()).n, 1, 'S-J2 inserted the member')
    S.push(await run(db, 'S-C3 ticket INSERT (member 111)', S_C3, TICKET, LATER, NOW, 111, '-86400 seconds', 10))
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM portal_sessions WHERE token_hash = ?').bind(TICKET).first()).n, 1)
    S.push(await run(db, 'S-P1 pending INSERT (first start)', S_P1, 222, TICKET_2, 0, NOW, LATER, '-900 seconds', 5))
    S.push(await run(db, 'S-P1 pending UPDATE (second start, same window)', S_P1, 222, TICKET_2, 0, NOW, LATER, '-900 seconds', 5))
    assert.equal((await db.prepare('SELECT attempts FROM portal_telegram_pending WHERE id = 222').first()).attempts, 2)
    S.push(await run(db, 'S-C1 claim (ticket becomes a session)', S_C1, SESSION_HASH, '2026-12-21T01:02:03.456Z', NOW, TICKET))
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM portal_sessions WHERE token_hash = ?').bind(SESSION_HASH).first()).n, 1)
    S.push(await run(db, 'S-S2 hourly stamp (due)', S_S2, '2026-11-21T03:04:05.678Z', SESSION_HASH, '-3600 seconds'))

    await db.prepare("INSERT INTO portal_accounts (id, name, phone, status, telegram_user_id, telegram_verified_at, created_at, updated_at) VALUES (901, 'Close A', '012900901', 'active', 901, ?1, ?1, ?1)").bind(NOW).run()
    S.push(await run(db, 'close, outer UPDATE sets status only (trigger fires)', "UPDATE portal_accounts SET status = 'closed', closed_at = ?1 WHERE id = 901", NOW))
    assert.deepEqual({ ...(await db.prepare('SELECT phone, telegram_user_id, telegram_verified_at FROM portal_accounts WHERE id = 901').first()) }, { phone: null, telegram_user_id: null, telegram_verified_at: NOW }, 'the trigger cleared phone and Telegram id on workerd')
    await db.prepare("INSERT INTO portal_accounts (id, name, phone, status, telegram_user_id, telegram_verified_at, created_at, updated_at) VALUES (902, 'Close B', '012900902', 'active', 902, ?1, ?1, ?1)").bind(NOW).run()
    S.push(await run(db, 'close, outer UPDATE also clears phone and Telegram id (trigger WHEN false)', "UPDATE portal_accounts SET status = 'closed', closed_at = ?1, phone = NULL, telegram_user_id = NULL WHERE id = 902", NOW))

    for (const row of S) for (const key of ['rows_written', 'rows_read']) assert.equal(typeof row[key], 'number', `${row.label}: ${key} recorded`)
  } finally { await mf.dispose() }
  fs.writeFileSync(OUT, `${JSON.stringify(measured, null, 2)}\n`)
  console.log('PASS 0322 applies on workerd D1 (empty and with accounts); bound integers pass the typeof CHECK; the trigger clears on close')
  console.log(JSON.stringify(measured, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

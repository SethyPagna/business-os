'use strict'
// GET/PUT /api/runtime/read-switches against the REAL Worker under Miniflare (every middleware, the real migrations).
// Only the built-in administrator may read or flip; a flip is one compare-and-swap on the stored row plus its audit row, in one
// batch; the epoch rises by exactly 1; an OFF flip works while writes are held and an ON flip does not; and a crafted body is
// refused or clamped. Fault-injects the audit insert with a trigger to prove the flag and its record commit together.
//
// Run (from cloudflare/): node scripts/test-read-switches-route-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const MAINTENANCE_STATE = JSON.stringify({
  mode: 'restore', token: 'test-token', backupKey: 'test-key', startedAt: '2026-01-01T00:00:00.000Z',
  startedBy: 'test', phase: 'deleting', updatedAt: '2026-01-01T00:00:00.000Z',
})

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  const URL = '/api/runtime/read-switches'
  const stored = async () => (await world.first("SELECT value FROM system_flags WHERE key = 'read_switches'"))?.value ?? null
  const audits = async () => world.query("SELECT user_id, action, entity, entity_id, details, old_value, new_value FROM audit_logs WHERE action = 'read_switch_set' ORDER BY id")
  const flagKeys = async () => (await world.query('SELECT key FROM system_flags ORDER BY key')).map((r) => r.key)

  try {
    await world.account('manager', { roleCode: 'sv_manager', permissions: { settings: true, backup: true, backup_restore: true, users: true } })
    await world.account('cashier', { roleCode: 'employee' })

    await check('before anything consults a switch: no X-BOS-Switches header and no read_switches row (the deployed state)', async (t) => {
      const r = await world.api('GET', '/api/runtime/version')
      t.eq('version status', r.status, 200)
      t.eq('no header yet', r.headers.get('x-bos-switches'), null)
      t.eq('no row', await stored(), null)
    })

    await check('only the administrator control user may read or flip: manager, cashier and anonymous are refused, and nothing is written', async (t) => {
      for (const as of ['manager', 'cashier']) {
        const g = await world.api('GET', URL, undefined, { as })
        t.eq(`${as} GET status`, g.status, 403)
        t.eq(`${as} GET code`, g.json && g.json.code, 'forbidden')
        const p = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 0 }, { as })
        t.eq(`${as} PUT status`, p.status, 403)
      }
      const anon = await world.mf.dispatchFetch(`http://localhost${URL}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'probe', state: 'on', expectedEpoch: 0 }) })
      t.eq('anonymous PUT status', anon.status, 401)
      t.eq('no row written', await stored(), null)
      t.eq('no audit row', (await audits()).length, 0)
    })

    await check('the admin read lists every known switch OFF at epoch 0 when there is no row, and shows the header it just primed', async (t) => {
      const r = await world.api('GET', URL)
      t.eq('status', r.status, 200)
      // memoSeconds is the plan's window (planTier.ts readSwitchMemoSeconds); this world runs PLAN_TIER=paid, so 5. Free (15) is pinned in test-plan-tier-pure.
      t.eq('body', r.json && { epoch: r.json.epoch, setAt: r.json.setAt, setBy: r.json.setBy, switches: r.json.switches, memoSeconds: r.json.memoSeconds }, { epoch: 0, setAt: null, setBy: null, switches: [{ name: 'probe', state: 'off', rate: 0 }], memoSeconds: 5 })
      t.eq('header', r.headers.get('x-bos-switches'), 'e=0;probe=0')
      t.eq('a read writes nothing', await stored(), null)
    })

    await check('crafted bodies are refused with 400 and write nothing: unknown name, bad states, bad epochs, extra fields, non-objects', async (t) => {
      const cases = [
        ['unknown name', { name: 'nope', state: 'on', expectedEpoch: 0 }, 'read_switch_unknown'],
        ['name case', { name: 'PROBE', state: 'on', expectedEpoch: 0 }, 'read_switch_unknown'],
        ['name proto', { name: '__proto__', state: 'on', expectedEpoch: 0 }, 'read_switch_unknown'],
        ['state ON', { name: 'probe', state: 'ON', expectedEpoch: 0 }, 'read_switch_state'],
        ['state true', { name: 'probe', state: true, expectedEpoch: 0 }, 'read_switch_state'],
        ['state shadow:0', { name: 'probe', state: 'shadow:0', expectedEpoch: 0 }, 'read_switch_state'],
        ['state shadow:-1', { name: 'probe', state: 'shadow:-1', expectedEpoch: 0 }, 'read_switch_state'],
        ['state observe', { name: 'probe', state: 'observe', expectedEpoch: 0 }, 'read_switch_state'],
        ['state missing', { name: 'probe', expectedEpoch: 0 }, 'read_switch_state'],
        ['epoch missing', { name: 'probe', state: 'on' }, 'read_switch_epoch'],
        ['epoch fraction', { name: 'probe', state: 'on', expectedEpoch: 0.5 }, 'read_switch_epoch'],
        ['epoch string', { name: 'probe', state: 'on', expectedEpoch: '0' }, 'read_switch_epoch'],
        ['epoch negative', { name: 'probe', state: 'on', expectedEpoch: -1 }, 'read_switch_epoch'],
        ['extra field', { name: 'probe', state: 'on', expectedEpoch: 0, setBy: 1 }, 'read_switch_body'],
        ['extra epoch field', { name: 'probe', state: 'on', expectedEpoch: 0, epoch: 99 }, 'read_switch_body'],
        ['array body', [], 'read_switch_body'],
        ['null body', null, 'read_switch_body'],
      ]
      for (const [label, body, code] of cases) {
        const r = await world.api('PUT', URL, body)
        t.eq(`${label}: status`, r.status, 400)
        t.eq(`${label}: code`, r.json && r.json.code, code)
      }
      const notJson = await world.mf.dispatchFetch(`http://localhost${URL}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: `bos_session=${world.tokens.admin}` }, body: '{not json' })
      t.eq('not JSON: status', notJson.status, 400)
      t.eq('no row written', await stored(), null)
      t.eq('no audit row', (await audits()).length, 0)
    })

    await check('a stale expectedEpoch is 409 with the current epoch, and writes nothing', async (t) => {
      const r = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 5 })
      t.eq('status', r.status, 409)
      t.eq('code', r.json && r.json.code, 'read_switch_epoch_stale')
      t.eq('current epoch', r.json && r.json.epoch, 0)
      t.eq('no row', await stored(), null)
    })

    await check('a flip writes the row and its audit row together; the epoch rises by exactly 1; the response header follows', async (t) => {
      const on = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 0 })
      t.eq('status', on.status, 200)
      t.eq('changed', on.json && on.json.changed, true)
      t.eq('epoch 1', on.json && on.json.epoch, 1)
      t.eq('listing', on.json && on.json.switches, [{ name: 'probe', state: 'on', rate: 0 }])
      t.eq('setBy is the admin', on.json && on.json.setBy, world.adminId)
      t.eq('PUT header', on.headers.get('x-bos-switches'), 'e=1;probe=1')
      const row = JSON.parse(await stored())
      t.eq('stored row', { epoch: row.epoch, set_by: row.set_by, switches: row.switches }, { epoch: 1, set_by: world.adminId, switches: { probe: 'on' } })
      const rows = await audits()
      t.eq('one audit row', rows.length, 1)
      const a = rows[0] || {}
      t.eq('audit actor/entity', [a.user_id, a.action, a.entity, a.entity_id], [world.adminId, 'read_switch_set', 'read_switch', 'probe'])
      t.eq('audit details name states and epochs only', JSON.parse(a.details || '{}'), { name: 'probe', from: 'off', to: 'on', epochBefore: 0, epochAfter: 1 })
      t.eq('audit old/new', [JSON.parse(a.old_value || '{}'), JSON.parse(a.new_value || '{}')], [{ state: 'off', epoch: 0 }, { state: 'on', epoch: 1 }])
      const version = await world.api('GET', '/api/runtime/version')
      t.eq('another route shows the header within the memo period', version.headers.get('x-bos-switches'), 'e=1;probe=1')
    })

    await check('the same state again is a no-op: 200 changed:false, no new epoch, no second audit row', async (t) => {
      const r = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 1 })
      t.eq('status', r.status, 200)
      t.eq('changed', r.json && r.json.changed, false)
      t.eq('epoch unchanged', r.json && r.json.epoch, 1)
      t.eq('audit rows', (await audits()).length, 1)
    })

    await check('off then on again: epoch 2 then 3, an audit row each; shadow:5 is clamped to 0.1', async (t) => {
      const off = await world.api('PUT', URL, { name: 'probe', state: 'off', expectedEpoch: 1 })
      t.eq('off epoch', off.json && off.json.epoch, 2)
      t.eq('off header', off.headers.get('x-bos-switches'), 'e=2;probe=0')
      const shadow = await world.api('PUT', URL, { name: 'probe', state: 'shadow:5', expectedEpoch: 2 })
      t.eq('shadow status', shadow.status, 200)
      t.eq('shadow clamped', shadow.json && shadow.json.switches, [{ name: 'probe', state: 'shadow', rate: 0.1 }])
      t.eq('shadow header (shadow is not ON for a client)', shadow.headers.get('x-bos-switches'), 'e=3;probe=0')
      const on = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 3 })
      t.eq('on epoch', on.json && on.json.epoch, 4)
      t.eq('four audit rows', (await audits()).map((r) => JSON.parse(r.details).to), ['on', 'off', 'shadow:0.1', 'on'])
    })

    await check('two admins racing one epoch: exactly one flip wins, the other gets 409, one audit row for the pair', async (t) => {
      const before = (await audits()).length
      const results = await Promise.all([
        world.api('PUT', URL, { name: 'probe', state: 'off', expectedEpoch: 4 }),
        world.api('PUT', URL, { name: 'probe', state: 'shadow:0.05', expectedEpoch: 4 }),
      ])
      t.eq('statuses', results.map((r) => r.status).sort(), [200, 409])
      t.eq('one more audit row', (await audits()).length, before + 1)
      t.eq('epoch advanced by exactly one', JSON.parse(await stored()).epoch, 5)
    })

    await check('a failing audit insert rolls the flag back: the row is byte for byte what it was and no audit row exists for the flip', async (t) => {
      const before = await stored()
      const count = (await audits()).length
      await world.run("CREATE TRIGGER fault_read_switch_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'read_switch_set' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END")
      try {
        const r = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 5 })
        t.ok('the request failed', r.status >= 500, r.status)
        t.eq('the flag row is unchanged', await stored(), before)
        t.eq('no audit row', (await audits()).length, count)
      } finally { await world.run('DROP TRIGGER fault_read_switch_audit') }
      const retry = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 5 })
      t.eq('after the fault is gone the same flip succeeds', [retry.status, retry.json && retry.json.epoch], [200, 6])
    })

    await check('writes held (restore maintenance): an OFF flip succeeds, an ON flip is refused 503 and changes nothing, an ordinary write is refused (control)', async (t) => {
      await world.run("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
      await world.run('INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 'maintenance', MAINTENANCE_STATE)
      try {
        const control = await world.api('POST', '/api/customers', { name: 'Maintenance probe' })
        t.eq('control: an ordinary write is held', control.status, 503)
        const before = await stored()
        const refused = await world.api('PUT', URL, { name: 'probe', state: 'off', expectedEpoch: 6 })
        t.eq('OFF during maintenance: status', refused.status, 200)
        t.eq('OFF during maintenance: epoch', refused.json && refused.json.epoch, 7)
        const rowAfterOff = await stored()
        const on = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 7 })
        t.eq('ON during maintenance: status', on.status, 503)
        t.eq('ON during maintenance: code', on.json && on.json.code, 'read_switch_maintenance')
        t.eq('ON during maintenance changed nothing', await stored(), rowAfterOff)
        t.ok('the OFF flip did write', before !== rowAfterOff)
      } finally {
        await world.run("DELETE FROM system_flags WHERE key = 'maintenance'")
        await world.run("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
      }
      const after = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 7 })
      t.eq('after maintenance ends an ON flip works', [after.status, after.json && after.json.epoch], [200, 8])
    })

    await check('a row written by a newer build keeps its other tokens through a flip, and an unreadable row is epoch 0 and can be replaced', async (t) => {
      await world.run("UPDATE system_flags SET value = ? WHERE key = 'read_switches'", JSON.stringify({ epoch: 8, set_at: 'x', set_by: 1, switches: { probe: 'on', future_slice: 'shadow:0.05' } }))
      const flip = await world.api('PUT', URL, { name: 'probe', state: 'off', expectedEpoch: 8 })
      t.eq('flip', [flip.status, flip.json && flip.json.epoch], [200, 9])
      t.eq('the newer build token survives', JSON.parse(await stored()).switches, { future_slice: 'shadow:0.05', probe: 'off' })
      await world.run("UPDATE system_flags SET value = 'garbage {' WHERE key = 'read_switches'")
      const read = await world.api('GET', URL)
      t.eq('garbage reads as OFF at epoch 0', [read.json.epoch, read.json.switches], [0, [{ name: 'probe', state: 'off', rate: 0 }]])
      const heal = await world.api('PUT', URL, { name: 'probe', state: 'on', expectedEpoch: 0 })
      t.eq('a flip replaces the unreadable row', [heal.status, heal.json && heal.json.epoch], [200, 1])
      t.eq('and the stored row is valid JSON again', JSON.parse(await stored()).switches, { probe: 'on' })
    })

    await check('the switch row stays clear of the cutover triggers: they guard only maintenance and the control incarnation, and no other key is touched by a flip', async (t) => {
      const triggers = await world.query("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'system_flags'")
      t.ok('system_flags has guard triggers to check', triggers.length > 0)
      for (const trigger of triggers) t.ok(`${trigger.name} does not name read_switches`, !/read_switches/.test(trigger.sql || ''), trigger.name)
      const keys = await flagKeys()
      t.ok('only read_switches was added beside the seeded flags', keys.includes('read_switches') && keys.filter((k) => !['read_switches'].includes(k)).every((k) => !/^switch|epoch$/.test(k) || k === 'stock_schema_epoch' || k === 'data_epoch'), keys) // data_epoch: migration 0288, the database's data epoch (6.0.1048)
    })
  } finally {
    await world.dispose()
  }
  finish('read switches route')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

'use strict'
// How long the audit trail lives is guarded like the data it deletes:
//   - PUT /api/settings/audit-log-retention is the only way to change audit_log_retention_days; it takes whole days
//     from 21 to 3650 and the current password of an administrator;
//   - the generic POST /api/settings refuses a CHANGE of that key (resending the stored value stays a no-op);
//   - DELETE /api/system/audit-logs/retention keeps the same floor and asks for the password too.
// A refusal changes nothing and leaves an audit row naming the actor, the route and the reason.
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-audit-retention-step-up-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const RETENTION = '/api/settings/audit-log-retention'
const PURGE = '/api/system/audit-logs/retention'

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.account('settings_only', { roleCode: 'retention_settings', permissions: { settings: true }, passwordHash: world.adminPasswordHash })
    await world.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('audit_log_retention_days', '30')")

    const stored = async () => (await world.first("SELECT value FROM settings WHERE key = 'audit_log_retention_days'"))?.value ?? null
    const put = (body, as = 'admin') => world.api('PUT', RETENTION, body, { as })

    await check('control: the right days and the right password change the setting and are audited', async (t) => {
      const response = await put({ days: 45, currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('value', response.json && response.json.value, '45')
      t.eq('stored', await stored(), '45')
      const row = await world.first("SELECT details, old_value, new_value FROM audit_logs WHERE action = 'update' AND entity = 'settings' ORDER BY id DESC LIMIT 1")
      t.ok('audit row names the key', !!row && /audit_log_retention_days/.test(JSON.stringify(row)), row)
      t.ok('audit row holds no password', !!row && !JSON.stringify(row).includes(adminPassword), row)
    })

    await check('a missing password is refused and the setting stays', async (t) => {
      const response = await put({ days: 90 })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'current_password_required')
      t.eq('stored', await stored(), '45')
    })

    await check('a wrong password is refused and the setting stays', async (t) => {
      const response = await put({ days: 90, currentPassword: 'not-the-password' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'incorrect_password')
      t.eq('stored', await stored(), '45')
    })

    await check('fewer than 21 days, more than 3650, and anything that is not whole days are refused before the password is read', async (t) => {
      for (const days of [1, 20, 0, -5, 3651, 21.5, '21.5', 'ten', '', null, [30], { n: 30 }]) {
        const response = await put({ days, currentPassword: adminPassword })
        t.eq(`${JSON.stringify(days)}: status`, response.status, 400)
        t.eq(`${JSON.stringify(days)}: code`, response.json && response.json.code, 'invalid_audit_retention_days')
      }
      t.eq('stored', await stored(), '45')
    })

    await check('the 21 and 3650 limits themselves are accepted', async (t) => {
      for (const days of ['21', 3650]) {
        const response = await put({ days, currentPassword: adminPassword })
        t.eq(`${days}: status`, response.status, 200)
        t.eq(`${days}: stored`, await stored(), String(days))
      }
      await put({ days: 45, currentPassword: adminPassword })
    })

    await check('a Settings holder who is not an administrator is refused even with the right password', async (t) => {
      const response = await put({ days: 90, currentPassword: adminPassword }, 'settings_only')
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'admin_control_setting_required')
      t.eq('stored', await stored(), '45')
    })

    await check('the generic settings save refuses a changed value and still accepts the stored one', async (t) => {
      const changed = await world.api('POST', '/api/settings', { audit_log_retention_days: '21' })
      t.eq('changed: status', changed.status, 400)
      t.eq('changed: code', changed.json && changed.json.code, 'dedicated_setting_endpoint_required')
      t.eq('stored', await stored(), '45')
      const same = await world.api('POST', '/api/settings', { audit_log_retention_days: '45', business_name: 'Retention Test' })
      t.eq('unchanged resend: status', same.status, 200)
      t.eq('the ordinary key beside it saved', (await world.first("SELECT value FROM settings WHERE key = 'business_name'"))?.value, 'Retention Test')
    })

    await check('refused attempts are on the audit trail with actor, route and reason', async (t) => {
      const rows = await world.query("SELECT user_name, entity_id, details FROM audit_logs WHERE action = 'step_up_refused' ORDER BY id")
      t.eq('reasons', rows.map((row) => JSON.parse(row.details).reason), ['current_password_required', 'incorrect_password'])
      t.eq('routes', rows.map((row) => row.entity_id), [RETENTION, RETENTION])
      t.eq('actor', rows.map((row) => row.user_name), ['admin', 'admin'])
    })

    const oldRows = () => world.first("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = 'retention-old-row'").then((row) => row.n)
    await world.run("INSERT INTO audit_logs (action, entity, entity_id, created_at) VALUES ('probe', 'probe', 'retention-old-row', datetime('now', '-90 days'))")

    await check('the manual purge keeps the 21-day floor', async (t) => {
      const response = await world.api('DELETE', `${PURGE}?olderThanDays=1&confirm=true`, { currentPassword: adminPassword })
      t.eq('status', response.status, 400)
      t.eq('code', response.json && response.json.code, 'invalid_audit_retention_days')
      t.eq('the old row is still there', await oldRows(), 1)
    })

    await check('the manual purge without or with a wrong password deletes nothing', async (t) => {
      const none = await world.api('DELETE', `${PURGE}?olderThanDays=30&confirm=true`)
      t.eq('no password: status', none.status, 403)
      t.eq('no password: code', none.json && none.json.code, 'current_password_required')
      const wrong = await world.api('DELETE', `${PURGE}?olderThanDays=30&confirm=true`, { currentPassword: 'not-the-password' })
      t.eq('wrong password: status', wrong.status, 403)
      t.eq('wrong password: code', wrong.json && wrong.json.code, 'incorrect_password')
      t.eq('the old row is still there', await oldRows(), 1)
    })

    await check('the manual purge with the password still deletes rows older than the window', async (t) => {
      const response = await world.api('DELETE', `${PURGE}?olderThanDays=30&confirm=true`, { currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('the old row is gone', await oldRows(), 0)
    })
  } finally {
    finish('audit retention step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })

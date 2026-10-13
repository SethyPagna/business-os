'use strict'
// A backup restore rolls the whole database back (sales, users, settings), so POST /api/backups {type:'import-folder'}
// is held to what a reset is: only the built-in default admin, and only with that account's current password. A
// dry-run validation stays under the plain `backup` gate. A refused attempt changes nothing and leaves an audit row
// that names the actor, the route and the reason, never the password.
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-backup-restore-step-up-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.account('nobody', { roleCode: 'restore_nobody', permissions: {} })
    await world.account('operator', {
      roleCode: 'restore_operator',
      permissions: { backup: true, backup_restore: true, product_cost_view: true, product_cost_edit: true },
      passwordHash: world.adminPasswordHash,
    })

    await world.run("INSERT INTO sales (receipt_number, total_usd) VALUES ('RESTORE-BEFORE', 5)")
    const exported = await world.api('POST', '/api/backups', { type: 'export-cloudflare' })
    const backupName = exported.json && exported.json.item && exported.json.item.result && exported.json.item.result.packageId
    await world.run("INSERT INTO sales (receipt_number, total_usd) VALUES ('RESTORE-AFTER', 7)")

    const receipts = async () => (await world.query("SELECT receipt_number FROM sales WHERE receipt_number LIKE 'RESTORE-%' ORDER BY receipt_number")).map((row) => row.receipt_number)
    const maintenanceHeld = async () => !!(await world.first("SELECT value FROM system_flags WHERE key = 'maintenance'"))
    const restore = (as, extra = {}) => world.api('POST', '/api/backups', { type: 'import-folder', sourceDir: backupName, ...extra }, { as })

    await check('fixture: a backup was taken between the two sales', async (t) => {
      t.eq('export status', exported.status, 200)
      t.ok('backup name', typeof backupName === 'string' && backupName.length > 0, backupName)
      t.eq('both sales exist', await receipts(), ['RESTORE-AFTER', 'RESTORE-BEFORE'])
    })

    async function refused(t, label, call, status, code) {
      const response = await call()
      t.eq(`${label}: status`, response.status, status)
      t.eq(`${label}: code`, response.json && response.json.code, code)
      t.eq(`${label}: the later sale survives`, await receipts(), ['RESTORE-AFTER', 'RESTORE-BEFORE'])
      t.eq(`${label}: maintenance was never started`, await maintenanceHeld(), false)
    }

    await check('an account with no permission cannot restore', async (t) => {
      await refused(t, 'no permission', () => restore('nobody', { currentPassword: adminPassword }), 403, undefined)
    })

    await check('a backup_restore holder who is not the built-in admin is refused even with the right password', async (t) => {
      await refused(t, 'operator', () => restore('operator', { currentPassword: adminPassword }), 403, 'restore_builtin_admin_only')
    })

    await check('the built-in admin without a password is refused and nothing is rolled back', async (t) => {
      await refused(t, 'no password', () => restore('admin'), 403, 'current_password_required')
    })

    await check('the built-in admin with a wrong password is refused and nothing is rolled back', async (t) => {
      await refused(t, 'wrong password', () => restore('admin', { currentPassword: 'not-the-password' }), 403, 'incorrect_password')
    })

    await check('a password that is not text is refused', async (t) => {
      await refused(t, 'array', () => restore('admin', { currentPassword: ['x'] }), 403, 'current_password_required')
    })

    await check('a dry-run validation needs no password and rolls nothing back', async (t) => {
      const response = await restore('operator', { dryRun: true })
      t.eq('status', response.status, 200)
      t.eq('the later sale survives', await receipts(), ['RESTORE-AFTER', 'RESTORE-BEFORE'])
    })

    await check('every refused step-up is on the audit trail with actor, route and reason, and never the password', async (t) => {
      const rows = await world.query("SELECT user_name, entity_id, details FROM audit_logs WHERE action = 'step_up_refused' ORDER BY id")
      t.eq('three refusals were recorded', rows.length, 3)
      t.eq('the route', rows.map((row) => row.entity_id), ['/api/backups', '/api/backups', '/api/backups'])
      t.eq('the reasons', rows.map((row) => JSON.parse(row.details).reason), ['current_password_required', 'incorrect_password', 'current_password_required'])
      t.eq('the actor', rows.map((row) => row.user_name), ['admin', 'admin', 'admin'])
      t.ok('no password anywhere in the rows', !rows.some((row) => /not-the-password/.test(JSON.stringify(row)) || row.details.includes(adminPassword)), rows)
    })

    await check('the built-in admin with the right password restores: the later sale goes, the earlier one stays', async (t) => {
      const response = await restore('admin', { currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('receipts', await receipts(), ['RESTORE-BEFORE'])
      t.eq('maintenance released', await maintenanceHeld(), false)
    })
  } finally {
    finish('backup restore step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })

'use strict'
// POST /api/system/repair-integrity rewrites cached stock and sale statuses, and its audit row holds counts only, so it is
// guarded like the resets and the restore, not like a read:
//   - the Restore permission (backup_restore): a Backup-only or Settings-only account is refused, with a coded refusal
//     that the language packs carry in English and Khmer;
//   - the caller's current password (the shared step-up): missing, wrong or not text is refused before anything is repaired;
//   - every refusal changes nothing and leaves a step_up_refused audit row naming the route and the reason, never the password.
// GET /api/system/verify-integrity stays a read and keeps its Backup-or-Settings gate.
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-repair-integrity-step-up-native.cjs
const fs = require('node:fs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const REPAIR = '/api/system/repair-integrity'
const CODE = 'repair_integrity_restore_permission_required'
const packs = ['en', 'km'].map((name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lang', `${name}.json`), 'utf8')))
const [EN, KM] = packs

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.account('backup_only', { roleCode: 'repair_backup_only', permissions: { backup: true }, passwordHash: world.adminPasswordHash })
    await world.account('settings_only', { roleCode: 'repair_settings_only', permissions: { settings: true }, passwordHash: world.adminPasswordHash })
    await world.account('operator', { roleCode: 'repair_operator', permissions: { backup_restore: true }, passwordHash: world.adminPasswordHash })

    await executeRawStockTransaction(world.db, [world.db.prepare("INSERT INTO products (name, stock_quantity, is_active) VALUES ('Repair drift', 7, 1)")])
    const productId = (await world.first("SELECT id FROM products WHERE name = 'Repair drift'")).id
    const cached = async () => (await world.first('SELECT stock_quantity AS n FROM products WHERE id = ?', productId)).n
    const repairRows = async () => (await world.first("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'data-integrity' AND action = 'repair'")).n
    const refusals = async () => (await world.query("SELECT entity_id, details FROM audit_logs WHERE action = 'step_up_refused' AND entity_id = ? ORDER BY id", REPAIR))
      .map((row) => JSON.parse(row.details).reason)
    const repair = (body, as = 'admin') => world.api('POST', REPAIR, body, { as })

    await check('control: the stock cache really differs from the ledger before any repair', async (t) => {
      t.eq('cached stock', await cached(), 7)
      const read = await world.api('GET', '/api/system/verify-integrity', undefined, { as: 'backup_only' })
      t.eq('a Backup-only account may still read the check', read.status, 200)
      t.eq('and the read changes nothing', await cached(), 7)
    })

    await check('a missing, wrong or non-text password is refused and nothing is repaired', async (t) => {
      for (const [label, body, code] of [
        ['no body', undefined, 'current_password_required'],
        ['empty body', {}, 'current_password_required'],
        ['wrong password', { currentPassword: 'not-the-password' }, 'incorrect_password'],
        ['password that is not text', { currentPassword: ['x'] }, 'current_password_required'],
      ]) {
        const response = await repair(body)
        t.eq(`${label}: status`, response.status, 403)
        t.eq(`${label}: code`, response.json && response.json.code, code)
      }
      t.eq('the cache is untouched', await cached(), 7)
      t.eq('no repair row was written', await repairRows(), 0)
      t.eq('each refusal was recorded with its reason', await refusals(), ['current_password_required', 'current_password_required', 'incorrect_password', 'current_password_required'])
      const rows = JSON.stringify(await world.query("SELECT details FROM audit_logs WHERE action = 'step_up_refused'"))
      t.ok('no password in the rows', !rows.includes('not-the-password') && !rows.includes(adminPassword), rows)
    })

    await check('a Backup-only or Settings-only account is refused with the coded Restore-permission refusal, even with the right password', async (t) => {
      for (const account of ['backup_only', 'settings_only']) {
        const response = await repair({ currentPassword: adminPassword }, account)
        t.eq(`${account}: status`, response.status, 403)
        t.eq(`${account}: code`, response.json && response.json.code, CODE)
        t.eq(`${account}: the sentence is the English pack's`, response.json && response.json.error, EN[CODE])
      }
      t.eq('the cache is untouched', await cached(), 7)
      t.eq('no repair row was written', await repairRows(), 0)
      t.eq('both refusals were recorded', (await refusals()).slice(-2), [CODE, CODE])
    })

    await check('both language packs carry the refusal and the step-up refusals: Khmer text that is not the English', async (t) => {
      for (const key of [CODE, 'current_password_required', 'incorrect_password', 'current_password_rate_limited']) {
        t.ok(`${key}: English`, typeof EN[key] === 'string' && EN[key].length > 10, EN[key])
        t.ok(`${key}: Khmer, not the English`, typeof KM[key] === 'string' && /[ក-៿]/.test(KM[key]) && KM[key] !== EN[key], KM[key])
      }
    })

    await check('a Restore-permission holder with the right password repairs: the cache is rewritten and the row is written', async (t) => {
      const response = await repair({ currentPassword: adminPassword }, 'operator')
      t.eq('status', response.status, 200)
      t.eq('repairs', response.json && response.json.repairs, 1)
      t.eq('the cache now follows the ledger', await cached(), 0)
      t.eq('one repair row', await repairRows(), 1)
      const row = await world.first("SELECT user_name FROM audit_logs WHERE entity = 'data-integrity' AND action = 'repair'")
      t.eq('the row names the actor', row && row.user_name, 'operator')
    })

    await check('the built-in admin with the right password runs the repair again: nothing left to repair, no new row', async (t) => {
      const response = await repair({ currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('repairs', response.json && response.json.repairs, 0)
      t.eq('still one repair row', await repairRows(), 1)
    })
  } finally {
    finish('repair-integrity step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })

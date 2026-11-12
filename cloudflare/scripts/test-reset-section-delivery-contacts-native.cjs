'use strict'
// POST /api/system/reset-section {section:'delivery_contacts'} must not orphan sales or fees: it deletes only the
// delivery people no sale or fee names and reports how many it kept. Real Worker under Miniflare, then the same run
// against a mutant bundle whose reset deletes every row (the old behaviour), which must turn the checks red.
//
// Run (from cloudflare/): node scripts/test-reset-section-delivery-contacts-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function run(label, transformSources) {
  process.exitCode = 0
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword, transformSources })
  const { check, finish } = createReporter()
  try {
    await world.account('restorer', { roleCode: 'dc_reset_restorer', permissions: { backup_restore: true }, passwordHash: world.adminPasswordHash })
    const cache = await world.mf.getKVNamespace('CACHE')
    const reset = async () => {
      for (const key of (await cache.list({ prefix: 'ratelimit:' })).keys) await cache.delete(key.name)
      return world.api('POST', '/api/system/reset-section', {
        section: 'delivery_contacts', confirm: 'RESET DELIVERY CONTACTS', acknowledged: true, currentPassword: adminPassword,
      }, { as: 'restorer' })
    }
    const ids = async () => (await world.query('SELECT id FROM delivery_contacts ORDER BY id')).map((r) => r.id)

    await check('drivers on a sale or a fee survive, a free driver goes, links stay valid, kept count reported', async (t) => {
      await world.run("INSERT INTO delivery_contacts(id,name) VALUES (1,'On a sale'),(2,'On a fee'),(3,'Free')")
      await world.run("INSERT INTO sales(receipt_number,total_usd,delivery_contact_id,delivery_contact_name) VALUES ('DC-RESET-1',5,1,'On a sale')")
      await world.run("INSERT INTO fees(fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES ('delivery',2,8200,'2026-11-02',2)")
      const response = await reset()
      t.eq('status', response.status, 200)
      t.eq('kept count', response.json && response.json.keptCount, 2)
      t.eq('remaining drivers', await ids(), [1, 2])
      t.eq('no sale points at a missing driver', (await world.first('SELECT COUNT(*) n FROM sales s LEFT JOIN delivery_contacts d ON d.id=s.delivery_contact_id WHERE s.delivery_contact_id IS NOT NULL AND d.id IS NULL')).n, 0)
      const audit = await world.first("SELECT details FROM audit_logs WHERE action = 'reset_data' ORDER BY id DESC LIMIT 1")
      t.eq('the audit row records the kept count', JSON.parse(audit.details).kept_referenced, 2)
      t.eq('no fee points at a missing driver', (await world.first('SELECT COUNT(*) n FROM fees f LEFT JOIN delivery_contacts d ON d.id=f.delivery_contact_id WHERE f.delivery_contact_id IS NOT NULL AND d.id IS NULL')).n, 0)
    })
    await check('FULL data reset keeps a driver a surviving expense names (fees survive), deletes the rest, reports and audits the kept count', async (t) => {
      for (const key of (await cache.list({ prefix: 'ratelimit:' })).keys) await cache.delete(key.name)
      await world.run('DELETE FROM fees'); await world.run('DELETE FROM sales'); await world.run('DELETE FROM delivery_contacts')
      await world.run("INSERT INTO delivery_contacts(id,name) VALUES (11,'On a sale'),(12,'On a fee'),(13,'Free')")
      await world.run("INSERT INTO sales(receipt_number,total_usd,delivery_contact_id,delivery_contact_name) VALUES ('DC-RESET-ALL',5,11,'On a sale')")
      await world.run("INSERT INTO fees(fee_type,amount_usd,amount_khr,fee_date,delivery_contact_id) VALUES ('delivery',2,8200,'2026-11-02',12)")
      const response = await world.api('POST', '/api/system/reset-data', { mode: 'all', confirm: 'DELETE ALL DATA', acknowledged: true, currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('kept count', response.json && response.json.keptCount, 1)
      t.eq('remaining drivers: only the one a surviving fee names', await ids(), [12])
      t.eq('no fee points at a missing driver', (await world.first('SELECT COUNT(*) n FROM fees f LEFT JOIN delivery_contacts d ON d.id=f.delivery_contact_id WHERE f.delivery_contact_id IS NOT NULL AND d.id IS NULL')).n, 0)
      const audit = await world.first("SELECT details FROM audit_logs WHERE action = 'reset_data' ORDER BY id DESC LIMIT 1")
      t.eq('the audit row records the kept count', JSON.parse(audit.details).kept_referenced, 1)
      await world.run('DELETE FROM fees')
    })
    await check('with nothing referenced the reset clears the table and reports none kept', async (t) => {
      await world.run('DELETE FROM sales'); await world.run('DELETE FROM fees')
      const response = await reset()
      t.eq('status', response.status, 200)
      t.eq('kept count', response.json && response.json.keptCount, 0)
      t.eq('remaining drivers', await ids(), [])
    })
  } finally {
    console.log(`-- ${label}`)
    finish(`reset-section delivery_contacts (${label})`)
    await world.dispose()
  }
}

async function main() {
  await run('real source')
  if (process.exitCode) return
  const realExit = process.exitCode
  await run('MUTANT: plain DELETE of every driver', (file, source) => (file === 'lib/contactDeleteGuard.ts'
    ? source.replace(/DELETE FROM delivery_contacts\s+WHERE NOT EXISTS/, 'DELETE FROM delivery_contacts WHERE 1=1 OR NOT EXISTS')
    : undefined))
  if (process.exitCode) { console.log('KILLED mutant (red as required)'); process.exitCode = realExit } else { console.log('SURVIVED mutant'); process.exitCode = 1; return }
  await run('MUTANT: full data reset deletes every driver', (file, source) => (file === 'routes/system.ts'
    ? source.replace('{ sql: RESET_UNUSED_DELIVERY_CONTACTS_SQL },', "{ sql: 'DELETE FROM delivery_contacts' },")
    : undefined))
  if (process.exitCode) { console.log('KILLED mutant (red as required)'); process.exitCode = realExit } else { console.log('SURVIVED mutant'); process.exitCode = 1 }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

'use strict'
// Security audit P2-d: POST /api/system/reset-section no longer accepts section audit_log, so the audit trail (merge
// cost review evidence included) cannot be wiped by a role that holds only backup_restore. This file used to prove the
// merge-evidence guard inside that reset; the whole reset is now refused, which holds the same evidence and more.
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

async function main() {
  const adminPassword = randomBytes(18).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  const request = (extra = {}) => world.api('POST', '/api/system/reset-section', {
    section: 'audit_log', confirm: 'RESET AUDIT LOG', acknowledged: true,
    currentPassword: adminPassword, ...extra,
  })
  const rows = () => world.query("SELECT * FROM audit_logs WHERE entity IN ('product','merge_review_test') ORDER BY id")
  const clear = async () => {
    await world.run('DELETE FROM audit_logs')
    const cache = await world.mf.getKVNamespace('CACHE')
    for (const key of (await cache.list({ prefix: 'ratelimit:' })).keys) await cache.delete(key.name)
  }
  const event = (kind) => JSON.stringify({ cost_review: {
    version: 1, kind, operation_key: 'a'.repeat(32), root_key: 'b'.repeat(32),
    before_key: null, after_key: 'a'.repeat(32), after_usd: 7, after_khr: null,
  } })
  try {
    for (const kind of ['merge', 'merge_undo', 'merge_redo']) {
      await check(`${kind} evidence survives: an authorized audit-only reset is refused`, async t => {
        await clear()
        await world.run("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES ('cost_override','product','987654',?)", event(kind))
        await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('probe','merge_review_test','{}')")
        const before = await rows()
        const response = await request()
        t.eq('status', response.status, 410)
        t.eq('code', response.json?.code, 'audit_log_reset_removed')
        t.eq('all relevant audit rows unchanged', await rows(), before)
      })
    }
    await check('ordinary, malformed and unrelated rows are not resettable either, and the refusal does not depend on the password or phrase', async t => {
      await clear()
      for (const details of [null, '', '{broken', '{}', '{"cost_review":{"version":0}}']) {
        await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('cost_override','product',?)", details)
      }
      await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('probe','merge_review_test',?)", event('merge'))
      const before = await rows()
      for (const extra of [{}, { confirm: '' }, { currentPassword: 'incorrect-password' }]) {
        const response = await request(extra)
        t.eq('status', response.status, 410)
        t.eq('code', response.json?.code, 'audit_log_reset_removed')
      }
      t.eq('every audit row unchanged', await rows(), before)
    })
  } finally {
    finish('merge review audit reset')
    await world.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

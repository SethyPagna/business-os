'use strict'
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
      await check(`${kind} evidence survives an authorized audit-only reset even without a live product`, async t => {
        await clear()
        await world.run("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES ('cost_override','product','987654',?)", event(kind))
        await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('probe','merge_review_test','{}')")
        const before = await rows()
        const response = await request()
        t.eq('status', response.status, 409)
        t.eq('code', response.json?.code, 'merge_cost_review_history_required')
        t.eq('all relevant audit rows unchanged', await rows(), before)
      })
    }
    await check('ordinary, malformed and unrelated JSON remain resettable', async t => {
      await clear()
      for (const details of [null, '', '{broken', '{}', '{"cost_review":{"version":0}}']) {
        await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('cost_override','product',?)", details)
      }
      await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('probe','merge_review_test',?)", event('merge'))
      const response = await request()
      t.eq('status', response.status, 200)
      t.eq('success', response.json?.success, true)
      t.eq('ordinary audit rows cleared', await rows(), [])
    })
    await check('the cost safeguard does not bypass confirmation or current-password checks', async t => {
      await clear()
      await world.run("INSERT INTO audit_logs(action,entity,details) VALUES ('cost_override','product',?)", event('merge'))
      const before = await rows()
      const missingPhrase = await request({ confirm: '' })
      t.eq('confirmation status', missingPhrase.status, 400)
      t.eq('confirmation code', missingPhrase.json?.code, 'reset_confirm_required')
      const wrongPassword = await request({ currentPassword: 'incorrect-password' })
      t.eq('password status', wrongPassword.status, 403)
      t.eq('password code', wrongPassword.json?.code, 'incorrect_password')
      t.eq('evidence unchanged', await rows(), before)
    })
  } finally {
    finish('merge review audit reset')
    await world.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

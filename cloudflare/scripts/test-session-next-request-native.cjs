'use strict'
// A revoked session, a password change and a permission downgrade must take effect on the VERY NEXT request,
// on the routes that read their data in the session lookup's own D1 batch (GET /api/branches and
// GET /api/notifications/summary, lib/auth.ts prefetchWithSession).
//
// That batching is only safe because the session is still looked up on every request -- nothing about it is
// cached between requests -- and because the batched rows are handed to the handler only after requireAuth has
// accepted the session. This drives the REAL Worker (every middleware, route and lib) under Miniflare on a
// fully migrated D1 and changes the database between two requests, exactly as the admin routes do:
//   - sign-out, an admin revoking sessions and an expired session: the next request is 401 and carries no rows;
//   - a self password change signs out the account's other sessions at once, and keeps the one that changed it;
//   - a role downgrade removes the Sales bell section on the next poll, and deactivating the account is a 401;
//   - the round-trip pins: GET /api/branches is ONE D1 round trip (it was two); the bell summary is at most three
//     (session + preferences, cache versions, all sections in one batch) where it was twelve to fourteen.
//
// Run (from cloudflare/): node scripts/test-session-next-request-native.cjs
const { randomBytes } = require('node:crypto')
const { createHash } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    const cashier = await world.account('mw-cashier', { roleCode: 'mw_cashier', permissions: { sales: true }, passwordHash: world.adminPasswordHash })
    for (const name of ['phone', 'tab', 'desk', 'old']) await world.session(`mw-${name}`, cashier.id)
    await world.run("INSERT INTO sales (receipt_number, sale_status, total_usd, created_at) VALUES ('MW-UNPAID', 'awaiting_payment', 12, datetime('now'))")

    const branches = (as) => world.api('GET', '/api/branches', undefined, { as })
    const summary = (as) => world.api('GET', '/api/notifications/summary', undefined, { as })
    const sectionIds = (response) => (response.json?.sections || []).map((section) => section.id)
    const noRows = (response) => !/Shop|Warehouse|MW-UNPAID/.test(response.text)
    const revoke = (name) => world.run('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?', sha256(world.tokens[name]))

    await check('control: a signed-in cashier reads the branches and the Sales bell section', async (t) => {
      const a = await branches('mw-phone')
      const b = await summary('mw-phone')
      t.eq('branches status', a.status, 200)
      t.ok('branches body is the branch list', Array.isArray(a.json) && a.json.length > 0, a.text.slice(0, 120))
      t.eq('summary status', b.status, 200)
      t.ok('summary lists the unpaid sale', sectionIds(b).includes('sales'), sectionIds(b))
    })

    await check('a session revoked in the database is refused on the very next request, with no rows', async (t) => {
      await revoke('mw-phone')
      const a = await branches('mw-phone')
      const b = await summary('mw-phone')
      t.eq('branches status', a.status, 401)
      t.eq('summary status', b.status, 401)
      t.eq('branches code', a.json?.code, 'invalid_session')
      t.ok('branches response carries no rows', noRows(a), a.text)
      t.ok('summary response carries no rows', noRows(b), b.text)
      t.eq('another session of the same account is untouched', (await branches('mw-tab')).status, 200)
    })

    await check('sign-out is refused on the next request', async (t) => {
      t.eq('before', (await branches('mw-desk')).status, 200)
      const out = await world.api('POST', '/api/auth/logout', {}, { as: 'mw-desk' })
      t.eq('logout status', out.status, 200)
      t.eq('branches after', (await branches('mw-desk')).status, 401)
      t.eq('summary after', (await summary('mw-desk')).status, 401)
    })

    await check('an expired session is refused on the next request', async (t) => {
      t.eq('before', (await branches('mw-old')).status, 200)
      await world.run("UPDATE user_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?", sha256(world.tokens['mw-old']))
      t.eq('branches after', (await branches('mw-old')).status, 401)
      t.eq('summary after', (await summary('mw-old')).status, 401)
    })

    await check('a password change signs out the account\'s other sessions at once and keeps the one that changed it', async (t) => {
      await world.session('mw-other', cashier.id)
      t.eq('other before', (await branches('mw-other')).status, 200)
      t.eq('summary other before', (await summary('mw-other')).status, 200)
      const changed = await world.api('POST', `/api/users/${cashier.id}/change-password`,
        { currentPassword: adminPassword, newPassword: `Mw-${randomBytes(9).toString('base64url')}-9z` }, { as: 'mw-tab' })
      t.eq('change status', changed.status, 200)
      t.eq('other branches after', (await branches('mw-other')).status, 401)
      t.eq('other summary after', (await summary('mw-other')).status, 401)
      t.ok('other carries no rows', noRows(await branches('mw-other')))
      t.eq('the changing session survives', (await branches('mw-tab')).status, 200)
      t.eq('the changing session still reads the bell', (await summary('mw-tab')).status, 200)
    })

    await check('a role downgrade removes the Sales bell section on the next poll', async (t) => {
      t.ok('granted', sectionIds(await summary('mw-tab')).includes('sales'))
      await world.run("UPDATE roles SET permissions = '{}' WHERE code = 'mw_cashier'")
      const after = await summary('mw-tab')
      t.eq('still signed in', after.status, 200)
      t.ok('Sales section gone on the very next request', !sectionIds(after).includes('sales'), sectionIds(after))
      await world.run("UPDATE roles SET permissions = '{\"sales\":true}' WHERE code = 'mw_cashier'")
      t.ok('a re-grant is equally immediate', sectionIds(await summary('mw-tab')).includes('sales'))
    })

    await check('deactivating the account is a 401 on the next request', async (t) => {
      await world.run('UPDATE users SET is_active = 0 WHERE id = ?', cashier.id)
      t.eq('branches', (await branches('mw-tab')).status, 401)
      t.eq('summary', (await summary('mw-tab')).status, 401)
      await world.run('UPDATE users SET is_active = 1 WHERE id = ?', cashier.id)
    })

    await check('no cookie and an unknown token get 401 and no rows', async (t) => {
      for (const route of ['/api/branches', '/api/notifications/summary']) {
        const bare = await world.mf.dispatchFetch(`http://localhost${route}`)
        t.eq(`${route} without a cookie`, bare.status, 401)
        const text = await bare.text()
        t.ok(`${route} without a cookie carries no rows`, noRows({ text }), text)
        const forged = await world.mf.dispatchFetch(`http://localhost${route}`, { headers: { cookie: 'bos_session=not-a-real-token' } })
        t.eq(`${route} with an unknown token`, forged.status, 401)
      }
    })

    await check('round trips: GET /api/branches is one D1 round trip; the bell summary is at most three', async (t) => {
      const timing = async (route) => {
        const response = await world.mf.dispatchFetch(`http://localhost${route}`, { headers: { cookie: `bos_session=${world.tokens.admin}` } })
        await response.text()
        const header = response.headers.get('server-timing') || ''
        return { status: response.status, trips: Number(/d1n;desc="(\d+)"/.exec(header)?.[1]), statements: Number(/q=(\d+)/.exec(header)?.[1]) }
      }
      await timing('/api/branches') // the first request of the isolate also seeds
      const one = await timing('/api/branches')
      t.eq('branches status', one.status, 200)
      t.eq('branches round trips', one.trips, 1)
      t.eq('branches statements (session + list)', one.statements, 2)
      await timing('/api/notifications/summary')
      const bell = await timing('/api/notifications/summary')
      t.eq('summary status', bell.status, 200)
      t.ok('summary round trips <= 3', bell.trips <= 3, bell)
    })
  } finally {
    await world.dispose()
  }
  finish('session changes take effect on the next request')
}

main().catch((error) => { console.error(error); process.exit(1) })

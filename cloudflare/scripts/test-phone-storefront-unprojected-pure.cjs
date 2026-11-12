'use strict'
// The storefront and customer portal (/api/portal/*) answer a customer about their OWN account, so they are never run through the phone
// projection: a portal customer reads their own number in full, with or without a staff cookie. A request with no staff session on any
// other /api route stays masked (the control), and a staff session reads in full. The mutant that applies the projection to /api/portal/*
// (the Opus review's mutant C) must turn this red. Runs the real lib/phoneMaskMiddleware.ts and lib/phoneAccess.ts over a Hono app.
//
// Run (from cloudflare/): node scripts/test-phone-storefront-unprojected-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const NUMBER = '097 211 822'
const MASKED = '097 *** 822'
const STAFF = { id: 7, role_code: 'employee', permissions: '{}', role_permissions: '{}' }

function load(mutateMiddleware) {
  const cache = new Map()
  const auth = {
    hasSessionCookie: (c) => !!c.req.header('x-test-session'),
    getSessionUser: async (c) => { const kind = c.req.header('x-test-session'); if (kind === 'staff') return STAFF; if (kind === 'dead') return null; throw new Error('lookup failed') },
  }
  const load1 = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }
    cache.set(name, module)
    let source = fs.readFileSync(path.join(LIB, `${name}.ts`), 'utf8').split('\r\n').join('\n')
    if (name === 'phoneMaskMiddleware' && mutateMiddleware) source = mutateMiddleware(source)
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      if (id === './auth') return auth
      if (id.startsWith('./')) return load1(id.slice(2))
      throw new Error(`unexpected import ${id}`)
    }, module, module.exports)
    return module.exports
  }
  return load1('phoneMaskMiddleware').phoneMaskResponses
}

async function checks(middleware) {
  const app = new Hono()
  app.use('/api/*', middleware)
  app.get('/api/portal/me', (c) => c.json({ customer: { name: 'Sok', phone: NUMBER } }))
  app.get('/api/customers', (c) => c.json({ rows: [{ name: 'Sok', phone: NUMBER }] }))
  const read = async (url, session) => (await app.request(url, session ? { headers: { 'x-test-session': session } } : undefined)).json()
  const results = []
  const check = async (name, fn) => { try { await fn(); results.push([name, true]) } catch (error) { results.push([name, false, error.message]) } }

  await check('control: no session on a staff route is masked', async () => assert.equal((await read('/api/customers')).rows[0].phone, MASKED))
  await check('control: a dead cookie on a staff route is masked', async () => assert.equal((await read('/api/customers', 'dead')).rows[0].phone, MASKED))
  await check('control: a staff session reads the number in full', async () => assert.equal((await read('/api/customers', 'staff')).rows[0].phone, NUMBER))
  await check('storefront: a portal customer with no staff cookie reads their own number in full', async () => assert.equal((await read('/api/portal/me')).customer.phone, NUMBER))
  await check('storefront: a dead staff cookie does not mask the portal answer', async () => assert.equal((await read('/api/portal/me', 'dead')).customer.phone, NUMBER))
  await check('storefront: a staff cookie on the portal answer reads in full', async () => assert.equal((await read('/api/portal/me', 'staff')).customer.phone, NUMBER))
  return results
}

;(async () => {
  const live = await checks(load())
  for (const [name, ok, message] of live) console.log(`${ok ? 'ok  ' : 'RED '} ${name}${ok ? '' : ` -- ${message}`}`)
  const failed = live.filter(([, ok]) => !ok)

  const mutants = {
    'projection applied to /api/portal/*': (source) => {
      const head = 'const STOREFRONT = '
      const at = source.indexOf(head)
      assert.ok(at >= 0, 'mutant anchor missing')
      return source.slice(0, at) + head + '/^never$/' + source.slice(source.indexOf(String.fromCharCode(10), at))
    },
  }
  for (const [name, mutate] of Object.entries(mutants)) {
    const red = (await checks(load(mutate))).filter(([, ok]) => !ok)
    if (!red.length) { console.log(`RED mutant survived: ${name}`); failed.push([name, false]) } else console.log(`ok   mutant killed (${red.length} red): ${name}`)
  }
  if (failed.length) { console.error(`FAIL ${failed.length}`); process.exit(1) }
  console.log('PASS storefront answers are never projected')
})().catch((error) => { console.error(error); process.exit(1) })

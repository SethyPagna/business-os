import assert from 'node:assert/strict'

// Owner report, 14 Oct: every sign-in showed "Dashboard summary unavailable --
// Read belongs to an earlier account or refresh" until Refresh. Sign-in stores
// the POST /login user, the Dashboard's startup read leaves, and the bootstrap
// then rewrites the SAME account with its fuller row. The fence must refuse
// only a read that belongs to another account, a sign-out or a reset.
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}
const local = memoryStorage()
const session = memoryStorage()
Object.assign(globalThis, { window: {
  location: { origin: 'https://admin.fixture.test', href: 'https://admin.fixture.test/' },
  localStorage: local, sessionStorage: session,
  setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
} })

const scopes = await import('../src/api/actorReadScope.ts')
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://admin.fixture.test')

// cloudflare/src/routes/auth.ts buildUserPayload (POST /login) vs the session
// row GET /api/auth/bootstrap returns (lib/auth.ts lookupSessionUser).
const loginUser = (id: number) => ({ id, username: `u${id}`, name: `User ${id}`, organizationId: 1, roleId: 1, permissions: '{}', role_code: 'admin', role_permissions: '{"all":true}' })
const bootstrapUser = (id: number, organization = 1) => ({ id, username: `u${id}`, name: `User ${id}`, email: null, organization_id: organization, role_id: 1, permissions: '{}', is_active: 1, role_code: 'admin', role_permissions: '{"all":true}', organization_public_id: 'org' })
const store = (user: object | null, expiry = '') => {
  if (user) local.setItem('businessos_user', JSON.stringify(user)); else local.removeItem('businessos_user')
  if (expiry) local.setItem('businessos_user_expiry', expiry); else local.removeItem('businessos_user_expiry')
}

let release!: () => void
const originalFetch = globalThis.fetch
globalThis.fetch = (() => new Promise<Response>((resolve) => {
  release = () => resolve(new Response(JSON.stringify({ summary: { ok: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
})) as typeof fetch

async function readAcross(change: () => void): Promise<'answered' | 'refused'> {
  const pending = http.apiFetch('GET', '/api/dashboard/startup', undefined, 5000)
  await new Promise((resolve) => setImmediate(resolve))
  change()
  release()
  try { await pending; return 'answered' } catch (error) {
    assert.equal((error as { code?: string }).code, 'stale_read_scope', String(error))
    return 'refused'
  }
}

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

function signIn(user: object, expiry = String(Date.now() + 3_600_000)): void {
  store(user, expiry)
  scopes.resetActorReadSession()
}

await check('the bootstrap rewriting the signed-in account keeps its Dashboard read', async () => {
  signIn(loginUser(11))
  assert.equal(await readAcross(() => store(bootstrapUser(11), String(Date.now() + 86_400_000))), 'answered')
})

await check('a same-account profile, permission-text or expiry rewrite keeps the read', async () => {
  signIn(bootstrapUser(11))
  assert.equal(await readAcross(() => store({ ...bootstrapUser(11), name: 'Renamed', email: 'a@b.test' }, String(Date.now() + 7_200_000))), 'answered')
})

await check('control: account A read answered after another account is stored is refused', async () => {
  signIn(bootstrapUser(11))
  assert.equal(await readAcross(() => store(bootstrapUser(12))), 'refused')
})

await check('control: account A read answered after a switch to B through sign-in is refused', async () => {
  signIn(loginUser(11))
  assert.equal(await readAcross(() => signIn(loginUser(12))), 'refused')
})

await check('control: a read answered after sign-out is refused', async () => {
  signIn(bootstrapUser(11))
  assert.equal(await readAcross(() => store(null)), 'refused')
})

await check('control: the same user id in another organization is refused', async () => {
  signIn(bootstrapUser(11, 1))
  assert.equal(await readAcross(() => store(bootstrapUser(11, 2))), 'refused')
})

await check('control: a session reset (permission refresh) still fences the read', async () => {
  signIn(bootstrapUser(11))
  assert.equal(await readAcross(() => scopes.resetActorReadSession()), 'refused')
})

globalThis.fetch = originalFetch
if (failed) { console.error(`${failed} read-scope adoption check(s) failed`); process.exit(1) }

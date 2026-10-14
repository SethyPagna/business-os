import assert from 'node:assert/strict'

// POST /login answers `organizationId` (cloudflare routes/auth.ts buildUserPayload);
// the login bootstrap then stores the session row with `organization_id`. Both
// name one account, so a sign-in must advance the device's write generation
// once, and a write identity taken between the two must stay current.
const values = new Map<string, string>()
const local = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)) },
  removeItem: (key: string) => { values.delete(key) },
}
const session = { getItem: () => null, setItem() {}, removeItem() {} }
Object.assign(globalThis, { window: {
  location: { origin: 'https://admin.fixture.test' }, localStorage: local, sessionStorage: session,
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
} })

const actor = await import('../src/api/actorReadScope.ts')
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://admin.fixture.test')

const WRITE_OWNER = 'businessos_write_owner_v1'
const loginUser = (id: number) => ({ id, username: `u${id}`, organizationId: 1, roleId: 1, permissions: '{}', role_code: 'admin', role_permissions: '{"all":true}' })
const bootstrapUser = (id: number, organization = 1) => ({ id, username: `u${id}`, email: null, organization_id: organization, role_id: 1, permissions: '{}', is_active: 1, role_code: 'admin', role_permissions: '{"all":true}' })
const store = (user: object) => local.setItem('businessos_user', JSON.stringify(user))
const generation = () => Number(String(values.get(WRITE_OWNER) || '0:').split(':')[0])

let failed = 0
function check(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

store(bootstrapUser(11))
const first = actor.captureActorWriteIdentity()
const recorded = generation()

check('a sign-in as another account advances the write generation once, through login and bootstrap', () => {
  actor.forgetActorWriteAccount()
  store(loginUser(12))
  const afterLogin = actor.captureActorWriteIdentity()
  assert.equal(generation(), recorded + 1, 'the login answer is a new owner')
  store(bootstrapUser(12))
  const afterBootstrap = actor.captureActorWriteIdentity()
  assert.equal(generation(), recorded + 1, 'the bootstrap row of the same account is not another')
  assert.equal(afterBootstrap.epoch, afterLogin.epoch)
  assert.equal(actor.isActorWriteIdentityCurrent(afterLogin), true, 'work captured before the bootstrap is still current')
})

check('the owner names the organization in either spelling', () => {
  store(loginUser(12))
  const login = actor.captureActorWriteIdentity()
  store(bootstrapUser(12))
  assert.equal(actor.captureActorWriteIdentity().owner, login.owner)
})

check('control: account A identity is refused after B signs in', () => {
  assert.equal(actor.isActorWriteIdentityCurrent(first), false)
})

check('control: the same user id in another organization is another owner', () => {
  store(bootstrapUser(12))
  const before = actor.captureActorWriteIdentity()
  store(bootstrapUser(12, 2))
  assert.equal(actor.isActorWriteIdentityCurrent(before), false)
  assert.equal(generation(), before.epoch + 1)
})

check('a stored bootstrap row keeps its recorded owner text (no generation bump on upgrade)', () => {
  store(bootstrapUser(12))
  assert.deepEqual(JSON.parse(actor.captureActorWriteIdentity().owner), ['https://admin.fixture.test', 'https://admin.fixture.test', '12', '1'])
})

if (failed) { console.error(`${failed} write-owner check(s) failed`); process.exit(1) }

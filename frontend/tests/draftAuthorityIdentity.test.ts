// H7 (OPUS-CORRECTNESS-HUNT-R2): an open Expense / Branch / Product form is fenced by the identity it was OPENED under
// (utils/draftAuthority.ts). That fence used the READ scope, which also moves on same-user churn -- a session reset, a
// permission / profile / expiry rewrite, a reconnect's permission refresh. After a network blip the open form therefore
// said "the account or server changed", switched Save off and stopped the draft writer, so text typed after the lock
// was lost. The fence is now the WRITE identity (server, origin, user id, organization), the one the Stock Session
// already uses.
//
// The REAL actorReadScope.ts, workDrafts.ts and draftAuthority.ts run in one fake browser tab (the shape of
// receivingAuthorityContinuation.test.ts): every same-user change must leave the authority current, every real change of
// owner must retire it, and A -> B -> A must never pass as unchanged. The mounted forms and pages are in
// draftAuthorityChurnMounted.test.ts.
import assert from 'node:assert/strict'
import * as actor from '../src/api/actorReadScope.ts'
import { setSyncServerUrl } from '../src/api/http.ts'
import { isDraftAuthorityCurrent, openDraftAuthority } from '../src/utils/draftAuthority.ts'

const local = new Map<string, string>(), tabSession = new Map<string, string>()
const store = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, String(value)) }, removeItem: (key: string) => { map.delete(key) } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: store(local), sessionStorage: store(tabSession), location: { origin: 'https://shop.test', hostname: 'shop.test' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, setTimeout, clearTimeout, setInterval, clearInterval,
} })
// workDrafts.ts reads the bare storage globals.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store(local) })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: store(tabSession) })

const SERVER = 'https://original.example.test'
const OWNER = { id: 7, organization_id: 3, role_id: 2, name: 'Cashier', permissions: ['fees.add'] }
const writeUser = (patch: Record<string, unknown> = {}): void => { local.set('businessos_user', JSON.stringify({ ...OWNER, ...patch })) }
function freshTab() {
  local.clear(); tabSession.clear(); writeUser(); setSyncServerUrl(SERVER); local.set('businessos_sync_server', SERVER)
  actor.resetActorReadSession()
  if (actor.isActorSessionQuarantined()) actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker())
  assert.equal(actor.isActorSessionQuarantined(), false)
}

// What a reconnect does to a signed-in tab: the session is reset and the same user's record is written again, with
// refreshed permissions and a new expiry (AppContext persistAuthenticatedUser).
const SAME_USER: Record<string, () => void> = {
  'session reset': () => actor.resetActorReadSession(),
  'permissions rewrite': () => writeUser({ permissions: ['fees.add', 'fees.edit'] }),
  'avatar rewrite': () => writeUser({ avatar_path: 'avatar.png' }),
  'expiry rewrite': () => { local.set('businessos_user_expiry', String(Date.now() + 86_400_000)) },
  'session reset + user rewrite (the post-reconnect refresh)': () => { actor.resetActorReadSession(); writeUser({ permissions: ['fees.add', 'fees.edit'] }); local.set('businessos_user_expiry', String(Date.now() + 86_400_000)) },
}
const REAL_CHANGE: Record<string, () => void> = {
  'another user (7 -> 8)': () => writeUser({ id: 8 }),
  'another organization': () => writeUser({ organization_id: 4 }),
  'another server': () => { setSyncServerUrl('https://other.example.test'); local.set('businessos_sync_server', 'https://other.example.test') },
  // B is observed by an ordinary read while signed in, then A returns: the key and the user are A's again.
  'A to B and back to A': () => { writeUser({ id: 8 }); actor.captureActorReadScope(); writeUser() },
  'signed out': () => { local.delete('businessos_user') },
}

let failed = 0
function check(name: string, action: () => void) {
  try { freshTab(); action(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

check('control: nothing changed, the authority is current and keeps its draft key', () => {
  const authority = openDraftAuthority('fee_new')
  assert.equal(isDraftAuthorityCurrent(authority), true)
  assert.match(authority.draftKey, /fee_new$/)
})
for (const [name, change] of Object.entries(SAME_USER)) {
  check(`same user, ${name}: the open form keeps its authority`, () => {
    const authority = openDraftAuthority('fee_new')
    const read = actor.captureActorReadScope('draft')
    change()
    assert.equal(isDraftAuthorityCurrent(authority), true, 'the form stays open, saving and writing its draft')
    assert.equal(openDraftAuthority('fee_new').draftKey, authority.draftKey, 'and the key it would be reopened under is the same')
    if (name.startsWith('session reset') || name.includes('rewrite')) assert.equal(actor.isActorReadScopeCurrent(read, false), false, 'control: the READ scope did move -- the old fence would have locked here')
  })
}
for (const [name, change] of Object.entries(REAL_CHANGE)) {
  check(`real change, ${name}: the authority is retired`, () => {
    const authority = openDraftAuthority('fee_new')
    change()
    assert.equal(isDraftAuthorityCurrent(authority), false, 'Save is refused and the draft writer stops')
  })
}
check('a locked authority stays locked after the quarantine reconciles and the owner is the same again (A to B to A)', () => {
  const authority = openDraftAuthority('fee_new')
  writeUser({ id: 8 }); actor.captureActorReadScope(); assert.equal(isDraftAuthorityCurrent(authority), false)
  writeUser()
  assert.equal(isDraftAuthorityCurrent(authority), false, 'the epoch only goes up')
})
check('a draft key that moved under an unchanged owner also retires the authority (the key check is kept)', () => {
  const authority = openDraftAuthority('fee_new')
  assert.equal(isDraftAuthorityCurrent({ ...authority, draftKey: `${authority.draftKey}-moved` }), false)
})
check('another tab signing in locks the form until the same owner is confirmed again', () => {
  const authority = openDraftAuthority('fee_new')
  local.set('businessos_read_session', 'another-tab-signed-in')
  assert.equal(isDraftAuthorityCurrent(authority), false, 'locked while the change is checked')
  assert.equal(actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()), true)
  assert.equal(isDraftAuthorityCurrent(authority), true, 'and released once the same owner is confirmed')
})

if (failed) process.exit(1)

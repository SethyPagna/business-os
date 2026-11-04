// P2.8 (6.0.1046): a masked body in tab memory must stop being served the moment the full-phone grant changes.
//
// The Worker sends a body shaped for the grant. If an account is granted contacts_full_phone (or loses it) while the tab is
// open, whatever the tab already holds was shaped for the other state: a cashier who was just granted the permission must
// not keep reading 012 *** 678 from memory, and one whose grant was just taken away must not keep reading the full number.
// The tab memory is keyed on the actor authority (lib actorReadScope.ts), and the authority includes the user's role code,
// their own permission overrides AND their role's permissions. This test pins that all three ways of flipping the grant
// rotate it, and that an unrelated change does not (so the fix does not turn every profile refresh into a refetch).
import assert from 'node:assert/strict'
import * as scopes from '../src/api/actorReadScope.ts'
import * as http from '../src/api/http.ts'

const storage = new Map<string, string>()
const browserStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
}
Object.assign(globalThis, { window: {
  location: { origin: 'https://fixture.test' }, localStorage: browserStorage,
  sessionStorage: { getItem: () => null },
  setTimeout, clearTimeout, dispatchEvent: () => true, addEventListener: () => {},
} })
http.setSyncServerUrl('https://fixture.test')

type Profile = { id: number; role_code: string; name?: string; permissions: Record<string, unknown>; role_permissions: Record<string, unknown> }
const signIn = (profile: Profile) => storage.set('businessos_user', JSON.stringify(profile))

const masked = { items: [{ name: 'Fixture Dara', phone: '087 *** 321' }] }
const full = { items: [{ name: 'Fixture Dara', phone: '087 654 321' }] }

// 1. a grant given to the person
signIn({ id: 7, role_code: 'employee', permissions: {}, role_permissions: { contacts: true } })
scopes.resetActorReadSession()
http.cacheClearAll()
http.cacheSet('customers:list', masked)
assert.deepEqual(http.cacheGet('customers:list'), masked, 'positive control: the entry is served while nothing changed')
signIn({ id: 7, role_code: 'employee', permissions: { contacts_full_phone: true }, role_permissions: { contacts: true } })
assert.equal(http.cacheGet('customers:list'), null, 'a grant given to the person stops the masked entry being served')
http.cacheSet('customers:list', full)
assert.deepEqual(http.cacheGet('customers:list'), full)

// 2. the grant taken away from the person (their own override beats the role)
signIn({ id: 7, role_code: 'employee', permissions: { contacts_full_phone: false }, role_permissions: { contacts: true, contacts_full_phone: true } })
assert.equal(http.cacheGet('customers:list'), null, 'a grant taken away stops the full entry being served')
http.cacheSet('customers:list', masked)
assert.deepEqual(http.cacheGet('customers:list'), masked)

// 3. the role gains the grant (an administrator edits the role while the cashier has the tab open)
signIn({ id: 7, role_code: 'employee', permissions: { contacts_full_phone: false }, role_permissions: { contacts: true, contacts_full_phone: true } })
assert.deepEqual(http.cacheGet('customers:list'), masked, 'the same profile again keeps the entry')
signIn({ id: 7, role_code: 'employee', permissions: {}, role_permissions: { contacts: true, contacts_full_phone: true } })
assert.equal(http.cacheGet('customers:list'), null, 'the person override removed, the role grant now applies: a new authority')
http.cacheSet('customers:list', full)
signIn({ id: 7, role_code: 'employee', permissions: {}, role_permissions: { contacts: true, contacts_full_phone: false } })
assert.equal(http.cacheGet('customers:list'), null, 'the role loses the grant: a new authority')

// 4. an unrelated profile refresh keeps the entry (only grants, role and identity are part of the authority)
http.cacheSet('customers:list', masked)
signIn({ id: 7, role_code: 'employee', name: 'Renamed Cashier', permissions: {}, role_permissions: { contacts: true, contacts_full_phone: false } })
assert.deepEqual(http.cacheGet('customers:list'), masked, 'a rename does not rotate the authority')

// 5. a different person on the same tab never reads the first person's entry
signIn({ id: 8, role_code: 'employee', permissions: { contacts_full_phone: true }, role_permissions: { contacts: true } })
assert.equal(http.cacheGet('customers:list'), null, 'another account never reads the first account\'s entry')

console.log('PASS phone grant changes rotate tab-memory authority: person grant, person revoke, role grant, role loss; rename keeps; another account never shares')

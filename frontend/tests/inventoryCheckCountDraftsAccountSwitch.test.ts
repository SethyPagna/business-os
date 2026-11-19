import assert from 'node:assert/strict'
import { countInput, createTasksWorld, open, pack, viewerUser, type Surface } from './inventoryCheckTasksWorld.ts'
import { forgetDeviceDrafts } from './inventoryCheckDeviceDrafts.ts'
import * as dirtyWork from '../src/utils/dirtyWork.ts'
import { STORAGE_KEYS } from '../src/constants.ts'

// Spec 10.4 "authority": a page freezes the account it opened under. After an account switch on the same device, nothing is written under the NEW account's draft key,
// the OLD account's draft is not shown to the new account, and the old page's draft stays with its owner (also after switching back: A, B, A never passes).
const words = pack('en')
const world = await createTasksWorld()
world.user = viewerUser('employee'); world.hideIssuer = true
const signIn = (id: number) => { const raw = JSON.stringify({ id, username: `user${id}`, organization_id: 1 }); localStorage.setItem(STORAGE_KEYS.USER, raw); sessionStorage.setItem(STORAGE_KEYS.USER, raw) }
/** Every stored draft: the authority (origin, server, organization, user id) it is kept under, and what it holds. */
const drafts = () => {
  const out: Array<{ user: string; base: string; entries: string[] }> = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const raw = localStorage.key(index)!; if (!raw.startsWith('businessos_draft_v2_')) continue
    const decoded = decodeURIComponent(raw.slice('businessos_draft_v2_'.length)); const split = decoded.indexOf(']_')
    const authority = JSON.parse(decoded.slice(0, split + 1)) as string[]
    out.push({ user: authority[3], base: decoded.slice(split + 2), entries: Object.keys(JSON.parse(localStorage.getItem(raw)!).data.entries).sort() })
  }
  return out.sort((a, b) => a.user.localeCompare(b.user))
}
const value = (surface: Surface, id: number) => (countInput(surface, id) as unknown as { value: string }).value
const hide = () => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) }
const show = () => Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

forgetDeviceDrafts(); signIn(7); world.identityEpoch = 1
open('products')
let surface = await world.mount()
await surface.type(countInput(surface, 3), '9'); await surface.settle(); hide(); show()
assert.deepEqual(drafts(), [{ user: '7', base: 'inventory-check-counts_1_list', entries: ['3'] }], 'before the switch: user 7\'s draft is under user 7\'s key')

// ---- the account switches while the page stays open (a kept-alive page): typing more writes nothing for user 8, and nothing more for user 7 ----
signIn(8); world.identityEpoch = 2
await surface.type(countInput(surface, 5), '4'); await surface.settle(); hide(); show(); await surface.settle()
assert.deepEqual(drafts(), [{ user: '7', base: 'inventory-check-counts_1_list', entries: ['3'] }], 'after the switch: NO key for user 8, and user 7\'s draft is untouched (the new count is not filed under either)')
const entry = dirtyWork.getDirtyWork()[0]
assert.ok(entry && typeof entry.save === 'function', 'the leave guard still sees the typed counts')
assert.equal(await entry.save!(), false, 'Save & Leave refuses to write them under the new account')
assert.deepEqual(drafts().map(draft => draft.user), ['7'], 'and nothing was written by trying')
// ---- A, B, A: switching back to user 7 does not make the frozen page current again ----
signIn(7); world.identityEpoch = 3
await surface.type(countInput(surface, 6), '2'); await surface.settle(); hide(); show(); await surface.settle()
assert.deepEqual(drafts(), [{ user: '7', base: 'inventory-check-counts_1_list', entries: ['3'] }], 'A, B, A: the page that opened before the switch never writes again')
await surface.unmount()

// ---- a page opened by the new account: user 7's draft is not shown to user 8, no notice, and its own typing goes under user 8's key only ----
signIn(8); world.identityEpoch = 4; world.notices.length = 0
surface = await world.mount()
assert.equal(value(surface, 3), '', 'user 8 does not see user 7\'s count')
assert.equal(world.notices.some(notice => notice.text === words.inventory_check_draft_restored), false, 'and no "Counts restored" notice is shown')
await surface.type(countInput(surface, 5), '4'); await surface.settle(); hide(); show(); await surface.settle()
assert.deepEqual(drafts(), [{ user: '7', base: 'inventory-check-counts_1_list', entries: ['3'] }, { user: '8', base: 'inventory-check-counts_1_list', entries: ['5'] }], 'user 8 keeps their own draft; user 7\'s is as it was')
await surface.unmount()

// ---- and back to user 7: their draft is restored to them, alone ----
signIn(7); world.identityEpoch = 5; world.notices.length = 0
surface = await world.mount()
assert.equal(value(surface, 3), '9', 'user 7 gets their own count back'); assert.equal(value(surface, 5), '', 'without user 8\'s')
assert.ok(world.notices.some(notice => notice.text === words.inventory_check_draft_restored), 'with the notice')
await surface.unmount()
forgetDeviceDrafts()
console.log('inventoryCheckCountDraftsAccountSwitch passed: after an account switch nothing is written under the new account, the old draft is not shown to it, and A-B-A stays locked')

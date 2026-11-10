// B5 follow-up 4 / audit G5, G6: Inventory Check writers answer 503 inventory_check_saved_refresh (outcome 'unknown') when the write committed but the cache version could
// not be advanced. The page must say so ("saved, retry or refresh", not "result unknown" and not a plain failure), in both packs, on every place it shows a save failure,
// and it must own that message: the app-wide "Write result is unknown" banner must not also show.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { claimSyncProblemPresentation, hasLocalSyncProblemPresentation } from '../src/utils/syncProblemLifecycle.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const KEY = 'inventory_check_saved_refresh'

assert.ok(en[KEY] && km[KEY], 'both packs carry the key')
assert.equal(en[KEY], 'Saved. Retry to finish, or refresh the page.', 'en: saved, and a retry is the recovery')
assert.match(km[KEY], /[\u1780-\u17FF]/, 'km: the sentence is Khmer')
assert.notEqual(en[KEY], km[KEY])
assert.notEqual(en[KEY], en.inventory_check_save_unknown, 'it is not the generic unknown-result sentence')

const page = read('../src/components/inventory/InventoryChecksPage.tsx')
assert.match(page, /problem\.code !== 'inventory_check_saved_refresh'\) return 'inventory_check_save_unknown'/, 'the page picks the text by code')
assert.match(page, /return 'inventory_check_saved_refresh'/)
const literalUses = page.split("tr('inventory_check_save_unknown'").length - 1 + page.split("? 'inventory_check_save_unknown' :").length - 1
assert.equal(literalUses, 0, 'no site bypasses unknownSaveKey')
assert.equal(page.split('unknownSaveKey(cause)').length - 1, 5, 'the five save-failure sites use it')

// G6: showing its own message, the page claims the problem's presentation so the global banner (which asks hasLocalSyncProblemPresentation) stays away.
assert.match(page, /claimSyncProblemPresentation\(\{ actorId: userIdentity\(user\), requestId: problem\.syncErrorId, problem: \{ errorId: problem\.syncErrorId, channel: problem\.syncErrorChannel, code: problem\.code \} \}\)/, 'the page claims the problem it shows')
assert.match(page, /savedRefreshClaims\.current\.forEach\(release => release\(\)\)/, 'claims end when the page closes')
// The claim has the shape http.ts gives the sync:error event (errorId, channel, code), so the banner's own check matches it for that user only.
const banner = { errorId: 'e-1', channel: 'inventory-checks:write', code: 'inventory_check_saved_refresh' }
assert.equal(hasLocalSyncProblemPresentation(banner, '7'), false, 'control: before the page claims, the banner would show')
const release = claimSyncProblemPresentation({ actorId: '7', requestId: 'e-1', problem: banner })
assert.equal(hasLocalSyncProblemPresentation(banner, '7'), true, 'claimed: the banner is suppressed')
assert.equal(hasLocalSyncProblemPresentation({ ...banner, errorId: 'e-2' }, '7'), false, 'another error is still shown')
assert.equal(hasLocalSyncProblemPresentation(banner, '8'), false, 'another user is still shown it')
release()
assert.equal(hasLocalSyncProblemPresentation(banner, '7'), false, 'released when the page closes')
console.log('PASS inventoryCheckSavedRefreshWording')

// B5 follow-up 4: Inventory Check writers answer 503 inventory_check_saved_refresh (outcome 'unknown') when the write committed but the cache version could
// not be advanced. The page must say "saved, refresh" (not "result unknown" and not a plain failure), in both packs, on every place it shows a save failure.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const KEY = 'inventory_check_saved_refresh'

assert.ok(en[KEY] && km[KEY], 'both packs carry the key')
assert.match(en[KEY], /^Saved\b.*\bRefresh\b/, 'en: says it was saved and to refresh')
assert.match(km[KEY], /[\u1780-\u17FF]/, 'km: the sentence is Khmer')
assert.notEqual(en[KEY], km[KEY])
assert.notEqual(en[KEY], en.inventory_check_save_unknown, 'it is not the generic unknown-result sentence')

const page = read('../src/components/inventory/InventoryChecksPage.tsx')
assert.match(page, /code === 'inventory_check_saved_refresh' \? 'inventory_check_saved_refresh' : 'inventory_check_save_unknown'/, 'the page picks the text by code')
// Every place that shows an unknown-outcome save failure goes through the code-aware key; none still hard-codes the generic one.
const literalUses = page.split("tr('inventory_check_save_unknown'").length - 1 + page.split("? 'inventory_check_save_unknown' :").length - 1
assert.equal(literalUses, 0, 'no site bypasses unknownSaveKey')
assert.equal(page.split('unknownSaveKey(cause)').length - 1, 5, 'the five save-failure sites use it')
console.log('PASS inventoryCheckSavedRefreshWording')

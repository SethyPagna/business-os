import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'

// Deploy-7 compose fixes: each assertion below failed on the unfixed composed tip.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../src/components/inventory/InventoryChecksPage.tsx')
const list = read('../src/components/inventory/InventoryCheckTasksList.tsx')
const transport = read('../src/api/inventoryChecksTransport.ts')
const layout = read('./inventoryCheckTasksLayoutBrowser.test.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// 1. The layout test must not point at the `lg:contents` wrapper, which has no box.
assert.ok(!layout.includes('[data-inventory-check-main] > :nth-child(3)'), 'the name selector no longer targets the box-less lg:contents wrapper')

// 2. The Issue entry icon is ClipboardPlus (the Tasks board and Issue bar use it too).
assert.match(page, /import ClipboardPlus from 'lucide-react\/dist\/esm\/icons\/clipboard-plus\.js'/)
const entry = page.slice(page.indexOf('const issueEntry'), page.indexOf('const countAction'))
assert.match(entry, /<ClipboardPlus className=/, 'the Issue entry is ClipboardPlus')
assert.ok(!/<ClipboardList/.test(entry), 'and not the Count sessions clipboard')

// 3. `reopened` lives on the transport type; no local cast remains.
const task = transport.slice(transport.indexOf('export type InventoryCheckTask = {'), transport.indexOf('export type InventoryCheckTasksAnswer'))
assert.match(task, /reopened\?: \{ at: string; reason: string; by\?: string \}/, 'InventoryCheckTask carries reopened')
assert.ok(!/task as InventoryCheckTask &/.test(list), 'the list no longer casts the task')

// 4. A missing total never draws "Products: " with nothing after it.
assert.match(page, /typeof listTask\.total === 'number' \? <span[^>]*>\{t\('products'\)\}: \{listTask\.total\}<\/span> : null/, 'the off-board total is drawn only when it is a number')
assert.ok(!/String\(item\?\.progress\?\.total \?\? ''\)/.test(page), 'the issued toast never substitutes an empty count')
assert.ok(typeof en.inventory_check_task_issued_plain === 'string' && /[ក-៿]/.test(km.inventory_check_task_issued_plain ?? ''), 'the count-less toast has both packs')

// 5. Every fallback reads exactly as the current English copy.
const fallbackIn = (source: string, key: string) => { const at = source.indexOf(`'${key}'`); assert.ok(at >= 0, `${key} is used`); const match = /,\s*(?:fallback:\s*)?'((?:[^'\\]|\\.)*)'/.exec(source.slice(at + key.length + 2, at + key.length + 400)); assert.ok(match, `${key} has a fallback`); return match[1].replace(/\\'/g, "'") }
for (const key of ['inventory_check_error_task_limit', 'inventory_check_draft_dropped', 'inventory_check_task_issued']) assert.equal(fallbackIn(page, key), en[key], `${key}: the page fallback is the current copy`)
for (const code of ['inventory_check_task_too_many', 'inventory_check_task_limit']) {
  const entryFor = REFUSAL_MESSAGES[code as keyof typeof REFUSAL_MESSAGES] as { key: string; fallback: string }
  assert.equal(entryFor.fallback, en[entryFor.key], `${code}: the refusal fallback is the current copy`)
}
console.log('inventoryCheckD7Fixes passed: layout selector, Issue icon, transport type, empty total, current fallbacks')

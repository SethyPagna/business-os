// RC2-HOTFIX: the Roles list card showed raw keys as tags ("sales:status",
// "sales:amend") and English section labels in Khmer, and the Conflicts card
// footer named buttons that do not exist ("Keep / Remove" for Keep / Merge).
//
// Run: node tests/roleCardPermissionLabels.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rolePermissionLabel } from '../src/components/users/rolePermissionLabel.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const usersSource = read('../src/components/users/Users.tsx')
const tabSource = read('../src/components/products/ProductDuplicatesTab.tsx')
const translator = (pack: Record<string, string>) => (key: string, fallback: string) => (pack[key] && pack[key] !== key ? pack[key] : fallback)

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('a per-action override reads as its section and action label, in both languages', () => {
  for (const action of ['status', 'customer', 'add_items', 'amend']) {
    const label = rolePermissionLabel(`sales:${action}`, translator(km))
    assert.equal(label, `${km.perm_sales}: ${km[`perm_act_sales_${action}`]}`, `km sales:${action}`)
    assert.ok(label && !label.includes('sales:'), 'no raw key in the tag')
    assert.ok(rolePermissionLabel(`sales:${action}`, translator(en))?.includes(en[`perm_act_sales_${action}`]))
  }
})

test('a plain section key reads translated, and an unknown fine-grained key is hidden, not printed raw', () => {
  assert.equal(rolePermissionLabel('contacts', translator(km)), km.perm_contacts)
  assert.equal(rolePermissionLabel('sales:no_such_action', translator(km)), null)
  assert.equal(rolePermissionLabel('no_such_section:view', translator(km)), null)
  assert.equal(rolePermissionLabel('no_such_section', translator(km)), null)
})

test('the Roles list card tags and summary use the label helper, never a raw key', () => {
  assert.match(usersSource, /rolePermissionLabel\(/)
  assert.doesNotMatch(usersSource, /PERMISSION_DEFS\.find\(\(item\) => item\.key === key\)\?\.label \|\| key/, 'the tag no longer falls back to the key')
  assert.doesNotMatch(usersSource, /tr\(perm\?\.tKey \|\| key, perm\?\.label \|\| key\)/, 'the summary no longer falls back to the key')
})

test('the Conflicts footer hint names the Keep / Merge buttons in both packs, and the in-code fallback agrees', () => {
  assert.equal(en.dup_decide_all_hint, `Decide every row (${en.keep} / ${en.merge}) to apply`)
  assert.ok(km.dup_decide_all_hint.includes(`${km.keep} / ${km.merge}`), km.dup_decide_all_hint)
  assert.doesNotMatch(en.dup_decide_all_hint, /Remove/)
  assert.match(tabSource, /Decide every row \(Keep \/ Merge\) to apply/)
})

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1

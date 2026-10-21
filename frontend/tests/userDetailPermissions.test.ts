// User detail (AC-B4, B-R8, B-M4, B-M5): the sheet names every permission instead of printing its key, shows the
// View tier, lists explicit denials by name and counts individual exceptions. These two cases lived in
// permissionEditorTiers.test.ts while the role editor and the sheet shared a file; they are about the sheet, not the
// editor, so they moved here unchanged when the editor became an access grid.
//
// Run: node tests/userDetailPermissions.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

let failed = 0
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const harness = await createHarness()
const pack = (language: Record<string, string>) => (key: string) => language[key]

const RAW_KEY = /\b[a-z]+(?:_[a-z]+)+\b|\b[a-z_]+:[a-z_]+\b/

const sheetProps = (language: Record<string, string>) => ({
  user: { id: 7, name: 'Dara', username: 'dara', role_id: 3, is_active: 1, permissions: JSON.stringify({ products: 'view', 'sales:amend': false, pos: true }) },
  roles: [{ id: 3, name: 'Cashier', permissions: JSON.stringify({ sales: 'view', settings: 'view', products: 'review', pos: true, 'sales:status': false, contacts: true }) }],
  t: pack(language),
})
for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`AC-B4 / B-R8 / B-M4 / B-M5: ${name} user detail names permissions, shows View, denials and individual exceptions`, async () => {
    const surface = await harness.mount({ component: 'components/users/UserDetailSheet.tsx', props: sheetProps(language), app: { t: pack(language) }, doubles: {} })
    const text = surface.text()
    assert.ok(!RAW_KEY.test(text.replace(/@dara/, '')), `raw key rendered: ${text.match(RAW_KEY)?.[0]}`)
    assert.ok(text.includes(`${language.perm_sales}`), 'a section reads by its label')
    assert.ok(text.includes(`${language.perm_sales} (${language.view})`) || text.includes(`${language.perm_settings ?? language.perm_section_settings} (${language.view})`), 'the View tier is shown')
    assert.ok(text.includes(`(${language.review_required})`), 'the Review tier is shown')
    assert.ok(text.includes(language.perm_switched_off_heading) && text.includes(`${language.perm_sales}: ${language.perm_act_sales_status}`), 'an explicit denial is listed by name')
    const two = language.perm_user_exceptions_other.replace('{n}', '3')
    assert.ok(text.includes(two), `individual exceptions are counted: ${two}`)
    await surface.unmount()
  })
}

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1

// User detail (AC-B4, B-R8, B-M4, B-M5): the sheet names every permission instead of printing its key, shows the
// View and Review levels, names the denials and counts individual exceptions. The role's permissions and the user's
// own exceptions each read as one line per module (PermissionSummaryList), from the same model as the role editor;
// the old chips, and the "Switched off" chip list, are gone (rolesListAndReview.test.ts pins the Employee case).
//
// Run: node tests/userDetailPermissions.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'
import { actionsForKey } from '../src/utils/permissionActions.ts'

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
const amend = actionsForKey('sales').find((action) => action.key === 'amend')
assert.ok(amend, 'the Sales table has an Amend action')

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`AC-B4 / B-R8 / B-M4 / B-M5: ${name} user detail names permissions, shows View and Review, names denials and counts individual exceptions`, async () => {
    const surface = await harness.mount({ component: 'components/users/UserDetailSheet.tsx', props: sheetProps(language), app: { t: pack(language) }, doubles: {} })
    const text = surface.text()
    assert.ok(!RAW_KEY.test(text.replace(/@dara/, '')), `raw key rendered: ${text.match(RAW_KEY)?.[0]}`)
    const [roleList, exceptionList] = surface.findAll((node) => node.tagName === 'UL')
    assert.ok(roleList && exceptionList, 'the role and the exceptions each read as a list')
    const lineOf = (list: typeof roleList, label: string) => list.querySelectorAll('li').find((line) => line.textContent.startsWith(label))
    const sales = lineOf(roleList, language.perm_section_sales)
    assert.ok(sales, 'a module reads by its label, one line each')
    assert.ok(sales.textContent.includes(language.view), 'the View level is shown')
    assert.ok(lineOf(roleList, language.perm_section_products)?.textContent.includes(language.review_required), 'the Review level is shown')
    assert.equal(roleList.querySelectorAll('li').length, 5, 'one line per module the role holds')
    const denial = exceptionList.querySelectorAll('li').find((line) => line.textContent.startsWith(language.perm_section_sales))
    assert.ok(denial?.textContent.includes(language[amend.shortTKey]), 'an explicit denial is named on its module line')
    const two = language.perm_user_exceptions_other.replace('{n}', '3')
    assert.ok(text.includes(two), `individual exceptions are counted: ${two}`)
    assert.ok(!/Switched off/i.test(text), 'no "Switched off" list: a denial rides its module line')
    await surface.unmount()
  })
}

for (const [name, language] of [['English', en], ['Khmer', km]] as const) {
  await test(`${name} user detail: a role reads Full in the Website Editor and the Library only for the grants it stores; Settings Full adds neither`, async () => {
    const props = {
      user: { id: 8, name: 'Sok', username: 'sok', role_id: 4, is_active: 1, permissions: '{}' },
      roles: [{ id: 4, name: 'Manager', permissions: JSON.stringify({ settings: true, customer_portal: true, portal_posts: true, portal_faq: true, portal_about: true, library: true }) }],
      t: pack(language),
    }
    const surface = await harness.mount({ component: 'components/users/UserDetailSheet.tsx', props, app: { t: pack(language) }, doubles: {} })
    const [roleList] = surface.findAll((node) => node.tagName === 'UL')
    const lines = roleList.querySelectorAll('li').map((line) => line.textContent)
    assert.equal(lines.length, 3, 'one line each for the three modules, and nothing else')
    assert.deepEqual(['perm_section_customer_portal', 'perm_section_settings', 'perm_section_library'].map((key, index) => lines[index].startsWith(language[key])), [true, true, true], 'in catalogue order')
    for (const line of lines) assert.ok(line.includes(language.label_full_access), `"${line}" reads Full`)
    const editor = lines[0]
    for (const word of ['perm_short_posts', 'faq', 'about']) assert.ok(editor.includes(language[word]), `the Website Editor line names ${word}`)
    assert.ok(editor.includes('+1'), 'and counts the fourth area')
    await surface.unmount()
  })
}

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1

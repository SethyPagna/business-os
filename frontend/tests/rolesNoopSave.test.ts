// The Roles modal does not send an edit that changed nothing (the Worker writes
// nothing either: cloudflare/scripts/test-role-update-concurrency-pure.cjs).
//
// Run: node tests/rolesNoopSave.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}


await test('Roles modal: an edit that changed nothing is not sent', () => {
  const users = read('../src/components/users/Users.tsx')
  const save = users.slice(users.indexOf('const handleSaveRole = async'), users.indexOf('const handleDeleteRole'))
  assert.ok(save.indexOf('if (selectedRole && !roleFormDirty)') > 0 && save.indexOf('if (selectedRole && !roleFormDirty)') < save.indexOf('getUsersApi().updateRole'))
})


await test('the shared "no changes" message exists in both language packs', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.ok(en.settings_no_changes && km.settings_no_changes && km.settings_no_changes !== en.settings_no_changes)
  assert.match(km.settings_no_changes, /[\u1780-\u17FF]/)
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nrolesNoopSave: all checks passed')

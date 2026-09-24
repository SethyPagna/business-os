import assert from 'node:assert/strict'
import fs from 'node:fs'

// Website Editor copy contracts (WEB-2, owner 24 Sep 2026).

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const catalogPage = read('../src/components/catalog/CatalogPage.tsx')
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))
const packs = [['en', en], ['km', km]] as const

// A rejected public website URL says what is wrong. The save guard used to
// reuse the field's InfoHint key, so typing "shop.example.com" and saving
// showed "Use a different public domain or Funnel URL here..." -- advice
// about when to fill the field, never that the value was rejected.
const guardAt = catalogPage.indexOf('if (sanitizedPublicUrl && ')
assert.ok(guardAt > 0, 'the editor save still validates the public website URL')
const guardBranch = catalogPage.slice(guardAt, catalogPage.indexOf('return', guardAt))
assert.match(guardBranch, /notify\(copy\('publicUrlInvalid', /, 'a rejected public URL shows its own error')
assert.doesNotMatch(guardBranch, /publicUrlHint/, 'the error toast must not reuse the InfoHint text')
for (const [name, pack] of packs) {
  assert.equal(typeof pack.publicUrlInvalid, 'string', `${name}.json carries publicUrlInvalid`)
  assert.notEqual(pack.publicUrlInvalid, pack.publicUrlHint, `${name}: the error differs from the hint`)
}
assert.match(km.publicUrlInvalid, /[ក-៿]/, 'the Khmer error is written in Khmer')

console.log('PASS websiteEditorCopy: Website Editor copy contracts hold')

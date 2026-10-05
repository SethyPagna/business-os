// The Website Editor's Save: after it, the whole storefront bootstrap is not
// re-read (that request is the heaviest one the app makes, and the save has just
// invalidated its cache) unless the Worker stored something other than what was
// sent; and the editor's own settings dispatch does not reload it again.
//
// Run: node tests/websiteEditorSaveNoReload.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}


await test('Website Editor: no storefront re-read after its own save unless the Worker normalised something; its own dispatch does not reload it', () => {
  const catalog = read('../src/components/catalog/CatalogPage.tsx')
  const save = catalog.slice(catalog.indexOf('async function savePortalDraft('), catalog.indexOf('async function askAssistant'))
  assert.match(save, /if \(settingsSaveNormalisedKeys\(result\)\.length\) \{\n\s+await loadPortal\(\)/)
  assert.equal((save.match(/await loadPortal\(\)/g) || []).length, 1, 'the one remaining reload is the conditional one')
  assert.match(catalog, /if \(syncChannel\.ownSettingsWrite\) return undefined/)
})


if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nwebsiteEditorSaveNoReload: all checks passed')

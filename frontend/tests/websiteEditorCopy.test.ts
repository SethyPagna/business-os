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
assert.match(km.publicUrlInvalid, /\p{Script=Khmer}/u, 'the Khmer error is written in Khmer')

// The admin page is the "Website Editor" (owner, 24 Sep 2026: "rename to
// Website Editor instead of customer portal"). Stored ids stay: the
// customer_portal key names, the customer_portal permission and the routes.
// A union merge of a branch cut before the rename would silently bring the
// old values back, so the name is pinned where each surface reads it.
const WE = { en: 'Website Editor', km: 'កម្មវិធីកែសម្រួលគេហទំព័រ' } as const
const leaf = (pack: Record<string, unknown>, dotted: string) =>
  dotted.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], pack)
for (const [name, pack] of packs) {
  for (const key of ['customer_portal', 'pages.portalEditor.customer_portal', 'perm_section_customer_portal', 'customerPortalTitle', 'studioTitle', 'pages.portalEditor.studioTitle', 'pages.portalEditor.previewBadge']) {
    assert.equal(leaf(pack, key), WE[name], `${name}.json ${key} names the Website Editor`)
  }
  assert.equal(typeof pack.perm_section_customer_portal_desc, 'string', `${name}.json describes the Website Editor permission section`)
  // As a nested leaf, "language" flattened over the app-wide label and made
  // Settings title its language picker "Portal language".
  assert.equal(leaf(pack, 'pages.portalEditor.language'), undefined, `${name}.json must not shadow the app-wide "language" label`)
  assert.equal(typeof leaf(pack, 'pages.portalEditor.websiteLanguage'), 'string', `${name}.json labels the website language picker`)
}
assert.match(read('../src/AppContext.tsx'), /\n {2}customer_portal: 'Website Editor',/, 'first paint (CORE_ENGLISH_PACK) already says Website Editor')
assert.match(read('../src/components/navigation/Sidebar.tsx'), /if \(itemId === 'catalog'\) return 'Website Editor'/, 'the Sidebar fallback says Website Editor')
assert.match(read('../src/components/utils-settings/Settings.tsx'), /label !== 'customer_portal' \? label : 'Website Editor'/, 'the Settings nav fallback says Website Editor')

// No user-visible fallback in the editor's own files keeps the old name.
// Comments may still say "portal editor"; code text may not.
const stripComments = (source: string) => source
  .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, '$1')
  .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
const OLD_NAME = /customer portal|portal editor|portal studio|portal language|portal theme|portal intro/i
const catalogDir = new URL('../src/components/catalog/', import.meta.url)
const editorFiles = [
  ...fs.readdirSync(catalogDir).filter((file) => /\.tsx?$/.test(file)).map((file) => `../src/components/catalog/${file}`),
  '../src/components/navigation/Sidebar.tsx',
  '../src/components/utils-settings/Settings.tsx',
  '../src/components/receipt-settings/ReceiptSettings.tsx',
]
for (const file of editorFiles) {
  const match = stripComments(read(file)).match(OLD_NAME)
  assert.equal(match, null, `${file} still shows the old name: "${match?.[0]}"`)
}

console.log('PASS websiteEditorCopy: Website Editor copy contracts hold')

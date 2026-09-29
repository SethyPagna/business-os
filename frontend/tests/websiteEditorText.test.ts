// Website Editor labels come from the admin language pack only
// (EDITOR-REDESIGN-FINAL B1, B2; T-X1..T-X5).
//
// The editor used the storefront's copy(), which asks the storefront Khmer
// pack first: with the admin in Khmer, "About title" read អំពីយើង ("About us"),
// the language option read ភាសាដើម, and five labels had no Khmer at all.
//
// Run: node tests/websiteEditorText.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const editorDir = new URL('../src/components/catalog/editor/', import.meta.url)
const editorModules = (): Array<[string, string]> => [
  ['CatalogEditorSurface.tsx', read('../src/components/catalog/CatalogEditorSurface.tsx')],
  ...(fs.existsSync(editorDir) ? fs.readdirSync(editorDir).filter((file) => /\.tsx?$/.test(file)) : [])
    .map((file): [string, string] => [`editor/${file}`, read(`../src/components/catalog/editor/${file}`)]),
]
const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

type Pack = Record<string, unknown>
function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Pack)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') { flatten(value, target); continue }
    target[key] = String(value)
  }
  return target
}
const en = flatten(JSON.parse(read('../src/lang/en.json')))
const km = flatten(JSON.parse(read('../src/lang/km.json')))
const editorKeysIn = (pack: Record<string, string>) => Object.keys(pack).filter((key) => key.startsWith('web_editor_')).sort()

// What ED-0 moved off copy(): the design's 16 shadowed keys and B2's five
// pack-less labels, plus phone/email/address/call/logo, which P-RECON added to
// the storefront pack after the design was written.
const ED0_KEYS = [
  'web_editor_address', 'web_editor_call', 'web_editor_caution', 'web_editor_cover_preview',
  'web_editor_email', 'web_editor_facebook', 'web_editor_group_product_page', 'web_editor_instagram',
  'web_editor_lang_default', 'web_editor_logo', 'web_editor_messenger',
  'web_editor_more_details', 'web_editor_no_match', 'web_editor_no_questions', 'web_editor_phone',
  'web_editor_product_page_hint', 'web_editor_search_products', 'web_editor_section_about',
  'web_editor_selected_count', 'web_editor_shop_name', 'web_editor_telegram', 'web_editor_title', 'web_editor_website',
]

await runTest('T-X1: no editor label is read through copy() from a key the storefront Khmer pack also defines', () => {
  const packs = read('../src/components/catalog/portalLanguagePacks.ts')
  const kmPack = packs.slice(packs.indexOf('km: {'), packs.indexOf('export function getPortalLanguageText'))
  const storefrontKeys = new Set([...kmPack.matchAll(/^\s+([A-Za-z0-9_]+):\s*'/gm)].map((match) => match[1]))
  assert.ok(storefrontKeys.has('aboutTitle') && storefrontKeys.size > 50, 'parsed the storefront Khmer pack')
  const shadowed = editorModules().flatMap(([file, source]) => [...stripComments(source).matchAll(/\bcopy\(\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((key) => storefrontKeys.has(key))
    .map((key) => `${file}: ${key}`))
  assert.deepEqual([...new Set(shadowed)].sort(), [], 'each of these shows the storefront wording in a Khmer editor')
})

await runTest('T-X2: ed() reads the admin pack even where the storefront pack has the same key', async () => {
  const { createEditorText } = await import('../src/components/catalog/editor/editorText.ts')
  const adminKm: Record<string, string> = { aboutTitle: 'ចំណងជើងអំពី', web_editor_title: 'ចំណងជើង' }
  const t = (key: string) => adminKm[key] ?? key
  const ed = createEditorText(t, 'km')
  assert.equal(ed('web_editor_title', 'Title', 'ចំណងជើង'), 'ចំណងជើង')
  assert.equal(ed('aboutTitle' as `web_editor_${string}`, 'About title', 'ចំណងជើងអំពី'), 'ចំណងជើងអំពី', 'the storefront pack says អំពីយើង for aboutTitle; the editor never reads it')
  assert.equal(ed('web_editor_missing', 'Missing', 'បាត់'), 'បាត់', 'a key the packs lack falls back to the inline Khmer')
  assert.equal(createEditorText((key) => key, 'en')('web_editor_missing', 'Missing', 'បាត់'), 'Missing')
  assert.equal(createEditorText((key) => key, 'fr')('web_editor_missing', 'Missing', 'បាត់'), 'Missing', 'any language but Khmer falls back to English')
  const editorText = read('../src/components/catalog/editor/editorText.ts')
  assert.doesNotMatch(editorText, /portalLanguagePacks|getPortalLanguageText|resolveStorefrontCopy/, 'editorText.ts never touches the storefront packs')
})

await runTest('T-X3: every ed() key exists in both packs, the web_editor_ key sets are equal, and the ED-0 labels use them', () => {
  const used = new Set(editorModules().flatMap(([, source]) => [...stripComments(source).matchAll(/\bed\(\s*'([^']+)'/g)].map((match) => match[1])))
  for (const key of ED0_KEYS) assert.ok(used.has(key), `the editor reads ${key} through ed()`)
  for (const key of used) {
    assert.ok(key.startsWith('web_editor_'), `${key}: ed() reads web_editor_ keys only`)
    assert.equal(typeof en[key], 'string', `en.json has ${key}`)
    assert.equal(typeof km[key], 'string', `km.json has ${key}`)
  }
  assert.deepEqual(editorKeysIn(km), editorKeysIn(en), 'en and km carry the same web_editor_ keys')
})

// Platform names and fixed codes the editor may show untranslated.
const LATIN_ALLOWED = ['Facebook', 'Instagram', 'Telegram', 'WhatsApp', 'Messenger', 'Google Maps', 'USD', 'KHR', 'AI', 'JSON']

await runTest('T-X4: no "Business OS", no English sentence fallback and no English JSX text in the editor', () => {
  for (const [file, source] of editorModules()) {
    const code = stripComments(source)
    const oldAppName = code.match(/['"`]Business OS['"`]/)?.[0]
    assert.equal(oldAppName, undefined, `${file}: the empty shop name falls back to the old app name`)
    const sentenceFallbacks = [...code.matchAll(/\|\|\s*'([^']*)'/g)].map((match) => match[1]).filter((text) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text))
    assert.deepEqual(sentenceFallbacks, [], `${file}: English sentence fallbacks bypass both packs`)
    const jsxText = [...code.matchAll(/(?<![=-])>([^<>{}=;():]+)</g)].map((match) => match[1].trim()).filter(Boolean)
      .filter((text) => /[A-Za-z]{3,}/.test(LATIN_ALLOWED.reduce((rest, name) => rest.split(name).join(''), text)))
    assert.deepEqual(jsxText, [], `${file}: JSX text in English`)
  }
})

const KM_LATIN_ALLOWED = [...LATIN_ALLOWED, 'https', 'm.me', 't.me', 'ig.me', 'wa.me', '/api', '/uploads', '/health', '[[Leang Cosmetics]]']
const COENG_TA_SPELLINGS = ['សេចក្តី', 'ប្តូរ', 'ដណ្តប់']

await runTest('T-X5: web_editor_ Khmer values use Latin only for platform names and one spelling per word', () => {
  const keys = editorKeysIn(km)
  for (const key of ED0_KEYS) assert.ok(keys.includes(key), `km.json has ${key}`)
  for (const key of keys) {
    const value = km[key]
    const withoutAllowed = KM_LATIN_ALLOWED.reduce((rest, token) => rest.split(token).join(''), value.replace(/\{[a-z_]+\}/g, ''))
    assert.doesNotMatch(withoutAllowed, /[A-Za-z]/, `km.json ${key} mixes English into Khmer: ${value}`)
    for (const spelling of COENG_TA_SPELLINGS) assert.ok(!value.includes(spelling), `km.json ${key} spells ${spelling} with coeng TA; the editor uses coeng DA`)
  }
})

if (failed) {
  console.error(`\n${failed} failing`)
  process.exit(1)
}
console.log('\nwebsiteEditorText: all passing')

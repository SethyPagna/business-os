import assert from 'node:assert/strict'
import fs from 'node:fs'

// The Announcement Strip editor reads every user-visible string from the
// language packs (owner, 24 Sep 2026: both packs, no English placeholder in
// km). Until then it deliberately kept its copy in English and this file
// pinned that; it now pins the opposite: no English literal left in the UI,
// and every key it reads resolves in both packs with real Khmer.

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const source = read('../src/components/catalog/ManagePromotionsModal.tsx')
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))

// Same flattening as AppContext's flattenTranslationTree: leaf key, last
// visited wins. That is what t(key) actually returns at runtime.
type Pack = Record<string, string>
function flatten(node: unknown, target: Pack = {}): Pack {
  if (!node || typeof node !== 'object') return target
  for (const [key, value] of Object.entries(node)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') flatten(value, target)
    else target[key] = String(value)
  }
  return target
}
const enPack = flatten(en)
const kmPack = flatten(km)
const KHMER = /\p{Script=Khmer}/u

// 1. Every copy('key', 'fallback') call resolves in both packs; the Khmer
//    value is Khmer, and the fallback (shown before the packs load) says
//    what the English pack says.
const calls = [...source.matchAll(/\bcopy\('([A-Za-z0-9_]+)', ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\)/g)]
  .map((match) => ({ key: match[1], fallback: match[2].slice(1, -1).replace(/\\'/g, "'") }))
const presets = [...source.matchAll(/\{ key: '(color_[a-z]+)', label: '([^']+)', value: '#[0-9a-f]{6}' \}/g)]
  .map((match) => ({ key: match[1], fallback: match[2] }))
assert.ok(calls.length >= 40, `expected the modal to read its copy through copy(), found ${calls.length} calls`)
assert.equal(presets.length, 7, 'every badge colour swatch has a translated name')
for (const { key, fallback } of [...calls, ...presets]) {
  assert.ok(enPack[key], `en.json must carry '${key}'`)
  assert.ok(kmPack[key], `km.json must carry '${key}'`)
  assert.match(kmPack[key], KHMER, `km '${key}' must be Khmer, found ${JSON.stringify(kmPack[key])}`)
  assert.equal(fallback, enPack[key], `copy('${key}') fallback must match the English pack`)
}

// 2. With every copy(...) call, the swatch table (checked above) and every
//    comment removed, no English text is left anywhere a user can see or
//    hear it.
const stripped = source
  .replace(/\bcopy\((?:'[^']*'|[a-z.]+), (?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[a-z.]+)\)/g, 'COPY')
  .replace(/\{ key: 'color_[a-z]+', label: '[^']+', value: '#[0-9a-f]{6}' \}/g, 'SWATCH')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1')
const leaks: Array<[string, RegExp]> = [
  ['JSX text', />\s*[A-Za-z][A-Za-z ,.'"!?()-]*\s*</],
  ['string title/placeholder/aria attribute', /\b(?:title|placeholder|aria-label|ariaLabel)="[^"]*[A-Za-z][^"]*"/],
  ['bare notify message', /notify\('/],
  ['bare validation message', /return '[A-Z]/],
  ['bare select option label', /label: '[A-Z]/],
  ['bare English string', /'[A-Z][a-z]+(?: [A-Za-z]+)*[.!?…]?'/],
  // A native confirm's OK/Cancel follow the browser, never the app language.
  ['native confirm', /window\.confirm\(/],
  ['English template text', /`[A-Z][a-z]+ [^`]*\$\{/],
]
for (const [label, pattern] of leaks) {
  const hit = stripped.match(pattern)
  assert.ok(!hit, `ManagePromotionsModal still shows English (${label}): ${hit?.[0]}`)
}

// 3. Behaviour the i18n pass must not have lost.
assert.match(source, /isSafeLinkUrl\(form\.link_url\)/, 'the link error stays backed by the shared URL allowlist')
assert.match(source, /unsavedChanges=\{\{ dirty: editingId !== null \}\}/, 'closing with an open editor still guards the draft')
assert.match(source, /\{copy\('cancel', 'Cancel'\)\}/, 'the edit form keeps its Cancel action')
// Deleting a card asks through the shared ConfirmDialog, stacked above this
// modal, and shows the card's own values rather than a bare yes/no.
assert.match(source, /<ConfirmDialog[\s\S]*?layer="nested"[\s\S]*?danger[\s\S]*?items=\{deleteReviewItems\(pendingDelete\)\}/, 'the delete confirmation is the shared dialog with the card under review')
for (const key of ['title', 'linksTo', 'status', 'showFromAria', 'showUntilAria']) {
  assert.match(source.slice(source.indexOf('const deleteReviewItems')), new RegExp(`label: copy\\('${key}'`), `the delete review shows the card's ${key}`)
}
assert.match(source, /onClick=\{\(\) => setPendingDelete\(promo\)\}/, 'the row Delete button opens the review, it does not delete')
for (const key of ['image', 'noImage', 'uploading', 'replaceImage', 'uploadImage']) {
  assert.match(source, new RegExp(`copy\\('${key}'`), `media control keeps copy('${key}', ...)`)
}

console.log(`PASS announcementStripI18n: ${calls.length + presets.length} strings read from both packs, no English literal left`)

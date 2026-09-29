// The About picture (AB-F): the owner uploads a square poster in Website
// Editor > About and the About page shows it whole, under the shop-name card.
// The Worker stores only this site's own uploads and refuses anything else
// with invalid_about_image (cloudflare/src/routes/settings.ts).
//
// Run: node tests/portalAboutPicture.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canWriteSettingKey } from '../src/utils/portalPermissions.ts'

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

type Mod = typeof import('../src/components/catalog/portalEditorDraft.ts')
let mod: Mod | null = null
try {
  mod = await import('../src/components/catalog/portalEditorDraft.ts')
} catch (error) {
  console.error('portalEditorDraft.ts could not be loaded:', (error as Error).message)
}
const need = (): Mod => { assert.ok(mod, 'components/catalog/portalEditorDraft.ts exists'); return mod! }

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

const page = () => code(read('../src/components/catalog/CatalogPage.tsx'))
const surface = () => code(read('../src/components/catalog/CatalogEditorSurface.tsx'))
const tabs = () => code(read('../src/components/catalog/CatalogSecondaryTabs.tsx'))
const imageField = () => code(read('../src/components/catalog/CatalogImageField.tsx'))

await runTest('AF-1 markup: the About page shows the picture whole, in a square box, right under the shop-name card', () => {
  const about = between(tabs(), 'function CatalogAboutSection(', '\nfunction CatalogFaqSection(')
  const figureAt = about.indexOf('data-portal-about-picture')
  assert.ok(figureAt > about.indexOf('data-portal-about-hero'), 'after the shop-name card')
  assert.ok(figureAt < about.indexOf('lg:grid-cols-[1fr,1.4fr]'), 'before the story and contact row')
  const figure = about.slice(about.lastIndexOf('<figure', figureAt), about.indexOf('</figure>', figureAt))
  assert.match(figure, /className="[^"]*\baspect-square\b[^"]*"/, 'a square box')
  assert.match(figure, /\bmax-w-\[640px\]/)
  assert.match(figure, /\bmx-auto\b/)
  assert.match(figure, /<img[\s\S]*className="h-full w-full object-contain"/, 'the whole picture, never cropped')
  assert.doesNotMatch(figure, /object-cover|max-h-|overflow-hidden|rounded|absolute/, 'nothing crops, caps or covers the poster')
  assert.match(figure, /loading="eager"/)
  assert.match(figure, /decoding="async"/)
  assert.match(figure, /alt=\{aboutImageAlt \|\| /, 'described by the owner, else named by the shop')
  assert.match(figure, /<button[\s\S]*onClick=\{\(\) => openPortalImage\([^)]*\[aboutImage\]\)\}/, 'a tap opens the viewer on the same picture')
  assert.match(about, /\{aboutImage \? \(\s*<figure/, 'no picture, no empty box')
})

await runTest('round trip: the two settings are in the defaults, the draft, the preview and the Save', () => {
  const source = page()
  const defaults = between(source, 'const DEFAULT_CONFIG = {', '\n}\n')
  assert.match(defaults, /\n {2}aboutImage: '',\n/)
  assert.match(defaults, /\n {2}aboutImageAlt: '',\n/)
  const draft = between(source, 'function buildDraft(config: PortalConfig): PortalDraft {', '\n}\n')
  assert.match(draft, /\n {4}customer_portal_about_image: config\.aboutImage \|\| '',\n/, 'one 4-space line, the Worker ratchet parses it')
  assert.match(draft, /\n {4}customer_portal_about_image_alt: config\.aboutImageAlt \|\| '',\n/)
  const preview = between(source, 'function applyDraft(config: PortalConfig, draft: PortalDraft): PortalConfig {', '\n}\n')
  assert.match(preview, /aboutImage: String\(draft\.customer_portal_about_image \|\| ''\)\.trim\(\),/)
  assert.match(preview, /aboutImageAlt: String\(draft\.customer_portal_about_image_alt \|\| ''\)\.trim\(\),/)
  const save = between(source, 'async function savePortalDraft(', '\n  async function ')
  const payload = between(save, 'const fullSavePayload', 'const privateAiChanges = privateAiSaveChanges(privateAi)')
  assert.match(payload, /customer_portal_about_image: aboutImagePath,/)
  assert.match(payload, /customer_portal_about_image_alt: String\(editorDraft\.customer_portal_about_image_alt \|\| ''\)\.trim\(\),/)
  const picker = between(source, 'function handleFilePickerSelect(', '\n  }\n')
  assert.match(picker, /targetKey === 'customer_portal_about_image'/, 'Library can fill the picture')
})

await runTest('AF-5: an About grant writes the picture; a posts-only grant does not', () => {
  for (const key of ['customer_portal_about_image', 'customer_portal_about_image_alt']) {
    assert.equal(canWriteSettingKey(key, (permission) => permission === 'portal_about'), true, `${key} with Manage About`)
    assert.equal(canWriteSettingKey(key, (permission) => permission === 'portal_posts'), false, `${key} with posts only`)
    assert.equal(canWriteSettingKey(key, (permission) => permission === 'customer_portal'), false, `${key} is not portal config`)
  }
})

await runTest('the Save sends only a picture uploaded to this site, as the site path the Worker stores', () => {
  const m = need()
  const thisSite = (path: string) => `http://127.0.0.1:4318${path}`
  assert.equal(m.siteUploadPath('/uploads/poster.webp?v=3', thisSite), '/uploads/poster.webp?v=3')
  assert.equal(m.siteUploadPath('http://127.0.0.1:4318/uploads/poster.webp?v=3', thisSite), '/uploads/poster.webp?v=3', 'an upload shown through this site keeps only its path')
  assert.equal(m.siteUploadPath('', thisSite), '')
  assert.equal(m.siteUploadPath('   ', thisSite), '')
  for (const refused of ['https://tracker.example/uploads/p.gif', '//evil.example/uploads/p.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'blob:http://127.0.0.1:4318/1', 'uploads/p.png', '/files/p.png']) {
    assert.equal(m.siteUploadPath(refused, thisSite), null, `${refused} is refused before it is sent`)
  }
})

await runTest('AF-A3: the Worker refusal is recognised by its code only', () => {
  const m = need()
  assert.equal(m.isAboutImageRefusal({ success: false, error: { code: 'invalid_about_image' } }), true)
  assert.equal(m.isAboutImageRefusal({ success: false, error: { code: 'write_conflict' } }), false)
  assert.equal(m.isAboutImageRefusal({ success: false, error: new Error('The About picture must be a picture uploaded to this site.') }), false, 'never by its English text')
  assert.equal(m.isAboutImageRefusal({ success: true }), false)
  assert.equal(m.isAboutImageRefusal(null), false)
})

await runTest('AF-A3 wiring: a refused picture is named under its field and in the toast, and nothing is marked saved', () => {
  const source = page()
  const save = between(source, 'async function savePortalDraft(', '\n  async function ')
  const refusal = save.indexOf('if (isAboutImageRefusal(result)) showAboutImageRefusal(')
  assert.ok(refusal > 0, 'the Worker refusal is mapped')
  assert.ok(refusal < save.indexOf('if (result?.success === false) return'), 'before the failed save stops')
  const local = save.indexOf('if (aboutImagePath === null) {')
  assert.ok(local > 0 && local < save.indexOf('setEditorSaving(true)'), 'a picture from elsewhere is refused before anything is sent')
  const show = between(source, 'function showAboutImageRefusal(', '\n  }\n')
  assert.match(show, /notify\(copy\('aboutImageInvalid', /, 'the toast names the problem')
  assert.match(show, /setRefusedAboutImage\(/)
  assert.match(show, /setActiveEditorSection\('about'\)/, 'the editor opens the section holding the field')
  const context = between(source, 'const editorContextValue = {', '\n    }\n')
  assert.match(context, /\n\s+aboutImageRefused,\n/)
})

await runTest('AF-9 / T-L10: the About picture is upload-only, with its error line under the field', () => {
  const field = imageField()
  assert.match(field, /allowLink = true,/, 'every other picture keeps its link input')
  assert.match(field, /\{allowLink \? \(\s*<input\b/, 'the text input exists only when links are allowed')
  assert.match(field, /\{error \? <p id=\{errorId\} role="alert"/, 'the refusal is announced under the field')
  const editor = surface()
  const aboutPicture = editor.slice(editor.lastIndexOf('<ImageField', editor.indexOf('fieldId="portal-about-image"')), editor.indexOf('/>', editor.indexOf('fieldId="portal-about-image"')))
  assert.match(aboutPicture, /allowLink=\{false\}/, 'no pasted link: the Worker stores only uploads')
  assert.match(aboutPicture, /squarePreview/)
  assert.match(aboutPicture, /error=\{aboutImageRefused \? copy\('aboutImageInvalid', /)
  assert.match(aboutPicture, /infoHint=\{copy\('aboutImageHint', /)
  assert.doesNotMatch(aboutPicture, /\bonChange=/, 'nothing to type into')
})

await runTest('the About picture sits between the About title and the story, with its description capped like the Worker', () => {
  const editor = surface()
  const titleAt = editor.indexOf('id="portal-about-title"')
  const pictureAt = editor.indexOf('fieldId="portal-about-image"')
  const storyAt = editor.indexOf('id="portal-about-content"')
  assert.ok(titleAt > 0 && titleAt < pictureAt && pictureAt < storyAt, 'Title, Picture, Story')
  const description = between(editor, 'id="portal-about-image-alt"', '/>')
  assert.match(description, /name="customer_portal_about_image_alt"/)
  assert.match(description, /maxLength=\{ABOUT_IMAGE_DESCRIPTION_MAX_LENGTH\}/)
  const cap = Number(/const ABOUT_IMAGE_DESCRIPTION_MAX_LENGTH = (\d+)/.exec(editor)?.[1])
  const worker = read('../../cloudflare/src/routes/settings.ts')
  const altRule = between(worker, "attemptedKeys.includes('customer_portal_about_image_alt')", '\n  }\n')
  const workerCap = Number(/text\.length <= (\d+)/.exec(altRule)?.[1])
  assert.ok(workerCap > 0, 'read the Worker cap')
  assert.equal(cap, workerCap, 'the browser never accepts a description the Worker would cut')
  assert.match(editor, /<InfoHint label=\{copy\('aboutImageAlt', [^)]*\)\} text=\{copy\('aboutImageAltHint', /)
})

const NEW_KEYS = ['aboutImage', 'aboutImageHint', 'aboutImageAlt', 'aboutImageAltHint', 'aboutImageInvalid'] as const

await runTest('AF-6: both packs carry the five keys beside coverImage, top level and under the Website Editor group, Khmer in Khmer', () => {
  for (const name of ['en', 'km'] as const) {
    const raw = read(`../src/lang/${name}.json`)
    const pack = JSON.parse(raw) as Record<string, unknown> & { pages: { portalEditor: Record<string, unknown> } }
    const editorGroup = pack.pages.portalEditor
    for (const key of NEW_KEYS) {
      assert.equal(typeof pack[key], 'string', `${name}.json ${key}`)
      assert.equal(editorGroup[key], pack[key], `${name}.json pages.portalEditor.${key} matches the top-level value`)
      if (name === 'km') assert.match(String(pack[key]), /\p{Script=Khmer}/u, `km ${key} is Khmer`)
    }
    const groupStart = raw.indexOf('"portalEditor": {')
    for (const [from, to] of [[0, groupStart], [groupStart, raw.length]]) {
      const slice = raw.slice(from, to)
      const cover = slice.indexOf('"coverImage":')
      assert.ok(cover > -1, `${name}: coverImage in range`)
      const lines = slice.slice(0, cover).split('\n').length
      for (const key of NEW_KEYS) {
        const at = slice.indexOf(`"${key}":`)
        assert.ok(at > -1, `${name}: ${key} in range`)
        assert.ok(Math.abs(slice.slice(0, at).split('\n').length - lines) <= NEW_KEYS.length, `${name}: ${key} sits next to coverImage`)
      }
    }
  }
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.doesNotMatch(NEW_KEYS.map((key) => km[key]).join(' '), /(?<!ទាន់)សម័យ/)
})

await runTest('PWA-1 hand-over: the storefront tab title falls back to Leang Cosmetics, never the old name', () => {
  const source = read('../src/components/catalog/CatalogPage.tsx')
  assert.doesNotMatch(source, /Leang Beauty/)
  assert.match(page(), /document\.title = titleText \|\| 'Leang Cosmetics'/)
})

if (failed) {
  console.error(`\n${failed} failing`)
  process.exit(1)
}
console.log('\nportalAboutPicture: all passing')

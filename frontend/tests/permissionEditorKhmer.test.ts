// The role editor must read in Khmer: module names, None / View / Review / Full, every action chip and the
// View-is-on lock tooltip. It is mounted for real here (every row open, since a row's chips live in its panel) in
// Khmer and in English with a translator that records every key the pack cannot answer, and the Users call site
// must pass that translator.
//
// Run: node tests/permissionEditorKhmer.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const usersSource = read('../src/components/users/Users.tsx')

const harness = await createHarness()
const live: MountedSurface[] = []

type Definition = { key: string; tier?: boolean; middleTier?: string }
const definitions: Definition[] = PERMISSION_SECTIONS.flatMap((section) => section.permissions as Definition[])
// Every module at its middle level (Review or View), so queued chips, limited chips and the per-module tier text
// all render; contacts is at Full with Add on and View off, so the View chip shows locked.
const mixed: Record<string, unknown> = {}
for (const permission of definitions) mixed[permission.key] = permission.tier ? (permission.middleTier === 'view' ? 'view' : 'review') : true
delete mixed.all
Object.assign(mixed, { contacts: true, 'contacts:add': true, 'contacts:view': false })
// Every module at Full: the chips a middle level hides show, and so do the followed controls.
const everything: Record<string, unknown> = {}
for (const permission of definitions) everything[permission.key] = true
delete everything.all

const ancestors = (node: MemoryNode): MemoryNode[] => {
  const chain: MemoryNode[] = []
  for (let current = node.parentNode; current; current = current.parentNode) chain.push(current)
  return chain
}
const within = (node: MemoryNode, root: MemoryNode) => node === root || ancestors(node).includes(root)

async function render(pack: Record<string, string> | null, base: Record<string, unknown> = mixed, overrides: Record<string, unknown> = {}) {
  // The harness reads one shared document, so a second editor would be found beside the first: one at a time.
  for (const previous of live.splice(0)) await previous.unmount()
  const missing = new Set<string>()
  const t = pack ? (key: string) => { if (!(key in pack)) missing.add(key); return pack[key] } : undefined
  const surface = await harness.mount({
    component: 'components/users/PermissionEditor.tsx',
    props: { permissions: { ...base, ...overrides }, onChange: () => {}, ...(t ? { t } : {}) },
    app: { t: t ?? (() => undefined) },
    doubles: {},
  })
  live.push(surface)
  for (const id of surface.findAll((node) => node.getAttribute('data-perm-module') !== null).map((node) => node.getAttribute('data-perm-module') as string)) {
    const root = surface.find((node) => node.getAttribute('data-perm-module') === id, `module ${id}`)
    const toggle = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-expanded') !== null && within(node, root), `${id} expander`)
    if (toggle.getAttribute('aria-expanded') !== 'true') await surface.click(toggle)
  }
  // Every string a person can read or hear: text nodes, accessible names, tooltips and placeholders.
  const strings = surface.findAll(() => true).flatMap((node) => [
    node.childNodes.length === 1 && node.childNodes[0].nodeType === 3 ? node.textContent : '',
    node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '', node.getAttribute('placeholder') ?? '',
  ].filter(Boolean))
  return { surface, strings, missing }
}
// A phrase is shown when a string is it, or a tooltip made of it and other parts ("Full · ...").
const shows = (strings: string[], phrase: string) => strings.some((text) => text === phrase || text.split(/ · |, |: |\n/).includes(phrase))
const chipFor = (surface: MountedSurface, key: string) => surface.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('data-perm-action') === key)

let failed = 0
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) } finally {
    for (const surface of live.splice(0)) await surface.unmount()
  }
}

const ENGLISH_ONLY = ['None', 'Full', 'Administrator', 'Find permission', 'View and search', 'Add contact', 'Edit contact (name only; more in POS/sales)', 'On while Add or Edit is on.']

await test('CONTROL: without a translator the editor is English in any language', async () => {
  const { strings } = await render(null)
  for (const phrase of ENGLISH_ONLY) assert.ok(shows(strings, phrase) || strings.some((text) => text.includes(phrase)), `the fallback text "${phrase}" is what an untranslated editor shows`)
})

await test('Khmer: no English fallback string is rendered', async () => {
  const { strings } = await render(km)
  for (const phrase of ENGLISH_ONLY) assert.ok(!shows(strings, phrase) && !strings.some((text) => text.includes(phrase)), `Khmer render still shows English "${phrase}"`)
  assert.ok(strings.some((text) => text.includes(km.perm_view_implied)), 'the View lock tooltip is the Khmer string')
  assert.ok(shows(strings, km.none) && shows(strings, km.label_full_access) && shows(strings, km.review_required) && shows(strings, km.view), 'the four level words are Khmer')
  assert.ok(!strings.some((text) => /\bCustom\b/.test(text)), 'there is no Custom state to translate')
})

for (const [label, base] of [['mixed levels', mixed], ['every module at Full', everything]] as const) {
  await test(`every key the editor looks up exists in the Khmer pack, ${label} (fails loudly with the key names)`, async () => {
    const { missing } = await render(km, base)
    assert.deepEqual([...missing].sort(), [], `PermissionEditor asks for keys with no Khmer entry: ${[...missing].join(', ')}`)
  })

  await test(`every key the editor looks up exists in the English pack too, ${label}`, async () => {
    const { missing } = await render(en, base)
    assert.deepEqual([...missing].sort(), [], `PermissionEditor asks for keys with no English entry: ${[...missing].join(', ')}`)
  })
}

await test('every permission definition label, section and description key has a Khmer entry that is not the English text', async () => {
  const absent: string[] = []
  for (const section of PERMISSION_SECTIONS) {
    for (const key of [section.tKey, `${section.tKey}_desc`, ...section.permissions.map((permission: { tKey: string }) => permission.tKey)]) {
      if (!km[key]) absent.push(key)
    }
  }
  assert.deepEqual(absent, [], `missing Khmer permission keys: ${absent.join(', ')}`)
})

await test('every label, short-word and hint key in the permission tables has an entry in both packs', async () => {
  const sources = ['../src/utils/permissionActions.ts', '../src/components/users/permissionDefinitions.ts'].map(read)
  const keys = sources.flatMap((source) => [...source.matchAll(/\b(?:t|shortT|hintT|reviewT)Key: '([a-z0-9_]+)'/g)].map((match) => match[1]))
  assert.ok(keys.length > 120, 'the action and definition tables were found')
  assert.ok(keys.includes('perm_short_count') && keys.includes('perm_backup_restore_desc'), 'short words and hints are read too')
  for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
    const absent = keys.filter((key) => !pack[key])
    assert.deepEqual(absent, [], `${name} pack lacks action labels: ${absent.join(', ')}`)
  }
})

// POS is an on/off key, not a three-way module, and the Worker checks pos:manage_address_presets, so the editor
// draws its action chip too: its full words are the accessible name, so each assertion reads that one control.
await test('POS, an on/off key, lists its saved-address action chip in Khmer and in English', async () => {
  const khmer = await render(km)
  assert.equal(chipFor(khmer.surface, 'manage_address_presets')[0]?.getAttribute('aria-label'), km.manage_address_presets, 'the Khmer chip name is rendered')
  assert.ok(!khmer.strings.some((text) => text.includes(en.manage_address_presets)), 'no English label remains in the Khmer editor')
  const english = await render(en)
  assert.equal(chipFor(english.surface, 'manage_address_presets')[0]?.getAttribute('aria-label'), en.manage_address_presets, 'the English chip name is rendered')
})

await test('the POS chip follows the POS switch and an explicit false on the role', async () => {
  const on = chipFor((await render(en)).surface, 'manage_address_presets')[0]
  assert.ok(on, 'POS on: the chip renders')
  assert.equal(on.getAttribute('data-perm-mark'), 'allow', 'POS on: Allowed')
  assert.equal(on.getAttribute('aria-pressed'), 'true')
  assert.ok(on.getAttribute('aria-disabled') !== 'true', 'it can be switched off')
  const off = await render(en, mixed, { pos: false })
  assert.equal(chipFor(off.surface, 'manage_address_presets').length, 0, 'POS off: the module is at None, so no action is offered at all')
  const narrowed = chipFor((await render(en, mixed, { 'pos:manage_address_presets': false })).surface, 'manage_address_presets')[0]
  assert.equal(narrowed.getAttribute('data-perm-mark'), 'off', 'an explicit false is shown as switched off')
  assert.ok(/line-through/.test(narrowed.className), 'and struck through')
  assert.equal(narrowed.getAttribute('aria-pressed'), 'false')
  assert.ok(narrowed.getAttribute('aria-disabled') !== 'true', 'a switched-off chip can be handed back')
})

await test('CONTROL: an on/off key with no action table gets no action chips', async () => {
  const { surface } = await render(en)
  const library = surface.find((node) => node.getAttribute('data-perm-module') === 'library', 'library module')
  assert.ok(library, 'the Library module renders')
  assert.equal(surface.findAll((node) => node.getAttribute('data-perm-action') !== null && within(node, library)).length, 0, 'Library has no action chips, so its panel must not grow an empty chip row')
})

await test('the Users role form passes the translator to the lazy editor', async () => {
  const call = usersSource.match(/<LazyPermissionEditor[\s\S]*?\/>/)?.[0] ?? ''
  assert.match(call, /\bt=\{t\}/, 'Users.tsx must hand its translator to <LazyPermissionEditor>')
})

await harness.close()
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1

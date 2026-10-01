// RC2-HOTFIX: the Users role editor rendered <PermissionEditor> without the
// translator, so in Khmer the whole permission list (section headers, None /
// Full Access / Custom, every action row, the View-is-on lock tooltip) fell back
// to English. The editor is rendered for real here in Khmer and English with a
// translator that records every key the pack cannot answer; the Users call site
// must pass that translator.
//
// Run: node tests/permissionEditorKhmer.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const usersSource = readFileSync(new URL('../src/components/users/Users.tsx', import.meta.url), 'utf8')

// The shared InfoHint / AppSelect pull in portals and layout code; the editor's own
// text is what this test is about, so they render their label and nothing else.
const stubs: Record<string, string> = {
  InfoHint: `export default function InfoHint(props) { return null }`,
  AppSelect: `export default function AppSelect(props) { return null }`,
}
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  plugins: [{
    name: 'stub-shared-widgets',
    setup(b) {
      b.onResolve({ filter: /shared\/(InfoHint|AppSelect)\.tsx$/ }, (args) => ({ path: args.path.replace(/.*shared\/(\w+)\.tsx$/, '$1'), namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }))
    },
  }],
})
const mod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(nodeRequire, mod, mod.exports)
const PermissionEditor = mod.exports.default as React.ComponentType<Record<string, unknown>>

const { PERMISSION_SECTIONS } = await import('../src/components/users/permissionDefinitions.ts')

// Every section has exactly one key on and the rest off, so each one is "custom"
// and renders its per-key controls; contacts has Add on so View is shown locked.
const permissions: Record<string, unknown> = {}
for (const section of PERMISSION_SECTIONS) {
  section.permissions.forEach((permission: { key: string }, index: number) => { permissions[permission.key] = index === 0 })
}
Object.assign(permissions, { contacts: true, 'contacts:add': true, 'contacts:view': false })

function render(pack: Record<string, string> | null) {
  const missing = new Set<string>()
  const html = renderToStaticMarkup(React.createElement(PermissionEditor, {
    permissions, onChange: () => {},
    ...(pack ? { t: (key: string) => { if (!(key in pack)) missing.add(key); return pack[key] } } : {}),
  }))
  return { html, missing }
}

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const ENGLISH_ONLY = ['None', 'Full Access', 'Custom', 'View and search', 'Add contact', 'Edit contact (name only)', 'On while Add or Edit is on.']

test('CONTROL: without a translator the editor is English in any language (the reported bug)', () => {
  const { html } = render(null)
  for (const phrase of ENGLISH_ONLY) assert.ok(html.includes(phrase), `the fallback text "${phrase}" is what an untranslated editor shows`)
})

test('Khmer: no English fallback string from the report is rendered', () => {
  const { html } = render(km)
  for (const phrase of ENGLISH_ONLY) {
    assert.ok(!html.includes(`>${phrase}<`) && !html.includes(`"${phrase}`) && !html.includes(`${phrase}"`), `Khmer render still shows English "${phrase}"`)
  }
  assert.ok(html.includes(km.perm_view_implied), 'the View lock tooltip is the Khmer string')
  assert.ok(html.includes(km.none) && html.includes(km.label_full_access) && html.includes(km.permission_custom))
})

test('every key the editor looks up exists in the Khmer pack (fails loudly with the key names)', () => {
  const { missing } = render(km)
  assert.deepEqual([...missing].sort(), [], `PermissionEditor asks for keys with no Khmer entry: ${[...missing].join(', ')}`)
})

test('every key the editor looks up exists in the English pack too', () => {
  const { missing } = render(en)
  assert.deepEqual([...missing].sort(), [], `PermissionEditor asks for keys with no English entry: ${[...missing].join(', ')}`)
})

test('every permission definition label, section and description key has a Khmer entry that is not the English text', () => {
  const absent: string[] = []
  for (const section of PERMISSION_SECTIONS) {
    for (const key of [section.tKey, `${section.tKey}_desc`, ...section.permissions.map((permission: { tKey: string }) => permission.tKey)]) {
      if (!km[key]) absent.push(key)
    }
  }
  assert.deepEqual(absent, [], `missing Khmer permission keys: ${absent.join(', ')}`)
})

test('every per-action key in permissionActions.ts has an entry in both packs', () => {
  const source = readFileSync(new URL('../src/utils/permissionActions.ts', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/tKey: '([a-z0-9_]+)'/g)].map((match) => match[1])
  assert.ok(keys.length > 40, 'the action table was found')
  for (const [name, pack] of [['English', en], ['Khmer', km]] as const) {
    const absent = keys.filter((key) => !pack[key])
    assert.deepEqual(absent, [], `${name} pack lacks action labels: ${absent.join(', ')}`)
  }
})

test('the Users role form passes the translator to the lazy editor', () => {
  const call = usersSource.match(/<LazyPermissionEditor[\s\S]*?\/>/)?.[0] ?? ''
  assert.match(call, /\bt=\{t\}/, 'Users.tsx must hand its translator to <LazyPermissionEditor>')
})

console.log(failed ? `\n${failed} test(s) FAILED` : '\nall tests passed')
if (failed) process.exitCode = 1

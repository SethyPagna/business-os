// A failed or partial Save never blanks the Settings page, never reads as saved,
// and never throws the person's edits away (owner, 5 Oct 2026: "a Settings page
// once went blank after saving").
//
//   - a section that throws is replaced in place by an alert; the Save row and the
//     unsaved draft (which live above the boundary) stay;
//   - the form is diffed against the snapshot it hydrated from, so only what the
//     person changed is sent;
//   - a failed save keeps the form dirty and shows an inline error instead of
//     clearing the dirty flag (which let the next refresh refill the form from the
//     old server values);
//   - "keep server" / "reload latest" never replace the form with a conflict's
//     partial key set.
//
// Run: node tests/settingsPageSaveGuards.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}


// ------------------------------------------------------- 4. the render boundary
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const boundarySource = read('../src/components/utils-settings/SettingsRenderBoundary.tsx')
const boundaryModule = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', transformSync(boundarySource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
  (id: string) => require(id), boundaryModule, boundaryModule.exports,
)
type BoundaryClass = new (props: Record<string, unknown>) => { state: { error: unknown }; render: () => unknown; componentDidUpdate: (previous: Record<string, unknown>) => void; setState: (next: unknown) => void; props: Record<string, unknown> }
const BoundaryClass = ((boundaryModule.exports as { default: unknown }).default) as BoundaryClass & { getDerivedStateFromError: (error: unknown) => { error: unknown } }

await test('a section that throws is replaced by an alert in place; the Save row beside it and the unsaved draft are untouched', () => {
  // React's server renderer has no error boundaries, so drive the class the way React does:
  // getDerivedStateFromError after the throw, then render().
  const props = { message: 'This part of Settings could not be shown. Your unsaved changes are kept.', actionLabel: 'Show again', resetKey: 'all', children: React.createElement('section', null, 'sections') }
  const boundary = new BoundaryClass(props)
  assert.equal(renderToStaticMarkup(boundary.render() as never), '<section>sections</section>', 'healthy: renders its children')
  boundary.state = BoundaryClass.getDerivedStateFromError(new Error('Cannot read properties of undefined (reading map)'))
  const page = renderToStaticMarkup(React.createElement('div', null,
    React.createElement('button', null, 'Save'),
    boundary.render() as never,
  ))
  assert.match(page, /<button>Save<\/button>/, 'the Save row is still there')
  assert.match(page, /role="alert"/)
  assert.match(page, /This part of Settings could not be shown\. Your unsaved changes are kept\./)
  assert.match(page, /Cannot read properties of undefined/, 'the cause is shown, not swallowed')
  assert.match(page, /Show again/)
  assert.doesNotMatch(page, /sections/, 'the broken block is not rendered')
})

await test('the boundary tries again when the section changes', () => {
  const boundary = new BoundaryClass({ message: 'm', actionLabel: 'a', resetKey: 'all', children: null })
  let cleared = false
  boundary.state = { error: new Error('x') }
  boundary.setState = (next: unknown) => { cleared = (next as { error: unknown }).error === null }
  boundary.componentDidUpdate({ ...boundary.props, resetKey: 'all' })
  assert.equal(cleared, false, 'same section: stays failed until asked')
  boundary.props = { ...boundary.props, resetKey: 'appearance' }
  boundary.componentDidUpdate({ resetKey: 'all' })
  assert.equal(cleared, true, 'a different section clears it')
})

// ------------------------------------------------------- 5. the Settings page wiring
const settingsPage = read('../src/components/utils-settings/Settings.tsx')
await test('Settings page: the form is diffed against the snapshot it hydrated from and only changes are sent', () => {
  assert.match(settingsPage, /loadedSnapshotRef\.current = \{ \.\.\.nextSettings \}\n\s+formHydratedRef\.current = true/, 'the snapshot is taken where the form is filled')
  assert.match(settingsPage, /const \{ changed \} = diffSettings\(sanitizedForm, loadedSnapshotRef\.current\)/)
  assert.match(settingsPage, /await saveSettings\(changed, \{\n\s+reason: 'settings-saved',/)
  assert.doesNotMatch(settingsPage, /await saveSettings\(sanitizedForm/, 'the whole form is no longer sent')
  assert.doesNotMatch(settingsPage, /\.\.\.\(settingsConflict\?\.serverSettings \|\| \{\}\),\n\s+\.\.\.form,/, 'the conflict retry no longer re-sends the whole form over the other device\'s values')
})

await test('Settings page: a failed save keeps the form dirty and says so; it is never marked saved', () => {
  const body = settingsPage.slice(settingsPage.indexOf('const handleSaveSettings = async'), settingsPage.indexOf('const runTelegramAction'))
  const failedBranch = body.indexOf("if (outcome === 'failed')")
  const markSaved = body.indexOf('formDirtyRef.current = false')
  assert.ok(failedBranch > 0 && markSaved > failedBranch, 'the failed branch returns before the dirty flag is cleared')
  assert.match(body.slice(failedBranch, markSaved), /setSaveError\(t\('settings_save_failed_kept'\)\)\n\s+return/)
  assert.match(settingsPage, /\{saveError \? \(\n\s+<div role="alert"/, 'the error is shown inline')
})

await test('Settings page: the payment-methods save does not announce success for a failed write', () => {
  const body = settingsPage.slice(settingsPage.indexOf('const savePaymentMethods'), settingsPage.indexOf('const refreshUnregisteredPaymentMethods'))
  assert.ok(body.indexOf('settingsSaveSucceeded(result)') > 0 && body.indexOf('settingsSaveSucceeded(result)') < body.indexOf("notify('Payment methods saved.'"))
})

await test('Settings page: "keep server" and "reload latest" never replace the form with the conflict\'s partial key set', () => {
  const keep = settingsPage.slice(settingsPage.indexOf('const keepServerSettings'), settingsPage.indexOf('const retrySaveWithLatest'))
  assert.match(keep, /setForm\(\{ \.\.\.loadedSnapshotRef\.current \}\)/)
  assert.doesNotMatch(keep, /setForm\(\{ \.\.\.\(settingsConflict\?\.serverSettings/)
  const reload = settingsPage.slice(settingsPage.indexOf('const reloadLatestSettings'), settingsPage.indexOf('const keepServerSettings'))
  assert.match(reload, /: \{ \.\.\.loadedSnapshotRef\.current, \.\.\.\(settingsConflict\?\.serverSettings \|\| \{\}\) \}/)
})

await test('Settings page: the sections sit inside the render boundary, the Save buttons outside it', () => {
  const open = settingsPage.indexOf('<SettingsRenderBoundary')
  const close = settingsPage.indexOf('</SettingsRenderBoundary>')
  assert.ok(open > 0 && close > open)
  assert.ok(settingsPage.indexOf('onClick={handleSaveSettings}') < open || settingsPage.indexOf('onClick={handleSaveSettings}', close) > close, 'the header Save is outside; the footer Save follows the boundary')
  assert.equal((settingsPage.slice(open, close).match(/onClick=\{handleSaveSettings\}/g) || []).length, 0)
})


await test('the Settings messages exist in both language packs, and Khmer is not the English text', () => {
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  for (const key of ['settings_save_failed_kept', 'settings_section_display_failed', 'settings_section_show_again']) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en ${key}`)
    assert.ok(typeof km[key] === 'string' && km[key].length > 0, `km ${key}`)
    assert.notEqual(km[key], en[key], `km ${key} is translated`)
    assert.match(km[key], /[\u1780-\u17FF]/, `km ${key} is Khmer script`)
  }
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nsettingsPageSaveGuards: all checks passed')

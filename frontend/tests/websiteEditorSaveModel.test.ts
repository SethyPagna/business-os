// The Website Editor save model (EDITOR-REDESIGN-FINAL B3, R5, 6.1, 6.6; T-S1..T-S4).
//
// Leaving the page, reloading or closing the tab lost every edit silently:
// the editor never joined the shared dirty-work registry, so the three-option
// leave guard, beforeunload and the sidebar dot never knew about it.
//
// Run: node tests/websiteEditorSaveModel.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyPrivateAiRead,
  createPrivateAiState,
  editPrivateAi,
  privateAiSaveChanges,
} from '../src/components/catalog/portalPrivateAi.ts'

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

type DraftModule = typeof import('../src/components/catalog/portalEditorDraft.ts')
const draftModule = await import('../src/components/catalog/portalEditorDraft.ts') as DraftModule & Record<string, unknown>

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}
const page = code(read('../src/components/catalog/CatalogPage.tsx'))
const savePortalDraftSource = (): string => between(page, 'async function savePortalDraft(', '\n  async function ')

await runTest('T-S1: the editor joins the dirty-work registry as the Website Editor on the catalog page', () => {
  const at = page.indexOf('registerDirtyWork({')
  assert.ok(at > 0, 'CatalogPage registers its unsaved edits (the guard, beforeunload and the sidebar dot read the registry)')
  const entry = page.slice(at, page.indexOf('\n    })', at))
  assert.match(entry, /key: WEBSITE_EDITOR_WORK_KEY,/)
  assert.match(page, /const WEBSITE_EDITOR_WORK_KEY = 'website-editor'/)
  assert.match(entry, /pageId: 'catalog',/, 'the page id the sidebar and navigateTo use (App.tsx)')
  assert.match(entry, /label: t\('studioTitle'\),/)
  assert.match(entry, /isDirty: \(\) => editedKeysRef\.current\.size > 0,/, 'dirtiness is read at navigation time, never from an older render')
  assert.match(entry, /save: async \(\) => \(await savePortalDraftRef\.current\(\)\)\.ok,/, 'Save and leave runs the latest save and leaves only when it landed')
  assert.match(entry, /discard: \(\) => discardPortalDraftRef\.current\(\),/)
  assert.match(page, /savePortalDraftRef\.current = savePortalDraft\n/)
  assert.match(page, /discardPortalDraftRef\.current = discardPortalDraft\n/)
  const depsAt = page.indexOf('\n  }, [', at)
  const effect = page.slice(page.lastIndexOf('useEffect(() => {', at), page.indexOf('\n', depsAt + 1))
  assert.match(effect, /if \(publicView \|\| !canEdit\) return undefined/, 'the storefront never registers')
  assert.match(effect, /return registerDirtyWork\(\{/, 'the entry is unregistered when the page unmounts')
  assert.match(effect, /\}, \[[^\]]*\beditorDirty\b[^\]]*\]\)/, 're-registered when dirtiness flips, so the sidebar dot re-reads it')
})

const LOADED_DRAFT = {
  business_name: 'Leang Cosmetics',
  customer_portal_business_tagline: 'Skincare and fragrance',
  customer_portal_low_stock_threshold: '10',
}
const STAFF = { customer_portal_low_stock_threshold: '4' }

await runTest('T-S2: Discard puts back the loaded values and drops the private assistant edits too (R5)', () => {
  const discardEditorDraft = draftModule.discardEditorDraft as DraftModule['discardEditorDraft'] | undefined
  assert.equal(typeof discardEditorDraft, 'function', 'portalEditorDraft.ts exports discardEditorDraft')
  let privateAi = editPrivateAi(applyPrivateAiRead(createPrivateAiState(), { customer_portal_ai_prompt: 'Stored rules' }), 'customer_portal_ai_prompt', 'Edited rules')
  assert.deepEqual(privateAiSaveChanges(privateAi).updates, { customer_portal_ai_prompt: 'Edited rules' }, 'fixture: the prompt edit would be saved')

  const discarded = discardEditorDraft!(LOADED_DRAFT, STAFF, privateAi)
  privateAi = discarded.privateAi
  const draft = { ...discarded.draft, customer_portal_business_tagline: 'New tagline' }
  const edited = draftModule.markEdited(discarded.editedKeys, 'customer_portal_business_tagline')

  assert.deepEqual([...edited], ['customer_portal_business_tagline'], 'only the edit made after Discard counts')
  const payload = Object.fromEntries(
    Object.entries({ ...draft, ...privateAiSaveChanges(privateAi).updates })
      .filter(([key]) => draftModule.isLoadedOrEditedKey(key, STAFF, edited)),
  )
  assert.equal(payload.customer_portal_business_tagline, 'New tagline')
  assert.equal(payload.business_name, 'Leang Cosmetics', 'the discarded shop name is not saved')
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'customer_portal_ai_prompt'), false, 'the discarded private prompt is not saved')
  assert.equal(payload.customer_portal_low_stock_threshold, '4', 'the loaded value is the stored one, never the editor default')
  assert.equal(privateAi.status, 'loaded', 'the stored private values stay loaded')
})

await runTest('T-S2 wiring: the guard\'s Discard rebuilds from the loaded config and clears pending uploads', () => {
  const discard = between(page, 'function discardPortalDraft() {', '\n  }\n')
  assert.match(discard, /discardEditorDraft\(buildDraft\(config\), staffSettingsRef\.current, privateAi\)/)
  assert.match(discard, /replaceEditedKeys\(discarded\.editedKeys\)/)
  assert.match(discard, /setEditorDraft\(discarded\.draft\)/)
  assert.match(discard, /setPrivateAi\(discarded\.privateAi\)/)
  assert.match(discard, /controller\.abort\(\)/, 'an upload in flight is cancelled')
  assert.match(discard, /clearPortalUploadPreview\(target\)/, 'pending preview blobs are released')
  assert.match(discard, /setMediaUploadStates\(\{\}\)/)
  const upload = between(page, 'async function uploadPortalMedia(', '\n  function cancelPortalMediaUpload(')
  assert.match(upload, /if \(!aliveRef\.current \|\| controller\.signal\.aborted\) return ''/, 'an upload Discard cancelled never writes its path back')
  assert.match(upload, /if \(aliveRef\.current && restorable\) \{/, 'an upload whose target was discarded never restores an old value, which would mark it edited again')
})

await runTest('T-S3: savePortalDraft answers { ok: true } only after a landed write, and { ok: false } on every other way out', () => {
  const save = savePortalDraftSource()
  assert.match(page, /async function savePortalDraft\(\): Promise<PortalSaveResult> \{/)
  const returns = [...save.matchAll(/\breturn\b([^\n]*)/g)].map((match) => match[1].trim())
  assert.ok(returns.length >= 10, `found the save's exits (${returns.length})`)
  const landed = returns.filter((value) => /^\{ ok: true \}$/.test(value))
  assert.equal(landed.length, 1, 'one success exit')
  const successAt = save.indexOf('return { ok: true }')
  assert.ok(successAt > save.indexOf('settleSavedEdits('), 'success is answered after the write settled')
  const refusals = returns.filter((value) => value !== '{ ok: true }')
  for (const value of refusals) {
    assert.match(value, /^(?:refuseSave\(|\{ ok: false\b)/, `every early exit answers false: "return ${value}"`)
  }
  const catchBlock = save.slice(save.lastIndexOf('} catch (error) {'))
  assert.match(catchBlock, /return \{ ok: false \}/, 'a thrown save answers false')
  assert.match(page, /type PortalSaveResult = \{ ok: true \} \| \{ ok: false; field\?: string; messageKey\?: string \}/)
})

await runTest('R-AB-F 2: a Save before the first load settled writes nothing and says why', () => {
  const save = savePortalDraftSource()
  const guardAt = save.indexOf('if (!editorBaselineLoadedRef.current) {')
  assert.ok(guardAt > 0, 'savePortalDraft refuses while nothing the draft holds came from the server')
  assert.ok(guardAt < save.indexOf('setEditorSaving(true)'), 'before anything is sent')
  assert.match(save.slice(guardAt), /^if \(!editorBaselineLoadedRef\.current\) \{\n\s*return refuseSave\('portalSettingsLoading', /, 'it answers false with the translated loading message')
  assert.match(page, /const editorBaselineLoadedRef = useRef\(false\)/, 'nothing is loaded when the editor opens')
  const reader = between(page, 'async function loadPrivateAiSettings(', '\n  }\n')
  assert.match(reader, /if \(staffSettings\) \{[^}]*editorBaselineLoadedRef\.current = true/, 'a landed staff read is a loaded baseline')
  const load = between(page, 'async function loadPortal() {', '\n  }\n')
  const editorBranch = load.slice(load.indexOf('\n      return\n    }\n'))
  const landedAt = editorBranch.indexOf('editorBaselineLoadedRef.current = true')
  assert.ok(landedAt > editorBranch.indexOf("throw new Error('Failed to load the website')"), 'only a bootstrap that carried a config sets it')
  assert.match(editorBranch, /else if \(!editorBaselineLoadedRef\.current\) setEditorDraft\(\(current\) => keepEditedValues\(overlayStaffSettings\(buildDraft\(nextConfig\), staffSettingsRef\.current\), current, editedKeysRef\.current\)\)/,
    'a first load that lands after an early edit fills every key the owner did not touch')
})

await runTest('R-AB-F 2: the first load keeps what was typed and takes the stored value for everything else', () => {
  const keepEditedValues = draftModule.keepEditedValues as ((loaded: Record<string, unknown>, current: Record<string, unknown>, edited: ReadonlySet<string>) => Record<string, unknown>) | undefined
  assert.equal(typeof keepEditedValues, 'function', 'portalEditorDraft.ts exports keepEditedValues')
  const stored = { business_name: 'Leang Cosmetics', customer_portal_business_tagline: 'Skincare and fragrance', customer_portal_logo_size: '120' }
  const beforeLoad = { business_name: 'Leang', customer_portal_business_tagline: '', customer_portal_logo_size: '80' }
  const draft = keepEditedValues!(stored, beforeLoad, new Set(['business_name']))
  assert.deepEqual(draft, { business_name: 'Leang', customer_portal_business_tagline: 'Skincare and fragrance', customer_portal_logo_size: '120' },
    'the default 80 and the empty tagline the editor opened with are never saved over the stored values')
})

if (failed) {
  console.error(`\n${failed} failing`)
  process.exit(1)
}
console.log('\nwebsiteEditorSaveModel: all passing')

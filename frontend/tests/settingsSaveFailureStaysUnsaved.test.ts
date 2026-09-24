// A failed settings write never shows as saved (WEB-2, owner 24 Sep 2026:
// the Website Editor must show what the server confirmed, not only what the
// editor guessed).
//
// AppContext.saveSettings does not throw when a write fails: it shows its
// own error toast and answers { success: false, error }. A caller that only
// checks `conflict` (or only catches) carries on as if the write landed. The
// Website Editor did exactly that: after a failed save it marked the whole
// draft saved -- posts and their order included -- disabled Save, and put
// the unsaved values into the preview's confirmed config.
//
// Pinned here:
//   1. the premise -- saveSettings answers a non-conflict failure with
//      { success: false } instead of throwing;
//   2. the Website Editor stops on that answer before anything marks the
//      draft saved.
//
// Run: node tests/settingsSaveFailureStaysUnsaved.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const appContext = read('../src/AppContext.tsx')
const catalogPage = read('../src/components/catalog/CatalogPage.tsx')

// 1. The premise.
const saveSettings = appContext.slice(appContext.indexOf('const saveSettings = useCallback('))
const saveSettingsBody = saveSettings.slice(0, saveSettings.indexOf('\n  }, ['))
assert.match(saveSettingsBody, /catch \(error: unknown\) \{[\s\S]*return \{ success: false, error \}/, 'saveSettings answers a failed write with { success: false } instead of throwing')

// 2. The Website Editor stops on it.
const saveStart = catalogPage.indexOf('async function savePortalDraft(')
assert.ok(saveStart >= 0, 'CatalogPage has savePortalDraft')
const save = catalogPage.slice(saveStart, catalogPage.indexOf('\n  async function ', saveStart + 1))
const call = save.indexOf('const result = await saveSettings(savePayload')
const conflict = save.indexOf('if (result?.conflict) {')
const failed = save.indexOf('if (result?.success === false) return')
const firstSavedMark = Math.min(...['setEditorDirty(false)', 'setConfig((current) => applyDraft(', "setDraft('customer_portal_logo_image'", 'setPromoItemsDraft(']
  .map((marker) => {
    const at = save.indexOf(marker)
    assert.ok(at > 0, `savePortalDraft still has ${marker}`)
    return at
  }))
assert.ok(call > 0, 'savePortalDraft saves through saveSettings')
assert.ok(failed > call, 'savePortalDraft checks for a failed write after saving')
assert.ok(conflict > call && conflict < firstSavedMark, 'a conflict stops before the draft is marked saved')
assert.ok(failed < firstSavedMark, 'a failed write stops before the draft (posts and their order included) is marked saved')

console.log('PASS settingsSaveFailureStaysUnsaved: a failed write leaves the Website Editor draft unsaved')

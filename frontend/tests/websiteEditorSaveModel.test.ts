// The Website Editor save model (EDITOR-REDESIGN-FINAL B3, R5, 6.1, 6.6; T-S1..T-S4).
//
// Leaving the page, reloading or closing the tab lost every edit silently:
// the editor never joined the shared dirty-work registry, so the three-option
// leave guard, beforeunload and the sidebar dot never knew about it.
//
// Run: node tests/websiteEditorSaveModel.test.ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
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

type LinkFields = { logo: unknown; cover: unknown; aboutBlocks: Array<{ mediaUrl?: unknown }>; promoItems: Array<{ mediaUrl?: unknown; linkUrl?: unknown }> }
type RefusedLink = { field: string; value: string } | null
const noLinks: LinkFields = { logo: '', cover: '', aboutBlocks: [], promoItems: [] }

await runTest('T-S4: an unsafe pasted link is refused with its field named, never silently dropped (R2)', () => {
  const findUnsafeLink = draftModule.findUnsafeLink as ((fields: LinkFields) => RefusedLink) | undefined
  assert.equal(typeof findUnsafeLink, 'function', 'portalEditorDraft.ts exports findUnsafeLink')
  for (const unsafe of ['javascript:alert(1)', '/\\evil.example', '//evil.example/x.png', 'data:text/html,hi']) {
    assert.deepEqual(findUnsafeLink!({ ...noLinks, aboutBlocks: [{ mediaUrl: '/uploads/a.png' }, { mediaUrl: unsafe }] }),
      { field: 'about_blocks[1].mediaUrl', value: unsafe }, `${unsafe} in a block picture is refused on that block`)
  }
  assert.deepEqual(findUnsafeLink!({ ...noLinks, aboutBlocks: [{ mediaUrl: 'javascript:alert(1)' }] }), { field: 'about_blocks[0].mediaUrl', value: 'javascript:alert(1)' })
  assert.deepEqual(findUnsafeLink!({ ...noLinks, promoItems: [{ mediaUrl: 'java\tscript:alert(1)' }] }), { field: 'promo_items[0].mediaUrl', value: 'java\tscript:alert(1)' })
  assert.deepEqual(findUnsafeLink!({ ...noLinks, promoItems: [{ linkUrl: 'javascript:alert(1)' }] }), { field: 'promo_items[0].linkUrl', value: 'javascript:alert(1)' })
  assert.deepEqual(findUnsafeLink!({ ...noLinks, promoItems: [{ linkUrl: 'www.example.test/sale' }] }), { field: 'promo_items[0].linkUrl', value: 'www.example.test/sale' },
    'a bare domain is refused with the message that asks for a full https:// link, never rewritten behind the owner')
  assert.deepEqual(findUnsafeLink!({ ...noLinks, logo: '//evil.example/logo.png' }), { field: 'customer_portal_logo_image', value: '//evil.example/logo.png' })
  assert.deepEqual(findUnsafeLink!({ ...noLinks, cover: 'javascript:alert(1)' }), { field: 'customer_portal_cover_image', value: 'javascript:alert(1)' })
  assert.equal(findUnsafeLink!({
    logo: '/uploads/logo.webp?v=2',
    cover: 'https://cdn.example.test/cover.jpg',
    aboutBlocks: [{ mediaUrl: '' }, { mediaUrl: '/uploads/about.png' }, {}],
    promoItems: [{ mediaUrl: '', linkUrl: 'https://example.test/sale' }, { linkUrl: '/catalog?promo=1' }],
  }), null, 'uploads, full https links, site paths and empty fields all pass')
})

await runTest('T-S4 wiring: the Save checks every pasted link before it writes and publishes the link it checked', () => {
  const save = savePortalDraftSource()
  const checkAt = save.indexOf('const refusedLink = findUnsafeLink(')
  assert.ok(checkAt > 0, 'savePortalDraft checks the links')
  assert.ok(checkAt < save.indexOf('setEditorSaving(true)'), 'before anything is sent')
  assert.match(save.slice(checkAt), /^const refusedLink = findUnsafeLink\(\{ logo: sanitizedLogoImage, cover: sanitizedCoverImage, aboutBlocks: sanitizedAboutBlocks, promoItems: sanitizedPromoItems \}\)\n\s*if \(refusedLink\) \{\n\s*setRefusedLink\(refusedLink\)\n\s*setActiveEditorSection\(sectionForLinkField\(refusedLink\.field\)\)\n\s*return refuseSave\('web_editor_link_invalid', /)
  assert.match(save, /linkUrl: String\(item\?\.linkUrl \|\| ''\)\.trim\(\),/, 'the card link sent is the one the check accepted')
  assert.doesNotMatch(save, /linkUrl: normalizeExternalUrl\(/, 'a refused link is never turned into an empty one instead')
})

// ---------------------------------------------------------------------------
// ED-1a (EDITOR-REDESIGN-REFRESH section C): the seven sections, the review, the bar's save states.
// ---------------------------------------------------------------------------
type SectionsModule = typeof import('../src/components/catalog/editor/editorSections.ts')
type ReviewModule = typeof import('../src/components/catalog/editor/saveReview.ts')
const loadSections = (): Promise<SectionsModule> => import('../src/components/catalog/editor/editorSections.ts')
const loadReview = (): Promise<ReviewModule> => import('../src/components/catalog/editor/saveReview.ts')
const surfaceSource = code(read('../src/components/catalog/CatalogEditorSurface.tsx'))
const keysOf = (block: string): string[] => [...block.matchAll(/^\s+((?:business|customer_portal)_[a-z0-9_]+):/gm)].map((match) => match[1])

await runTest('T-S5: every buildDraft key and every save-payload key maps to exactly one section or the hidden set, the seven U2 keys included', async () => {
  const { EDITOR_SECTIONS, HIDDEN_DRAFT_KEYS, sectionIdForKey } = await loadSections()
  const draftKeys = keysOf(between(page, 'function buildDraft(', '\n}\n'))
  assert.ok(draftKeys.length > 100, `parsed buildDraft (${draftKeys.length} keys)`)
  const payloadKeys = keysOf(between(savePortalDraftSource(), 'const fullSavePayload', 'const privateAiChanges'))
  assert.ok(payloadKeys.length > 100, `parsed the save payload (${payloadKeys.length} keys)`)
  const hidden = new Set<string>(HIDDEN_DRAFT_KEYS)
  for (const key of new Set([...draftKeys, ...payloadKeys])) {
    const section = sectionIdForKey(key)
    assert.ok(section !== null || hidden.has(key), `${key} is in no section and not in the hidden set`)
    assert.ok(section === null || !hidden.has(key), `${key} is both in a section and hidden`)
  }
  const u2 = ['customer_portal_grid_columns_auto', 'customer_portal_announcement_enabled', 'customer_portal_announcement_text_en', 'customer_portal_announcement_text_km',
    'customer_portal_announcement_link', 'customer_portal_announcement_start', 'customer_portal_announcement_end']
  for (const key of u2) {
    assert.ok(draftKeys.includes(key), `fixture: buildDraft still carries ${key}`)
    assert.equal(sectionIdForKey(key), key === 'customer_portal_grid_columns_auto' ? 'products' : 'posts', `${key} sits in its section`)
  }
  const all = EDITOR_SECTIONS.flatMap((section) => section.keys)
  assert.equal(new Set(all).size, all.length, 'a key belongs to one section only')
  assert.deepEqual(EDITOR_SECTIONS.map((section) => section.id), ['shop', 'contact', 'products', 'posts', 'about', 'faq', 'features'], 'the seven sections, in the bar\'s order')
  for (const section of EDITOR_SECTIONS) assert.equal(section.domId, `portal-section-${section.id}`)
})

await runTest('T-S7: no setDraft or update* call inside a useEffect of the editor modules', () => {
  const editorDir = new URL('../src/components/catalog/editor/', import.meta.url)
  const modules: Array<[string, string]> = [
    ['CatalogEditorSurface.tsx', surfaceSource],
    ...readdirSync(editorDir).filter((file) => /\.tsx?$/.test(file)).map((file): [string, string] => [`editor/${file}`, code(read(`../src/components/catalog/editor/${file}`))]),
  ]
  let effects = 0
  for (const [file, source] of modules) {
    for (const match of source.matchAll(/useEffect\(\(\) => \{/g)) {
      effects += 1
      let depth = 1
      let cursor = (match.index ?? 0) + match[0].length
      const start = cursor
      while (depth > 0 && cursor < source.length) {
        const char = source[cursor]
        if (char === '{') depth += 1
        else if (char === '}') depth -= 1
        cursor += 1
      }
      const body = source.slice(start, cursor)
      assert.doesNotMatch(body, /\bsetDraft\(|\bupdate[A-Z]\w*\(/, `${file}: an effect writes the draft (an effect-driven write marks the draft edited with nobody typing)`)
    }
  }
  assert.ok(effects >= 1, 'found the editor\'s effects')
})

await runTest('T-S8: the review lists one row per section that holds a change, in section order, counting changed keys', async () => {
  const { saveReviewRows } = await loadReview()
  const all = ['shop', 'contact', 'products', 'posts', 'about', 'faq', 'features'] as const
  assert.deepEqual(saveReviewRows(new Set(['customer_portal_faq_title', 'business_name']), all), [{ id: 'shop', count: 1 }, { id: 'faq', count: 1 }],
    'Shop before FAQ although the FAQ key was edited first')
  assert.deepEqual(saveReviewRows(new Set(['business_name', 'customer_portal_business_tagline', 'customer_portal_logo_size', 'business_phone']), all),
    [{ id: 'shop', count: 3 }, { id: 'contact', count: 1 }], 'the count is the number of changed keys in that section')
  assert.deepEqual(saveReviewRows(new Set(['customer_portal_ai_prompt', 'customer_portal_path']), all), [{ id: 'features', count: 2 }], 'the assistant prompt and the public path are both Features')
  assert.deepEqual(saveReviewRows(new Set(), all), [], 'nothing changed, nothing to review')
  assert.deepEqual(saveReviewRows(new Set(['not_a_setting', 'customer_portal_favicon_image']), all), [], 'a key with no section is not a row')
  assert.deepEqual(saveReviewRows(new Set(['business_name', 'customer_portal_faq_title']), ['faq']), [{ id: 'faq', count: 1 }], 'a section the person cannot see is never listed')
})

await runTest('T-S8: the bar\'s save state follows saving, then blocked, then changed, then the Saved flash', async () => {
  const { saveBarState } = await loadReview()
  const base = { dirty: false, saving: false, blockedReason: null, savedFlash: false } as const
  assert.equal(saveBarState(base), 'idle')
  assert.equal(saveBarState({ ...base, dirty: true }), 'changed')
  assert.equal(saveBarState({ ...base, blockedReason: 'uploads' }), 'blocked', 'an upload in flight blocks even with no edit yet: the upload lands as one')
  assert.equal(saveBarState({ ...base, dirty: true, blockedReason: 'loading' }), 'blocked')
  assert.equal(saveBarState({ ...base, dirty: true, saving: true, blockedReason: 'uploads' }), 'saving', 'a Save in flight is Saving, whatever else is true')
  assert.equal(saveBarState({ ...base, savedFlash: true }), 'saved')
  assert.equal(saveBarState({ ...base, dirty: true, savedFlash: true }), 'changed', 'an edit typed during the 2 s Saved flash ends it: Save is pressable at once')
  assert.equal(saveBarState({ ...base, savedFlash: true, blockedReason: 'uploads' }), 'blocked')
})

await runTest('T-S9: only the bar opens the review; the guard\'s Save & Leave reaches savePortalDraft with no review', () => {
  assert.doesNotMatch(page, /askToConfirm|useConfirmDialog|saveReview|saveReviewRows/, 'CatalogPage never asks: the review sits outside savePortalDraft')
  assert.doesNotMatch(savePortalDraftSource(), /askToConfirm|confirmDialog/, 'savePortalDraft itself never asks')
  const at = page.indexOf('registerDirtyWork({')
  const entry = page.slice(at, page.indexOf('\n    })', at))
  assert.match(entry, /save: async \(\) => \(await savePortalDraftRef\.current\(\)\)\.ok,/, 'the guard saves straight through the latest savePortalDraft')
  assert.match(surfaceSource, /useConfirmDialog\(t\)/, 'the surface owns the shared review dialog')
  const request = between(surfaceSource, 'const requestSave = async', '\n  }\n')
  assert.match(request, /askToConfirm\(\{[\s\S]*title: ed\('web_editor_review_title'[\s\S]*items:[\s\S]*confirmLabel: ed\('web_editor_save'/, 'title, items and the Save label')
  assert.ok(request.indexOf('askToConfirm(') < request.indexOf('await savePortalDraftRef.current()'), 'the save runs only after the review answered, and it runs the latest savePortalDraft')
  assert.match(request, /if \(!confirmed\) return/, 'Cancel does nothing')
  assert.match(surfaceSource, /onSave=\{requestSave\}/, 'the bar saves through the review')
  assert.doesNotMatch(surfaceSource, /onSave=\{savePortalDraft\}/, 'never straight to the write')
  assert.match(surfaceSource, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === 's'\) \{\s*event\.preventDefault\(\)\s*void requestSave(?:Ref\.current)?\(\)/, 'Ctrl/Cmd+S opens the same review (through a ref, so the listener always runs the latest closure)')
})

await runTest('T-S11: a bad announcement link or reversed days is refused before the write, with its field named', async () => {
  const { portalAnnouncementIssues } = await import('../src/components/catalog/portalAnnouncement.ts')
  assert.deepEqual(portalAnnouncementIssues({ link: 'javascript:alert(1)', start: '2026-11-10', end: '2026-11-12' }), { link: true, range: false })
  assert.deepEqual(portalAnnouncementIssues({ link: 'https://example.test/a', start: '2026-11-12', end: '2026-11-10' }), { link: false, range: true })
  const save = savePortalDraftSource()
  const checkAt = save.indexOf('portalAnnouncementIssues(')
  assert.ok(checkAt > 0, 'savePortalDraft checks the bar\'s link and days (today only the Worker does)')
  assert.ok(checkAt < save.indexOf('setEditorSaving(true)'), 'before anything is sent')
  const check = save.slice(checkAt, save.indexOf('setEditorSaving(true)'))
  assert.match(check, /refuseSave\('announcementBarLinkInvalid', [^\n]*'customer_portal_announcement_link'\)/, 'a bad link names its field')
  assert.match(check, /refuseSave\('announcementBarRangeInvalid', [^\n]*'customer_portal_announcement_end'\)/, 'a reversed range names its field')
  assert.match(save.slice(checkAt - 60, checkAt), /canEditConfig/, 'only a person who can write the bar is stopped by it (a posts-only save never sends these keys)')
  // A bad value that was ALREADY stored must not block an unrelated edit (a FAQ title) of someone who cannot even see the bar: the check runs only when
  // this draft touched an announcement key.
  assert.match(save.slice(checkAt - 400, checkAt), /const announcementEdited = \[\.\.\.editedKeysRef\.current\]\.some\(\(key\) => key\.startsWith\('customer_portal_announcement_'\)\)/)
  assert.match(save.slice(checkAt - 60, checkAt), /canEditConfig && announcementEdited \?/, 'both conditions gate the check')
})

await runTest('T-S12: every field sits in a section whose gate is the grant that saves it (show_about, the header colours, the product page)', async () => {
  const { EDITOR_SECTIONS, sectionIdForKey } = await loadSections()
  const { portalBucketForKey } = await import('../src/utils/portalPermissions.ts')
  const identity = new Set(['business_name', 'business_phone', 'business_email', 'business_address', 'business_legal_name', 'business_registration_number'])
  for (const section of EDITOR_SECTIONS) {
    for (const key of section.keys) {
      if (identity.has(key)) continue // Business identity has no section of its own: ED-2 shows these read-only with the reason (owner question 3)
      const bucket = portalBucketForKey(key)
      if (bucket === null) continue // a private-assistant key rides the config grant
      assert.ok((section.grants as readonly string[]).includes(bucket), `${key} saves through ${bucket}, but ${section.id} is gated by ${section.grants.join(' or ')}`)
    }
  }
  const sectionOf = (key: string) => EDITOR_SECTIONS.find((section) => section.id === sectionIdForKey(key))
  assert.deepEqual(sectionOf('customer_portal_show_about')?.grants, ['portal_about'], 'show_about is in About (it used to sit under the config grant)')
  for (const key of ['customer_portal_hero_gradient_start', 'customer_portal_hero_gradient_mid', 'customer_portal_hero_gradient_end']) {
    assert.deepEqual(sectionOf(key)?.grants, ['customer_portal'], `${key} is in a config section (it used to sit under the About grant)`)
  }
  for (const key of ['customer_portal_product_caution_default', 'customer_portal_product_need_more_details_default']) {
    assert.deepEqual(sectionOf(key)?.grants, ['customer_portal'], `${key} is in a config section (it used to sit under the About grant)`)
  }
  assert.deepEqual([...(sectionOf('customer_portal_announcement_link')?.grants ?? [])].sort(), ['customer_portal', 'portal_posts'], 'Posts is open to either grant: the bar needs config, the cards need posts')

  // The same fact in the markup: each setDraft / settingKey sits inside the container of its own section.
  const markers = EDITOR_SECTIONS.map((section) => ({ id: section.id, at: surfaceSource.indexOf(`id="${section.domId}"`) }))
  for (const marker of markers) assert.ok(marker.at > 0, `the surface renders #portal-section-${marker.id}`)
  assert.deepEqual([...markers].sort((a, b) => a.at - b.at).map((marker) => marker.id), markers.map((marker) => marker.id), 'the seven containers follow one another in section order')
  const end = surfaceSource.indexOf('</SectionShell>')
  let placed = 0
  for (const match of surfaceSource.matchAll(/setDraft\('([a-z_]+)'|settingKey="([a-z_]+)"/g)) {
    const key = match[1] || match[2]
    const at = match.index ?? 0
    if (at < markers[0].at || at > end) continue
    const holder = [...markers].reverse().find((marker) => marker.at <= at)
    assert.equal(holder?.id, sectionIdForKey(key), `${key} is edited inside #portal-section-${holder?.id} but belongs to ${sectionIdForKey(key)}`)
    placed += 1
  }
  assert.ok(placed > 80, `checked ${placed} field writes`)
})

await runTest('T-S12 wiring: CatalogPage\'s gate literal is the table in editorSections.ts, without importing it at run time (a catalog -> catalog-editor chunk cycle)', async () => {
  const { EDITOR_SECTIONS } = await loadSections()
  const gates = between(page, 'const sectionGates: Record<EditorSectionId, boolean> = {', '\n    }\n')
  const grantFlag: Record<string, string> = { customer_portal: 'canEditConfig', portal_posts: 'canEditPosts', portal_about: 'canEditAbout', portal_faq: 'canEditFaq' }
  const listed = [...gates.matchAll(/^\s+(\w+): ([^\n]+),$/gm)].map((match) => [match[1], match[2]])
  assert.deepEqual(listed.map(([id]) => id), EDITOR_SECTIONS.map((section) => section.id), 'every section, in order')
  for (const [id, expression] of listed) {
    const section = EDITOR_SECTIONS.find((candidate) => candidate.id === id)!
    assert.equal(expression, section.grants.map((grant) => grantFlag[grant]).join(' || '), `${id} is gated by the grants editorSections.ts names`)
  }
  assert.match(page, /import type \{ EditorSectionId \} from '\.\/editor\/editorSections\.ts'/, 'a type-only import: erased from the build')
  assert.doesNotMatch(page, /^import (?!type)[^\n]*['"]\.\/editor\//m, 'no run-time import of anything under editor/ (the lazy catalog-editor chunk already imports the catalog chunk)')
})

await runTest('ED-1a: the failed-save map -- links go to Posts/About/Shop, a map error to Contact, the path to Features, and a failed field is named', async () => {
  const { editorFieldTarget } = await loadSections()
  const ids = { promo: ['p-a', 'p-b'], about: ['b-a'] }
  assert.deepEqual(editorFieldTarget('customer_portal_path', ids), { section: 'features', elementId: 'portal-public-path' })
  assert.deepEqual(editorFieldTarget('customer_portal_public_url', ids), { section: 'features', elementId: 'portal-public-url' })
  assert.deepEqual(editorFieldTarget('customer_portal_translations', ids), { section: 'features', elementId: 'portal-translations-json' })
  assert.deepEqual(editorFieldTarget('customer_portal_google_maps_embed', ids), { section: 'contact', elementId: 'portal-google-map-embed' })
  assert.deepEqual(editorFieldTarget('customer_portal_show_catalog', ids), { section: 'products', elementId: 'portal-show-catalog' })
  assert.deepEqual(editorFieldTarget('customer_portal_announcement_link', ids), { section: 'posts', elementId: 'portal-announcement-link' })
  assert.deepEqual(editorFieldTarget('customer_portal_announcement_end', ids), { section: 'posts', elementId: 'portal-announcement-end' })
  assert.deepEqual(editorFieldTarget('customer_portal_about_image', ids), { section: 'about', elementId: 'portal-about-image' })
  assert.deepEqual(editorFieldTarget('promo_items[1].linkUrl', ids), { section: 'posts', elementId: 'portal-promo-link-p-b' })
  assert.deepEqual(editorFieldTarget('about_blocks[0].mediaUrl', ids), { section: 'about', elementId: 'portal-about-block-media-b-a' })
  assert.deepEqual(editorFieldTarget('customer_portal_logo_image', ids), { section: 'shop', elementId: 'portal-logo-image' })
  assert.equal(editorFieldTarget('promo_items[5].linkUrl', ids), null, 'a card that is gone has no field to focus')
  assert.equal(editorFieldTarget('something_else', ids), null)
  const links = between(page, 'function sectionForLinkField(', '\n}\n')
  assert.match(links, /startsWith\('about_blocks\['\)\) return 'about'/)
  assert.match(links, /startsWith\('promo_items\['\)\) return 'posts'/, 'a post card link is in Posts now, not the old Display tab')
  assert.match(links, /return 'shop'/, 'the logo and cover are in Shop')
})

await runTest('ED-1a: the landing section is the stored one when the role can see it, else the first it can; a blocked store is not an error', async () => {
  const { landingEditorSection, readStoredEditorSection, writeStoredEditorSection, EDITOR_SECTION_STORAGE_KEY } = await loadSections()
  assert.equal(EDITOR_SECTION_STORAGE_KEY, 'business-os-website-editor-section-v1')
  assert.equal(landingEditorSection('faq', ['posts', 'faq']), 'faq')
  assert.equal(landingEditorSection('shop', ['posts', 'faq']), 'posts', 'the stored Shop is not visible to this role: the first visible')
  assert.equal(landingEditorSection(null, ['about', 'faq']), 'about')
  assert.equal(landingEditorSection('nonsense', ['about']), 'about')
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  writeStoredEditorSection('contact', storage)
  assert.equal(readStoredEditorSection(storage), 'contact')
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(readStoredEditorSection(blocked), null, 'a blocked read falls back')
  assert.doesNotThrow(() => writeStoredEditorSection('contact', blocked), 'a blocked write is ignored')
})

if (failed) {
  console.error(`\n${failed} failing`)
  process.exit(1)
}
console.log('\nwebsiteEditorSaveModel: all passing')

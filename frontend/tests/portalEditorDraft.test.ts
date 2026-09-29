// The Website Editor round trip: no setting the storefront does not publish is
// reset to its default and saved back, and a Save never puts back an edit
// typed while it was in flight (EDITOR-REDESIGN-FINAL B4, PUBLIC-PAINT D7).
//
// Run: node tests/portalEditorDraft.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

// The draft the editor builds from the storefront config when the owner has
// switched the top-seller badge off and set a ranked count of 5: the public
// config carries neither, so buildDraft falls back to the editor defaults.
const DRAFT_FROM_PUBLIC_CONFIG = {
  business_name: 'Leang Cosmetics',
  customer_portal_business_tagline: 'Skincare and fragrance',
  customer_portal_logo_size: '80',
  customer_portal_show_top_seller_badge: true,
  customer_portal_highlight_rank_limit: '3',
  customer_portal_about_title: '',
  customer_portal_show_membership: false,
}
// GET /api/settings for the same shop: what is actually stored.
const STAFF_SETTINGS = {
  business_name: 'Leang Cosmetics',
  customer_portal_logo_size: '120',
  customer_portal_show_top_seller_badge: 'false',
  customer_portal_highlight_rank_limit: '5',
  customer_portal_show_membership: 'true',
  receipt_template: 'not an editor key',
  updatedAt: '2026-09-29 00:00:00',
}

await runTest('T-D1: the stored staff settings replace the defaults the public config could not supply', () => {
  const m = need()
  const draft = m.overlayStaffSettings(DRAFT_FROM_PUBLIC_CONFIG, STAFF_SETTINGS)
  assert.equal(draft.customer_portal_show_top_seller_badge, false, 'a switch the owner turned off stays off')
  assert.equal(draft.customer_portal_logo_size, '120')
  assert.equal(draft.customer_portal_highlight_rank_limit, '5')
  assert.notDeepEqual(draft, DRAFT_FROM_PUBLIC_CONFIG, 'the plain public-config draft is what resets the settings')
  assert.equal(draft.customer_portal_business_tagline, 'Skincare and fragrance', 'a key the staff read lacks keeps the public value')
  assert.equal(draft.customer_portal_show_membership, false, 'membership history stays off in the editor whatever is stored')
  assert.equal(Object.prototype.hasOwnProperty.call(draft, 'receipt_template'), false, 'only editor keys are overlaid')
  assert.equal(Object.prototype.hasOwnProperty.call(draft, 'updatedAt'), false)
  assert.equal(m.overlayStaffSettings(DRAFT_FROM_PUBLIC_CONFIG, null), DRAFT_FROM_PUBLIC_CONFIG, 'no staff read, no change')
})

await runTest('T-D1: a key the person already edited keeps what they typed when the staff read lands', () => {
  const m = need()
  const typed = { ...DRAFT_FROM_PUBLIC_CONFIG, customer_portal_logo_size: '96' }
  const draft = m.overlayStaffSettings(typed, STAFF_SETTINGS, new Set(['customer_portal_logo_size']))
  assert.equal(draft.customer_portal_logo_size, '96')
  assert.equal(draft.customer_portal_show_top_seller_badge, false)
})

await runTest('T-D1: a stored blank or "0" switch is read the way the Worker reads it', () => {
  const m = need()
  const draft = m.overlayStaffSettings(
    { customer_portal_show_cover: true, customer_portal_show_logo: true, customer_portal_about_title: 'About us' },
    { customer_portal_show_cover: '0', customer_portal_show_logo: '', customer_portal_about_title: '' },
  )
  assert.equal(draft.customer_portal_show_cover, false)
  assert.equal(draft.customer_portal_show_logo, true, 'an unset switch keeps its published value')
  assert.equal(draft.customer_portal_about_title, '', 'a stored blank title stays blank instead of saving the storefront default')
})

const UNPUBLISHED = [
  'customer_portal_title_size',
  'customer_portal_ai_intro',
  'customer_portal_translations',
  'customer_portal_language',
  'customer_portal_show_top_seller_badge',
  'customer_portal_show_top_product_badge',
  'customer_portal_show_recommended_badge',
  'customer_portal_show_promotion_badge',
  'customer_portal_show_new_arrival_badge',
  'customer_portal_highlight_rank_limit',
  'customer_portal_recommended_product_ids',
  'customer_portal_stock_threshold_mode',
  'customer_portal_low_stock_threshold',
  'customer_portal_out_of_stock_threshold',
  'customer_portal_show_point_value',
  'customer_portal_show_membership',
]
const FULL_PAYLOAD: Record<string, string> = {
  business_name: 'Leang Cosmetics',
  customer_portal_about_title: 'Our story',
  customer_portal_logo_size: '80',
  ...Object.fromEntries(UNPUBLISHED.map((key) => [key, 'editor default'])),
}

await runTest('T-D2: when the staff read failed, a Save leaves out every key the public config does not carry', () => {
  const m = need()
  const sent = m.pickLoadedOrEditedKeys(FULL_PAYLOAD, null, new Set(['customer_portal_about_title']))
  for (const key of UNPUBLISHED) assert.equal(Object.prototype.hasOwnProperty.call(sent, key), false, `${key} is never written as a default`)
  assert.equal(sent.customer_portal_about_title, 'Our story', 'the edit is sent')
  assert.equal(sent.business_name, 'Leang Cosmetics', 'a key the public config carries is loaded, so it is sent')
  assert.equal(sent.customer_portal_logo_size, '80')
})

await runTest('T-D2: an unpublished key is sent once it was read from the staff settings or edited', () => {
  const m = need()
  const sent = m.pickLoadedOrEditedKeys(
    FULL_PAYLOAD,
    { customer_portal_show_top_seller_badge: 'false' },
    new Set(['customer_portal_highlight_rank_limit']),
  )
  assert.equal(sent.customer_portal_show_top_seller_badge, 'editor default', 'loaded from the staff read')
  assert.equal(sent.customer_portal_highlight_rank_limit, 'editor default', 'edited in this session')
  assert.equal(Object.prototype.hasOwnProperty.call(sent, 'customer_portal_translations'), false, 'neither loaded nor edited')
})

await runTest('T-D2: the unpublished list is exactly the Worker ratchet KNOWN_UNPUBLISHED', () => {
  const m = need()
  const ratchet = read('../../cloudflare/scripts/test-portal-about-publish-pure.cjs')
  const list = between(ratchet, 'const KNOWN_UNPUBLISHED = [', ']')
  const workerKeys = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort()
  assert.ok(workerKeys.length >= 1, 'parsed the Worker list')
  assert.deepEqual([...m.DRAFT_KEYS_NOT_IN_PUBLIC_CONFIG].sort(), workerKeys)
})

await runTest('T-D3: a change typed while the Save was in flight stays an unsaved edit', () => {
  const m = need()
  const edited = m.settleSavedEdits(new Set(['business_name']), { business_name: 'A' }, { business_name: 'AB' })
  assert.deepEqual([...edited], ['business_name'], 'clearing every edit after the write is what put the text back')
})

await runTest('T-D3: a saved key is settled only when its value is still the one sent', () => {
  const m = need()
  const sent = { customer_portal_logo_size: '120', customer_portal_business_tagline: 'Old', customer_portal_ai_prompt: 'Be brief.' }
  const now = { customer_portal_logo_size: '120', customer_portal_business_tagline: 'New', customer_portal_ai_prompt: 'Be brief.', customer_portal_intro: 'Hi' }
  const edited = m.settleSavedEdits(
    new Set(['customer_portal_logo_size', 'customer_portal_business_tagline', 'customer_portal_ai_prompt', 'customer_portal_intro']),
    sent,
    now,
  )
  assert.deepEqual([...edited].sort(), ['customer_portal_business_tagline', 'customer_portal_intro'])
})

await runTest('T-D4: the post-save clean-up of media values updates the draft without marking an edit', () => {
  const m = need()
  const edited = m.settleSavedEdits(new Set(['customer_portal_cover_image']), { customer_portal_cover_image: 'blob:preview' }, { customer_portal_cover_image: 'blob:preview' })
  assert.equal(edited.size, 0)
  const draft = m.replaceDraftValues({ customer_portal_cover_image: 'blob:preview', business_name: 'Leang' }, { customer_portal_cover_image: '/uploads/cover.webp' })
  assert.deepEqual(draft, { customer_portal_cover_image: '/uploads/cover.webp', business_name: 'Leang' })
  assert.equal(m.markEdited(edited, 'business_name').has('business_name'), true, 'markEdited is the one way a key becomes edited')
  assert.equal(m.markEdited(new Set(['business_name']), 'business_name').size, 1)
})

await runTest('T-D4 wiring: after a landed Save the editor settles edits and never re-marks them', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  const save = between(page, 'async function savePortalDraft(', '\n  async function ')
  const landed = save.slice(save.indexOf('if (result?.success === false) return'))
  assert.ok(landed.length > 0, 'the save still stops on a failed write')
  assert.doesNotMatch(landed, /setEditorDirty\(false\)/, 'a Save does not mark everything clean')
  assert.doesNotMatch(landed, /\bsetDraft\(|setAboutBlocksDraft\(|setPromoItemsDraft\(/, 'normalised media must not count as an edit')
  assert.match(landed, /settleSavedEdits\(/)
  assert.match(landed, /replaceDraftValues\(/)
})

await runTest('AF-A1: edited keys are React state read through a ref; the reload rebuild waits for them and overlays the staff read', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  assert.match(page, /const \[editedKeys, setEditedKeys\] = useState<ReadonlySet<string>>/)
  assert.match(page, /const editedKeysRef = useRef<ReadonlySet<string>>/)
  assert.doesNotMatch(page, /setEditorDirty\(/, 'no separate dirty flag')
  const load = between(page, 'async function loadPortal() {', '\n  }\n')
  const editorBranch = load.slice(load.indexOf('\n      return\n    }\n'))
  assert.doesNotMatch(editorBranch, /if \(!editorDirty\)/, 'the rebuild never reads a dirty flag captured by an older render')
  assert.match(editorBranch, /if \(editedKeysRef\.current\.size === 0\) setEditorDraft\(overlayStaffSettings\(buildDraft\(nextConfig\), staffSettingsRef\.current\)\)/)
  const setDraft = between(page, 'function setDraft(key: string, value: unknown) {', '\n  }\n')
  assert.match(setDraft, /markDraftEdited\(key\)/, 'every write path marks its key')
})

await runTest('AF-10: edited keys are in the editor context value', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  const context = between(page, 'const editorContextValue = {', '\n    }\n')
  assert.match(context, /\n\s+editedKeys,\n/)
  assert.match(context, /\n\s+editorDirty,\n/)
  assert.match(page, /const editorDirty = editedKeys\.size > 0/)
})

await runTest('D7 wiring: the save sends only loaded or edited keys, and the staff read feeds the overlay', () => {
  const page = code(read('../src/components/catalog/CatalogPage.tsx'))
  const save = between(page, 'async function savePortalDraft(', '\n  async function ')
  assert.match(save, /pickLoadedOrEditedKeys\(\{/)
  assert.match(save, /staffSettingsRef\.current, editedKeysRef\.current\)/)
  const reader = between(page, 'async function loadPrivateAiSettings(', '\n  }\n')
  assert.match(reader, /staffSettingsRef\.current = /)
  assert.match(reader, /overlayStaffSettings\(current, staffSettings, editedKeysRef\.current\)/)
})

if (failed) {
  console.error(`\n${failed} failing`)
  process.exit(1)
}
console.log('\nportalEditorDraft: all passing')

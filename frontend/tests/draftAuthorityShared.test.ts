// The frozen draft authority and its "the account or server changed" notice are defined once -- useFrozenDraftAuthority
// and <DraftAuthorityNotice /> -- and every site uses them: the Expense form and page, the Branch form and page, the
// Product form.
//
//   the sites      a scan of src/: nothing but the hook opens an authority, nothing but draftAuthority.ts holds the
//                  sentence, nothing but the notice renders the alert -- a sixth copy-pasted form fails here
//   the hook       the REAL hook, mounted: null while closed, frozen per form identity, adopts the page's authority,
//                  re-evaluates `current` on every render, `locked` once refused or once the owner changed
//   the notice     the REAL component: the pack's sentence in en and km, role=alert, leading-relaxed for Khmer
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createHarness } from './mountedComponentHarness.ts'
import * as actor from '../src/api/actorReadScope.ts'
import DraftAuthorityNotice from '../src/components/shared/DraftAuthorityNotice.ts'
import { openDraftAuthority, type DraftAuthority } from '../src/utils/draftAuthority.ts'
import { useFrozenDraftAuthority, type FrozenDraftAuthority } from '../src/utils/useFrozenDraftAuthority.ts'

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
})
const files = walk(srcRoot).map((path) => ({ name: relative(srcRoot, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
const filesWith = (needle: string | RegExp): string[] => files.filter((file) => (typeof needle === 'string' ? file.text.includes(needle) : needle.test(file.text))).map((file) => file.name).sort()
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const SITES = ['components/fees/FeesPage.tsx', 'components/fees/FeeForm.tsx', 'components/branches/Branches.tsx', 'components/branches/BranchForm.tsx', 'components/products/forms/ProductForm.tsx']
const FORMS = ['components/fees/FeeForm.tsx', 'components/branches/BranchForm.tsx', 'components/products/forms/ProductForm.tsx']

await check('only the hook opens a draft authority', () => {
  assert.deepEqual(filesWith(/\bopenDraftAuthority\(/), ['utils/draftAuthority.ts', 'utils/useFrozenDraftAuthority.ts'])
})
await check('the sentence, its key and the alert markup are each defined once', () => {
  assert.deepEqual(filesWith("'product_draft_authority_changed'"), ['utils/draftAuthority.ts'])
  assert.deepEqual(filesWith('The account or server changed. Reopen this form'), ['utils/draftAuthority.ts'])
  assert.deepEqual(filesWith('data-draft-authority-changed'), ['components/shared/DraftAuthorityNotice.ts'])
})
await check('all five sites use the hook, and the three forms use the notice', () => {
  assert.deepEqual(filesWith('useFrozenDraftAuthority(').filter((name) => SITES.includes(name)), [...SITES].sort())
  assert.deepEqual(filesWith('<DraftAuthorityNotice').sort(), [...FORMS].sort())
})
await check('no site keeps its own freeze block (a ref holding { identity, authority }) or its own alert', () => {
  for (const name of SITES) {
    const text = files.find((file) => file.name === name)!.text
    assert.ok(!/AuthorityRef\s*=\s*useRef</.test(text), `${name} has no hand-rolled authority ref`)
    assert.ok(!/role="alert"[^\n]*product_draft_authority_changed/.test(text), `${name} has no inline notice`)
  }
})

const harness = await createHarness()
const container = document.createElement('div'); document.body.appendChild(container)
const root = createRoot(container)
type Probe = FrozenDraftAuthority<DraftAuthority | null>
let latest: Probe
// (a function call, so the compiler does not narrow `latest` from an earlier assertion in the same check)
const probe = (): Probe => latest
function ProbeHost(props: { baseKey: string | null; formIdentity?: string; adopt?: DraftAuthority }) {
  latest = useFrozenDraftAuthority(props.baseKey, { formIdentity: props.formIdentity, adopt: props.adopt }) as Probe
  return null
}
const render = (props: React.ComponentProps<typeof ProbeHost>) => act(async () => { root.render(React.createElement(ProbeHost, props)) })
localStorage.setItem('businessos_sync_server', 'https://server-a.example')
const writeUser = (id: number) => { const value = JSON.stringify({ id, organization_id: 1 }); localStorage.setItem('businessos_user', value); sessionStorage.setItem('businessos_user', value) }
writeUser(7)

try {
  await check('the hook: no form open means no authority; opening freezes one for that form', async () => {
    await render({ baseKey: null })
    assert.equal(probe().authority, null)
    assert.equal(probe().current, true, 'nothing open, nothing to lock')
    assert.equal(probe().locked, false)
    await render({ baseKey: 'fee_new', formIdentity: 'new:7' })
    assert.ok(probe().authority)
    assert.match(probe().authority!.draftKey, /fee_new$/)
    assert.equal(probe().locked, false)
  })
  await check('the hook: the authority is frozen per form identity, re-frozen when it changes, dropped when the form closes', async () => {
    await render({ baseKey: 'fee_new', formIdentity: 'new:7' })
    const first = probe().authority
    await render({ baseKey: 'fee_new', formIdentity: 'new:7' })
    assert.equal(probe().authority, first, 'a re-render keeps the very same authority')
    await render({ baseKey: 'fee_5', formIdentity: '5:2026-10-13' })
    assert.notEqual(probe().authority, first, 'another form identity opens a new authority')
    assert.match(probe().authority!.draftKey, /fee_5$/)
    await render({ baseKey: null })
    assert.equal(probe().authority, null, 'closing drops it')
    await render({ baseKey: 'fee_5', formIdentity: '5:2026-10-13' })
    assert.ok(probe().authority, 'and reopening freezes a fresh one')
  })
  await check('the hook: a form adopts the authority its hosting page froze', async () => {
    const hosted = openDraftAuthority('branch_3')
    await render({ baseKey: 'branch_3', adopt: hosted })
    assert.equal(probe().authority, hosted, 'the form writes the draft the page will minimize')
  })
  await check('the hook: nothing to refuse while the authority is current', async () => {
    writeUser(7)
    await render({ baseKey: null }); await render({ baseKey: 'fee_new', formIdentity: 'current-case' })
    assert.equal(probe().current, true)
    await act(async () => { probe().setRefused(true) })
    assert.equal(probe().refused, false, 'a refusal means the authority is gone; a current one has none to show')
    assert.equal(probe().locked, false)
  })
  await check('the hook: a sign-in check locks it, a refusal during the check is shown, and the lock lifts by itself with the notice', async () => {
    writeUser(7)
    await render({ baseKey: null }); await render({ baseKey: 'fee_new', formIdentity: 'check-case' })
    assert.equal(probe().locked, false)
    actor.resetActorReadSession()
    assert.equal(actor.isActorSessionQuarantined(), false, 'premise: a reset in this tab is not a second tab')
    localStorage.setItem('businessos_read_session', 'another-tab-signed-in') // another tab signs in
    assert.equal(actor.isActorSessionQuarantined(), true, 'premise: the check started')
    await act(async () => { await Promise.resolve() }) // the hook re-renders its host after the check starts, with no parent render
    assert.equal(probe().current, false, 'locked while the sign-in is checked')
    assert.equal(probe().locked, true)
    await act(async () => { probe().setRefused(true) })
    assert.equal(probe().refused, true, 'a Save pressed during the check was refused')
    await act(async () => { actor.completeActorSessionReconciliation(actor.actorSessionReconciliationMarker()) }) // the same owner is confirmed
    await act(async () => { await Promise.resolve() })
    assert.equal(probe().current, true, 'released')
    assert.equal(probe().refused, false, 'and the refusal does not outlive the lock')
    assert.equal(probe().locked, false, 'so the notice goes with it')
  })
  await check('the hook: current follows the live owner on every render; a real change never lifts', async () => {
    writeUser(7)
    await render({ baseKey: null }); await render({ baseKey: 'fee_new', formIdentity: 'owner-case' })
    assert.equal(probe().locked, false)
    writeUser(8)
    await render({ baseKey: 'fee_new', formIdentity: 'owner-case' })
    assert.equal(probe().current, false, 'another user: not current')
    assert.equal(probe().locked, true)
    writeUser(7)
    await render({ baseKey: 'fee_new', formIdentity: 'owner-case' })
    assert.equal(probe().current, false, '7 -> 8 -> 7 stays locked')
    writeUser(7)
  })

  for (const lang of ['en', 'km'] as const) {
    await check(`${lang} the notice says the pack's sentence as a Khmer-safe alert`, async () => {
      const words = packs[lang]
      assert.ok(words.product_draft_authority_changed, 'the pack carries the sentence')
      if (lang === 'km') assert.notEqual(words.product_draft_authority_changed, packs.en.product_draft_authority_changed)
      await act(async () => { root.render(React.createElement(DraftAuthorityNotice, { t: (key: string) => words[key], className: 'mb-3' })) })
      const node = container.firstChild as unknown as { tagName: string; textContent: string; getAttribute(name: string): string | null }
      assert.equal(node.tagName, 'P')
      assert.equal(node.textContent, words.product_draft_authority_changed)
      assert.equal(node.getAttribute('role'), 'alert')
      assert.ok(node.getAttribute('data-draft-authority-changed') !== null)
      const className = node.getAttribute('class') ?? node.getAttribute('className') ?? ''
      assert.ok(className.includes('leading-relaxed'), 'Khmer glyphs need the line room')
      assert.ok(className.includes('mb-3'), 'and the caller\'s spacing')
    })
  }
  await check('the notice falls back to English rather than showing a bare key when a pack lacks the sentence', async () => {
    await act(async () => { root.render(React.createElement(DraftAuthorityNotice, { t: () => undefined })) })
    assert.match((container.firstChild as unknown as { textContent: string }).textContent, /^The account or server changed\./)
  })
} finally {
  await act(async () => root.unmount())
  await harness.close()
}

if (failed) process.exit(1)

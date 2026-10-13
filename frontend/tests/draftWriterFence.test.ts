// Account/server fence for the draft writers (Daily-use B). App keeps visited
// pages mounted, so an Expense or Branch form can still be open when the sync
// server is switched (Server page > Save and Reconnect). The forms recomputed
// scopedWorkDraftKey() on every render, so the first render after the switch
// wrote the old server's typed work under the NEW server's key, and a Save then
// sent it to the new server. The receiving modal fixed this class in 6.0.15
// (draft key frozen at mount + actor-read-scope guard); these forms now freeze
// their key and scope when they open.
//
// The server switch is simulated the way the app does it: the stored sync
// server (what scopedWorkDraftKey reads) and the in-memory one (what the actor
// read scope reads, through the observed httpState double) change together.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'
import { clearWorkDraft, readWorkDraft, scopedWorkDraftKey } from '../src/utils/workDrafts.ts'

const SERVER_A = 'https://server-a.example'
const SERVER_B = 'https://server-b.example'
let serverUrl = SERVER_A
const harness = await createHarness({ observe: ['api/httpState.ts'] })
const useServer = (url: string) => {
  serverUrl = url
  localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, url)
}
const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const keyUnder = (server: string, baseKey: string) => {
  const previous = serverUrl
  useServer(server)
  const key = scopedWorkDraftKey(baseKey)
  useServer(previous)
  return key
}
const draftOf = (key: string) => readWorkDraft<Record<string, unknown>>(key)?.data ?? null
const doubles = () => ({
  'api/httpState.ts': { getSyncServerUrl: () => serverUrl },
  'api/feesTransport.ts': { getFeeLabels: async () => ({ labels: [] }) },
  'api/branchTransport.ts': { getBranches: async () => [{ id: 1, name: 'LC Store', is_active: 1, role: 'shop', is_default: 1 }] },
})
const form = (surface: MountedSurface) => surface.find((node) => node.tagName === 'FORM', 'form')
const submit = (surface: MountedSurface) => surface.call(form(surface), 'onSubmit', [{ preventDefault() {} }])

try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const app = { t: (key: string) => words[key] || '', user, notify() {}, getPermissionTier: () => 'none' }
    const warning = words.product_draft_authority_changed
    assert.ok(warning, `${lang} pack carries the account/server notice`)

    // ---- Expense form -------------------------------------------------
    const feeA = keyUnder(SERVER_A, 'fee_new')
    const feeB = keyUnder(SERVER_B, 'fee_new')
    for (const key of [feeA, feeB]) clearWorkDraft(key)
    const saved: Array<Record<string, unknown>> = []
    let closed = 0
    const feeProps = { fee: null, actorId: 42, labelSuggestions: [], onSave: async (payload: Record<string, unknown>) => { saved.push(payload) }, onClose: () => { closed++ } }

    useServer(SERVER_A)
    const fee = await harness.mount({ component: 'components/fees/FeeForm.tsx', props: feeProps, app, doubles: doubles() })
    await fee.type(fee.field('fee-label'), 'Boost for A')
    await fee.type(fee.field('fee-amount-usd'), '5')
    await fee.settle()
    assert.equal(draftOf(feeA)?.label, 'Boost for A', `${lang}: the draft is written under server A while A is current`)

    useServer(SERVER_B)
    await fee.type(fee.field('fee-label'), 'Typed after the switch')
    await fee.render(feeProps)
    await fee.settle()
    assert.equal(draftOf(feeB), null, `${lang}: nothing is written under server B`)
    assert.equal(draftOf(feeA)?.label, 'Boost for A', `${lang}: the draft stays with server A`)
    assert.ok(fee.text().includes(warning), `${lang}: the form says the account or server changed`)
    await submit(fee)
    assert.equal(saved.length, 0, `${lang}: Save never sends server A's work to server B`)
    assert.equal(closed, 0)
    await fee.unmount()
    assert.equal(draftOf(feeB), null, `${lang}: closing the stale form still writes nothing under B`)

    // Back on A the same draft is restored and saves normally (control: the fence is not a blanket refusal).
    useServer(SERVER_A)
    const feeBack = await harness.mount({ component: 'components/fees/FeeForm.tsx', props: feeProps, app, doubles: doubles() })
    assert.equal((feeBack.field('fee-label') as unknown as { value: string }).value, 'Boost for A', `${lang}: server A's draft comes back on server A`)
    await submit(feeBack)
    assert.equal(saved.length, 1, `${lang}: CONTROL: a form whose server never changed saves`)
    assert.equal(closed, 1)
    assert.equal(draftOf(feeA), null, `${lang}: and clears its own draft`)
    await feeBack.unmount()

    // A response that arrives after the switch: the saved draft of A is cleared, B is untouched, B's surface is not closed.
    saved.length = 0; closed = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const lateProps = { ...feeProps, onSave: async (payload: Record<string, unknown>) => { saved.push(payload); await gate } }
    useServer(SERVER_A)
    const late = await harness.mount({ component: 'components/fees/FeeForm.tsx', props: lateProps, app, doubles: doubles() })
    await late.type(late.field('fee-label'), 'Late for A')
    await late.type(late.field('fee-amount-usd'), '7')
    await late.settle()
    await late.call(form(late), 'onSubmit', [{ preventDefault() {} }], { waitingFor: 'the save to be in flight', until: () => saved.length === 1 })
    useServer(SERVER_B)
    release()
    await late.render(lateProps)
    await late.settle()
    assert.equal(saved.length, 1, `${lang}: exactly the one send that started under A`)
    assert.equal(closed, 0, `${lang}: a late completion from A never closes the surface now owned by B`)
    assert.equal(draftOf(feeA), null, `${lang}: A's draft is cleared by its own completed save`)
    assert.equal(draftOf(feeB), null, `${lang}: and nothing appears under B`)
    await late.unmount()

    // ---- Branch form --------------------------------------------------
    const branchA = keyUnder(SERVER_A, 'branch_3')
    const branchB = keyUnder(SERVER_B, 'branch_3')
    for (const key of [branchA, branchB]) clearWorkDraft(key)
    const branchSaves: Array<Record<string, unknown>> = []
    const branchProps = {
      branch: { id: 3, name: 'Old Shop', location: '', phone: '', manager: '', notes: '', is_default: 0, is_active: 1, edit_etag: 'e1' },
      onSave: async (value: Record<string, unknown>) => { branchSaves.push(value); return true }, onClose() {},
    }
    useServer(SERVER_A)
    const branch = await harness.mount({ component: 'components/branches/BranchForm.tsx', props: branchProps, app, doubles: doubles() })
    await branch.type(branch.field('branch-location'), '12 River Road')
    await branch.settle()
    assert.equal(draftOf(branchA)?.location, '12 River Road', `${lang}: branch draft written under A`)
    useServer(SERVER_B)
    await branch.type(branch.field('branch-location'), '99 Other Street')
    await branch.render(branchProps)
    await branch.settle()
    assert.equal(draftOf(branchB), null, `${lang}: branch draft never written under B`)
    assert.equal(draftOf(branchA)?.location, '12 River Road', `${lang}: branch draft stays with A`)
    assert.ok(branch.text().includes(warning), `${lang}: the branch form says the account or server changed`)
    await submit(branch)
    assert.equal(branchSaves.length, 0, `${lang}: Save Branch never sends A's edit to B`)
    await branch.unmount()
    useServer(SERVER_A)
    const branchBack = await harness.mount({ component: 'components/branches/BranchForm.tsx', props: branchProps, app, doubles: doubles() })
    await submit(branchBack)
    assert.equal(branchSaves.length, 1, `${lang}: CONTROL: the branch form on its own server saves`)
    await branchBack.unmount()

    // Same late completion for the branch form: A's draft is cleared by A's own save, B's key stays empty, nothing is closed.
    branchSaves.length = 0
    clearWorkDraft(branchA)
    let branchClosed = 0
    let releaseBranch!: () => void
    const branchGate = new Promise<void>((resolve) => { releaseBranch = resolve })
    const lateBranchProps = { ...branchProps, onClose: () => { branchClosed++ }, onSave: async (value: Record<string, unknown>) => { branchSaves.push(value); await branchGate; return true } }
    const lateBranch = await harness.mount({ component: 'components/branches/BranchForm.tsx', props: lateBranchProps, app, doubles: doubles() })
    await lateBranch.type(lateBranch.field('branch-location'), 'Late road')
    await lateBranch.settle()
    assert.equal(draftOf(branchA)?.location, 'Late road', `${lang}: late branch draft is under A`)
    await lateBranch.call(form(lateBranch), 'onSubmit', [{ preventDefault() {} }], { waitingFor: 'the branch save to be in flight', until: () => branchSaves.length === 1 })
    useServer(SERVER_B)
    releaseBranch()
    await lateBranch.render(lateBranchProps)
    await lateBranch.settle()
    assert.equal(branchClosed, 0, `${lang}: a late branch save from A never closes the surface now owned by B`)
    assert.equal(draftOf(branchA), null, `${lang}: A's branch draft is cleared by its own completed save`)
    assert.equal(draftOf(branchB), null, `${lang}: and nothing appears under B`)
    await lateBranch.unmount()
    useServer(SERVER_A)
  }
  console.log('PASS Expense and Branch forms freeze their draft key and scope when they open: nothing is written, restored or sent under the other server, and a late completion is dropped')
} finally {
  await harness.close()
}

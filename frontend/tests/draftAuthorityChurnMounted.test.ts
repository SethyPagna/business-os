// Every surface that holds a frozen draft authority -- the Expense form and page, the Branch form and page, the Product
// form -- keeps working through a same-user session churn, locks on a real change of owner, and unlocks by itself when a
// sign-in check ends with the same owner confirmed.
//
// The churn is what a reconnect does inside the open tab: the actor read session is reset and the same user's record is
// written again with refreshed permissions and a new expiry. The REAL actorReadScope.ts, workDrafts.ts and forms run; the
// reset goes through the actorReadScope instance the surfaces use (tests/draftAuthorityHost.ts), so it is the same-tab
// reset, not a second tab.
//
//   blip          reset + same-user rewrite   -> no notice, Save works, the draft keeps being written, Minimize parks
//   switch        user 7 -> user 8            -> notice, Save refused, nothing written under 8, nothing parked
//   A-B-A         user 8 observed, then 7 again -> still locked (the epoch only goes up)
//   sign-in check another tab signs in, the same owner is confirmed -> locked, then the notice goes and Save works
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'
import { clearWorkDraft, readWorkDraft, scopedWorkDraftKey } from '../src/utils/workDrafts.ts'

const SERVER = 'https://server-a.example'
let serverUrl = SERVER
const harness = await createHarness({ observe: ['api/httpState.ts', 'utils/minimizedWork.ts', 'api/methods.ts'] })
const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

const OWNER = { id: 7, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
const writeUser = (patch: Record<string, unknown> = {}): void => {
  const value = JSON.stringify({ ...OWNER, ...patch })
  localStorage.setItem(STORAGE_KEYS.USER, value)
  sessionStorage.setItem(STORAGE_KEYS.USER, value)
}
const actor = (): any => (globalThis as Record<symbol, any>)[Symbol.for('draftAuthorityHost.actor')]
function freshTab(): void {
  serverUrl = SERVER
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem(STORAGE_KEYS.SYNC_SERVER, SERVER)
  writeUser()
  if (actor()) {
    actor().resetActorReadSession()
    if (actor().isActorSessionQuarantined()) actor().completeActorSessionReconciliation(actor().actorSessionReconciliationMarker())
    assert.equal(actor().isActorSessionQuarantined(), false)
  }
}
// What a reconnect does to the open tab, in the tab itself.
const blip = (): void => {
  actor().resetActorReadSession()
  writeUser({ role_permissions: { all: true }, avatar_path: 'avatar.png' })
  localStorage.setItem('businessos_user_expiry', String(Date.now() + 86_400_000))
}
const switchTo8 = (): void => writeUser({ id: 8 })
// Another tab signs in: the session marker moves under this tab and every form it holds locks until the same owner is confirmed.
const otherTabSignsIn = (): void => { localStorage.setItem('businessos_read_session', 'another-tab-signed-in') }
const sameOwnerConfirmed = (): void => { actor().completeActorSessionReconciliation(actor().actorSessionReconciliationMarker()) }
// The scoped draft key of a base key for user 7 (the opener) or user 8 (the stranger), computed up front so a test that has
// already switched the stored user is not put back by asking.
const keysFor = (base: string): { seven: string; eight: string } => {
  writeUser(); const seven = scopedWorkDraftKey(base)
  writeUser({ id: 8 }); const eight = scopedWorkDraftKey(base)
  writeUser()
  return { seven, eight }
}
const draftOf = (key: string) => readWorkDraft<Record<string, unknown>>(key)?.data ?? null

const parked: Array<Record<string, unknown>> = []
// The Expense surfaces need a default shop (a fee cannot be saved without a branch); the Branches surfaces need the one
// branch whose card they edit.
const SHOP = { id: 1, name: 'LC Store', canonical_key: 'lc-store', role: 'shop', is_active: 1, is_default: 1, successor_branch_id: null, edit_etag: 'e0' }
const WAREHOUSE = { id: 3, name: 'Warehouse', canonical_key: 'warehouse', role: 'warehouse', is_active: 1, is_default: 0, successor_branch_id: null, edit_etag: 'e1' }
const doubles = (surface: string) => ({
  'api/httpState.ts': { getSyncServerUrl: () => serverUrl },
  'utils/minimizedWork.ts': { minimizeWork: (entry: Record<string, unknown>) => { parked.push(entry) } },
  'api/methods.ts': { searchProducts: async () => ({ items: [] }), getProductFilters: async () => ({ categories: [], brands: [] }) },
  'api/feesTransport.ts': {
    getFees: async () => ({ fees: [], total: 0, limit: 25, offset: 0 }),
    getFeesReport: async () => ({ totals: { count: 0, amount_usd: 0, amount_khr: 0 }, days: [], by_type: [], by_category: [] }),
    getFeeLabels: async () => ({ labels: [] }),
  },
  'api/branchTransport.ts': {
    getBranches: async () => (surface.startsWith('branch') ? [WAREHOUSE] : [SHOP]),
    getTransfers: async () => ({ transfers: [], total: 0 }),
    getBranchSummary: async () => ({}),
  },
})
;(window as unknown as { api: Record<string, unknown> }).api = { getSystemConfig: async () => ({}), getSystemDebugLog: async () => [], getOnlineClients: async () => ({ clients: 1 }), getSuppliers: async () => [], getBranches: async () => [], getCategories: async () => [], getUnits: async () => [] }

const submitButton = (surface: MountedSurface): MemoryNode => surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('type') === 'submit', 'Save button')
const saveDisabled = (surface: MountedSurface): boolean => Boolean(propsOf(submitButton(surface)).disabled)
const submit = (surface: MountedSurface) => surface.call(surface.find((node) => node.tagName === 'FORM', 'form'), 'onSubmit', [{ preventDefault() {} }])
const noticeShown = (surface: MountedSurface, text: string): boolean => surface.text().includes(text)

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { freshTab(); parked.length = 0; await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const host = (surface: string, props: Record<string, unknown> = {}) => ({ surface, ...props })
const mountHost = (props: Record<string, unknown>, app: Record<string, unknown>) =>
  harness.mount({ component: '../tests/draftAuthorityHost.ts', props, app, doubles: doubles(String(props.surface)) })

try {
  for (const lang of ['en', 'km'] as const) {
    const words = packs[lang]
    freshTab()
    const warning = words.product_draft_authority_changed
    const notices: Array<{ message: string; type?: string }> = []
    const app = (page = 'sales') => ({
      t: (key: string) => words[key] || '', user: OWNER, page, notify: (message: string, type?: string) => { notices.push({ message, type }) },
      can: () => true, getPermissionTier: () => 'all', hasPermission: () => true,
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD',
    })
    assert.ok(warning, `${lang} pack carries the account/server notice`)

    // ---- Expense form ---------------------------------------------------------------------------------------------
    const saved: Array<Record<string, unknown>> = []
    let closed = 0
    const feeProps = host('fee-form', { fee: null, actorId: 7, labelSuggestions: [], onSave: async (payload: Record<string, unknown>) => { saved.push(payload) }, onClose: () => { closed++ } })
    const fee7 = keysFor('fee_new')
    const feeKey = () => fee7.seven
    const startFee = async () => {
      saved.length = 0; closed = 0; clearWorkDraft(fee7.seven); clearWorkDraft(fee7.eight)
      const fee = await mountHost(feeProps, app())
      await fee.type(fee.field('fee-label'), 'Before the blip')
      await fee.type(fee.field('fee-amount-usd'), '5')
      await fee.settle()
      assert.equal(draftOf(feeKey())?.label, 'Before the blip', 'the draft is written while the form is current')
      return fee
    }

    await check(`${lang} Expense form, same-user blip: no notice, the draft keeps being written, Save works`, async () => {
      const fee = await startFee()
      try {
        blip()
        await fee.render(feeProps)
        await fee.settle()
        assert.ok(!noticeShown(fee, warning), 'no false "account or server changed"')
        assert.equal(saveDisabled(fee), false, 'Save stays on')
        await fee.type(fee.field('fee-label'), 'After the blip')
        await fee.settle()
        assert.equal(draftOf(feeKey())?.label, 'After the blip', 'text typed after the blip is still written to the draft')
        await submit(fee)
        assert.equal(saved.length, 1, 'and Save sends it')
        assert.equal(saved[0].label, 'After the blip')
        assert.equal(closed, 1, 'the form closes')
        assert.equal(draftOf(feeKey()), null, 'and clears its draft')
      } finally { await fee.unmount() }
    })

    await check(`${lang} Expense form, real switch 7 -> 8: notice, Save refused, nothing written under 8`, async () => {
      const fee = await startFee()
      try {
        switchTo8()
        await fee.render(feeProps)
        await fee.type(fee.field('fee-label'), 'Typed after the switch')
        await fee.settle()
        assert.ok(noticeShown(fee, warning), 'the form says the account or server changed')
        assert.equal(saveDisabled(fee), true, 'Save is off')
        assert.equal(draftOf(fee7.eight), null, 'nothing is written under user 8')
        assert.equal(draftOf(feeKey())?.label, 'Before the blip', "user 7's draft stays with user 7")
        await submit(fee)
        assert.equal(saved.length, 0, "7's work is never sent as 8")
        assert.equal(closed, 0)
      } finally { await fee.unmount() }
    })

    await check(`${lang} Expense form, 7 -> 8 -> 7: still locked (the key matches again, the owner generation does not)`, async () => {
      const fee = await startFee()
      try {
        switchTo8()
        await fee.render(feeProps)
        writeUser()
        await fee.render(feeProps)
        await fee.type(fee.field('fee-label'), 'Typed after the round trip')
        await fee.settle()
        assert.equal(scopedWorkDraftKey('fee_new'), feeKey(), 'premise: the draft key is user 7\'s again')
        assert.ok(noticeShown(fee, warning), 'still locked')
        assert.equal(draftOf(feeKey())?.label, 'Before the blip', 'and not written')
        await submit(fee)
        assert.equal(saved.length, 0)
      } finally { await fee.unmount() }
    })

    // A sign-in check is the one lock that lifts by itself. The notice has to go with it, and Save has to work, without the
    // operator closing the form; a Save pressed while it was locked must not leave "Reopen this form" standing.
    await check(`${lang} Expense form, a sign-in check lifts (same owner confirmed): the notice goes with the lock and Save works`, async () => {
      const fee = await startFee()
      try {
        otherTabSignsIn()
        await fee.render(feeProps)
        assert.ok(noticeShown(fee, warning), 'locked while the sign-in is checked')
        assert.equal(saveDisabled(fee), true)
        await submit(fee)
        assert.equal(saved.length, 0, 'a Save pressed during the check is refused')
        sameOwnerConfirmed()
        await fee.settle()
        assert.ok(!noticeShown(fee, warning), 'the notice leaves when the lock lifts, with no re-render from the page')
        assert.equal(saveDisabled(fee), false)
        await submit(fee)
        assert.equal(saved.length, 1, 'and Save sends')
        assert.equal(closed, 1)
      } finally { await fee.unmount() }
    })

    // ---- Branch form ----------------------------------------------------------------------------------------------
    const branchSaves: Array<Record<string, unknown>> = []
    let branchClosed = 0
    const branchProps = host('branch-form', {
      branch: { id: 3, name: 'Old Shop', location: '', phone: '', manager: '', notes: '', is_default: 0, is_active: 1, edit_etag: 'e1' },
      onSave: async (value: Record<string, unknown>) => { branchSaves.push(value); return true }, onClose: () => { branchClosed++ },
    })
    const branch3 = keysFor('branch_3')
    const branchKey = () => branch3.seven
    const startBranch = async () => {
      branchSaves.length = 0; branchClosed = 0; clearWorkDraft(branch3.seven); clearWorkDraft(branch3.eight)
      const branch = await mountHost(branchProps, app('branches'))
      await branch.type(branch.field('branch-location'), '12 River Road')
      await branch.settle()
      assert.equal(draftOf(branchKey())?.location, '12 River Road')
      return branch
    }

    await check(`${lang} Branch form, same-user blip: no notice, the draft keeps being written, Save works`, async () => {
      const branch = await startBranch()
      try {
        blip()
        await branch.render(branchProps)
        await branch.settle()
        assert.ok(!noticeShown(branch, warning), 'no false "account or server changed"')
        assert.equal(saveDisabled(branch), false)
        await branch.type(branch.field('branch-location'), '99 After Street')
        await branch.settle()
        assert.equal(draftOf(branchKey())?.location, '99 After Street', 'text typed after the blip is still written')
        await submit(branch)
        assert.equal(branchSaves.length, 1)
        assert.equal(branchSaves[0].location, '99 After Street')
        assert.equal(branchClosed, 1)
      } finally { await branch.unmount() }
    })

    await check(`${lang} Branch form, real switch 7 -> 8: notice, Save refused, nothing written under 8`, async () => {
      const branch = await startBranch()
      try {
        switchTo8()
        await branch.render(branchProps)
        await branch.type(branch.field('branch-location'), '1 Other Street')
        await branch.settle()
        assert.ok(noticeShown(branch, warning))
        assert.equal(saveDisabled(branch), true)
        assert.equal(draftOf(branch3.eight), null)
        assert.equal(draftOf(branchKey())?.location, '12 River Road')
        await submit(branch)
        assert.equal(branchSaves.length, 0)
      } finally { await branch.unmount() }
    })

    await check(`${lang} Branch form, a sign-in check lifts (same owner confirmed): the notice goes with the lock and Save works`, async () => {
      const branch = await startBranch()
      try {
        otherTabSignsIn()
        await branch.render(branchProps)
        assert.ok(noticeShown(branch, warning), 'locked while the sign-in is checked')
        assert.equal(saveDisabled(branch), true)
        await submit(branch)
        assert.equal(branchSaves.length, 0, 'a Save pressed during the check is refused')
        sameOwnerConfirmed()
        await branch.settle()
        assert.ok(!noticeShown(branch, warning), 'the notice leaves when the lock lifts')
        assert.equal(saveDisabled(branch), false)
        await submit(branch)
        assert.equal(branchSaves.length, 1)
        assert.equal(branchClosed, 1)
      } finally { await branch.unmount() }
    })

    // ---- Expense page (the host of the form: Minimize parks the draft the form was opened with) ------------------------
    for (const [label, change, parks] of [['same-user blip', blip, true], ['real switch 7 -> 8', switchTo8, false]] as const) {
      await check(`${lang} Expense page, ${label}: Minimize ${parks ? 'parks the form\'s own draft' : 'parks nothing and says why'}`, async () => {
        notices.length = 0
        clearWorkDraft(fee7.seven)
        const page = await mountHost(host('fees-page'), app())
        try {
          await page.click(page.button(words.add_fee))
          await page.type(page.field('fee-label'), 'Boost')
          await page.type(page.field('fee-amount-usd'), '5')
          await page.settle()
          const key = feeKey()
          assert.equal(draftOf(key)?.label, 'Boost')
          change()
          await page.click(page.button(words.minimize))
          if (parks) {
            assert.equal(parked.length, 1, 'the chip is parked')
            assert.equal(parked[0].draftKey, key, 'with the draft the form wrote')
            assert.ok(!notices.some((notice) => notice.message === warning), 'and no false notice')
          } else {
            assert.equal(parked.length, 0)
            assert.ok(notices.some((notice) => notice.message === warning), 'the toast says why')
          }
        } finally { await page.unmount() }
      })
    }

    // ---- Branches page ------------------------------------------------------------------------------------------------
    for (const [label, change, parks] of [['same-user blip', blip, true], ['real switch 7 -> 8', switchTo8, false]] as const) {
      await check(`${lang} Branches page, ${label}: Minimize ${parks ? 'parks the form\'s own draft' : 'parks nothing and says why'}`, async () => {
        notices.length = 0
        clearWorkDraft(branch3.seven)
        const page = await mountHost(host('branches-page'), app('branches'))
        try {
          await page.click(page.button(words.edit))
          await page.type(page.field('branch-location'), '12 River Road')
          await page.settle()
          const key = branchKey()
          assert.equal(draftOf(key)?.location, '12 River Road')
          change()
          await page.click(page.button(words.minimize))
          if (parks) {
            assert.equal(parked.length, 1)
            assert.equal(parked[0].draftKey, key)
            assert.ok(!notices.some((notice) => notice.message === warning))
          } else {
            assert.equal(parked.length, 0)
            assert.ok(notices.some((notice) => notice.message === warning))
          }
        } finally { await page.unmount() }
      })
    }

    // ---- Product form: Save is pressed, the confirmation is open, then the world churns, then it is confirmed ------------
    const productSaves: Array<Record<string, unknown>> = []
    const productProps = host('product-form', {
      product: null, categories: [], units: [], branches: [], user: OWNER, t: (key: string) => words[key] || '',
      usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100, onClose() {}, onSave: async (payload: Record<string, unknown>) => { productSaves.push(payload) },
    })
    const startProduct = async () => {
      productSaves.length = 0
      const product = await mountHost(productProps, app('products'))
      const name = product.find((node) => node.id === 'product-name', 'product name')
      await product.type(name, 'Rice 5kg')
      await product.click(product.button(words.save))
      return product
    }
    const confirmLabel = words.add_product

    await check(`${lang} Product form, same-user blip while the save confirmation is open: the confirmed save goes through`, async () => {
      const product = await startProduct()
      try {
        blip()
        await product.click(product.button(confirmLabel))
        assert.equal(productSaves.length, 1, 'the product is saved')
        assert.equal(productSaves[0].name, 'Rice 5kg')
        assert.ok(!noticeShown(product, warning), 'with no false notice')
      } finally { await product.unmount() }
    })

    await check(`${lang} Product form, real switch 7 -> 8 while the save confirmation is open: 7's product is never sent as 8`, async () => {
      const product = await startProduct()
      try {
        switchTo8()
        await product.click(product.button(confirmLabel))
        assert.equal(productSaves.length, 0, "7's product is never sent as 8")
      } finally { await product.unmount() }
    })

    await check(`${lang} Product form, 7 -> 8 -> 7 while the save confirmation is open: nothing is sent and the form says why`, async () => {
      const product = await startProduct()
      try {
        // User 8 is seen by an ordinary read while signed in (no re-render, so the form stays mounted), then 7 returns:
        // the draft key is 7's again, so only the owner generation can tell this from "nothing happened".
        switchTo8(); actor().captureActorReadScope(); writeUser()
        await product.click(product.button(confirmLabel))
        assert.equal(productSaves.length, 0, 'the round trip is not "unchanged"')
        assert.ok(noticeShown(product, warning), 'and the form says why')
      } finally { await product.unmount() }
    })

    await check(`${lang} Product form, a sign-in check lifts after a refused confirm: the notice goes and a second Save sends`, async () => {
      const product = await startProduct()
      try {
        otherTabSignsIn()
        await product.click(product.button(confirmLabel))
        assert.equal(productSaves.length, 0, 'confirmed during the check: nothing is sent')
        assert.ok(noticeShown(product, warning), 'and the form says why')
        sameOwnerConfirmed()
        await product.settle()
        assert.ok(!noticeShown(product, warning), 'the notice leaves when the lock lifts')
        await product.click(product.button(words.save))
        await product.click(product.button(confirmLabel))
        assert.equal(productSaves.length, 1, 'a second Save sends')
        assert.ok(!noticeShown(product, warning))
      } finally { await product.unmount() }
    })
  }
} finally {
  await harness.close()
}

if (failed) process.exit(1)

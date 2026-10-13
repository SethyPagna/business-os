// The pages that HOST the Expense and Branch forms (Daily-use B). Minimize
// parks a chip whose draftKey the page computed; it used to re-derive that key
// from the live account and server at click time, so after a sync-server
// switch it parked a chip in the NEW server's list pointing at the draft typed
// under the OLD one (and dismissing that chip would delete the old draft).
// The page now uses the draft the form was opened with and refuses to park
// once the account or server no longer matches.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, type MountedSurface } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'
import { clearWorkDraft, readWorkDraft, scopedWorkDraftKey } from '../src/utils/workDrafts.ts'

const SERVER_A = 'https://server-a.example'
const SERVER_B = 'https://server-b.example'
let serverUrl = SERVER_A
const harness = await createHarness({ observe: ['api/httpState.ts', 'utils/minimizedWork.ts'] })
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
const parked: Array<Record<string, unknown>> = []
const doubles = () => ({
  'api/httpState.ts': { getSyncServerUrl: () => serverUrl },
  'utils/minimizedWork.ts': { minimizeWork: (entry: Record<string, unknown>) => { parked.push(entry) } },
  'api/feesTransport.ts': {
    getFees: async () => ({ fees: [], total: 0, limit: 25, offset: 0 }),
    getFeesReport: async () => ({ totals: { count: 0, amount_usd: 0, amount_khr: 0 }, days: [], by_type: [], by_category: [] }),
    getFeeLabels: async () => ({ labels: [] }),
  },
  'api/branchTransport.ts': {
    getBranches: async () => [{ id: 3, name: 'Warehouse', canonical_key: 'warehouse', role: 'warehouse', is_active: 1, is_default: 0, successor_branch_id: null, edit_etag: 'e1' }],
    getTransfers: async () => ({ transfers: [], total: 0 }),
    getBranchSummary: async () => ({}),
  },
})
const control = (surface: MountedSurface, label: string) => surface.button(label)

try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const notices: string[] = []
    const app = {
      t: (key: string) => words[key] || '', user, notify: (message: string) => { notices.push(message) },
      can: () => true, getPermissionTier: () => 'all',
      fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD',
    }
    const warning = words.product_draft_authority_changed
    const feeA = keyUnder(SERVER_A, 'fee_new')
    const feeB = keyUnder(SERVER_B, 'fee_new')

    for (const switchServer of [false, true]) {
      for (const key of [feeA, feeB]) clearWorkDraft(key)
      parked.length = 0; notices.length = 0
      useServer(SERVER_A)
      const page = await harness.mount({ component: 'components/fees/FeesPage.tsx', props: {}, app, doubles: doubles() })
      await page.click(control(page, words.add_fee))
      await page.type(page.field('fee-label'), 'Boost')
      await page.type(page.field('fee-amount-usd'), '5')
      await page.settle()
      assert.equal(draftOf(feeA)?.label, 'Boost', `${lang}: the form wrote its draft under server A`)
      if (switchServer) useServer(SERVER_B)
      await page.click(control(page, words.minimize))
      if (!switchServer) {
        assert.equal(parked.length, 1, `${lang}: CONTROL: with no switch Minimize parks the chip`)
        assert.equal(parked[0].draftKey, feeA, `${lang}: CONTROL: the chip carries the form's own draft`)
      } else {
        assert.equal(parked.length, 0, `${lang}: after a server switch Minimize parks nothing`)
        assert.ok(notices.includes(warning), `${lang}: and says why`)
        assert.equal(draftOf(feeA)?.label, 'Boost', `${lang}: server A's draft is intact`)
        assert.equal(draftOf(feeB), null, `${lang}: nothing was written under server B`)
      }
      await page.unmount()
    }

    // ---- Branches page ------------------------------------------------
    const branchA = keyUnder(SERVER_A, 'branch_3')
    const branchB = keyUnder(SERVER_B, 'branch_3')
    for (const switchServer of [false, true]) {
      for (const key of [branchA, branchB]) clearWorkDraft(key)
      parked.length = 0; notices.length = 0
      useServer(SERVER_A)
      const page = await harness.mount({ component: 'components/branches/Branches.tsx', props: {}, app: { ...app, page: 'branches' }, doubles: doubles() })
      await page.click(control(page, words.edit))
      await page.type(page.field('branch-location'), '12 River Road')
      await page.settle()
      assert.equal(draftOf(branchA)?.location, '12 River Road', `${lang}: the branch form wrote its draft under server A`)
      if (switchServer) useServer(SERVER_B)
      await page.click(control(page, words.minimize))
      if (!switchServer) {
        assert.equal(parked.length, 1, `${lang}: CONTROL: with no switch Minimize parks the branch chip`)
        assert.equal(parked[0].draftKey, branchA, `${lang}: CONTROL: the chip carries the form's own draft`)
      } else {
        assert.equal(parked.length, 0, `${lang}: after a server switch Minimize parks no branch chip`)
        assert.ok(notices.includes(warning), `${lang}: and says why`)
        assert.equal(draftOf(branchA)?.location, '12 River Road', `${lang}: server A's branch draft is intact`)
        assert.equal(draftOf(branchB), null, `${lang}: nothing was written under server B`)
      }
      await page.unmount()
    }
  }
  console.log('PASS Expense and Branch pages: Minimize parks the draft the form was opened with, and refuses once the server has changed')
} finally {
  await harness.close()
}

// The reload-latest path and both forms must not fall back to the live key either.
for (const file of ['components/fees/FeesPage.tsx', 'components/fees/FeeForm.tsx', 'components/branches/BranchForm.tsx']) {
  assert.ok(!/scopedWorkDraftKey\(/.test(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')), `${file} never re-derives a draft key from the live account and server`)
}
console.log('PASS the Expense page and both forms hold no live draft-key derivation')

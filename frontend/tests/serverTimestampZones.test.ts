// D1's datetime('now') / CURRENT_TIMESTAMP write "YYYY-MM-DD HH:MM:SS" in UTC with no offset, and V8 reads a bare
// Date.parse / new Date of that shape as LOCAL time. A server stamp therefore goes through the shared
// parseServerTimestampMs (utils/formatters.ts), which treats an offset-less stamp as UTC:
//
//   FeeForm      the draft-restore floor: a draft older than the expense's updated_at must not come back over newer server data
//   ProductForm  the same floor for the product form
//   ReviewQueue  "Requested by ... <time>" and "Reviewed by ... <time>" in the business (Phnom Penh) zone
//
// Each runs in the real component, once per device zone (America/Los_Angeles, Asia/Phnom_Penh, UTC). The device zone is switched
// in-process with process.env.TZ and proved to have taken effect, so a TZ-blind environment cannot pass this vacuously.
//   draft restore   written 1 h AFTER the server stamp -> restored; 1 h BEFORE it -> dropped. With the local-time bug Phnom Penh
//                   restores the stale one (floor 7 h early) and Los Angeles drops the fresh one (floor 7 h late); UTC is the control.
//   review times    a stamp written at 10:00 UTC reads 17:00 on every device (the business zone), and 18:00 UTC reads 01:00 the
//                   NEXT day.
import assert from 'node:assert/strict'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'
import { STORAGE_KEYS } from '../src/constants.ts'
import { readWorkDraft, scopedWorkDraftKey } from '../src/utils/workDrafts.ts'

const ZONES = [['America/Los_Angeles', 420], ['Asia/Phnom_Penh', -420], ['UTC', 0]] as const
const RAW = '2026-10-13 10:00:00' // what D1 writes: UTC, no offset
const TRUE_MS = Date.UTC(2026, 9, 13, 10, 0, 0)
const HOUR = 3_600_000

const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }
const harness = await createHarness() // installs the browser globals
localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user))
;(window as unknown as { api: Record<string, unknown> }).api = { getSystemConfig: async () => ({}), getSuppliers: async () => [], getBranches: async () => [], getCategories: async () => [], getUnits: async () => [] }

let failed = 0
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
function inZone(zone: string, offsetMinutes: number): void {
  process.env.TZ = zone
  assert.equal(new Date(2026, 9, 13, 12).getTimezoneOffset(), offsetMinutes, `the device zone really is ${zone} now`)
}

await check('premise: the three device zones read the offset-less stamp as three different instants, and the shared parser as one', async () => {
  const { parseServerTimestampMs } = await import('../src/utils/formatters.ts')
  const local = ZONES.map(([zone, offset]) => { inZone(zone, offset); return Date.parse(RAW) })
  assert.equal(new Set(local).size, 3, 'a bare Date.parse depends on the device zone')
  const shared = ZONES.map(([zone, offset]) => { inZone(zone, offset); return parseServerTimestampMs(RAW) })
  assert.deepEqual(shared, [TRUE_MS, TRUE_MS, TRUE_MS], 'parseServerTimestampMs does not')
})

const fee = {
  id: 7, fee_type: 'expense', label: 'Staff lunch', amount_usd: 3.5, amount_khr: 0, fee_date: '2026-10-13', sale_id: null,
  branch_id: null, branch_name: null, delivery_contact_id: null, notes: null, created_by: 1, created_by_name: 'Sok',
  created_at: RAW, updated_at: RAW,
}
const writeDraft = (base: string, at: number, data: unknown): void => {
  localStorage.setItem(scopedWorkDraftKey(base), JSON.stringify({ at, data }))
}
const valueOf = (surface: MountedSurface, find: (node: MemoryNode) => boolean, what: string): string => String(propsOf(surface.find(find, what)).value ?? '')

try {
  for (const [zone, offset] of ZONES) {
    for (const [when, at, restored] of [['1 h after the server stamp', TRUE_MS + HOUR, true], ['1 h before the server stamp', TRUE_MS - HOUR, false]] as const) {
      await check(`${zone}: Expense form restores a draft written ${when}: ${restored ? 'restored' : 'dropped'}`, async () => {
        inZone(zone, offset)
        writeDraft('fee_7', at, { label: 'DRAFT LABEL' })
        const surface = await harness.mount({
          component: 'components/fees/FeeForm.tsx',
          props: { fee, actorId: 42, labelSuggestions: [], onSave: async () => {}, onClose: () => {} },
          app: { t: (key: string) => key, user, notify() {}, getPermissionTier: () => 'all' },
          doubles: { 'api/feesTransport.ts': { getFeeLabels: async () => ({ labels: [] }) }, 'api/branchTransport.ts': { getBranches: async () => [] } },
        })
        try {
          await surface.settle()
          assert.equal(valueOf(surface, (node) => node.id === 'fee-label', 'label field'), restored ? 'DRAFT LABEL' : 'Staff lunch')
          if (!restored) assert.equal(readWorkDraft(scopedWorkDraftKey('fee_7')), null, 'and the stale draft is removed')
        } finally { await surface.unmount() }
      })

      await check(`${zone}: Product form restores a draft written ${when}: ${restored ? 'restored' : 'dropped'}`, async () => {
        inZone(zone, offset)
        writeDraft('product_991', at, { form: { name: 'DRAFT NAME' } })
        const surface = await harness.mount({
          component: 'components/products/forms/ProductForm.tsx',
          props: {
            product: { id: 991, name: 'Stable product', brand: 'Old brand', updated_at: RAW }, categories: [], units: [], branches: [], user,
            t: (key: string) => (key === 'save' ? 'Save' : key === 'cancel' ? 'Cancel' : ''), usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
            onClose() {}, onSave: async () => {},
          },
          app: { user, page: 'products', t: () => '', notify() {}, settings: {}, formatDateTime: String },
          doubles: {},
        })
        try {
          await surface.settle()
          assert.equal(valueOf(surface, (node) => node.id === 'product-name', 'name field'), restored ? 'DRAFT NAME' : 'Stable product')
        } finally { await surface.unmount() }
      })
    }

    await check(`${zone}: Review Queue shows the stamp in the business zone: 10:00 UTC reads 17:00, 18:00 UTC reads 01:00 the next day`, async () => {
      inZone(zone, offset)
      const row = {
        id: 41, section: 'fees', action_type: 'delete', entity_type: 'fee', entity_id: 7, payload_json: JSON.stringify({ id: 7 }),
        summary: 'Delete fee #7: Staff lunch', status: 'approved', requested_by: 2, requested_by_name: 'Cashier', reviewed_by: 3,
        reviewed_by_name: 'Owner', reviewed_at: '2026-10-13 18:00:00', reject_reason: null, created_at: RAW, updated_at: RAW,
      }
      const surface = await harness.mount({
        component: 'components/review/ReviewQueue.tsx', props: {},
        app: { page: 'review', t: (key: string) => key, notify() {}, getPermissionTier: () => 'full', can: () => true, hasPermission: () => true, navigateTo() {}, user },
        doubles: { 'api/reviewQueueTransport.ts': { getPendingActions: async () => ({ data: [row] }) } },
      })
      try {
        await surface.settle()
        const text = surface.text()
        assert.ok(text.includes('13/10/2026 17:00'), `requested time reads 13/10/2026 17:00; the page says: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
        assert.ok(text.includes('14/10/2026 01:00'), 'reviewed time reads 14/10/2026 01:00')
      } finally { await surface.unmount() }
    })
  }
} finally {
  process.env.TZ = 'UTC'
  await harness.close()
}

if (failed) process.exit(1)

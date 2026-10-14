// Owner rule (offline mode cancelled, 26 Sep 2026): no connection = blocked saving. The Contacts-page Customers tab saved a
// customer on a dead connection (only the POS and Sales sheets were gated). The REAL tab is mounted with the app context's
// canWriteToServer: Add customer opens the form, whose Save is disabled beside the reason, the handler refuses on its own,
// and nothing reaches createCustomer; connected, the same Save reaches the review and the transport.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf, type MemoryNode, type MountedSurface } from './mountedComponentHarness.ts'

const packs = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const USER = { id: 7, organization_id: 1, name: 'Owner', role_code: 'admin' }
const harness = await createHarness({ localStorage: { businessos_user: JSON.stringify(USER) } })
let failed = 0

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

async function mountTab(pack: Record<string, string>, canWriteToServer: boolean) {
  const created: Array<Record<string, unknown>> = []
  const notes: Array<{ type: string; message: string }> = []
  const notify = (message: unknown, type: unknown) => { notes.push({ type: String(type), message: String(message) }) }
  const t = (key: string) => pack[key] ?? key
  const page: MountedSurface = await harness.mount({
    component: 'components/contacts/CustomersTab.tsx',
    exportName: 'CustomersTab',
    props: { t, notify, active: true },
    app: {
      t, notify, user: { ...USER, role_permissions: { all: true } }, authReady: true, page: 'contacts', settings: {}, language: 'en', can: () => true, hasPermission: () => true,
      getPermissionTier: () => 'all', fmtUSD: (v: number) => `$${v}`, fmtKHR: (v: number) => `${v}`, usdSymbol: '$', khrSymbol: 'R', exchangeRate: 4100, canWriteToServer,
      syncChannel: null, syncConnected: true,
    },
    doubles: {
      'api/contactReadTransport.ts': { getCustomers: async () => ({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }) },
      'api/contactWriteTransport.ts': { createCustomer: async (payload: Record<string, unknown>) => { created.push(payload); return { success: true, id: 90, ...payload } } },
    },
  })
  await page.settle()
  return { page, created, notes }
}

const addButton = (page: MountedSurface): MemoryNode => page.find((node) => node.tagName === 'BUTTON' && /^\s*(\+\s*)?(Add Customer|Add customer|Add)\s*$/.test(node.textContent.trim() || node.getAttribute('aria-label') || ''), 'the Add customer button')
const reasons = (page: MountedSurface, text: string): MemoryNode[] => page.findAll((node) => node.tagName === 'P' && node.getAttribute('role') === 'status' && node.textContent === text)

try {
  for (const [label, pack, blocked] of [['no connection', packs, true], ['connected', packs, false]] as const) {
    await check(`Contacts Customers tab, ${label}`, async () => {
      const tab = await mountTab(pack, !blocked)
      try {
        await tab.page.click(addButton(tab.page))
        await tab.page.type(tab.page.find((node) => node.tagName === 'INPUT' && /name/i.test(`${node.getAttribute('id')} ${node.getAttribute('name')} ${node.getAttribute('placeholder')}`), 'the name field'), 'Sok Dara')
        const save = tab.page.button(pack.save)
        if (blocked) {
          assert.equal(propsOf(save).disabled, true, 'Save is disabled')
          assert.equal(reasons(tab.page, pack.pos_saving_needs_connection).length, 1, 'the reason is beside it')
          await tab.page.call(save, 'onClick', [])
          assert.deepEqual(tab.created, [], 'createCustomer was never reached')
        } else {
          assert.ok(!propsOf(save).disabled, 'control: Save is live')
          assert.equal(reasons(tab.page, pack.pos_saving_needs_connection).length, 0)
          await tab.page.click(save)
          assert.ok(/Review|Add Customer/i.test(tab.page.text()), 'control: the review opens')
        }
      } finally { await tab.page.unmount() }
    })
  }
  await check('the reason is a real Khmer pack sentence', async () => {
    assert.ok(/[ក-៿]/.test(km.pos_saving_needs_connection))
  })
} finally {
  await harness.close()
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\ncustomersTabSavingGate: all checks passed')

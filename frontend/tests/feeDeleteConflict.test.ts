// Fee delete against the K2 Worker (fees-k): DELETE /api/fees/:id refuses an expense edited since the caller read it.
// The REAL Expense page is mounted over a transport whose answers the test controls. Both language packs.
//
//   sent version    the page passes the version of the row the operator is looking at to deleteFee
//   409 changed     the Worker's write_conflict: nothing was deleted, the list is re-read, the open detail shows the
//                   latest values, ONE message in the pack's language (not the Worker's English), and the next
//                   Delete sends the NEW version, so the operator is never stuck re-sending a stale one
//   404 / gone      the row was removed first: list re-read, detail closed, its own message
//   other failure   keeps its own message and does not pretend the record was refreshed
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, accessibleText, type MountedSurface, type MemoryNode } from './mountedComponentHarness.ts'

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const user = { id: 42, organization_id: 1, organization_public_id: 'org-1', role_code: 'admin', role_permissions: { all: true } }

const baseFee = {
  id: 7, fee_type: 'expense', label: 'Staff lunch', amount_usd: 3.5, amount_khr: 0, fee_date: '2026-10-13', sale_id: null,
  branch_id: null, branch_name: null, delivery_contact_id: null, notes: null, created_by: 1, created_by_name: 'Sok',
  created_at: '2026-10-13T03:00:00.000Z', updated_at: '2026-10-13T03:00:00.000Z',
}
const editedFee = { ...baseFee, label: 'Staff lunch (corrected)', amount_usd: 4, updated_at: '2026-10-13T04:00:00.000Z' }

const conflictError = () => Object.assign(new Error('This fee changed on another device. Refresh and try again.'),
  { status: 409, code: 'write_conflict', conflict: true, entity: 'fee', reason: 'updated' })
const notFoundError = () => Object.assign(new Error('Fee not found'), { status: 404 })

const harness = await createHarness()
let failed = 0

type Outcome = 'changed' | 'gone' | 'server-fault' | 'ok'

async function scenario(lang: 'en' | 'km', outcome: Outcome): Promise<void> {
  const words = packs[lang]
  const notices: Array<{ message: string; type?: string }> = []
  const sentToDelete: unknown[][] = []
  let listReads = 0
  let rowReads = 0
  // What the Worker holds: the edited row after another device changed it (changed), nothing after it removed it.
  let serverRow: typeof baseFee | null = baseFee
  let deleteCalls = 0
  const app = {
    page: 'sales', t: (key: string) => words[key] || '', user, notify: (message: string, type?: string) => { notices.push({ message, type }) },
    can: () => true, getPermissionTier: () => 'all',
    fmtUSD: (value: number) => `$${value}`, fmtKHR: (value: number) => `${value}`, khrToUsd: (value: number) => value / 4000, usdToKhr: (value: number) => value * 4000, displayCurrency: 'USD',
  }
  const page = await harness.mount({
    component: 'components/fees/FeesPage.tsx', props: {}, app,
    doubles: {
      'api/feesTransport.ts': {
        getFees: async () => { listReads += 1; return { fees: serverRow ? [serverRow] : [], total: serverRow ? 1 : 0, limit: 25, offset: 0, summary: [] } },
        getFeesReport: async () => ({ totals: { count: 0, amount_usd: 0, amount_khr: 0 }, days: [], by_type: [], by_category: [] }),
        getFeeLabels: async () => ({ labels: [] }),
        getFee: async () => { rowReads += 1; if (!serverRow) throw notFoundError(); return { fee: serverRow } },
        deleteFee: async (...args: unknown[]) => {
          sentToDelete.push(args)
          deleteCalls += 1
          if (outcome === 'changed' && deleteCalls === 1) { serverRow = editedFee; throw conflictError() }
          if (outcome === 'gone') { serverRow = null; throw notFoundError() }
          if (outcome === 'server-fault') throw Object.assign(new Error('Internal error'), { status: 500 })
          serverRow = null
          return { success: true }
        },
      },
      'api/branchTransport.ts': { getBranches: async () => [] },
    },
  })
  const deleteButtons = (surface: MountedSurface): MemoryNode[] => surface.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node) === words.delete)
  const pressDelete = async (surface: MountedSurface): Promise<void> => {
    await surface.click(deleteButtons(surface)[0])
    const confirm = deleteButtons(surface)
    assert.equal(confirm.length, 2, `${lang} ${outcome}: the confirmation dialog opened over the detail`)
    await surface.click(confirm[confirm.length - 1])
  }
  const detailNodes = (): MemoryNode[] => page.findAll((node) => node.getAttribute('data-expense-detail') !== null)
  try {
    await page.click(page.find((node) => node.getAttribute('data-expense-card') !== null, 'expense card'))
    assert.ok(page.text().includes(words.details), `${lang} ${outcome}: the detail opened`)
    const readsBefore = listReads

    await pressDelete(page)
    assert.equal(sentToDelete.length, 1, `${lang} ${outcome}: exactly one delete was sent`)
    assert.deepEqual(sentToDelete[0], [7, baseFee.updated_at], `${lang} ${outcome}: the delete states the version the operator was looking at`)

    if (outcome === 'ok') {
      assert.deepEqual(notices.map((n) => n.message), [words.fee_deleted], `${lang}: a confirmed delete says so`)
      assert.ok(listReads > readsBefore, `${lang}: and the list is re-read`)
      return
    }
    if (outcome === 'server-fault') {
      assert.deepEqual(notices, [{ message: 'Internal error', type: 'error' }], `${lang}: an unrelated failure keeps its own message as an error`)
      assert.equal(listReads, readsBefore, `${lang}: and does not claim a refresh`)
      assert.equal(rowReads, 0)
      assert.equal(detailNodes().length, 1, `${lang}: the detail stays open for another try`)
      return
    }
    const wanted = outcome === 'changed' ? words.fee_delete_conflict : words.fee_delete_gone
    assert.ok(wanted && (lang === 'en' || wanted !== packs.en[outcome === 'changed' ? 'fee_delete_conflict' : 'fee_delete_gone']), `${lang}: the pack has its own text for this refusal`)
    assert.deepEqual(notices, [{ message: wanted, type: 'warning' }], `${lang} ${outcome}: one message, in the pack's language, not the Worker's English`)
    assert.ok(listReads > readsBefore, `${lang} ${outcome}: the list was re-read`)
    if (outcome === 'gone') {
      assert.equal(detailNodes().length, 0, `${lang}: the detail of a removed expense closed`)
      return
    }
    assert.equal(rowReads, 1, `${lang} changed: the open expense was re-read`)
    assert.equal(detailNodes().length, 1, `${lang} changed: the detail stays open`)
    assert.ok(detailNodes()[0].textContent.includes(editedFee.label), `${lang} changed: the detail shows the latest values in place`)

    // The way out: Delete again now carries the NEW version and goes through.
    notices.length = 0
    await pressDelete(page)
    assert.deepEqual(sentToDelete[1], [7, editedFee.updated_at], `${lang} changed: the retry sends the latest version, not the stale one`)
    assert.deepEqual(notices.map((n) => n.message), [words.fee_deleted], `${lang} changed: the retry deletes`)
  } finally {
    await page.unmount()
  }
}

try {
  for (const lang of ['en', 'km'] as const) {
    for (const outcome of ['ok', 'changed', 'gone', 'server-fault'] as const) {
      try {
        await scenario(lang, outcome)
        console.log(`PASS ${lang} fee delete: ${outcome}`)
      } catch (error) {
        failed += 1
        console.error(`FAIL ${lang} fee delete: ${outcome}`)
        console.error(error)
      }
    }
  }
} finally {
  await harness.close()
}

// The global conflict dialog must leave this refusal to the page, or the operator gets two.
try {
  const app = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
  assert.match(app, /\['fees:delete'(?:, [^\]]+)?\]\.includes\(String\(detail\.channel \|\| ''\)\)\) return/, "AppContext's sync:conflict listener skips the fee delete channel")
  const page = readFileSync(new URL('../src/components/fees/FeesPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /'fees:delete',\s*FEES_MUTATION_TIMEOUT_MS/, 'the page times the same channel the listener skips')
  console.log('PASS the global conflict dialog leaves the fee delete to its page')
} catch (error) {
  failed += 1
  console.error('FAIL the global conflict dialog leaves the fee delete to its page')
  console.error(error)
}

if (failed) process.exit(1)

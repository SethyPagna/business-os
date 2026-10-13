import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { accessibleText, createHarness, type MemoryNode } from './mountedComponentHarness.ts'
import { cloneHistorySnapshot } from '../src/utils/historyHelpers.ts'

// A customer return must never be edited, undone or redone from a row whose
// lines were not loaded (OPUS-REVIEW-RETURN-EDIT-7077 finding 2, 12 Oct 2026).
// List rows carry no items, so a form or an Undo/Redo body built from one sent
// `items: []`, and PATCH /api/returns/:id then emptied the return: lines 2 -> 0,
// refund -> 0, restocked units taken back off the shelf. The Worker now refuses
// that body (return_edit_empty, cloudflare/scripts/
// test-return-edit-empty-refused-native.cjs); these checks hold the client:
//   1. mounted Returns page: Edit with a failing detail read shows the inline
//      error with Retry, opens no form and sends nothing; Retry with a loaded
//      detail opens the form with its lines.
//   2. the actual Undo/Redo builder refuses a snapshot without lines and sends
//      nothing; a snapshot with lines is still replayed.
//   3. the actual edit-history recorder offers Undo/Redo only when both ends
//      have lines, and never redoes to the pre-edit state.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const LOAD_FAILED = 'The lines of this return could not be loaded, so it cannot be edited yet. Nothing was changed.'
const LINES_UNAVAILABLE = 'The lines of this return were not loaded when this change was recorded, so it cannot be undone or redone here. Nothing was changed.'

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const serverTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
const listRow = {
  id: 41, return_number: 'RET-41', return_scope: 'customer', return_type: 'restock', status: 'completed', reason: 'Changed mind',
  created_at: serverTime, updated_at: '2026-10-12T02:00:00.000Z', total_refund_usd: 10, total_refund_khr: 41000,
  branch_id: 1, branch_name: 'Shop', customer_name: 'Sokha', receipt_number: 'S-7', sale_id: 7, money_precision_version: 0,
}
const lines = [
  { id: 1, sale_item_id: 11, product_id: 5, product_name: 'Serum', quantity: 1, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1 },
  { id: 2, sale_item_id: 12, product_id: 6, product_name: 'Toner', quantity: 1, applied_price_usd: 5, applied_price_khr: 20500, return_to_stock: 1, stock_action: 'restock', branch_id: 1 },
]
const detail = { ...listRow, items: lines, replacement_items: [] }

await runTest('the inline messages exist in English and Khmer', () => {
  assert.equal(en.return_edit_load_failed, LOAD_FAILED)
  assert.equal(en.return_history_lines_unavailable, LINES_UNAVAILABLE)
  for (const key of ['return_edit_load_failed', 'return_history_lines_unavailable']) {
    assert.match(String(km[key] || ''), /[ក-៿]/, `km.${key} is Khmer`)
  }
})

// ---------------------------------------------------------------------------
// 1. Mounted page: the edit form is never opened from the list row.
// ---------------------------------------------------------------------------
const operator = { id: 3, name: 'Dara', username: 'dara', role: 'admin' }
const harness = await createHarness({
  localStorage: { businessos_user: JSON.stringify(operator), businessos_read_session: 'read-session-of-dara' },
})
const fetched: string[] = []
const harnessFetch = globalThis.fetch
globalThis.fetch = ((input: unknown, init?: { method?: string }) => {
  fetched.push(`${init?.method || 'GET'} ${String(input)}`)
  return harnessFetch(input as RequestInfo, init as RequestInit)
}) as typeof fetch

await runTest('Edit with a failing detail read shows the error and Retry, opens no form and sends no PATCH', async () => {
  let detailLoads = 'fail' as 'fail' | 'ok'
  const detailReads: unknown[] = []
  const writes: unknown[][] = []
  const notices: Array<{ message: string; tone?: string }> = []
  const page = await harness.mount({
    component: 'components/returns/Returns.tsx',
    app: {
      page: 'sales', language: 'en', t: (key: string) => en[key] ?? key, user: operator, settings: {},
      notify: (message: string, tone?: string) => { notices.push({ message: String(message), tone }) },
      hasPermission: () => true, can: () => true, canAccessPage: () => true, getPermissions: () => ({}),
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`, fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      usdSymbol: '$', khrSymbol: '៛', exchangeRate: 4100,
    },
    doubles: {
      'api/returnsReadTransport.ts': {
        getReturns: async () => [{ ...listRow }],
        getReturn: async (id: unknown) => {
          detailReads.push(id)
          if (detailLoads === 'fail') throw Object.assign(new Error('Network unavailable'), { status: 0 })
          return structuredClone(detail)
        },
        getReturnsReport: async () => ({ totals: {}, by_reason: [], by_type: [] }),
        getReturnRecords: async () => ({ entries: [] }),
        getReturnReasonPresets: async () => ({}),
      },
      'api/returnsTransport.ts': {
        prepareReturnUpdateRequest: async (...args: unknown[]) => { writes.push(['prepare', ...args]); return { ...(args[1] as object), client_request_id: 'fixture' } },
        submitReturnUpdateRequest: async (...args: unknown[]) => { writes.push(['submit', ...args]); return { id: 41, updated_at: 'later' } },
        updateReturn: async (...args: unknown[]) => { writes.push(['update', ...args]); return { id: 41 } },
      },
      'api/actionHistoryTransport.ts': {
        getActionHistory: async () => ({ items: [] }),
        getActionHistoryUsers: async () => [],
        createActionHistory: async () => ({ id: 1 }),
      },
    },
  })
  try {
    const row = (): MemoryNode => page.find((node) => node.tagName === 'TR' && node.getAttribute('data-clickable') === 'true' && node.textContent.includes('RET-41'), 'the RET-41 row')
    await page.waitFor(() => page.findAll((node) => node.tagName === 'TR' && node.textContent.includes('RET-41')).length > 0, 'the RET-41 row')
    await page.call(row(), 'onKeyDown', [{ key: 'Enter', preventDefault() {} }])
    const editButton = (): MemoryNode[] => page.findAll((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === en.edit)
    await page.waitFor(() => editButton().length > 0, 'the detail Edit button')
    const readsBeforeEdit = detailReads.length
    await page.click(editButton()[0])
    const failurePanels = (): MemoryNode[] => page.findAll((node) => node.hasAttribute('data-return-edit-load-failure'))
    await page.waitFor(() => failurePanels().length > 0 || page.text().includes(en.edit_return_warning), 'the edit load failure (or a form)')
    if (page.text().includes(en.edit_return_warning)) {
      // Diagnostic for a source without the guard: what that form would send.
      await page.click(page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(`✓ ${en.save}`), 'the form Save button'))
      assert.fail(`an edit form was opened from the list row; its Save sent ${JSON.stringify(writes)}`)
    }

    assert.ok(detailReads.length > readsBeforeEdit, 'Edit asked the server for the return with its lines')
    const panel = page.find((node) => node.hasAttribute('data-return-edit-load-failure'), 'the edit load failure')
    assert.ok(panel.closest('[role=dialog]'), 'the error is shown in the shared dialog, above whatever list position the row was at')
    const alert = panel.querySelector('[role=alert]')
    assert.ok(alert && alert.textContent.includes(LOAD_FAILED), `the inline error names what happened; it reads ${panel.textContent}`)
    const retry = page.button(en.retry, panel)
    assert.ok(accessibleText(retry).includes(en.retry))
    assert.equal(page.text().includes(en.edit_return_warning), false, 'no edit form was opened from the list row')
    assert.deepEqual(writes, [], 'nothing was prepared or sent')
    assert.deepEqual(fetched.filter((line) => !line.startsWith('GET')), [], 'no write reached the network')

    detailLoads = 'ok'
    await page.click(retry)
    await page.waitFor(() => page.text().includes(en.edit_return_warning), 'the edit form after Retry')
    assert.equal(page.findAll((node) => node.hasAttribute('data-return-edit-load-failure')).length, 0, 'the error closes once the lines load')
    for (const line of lines) assert.ok(page.text().includes(line.product_name), `the form shows ${line.product_name}`)
    assert.deepEqual(writes, [], 'opening the form sends nothing')
  } finally {
    await page.unmount()
  }
})
globalThis.fetch = harnessFetch
await harness.close()

// ---------------------------------------------------------------------------
// 2 and 3. The actual Returns.tsx callbacks, executed from the source text.
// ---------------------------------------------------------------------------
const returnsSource = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const sourceAst = ts.createSourceFile('Returns.tsx', returnsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function transpile(code: string): string {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
}
function declarationText(name: string): string | null {
  let found: string | null = null
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceAst) === name && node.initializer) found = `return (${node.initializer.getText(sourceAst)})`
    else if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = `${node.getText(sourceAst)}\nreturn ${name}`
    else ts.forEachChild(node, visit)
  }
  visit(sourceAst)
  return found
}
// Optional: absent on a source that predates the guard, so the same file can
// show that source failing for the behaviour rather than for a missing name.
function moduleFunction(name: string): unknown {
  const text = declarationText(name)
  return text ? new Function(transpile(text))() : undefined
}
function pageCallback(name: string, scope: Record<string, unknown>): (...args: any[]) => any {
  const text = declarationText(name)
  assert.ok(text, `Returns.tsx must declare ${name}`)
  return new Function('useCallback', ...Object.keys(scope), transpile(text!))((callback: unknown) => callback, ...Object.values(scope))
}
const hasLoadedReturnLines = moduleFunction('hasLoadedReturnLines')
const tr = (key: string, fallback: string) => en[key] ?? fallback
const buildReturnHistoryPayload = pageCallback('buildReturnHistoryPayload', { hasLoadedReturnLines, tr })

function restoreHarness() {
  const calls: string[] = []
  const submitted: unknown[] = []
  const restore = pageCallback('restoreReturnSnapshot', {
    buildReturnHistoryPayload,
    currentPendingHistoryRequest: () => null,
    historyRestoreInFlightRef: { current: false },
    beginSingleAction: (ref: { current: boolean }) => { if (ref.current) return false; ref.current = true; return true },
    finishSingleAction: (ref: { current: boolean }) => { ref.current = false },
    setHistoryRestoreSaving: () => {},
    fetchReturnDetail: async () => { calls.push('read'); return { ...detail, updated_at: 'current-version' } },
    prepareReturnRequest: async (_id: unknown, payload: Record<string, unknown>) => { calls.push('prepare'); return { ...payload, client_request_id: 'history-fixture' } },
    freezeDirectMutationBody: (body: unknown) => Object.freeze(body),
    savePendingHistoryRequest: () => { calls.push('save-pending') },
    submitReturnHistoryRequest: async (_id: unknown, body: unknown) => { calls.push('submit'); submitted.push(body) },
    tr,
  })
  return { calls, submitted, restore }
}
const history = { entryId: 'entry-41', direction: 'undo' }

await runTest('the Undo/Redo builder refuses a snapshot without lines and sends nothing', async () => {
  const snapshots: Array<[string, Record<string, unknown>]> = [
    ['a list row (no items)', { ...listRow }],
    ['a row with items []', { ...listRow, items: [] }],
    ['a bare write result', { id: 41, updated_at: 'later' }],
  ]
  for (const [label, snapshot] of snapshots) {
    const { calls, submitted, restore } = restoreHarness()
    await assert.rejects(() => restore(snapshot, 'Undo return edit', history), (error: Error) => {
      assert.equal(error.message, LINES_UNAVAILABLE, `${label}: the operator is told why`)
      return true
    }, `${label} must be refused`)
    assert.deepEqual(submitted, [], `${label}: no body is sent`)
    assert.equal(calls.filter((call) => call !== 'read').length, 0, `${label}: nothing is prepared, stored or sent (${calls.join(',')})`)
  }
})

await runTest('a snapshot with its lines is still replayed whole', async () => {
  const { submitted, restore } = restoreHarness()
  await restore(structuredClone(detail), 'Undo return edit', history)
  assert.equal(submitted.length, 1)
  const body = submitted[0] as { items: Array<Record<string, unknown>>; expected_updated_at: string }
  assert.deepEqual(body.items.map((item) => [item.sale_item_id, item.product_id, item.quantity]), [[11, 5, 1], [12, 6, 1]])
  assert.equal(body.expected_updated_at, 'current-version')
})

function recorderHarness(latestRead: () => Promise<unknown>) {
  const pushed: Array<Record<string, unknown>> = []
  const restored: Array<{ snapshot: Record<string, unknown>; direction: string }> = []
  const fetchReturnSnapshot = pageCallback('fetchReturnSnapshot', {
    withLoaderTimeout: (run: () => Promise<unknown>) => run(),
    fetchReturnDetail: latestRead,
    RETURNS_SNAPSHOT_TIMEOUT_MS: 10000,
    cloneHistorySnapshot,
  })
  const record = pageCallback('handleReturnMutationSuccess', {
    fetchReturnSnapshot,
    cloneHistorySnapshot,
    hasLoadedReturnLines,
    loadReturns: async () => {},
    actionHistory: { pushAction: (entry: Record<string, unknown>) => { pushed.push(entry); return entry } },
    restoreReturnSnapshot: async (snapshot: Record<string, unknown>, _label: string, context: { direction: string }) => { restored.push({ snapshot, direction: context.direction }) },
  })
  return { pushed, restored, record }
}

await runTest('an edit whose latest state did not load is recorded without Undo/Redo, never redoing to the pre-edit state', async () => {
  const { pushed, record } = recorderHarness(async () => { throw new Error('Network unavailable') })
  await record({ kind: 'edit', result: { id: 41, updated_at: 'later' }, previousSnapshot: structuredClone(detail) })
  assert.equal(pushed.length, 1, 'the edit is still listed')
  assert.match(String(pushed[0].label), /^Edit return RET-41/)
  assert.equal(typeof pushed[0].undo, 'undefined', 'no Undo is offered without the latest lines')
  assert.equal(typeof pushed[0].redo, 'undefined', 'no Redo is offered: the fallback would be the pre-edit state')
})

await runTest('an edit with both ends loaded offers Undo to the old lines and Redo to the new ones', async () => {
  const edited = { ...structuredClone(detail), items: [{ ...lines[0], quantity: 2 }, lines[1]], updated_at: 'later' }
  const { pushed, restored, record } = recorderHarness(async () => structuredClone(edited))
  await record({ kind: 'edit', result: { id: 41, updated_at: 'later' }, previousSnapshot: structuredClone(detail) })
  assert.equal(pushed.length, 1)
  await (pushed[0].undo as () => Promise<void>)()
  await (pushed[0].redo as () => Promise<void>)()
  assert.deepEqual(restored.map((call) => [call.direction, (call.snapshot.items as Array<{ quantity: number }>).map((item) => item.quantity)]),
    [['undo', [1, 1]], ['redo', [2, 1]]])
})

if (failed) {
  console.error(`${failed} return edit-open/history guard check(s) failed`)
  process.exit(1)
}
console.log('PASS return edit opens only from loaded lines; Undo/Redo never builds items []')

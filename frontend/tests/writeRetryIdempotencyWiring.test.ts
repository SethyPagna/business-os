import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { accessibleText, createHarness, installSteppedClock as installOperatorClock, propsOf, type Harness, type MountedSurface, type SettleOptions } from './mountedComponentHarness.ts'
import { __resetApiWriteDedupeForTests, setSyncServerUrl } from '../src/api/http.ts'
import { awardCustomerPoints } from '../src/api/contactWriteTransport.ts'
import { adjustStock } from '../src/api/inventoryWriteTransport.ts'
import { createReturn, createSupplierReturn } from '../src/api/returnsTransport.ts'

const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const OPERATOR_DAY_BOUNDARY_MS = 25 * 60 * 60 * 1000
const WRITE_INTENT_MODULE = 'utils/writeIntent.ts'
const KEYED_HELPERS = ['identityForIntent', 'retryableRequestId']
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const unknownOutcomeAfterAnyWait = new RegExp(km.write_outcome_unknown_timeout.split('{seconds}').map(escapeRegExp).join('\\d+'))
const shown = (key: string, fallback: string): string => km[key] ?? fallback

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

type Call = unknown[]
type Notice = { message: string; tone?: string }
type Outcome = { kind: 'hang' } | { kind: 'lost' } | { kind: 'refused' } | { kind: 'answer'; value: unknown }
type WireRequest = Record<string, unknown>

const HANG: Outcome = { kind: 'hang' }
const LOST: Outcome = { kind: 'lost' }
const REFUSED: Outcome = { kind: 'refused' }
const answer = (value: unknown): Outcome => ({ kind: 'answer', value })

function outcomeOf(outcome: Outcome): Promise<unknown> {
  if (outcome.kind === 'hang') return new Promise(() => {})
  if (outcome.kind === 'lost') {
    return Promise.reject(Object.assign(new Error('The server did not confirm the write.'), { code: 'write_outcome_unknown', status: 503 }))
  }
  if (outcome.kind === 'refused') {
    return Promise.reject(Object.assign(new Error('The same request is still being processed.'), { code: 'in_flight', status: 409 }))
  }
  return Promise.resolve(outcome.value)
}

function scriptedWrite() {
  const calls: Call[] = []
  let next: Outcome = HANG
  let hanging = false
  return {
    calls,
    get hanging(): boolean { return hanging },
    will(outcome: Outcome): void {
      next = outcome
      hanging = false
    },
    fn: (...args: unknown[]): Promise<unknown> => {
      calls.push(JSON.parse(JSON.stringify(args)) as Call)
      hanging = next.kind === 'hang'
      return outcomeOf(next)
    },
  }
}
type ScriptedWrite = ReturnType<typeof scriptedWrite>

function withoutIdentity(request: unknown): WireRequest {
  const { client_request_id: _id, return_number: _number, ...rest } = request as WireRequest
  return rest
}

function assertEveryPartChanged(next: string[], previous: string[], why: string): void {
  next.forEach((part, index) => assert.notEqual(part, previous[index], why))
}

function recordNotices(notices: Notice[]) {
  return (message: string, tone?: string) => { notices.push({ message: String(message), tone }) }
}

interface MountedIntentDrive {
  press(): Promise<void>
  write: ScriptedWrite
  notices: Notice[]
  identityOf(call: Call): string[]
  requestOf(call: Call): unknown
  editIntent(): void
  committed: Outcome
  failParentOnce?: () => void
}

async function proveOneIdentityPerMountedIntent(drive: MountedIntentDrive): Promise<void> {
  const clock = installOperatorClock()
  try {
    const attempt = async (outcome: Outcome, label: string): Promise<Call> => {
      clock.advance(OPERATOR_DAY_BOUNDARY_MS)
      drive.write.will(outcome)
      const before = drive.write.calls.length
      await drive.press()
      assert.equal(drive.write.calls.length, before + 1, `${label}: one write per press`)
      return drive.write.calls[before]
    }
    const noticesBefore = drive.notices.length
    const timedOut = await attempt(HANG, 'the attempt the UI stopped waiting for')
    assert.ok(
      drive.notices.slice(noticesBefore).some((notice) => unknownOutcomeAfterAnyWait.test(notice.message)),
      `the UI stops waiting and says the outcome is unknown, in the active language; saw ${JSON.stringify(drive.notices.slice(noticesBefore))}`,
    )
    const retries = [
      await attempt(LOST, 'the retry whose answer was lost'),
      await attempt(REFUSED, 'the retry the Worker refused with a 409'),
    ]
    if (drive.failParentOnce) {
      drive.failParentOnce()
      retries.push(await attempt(drive.committed, 'the retry the Worker committed while the parent failed'))
    }
    retries.push(await attempt(drive.committed, 'the retry that committed'))
    for (const retry of retries) {
      assert.deepEqual(drive.identityOf(retry), drive.identityOf(timedOut), 'a retry after a failed or unknown attempt resends its identity, so the Worker replays instead of applying twice')
      assert.deepEqual(drive.requestOf(retry), drive.requestOf(timedOut), 'the retry resends the same request under that identity')
    }
    const identical = await attempt(LOST, 'the same values after a committed write')
    assertEveryPartChanged(drive.identityOf(identical), drive.identityOf(timedOut), 'after a committed write, even an identical intent is a new request')
    drive.editIntent()
    const edited = await attempt(LOST, 'a changed intent')
    assertEveryPartChanged(drive.identityOf(edited), drive.identityOf(identical), 'a changed intent is a new request, never a replay of the old one')
    const editedRetry = await attempt(drive.committed, 'the retry of the changed intent')
    assert.deepEqual(drive.identityOf(editedRetry), drive.identityOf(edited))
  } finally {
    clock.restore()
  }
}

const operator = { id: 3, name: 'Dara', username: 'dara', role: 'admin' }

function adminApp(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    page: 'dashboard',
    language: 'en',
    t: (key: string) => km[key] ?? key,
    user: operator,
    settings: {},
    notify: () => {},
    hasPermission: () => true,
    can: () => true,
    canAccessPage: () => true,
    getPermissions: () => ({}),
    saveSettings: async () => ({ success: true }),
    navigateTo: () => {},
    fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`,
    fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
    usdSymbol: '$',
    khrSymbol: '៛',
    exchangeRate: 4100,
    ...overrides,
  }
}

const harness: Harness = await createHarness({
  localStorage: { businessos_user: JSON.stringify(operator), businessos_read_session: 'read-session-of-dara' },
  observe: [WRITE_INTENT_MODULE],
})

function pressing(write: ScriptedWrite): SettleOptions {
  const before = write.calls.length
  return { until: () => write.calls.length > before, waitingFor: 'the write this press sends', expireWaitsWhen: () => write.hanging }
}

await runTest('loyalty add: a timed-out or lost award keeps its id; only a committed award or a changed intent mints a new one', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { points: '50', note: 'Birthday' }
  const member = { customer: { id: 42, name: 'Sokha', membership_number: 'M-42' }, points: { balance: 120 } }
  const page = await harness.mount({
    component: 'components/loyalty-points/LoyaltyPointsPage.tsx',
    app: adminApp({ page: 'promotions', notify: recordNotices(notices) }),
    doubles: {
      'api/contactsTransport.ts': { getCustomerPointSummaries: async () => [] },
      'api/portalTransport.ts': { lookupPortalMembership: async () => member, getPortalSubmissionsForReview: async () => [] },
      'api/contactWriteTransport.ts': { awardCustomerPoints: write.fn },
    },
  })
  try {
    await page.type(page.field('membership_lookup'), member.customer.membership_number)
    await page.click(page.button(shown('lookup', 'Check points')))
    await page.waitFor(() => page.findAll((node) => node.getAttribute('name') === 'loyalty_manual_points').length > 0, 'the award form')
    await proveOneIdentityPerMountedIntent({
      press: async () => {
        await page.type(page.field('loyalty_manual_points'), form.points)
        await page.type(page.field('loyalty_manual_points_note'), form.note)
        await page.click(page.button('Add points'), pressing(write))
      },
      write,
      notices,
      identityOf: (call) => [String((call[1] as WireRequest).client_request_id)],
      requestOf: (call) => [call[0], withoutIdentity(call[1])],
      editIntent: () => { form.points = '75' },
      committed: answer({ success: true }),
    })
    assert.deepEqual(write.calls[0][0], 42)
    assert.deepEqual(withoutIdentity(write.calls[0][1]), { points: 50, note: 'Birthday' })
    assert.match(String((write.calls[0][1] as WireRequest).client_request_id), /^loyalty_points_/)
  } finally {
    await page.unmount()
  }
})

await runTest('legacy customer return: a timed-out or lost create keeps its id AND return number until the create commits', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { quantity: '1', notes: '' }
  const serumLine = { id: 11, product_id: 5, product_name: 'Serum', quantity: 2, applied_price_usd: 10, applied_price_khr: 41000, branch_id: 1, batch_id: 31 }
  const sale = { id: 7, receipt_number: 'R-0007', customer_name: 'Sokha', branch_id: 1, exchange_rate: 4100, total_usd: 20, created_at: '2026-09-20 10:00:00', items: [serumLine] }
  const page = await harness.mount({
    component: 'components/returns/NewReturnModal.tsx',
    props: {
      initialReceiptQuery: sale.receipt_number,
      notify: recordNotices(notices),
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`,
      onClose: () => {},
      onSuccess: () => {},
    },
    app: adminApp({ page: 'returns' }),
    doubles: {
      'api/returnsReadTransport.ts': {
        lookupReturnReceipts: async () => [{ id: sale.id, receipt_number: sale.receipt_number, total_usd: sale.total_usd, created_at: sale.created_at, customer_name: sale.customer_name }],
        getReturns: async () => [],
        getReturnReasonPresets: async () => ({}),
      },
      'api/salesTransport.ts': { getSales: async () => [sale] },
      'api/returnsTransport.ts': { createReturn: write.fn },
    },
  })
  const confirmReturn = shown('confirm', 'Confirm')
  const onConfirmStep = (): boolean => page.findAll((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(confirmReturn)).length > 0
  try {
    await page.waitFor(() => page.findAll((node) => node.getAttribute('role') === 'option' && node.textContent.includes(sale.receipt_number)).length > 0, 'the matching receipt')
    await page.click(page.button(sale.receipt_number))
    await page.waitFor(() => page.findAll((node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'number').length > 0, 'the sale lines')
    await proveOneIdentityPerMountedIntent({
      press: async () => {
        if (onConfirmStep()) await page.click(page.button(shown('back', 'Back')))
        await page.type(page.find((node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'number', `the return quantity for ${serumLine.product_name}`), form.quantity)
        await page.type(page.find((node) => node.tagName === 'TEXTAREA', 'the return notes'), form.notes)
        await page.click(page.button(new RegExp(`^${escapeRegExp(shown('return_review', 'Review'))}`)))
        await page.click(page.button(confirmReturn), pressing(write))
      },
      write,
      notices,
      identityOf: (call) => [String((call[0] as WireRequest).client_request_id), String((call[0] as WireRequest).return_number)],
      requestOf: (call) => withoutIdentity(call[0]),
      editIntent: () => { form.notes = 'Opened box' },
      committed: answer({ success: true, id: 90 }),
    })
    const first = write.calls[0][0] as WireRequest
    assert.deepEqual(
      { sale: first.sale_id, receipt: first.receipt_number, notes: first.notes, items: (first.items as WireRequest[]).map((item) => [item.sale_item_id, item.product_id, item.quantity]) },
      { sale: 7, receipt: 'R-0007', notes: null, items: [[11, 5, 1]] },
    )
    assert.match(String(first.client_request_id), /^return_/)
    assert.match(String(first.return_number), /^RET-/)
  } finally {
    await page.unmount()
  }
})

await runTest('supplier return: the id survives a timeout, a lost answer and a failed hand-over to the parent', async () => {
  const write = scriptedWrite()
  const notices: Notice[] = []
  const form = { reason: 'Expired' }
  let parentFailures = 0
  const serum = { id: 5, name: 'Serum', sku: 'SER-5', category: 'Skincare', display_quantity: 6, cost_price_usd: 4, cost_price_khr: 16400 }
  const page = await harness.mount({
    component: 'components/returns/NewSupplierReturnModal.tsx',
    props: {
      notify: recordNotices(notices),
      fmtUSD: (value: unknown) => `$${Number(value || 0).toFixed(2)}`,
      fmtKHR: (value: unknown) => `${Number(value || 0)}៛`,
      onClose: () => {},
      onSuccess: () => {
        if (parentFailures > 0) {
          parentFailures -= 1
          throw new Error('The returns list could not refresh.')
        }
      },
    },
    app: adminApp({ page: 'returns' }),
    doubles: {
      'api/branchTransport.ts': { getBranches: async () => [{ id: 1, name: 'Store', is_active: true, is_default: true }] },
      'api/contactReadTransport.ts': { getSuppliers: async () => [{ id: 4, name: 'Glow Co' }] },
      'api/inventoryTransport.ts': { getInventorySummary: async () => [serum] },
      'api/returnsReadTransport.ts': { getReturnReasonPresets: async () => ({}) },
      'api/returnsTransport.ts': { createSupplierReturn: write.fn },
    },
  })
  try {
    await page.waitFor(() => page.findAll((node) => node.tagName === 'TR' && node.textContent.includes(serum.name)).length > 0, 'the branch stock list')
    await page.type(page.field('supplier-return-supplier'), 'Glow')
    await page.click(page.find((node) => node.getAttribute('role') === 'option' && node.textContent.includes('Glow Co'), 'supplier option Glow Co'))
    await proveOneIdentityPerMountedIntent({
      press: async () => {
        await page.type(page.field('supplier-return-reason'), form.reason)
        await page.type(page.find((node) => node.tagName === 'INPUT' && !!node.closest('tr')?.textContent.includes(serum.name), `quantity for ${serum.name}`), '2')
        await page.click(page.button(shown('save', 'Save')), pressing(write))
      },
      write,
      notices,
      identityOf: (call) => [String((call[0] as WireRequest).client_request_id), String((call[0] as WireRequest).return_number)],
      requestOf: (call) => withoutIdentity(call[0]),
      editIntent: () => { form.reason = 'Damaged in transit' },
      committed: answer({ success: true, id: 91 }),
      failParentOnce: () => { parentFailures = 1 },
    })
    const first = write.calls[0][0] as WireRequest
    assert.deepEqual(
      { branch: first.branch_id, supplier: first.supplier_id, reason: first.reason, items: first.items },
      { branch: 1, supplier: 4, reason: 'Expired', items: [{ product_id: 5, product_name: 'Serum', quantity: 2, cost_price_usd: 4, cost_price_khr: 16400 }] },
    )
    assert.match(String(first.client_request_id), /^supplier_return_/)
    assert.match(String(first.return_number), /^SRET-/)
  } finally {
    await page.unmount()
  }
})

// Inventory's own adjust form (Save -> Confirm, with client-side undo/redo)
// was retired on 30 Sep 2026: every stock change is a Stock Session line whose
// requestId is minted once and kept across failures (stockLineRequestIdDurability
// and fastStockInDraftLifecycle pin that), and Inventory keys no write intent
// of its own any more, so the sweep below no longer lists it.

await runTest('stock-action import: a retry resumes the job it created; only a started job, a different sheet or closing the sheet releases it', async () => {
  const created: string[] = []
  const uploads: unknown[] = []
  const starts: unknown[] = []
  const cancels: unknown[] = []
  let uploadOutcome: Outcome = answer({ ok: true })
  let startOutcome: Outcome = answer({ ok: true })
  const shelfA = { name: 'shelf-a.csv', text: 'name,barcode,shop,warehouse,date,action\nSerum,111,2,0,2026-09-01,add\n' }
  const shelfB = { name: 'shelf-b.csv', text: 'name,barcode,shop,warehouse,date,action\nToner,222,5,0,2026-09-01,add\n' }
  const importJobs = {
    createImportJob: async () => {
      created.push(`job-${created.length + 1}`)
      return { job: { id: created[created.length - 1] } }
    },
    uploadImportJobCsv: (upload: { jobId: unknown }) => { uploads.push(upload.jobId); return outcomeOf(uploadOutcome) },
    startImportJob: (jobId: unknown) => { starts.push(jobId); return outcomeOf(startOutcome) },
    cancelImportJob: async (jobId: unknown) => { cancels.push(jobId) },
    getImportJob: async (jobId: unknown) => ({ job: { id: jobId, status: 'completed' } }),
    getImportJobReview: async () => ({ items: [], total: 0 }),
  }
  const openSheet = () => harness.mount({
    component: 'components/products/import/StockActionImportModal.tsx',
    props: { t: (key: string, english: string) => km[key] ?? english, notify: () => {}, onClose: () => {}, onDone: () => {} },
    app: adminApp({ page: 'products' }),
    doubles: { 'api/importJobsTransport.ts': importJobs },
  })
  const importLabel = new RegExp(`^${escapeRegExp(shown('stock_import_start', 'Import'))}$`)
  const clock = installOperatorClock()
  try {
    const pick = async (sheet: MountedSurface, file: { name: string; text: string }) => {
      const input = sheet.find((node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'file', 'the file input')
      await sheet.call(input, 'onChange', [{ target: Object.assign(input, { files: [new File([file.text], file.name, { type: 'text/csv' })] }) }])
      await sheet.waitFor(() => sheet.findAll((node) => node.tagName === 'BUTTON' && importLabel.test(accessibleText(node)) && !propsOf(node).disabled).length > 0, `${file.name} ready to import`)
    }
    const importSheet = async (sheet: MountedSurface, upload: Outcome, start: Outcome) => {
      clock.advance(OPERATOR_DAY_BOUNDARY_MS)
      uploadOutcome = upload
      startOutcome = start
      const sent = uploads.length + starts.length
      await sheet.click(sheet.button(importLabel), { until: () => uploads.length + starts.length > sent, waitingFor: 'the upload or start this press sends' })
    }

    const first = await openSheet()
    await pick(first, shelfA)
    await importSheet(first, LOST, answer({ ok: true }))
    await importSheet(first, answer({ ok: true }), LOST)
    await importSheet(first, answer({ ok: true }), LOST)
    assert.deepEqual(created, ['job-1'], 'a retry after a failed upload or a lost start answer resumes job-1 instead of creating a second job')
    assert.deepEqual(uploads, ['job-1', 'job-1'], 'the failed upload is retried once and a delivered sheet is never uploaded twice into the same job')
    assert.deepEqual(starts, ['job-1', 'job-1'])
    await pick(first, shelfB)
    await importSheet(first, answer({ ok: true }), LOST)
    assert.deepEqual(cancels, ['job-1'], 'a different sheet cancels the orphaned job first')
    assert.deepEqual(created, ['job-1', 'job-2'])
    await first.unmount()
    assert.deepEqual(cancels, ['job-1', 'job-2'], 'closing the sheet cancels the job it created but never started')

    const second = await openSheet()
    await pick(second, shelfA)
    await importSheet(second, answer({ ok: true }), LOST)
    await importSheet(second, answer({ ok: true }), answer({ ok: true }))
    assert.deepEqual(created, ['job-1', 'job-2', 'job-3'], 'the retry after a lost start answer resumes job-3')
    assert.deepEqual(uploads.slice(-1), ['job-3'], 'the resumed job is not uploaded again')
    assert.deepEqual(starts.slice(-2), ['job-3', 'job-3'])
    await second.unmount()
    assert.deepEqual(cancels, ['job-1', 'job-2'], 'a started job is released: closing the sheet never cancels it')
  } finally {
    clock.restore()
  }
})

await runTest('the write transports put a supplied identity on the wire unchanged', async () => {
  const originalFetch = globalThis.fetch
  const bodies: WireRequest[] = []
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as WireRequest)
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  setSyncServerUrl('https://sync.example.test')
  try {
    const sends: Array<[string, () => Promise<unknown>, WireRequest]> = [
      ['createReturn', () => createReturn({ sale_id: 7, client_request_id: 'return_fixed', return_number: 'RET-FIXED' }), { client_request_id: 'return_fixed', return_number: 'RET-FIXED' }],
      ['createSupplierReturn', () => createSupplierReturn({ supplier_id: 4, client_request_id: 'supplier_return_fixed', return_number: 'SRET-FIXED' }), { client_request_id: 'supplier_return_fixed', return_number: 'SRET-FIXED' }],
      ['awardCustomerPoints', () => awardCustomerPoints(42, { points: 50, note: 'Birthday', client_request_id: 'loyalty_points_fixed' }), { client_request_id: 'loyalty_points_fixed' }],
      ['adjustStock', () => adjustStock({ productId: 9, type: 'remove', quantity: 2, client_request_id: 'stockadjust_fixed' }), { client_request_id: 'stockadjust_fixed' }],
    ]
    for (const [name, send, identity] of sends) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await send()
        const body = bodies[bodies.length - 1]
        for (const [field, value] of Object.entries(identity)) {
          assert.equal(body[field], value, `${name} attempt ${attempt + 1}: ${field} is the caller's, not minted per call`)
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    setSyncServerUrl('')
    __resetApiWriteDedupeForTests()
  }
})

function keyedIntentCallers(): string[] {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
  const callers: string[] = []
  for (const entry of readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })) {
    const path = entry.replace(/\\/g, '/')
    if (!/\.tsx?$/.test(path) || path === WRITE_INTENT_MODULE) continue
    const text = readFileSync(`${srcRoot}${path}`, 'utf8')
    if (!text.includes('writeIntent')) continue
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const helperNames = new Set<string>()
    const namespaces = new Set<string>()
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !/\/writeIntent(?:\.ts)?$/.test((statement.moduleSpecifier as ts.StringLiteral).text)) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if (KEYED_HELPERS.includes((element.propertyName ?? element.name).text)) helperNames.add(element.name.text)
      }
    }
    let keyed = false
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        if (ts.isIdentifier(callee) && helperNames.has(callee.text)) keyed = true
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && KEYED_HELPERS.includes(callee.name.text)) keyed = true
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    if (keyed) callers.push(path)
  }
  return callers.sort()
}

await runTest('every component that keys a write intent is driven above through a timeout and its retries', () => {
  const driven = new Set(KEYED_HELPERS.flatMap((name) => harness.callersOf(WRITE_INTENT_MODULE, name)))
  assert.ok(driven.size > 0, 'the mounted cases reached the keyed-intent helpers')
  const undriven = keyedIntentCallers().filter((path) => !driven.has(path))
  assert.deepEqual(undriven, [], `these files key a write intent that no mounted case above drives; mount each one and prove its retry keeps the id: ${undriven.join(', ')}`)
})

await harness.close()

if (failed) {
  console.error(`${failed} write retry idempotency test(s) failed`)
  process.exit(1)
}
console.log('write retry idempotency: all cases pass')

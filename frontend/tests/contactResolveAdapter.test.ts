// R12: the contacts side of the one conflict resolver. A duplicate group opens
// in the Resolve grid; this pins what the grid offers, what it suggests, what
// the confirm says and what goes on the wire.
//
// The adapter runs for real over the real transport (contactDuplicates.ts on
// api/http.ts) against a stubbed fetch, so the request asserted here is the
// one the Worker receives (T28: one request with every merged id, no loop).
//
// Run: node tests/contactResolveAdapter.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

const saved = { fetch: globalThis.fetch, window: globalThis.window, CustomEvent: globalThis.CustomEvent }
globalThis.CustomEvent = class extends Event {
  detail: unknown
  constructor(type: string, init: { detail?: unknown } = {}) { super(type); this.detail = init.detail }
} as any
globalThis.window = {
  localStorage: createStorage(),
  sessionStorage: createStorage(),
  dispatchEvent: () => true,
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
} as any

const http = await import('../src/api/http.ts')
const { createContactResolveAdapter } = await import('../src/components/contacts/contactResolveAdapter.ts')
type Draft = import('../src/components/shared/ResolveModal.tsx').ResolveDraft
type Row = import('../src/components/shared/ResolveGrid.tsx').ResolveRow

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const t = (key: string) => en[key] ?? key

type Sent = { method: string; url: string; body: any }
let sent: Sent[] = []
let answers: Array<() => Response> = []
function serve(...responses: Array<() => Response>): void {
  sent = []
  answers = [...responses]
  http.__resetApiHealthForTests()
  http.__resetApiWriteDedupeForTests()
  http.setSyncServerUrl('https://sync.example.test')
}
globalThis.fetch = (async (url: string, init: { method?: string; body?: string } = {}) => {
  sent.push({ method: String(init.method || 'GET'), url: String(url), body: init.body ? JSON.parse(init.body) : null })
  const next = answers.shift()
  if (!next) throw new Error(`unexpected request ${init.method} ${url}`)
  return next()
}) as any
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let failed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// Three customers the list grouped by name. #11 is the only one with a phone,
// so it is the kept record; #11 and #13 each hold a membership number and a
// storefront account.
const RECORDS = [
  { id: 11, name: 'Dara', phone: '012 345 678', email: '', address: null, gender: 'female', notes: 'VIP', membership_number: 'M-1', created_at: '2026-01-02 03:04:05', updated_at: 'v11', portal_account: { membershipId: 'M-1', createdAt: null } },
  { id: 12, name: 'dara', phone: null, email: 'dara@example.com', address: 'St 1, Phnom Penh', gender: '', notes: null, membership_number: null, created_at: '2026-02-03 04:05:06', updated_at: 'v12', portal_account: null },
  { id: 13, name: 'Dara ', phone: null, email: null, address: null, gender: 'male', notes: '', membership_number: 'M-2', created_at: '2026-03-04 05:06:07', updated_at: 'v13', portal_account: { membershipId: 'M-2', createdAt: null } },
]
const entry = (row: typeof RECORDS[number], history: any = null) => ({ id: row.id, name: row.name, phone: row.phone, membershipNumber: row.membership_number, updated_at: row.updated_at, history })
const CLUSTER = {
  type: 'name' as const,
  value: 'dara',
  severity: 'name_only' as const,
  contacts: [
    entry(RECORDS[0], { salesCount: 3, returnsCount: 0, pointsBalance: 10 }),
    entry(RECORDS[1], { salesCount: 1, returnsCount: 1 }),
    entry(RECORDS[2]),
  ],
}

const EMPTY: Draft = { selection: {}, columns: {} }
const signal = new AbortController().signal
let written = 0
function adapterFor(table: 'customers' | 'suppliers' | 'delivery_contacts' = 'customers', cluster: any = CLUSTER, canMerge = () => true) {
  return createContactResolveAdapter({ table, cluster, t, canMerge, onWritten: () => { written += 1 } })
}
/** What ResolveModal does: the adapter's starting point, then the operator's edits on top. */
async function open(adapter: ReturnType<typeof adapterFor>, records: unknown[], edits: Draft = EMPTY) {
  serve(json(200, records))
  const data = await adapter.load(signal, edits)
  const initial = adapter.initialSelection(data)
  const draft: Draft = { selection: { ...initial.selection, ...edits.selection }, columns: { ...initial.columns, ...edits.columns } }
  return { data, initial, draft, columns: adapter.columns(data, draft), rows: adapter.rows(data, draft) }
}
const row = (rows: Row[], key: string): Row => {
  const found = rows.find((item) => item.key === key)
  assert.ok(found, `row ${key}`)
  return found
}
const texts = (item: Row) => Object.fromEntries(Object.entries(item.cells).map(([id, cell]) => [id, cell.text]))

try {
  await test('the grid reads the records fresh and suggests what one merge would keep', async () => {
    const { columns, rows } = await open(adapterFor(), RECORDS)
    assert.equal(sent.length, 1)
    assert.match(sent[0].url, /\/api\/customers\?ids=11,12,13$/, 'every record of the group is read again')
    assert.deepEqual(columns.map((column) => [column.id, column.title, column.subtitle, column.disposition]), [
      ['11', 'Dara', '#11 · Record kept', 'include'],
      ['12', 'dara', '#12', 'include'],
      ['13', 'Dara', '#13', 'include'],
    ])
    assert.deepEqual(columns[0].dispositions, ['include', 'separate'], 'Keep separate lives in the grid, beside Merge in')
    assert.deepEqual(rows.map((item) => item.key), ['record', 'name', 'phone', 'membership', 'storefront', 'email', 'address', 'gender', 'notes', 'created_at', 'history'])
    assert.deepEqual([row(rows, 'record').choice, row(rows, 'record').final.text], [{ source: '11' }, '#11'], 'the one record with a phone is kept, as Merge selected would')
    assert.deepEqual([row(rows, 'name').choice, row(rows, 'name').final.text, row(rows, 'name').copyable], [{ source: '11' }, 'Dara', true])
    assert.deepEqual([row(rows, 'email').choice, row(rows, 'email').final.text], [{ source: '12' }, 'dara@example.com'], 'a blank field takes the first record that has one')
    assert.equal(row(rows, 'address').final.text, '#1 (Default) St 1, Phnom Penh')
    assert.equal(row(rows, 'address').label, 'Contact options')
    assert.deepEqual(texts(row(rows, 'gender')), { 11: 'Female', 12: 'Unspecified', 13: 'Male' })
    assert.deepEqual(row(rows, 'gender').options?.map((option) => option.id), ['male', 'female', 'other', 'unspecified'])
    assert.equal(row(rows, 'created_at').final.text, '02/01/2026 10:04', 'dates read day-first, 24-hour, business time')
    assert.equal(row(rows, 'history').kind, 'computed')
    assert.deepEqual(texts(row(rows, 'history')), { 11: '3 Sales · 10 points', 12: '1 Sales · 1 Returns', 13: '' })
    assert.equal(row(rows, 'history').final.text, '4 Sales · 1 Returns · 10 points', 'Final is what the kept record ends up holding')
  })

  await test('two membership numbers: the row is required and starts answered, the other number goes to Notes', async () => {
    const { rows } = await open(adapterFor(), RECORDS)
    const membership = row(rows, 'membership')
    assert.equal(membership.kind, 'required')
    assert.deepEqual(membership.choice, { source: '11' }, "pre-answered with the kept record's number, so the merge never stops to ask")
    assert.equal(membership.final.text, 'M-1')
    assert.equal(membership.cells['12'].disabledReason, 'No number', 'a record without a number cannot be picked')
    assert.equal(row(rows, 'notes').final.text, 'VIP · Merged membership: M-2', 'the number that does not stay is kept as a line in Notes')

    const other = await open(adapterFor(), RECORDS, { selection: { membership: { source: '13' } }, columns: {} })
    assert.equal(row(other.rows, 'membership').final.text, 'M-2')
    assert.equal(row(other.rows, 'notes').final.text, 'VIP · Merged membership: M-1')
  })

  await test('D7: the storefront account of the membership that stays stays linked', async () => {
    const first = await open(adapterFor(), RECORDS)
    const storefront = row(first.rows, 'storefront')
    assert.equal(storefront.kind, 'choice', 'two accounts: a person may choose')
    assert.deepEqual([storefront.choice, storefront.final.text], [{ source: '11' }, 'M-1'])
    assert.equal(storefront.cells['12'].disabledReason, 'No account')

    const followed = await open(adapterFor(), RECORDS, { selection: { membership: { source: '13' } }, columns: {} })
    assert.deepEqual(row(followed.rows, 'storefront').choice, { source: '13' }, 'choosing the other number moves the default account with it')

    const picked = await open(adapterFor(), RECORDS, { selection: { membership: { source: '13' }, storefront: { source: '11' } }, columns: {} })
    assert.deepEqual(row(picked.rows, 'storefront').choice, { source: '11' }, 'an explicit account choice wins')

    // Account ids that do not mirror the numbers: the record the number came
    // from, then the kept record, then the first holder.
    const renamed = RECORDS.map((record) => (record.portal_account ? { ...record, portal_account: { membershipId: `W-${record.id}`, createdAt: null } } : record))
    const bySource = await open(adapterFor(), renamed, { selection: { membership: { source: '13' } }, columns: {} })
    assert.deepEqual(row(bySource.rows, 'storefront').choice, { source: '13' })
    const noNumbers = renamed.map((record) => ({ ...record, membership_number: null }))
    const byKeeper = await open(adapterFor(), noNumbers)
    assert.equal(byKeeper.rows.some((item) => item.key === 'membership'), false, 'no number, no membership row')
    assert.deepEqual(row(byKeeper.rows, 'storefront').choice, { source: '11' })
  })

  await test('one account or none: nothing to choose', async () => {
    const single = RECORDS.map((record) => (record.id === 13 ? { ...record, portal_account: null, membership_number: null } : record))
    const { rows } = await open(adapterFor(), single)
    assert.deepEqual([row(rows, 'membership').kind, row(rows, 'membership').final.text], ['computed', 'M-1'])
    assert.deepEqual([row(rows, 'storefront').kind, row(rows, 'storefront').choice], ['computed', undefined])
    assert.equal(row(rows, 'notes').final.text, 'VIP', 'nothing is added to Notes')
    const none = await open(adapterFor(), RECORDS.map((record) => ({ ...record, portal_account: null })))
    assert.equal(none.rows.some((item) => item.key === 'storefront'), false)
  })

  await test('Resolve builds ONE request naming every choice, and the confirm says what changes', async () => {
    const adapter = adapterFor()
    const { data, draft } = await open(adapter, RECORDS)
    const review = await adapter.review(data, draft, signal)
    const request = review.token.request
    assert.deepEqual({ ...request, client_request_id: 'x' }, {
      keepId: 11,
      mergeIds: [12, 13],
      client_request_id: 'x',
      expected: [{ id: 11, updated_at: 'v11' }, { id: 12, updated_at: 'v12' }, { id: 13, updated_at: 'v13' }],
      choices: {
        name: { source_id: 11 }, phone: { source_id: 11 }, email: { source_id: 12 }, address: { source_id: 12 },
        gender: { source_id: 11 }, notes: { source_id: 11 }, created_at: { source_id: 11 },
      },
      membership_source_id: 11,
      portal_keep_contact_id: 11,
    }, 'what the grid shows is what the server is told to write')
    assert.match(request.client_request_id, /^contact_merge_/)
    assert.equal(review.undoable, false, 'contact merges have no undo (council D9)')
    assert.equal(review.message, 'Merge dara (#12), Dara (#13) into Dara (#11).')
    assert.deepEqual(review.changes, [
      { label: 'Email', before: '', after: 'dara@example.com' },
      { label: 'Contact options', before: '', after: '#1 (Default) St 1, Phnom Penh' },
      { label: 'Notes', before: 'VIP', after: 'VIP · Merged membership: M-2' },
    ], 'only the fields that change, before and after')
    assert.deepEqual(review.warnings, [
      'This cannot be undone.',
      'Storefront account M-2 of Dara (#13) will be unlinked. It can still sign in.',
    ], 'the confirm names every storefront account that becomes unlinked')
  })

  await test('typed and option answers travel as custom values', async () => {
    const adapter = adapterFor()
    const edits: Draft = {
      selection: {
        record: { source: '13' },
        name: { custom: 'Dara Sok' },
        gender: { option: 'unspecified' },
        email: { source: '12' },
        phone: { custom: '099 888 777' },
      },
      columns: {},
    }
    const { data, draft, rows } = await open(adapter, RECORDS, edits)
    assert.deepEqual([row(rows, 'name').choice, row(rows, 'name').final.text], [{ custom: 'Dara Sok' }, 'Dara Sok'])
    assert.deepEqual([row(rows, 'gender').choice, row(rows, 'gender').final.text], [{ option: 'unspecified' }, 'Unspecified'])
    const review = await adapter.review(data, draft, signal)
    assert.equal(review.token.request.keepId, 13, 'the record chosen to keep is kept')
    assert.deepEqual(review.token.request.mergeIds, [11, 12])
    assert.deepEqual(review.token.request.choices?.name, { custom: 'Dara Sok' })
    assert.deepEqual(review.token.request.choices?.phone, { custom: '099 888 777' })
    assert.deepEqual(review.token.request.choices?.gender, { custom: null }, 'Unspecified clears the field')
    assert.equal(review.token.request.membership_source_id, 13, "the kept record's own number is the default")
    assert.deepEqual(review.changes.find((change) => change.label === 'Gender'), { label: 'Gender', before: 'Male', after: 'Unspecified' })
  })

  await test('T28: Resolve sends ONE merge request with every merged id and shows what the server stored', async () => {
    const adapter = adapterFor()
    const { data, draft } = await open(adapter, RECORDS)
    const review = await adapter.review(data, draft, signal)
    serve(json(200, {
      keeper: { id: 11, name: 'Dara', email: 'dara@example.com', address: 'St 1, Phnom Penh', notes: 'VIP\nMerged membership: M-2', membership_number: 'M-1', updated_at: 'v11b' },
      merged_ids: [12, 13],
      after: {
        merged_ids: [12, 13],
        merged_names: ['dara', 'Dara '],
        portal_accounts: [{ id: 7, contact_id: 11, membership_id: 'M-1', name: 'Dara' }, { id: 9, contact_id: null, membership_id: 'M-2', name: 'Dara ' }],
        membership_to_notes: ['M-2'],
      },
      operationId: 'op-1',
    }))
    written = 0
    const progress: Array<[number, number]> = []
    const result = await adapter.apply(review.token, signal, (done, total) => progress.push([done, total]))
    assert.equal(sent.length, 1, 'one group is one request, never a loop of two-record merges')
    assert.equal(sent[0].method, 'POST')
    assert.match(sent[0].url, /\/api\/customers\/merge$/)
    assert.deepEqual(sent[0].body, review.token.request, 'the frozen review goes out exactly')
    assert.deepEqual(progress, [[2, 2]])
    assert.equal(written, 1, 'the host learns its list is out of date')
    assert.deepEqual([result.done, result.total, result.next], [2, 2, undefined])
    assert.deepEqual(result.after, [
      { label: 'Record kept', value: 'Dara (#11)' },
      { label: 'Email', value: 'dara@example.com' },
      { label: 'Contact options', value: '#1 (Default) St 1, Phnom Penh' },
      { label: 'Notes', value: 'VIP · Merged membership: M-2' },
      { label: 'Merged records', value: 'dara (#12), Dara (#13)' },
      { label: 'Membership numbers moved to Notes', value: 'M-2' },
      { label: 'Storefront accounts unlinked', value: 'M-2' },
    ], "the after values are the server's, not the review's")
  })

  await test('Continue resumes a stepped merge from the step that did not answer', async () => {
    const adapter = adapterFor()
    const { data, draft } = await open(adapter, RECORDS)
    const review = await adapter.review(data, draft, signal)
    const continuation = { ...review.token.request, mergeIds: [13], client_request_id: `${review.token.request.client_request_id}:r1`, expected: [{ id: 11, updated_at: 'v11b' }, { id: 13, updated_at: 'v13' }] }
    serve(
      json(200, { keeper: { id: 11, name: 'Dara' }, merged_ids: [12], after: { merged_ids: [12], merged_names: ['dara'], portal_accounts: [], membership_to_notes: [] }, remaining_merge_ids: [13], continuation }),
      () => { throw new TypeError('Failed to fetch') },
    )
    written = 0
    await assert.rejects(adapter.apply(review.token, signal, () => {}), (error: any) => error.outcome === 'unknown')
    assert.equal(written, 1, 'the first step committed, so the list is already stale')
    serve(json(200, { keeper: { id: 11, name: 'Dara' }, merged_ids: [13], after: { merged_ids: [13], merged_names: ['Dara '], portal_accounts: [], membership_to_notes: [] }, replayed: true }))
    const result = await adapter.apply(review.token, signal, () => {})
    assert.equal(sent.length, 1, 'Continue does not start over')
    assert.equal(sent[0].body.client_request_id, continuation.client_request_id, 'it re-sends the step that did not answer, with its own id')
    assert.equal(result.after.find((item) => item.label === 'Merged records')?.value, 'dara (#12), Dara (#13)', 'both steps are in the result')
  })

  await test('a refusal that means the records moved reads them again', () => {
    const adapter = adapterFor()
    for (const code of ['contact_merge_conflict', 'membership_choice_required', 'portal_choice_required', 'anonymous_customer_immutable']) {
      assert.equal(adapter.isStale(Object.assign(new Error('refused'), { code })), true, code)
    }
    assert.equal(adapter.isStale(Object.assign(new Error('refused'), { code: 'contact_merge_invalid_choice' })), false)
    assert.equal(adapter.isStale(new Error('offline')), false)
    assert.equal(adapter.isStale(null), false)
  })

  await test('without merge permission at the moment of writing nothing is sent', async () => {
    const adapter = adapterFor('customers', CLUSTER, () => false)
    const { data, draft } = await open(adapter, RECORDS)
    const review = await adapter.review(data, draft, signal)
    serve()
    await assert.rejects(adapter.apply(review.token, signal, () => {}), /Access Denied/)
    assert.equal(sent.length, 0)
  })

  await test('a cluster refusal returns to a blocked review instead of endless Continue', async () => {
    const adapter = adapterFor()
    const { data, draft } = await open(adapter, RECORDS)
    assert.equal(adapter.isStale({ code: 'contact_merge_not_duplicates' }), true)
    assert.ok(adapter.blockers?.(data, draft).includes(en.contact_merge_not_duplicates))
  })

  await test('a record that no longer exists is shown as its own column and left out', async () => {
    const adapter = adapterFor()
    const { data, draft, columns, rows } = await open(adapter, RECORDS.slice(0, 2))
    assert.deepEqual(columns[2], {
      id: '13', title: 'Dara', subtitle: '#13', disposition: 'separate', dispositions: ['separate'],
      disabledReason: 'No longer exists, so it cannot be merged.',
    }, 'the list still named it, so the grid says why it is not merged')
    assert.equal(row(rows, 'membership').kind, 'computed', 'only the numbers of records still here count')
    const review = await adapter.review(data, draft, signal)
    assert.deepEqual(review.token.request.mergeIds, [12])
    assert.deepEqual(review.token.request.expected.map((item) => item.id), [11, 12])
  })

  await test('Keep separate, the six-record limit and a blank name block Resolve with a reason', async () => {
    const ids = [20, 38, 39, 40, 41, 42, 43, 44]
    const big = ids.map((id) => ({ id, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null, updated_at: `v${id}` }))
    const adapter = adapterFor('suppliers', { type: 'name', value: 'j secrat', severity: 'name_only', contacts: big.map((record) => ({ id: record.id, name: record.name, phone: null, membershipNumber: null })) })
    const { data, initial, draft } = await open(adapter, big)
    assert.deepEqual(initial.columns, { 43: { disposition: 'separate' }, 44: { disposition: 'separate' } }, 'the kept record and the next five start merged in')
    assert.deepEqual(adapter.blockers?.(data, draft), [])
    assert.deepEqual((await adapter.review(data, draft, signal)).token.request.mergeIds, [38, 39, 40, 41, 42])
    const everyone: Draft = { ...draft, columns: {} }
    assert.deepEqual(adapter.blockers?.(data, everyone), ['Merge at most 6 records at a time.'])
    const alone: Draft = { ...draft, columns: Object.fromEntries(ids.slice(1).map((id) => [String(id), { disposition: 'separate' as const }])) }
    assert.deepEqual(adapter.blockers?.(data, alone), ['Merge in at least two records.'])
    const pickedAway: Draft = { selection: { email: { source: '44' } }, columns: draft.columns }
    assert.deepEqual(adapter.rows(data, pickedAway).find((item) => item.key === 'email')?.choice, { source: '20' }, 'a value from a record kept separate is not used')
    const blank = big.map((record) => ({ ...record, name: '' }))
    const nameless = await open(adapter, blank)
    assert.deepEqual(adapter.blockers?.(nameless.data, nameless.draft), ['Name is required'])
  })

  await test('suppliers and delivery contacts show their own fields and no customer-only rows', async () => {
    const supplier = await open(adapterFor('suppliers'), RECORDS.map(({ membership_number, portal_account, created_at, ...rest }) => ({ ...rest, company: null, contact_person: null })))
    assert.deepEqual(supplier.rows.map((item) => item.key), ['record', 'name', 'phone', 'email', 'company', 'contact_person', 'address', 'gender', 'notes', 'history'])
    const delivery = await open(adapterFor('delivery_contacts'), RECORDS.map(({ membership_number, portal_account, email, created_at, ...rest }) => ({ ...rest, area: rest.id === 12 ? 'Toul Kork' : null })))
    assert.deepEqual(delivery.rows.map((item) => item.key), ['record', 'name', 'phone', 'area', 'address', 'gender', 'notes', 'history'])
    assert.match(sent[0].url, /\/api\/delivery-contacts\?ids=11,12,13$/)
    assert.equal(row(delivery.rows, 'area').final.text, 'Toul Kork')
  })
} finally {
  Object.assign(globalThis, saved)
  http.__resetApiHealthForTests()
  http.__resetApiWriteDedupeForTests()
  http.setSyncServerUrl('')
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
console.log('PASS the contacts Resolve grid suggests one merge, says what changes and sends it as one request')

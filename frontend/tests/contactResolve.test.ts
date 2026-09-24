// R12: the contacts duplicates screen resolves a group through ONE merge
// request (T28), never a loop of two-record merges.
//
// This file drives the REAL transport (contactDuplicates.ts over api/http.ts)
// against a stubbed fetch and reads what actually goes on the wire.
//
// Run: node tests/contactResolve.test.ts
import assert from 'node:assert/strict'

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
const events: Array<{ type: string; detail: any }> = []
globalThis.CustomEvent = class extends Event {
  detail: unknown
  constructor(type: string, init: { detail?: unknown } = {}) { super(type); this.detail = init.detail }
} as any
globalThis.window = {
  localStorage: createStorage(),
  sessionStorage: createStorage(),
  dispatchEvent: (event: any) => { events.push({ type: event.type, detail: event.detail }); return true },
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
} as any

const http = await import('../src/api/http.ts')
const {
  CONTACT_MERGE_MAX_RECORDS,
  contactMergeRequest,
  mergeContacts,
  planBulkContactMerges,
  readContactRecords,
} = await import('../src/components/contacts/contactDuplicates.ts')

type Sent = { method: string; url: string; body: any }
let sent: Sent[] = []
let answers: Array<() => Response> = []
function serve(...responses: Array<() => Response>): void {
  sent = []
  answers = [...responses]
  events.length = 0
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

const cluster = {
  type: 'name' as const,
  value: 'dara',
  severity: 'name_only' as const,
  contacts: [
    { id: 11, name: 'Dara', phone: '012 345 678', membershipNumber: 'M-1', updated_at: '2026-09-20 08:00:00' },
    { id: 12, name: 'dara', phone: null, membershipNumber: null, updated_at: '2026-09-21 09:00:00' },
    { id: 13, name: 'Dara ', phone: null, membershipNumber: 'M-2', updated_at: null },
  ],
}

const request = {
  keepId: 11,
  mergeIds: [12, 13, 14, 15, 16],
  manual: true,
  client_request_id: 'contact_merge_abc',
  expected: [11, 12, 13, 14, 15, 16].map((id) => ({ id, updated_at: `v${id}` })),
  choices: { name: { source_id: 11 } },
  membership_source_id: 13,
  portal_keep_contact_id: 12,
}

try {
  await test('one request merges the whole group when the server finishes it', async () => {
    serve(json(200, {
      keeper: { id: 11, name: 'Dara', updated_at: 'v11b' },
      merged_ids: [12, 13],
      before: {},
      after: {
        merged_ids: [12, 13],
        merged_names: ['dara', 'Dara '],
        portal_accounts: [{ id: 7, contact_id: 11, membership_id: 'W-7', name: 'Dara' }, { id: 8, contact_id: null, membership_id: 'W-8', name: 'dara' }],
        membership_to_notes: ['M-1'],
      },
      operationId: 'op-1',
    }))
    const outcome = await mergeContacts('customers', { ...request, mergeIds: [12, 13], expected: request.expected.slice(0, 3) })
    assert.equal(sent.length, 1, 'one group is one request')
    assert.equal(sent[0].method, 'POST')
    assert.match(sent[0].url, /\/api\/customers\/merge$/)
    assert.deepEqual(sent[0].body.mergeIds, [12, 13], 'every record travels in the one request')
    assert.equal(sent[0].body.manual, true)
    assert.equal(sent[0].body.membership_source_id, 13)
    assert.equal(sent[0].body.portal_keep_contact_id, 12)
    assert.deepEqual(outcome.merged, [{ id: 12, name: 'dara' }, { id: 13, name: 'Dara ' }])
    assert.deepEqual(outcome.unlinkedAccounts, [{ id: 8, contact_id: null, membership_id: 'W-8', name: 'dara' }], 'only the account left without a contact is reported as unlinked')
    assert.deepEqual(outcome.membershipToNotes, ['M-1'])
    assert.equal(outcome.keeper?.updated_at, 'v11b')
    assert.equal(outcome.pending, null)
  })

  await test('the free plan steps: every continuation is sent until no record remains', async () => {
    const continuation = {
      keepId: 11, mergeIds: [15, 16], manual: true, client_request_id: 'contact_merge_abc:r2',
      expected: [{ id: 11, updated_at: 'v11b' }, { id: 15, updated_at: 'v15' }, { id: 16, updated_at: 'v16' }],
      choices: { name: { source_id: 11 } }, membership_source_id: 11, portal_keep_contact_id: 11,
    }
    serve(
      json(200, { keeper: { id: 11 }, merged_ids: [12, 13, 14], after: { merged_ids: [12, 13, 14], merged_names: ['a', 'b', 'c'], portal_accounts: [], membership_to_notes: [] }, remaining_merge_ids: [15, 16], continuation }),
      json(200, { keeper: { id: 11, name: 'Dara' }, merged_ids: [15, 16], after: { merged_ids: [15, 16], merged_names: ['d', 'e'], portal_accounts: [{ id: 9, contact_id: null, membership_id: 'W-9', name: 'e' }], membership_to_notes: ['M-3'] } }),
    )
    const steps: number[] = []
    const outcome = await mergeContacts('customers', request, (progress) => steps.push(progress.merged.length))
    assert.equal(sent.length, 2)
    assert.deepEqual(sent[1].body, continuation, 'the continuation goes out exactly as the server wrote it')
    assert.deepEqual(steps, [3, 5], 'progress is reported after every step')
    assert.deepEqual(outcome.merged.map((entry) => entry.id), [12, 13, 14, 15, 16])
    assert.deepEqual(outcome.unlinkedAccounts.map((account) => account.id), [9])
    assert.deepEqual(outcome.membershipToNotes, ['M-3'])
    assert.equal(outcome.pending, null)
  })

  await test('a step that fails resumes from itself, not from the start', async () => {
    const continuation = { ...request, mergeIds: [16], client_request_id: 'contact_merge_abc:r1', expected: [{ id: 11, updated_at: 'x' }, { id: 16, updated_at: 'v16' }] }
    serve(
      json(200, { keeper: { id: 11 }, merged_ids: [12, 13, 14, 15], after: { merged_ids: [12, 13, 14, 15], merged_names: [], portal_accounts: [], membership_to_notes: [] }, remaining_merge_ids: [16], continuation }),
      () => { throw new TypeError('Failed to fetch') },
    )
    let last: any = null
    await assert.rejects(mergeContacts('customers', request, (progress) => { last = progress }), (error: any) => error.outcome === 'unknown')
    assert.deepEqual(last.pending, continuation, 'the running outcome still names the request that did not answer')
    serve(json(200, { keeper: { id: 11 }, merged_ids: [16], after: { merged_ids: [16], merged_names: ['f'], portal_accounts: [], membership_to_notes: [] }, replayed: true }))
    const outcome = await mergeContacts('customers', request, undefined, last)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.client_request_id, 'contact_merge_abc:r1', 'Continue re-sends the step that failed, with its own id')
    assert.deepEqual(outcome.merged.map((entry) => entry.id), [12, 13, 14, 15, 16], 'the earlier steps are kept in the outcome')
  })

  await test('refusals the caller answers clear the global write banner; others keep it', async () => {
    for (const code of ['contact_merge_conflict', 'membership_choice_required', 'portal_choice_required', 'anonymous_customer_immutable']) {
      serve(json(code === 'contact_merge_conflict' || code === 'anonymous_customer_immutable' ? 409 : 400, { error: 'refused', code }))
      await assert.rejects(mergeContacts('customers', request), (error: any) => error.code === code)
      const raised = events.find((event) => event.type === 'sync:error')
      const cleared = events.find((event) => event.type === 'sync:error-resolved')
      assert.ok(raised, `${code} still goes through the write path`)
      assert.deepEqual(cleared?.detail, { errorId: raised.detail.errorId, channel: 'contactDuplicates:customers:merge', code }, `${code} is answered by the caller`)
    }
    serve(json(400, { error: 'A chosen value does not belong to these records.', code: 'contact_merge_invalid_choice' }))
    await assert.rejects(mergeContacts('customers', request))
    assert.equal(events.filter((event) => event.type === 'sync:error-resolved').length, 0, 'a real failure stays on the banner')
  })

  await test('a bulk request carries the versions the list read, and no reviewer choices', () => {
    const body = contactMergeRequest(cluster, 11, [12, 13])
    assert.equal(body.keepId, 11)
    assert.deepEqual(body.mergeIds, [12, 13])
    assert.deepEqual(body.expected, [
      { id: 11, updated_at: '2026-09-20 08:00:00' },
      { id: 12, updated_at: '2026-09-21 09:00:00' },
      { id: 13, updated_at: null },
    ])
    assert.match(body.client_request_id, /^contact_merge_/)
    assert.equal('manual' in body, false, 'bulk keeps the server re-check that the records still match')
    assert.equal('choices' in body, false)
    assert.notEqual(contactMergeRequest(cluster, 11, [12]).client_request_id, body.client_request_id, 'every merge is its own request')
  })

  await test('bulk plans at most six records per request', () => {
    const ids = [20, 38, 39, 40, 41, 42, 43, 44, 45, 46]
    const [plan] = planBulkContactMerges([{ ...cluster, contacts: ids.map((id) => ({ id, name: 'j secrat', phone: null, membershipNumber: null })) }])
    assert.equal(CONTACT_MERGE_MAX_RECORDS, 6)
    assert.equal(1 + plan.loserIds.length, CONTACT_MERGE_MAX_RECORDS)
    assert.deepEqual(plan.laterIds, [43, 44, 45, 46])
  })

  await test('the grid reads its records fresh and keeps only the ids it asked for', async () => {
    serve(json(200, [{ id: 11, name: 'Dara' }, { id: 99, name: 'stray' }, null, { id: 12, name: 'dara' }]))
    const rows = await readContactRecords('delivery_contacts', [11, 12])
    assert.equal(sent[0].method, 'GET')
    assert.match(sent[0].url, /\/api\/delivery-contacts\?ids=11,12$/)
    assert.deepEqual(rows.map((row) => row.id), [11, 12])
  })
} finally {
  Object.assign(globalThis, saved)
  http.__resetApiHealthForTests()
  http.__resetApiWriteDedupeForTests()
  http.setSyncServerUrl('')
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1) }
console.log('PASS contacts merge a whole group in one request and follow the free-plan steps to the end')

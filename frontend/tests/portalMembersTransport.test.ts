// G38 Contacts > Members: the REAL transport (api/portalMembersTransport.ts over
// api/http.ts) against a stubbed fetch, reading what actually goes on the wire.
// The Worker's contract is Records/Lanes/2026-10-05/G38-P1-BACKEND-REPORT.md §API;
// the cases below are the ones a typo would break silently: the list URL has NO
// trailing slash (/api/portal-members/ is a 404), "All" sends no filter, ids are
// encoded, and a refusal keeps the member / holder the Worker returned.
//
// Run: node tests/portalMembersTransport.test.ts
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

globalThis.CustomEvent = class extends Event {
  detail: unknown
  constructor(type: string, init: { detail?: unknown } = {}) { super(type); this.detail = init.detail }
} as unknown as typeof CustomEvent
globalThis.window = {
  localStorage: createStorage(), sessionStorage: createStorage(),
  dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
} as unknown as typeof window

const http = await import('../src/api/http.ts')
const members = await import('../src/api/portalMembersTransport.ts')

type Sent = { method: string; url: string; body: unknown }
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
}) as unknown as typeof fetch
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const path = (index = 0) => sent[index].url.replace('https://sync.example.test', '')

let failed = 0
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await test('the list has no trailing slash, "All" sends no filter, and the other filters, search and paging go in the query', async () => {
  serve(json(200, { items: [], total: 0, limit: 20, offset: 0, filter: 'all' }), json(200, { items: [], total: 0, limit: 20, offset: 40, filter: 'linked' }))
  await members.listMembers({ filter: 'all', limit: 20, offset: 0 })
  assert.equal(path(), '/api/portal-members?limit=20&offset=0')
  await members.listMembers({ filter: 'linked', q: ' W-7KQ4 ', limit: 20, offset: 40 })
  assert.equal(path(1), '/api/portal-members?filter=linked&q=W-7KQ4&limit=20&offset=40')
  for (const request of sent) assert.ok(!/\/api\/portal-members\/(\?|$)/.test(request.url), 'never /api/portal-members/')
  serve(json(200, { items: [], total: 0, limit: 50, offset: 0, filter: 'all' }))
  await members.listMembers()
  assert.equal(path(), '/api/portal-members', 'no params at all is the bare, slash-less URL')
})

await test('reads: requests, history, suggestions and customer search hit the Worker\'s routes', async () => {
  serve(
    json(200, { requests: [{ id: 5 }] }),
    json(200, { linkVersion: 1, customerVisible: true, events: [] }),
    json(200, { suggestions: [{ customerId: 1 }] }),
    json(200, { customers: [{ id: 2 }] }),
  )
  assert.deepEqual(await members.listLinkRequests(), [{ id: 5 }])
  await members.getMemberHistory(12)
  assert.deepEqual(await members.getMemberSuggestions(12), [{ customerId: 1 }])
  assert.deepEqual(await members.searchMemberCustomers(' Dara '), [{ id: 2 }])
  assert.deepEqual(sent.map((request) => [request.method, path(sent.indexOf(request))]), [
    ['GET', '/api/portal-members/link-requests?status=pending'],
    ['GET', '/api/portal-members/12/history'],
    ['GET', '/api/portal-members/12/suggestions'],
    ['GET', '/api/portal-members/customer-search?q=Dara'],
  ])
  serve(json(200, {}), json(200, {}), json(200, {}))
  assert.deepEqual(await members.listLinkRequests('approved'), [], 'an answer without the field is an empty list, not a crash')
  assert.deepEqual(await members.getMemberSuggestions(1), [])
  assert.deepEqual(await members.searchMemberCustomers('ab'), [])
})

await test('writes go to the Worker\'s routes with the documented bodies', async () => {
  serve(...Array.from({ length: 8 }, () => json(200, { ok: true, member: { id: 12 }, temporaryPassword: 'ABC' })))
  const id = members.newMemberRequestId()
  assert.match(id, /^pm_[0-9a-f-]{36}$/)
  assert.match(id, /^[A-Za-z0-9_.:-]{8,64}$/, 'the Worker accepts this shape as an idempotency key')
  await members.linkMember(12, { customerId: 101, expectedLinkVersion: 3, evidence: 'in_person', clientRequestId: id, move: true, linkRequestId: 5 })
  await members.unlinkMember(12, { expectedLinkVersion: 4, reasonCode: 'duplicate', clientRequestId: id })
  await members.revertMemberEvent(12, { eventId: 9, evidence: 'called_number_on_file', checkCode: '123456', clientRequestId: id })
  await members.suspendMember(12, 'misused')
  await members.reactivateMember(12)
  const reset = await members.resetMemberPassword(12, { evidence: 'owner_override', note: 'owner called' })
  await members.rejectLinkRequest(5, 'not ours')
  await members.suspendMember(12)
  assert.deepEqual(sent.map((request) => `${request.method} ${path(sent.indexOf(request))}`), [
    'POST /api/portal-members/12/link',
    'POST /api/portal-members/12/unlink',
    'POST /api/portal-members/12/revert',
    'POST /api/portal-members/12/suspend',
    'POST /api/portal-members/12/reactivate',
    'POST /api/portal-members/12/reset-password',
    'POST /api/portal-members/link-requests/5/reject',
    'POST /api/portal-members/12/suspend',
  ])
  assert.deepEqual(sent[0].body, { customerId: 101, expectedLinkVersion: 3, evidence: 'in_person', clientRequestId: id, move: true, linkRequestId: 5 })
  assert.deepEqual(sent[2].body, { eventId: 9, evidence: 'called_number_on_file', checkCode: '123456', clientRequestId: id })
  assert.deepEqual(sent[3].body, { note: 'misused' })
  assert.deepEqual(sent[4].body, {}, 'an absent note is not sent as an empty string')
  assert.deepEqual(sent[5].body, { evidence: 'owner_override', note: 'owner called' })
  assert.deepEqual(sent[6].body, { note: 'not ours' })
  assert.deepEqual(sent[7].body, {}, 'Suspend without a note sends none, not an empty string')
  assert.equal(reset.temporaryPassword, 'ABC')
})

await test('a refusal keeps its code and the member / holder the Worker answered with', async () => {
  const member = { id: 12, linkVersion: 6, name: 'Now' }
  const holder = { id: 9, memberCode: 'W-CCCC-CCCC', name: 'Other', linkVersion: 2 }
  serve(
    json(409, { error: 'This member changed since you opened it.', code: 'member_link_stale', member }),
    json(409, { error: 'This customer is already linked to another member.', code: 'member_link_customer_taken', holder }),
    json(403, { error: 'You need Contacts view access.', code: 'contacts_view_required' }),
  )
  const body = { customerId: 1, expectedLinkVersion: 0, evidence: 'in_person' as const, clientRequestId: members.newMemberRequestId() }
  await assert.rejects(members.linkMember(12, body), (error: Error & { code?: string; status?: number; member?: unknown; holder?: unknown }) => {
    assert.equal(error.code, 'member_link_stale')
    assert.equal(error.status, 409)
    assert.deepEqual(error.member, member)
    assert.equal(error.holder, null)
    return true
  })
  await assert.rejects(members.linkMember(12, { ...body, clientRequestId: members.newMemberRequestId() }), (error: Error & { code?: string; holder?: unknown; member?: unknown }) => {
    assert.equal(error.code, 'member_link_customer_taken')
    assert.deepEqual(error.holder, holder)
    assert.equal(error.member, null)
    return true
  })
  await assert.rejects(members.getMemberHistory(12), (error: Error & { code?: string }) => error.code === 'contacts_view_required')
})

if (failed) { console.error(`${failed} FAILED`); process.exit(1) }

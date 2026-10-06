// G38 Contacts > Members, mounted for real (the in-memory DOM harness): the list,
// the detail float, the Link float, History, the requests section and the sign-up
// switch, with the transport replaced by a recorder. Each test also mounts the
// viewer who must NOT see the control, so a green run proves the control is
// absent because of the permission and not because it never rendered.
//
// Run: node tests/portalMembersScreens.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Harness, MemoryNode, MountedSurface } from './mountedComponentHarness.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'

const readPack = (name: string) => {
  const flat = (input: unknown, target: Record<string, string> = {}): Record<string, string> => {
    for (const [key, value] of Object.entries((input || {}) as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) flat(value, target)
      else target[key] = String(value)
    }
    return target
  }
  return flat(JSON.parse(readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')))
}
const en = readPack('en')
const km = readPack('km')

let failed = 0
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const { accessibleText, createHarness, propsOf } = await import('./mountedComponentHarness.ts')
const harness: Harness = await createHarness()
const clipboardWrites: string[] = []
Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { clipboardWrites.push(String(text)) } } })

// --- people ---------------------------------------------------------------------------
type User = { role_code: string; role_permissions: Record<string, unknown>; permissions: Record<string, unknown> }
const user = (role: string, permissions: Record<string, unknown>): User => ({ role_code: role, role_permissions: permissions, permissions: {} })
const ADMIN = user('admin', { all: true })
const LINKER = user('staff', { contacts: true, portal_member_links: true })
const LINKS_ONLY = user('staff', { portal_member_links: true })

// --- fixtures ---------------------------------------------------------------------------
const base = {
  legacyMembershipId: null, email: null, status: 'active', linkVersion: 0, closedAt: null, lastSeenAt: null,
  createdAt: '2026-09-01 02:00:00', pendingRequest: null,
}
const CUSTOMER_DARA = { id: 101, name: 'Dara Chan', membershipNumber: 'LC-00101', available: true }
const sokha = { ...base, id: 7, memberCode: 'W-AAAA-AAAA', name: 'Sokha Member', phone: '012345678', chip: 'unverified', customer: null, customerVisible: true, createdFromSignup: false, legacyClaim: false, conflicts: ['phone_customer_taken'] }
const dara = { ...base, id: 8, memberCode: 'W-BBBB-BBBB', name: 'Dara Member', phone: '098765432', chip: 'linked', linkVersion: 2, customer: CUSTOMER_DARA, customerVisible: true, createdFromSignup: true, legacyClaim: true, conflicts: [] }
const hide = (member: Record<string, unknown>) => ({ ...member, customer: null, customerVisible: false, legacyMembershipId: null, conflicts: [], createdFromSignup: null, legacyClaim: null })

type Recorder = { calls: Array<[string, unknown[]]> }
const callsTo = (recorder: Recorder, name: string) => recorder.calls.filter(([call]) => call === name)

interface Scenario {
  who: User
  members: unknown[]
  language?: 'en' | 'km'
  settings?: Record<string, unknown>
  requests?: unknown[]
  suggestions?: unknown[]
  hits?: unknown[]
  history?: unknown
  answers?: Partial<Record<string, (...args: unknown[]) => unknown>>
}

async function mountTab(scenario: Scenario): Promise<{ page: MountedSurface; rec: Recorder; saved: Array<Record<string, unknown>>; pack: Record<string, string> }> {
  const pack = scenario.language === 'km' ? km : en
  const rec: Recorder = { calls: [] }
  const saved: Array<Record<string, unknown>> = []
  const authority = effectivePermissions(scenario.who)
  const record = (name: string, answer: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    rec.calls.push([name, args])
    const override = scenario.answers?.[name]
    return override ? override(...args) : answer(...args)
  }
  const page = await harness.mount({
    component: 'components/contacts/members/MembersTab.tsx',
    props: { t: (key: string) => pack[key], notify: () => {}, active: true },
    app: {
      language: scenario.language ?? 'en',
      t: (key: string) => pack[key] ?? key,
      user: scenario.who,
      can: authority.can,
      hasPermission: authority.hasPermission,
      settings: scenario.settings ?? {},
      saveSettings: async (payload: Record<string, unknown>) => { saved.push(payload); return { success: true } },
      fmtUSD: (value: unknown) => `$${value}`,
      fmtKHR: (value: unknown) => `${value}៛`,
      notify: () => {},
    },
    doubles: {
      'api/portalMembersTransport.ts': {
        listMembers: record('listMembers', async () => ({ items: scenario.members, total: scenario.members.length, limit: 20, offset: 0, filter: 'all' })) as never,
        listLinkRequests: record('listLinkRequests', async () => scenario.requests ?? []) as never,
        getMemberSuggestions: record('getMemberSuggestions', async () => scenario.suggestions ?? []) as never,
        searchMemberCustomers: record('searchMemberCustomers', async () => scenario.hits ?? []) as never,
        getMemberHistory: record('getMemberHistory', async () => scenario.history ?? { linkVersion: 0, customerVisible: authority.can('contacts', 'view'), events: [] }) as never,
        linkMember: record('linkMember', async () => ({ ok: true, member: { ...dara, id: 7, name: 'Sokha Member', linkVersion: 1 } })) as never,
        unlinkMember: record('unlinkMember', async () => ({ ok: true, member: { ...sokha, linkVersion: 3 } })) as never,
        revertMemberEvent: record('revertMemberEvent', async () => ({ ok: true, member: sokha })) as never,
        suspendMember: record('suspendMember', async () => ({ ok: true, member: sokha })) as never,
        reactivateMember: record('reactivateMember', async () => ({ ok: true, member: sokha })) as never,
        resetMemberPassword: record('resetMemberPassword', async () => ({ ok: true, temporaryPassword: 'TEMP-PASS-77' })) as never,
        rejectLinkRequest: record('rejectLinkRequest', async () => ({ ok: true })) as never,
      },
    },
  })
  await page.waitFor(() => page.findAll(isRow).length > 0, 'the members list')
  return { page, rec, saved, pack }
}

// --- node helpers ---------------------------------------------------------------------------
const isRow = (node: MemoryNode) => node.tagName === 'LI' && node.hasAttribute('data-member-row')
const attr = (name: string, value?: string) => (node: MemoryNode) => node.hasAttribute(name) && (value === undefined || node.getAttribute(name) === value)
const exists = (page: MountedSurface, predicate: (node: MemoryNode) => boolean) => page.findAll(predicate).length > 0
const rowOf = (page: MountedSurface, id: number) => page.find((node) => isRow(node) && node.getAttribute('data-member-row') === String(id), `the row of member ${id}`)
const filterIds = (page: MountedSurface) => page.findAll(attr('data-member-filter')).map((node) => node.getAttribute('data-member-filter'))
const actionIds = (page: MountedSurface) => page.findAll((node) => node.tagName === 'BUTTON' && node.hasAttribute('data-member-action')).map((node) => node.getAttribute('data-member-action'))

async function openDetail(page: MountedSurface, id: number): Promise<void> {
  const open = rowOf(page, id).querySelectorAll('button')[0]
  await page.click(open)
  await page.waitFor(() => exists(page, attr('data-member-detail')), 'the member detail')
}

// ===========================================================================================
await runTest('a viewer without Contacts view: rows say "Customer hidden", and no Link, no Conflicts or Sign-up claims filter, no LC search, no provenance', async () => {
  const { page, pack } = await mountTab({ who: LINKS_ONLY, members: [hide(sokha), hide(dara)] })
  try {
    assert.deepEqual(filterIds(page), ['all', 'unlinked', 'linked', 'requests', 'suspended'])
    assert.equal(exists(page, attr('data-member-row-link')), false, 'no Link button on any row')
    const linked = rowOf(page, 8)
    assert.ok(linked.textContent.includes(pack.pm_customer_hidden), 'the linked member reads "Customer hidden"')
    assert.ok(!linked.textContent.includes('Dara Chan') && !linked.textContent.includes('LC-00101'), 'no customer name or LC number anywhere')
    assert.ok(rowOf(page, 7).textContent.includes(pack.pm_not_linked), 'an unlinked member is still "Not linked"')
    const search = page.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'member_search', 'the search box')
    assert.equal(search.getAttribute('placeholder'), pack.pm_search_ph)
    assert.ok(!/LC/.test(String(search.getAttribute('placeholder'))), 'the search hint does not offer LC numbers')
    await openDetail(page, 8)
    assert.deepEqual(actionIds(page), ['unlink', 'history', 'suspend'], 'Unlink, History, Suspend: no Link, no Change link, no Reset')
    const detail = page.find(attr('data-member-detail'), 'the detail').textContent
    assert.ok(detail.includes(pack.pm_customer_hidden_hint))
    assert.ok(!detail.includes(pack.pm_marker_legacy_claim) && !detail.includes(pack.pm_marker_created_signup), 'provenance markers are hidden')
  } finally { await page.unmount() }
})

await runTest('control: a viewer WITH Contacts view sees the customer, the Link button, both filters and the provenance markers', async () => {
  const { page, pack } = await mountTab({ who: LINKER, members: [sokha, dara] })
  try {
    assert.deepEqual(filterIds(page), ['all', 'unlinked', 'linked', 'requests', 'conflicts', 'suspended', 'legacy_claims'])
    assert.equal(page.findAll(attr('data-member-row-link')).length, 1, 'only the unlinked member has a Link button')
    assert.ok(rowOf(page, 8).textContent.includes('Dara Chan') && rowOf(page, 8).textContent.includes('LC-00101'))
    const search = page.find((node) => node.tagName === 'INPUT' && node.getAttribute('name') === 'member_search', 'the search box')
    assert.equal(search.getAttribute('placeholder'), pack.pm_search_ph_lc)
    await openDetail(page, 8)
    assert.deepEqual(actionIds(page), ['relink', 'unlink', 'history', 'suspend'])
    const detail = page.find(attr('data-member-detail'), 'the detail').textContent
    assert.ok(detail.includes(pack.pm_marker_legacy_claim) && detail.includes(pack.pm_marker_created_signup))
  } finally { await page.unmount() }
})

await runTest('the reset control is admin-only; the sign-up switch is admin-only and saves one key with the right strings', async () => {
  const linker = await mountTab({ who: LINKER, members: [sokha] })
  try {
    await openDetail(linker.page, 7)
    assert.ok(!actionIds(linker.page).includes('reset'), 'a non-admin linker gets no Reset password')
    assert.equal(exists(linker.page, attr('data-member-action', 'signup')), false, 'and no sign-up setting')
  } finally { await linker.page.unmount() }

  const { page, saved, pack } = await mountTab({ who: ADMIN, members: [sokha], settings: { customer_portal_title: 'Shop', exchange_rate: '4100', customer_portal_signup_enabled: 'false' } })
  try {
    await openDetail(page, 7)
    assert.ok(actionIds(page).includes('reset'), 'the admin gets Reset password')
    // close the detail so its float does not sit over the toolbar
    await page.click(page.find((node) => node.tagName === 'BUTTON' && accessibleText(node).includes(pack.close), 'the detail close'))
    await page.click(page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'signup', 'the sign-up setting'))
    const sw = page.find(attr('data-member-signup-switch'), 'the switch')
    assert.equal(sw.getAttribute('aria-checked'), 'false', 'unset/false reads OFF')
    assert.ok(page.text().includes(pack.pm_signup_label))
    await page.click(sw)
    const dialog = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.ok(dialog.textContent.includes(pack.before) && dialog.textContent.includes(pack.after), 'the review shows before and after')
    assert.equal(saved.length, 0, 'nothing is saved before Confirm')
    await page.click(page.button(pack.pm_signup_turn_on, dialog))
    assert.deepEqual(saved, [{ customer_portal_signup_enabled: 'true' }], 'one key, the string "true"')
  } finally { await page.unmount() }
})

await runTest('the Link float: nothing is pre-selected, Link waits for an identity check, the phone code field exists from the start, and the review shows before and after', async () => {
  const suggestions = [
    { customerId: 101, name: 'Dara Chan', membershipNumber: 'LC-00101', phone: '012345678', strength: 'strong', basis: ['phone', 'name'], linkedMemberId: null },
    { customerId: 102, name: 'Dara Family', membershipNumber: 'LC-00102', phone: '012345678', strength: 'possible', basis: ['phone'], linkedMemberId: null },
  ]
  const { page, rec, pack } = await mountTab({ who: LINKER, members: [sokha], suggestions })
  try {
    await page.click(page.find(attr('data-member-row-link'), 'the row Link button'))
    await page.waitFor(() => exists(page, attr('data-member-pick', 'suggestion-101')), 'the suggestions')
    const picks = page.findAll(attr('data-member-pick'))
    assert.equal(picks.length, 2)
    assert.ok(picks.every((node) => node.getAttribute('aria-pressed') === 'false'), 'no suggestion is pre-selected')
    assert.deepEqual(page.findAll(attr('data-member-strength')).map((node) => node.getAttribute('data-member-strength')), ['strong', 'possible'])
    assert.ok(page.text().includes(pack.pm_basis_phone_name) && page.text().includes(pack.pm_basis_phone))
    const submit = () => page.find(attr('data-member-link-submit'), 'the Link button')
    assert.equal(propsOf(submit()).disabled, true, 'Link is disabled with nothing chosen')
    assert.ok(exists(page, attr('data-member-check-code')), 'the code field is part of the float from the first paint')
    assert.equal(propsOf(page.find(attr('data-member-check-code'), 'the code field')).disabled, true, 'but disabled until Phone call is chosen')

    await page.click(page.find(attr('data-member-pick', 'suggestion-101'), 'the strong suggestion'))
    assert.equal(propsOf(submit()).disabled, true, 'a customer alone is not enough: the identity check is required')
    await page.call(page.find(attr('data-member-evidence-option', 'called_number_on_file'), 'Phone call'), 'onChange', [{}])
    assert.equal(propsOf(submit()).disabled, true, 'Phone call needs its six digits')
    assert.equal(propsOf(page.find(attr('data-member-check-code'), 'the code field')).disabled, false)
    await page.type(page.find(attr('data-member-check-code'), 'the code field'), '123 456')
    assert.equal(propsOf(submit()).disabled, false)
    assert.ok(!exists(page, attr('data-member-evidence-option', 'owner_override')), 'Owner override is not offered to a non-admin')

    await page.click(submit())
    const review = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.ok(review.textContent.includes(pack.before) && review.textContent.includes(pack.pm_not_linked), 'before: Not linked')
    assert.ok(review.textContent.includes(pack.after) && review.textContent.includes('Dara Chan') && review.textContent.includes('LC-00101'), 'after: the customer')
    assert.equal(callsTo(rec, 'linkMember').length, 0, 'nothing is sent before Confirm')
    await page.click(page.button(pack.pm_act_link, review))
    const [[, args]] = callsTo(rec, 'linkMember')
    const [id, body] = args as [number, Record<string, unknown>]
    assert.equal(id, 7)
    assert.equal(body.customerId, 101)
    assert.equal(body.expectedLinkVersion, 0)
    assert.equal(body.evidence, 'called_number_on_file')
    assert.equal(body.checkCode, '123456')
    assert.deepEqual(body.matchBasis, { strength: 'strong', basis: ['phone', 'name'] })
    assert.match(String(body.clientRequestId), /^pm_[0-9a-f-]{36}$/)
    assert.equal(body.move, undefined)
  } finally { await page.unmount() }
})

await runTest('a customer another member holds turns the same dialog into a Move, and the admin alone sees Owner override', async () => {
  const hits = [{ id: 103, name: 'Held Customer', membershipNumber: 'LC-00103', phone: '011222333', linkedMember: { id: 9, memberCode: 'W-CCCC-CCCC', name: 'Other Member' } }]
  const { page, rec, pack } = await mountTab({ who: ADMIN, members: [sokha], hits })
  try {
    await page.click(page.find(attr('data-member-row-link'), 'the row Link button'))
    await page.type(page.find(attr('data-member-customer-search'), 'the customer search'), 'Held')
    await page.waitFor(() => exists(page, attr('data-member-pick', 'customer-103')), 'the search result')
    assert.ok(page.text().includes('W-CCCC-CCCC'), 'the result says who holds the customer')
    await page.click(page.find(attr('data-member-pick', 'customer-103'), 'the held customer'))
    assert.ok(exists(page, attr('data-member-evidence-option', 'owner_override')), 'the admin is offered Owner override')
    await page.call(page.find(attr('data-member-evidence-option', 'in_person'), 'In person'), 'onChange', [{}])
    const submit = page.find(attr('data-member-link-submit'), 'the Move button')
    assert.ok(accessibleText(submit).includes(pack.pm_act_move), 'the main action now says Move')
    await page.click(submit)
    const review = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.ok(review.textContent.includes(pack.pm_move_title))
    assert.ok(review.textContent.includes(pack.pm_also_unlinks) && review.textContent.includes('W-CCCC-CCCC'), 'the review names the member that loses the customer')
    await page.click(page.button(pack.pm_act_move, review))
    const body = (callsTo(rec, 'linkMember')[0][1] as [number, Record<string, unknown>])[1]
    assert.equal(body.move, true)
    assert.equal(body.customerId, 103)
  } finally { await page.unmount() }
})

await runTest('a refusal is shown in the dialog in the operator\'s language and keeps what was typed; a stale answer refreshes the member', async () => {
  const stale = Object.assign(new Error('English from the server'), { code: 'member_link_stale', status: 409, member: { ...sokha, linkVersion: 5 } })
  const { page, rec } = await mountTab({
    who: LINKER, members: [sokha], language: 'km',
    suggestions: [{ customerId: 101, name: 'Dara Chan', membershipNumber: 'LC-00101', phone: '012345678', strength: 'strong', basis: ['phone', 'name'], linkedMemberId: null }],
    answers: { linkMember: () => { throw stale } },
  })
  try {
    await page.click(page.find(attr('data-member-row-link'), 'the row Link button'))
    await page.waitFor(() => exists(page, attr('data-member-pick', 'suggestion-101')), 'the suggestions')
    await page.click(page.find(attr('data-member-pick', 'suggestion-101'), 'the suggestion'))
    await page.call(page.find(attr('data-member-evidence-option', 'in_person'), 'In person'), 'onChange', [{}])
    await page.type(page.find(attr('data-member-note'), 'the note'), 'seen at the till')
    await page.click(page.find(attr('data-member-link-submit'), 'Link'))
    const review = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    await page.click(page.button(km.pm_act_link, review))
    const error = page.find(attr('data-member-error'), 'the refusal')
    assert.equal(error.textContent, km.pm_err_stale, 'the Khmer sentence for member_link_stale')
    assert.ok(!page.text().includes('English from the server'))
    assert.equal(String(propsOf(page.find(attr('data-member-note'), 'the note')).value), 'seen at the till', 'the typed note survives the refusal')
    // the member in the refusal replaced the one the float held: the retry carries the new version
    await page.click(page.button(km.pm_act_link, page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!))
    const versions = callsTo(rec, 'linkMember').map(([, args]) => (args as [number, { expectedLinkVersion: number }])[1].expectedLinkVersion)
    assert.deepEqual(versions, [0, 5])
  } finally { await page.unmount() }
})

await runTest('History is view-only; Revert shows where it may and asks for the identity check when it reconnects a customer', async () => {
  const event = (overrides: Record<string, unknown>) => ({
    id: 1, action: 'link', fromCustomer: null, toCustomer: CUSTOMER_DARA, evidence: 'in_person', reasonCode: null, note: 'checked', matchBasis: null,
    groupId: null, revertsEventId: null, linkRequestId: null, linkVersionAfter: 2, actorName: 'Admin', createdAt: '2026-10-01 03:00:00', revertible: true, ...overrides,
  })
  const relinkingHistory = (customerVisible: boolean) => ({ linkVersion: 2, customerVisible, events: [event({ id: 5, action: 'unlink', fromCustomer: customerVisible ? CUSTOMER_DARA : null, toCustomer: null, reasonCode: customerVisible ? 'wrong_person' : null })] })
  const openHistory = async (page: MountedSurface) => {
    await openDetail(page, 8)
    await page.click(page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'history', 'History'))
    await page.waitFor(() => exists(page, attr('data-member-event')), 'the history rows')
  }
  const full = await mountTab({ who: LINKER, members: [{ ...dara, chip: 'unverified', customer: null }], history: relinkingHistory(true) })
  try {
    await openHistory(full.page)
    const float = full.page.find(attr('data-member-history'), 'the history float')
    assert.equal(float.querySelectorAll('input').length + float.querySelectorAll('textarea').length + float.querySelectorAll('select').length, 0, 'view-only: no field in the History float')
    assert.ok(full.page.text().includes(full.pack.tap_to_view_details))
    const revert = full.page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'revert', 'Revert')
    await full.page.click(revert)
    const dialog = full.page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.ok(exists(full.page, attr('data-member-evidence')), 'a revert that reconnects a customer asks for the identity check')
    assert.ok(dialog.textContent.includes(full.pack.pm_note_hint), 'with the "Don\'t write customer details in notes" hint')
    assert.equal(propsOf(full.page.button(full.pack.revert, dialog)).disabled, true, 'Revert waits for the evidence')
  } finally { await full.page.unmount() }

  const hidden = await mountTab({ who: LINKS_ONLY, members: [hide({ ...dara, chip: 'unverified' })], history: relinkingHistory(false) })
  try {
    await openHistory(hidden.page)
    assert.equal(exists(hidden.page, (node) => node.getAttribute('data-member-action') === 'revert'), false, 'no relinking Revert without Contacts view')
    await hidden.page.click(hidden.page.find(attr('data-records-row'), 'the history row'))
    assert.ok(hidden.page.find(attr('data-member-history'), 'history').textContent.includes(hidden.pack.pm_customer_hidden), 'the customer columns read "Customer hidden"')
  } finally { await hidden.page.unmount() }
})

await runTest('A links-only viewer reads a relabelled merge/legacy event as a plain link or unlink, with no actor, no identity check and no customer', async () => {
  // What the Worker sends a caller without Contacts view for legacy_import and merge_unlink (bb080bbbf):
  // action link / unlink, evidence null, actorName null, both customers null.
  const relabelled = (id: number, action: string) => ({
    id, action, fromCustomer: null, toCustomer: null, evidence: null, reasonCode: null, note: null, matchBasis: null,
    groupId: null, revertsEventId: null, linkRequestId: null, linkVersionAfter: id, actorName: null, createdAt: '2026-10-01 03:00:00', revertible: false,
  })
  const history = { linkVersion: 2, customerVisible: false, events: [relabelled(2, 'unlink'), relabelled(1, 'link')] }
  const { page, pack } = await mountTab({ who: LINKS_ONLY, members: [hide({ ...dara, chip: 'unverified' })], history })
  try {
    await openDetail(page, 8)
    await page.click(page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'history', 'History'))
    await page.waitFor(() => exists(page, attr('data-member-event')), 'the history rows')
    const rows = page.findAll(attr('data-member-event'))
    assert.deepEqual(rows.map((row) => row.getAttribute('data-member-event')), ['unlink', 'link'])
    assert.ok(rows[0].textContent.includes(pack.pm_hist_unlink) && rows[1].textContent.includes(pack.pm_hist_link), 'the plain Linked / Unlinked wording')
    const openRow = async (action: string) => {
      await page.click(page.findAll(attr('data-records-row'))[action === 'unlink' ? 0 : 1])
      return page.findAll(attr('data-member-event', action))[0].textContent
    }
    // The unlink ends at nothing and the link starts from nothing; the other side stays hidden.
    const unlinkRow = await openRow('unlink')
    assert.ok(unlinkRow.includes(pack.pm_customer_hidden) && unlinkRow.includes(pack.pm_not_linked), 'unlink: Customer hidden before, Not linked after')
    const unlinkFloat = page.find(attr('data-member-history'), 'history').textContent
    assert.ok(!unlinkFloat.includes(pack.pm_evidence), 'no Identity check row when evidence is null')
    assert.ok(!unlinkFloat.includes(pack.pm_ev_system), 'the system evidence never shows')
    assert.ok(unlinkFloat.includes(pack.unknown), 'a null actor reads Unknown, not a blank or "null"')
    const linkRow = await openRow('link')
    assert.ok(linkRow.includes(pack.pm_customer_hidden) && linkRow.includes(pack.pm_not_linked), 'link: Not linked before, Customer hidden after')
    const float = page.find(attr('data-member-history'), 'history').textContent
    assert.ok(!float.includes('null') && !float.includes('undefined'))
    assert.equal(exists(page, (node) => node.getAttribute('data-member-action') === 'revert'), false, 'revertible:false from the server hides Revert')
  } finally { await page.unmount() }
})

await runTest('Unlink takes a reason and shows before and after; Reset password takes evidence plus a note, and shows the password once', async () => {
  const { page, rec, pack } = await mountTab({ who: ADMIN, members: [dara] })
  try {
    await openDetail(page, 8)
    await page.click(page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'unlink', 'Unlink'))
    let dialog = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.ok(dialog.textContent.includes('Dara Chan') && dialog.textContent.includes(pack.pm_not_linked), 'before: the customer, after: Not linked')
    assert.equal(propsOf(page.button(pack.pm_act_unlink, dialog)).disabled, true, 'Unlink waits for a reason')
    await page.click(page.find(attr('data-member-reason-option', 'other'), 'the Other reason'))
    assert.equal(propsOf(page.button(pack.pm_act_unlink, dialog)).disabled, true, '"Other" needs a note')
    await page.type(page.find(attr('data-member-note'), 'the note'), 'asked at the till')
    assert.ok(dialog.textContent.includes(pack.pm_note_hint))
    await page.click(page.button(pack.pm_act_unlink, dialog))
    const unlink = (callsTo(rec, 'unlinkMember')[0][1] as [number, Record<string, unknown>])
    assert.equal(unlink[0], 8)
    assert.equal(unlink[1].reasonCode, 'other')
    assert.equal(unlink[1].note, 'asked at the till')
    assert.equal(unlink[1].expectedLinkVersion, 2)
  } finally { await page.unmount() }

  const reset = await mountTab({ who: ADMIN, members: [sokha] })
  try {
    await openDetail(reset.page, 7)
    await reset.page.click(reset.page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'reset', 'Reset password'))
    const dialog = reset.page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    const confirm = () => reset.page.button(reset.pack.pm_act_reset, dialog)
    assert.equal(propsOf(confirm()).disabled, true)
    await reset.page.call(reset.page.find(attr('data-member-evidence-option', 'in_person'), 'In person'), 'onChange', [{}])
    assert.equal(propsOf(confirm()).disabled, true, 'evidence alone is not enough: the note is required')
    assert.equal(exists(reset.page, attr('data-member-check-code')), false, 'a reset has no code to check')
    await reset.page.type(reset.page.find(attr('data-member-note'), 'the note'), 'In the shop, showed the phone')
    await reset.page.click(confirm())
    assert.deepEqual(callsTo(reset.rec, 'resetMemberPassword')[0][1], [7, { evidence: 'in_person', note: 'In the shop, showed the phone' }])
    await reset.page.waitFor(() => reset.page.text().includes('TEMP-PASS-77'), 'the temporary password')
    assert.ok(reset.page.text().includes(reset.pack.pm_temp_password_note))
    assert.deepEqual(clipboardWrites, [], 'showing the password copies nothing')
    await reset.page.click(reset.page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'copy', 'Copy'))
    assert.deepEqual(clipboardWrites, ['TEMP-PASS-77'], 'Copy writes the clipboard once')
  } finally { await reset.page.unmount() }
})

await runTest('the Requests filter shows the "In review" section: Approve is the Link action, Reject needs a reason', async () => {
  const requested = { ...sokha, pendingRequest: { id: 5, note: 'Please link me', createdAt: '2026-10-02 04:00:00' } }
  const requests = [{ id: 5, status: 'pending', note: 'Please link me', createdAt: '2026-10-02 04:00:00', decidedByName: null, decidedAt: null, decidedNote: null, member: requested }]
  const { page, rec, pack } = await mountTab({ who: LINKER, members: [requested], requests })
  try {
    const chip = page.find(attr('data-member-filter', 'requests'), 'the Requests filter')
    assert.equal(chip.querySelectorAll('span').filter(attr('data-member-requests-count')).length, 1, 'the chip counts the requests in review')
    await page.click(chip)
    assert.ok(page.find(attr('data-member-requests'), 'the review section').textContent.includes(pack.pm_in_review))
    assert.ok(page.text().includes('Please link me'))
    await page.click(page.find((node) => node.tagName === 'BUTTON' && node.getAttribute('data-member-action') === 'reject', 'Reject'))
    const dialog = page.findAll((node) => node.getAttribute('role') === 'dialog').pop()!
    assert.equal(propsOf(page.button(pack.reject, dialog)).disabled, true, 'Reject waits for a reason')
    await page.type(page.find(attr('data-member-note'), 'the reason'), 'Not a customer of ours')
    await page.click(page.button(pack.reject, dialog))
    assert.deepEqual(callsTo(rec, 'rejectLinkRequest')[0][1], [5, 'Not a customer of ours'])
    await page.click(page.find(attr('data-member-approve'), 'Approve'))
    assert.ok(page.find(attr('data-member-link-float'), 'the Link float').textContent.includes('Please link me'), 'Approve opens the Link float with the member\'s own note')
  } finally { await page.unmount() }

  const linksOnly = await mountTab({ who: LINKS_ONLY, members: [hide(requested)], requests: requests.map((request) => ({ ...request, member: hide(requested) })) })
  try {
    await linksOnly.page.click(linksOnly.page.find(attr('data-member-filter', 'requests'), 'the Requests filter'))
    assert.equal(exists(linksOnly.page, attr('data-member-approve')), false, 'without Contacts view a request can be rejected but not approved')
    assert.ok(exists(linksOnly.page, (node) => node.getAttribute('data-member-action') === 'reject'))
  } finally { await linksOnly.page.unmount() }
})

await runTest('Khmer: the tab renders its own words, one-row text keeps room for Khmer glyphs, and no English key leaks', async () => {
  const { page } = await mountTab({ who: ADMIN, members: [sokha, dara], language: 'km' })
  try {
    const text = page.text()
    assert.ok(text.includes(km.pm_filter_unlinked) && text.includes(km.pm_chip_unverified))
    for (const english of [en.pm_filter_unlinked, en.pm_chip_unverified, en.pm_not_linked]) assert.ok(!text.includes(english), `no English "${english}" in Khmer mode`)
    assert.ok(!/pm_[a-z_]+/.test(text), 'no raw key shows')
    const row = rowOf(page, 7)
    assert.match(row.querySelector('span')?.className ?? '', /leading-relaxed/, 'the row line box is sized for Khmer')
  } finally { await page.unmount() }
})

await harness.close()
if (failed) { console.error(`${failed} FAILED`); process.exit(1) }

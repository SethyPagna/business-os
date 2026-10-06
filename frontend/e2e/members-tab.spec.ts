import { expect, test, type Page, type Route } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { collectPageHealth, pageErrorsExcludingKnown } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * members-tab.spec.ts -- Contacts > Members in the BUILT app at 360x800 and
 * 1280x800, in English and Khmer, against a mocked /api/portal-members.
 *
 * G38 phase 1 (owner, 5 Oct 2026): website members are separate from in-store
 * customers; staff link, unlink, move and revert with an identity check, members
 * can ask for a link ("In review"), and a viewer without Contacts view never
 * sees a customer.
 *
 * WHAT THIS PROVES in a real browser (the screens' rules are pinned by
 * tests/portalMembers*.test.ts; this is what only a browser can say):
 *  - the list paints compact rows (W- id, name, phone, chip, link state) and
 *    never scrolls the page sideways at 360 px, in either language;
 *  - every float opens with its real content (Link: search, identity check, note
 *    and the Link action are all on screen at once; History: its rows);
 *  - the identity check, the "Don't write customer details in notes" hint and the
 *    before/after review dialog are there; nothing is pre-selected;
 *  - dates read dd/mm/yyyy with a 24-hour time;
 *  - a viewer with only "Approve member links" sees "Customer hidden" and none of
 *    Link, the Conflicts filter or the Sign-up claims filter.
 *
 * The Worker is mocked: the fixture server has no members. Screenshots go to
 * MEMBERS_SHOTS when it is set.
 */
test.use({ serviceWorkers: 'block' })

const SHOTS = process.env.MEMBERS_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const CUSTOMER_DARA = { id: 101, name: 'Dara Chan', membershipNumber: 'LC-00101', available: true }
const base = {
  legacyMembershipId: null, email: null, status: 'active', linkVersion: 0, closedAt: null, lastSeenAt: '2026-10-04 08:30:00',
  createdAt: '2026-09-01 02:00:00', pendingRequest: null, customerVisible: true,
}
const MEMBERS = [
  { ...base, id: 7, memberCode: 'W-7KQ4-M9XD', name: 'Sokha Rith', phone: '012345678', chip: 'unverified', customer: null, createdFromSignup: false, legacyClaim: false, conflicts: ['phone_customer_taken'], pendingRequest: { id: 5, note: 'I bought here last month', createdAt: '2026-10-02 04:00:00' } },
  { ...base, id: 8, memberCode: 'W-3HT9-PB2C', name: 'Dara Chan', phone: '098765432', chip: 'linked', linkVersion: 2, customer: CUSTOMER_DARA, createdFromSignup: true, legacyClaim: true, conflicts: [] },
  { ...base, id: 9, memberCode: 'W-8XNQ-4ZKF', name: 'Vanna Lim', phone: null, chip: 'suspended', status: 'suspended', customer: null, createdFromSignup: false, legacyClaim: false, conflicts: [] },
]
const hidden = (member: typeof MEMBERS[number]) => ({ ...member, customer: null, customerVisible: false, conflicts: [], createdFromSignup: null, legacyClaim: null })
const SUGGESTIONS = [
  { customerId: 101, name: 'Dara Chan', membershipNumber: 'LC-00101', phone: '012345678', strength: 'strong', basis: ['phone', 'name'], linkedMemberId: null },
  { customerId: 102, name: 'Sokha Family', membershipNumber: 'LC-00102', phone: '012345678', strength: 'possible', basis: ['phone'], linkedMemberId: null },
]
const HISTORY = {
  linkVersion: 2, customerVisible: true,
  events: [
    { id: 12, action: 'link', fromCustomer: null, toCustomer: CUSTOMER_DARA, evidence: 'in_person', reasonCode: null, note: 'Showed the account at the till', matchBasis: { strength: 'strong', basis: ['phone', 'name'] }, groupId: null, revertsEventId: null, linkRequestId: null, linkVersionAfter: 2, actorName: 'sokha_admin', createdAt: '2026-10-01 03:15:00', revertible: true },
    { id: 4, action: 'legacy_import', fromCustomer: null, toCustomer: CUSTOMER_DARA, evidence: 'system', reasonCode: 'signup_claimed_customer', note: null, matchBasis: null, groupId: null, revertsEventId: null, linkRequestId: null, linkVersionAfter: 1, actorName: null, createdAt: '2026-09-02 05:00:00', revertible: false },
  ],
}

type Viewer = 'admin' | 'linksOnly'

/** Answers every /api/portal-members call the screens make. */
async function mockMembers(page: Page, viewer: Viewer): Promise<void> {
  const shape = (member: typeof MEMBERS[number]) => (viewer === 'linksOnly' ? hidden(member) : member)
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/portal-members**', async (route) => {
    const url = new URL(route.request().url())
    const tail = url.pathname.replace('/api/portal-members', '')
    const method = route.request().method()
    if (method === 'GET' && tail === '') {
      const filter = url.searchParams.get('filter') || 'all'
      const q = (url.searchParams.get('q') || '').toLowerCase()
      let items = MEMBERS.map(shape)
      if (filter === 'unlinked') items = items.filter((member) => member.chip === 'unverified')
      if (filter === 'linked') items = items.filter((member) => member.chip === 'linked')
      if (filter === 'suspended') items = items.filter((member) => member.status === 'suspended')
      if (filter === 'requests') items = items.filter((member) => member.pendingRequest)
      if (q) items = items.filter((member) => `${member.name} ${member.memberCode}`.toLowerCase().includes(q))
      return json(route, { items, total: items.length, limit: 20, offset: 0, filter })
    }
    if (method === 'GET' && tail === '/link-requests') {
      const requested = shape(MEMBERS[0])
      return json(route, { requests: [{ id: 5, status: 'pending', note: 'I bought here last month', createdAt: '2026-10-02 04:00:00', decidedByName: null, decidedAt: null, decidedNote: null, member: requested }] })
    }
    if (method === 'GET' && /\/\d+\/suggestions$/.test(tail)) return json(route, { suggestions: SUGGESTIONS })
    if (method === 'GET' && tail === '/customer-search') return json(route, { customers: [{ id: 103, name: 'Held Customer', membershipNumber: 'LC-00103', phone: '011222333', linkedMember: { id: 8, memberCode: 'W-3HT9-PB2C', name: 'Dara Chan' } }] })
    if (method === 'GET' && /\/\d+\/history$/.test(tail)) {
      return json(route, viewer === 'linksOnly'
        ? { linkVersion: 2, customerVisible: false, events: HISTORY.events.map((event) => ({ ...event, fromCustomer: null, toCustomer: null, reasonCode: null, revertible: event.id === 12 && false })) }
        : HISTORY)
    }
    // A link that lost a race: the Worker answers 409 with the member as it is now.
    if (method === 'POST' && /\/\d+\/link$/.test(tail)) {
      return json(route, { error: 'This member changed since you opened it.', code: 'member_link_stale', member: { ...shape(MEMBERS[0]), linkVersion: 3 } }, 409)
    }
    return json(route, { error: 'No members fixture for this call', code: 'e2e_unmocked' }, 404)
  })
}

/** The fixture admin carries every permission; this narrows it to "Approve member links" alone. */
async function narrowToLinksOnly(page: Page): Promise<void> {
  await page.route('**/api/auth/**', async (route) => {
    const response = await route.fetch()
    if (!(response.headers()['content-type'] || '').includes('json')) return route.fulfill({ response })
    const body = await response.json() as { user?: Record<string, unknown> }
    if (body?.user && typeof body.user === 'object') {
      body.user = { ...body.user, role_code: 'staff', permissions: {}, role_permissions: { portal_member_links: true } }
    }
    return route.fulfill({ response, json: body })
  })
}

async function expectNoSidewaysOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(1)
  const size = page.viewportSize()!
  for (const dialog of await page.getByRole('dialog').all()) {
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1)
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

async function openMembers(page: Page, language: 'en' | 'km'): Promise<void> {
  await signIn(page, E2E_ACCOUNTS.cashierA, 'admin123') // cashier_a carries the fixture admin role; the 'admin' account's fixture username is e2e_admin, which signIn's identity check rejects
  if (language === 'km') {
    // Switch the pack BEFORE any float opens: a float's backdrop covers the toggle.
    await page.locator('button:has(span:text-is("EN")), button:has(span:text-is("KM"))').filter({ visible: true }).first().click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'km')
  }
  await gotoAdminPage(page, '/contacts#hub:contacts:members')
  await expect(page.locator('[data-members-tab]')).toBeVisible({ timeout: 30_000 })
}

const rows = (page: Page) => page.locator('[data-member-row]')
const topDialog = (page: Page) => page.getByRole('dialog').last()

for (const size of [{ width: 360, height: 800, name: '360' }, { width: 1280, height: 800, name: '1280' }]) {
  for (const language of ['en', 'km'] as const) {
    test.describe(`${size.name}px, ${language}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } })

      test('Members: compact rows, Link float, review dialog, History, requests and the sign-up switch', async ({ page }) => {
        const health = collectPageHealth(page)
        await mockMembers(page, 'admin')
        await openMembers(page, language)

        // The list: one row per member with W- id, name, chip and link state.
        await expect(rows(page)).toHaveCount(3)
        await expect(rows(page).nth(0)).toContainText('W-7KQ4-M9XD')
        await expect(rows(page).nth(1)).toContainText('LC-00101')
        await expect(page.locator('[data-member-chip="suspended"]')).toHaveCount(1)
        await expect(page.locator('[data-member-filter]')).toHaveCount(7)
        await expect(page.locator('[data-member-requests-count]')).toHaveText('1')
        await shot(page, `list-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        // Detail: dates read dd/mm/yyyy, 24-hour.
        await rows(page).nth(1).locator('button').first().click()
        const detail = page.locator('[data-member-detail]')
        await expect(detail).toBeVisible()
        await expect(detail).toContainText('01/09/2026')
        await expect(detail).toContainText('04/10/2026 15:30')
        await expect(page.locator('[data-member-action="relink"], [data-member-action="unlink"], [data-member-action="history"]')).toHaveCount(3)
        await shot(page, `detail-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        // History: view-only rows, a revert on the latest change, the details table on press.
        await page.locator('[data-member-action="history"]').click()
        const history = page.locator('[data-member-history]')
        await expect(history.locator('[data-member-event]')).toHaveCount(2)
        await expect(history.locator('input, textarea, select')).toHaveCount(0)
        await expect(history).toContainText('01/10/2026 10:15')
        await expect(page.locator('[data-member-action="revert"]')).toHaveCount(1)
        await history.locator('[data-records-row]').first().click()
        await expect(history.locator('table')).toContainText('LC-00101')
        await shot(page, `history-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)
        // The header's close control is the first button of each float.
        await topDialog(page).getByRole('button').first().click()
        await expect(page.locator('[data-member-history]')).toHaveCount(0)
        await topDialog(page).getByRole('button').first().click()
        await expect(page.locator('[data-member-detail]')).toHaveCount(0)

        // The Link float: everything is on screen at once, nothing is pre-selected.
        await rows(page).nth(0).locator('[data-member-row-link]').click()
        const float = page.locator('[data-member-link-float]')
        await expect(float).toBeVisible()
        await expect(float.locator('[data-member-pick]')).toHaveCount(2)
        await expect(float.locator('[data-member-pick][aria-pressed="true"]')).toHaveCount(0)
        await expect(float.locator('[data-member-evidence-option]')).toHaveCount(3)
        await expect(float.locator('[data-member-check-code]')).toBeDisabled()
        await expect(float.locator('[data-member-note-hint]')).toBeVisible()
        await expect(float.locator('[data-member-link-submit]')).toBeDisabled()
        await shot(page, `link-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        await float.locator('[data-member-pick]').first().click()
        await float.locator('[data-member-evidence-option="called_number_on_file"]').check()
        await expect(float.locator('[data-member-check-code]')).toBeEnabled()
        await float.locator('[data-member-check-code]').fill('123456')
        await expect(float.locator('[data-member-link-submit]')).toBeEnabled()
        await shot(page, `link-ready-${language}-${size.name}`)
        await float.locator('[data-member-link-submit]').click()
        const review = topDialog(page)
        await expect(review).toContainText('Dara Chan')
        await expect(review).toContainText('LC-00101')
        await shot(page, `link-review-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)
        await review.getByRole('button').nth(1).click() // [close, confirm, cancel]
        await expect(page.locator('[data-member-error]')).toBeVisible()
        await shot(page, `link-refused-${language}-${size.name}`)
        // A reload is the plain way past the dirty float (Escape is not wired on these floats).

        // Requests: "In review", Approve and Reject.
        await page.reload()
        await expect(page.locator('[data-members-tab]')).toBeVisible()
        await page.locator('[data-member-filter="requests"]').click()
        await expect(page.locator('[data-member-requests]')).toBeVisible()
        await expect(page.locator('[data-member-request]')).toHaveCount(1)
        await expect(page.locator('[data-member-approve]')).toBeVisible()
        await shot(page, `requests-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)
        await page.locator('[data-member-action="reject"]').click()
        await expect(topDialog(page).locator('[data-member-note-hint]')).toBeVisible()
        await shot(page, `reject-${language}-${size.name}`)
        await topDialog(page).getByRole('button').first().click()
        await expect(page.locator('[data-member-note-hint]')).toHaveCount(0)

        // The admin-only sign-up switch.
        await page.locator('[data-member-action="signup"]').click()
        const switchButton = page.locator('[data-member-signup-switch]')
        await expect(switchButton).toHaveAttribute('aria-checked', 'false')
        await shot(page, `signup-${language}-${size.name}`)
        await switchButton.click()
        await shot(page, `signup-review-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        expect(pageErrorsExcludingKnown(health), 'uncaught page errors').toEqual([])
      })

      test('a viewer with only "Approve member links": Customer hidden, no Link, no Conflicts or Sign-up claims', async ({ page }) => {
        const health = collectPageHealth(page)
        await narrowToLinksOnly(page)
        await mockMembers(page, 'linksOnly')
        await openMembers(page, language)
        await expect(rows(page)).toHaveCount(3)
        await expect(page.locator('[data-member-filter]')).toHaveCount(5)
        await expect(page.locator('[data-member-filter="conflicts"], [data-member-filter="legacy_claims"]')).toHaveCount(0)
        await expect(page.locator('[data-member-row-link]')).toHaveCount(0)
        await expect(page.locator('[data-member-link-state="linked"]')).toContainText(/Customer hidden|លាក់អតិថិជន/)
        await expect(page.locator('[data-member-action="signup"]')).toHaveCount(0)
        await expect(page.locator('[data-members-tab]')).not.toContainText('LC-00101')
        await shot(page, `hidden-list-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        await rows(page).nth(1).locator('button').first().click()
        const detail = page.locator('[data-member-detail]')
        await expect(detail).toContainText(/Customer hidden: needs Contacts access|លាក់អតិថិជន៖/)
        await expect(page.locator('[data-member-action="link"], [data-member-action="relink"], [data-member-action="reset"]')).toHaveCount(0)
        await expect(page.locator('[data-member-action="unlink"]')).toHaveCount(1)
        await shot(page, `hidden-detail-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)
        expect(pageErrorsExcludingKnown(health), 'uncaught page errors').toEqual([])
      })
    })
  }
}

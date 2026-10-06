// G38 Contacts > Members: what the screens decide, without rendering them.
//
// Each check names the plausible wrong implementation it would catch and runs a
// control beside it, so a green run proves the check can fail:
//   - the tab shows to anyone with Contacts view (it must need portal_member_links);
//   - a viewer without Contacts view is offered Link, Move, the Conflicts and
//     Sign-up claims filters or LC search (the Worker withholds all of them);
//   - the password reset is shown to a non-admin;
//   - the sign-up switch writes the wrong strings, or more than its one key;
//   - a refusal code the Worker can answer has no pack text.
//
// Run: node tests/portalMembersModel.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONFLICT_TEXT,
  EVIDENCE_TEXT,
  HISTORY_ACTION_TEXT,
  MEMBER_ERROR_TEXT,
  PORTAL_MEMBER_LINKS_PERMISSION,
  SIGNUP_SETTING_KEY,
  UNLINK_REASONS,
  canRevert,
  customerHidden,
  evidenceOptions,
  isSignupSwitchOn,
  linkStateOf,
  memberActions,
  memberErrorText,
  memberReadErrorText,
  memberFilters,
  memberViewer,
  revertRelinks,
  signupSettingPayload,
  signupSwitchValue,
} from '../src/components/contacts/members/memberModel.ts'
import { getHubDestinations } from '../src/components/shared/hubNavigation.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { diffSettings, sendChangedSettings } from '../src/utils/settingsSave.ts'
import type { MemberHistoryEvent, StaffMember } from '../src/api/portalMembersTransport.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.dirname(here)
const REPO = path.dirname(FRONTEND)
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), 'utf8')
const flat = (input: unknown, target: Record<string, string> = {}): Record<string, string> => {
  for (const [key, value] of Object.entries((input || {}) as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) flat(value, target)
    else target[key] = String(value)
  }
  return target
}
const en = flat(JSON.parse(read(FRONTEND, 'src/lang/en.json')))
const km = flat(JSON.parse(read(FRONTEND, 'src/lang/km.json')))

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) {
    process.exitCode = 1
    console.log(`FAIL ${name}: ${(error as Error).message}`)
  }
}

// --- people -------------------------------------------------------------------
type User = { role_code?: string; role_permissions?: Record<string, unknown>; permissions?: Record<string, unknown> }
const admin: User = { role_code: 'admin', role_permissions: { all: true }, permissions: {} }
const staffWithContactsAndLinks: User = { role_code: 'staff', role_permissions: { contacts: true, portal_member_links: true }, permissions: {} }
const linksOnly: User = { role_code: 'staff', role_permissions: { portal_member_links: true }, permissions: {} }
const contactsOnly: User = { role_code: 'staff', role_permissions: { contacts: true }, permissions: {} }
const access = (user: User) => {
  const authority = effectivePermissions(user)
  return { can: authority.can, hasPermission: authority.hasPermission, getPermissionTier: authority.getPermissionTier }
}
const viewerOf = (user: User) => memberViewer(user, access(user).can)

function member(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 7, memberCode: 'W-7KQ4-M9XD', legacyMembershipId: null, name: 'Sokha', phone: '012345678', email: null,
    status: 'active', chip: 'unverified', linkVersion: 0, customer: null, customerVisible: true,
    createdFromSignup: false, legacyClaim: false, createdAt: '2026-09-01 02:00:00', lastSeenAt: null, closedAt: null,
    pendingRequest: null, conflicts: [], ...overrides,
  }
}
const linkedCustomer = { id: 101, name: 'Dara', membershipNumber: 'LC-00101', available: true }

// --- 1. the tab needs its own permission ---------------------------------------
await check('the Members tab needs portal_member_links, not Contacts view', () => {
  const ids = (user: User) => getHubDestinations('contacts', access(user)).map((item) => item.id)
  assert.ok(ids(staffWithContactsAndLinks).includes('members'))
  assert.ok(ids(admin).includes('members'))
  assert.ok(!ids(contactsOnly).includes('members'), 'Contacts view alone must not show Members')
  assert.deepEqual(ids(linksOnly), ['members'], 'Approve member links alone shows Members and nothing else')
  assert.ok(!getHubDestinations('contacts', access({ role_code: 'staff', role_permissions: {}, permissions: {} })).length)
  // control: the same list for a Contacts-only user still shows the other tabs, so an empty answer above is the gate and not a broken helper
  assert.ok(ids(contactsOnly).includes('customers'))
})

await check('opening the Contacts page honours the same grant (canAccessPage) and the editor offers the row', () => {
  const app = read(FRONTEND, 'src/AppContext.tsx')
  assert.match(app, /if \(pageId === 'contacts' && hasPermission\('portal_member_links'\)\) return true/)
  assert.match(app, /\}, \[user, getPermissionTier, can, hasPermission\]\)/, 'canAccessPage lists hasPermission as a dependency')
  const contacts = PERMISSION_SECTIONS.find((section) => section.key === 'contacts')
  const row = contacts?.permissions.find((permission) => permission.key === PORTAL_MEMBER_LINKS_PERMISSION)
  assert.ok(row, 'the role editor has an "Approve member links" row in the Contacts section')
  assert.equal(row?.tKey, 'perm_portal_member_links')
  assert.equal(row?.label, 'Approve member links')
  assert.equal(en.perm_portal_member_links, 'Approve member links')
  assert.ok(/[ក-៿]/.test(km.perm_portal_member_links), 'the Khmer label is Khmer')
  // the Worker names the permission the same way
  assert.match(read(REPO, 'cloudflare/src/routes/portalMembers.ts'), /PORTAL_MEMBER_LINKS_PERMISSION = 'portal_member_links'/)
  const page = read(FRONTEND, 'src/components/contacts/Contacts.tsx')
  assert.match(page, /id === 'members' \? !hasPermission\('portal_member_links'\)/)
  assert.match(page, /tab === 'members' && hasPermission\('portal_member_links'\)/, 'the body is gated as well as the nav entry')
})

// --- 2. customerVisible: false ---------------------------------------------------
await check('a viewer without Contacts view is offered no Link, no Conflicts or Sign-up claims filter', () => {
  const viewer = viewerOf(linksOnly)
  assert.equal(viewer.seesCustomers, false)
  assert.equal(viewer.canLink, false)
  const ids = memberFilters(viewer).map((filter) => filter.id)
  assert.deepEqual(ids, ['all', 'unlinked', 'linked', 'requests', 'suspended'])
  const full = memberFilters(viewerOf(staffWithContactsAndLinks)).map((filter) => filter.id)
  assert.deepEqual(full, ['all', 'unlinked', 'linked', 'requests', 'conflicts', 'suspended', 'legacy_claims'], 'control: with Contacts view every filter is there')
})

await check('"Customer hidden" rows get no Link and no Change link; Unlink, Suspend and History stay', () => {
  const viewer = viewerOf(linksOnly)
  const unlinked = member({ customerVisible: false, chip: 'unverified' })
  const linked = member({ customerVisible: false, chip: 'linked' })
  assert.ok(customerHidden(unlinked, viewer))
  assert.deepEqual(memberActions(unlinked, viewer), ['history', 'suspend'], 'unlinked: nothing to unlink, and no Link')
  assert.deepEqual(memberActions(linked, viewer), ['unlink', 'history', 'suspend'], 'linked: no Change link')
  for (const row of [unlinked, linked]) {
    const actions = memberActions(row, viewer)
    assert.ok(!actions.includes('link') && !actions.includes('relink'))
  }
  // control: the same two members for someone who sees customers
  const full = viewerOf(staffWithContactsAndLinks)
  assert.deepEqual(memberActions(member(), full), ['link', 'history', 'suspend'])
  assert.deepEqual(memberActions(member({ chip: 'linked', customer: linkedCustomer }), full), ['relink', 'unlink', 'history', 'suspend'])
})

await check('a suspended or closed member whose customer is hidden is not guessed to be unlinked', () => {
  assert.equal(linkStateOf(member({ customerVisible: false, chip: 'suspended', status: 'suspended' })), 'unknown')
  assert.equal(linkStateOf(member({ customerVisible: false, chip: 'unverified' })), 'not_linked')
  assert.equal(linkStateOf(member({ customerVisible: false, chip: 'linked' })), 'linked')
  assert.equal(linkStateOf(member({ chip: 'suspended', status: 'suspended', customer: linkedCustomer })), 'linked')
  assert.ok(memberActions(member({ customerVisible: false, chip: 'suspended', status: 'suspended' }), viewerOf(linksOnly)).includes('unlink'), 'unknown still offers Unlink; the Worker answers member_not_linked')
})

await check('a revert that reconnects a customer is hidden from a viewer who cannot link', () => {
  const event = (overrides: Partial<MemberHistoryEvent>): MemberHistoryEvent => ({
    id: 1, action: 'link', fromCustomer: null, toCustomer: linkedCustomer, evidence: 'in_person', reasonCode: null, note: null,
    matchBasis: null, groupId: null, revertsEventId: null, linkRequestId: null, linkVersionAfter: 1, actorName: 'Admin',
    createdAt: '2026-10-01 03:00:00', revertible: true, ...overrides,
  })
  const links = viewerOf(linksOnly)
  const full = viewerOf(staffWithContactsAndLinks)
  const removeOnly = event({ action: 'link', fromCustomer: null })
  const relinking = event({ action: 'unlink', fromCustomer: linkedCustomer, toCustomer: null })
  assert.equal(revertRelinks(removeOnly), false)
  assert.equal(revertRelinks(relinking), true)
  assert.equal(revertRelinks(event({ action: 'link', groupId: 'g1' })), true, 'a Move reconnects the other half')
  assert.equal(canRevert(removeOnly, links), true, 'undoing a first link only removes it')
  assert.equal(canRevert(relinking, links), false)
  assert.equal(canRevert(relinking, full), true, 'control: with Contacts view the same Revert is offered')
  assert.equal(canRevert({ ...removeOnly, revertible: false }, full), false, 'the Worker decides which event is the latest')
})

// --- 3. the password reset is admin-only ------------------------------------------
await check('the reset control is offered to an admin and to nobody else', () => {
  const row = member({ phone: '012345678' })
  assert.ok(memberActions(row, viewerOf(admin)).includes('reset'))
  assert.ok(!memberActions(row, viewerOf(staffWithContactsAndLinks)).includes('reset'), 'a linker who is not an admin does not get Reset password')
  assert.ok(!memberActions(row, viewerOf(linksOnly)).includes('reset'))
  assert.ok(!memberActions(member({ phone: null }), viewerOf(admin)).includes('reset'), 'a Telegram-only member has no password to reset')
  assert.ok(!memberActions(member({ status: 'suspended' }), viewerOf(admin)).includes('reset'), 'the Worker refuses anything but an active account')
  assert.equal(viewerOf(admin).canToggleSignup, true)
  assert.equal(viewerOf(staffWithContactsAndLinks).canToggleSignup, false)
  // the Worker's own gate, so the UI and the API cannot drift apart
  assert.match(read(REPO, 'cloudflare/src/routes/portalMembers.ts'), /if \(!isAdmin\) return c\.json\(\{ error: 'Only an administrator can reset/)
})

await check('owner override is offered to an admin only', () => {
  assert.deepEqual(evidenceOptions(viewerOf(admin)), ['in_person', 'called_number_on_file', 'owner_override'])
  assert.deepEqual(evidenceOptions(viewerOf(staffWithContactsAndLinks)), ['in_person', 'called_number_on_file'])
  for (const option of ['in_person', 'called_number_on_file', 'owner_override'] as const) {
    assert.ok(en[EVIDENCE_TEXT[option].label[0]] && km[EVIDENCE_TEXT[option].hint[0]], `${option} has pack text in both languages`)
  }
})

// --- 4. the sign-up switch ----------------------------------------------------------
await check('the sign-up switch stores "true" and "false", and reads the way the Worker reads', () => {
  assert.equal(signupSwitchValue(true), 'true')
  assert.equal(signupSwitchValue(false), 'false')
  assert.equal(SIGNUP_SETTING_KEY, 'customer_portal_signup_enabled')
  assert.deepEqual(signupSettingPayload(true), { customer_portal_signup_enabled: 'true' })
  assert.deepEqual(signupSettingPayload(false), { customer_portal_signup_enabled: 'false' })
  // unset is OFF
  assert.equal(isSignupSwitchOn(undefined), false)
  assert.equal(isSignupSwitchOn(''), false)
  assert.equal(isSignupSwitchOn('false'), false)
  assert.equal(isSignupSwitchOn('true'), true)
  // the very set the Worker's normalizeBoolean uses: a screen that read only 'true' would show OFF for a stored "on"
  const worker = read(REPO, 'cloudflare/src/routes/portal.ts')
  assert.match(worker, /SWITCH_ON_VALUES = new Set\(\['1', 'true', 'yes', 'on'\]\)/)
  assert.match(worker, /signupEnabled: normalizeBoolean\(settings\.customer_portal_signup_enabled, false\)/)
  for (const value of ['1', 'true', 'yes', 'on', ' TRUE ', 'On']) assert.equal(isSignupSwitchOn(value), true, value)
  for (const value of ['0', 'no', 'off', 'enabled', 'false']) assert.equal(isSignupSwitchOn(value), false, value)
})

await check('saving the switch sends exactly one key, whatever else the tab holds', async () => {
  const heldSettings: Record<string, unknown> = {
    business_name: 'Leang Cosmetics', exchange_rate: '4100', customer_portal_title: 'Shop', receipt_footer: 'Thanks',
    customer_portal_signup_enabled: 'false', theme: 'light',
  }
  const sent: Array<Record<string, unknown>> = []
  const result = await sendChangedSettings({
    requested: signupSettingPayload(true), snapshot: heldSettings, inFlight: new Map(), send: async (changed) => { sent.push(changed); return {} },
  })
  assert.deepEqual(sent, [{ customer_portal_signup_enabled: 'true' }])
  assert.deepEqual(Object.keys(result.sent), ['customer_portal_signup_enabled'])
  // control: a save that resent the whole map would have sent every key, so the diff is what narrows it
  assert.ok(diffSettings({ ...heldSettings, ...signupSettingPayload(true) }, {}).changed && Object.keys(diffSettings({ ...heldSettings, ...signupSettingPayload(true) }, {}).changed).length === Object.keys(heldSettings).length)
  // an unset key is sent too (the default is OFF, so there is nothing stored to compare with)
  const first: Array<Record<string, unknown>> = []
  const { customer_portal_signup_enabled: _unset, ...withoutKey } = heldSettings
  await sendChangedSettings({ requested: signupSettingPayload(false), snapshot: withoutKey, inFlight: new Map(), send: async (changed) => { first.push(changed); return {} } })
  assert.deepEqual(first, [{ customer_portal_signup_enabled: 'false' }])
  // the switch hands saveSettings that payload and nothing else
  const float = read(FRONTEND, 'src/components/contacts/members/MemberSignupFloat.tsx')
  assert.match(float, /saveSettings\(signupSettingPayload\(!on\)\)/)
  assert.doesNotMatch(float, /saveSettings\(\{[\s\S]*\.\.\./, 'no spread of other settings into the save')
})

// --- 5. every refusal has pack text --------------------------------------------------
function workerRefusalCodes(): string[] {
  const route = read(REPO, 'cloudflare/src/routes/portalMembers.ts')
  const lib = read(REPO, 'cloudflare/src/lib/portalMemberLinks.ts')
  const codes = new Set<string>()
  for (const source of [route, lib]) {
    for (const match of source.matchAll(/code: '([a-z_]+)'/g)) codes.add(match[1])
    for (const match of source.matchAll(/conflict\(c, '([a-z_]+)'/g)) codes.add(match[1])
  }
  return [...codes].sort()
}
const uncovered = (codes: string[], table: Record<string, unknown>) => codes.filter((code) => !(code in table))

await check('every refusal code the Worker can answer maps to pack text in both languages', () => {
  const codes = workerRefusalCodes()
  assert.ok(codes.length >= 25, `the scan must find the Worker's codes (found ${codes.length})`)
  for (const expected of ['member_link_stale', 'member_link_customer_taken', 'member_reset_admin_only', 'contacts_view_required', 'member_revert_check_one_member', 'rate_limited']) {
    assert.ok(codes.includes(expected), `the scan sees ${expected}`)
  }
  assert.deepEqual(uncovered(codes, MEMBER_ERROR_TEXT), [], 'a Worker refusal with no entry in MEMBER_ERROR_TEXT')
  for (const [code, [key, fallback]] of Object.entries(MEMBER_ERROR_TEXT)) {
    assert.ok(en[key], `en.json has ${key} (${code})`)
    assert.ok(km[key], `km.json has ${key} (${code})`)
    assert.equal(en[key], fallback, `${key}: the English fallback and the pack agree`)
    assert.ok(/[ក-៿]/.test(km[key]), `${key}: the Khmer text is Khmer`)
    assert.notEqual(km[key], en[key])
  }
  // control: a table missing one code is caught by the same comparison
  const { member_link_stale: _gone, ...without } = MEMBER_ERROR_TEXT
  assert.deepEqual(uncovered(codes, without), ['member_link_stale'])
})

await check('a refusal reads in the operator\'s language, and a code from a newer Worker never shows server English', () => {
  const tEn = (key: string) => en[key]
  const tKm = (key: string) => km[key]
  const stale = { code: 'member_link_stale', message: 'raw server english that must never show', status: 409 }
  assert.equal(memberErrorText(stale, tEn), en.pm_err_stale)
  assert.equal(memberErrorText(stale, tKm), km.pm_err_stale)
  const unknown = memberErrorText({ code: 'a_code_from_a_newer_worker', message: 'Some server English sentence', status: 400 }, tKm)
  assert.ok(!unknown.includes('Some server English sentence'), 'the server prose is not shown')
  assert.ok(/[ក-៿]/.test(unknown), 'the generic text is in Khmer')
  assert.notEqual(memberErrorText({ code: 'request_timeout', outcome: 'unknown' }, tEn), memberErrorText({ code: 'a_code_from_a_newer_worker' }, tEn), 'an unknown outcome gets its own sentence')
})

await check('sibling surfaces follow the new badge shape: the Customers row names the W- code, Resolve labels a member without an LC id', () => {
  const customers = read(FRONTEND, 'src/components/contacts/CustomersTab.tsx')
  assert.match(customers, /portal_account\?: \{ membershipId: string \| null; memberCode\?: string \| null;/)
  assert.equal((customers.match(/title=\{portalAccountTitle\(t, customerRow\.portal_account\)\}/g) || []).length, 2, 'the table row and the phone card both use it')
  assert.match(read(FRONTEND, 'src/components/contacts/contactResolveAdapter.ts'), /String\(membershipId \|\| memberCode \|\| ''\)\.trim\(\)/)
})

// --- 5b. the storefront must not pay for the admin screens ---------------------------------
await check('the Members transport has its own chunk, and nothing the storefront loads imports the Members code', () => {
  assert.match(read(FRONTEND, 'vite.config.ts'), /normalized\.endsWith\('\/src\/api\/portalMembersTransport\.ts'\)\) return 'portal-members-api'/)
  const importers: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const rel = path.relative(path.join(FRONTEND, 'src'), full).split(path.sep).join('/')
      if (/portalMembersTransport|members\/Member/.test(read(full)) && !rel.startsWith('components/contacts/members/') && rel !== 'api/portalMembersTransport.ts') importers.push(rel)
    }
  }
  walk(path.join(FRONTEND, 'src'))
  assert.deepEqual(importers, ['components/contacts/Contacts.tsx'], 'only the lazily loaded Contacts hub reaches the Members tab')
  // control: the scan does see a real importer, so an empty result would mean something
  assert.match(read(FRONTEND, 'src/components/contacts/Contacts.tsx'), /import\('\.\/members\/MembersTab'\)/, 'and it does so through a dynamic import')
})

await check('a failed READ says "could not load" in the reader\'s language; a coded refusal keeps its own sentence', () => {
  const tKm = (key: string) => km[key]
  assert.equal(memberReadErrorText({ code: 'request_timeout' }, tKm), km.pm_load_failed)
  assert.equal(memberReadErrorText(new Error('HTTP 503 raw english'), tKm), km.pm_load_failed)
  assert.equal(memberReadErrorText({ code: 'contacts_view_required' }, tKm), km.pm_err_contacts_view_required)
  assert.notEqual(memberReadErrorText({}, (key: string) => en[key]), memberReadErrorText({ code: 'forbidden' }, (key: string) => en[key]))
  assert.ok(!/write/i.test(memberReadErrorText({ code: 'request_timeout' }, (key: string) => en[key])), 'a read is never called a write')
})

// --- 6. strings -----------------------------------------------------------------------
await check('every Members string exists in both packs, in Khmer, and the owner\'s wording is kept', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('pm_'))
  assert.ok(keys.length >= 120, `expected the full Members string set, found ${keys.length}`)
  for (const key of keys) {
    assert.ok(key in km, `km.json is missing ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `${key} is not Khmer in km.json: ${km[key]}`)
  }
  for (const [, [key]] of [...Object.entries(HISTORY_ACTION_TEXT), ...Object.entries(CONFLICT_TEXT)]) assert.ok(en[key] && km[key], key)
  for (const reason of UNLINK_REASONS) assert.ok(en[reason.key] && km[reason.key], reason.key)
  assert.equal(en.pm_note_hint, "Don't write customer details in notes.")
  assert.equal(en.pm_signup_label, 'Phone + password sign-up (off: customers use Telegram)')
  assert.equal(en.pm_customer_hidden_hint, 'Customer hidden: needs Contacts access')
  assert.equal(en.pm_hist_merge_repoint, 'Moved by a customer merge')
  assert.equal(en.pm_hist_merge_unlink, 'Unlinked by a customer merge')
  assert.equal(en.pm_hist_legacy_import, 'Linked before members were separate')
  assert.equal(en.pm_marker_legacy_claim, 'Linked by the old sign-up, check')
  assert.equal(en.pm_reset_note_ph, 'How you identified the member (who, where, which number)')
  assert.equal(en.pm_reset_note_call_ph, 'Which number you called and what the member confirmed')
  assert.equal(en.pm_err_revert_one_member, 'This undo reconnects more than one member. Confirm in person, or as an owner override.')
  assert.equal(en.pm_err_contacts_view_required, 'You need Contacts view access to see or link customers.')
  // staff text may say Business OS, but never the retired shop name
  for (const key of keys) assert.ok(!/Leang Beauty/.test(en[key] + km[key]), key)
})

console.log(`\n${passed} passed`)

// Contacts > Members: every rule the screens apply, in one pure module so a test
// can drive it without rendering. The Worker is the security boundary
// (routes/portalMembers.ts); what is decided here is presentation: which control
// is offered to whom, and which sentence a refusal becomes.
import { isAdminControlUser, type PermissionUser } from '../../../utils/permissions.ts'
import { presentWriteError, type WriteErrorDetail } from '../../../utils/writeErrorPresentation.ts'
import type {
  MemberEvidence,
  MemberFilter,
  MemberHistoryAction,
  MemberHistoryEvent,
  MemberUnlinkReason,
  StaffMember,
} from '../../../api/portalMembersTransport.ts'

export const PORTAL_MEMBER_LINKS_PERMISSION = 'portal_member_links'
export const SIGNUP_SETTING_KEY = 'customer_portal_signup_enabled'

type Translate = (key: string) => string | undefined
type Can = (permissionKey: string, actionKey: string) => boolean

/** The pack text for a key, or the English fallback when the pack has none. */
export function memberText(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

// --- who may do what -----------------------------------------------------------

export interface MemberViewer {
  isAdmin: boolean
  /** Contacts view: without it the Worker withholds every customer fact (customerVisible: false). */
  seesCustomers: boolean
  /** Link, relink, move and a revert that reconnects a customer: the Worker needs Contacts view too. */
  canLink: boolean
  /** Every staff password reset is admin-only on the Worker (member_reset_admin_only). */
  canResetPassword: boolean
  canToggleSignup: boolean
}

export function memberViewer(user: PermissionUser, can: Can): MemberViewer {
  const isAdmin = isAdminControlUser(user)
  const seesCustomers = can('contacts', 'view')
  return { isAdmin, seesCustomers, canLink: seesCustomers, canResetPassword: isAdmin, canToggleSignup: isAdmin }
}

/** A row whose customer facts are withheld: the viewer lacks Contacts view, or the Worker said so. */
export function customerHidden(member: Pick<StaffMember, 'customerVisible'>, viewer: MemberViewer): boolean {
  return member.customerVisible === false || !viewer.seesCustomers
}

/**
 * Linked, not linked, or not knowable. A suspended or closed member's chip says
 * so instead of "linked", so a viewer who cannot see the customer cannot tell:
 * the Worker answers an Unlink on a member that is not linked with
 * member_not_linked.
 */
export function linkStateOf(member: StaffMember): 'linked' | 'not_linked' | 'unknown' {
  if (member.customer || member.chip === 'linked') return 'linked'
  if (member.customerVisible === false && (member.chip === 'suspended' || member.chip === 'closed')) return 'unknown'
  return 'not_linked'
}

export type MemberAction = 'link' | 'relink' | 'unlink' | 'history' | 'suspend' | 'reactivate' | 'reset'

/** The controls a row or its detail offers this viewer, in display order. */
export function memberActions(member: StaffMember, viewer: MemberViewer): MemberAction[] {
  const actions: MemberAction[] = []
  const state = linkStateOf(member)
  const open = member.status !== 'closed'
  if (open && viewer.canLink && state === 'not_linked') actions.push('link')
  if (open && viewer.canLink && state === 'linked') actions.push('relink')
  if (open && state !== 'not_linked') actions.push('unlink')
  actions.push('history')
  if (member.status === 'active') actions.push('suspend')
  if (member.status === 'suspended') actions.push('reactivate')
  if (viewer.canResetPassword && member.status === 'active' && member.phone) actions.push('reset')
  return actions
}

// --- filters -------------------------------------------------------------------

interface FilterDef { id: MemberFilter; key: string; fallback: string; needsCustomers: boolean }

const FILTERS: readonly FilterDef[] = [
  { id: 'all', key: 'pm_filter_all', fallback: 'All', needsCustomers: false },
  { id: 'unlinked', key: 'pm_filter_unlinked', fallback: 'Unlinked', needsCustomers: false },
  { id: 'linked', key: 'pm_filter_linked', fallback: 'Linked', needsCustomers: false },
  { id: 'requests', key: 'pm_filter_requests', fallback: 'Requests', needsCustomers: false },
  // Both describe a customer (removed, or holding this phone): the Worker answers 403 to a links-only caller.
  { id: 'conflicts', key: 'pm_filter_conflicts', fallback: 'Conflicts', needsCustomers: true },
  { id: 'suspended', key: 'pm_filter_suspended', fallback: 'Suspended', needsCustomers: false },
  // Links the OLD sign-up made to an existing customer; says that one exists, so it is customer provenance.
  { id: 'legacy_claims', key: 'pm_filter_legacy_claims', fallback: 'Sign-up claims', needsCustomers: true },
]

export function memberFilters(viewer: MemberViewer): Array<{ id: MemberFilter; key: string; fallback: string }> {
  return FILTERS.filter((filter) => viewer.seesCustomers || !filter.needsCustomers)
}

/** Provenance markers and the LC search hint are customer facts too. */
export function showsProvenance(member: StaffMember, viewer: MemberViewer): boolean {
  return !customerHidden(member, viewer)
}

// --- chips, evidence, reasons ---------------------------------------------------

export const CHIP_TEXT: Record<string, [string, string]> = {
  linked: ['pm_chip_linked', 'Linked'],
  unverified: ['pm_chip_unverified', 'Unverified'],
  verified: ['pm_chip_verified', 'Verified'],
  suspended: ['pm_chip_suspended', 'Suspended'],
  closed: ['pm_chip_closed', 'Closed'],
}

export const CHIP_TONE: Record<string, string> = {
  linked: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  unverified: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  verified: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  suspended: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  closed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

export const EVIDENCE_TEXT: Record<MemberEvidence, { label: [string, string]; hint: [string, string] }> = {
  in_person: {
    label: ['pm_ev_in_person', 'In person'],
    hint: ['pm_ev_in_person_hint', 'Member showed their account at the shop'],
  },
  called_number_on_file: {
    label: ['pm_ev_called', 'Phone call'],
    hint: ['pm_ev_called_hint', 'Member read back the code in their account'],
  },
  owner_override: {
    label: ['pm_ev_override', 'Owner override'],
    hint: ['pm_ev_override_hint', 'Admin, note required'],
  },
}

/** Owner override is admin-only on the Worker (member_link_override_forbidden), so it is not offered to anyone else. */
export function evidenceOptions(viewer: MemberViewer): MemberEvidence[] {
  return viewer.isAdmin ? ['in_person', 'called_number_on_file', 'owner_override'] : ['in_person', 'called_number_on_file']
}

export const UNLINK_REASONS: ReadonlyArray<{ id: MemberUnlinkReason; key: string; fallback: string }> = [
  { id: 'wrong_person', key: 'pm_reason_wrong_person', fallback: 'Wrong person' },
  { id: 'customer_request', key: 'pm_reason_customer_request', fallback: 'Customer asked' },
  { id: 'duplicate', key: 'pm_reason_duplicate', fallback: 'Duplicate' },
  { id: 'other', key: 'pm_reason_other', fallback: 'Other' },
]

export const HISTORY_ACTION_TEXT: Record<MemberHistoryAction, [string, string]> = {
  link: ['pm_hist_link', 'Linked'],
  unlink: ['pm_hist_unlink', 'Unlinked'],
  relink: ['pm_hist_relink', 'Relinked'],
  revert: ['pm_hist_revert', 'Reverted'],
  merge_repoint: ['pm_hist_merge_repoint', 'Moved by a customer merge'],
  merge_unlink: ['pm_hist_merge_unlink', 'Unlinked by a customer merge'],
  legacy_import: ['pm_hist_legacy_import', 'Linked before members were separate'],
}

export const CONFLICT_TEXT: Record<string, [string, string]> = {
  customer_unavailable: ['pm_conflict_customer_unavailable', 'Linked customer was removed or made anonymous'],
  phone_customer_taken: ['pm_conflict_phone_customer_taken', "This phone's customer is linked to another member"],
}

export const SUGGESTION_BASIS_TEXT = (basis: readonly string[]): [string, string] => {
  const set = new Set(basis)
  if (set.has('phone') && set.has('name')) return ['pm_basis_phone_name', 'Phone + name']
  if (set.has('phone')) return ['pm_basis_phone', 'Phone']
  return ['pm_basis_email', 'Email']
}

// --- revert --------------------------------------------------------------------

/**
 * Whether reverting this event puts a member back on a customer, which needs the
 * same identity check as Link (the Worker: member_link_evidence_required).
 * Reverting a first link only removes it. A Move's other half always relinks;
 * for a viewer without Contacts view the group id is withheld, but then the
 * Worker marks the event non-revertible and refuses it anyway.
 */
export function revertRelinks(event: Pick<MemberHistoryEvent, 'action' | 'fromCustomer' | 'groupId'>): boolean {
  return event.action === 'unlink' || event.action === 'relink' || event.fromCustomer != null || event.groupId != null
}

export function canRevert(event: MemberHistoryEvent, viewer: MemberViewer): boolean {
  return event.revertible && (viewer.canLink || !revertRelinks(event))
}

// --- refusals ------------------------------------------------------------------

// Every code portalMembers.ts / portalMemberLinks.ts can answer on a refusal, with
// the English fallback. A test reads the Worker source and fails when a code is
// missing here, so a new refusal cannot reach staff as raw server English.
export const MEMBER_ERROR_TEXT: Record<string, [string, string]> = {
  forbidden: ['pm_err_forbidden', 'You need the "Approve member links" permission.'],
  contacts_view_required: ['pm_err_contacts_view_required', 'You need Contacts view access to see or link customers.'],
  invalid_filter: ['pm_err_invalid_filter', 'This filter is not available.'],
  member_not_found: ['pm_err_member_not_found', 'Member not found.'],
  customer_not_found: ['pm_err_customer_not_found', 'Customer not found.'],
  customer_required: ['pm_err_customer_required', 'Choose a customer.'],
  member_closed: ['pm_err_member_closed', 'This member closed their account.'],
  member_not_linked: ['pm_err_member_not_linked', 'This member is not linked.'],
  member_link_version_required: ['pm_err_version_required', 'Reload the member and try again.'],
  member_link_stale: ['pm_err_stale', 'This member changed since you opened it. Refreshed, try again.'],
  member_link_unchanged: ['pm_err_unchanged', 'This member is already linked to that customer.'],
  member_link_customer_taken: ['pm_err_customer_taken', 'This customer is already linked to another member.'],
  member_link_customer_unavailable: ['pm_err_customer_unavailable', 'This customer is no longer available.'],
  member_link_evidence_required: ['pm_err_evidence_required', 'Choose how the member proved who they are.'],
  member_link_note_required: ['pm_err_note_required', 'Add a note.'],
  member_link_override_forbidden: ['pm_err_override_forbidden', 'Only an administrator can link without an identity check.'],
  member_link_check_failed: ['pm_err_check_failed', 'The code does not match the one in the member\'s account.'],
  rate_limited: ['pm_err_rate_limited', 'Too many attempts. Try again later.'],
  member_link_request_not_found: ['pm_err_request_not_found', 'This request was not found.'],
  member_link_request_not_pending: ['pm_err_request_not_pending', 'This request was already decided or withdrawn.'],
  member_link_event_not_found: ['pm_err_event_not_found', 'This history entry was not found.'],
  member_link_not_revertible: ['pm_err_not_revertible', 'This entry cannot be reverted.'],
  member_link_already_reverted: ['pm_err_already_reverted', 'This entry was already reverted.'],
  member_revert_check_one_member: ['pm_err_revert_one_member', 'This undo reconnects more than one member. Confirm in person, or as an owner override.'],
  member_unlink_reason_required: ['pm_err_reason_required', 'Choose a reason.'],
  member_status_conflict: ['pm_err_status_conflict', 'This member was already changed. Refreshed.'],
  member_reset_admin_only: ['pm_err_reset_admin_only', "Only an administrator can reset a member's password."],
  member_reset_unavailable: ['pm_err_reset_unavailable', 'Only an active phone + password account can be reset here.'],
}

type RefusalLike = WriteErrorDetail

/**
 * The sentence for a failed member call, in the operator's language. A coded
 * refusal maps to its pack text; anything else (a timeout, a gateway error, a
 * code from a newer Worker) goes through the app's write-error presenter, never
 * the server's English.
 */
export function memberErrorText(error: unknown, t: Translate): string {
  const refusal = (error && typeof error === 'object' ? error : {}) as RefusalLike
  const known = MEMBER_ERROR_TEXT[String(refusal.code || '')]
  if (known) return memberText(t, known[0], known[1])
  return presentWriteError(refusal, t).detail
}

/**
 * The sentence for a failed READ (list, history, suggestions, search). A coded
 * refusal keeps its own text; everything else is one plain "could not load",
 * because the write presenter's "Write rejected" is the wrong word for a read.
 */
export function memberReadErrorText(error: unknown, t: Translate): string {
  const known = MEMBER_ERROR_TEXT[String((error as { code?: unknown } | null)?.code || '')]
  return known ? memberText(t, known[0], known[1]) : memberText(t, 'pm_load_failed', 'Could not load. Try again.')
}

// --- the sign-up switch ---------------------------------------------------------

const SWITCH_ON = new Set(['1', 'true', 'yes', 'on'])

/** The Worker's own rule (normalizeBoolean in routes/portal.ts): unset or anything else is OFF. */
export function isSignupSwitchOn(value: unknown): boolean {
  return SWITCH_ON.has(String(value ?? '').trim().toLowerCase())
}

/** What the switch stores: the strings the owner specified. */
export function signupSwitchValue(on: boolean): 'true' | 'false' {
  return on ? 'true' : 'false'
}

/** The one-key payload the switch hands to saveSettings (which sends only changed keys). */
export function signupSettingPayload(on: boolean): Record<string, string> {
  return { [SIGNUP_SETTING_KEY]: signupSwitchValue(on) }
}

// --- display helpers ------------------------------------------------------------

export function customerLabel(customer: { name: string | null; membershipNumber: string | null } | null | undefined): string {
  if (!customer) return ''
  return [customer.name, customer.membershipNumber].filter(Boolean).join(' · ')
}

/** "W-7KQ4-M9XD" for a new member; an old account that has not signed in since the mint has none yet. */
export function memberIdLabel(member: Pick<StaffMember, 'memberCode' | 'legacyMembershipId' | 'id'>): string {
  return member.memberCode || member.legacyMembershipId || `#${member.id}`
}

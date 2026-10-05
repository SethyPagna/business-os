// Staff links between website members and customers (G38 Phase 1, design
// §4.4 and §4.5). routes/portalMembers.ts reads the current state, checks
// permission and evidence, and runs the D1 batch these builders return.
//
// The one current link is portal_accounts.contact_id; every change to it
// appends one row to portal_member_link_events (append-only, migration 0231)
// in the SAME batch, and bumps portal_accounts.link_version. That counter is
// the compare-and-set token: staff send the version they saw, and the batch's
// first statement refuses if it moved. D1 has no interactive transaction, so
// every precondition is a guard statement inside the batch: it raises (a
// malformed-JSON error) and the whole batch rolls back. The route then
// re-reads to say which precondition failed.
//
// Nothing here touches sales, points, receivables or stock. A link is a
// pointer, and every link can be reverted.
//
// Pure: no D1, no Env. The pure test runs these builders against SQLite.

import { canonicalizePhone } from './phone'
import { collectContactPhones, normalizeContactName } from './contactDuplicates'
import { customerIsProfileSql } from './anonymousCustomer'

export type MemberLinkEvidence = 'in_person' | 'called_number_on_file' | 'owner_override'
export const MEMBER_LINK_EVIDENCE: readonly MemberLinkEvidence[] = ['in_person', 'called_number_on_file', 'owner_override']
export const MEMBER_UNLINK_REASONS = ['wrong_person', 'customer_request', 'duplicate', 'other'] as const
export type MemberUnlinkReason = typeof MEMBER_UNLINK_REASONS[number]
export const MEMBER_LINK_NOTE_MAX = 500
// Events a staff Revert may compensate. Merge events point at a customer the
// merge deleted, legacy imports were never a staff decision, and a revert is
// undone by acting again, not by reverting the revert.
export const MEMBER_REVERTIBLE_ACTIONS: readonly string[] = ['link', 'unlink', 'relink']

export type MemberLinkActor = { userId: number | null; userName: string | null }
export type MemberLinkStatement = { sql: string; params?: Record<string, unknown> }

// Error codes a guard can raise. Fixed literals only: never interpolate input.
export type MemberLinkGuardCode =
  | 'member_link_stale'
  | 'member_link_customer_unavailable'
  | 'member_link_request_not_pending'
  | 'member_link_already_reverted'
  | 'member_closed'

function guard(condition: string, params: Record<string, unknown>, code: MemberLinkGuardCode): MemberLinkStatement {
  return {
    sql: `SELECT CASE WHEN (${condition}) THEN 1 ELSE json_extract('${code}', '$') END AS member_link_guard`,
    params,
  }
}

function clampNote(value: unknown): string | null {
  const text = String(value ?? '').trim().slice(0, MEMBER_LINK_NOTE_MAX)
  return text || null
}

// ---------------------------------------------------------------------------
// Evidence (design §4.4, WEB-threat L-06). A receipt, or a phone number the
// member types, is never enough on its own.
//   in_person              the member showed their signed-in account at the till
//   called_number_on_file  staff called the phone on the CUSTOMER record and the
//                          member read back the six-digit code their account shows
//   owner_override         admin only, with a note
export type EvidenceResult =
  | { ok: true; evidence: MemberLinkEvidence; note: string | null }
  | { ok: false; status: 400 | 403 | 422; code: string; error: string }

export function checkMemberLinkEvidence(input: {
  evidence: unknown
  note: unknown
  isAdmin: boolean
  // null when no code was needed; the route verifies it (lib/portalAccounts.ts).
  checkCodeValid: boolean | null
}): EvidenceResult {
  const evidence = String(input.evidence ?? '').trim() as MemberLinkEvidence
  const note = clampNote(input.note)
  if (!MEMBER_LINK_EVIDENCE.includes(evidence)) {
    return { ok: false, status: 400, code: 'member_link_evidence_required', error: 'Choose how the member proved who they are.' }
  }
  if (evidence === 'called_number_on_file' && input.checkCodeValid !== true) {
    return { ok: false, status: 422, code: 'member_link_check_failed', error: 'The code does not match the one shown in the member\'s account.' }
  }
  if (evidence === 'owner_override') {
    if (!input.isAdmin) return { ok: false, status: 403, code: 'member_link_override_forbidden', error: 'Only an administrator can link without an identity check.' }
    if (!note) return { ok: false, status: 400, code: 'member_link_note_required', error: 'Add a note explaining the override.' }
  }
  return { ok: true, evidence, note }
}

// ---------------------------------------------------------------------------
// Event rows. Written AFTER the account UPDATE, so link_version_after is the
// account's new version, read in the same transaction.
type EventFields = {
  accountId: number
  action: 'link' | 'unlink' | 'relink' | 'revert'
  fromCustomerId: number | null
  toCustomerId: number | null
  evidence?: MemberLinkEvidence | null
  reasonCode?: string | null
  note?: string | null
  matchBasis?: string | null
  groupId?: string | null
  revertsEventId?: number | null
  linkRequestId?: number | null
  clientRequestId?: string | null
  actor: MemberLinkActor
}

function eventInsert(fields: EventFields): MemberLinkStatement {
  return {
    sql: `INSERT INTO portal_member_link_events (
        account_id, action, from_customer_id, to_customer_id, evidence, reason_code, note,
        match_basis, group_id, reverts_event_id, link_request_id, link_version_after,
        client_request_id, actor_user_id, actor_name
      )
      SELECT id, @action, @fromCustomerId, @toCustomerId, @evidence, @reasonCode, @note,
        @matchBasis, @groupId, @revertsEventId, @linkRequestId, link_version,
        @clientRequestId, @actorId, @actorName
      FROM portal_accounts WHERE id = @accountId`,
    params: {
      accountId: fields.accountId,
      action: fields.action,
      fromCustomerId: fields.fromCustomerId,
      toCustomerId: fields.toCustomerId,
      evidence: fields.evidence ?? null,
      reasonCode: fields.reasonCode ?? null,
      note: fields.note ?? null,
      matchBasis: fields.matchBasis ?? null,
      groupId: fields.groupId ?? null,
      revertsEventId: fields.revertsEventId ?? null,
      linkRequestId: fields.linkRequestId ?? null,
      clientRequestId: fields.clientRequestId ?? null,
      actorId: fields.actor.userId,
      actorName: fields.actor.userName,
    },
  }
}

function revokeSessions(accountId: number): MemberLinkStatement {
  return {
    sql: 'UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = @accountId AND revoked_at IS NULL',
    params: { accountId },
  }
}

function customerProfileGuard(customerId: number): MemberLinkStatement {
  return guard(`EXISTS (SELECT 1 FROM customers WHERE id = @customerId AND ${customerIsProfileSql()})`, { customerId }, 'member_link_customer_unavailable')
}

// ---------------------------------------------------------------------------
// Link, change link (relink) and move.
export type MemberLinkPlanInput = {
  accountId: number
  expectedLinkVersion: number
  // The account's current customer as the route read it (the guard pins it).
  fromCustomerId: number | null
  toCustomerId: number
  // Set when the customer is already linked to another member and staff chose Move.
  move: { holderAccountId: number; holderLinkVersion: number } | null
  evidence: MemberLinkEvidence
  note: string | null
  matchBasis: string | null
  clientRequestId: string | null
  linkRequestId: number | null
  groupId: string | null
  actor: MemberLinkActor
}

export function buildMemberLinkStatements(input: MemberLinkPlanInput): MemberLinkStatement[] {
  const { accountId, toCustomerId, fromCustomerId, actor } = input
  if (fromCustomerId === toCustomerId) throw new Error('member_link_unchanged')
  const statements: MemberLinkStatement[] = [
    guard(
      "EXISTS (SELECT 1 FROM portal_accounts WHERE id = @accountId AND link_version = @version AND contact_id IS @fromCustomerId AND status <> 'closed')",
      { accountId, version: input.expectedLinkVersion, fromCustomerId },
      'member_link_stale',
    ),
    customerProfileGuard(toCustomerId),
  ]
  if (input.linkRequestId != null) {
    statements.push(guard(
      "EXISTS (SELECT 1 FROM portal_member_link_requests WHERE id = @requestId AND account_id = @accountId AND status = 'pending')",
      { requestId: input.linkRequestId, accountId },
      'member_link_request_not_pending',
    ))
  }
  if (input.move) {
    const { holderAccountId, holderLinkVersion } = input.move
    if (holderAccountId === accountId) throw new Error('member_link_move_self')
    statements.push(
      guard(
        'EXISTS (SELECT 1 FROM portal_accounts WHERE id = @holderId AND link_version = @holderVersion AND contact_id = @customerId)',
        { holderId: holderAccountId, holderVersion: holderLinkVersion, customerId: toCustomerId },
        'member_link_stale',
      ),
      {
        sql: 'UPDATE portal_accounts SET contact_id = NULL, link_version = link_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = @holderId',
        params: { holderId: holderAccountId },
      },
      eventInsert({
        accountId: holderAccountId,
        action: 'unlink',
        fromCustomerId: toCustomerId,
        toCustomerId: null,
        reasonCode: 'moved',
        note: input.note,
        groupId: input.groupId,
        clientRequestId: input.clientRequestId,
        actor,
      }),
      revokeSessions(holderAccountId),
    )
  }
  statements.push(
    {
      sql: 'UPDATE portal_accounts SET contact_id = @customerId, link_version = link_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = @accountId AND link_version = @version',
      params: { customerId: toCustomerId, accountId, version: input.expectedLinkVersion },
    },
    eventInsert({
      accountId,
      action: fromCustomerId == null ? 'link' : 'relink',
      fromCustomerId,
      toCustomerId,
      evidence: input.evidence,
      note: input.note,
      matchBasis: input.matchBasis,
      groupId: input.groupId,
      linkRequestId: input.linkRequestId,
      clientRequestId: input.clientRequestId,
      actor,
    }),
  )
  // A member who loses a customer loses every session (design S6, lane rule).
  if (fromCustomerId != null) statements.push(revokeSessions(accountId))
  if (input.linkRequestId != null) {
    statements.push({
      sql: `UPDATE portal_member_link_requests
        SET status = 'approved',
            decided_event_id = (SELECT MAX(id) FROM portal_member_link_events WHERE account_id = @accountId),
            decided_by_id = @actorId, decided_by_name = @actorName, decided_note = @note, decided_at = CURRENT_TIMESTAMP
        WHERE id = @requestId AND account_id = @accountId AND status = 'pending'`,
      params: { accountId, requestId: input.linkRequestId, actorId: actor.userId, actorName: actor.userName, note: input.note },
    })
  }
  return statements
}

// ---------------------------------------------------------------------------
// Unlink.
export type MemberUnlinkPlanInput = {
  accountId: number
  expectedLinkVersion: number
  fromCustomerId: number
  reasonCode: MemberUnlinkReason
  note: string | null
  clientRequestId: string | null
  actor: MemberLinkActor
}

export function buildMemberUnlinkStatements(input: MemberUnlinkPlanInput): MemberLinkStatement[] {
  const { accountId } = input
  return [
    guard(
      'EXISTS (SELECT 1 FROM portal_accounts WHERE id = @accountId AND link_version = @version AND contact_id = @fromCustomerId)',
      { accountId, version: input.expectedLinkVersion, fromCustomerId: input.fromCustomerId },
      'member_link_stale',
    ),
    {
      sql: 'UPDATE portal_accounts SET contact_id = NULL, link_version = link_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = @accountId AND link_version = @version',
      params: { accountId, version: input.expectedLinkVersion },
    },
    eventInsert({
      accountId,
      action: 'unlink',
      fromCustomerId: input.fromCustomerId,
      toCustomerId: null,
      reasonCode: input.reasonCode,
      note: input.note,
      clientRequestId: input.clientRequestId,
      actor: input.actor,
    }),
    revokeSessions(accountId),
  ]
}

// ---------------------------------------------------------------------------
// Revert (the app's Undo = a compensating record, owner 30 Sep). Each target
// is one event to compensate: the member must still be exactly where that
// event left them (link_version_after unchanged, same customer), and the
// customer it restores must be a live profile no other member holds. A Move
// is reverted as one group, both halves at once.
export type MemberRevertTarget = {
  accountId: number
  eventId: number
  linkVersionAfter: number
  // Where the event left the member (its to_customer_id) ...
  currentCustomerId: number | null
  // ... and where it found them (its from_customer_id), restored now.
  restoreCustomerId: number | null
}

// A revert that puts a member back on a customer re-creates a link, so it
// carries the same evidence a link does (checked by the route with
// checkMemberLinkEvidence) and records it on the revert event. A revert that
// only takes a link away needs none. A closed member is never touched.
export function buildMemberRevertStatements(input: {
  targets: MemberRevertTarget[]
  groupId: string | null
  note: string | null
  clientRequestId: string | null
  actor: MemberLinkActor
  evidence?: MemberLinkEvidence | null
}): MemberLinkStatement[] {
  const { targets } = input
  if (!targets.length) throw new Error('member_link_revert_empty')
  if (targets.some((target) => target.restoreCustomerId != null) && !input.evidence) {
    throw new Error('member_link_revert_evidence_required')
  }
  const statements: MemberLinkStatement[] = []
  const targetParams: Record<string, unknown> = {}
  const targetList = targets.map((target, index) => {
    targetParams[`t${index}`] = target.accountId
    return `@t${index}`
  }).join(', ')
  for (const target of targets) {
    statements.push(
      guard(
        "EXISTS (SELECT 1 FROM portal_accounts WHERE id = @accountId AND status <> 'closed')",
        { accountId: target.accountId },
        'member_closed',
      ),
      guard(
        'EXISTS (SELECT 1 FROM portal_accounts WHERE id = @accountId AND link_version = @version AND contact_id IS @currentCustomerId)',
        { accountId: target.accountId, version: target.linkVersionAfter, currentCustomerId: target.currentCustomerId },
        'member_link_stale',
      ),
      guard(
        'NOT EXISTS (SELECT 1 FROM portal_member_link_events WHERE reverts_event_id = @eventId)',
        { eventId: target.eventId },
        'member_link_already_reverted',
      ),
    )
    if (target.restoreCustomerId != null) {
      statements.push(
        customerProfileGuard(target.restoreCustomerId),
        // The customer must not have been linked to someone else since.
        guard(
          `NOT EXISTS (SELECT 1 FROM portal_accounts WHERE contact_id = @customerId AND id NOT IN (${targetList}))`,
          { ...targetParams, customerId: target.restoreCustomerId },
          'member_link_stale',
        ),
      )
    }
  }
  // Free every customer first (the one-member-per-customer index is checked
  // per statement), then put each member where its event found it.
  statements.push({
    sql: `UPDATE portal_accounts SET contact_id = NULL WHERE id IN (${targetList}) AND contact_id IS NOT NULL`,
    params: { ...targetParams },
  })
  for (const target of targets) {
    statements.push(
      {
        sql: 'UPDATE portal_accounts SET contact_id = @customerId, link_version = link_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = @accountId',
        params: { customerId: target.restoreCustomerId, accountId: target.accountId },
      },
      eventInsert({
        accountId: target.accountId,
        action: 'revert',
        fromCustomerId: target.currentCustomerId,
        toCustomerId: target.restoreCustomerId,
        evidence: target.restoreCustomerId != null ? input.evidence ?? null : null,
        note: input.note,
        groupId: input.groupId,
        revertsEventId: target.eventId,
        clientRequestId: input.clientRequestId,
        actor: input.actor,
      }),
    )
    if (target.currentCustomerId != null) statements.push(revokeSessions(target.accountId))
  }
  return statements
}

// ---------------------------------------------------------------------------
// Suggestions (design §4.5). Computed from the member's own data only:
//   Strong    canonical phone equal (primary or a Contact Option phone) AND
//             normalised name equal -- the project's phone + name rule;
//   Possible  phone equal, name different (families share phones), or
//             email equal (never Strong);
//   none      a name-only match is never suggested.
// Never auto-linked, never pre-selected: the shape has no selection field.
export type MemberSuggestionStrength = 'strong' | 'possible'
export type MemberSuggestionBasis = 'phone' | 'name' | 'email'
export type MemberSuggestion = {
  customerId: number
  name: string
  membershipNumber: string | null
  phone: string | null
  strength: MemberSuggestionStrength
  basis: MemberSuggestionBasis[]
  // Another member already linked to this customer: linking here is a Move.
  linkedMemberId: number | null
}
export const MEMBER_SUGGESTION_KEYS: readonly (keyof MemberSuggestion)[] = ['customerId', 'name', 'membershipNumber', 'phone', 'strength', 'basis', 'linkedMemberId']
export const MEMBER_SUGGESTION_LIMIT = 5

export type MemberSuggestionCandidate = {
  id: number
  name: string | null
  phone: string | null
  address: string | null
  email: string | null
  membership_number: string | null
  is_anonymous?: number | null
}

export function normalizeMemberEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function classifyMemberSuggestions(
  member: { id: number; phone: string | null; name: string | null; email: string | null },
  candidates: MemberSuggestionCandidate[],
  linkedMemberByCustomer: Map<number, number>,
): MemberSuggestion[] {
  const phone = canonicalizePhone(member.phone)
  const name = normalizeContactName(member.name)
  const email = normalizeMemberEmail(member.email)
  const seen = new Set<number>()
  const out: MemberSuggestion[] = []
  for (const candidate of candidates) {
    const id = Number(candidate.id)
    if (seen.has(id) || Number(candidate.is_anonymous ?? 0) === 1) continue
    seen.add(id)
    const phoneMatch = Boolean(phone) && collectContactPhones(candidate).includes(phone as string)
    const nameMatch = Boolean(name) && normalizeContactName(candidate.name) === name
    const emailMatch = Boolean(email) && normalizeMemberEmail(candidate.email) === email
    let strength: MemberSuggestionStrength | null = null
    if (phoneMatch && nameMatch) strength = 'strong'
    else if (phoneMatch || emailMatch) strength = 'possible'
    if (!strength) continue
    const basis: MemberSuggestionBasis[] = []
    if (phoneMatch) basis.push('phone')
    if (phoneMatch && nameMatch) basis.push('name')
    if (emailMatch) basis.push('email')
    const holder = linkedMemberByCustomer.get(id)
    out.push({
      customerId: id,
      name: String(candidate.name ?? ''),
      membershipNumber: candidate.membership_number ? String(candidate.membership_number) : null,
      phone: candidate.phone ? String(candidate.phone) : null,
      strength,
      basis,
      linkedMemberId: holder != null && holder !== member.id ? holder : null,
    })
  }
  out.sort((a, b) => (a.strength === b.strength ? a.customerId - b.customerId : a.strength === 'strong' ? -1 : 1))
  return out.slice(0, MEMBER_SUGGESTION_LIMIT)
}

// ---------------------------------------------------------------------------
// Staff list: status chip and conflicts (design §4.3, §4.5).
export type MemberChip = 'closed' | 'suspended' | 'linked' | 'verified' | 'unverified'

// Phase 1 has no verified sign-in methods yet, so `verified` stays false.
export function memberChip(row: { status: string; contact_id: number | null; verified?: boolean }): MemberChip {
  if (row.status === 'closed') return 'closed'
  if (row.status === 'suspended') return 'suspended'
  if (row.contact_id != null) return 'linked'
  return row.verified ? 'verified' : 'unverified'
}

// A member linked to a customer that was later deleted or made anonymous.
// (A merge re-points or unlinks the member itself, see lib/contactMerge.ts.)
export const MEMBER_CONFLICT_CUSTOMER_UNAVAILABLE_SQL = `(a.contact_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM customers cu WHERE cu.id = a.contact_id AND ${customerIsProfileSql('cu')}))`
// An unlinked member whose phone is a customer's primary phone, and that
// customer is already linked to another member: only one can be linked.
export const MEMBER_CONFLICT_PHONE_TAKEN_SQL = `(a.contact_id IS NULL AND a.phone IS NOT NULL AND EXISTS (
  SELECT 1 FROM customers cp JOIN portal_accounts other ON other.contact_id = cp.id
  WHERE cp.phone_normalized = a.phone AND other.id <> a.id))`

export type MemberConflict = 'customer_unavailable' | 'phone_customer_taken'

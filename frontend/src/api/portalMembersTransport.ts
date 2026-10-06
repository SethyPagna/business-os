import { apiFetch } from './http.ts'
import { appendQuery, buildQueryString } from './query.ts'
import { createClientRequestId } from './requestIds.ts'

// Contacts > Members (G38 phase 1): the staff side of website members.
// Contract: Records/Lanes/2026-10-05/G38-P1-BACKEND-REPORT.md "§API", served by
// cloudflare/src/routes/portalMembers.ts. Every route needs the
// `portal_member_links` permission, and the list URL has NO trailing slash
// (`/api/portal-members/` is a 404).
//
// Kept out of methods.ts on purpose: this file rides its own chunk
// ('portal-members-api', vite.config.ts), because anything left to the
// '/src/api/' catch-all lands in app-api-methods, which the public storefront
// loads at boot.

export type MemberStatus = 'active' | 'suspended' | 'closed'
// 'verified' is produced once the Telegram lane lands; render whatever the API sends.
export type MemberChip = 'linked' | 'unverified' | 'verified' | 'suspended' | 'closed'
export type MemberFilter = 'all' | 'unlinked' | 'linked' | 'requests' | 'conflicts' | 'suspended' | 'legacy_claims'
export type MemberConflict = 'customer_unavailable' | 'phone_customer_taken'
export type MemberEvidence = 'in_person' | 'called_number_on_file' | 'owner_override'
export type MemberUnlinkReason = 'wrong_person' | 'customer_request' | 'duplicate' | 'other'
export type MemberHistoryAction =
  | 'link' | 'unlink' | 'relink' | 'revert' | 'merge_repoint' | 'merge_unlink' | 'legacy_import'

export interface MemberCustomerRef {
  id: number
  name: string | null
  membershipNumber: string | null
  available?: boolean
}

export interface StaffMember {
  id: number
  memberCode: string | null
  legacyMembershipId: string | null
  name: string
  phone: string | null
  email: string | null
  status: MemberStatus
  chip: MemberChip
  linkVersion: number
  customer: MemberCustomerRef | null
  /** false when the caller lacks Contacts view: customer, LC, conflicts and provenance are withheld. */
  customerVisible: boolean
  createdFromSignup: boolean | null
  legacyClaim: boolean | null
  createdAt: string | null
  lastSeenAt: string | null
  closedAt: string | null
  pendingRequest: { id: number; note: string | null; createdAt: string | null } | null
  conflicts: MemberConflict[]
}

export interface MemberList {
  items: StaffMember[]
  total: number
  limit: number
  offset: number
  filter: MemberFilter
}

export interface MemberLinkRequest {
  id: number
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  note: string | null
  createdAt: string | null
  decidedByName: string | null
  decidedAt: string | null
  decidedNote: string | null
  member: StaffMember
}

export interface MemberHistoryEvent {
  id: number
  action: MemberHistoryAction
  fromCustomer: MemberCustomerRef | null
  toCustomer: MemberCustomerRef | null
  evidence: MemberEvidence | 'system' | null
  reasonCode: string | null
  note: string | null
  matchBasis: { strength: 'strong' | 'possible' | null; basis: string[] } | null
  groupId: string | null
  revertsEventId: number | null
  linkRequestId: number | null
  linkVersionAfter: number
  actorName: string | null
  createdAt: string
  revertible: boolean
}

export interface MemberHistory {
  linkVersion: number
  customerVisible: boolean
  events: MemberHistoryEvent[]
}

export interface MemberSuggestion {
  customerId: number
  name: string
  membershipNumber: string | null
  phone: string | null
  strength: 'strong' | 'possible'
  basis: Array<'phone' | 'name' | 'email'>
  linkedMemberId: number | null
}

export interface MemberCustomerHit {
  id: number
  name: string
  membershipNumber: string | null
  phone: string | null
  linkedMember: { id: number; memberCode: string | null; name: string } | null
}

export interface MemberLinkBody {
  customerId: number
  expectedLinkVersion: number
  evidence: MemberEvidence
  checkCode?: string
  note?: string
  move?: boolean
  expectedHolderLinkVersion?: number
  matchBasis?: { strength: 'strong' | 'possible'; basis: string[] }
  clientRequestId: string
  linkRequestId?: number
}

export interface MemberUnlinkBody {
  expectedLinkVersion: number
  reasonCode: MemberUnlinkReason
  note?: string
  clientRequestId: string
}

export interface MemberRevertBody {
  eventId: number
  note?: string
  evidence?: MemberEvidence
  checkCode?: string
  clientRequestId: string
}

export interface MemberResetBody {
  evidence: MemberEvidence
  note: string
}

export interface ListMembersParams {
  filter?: MemberFilter
  q?: string
  limit?: number
  offset?: number
}

const BASE = '/api/portal-members'

/** One per dialog open: a retry after an unknown outcome replays instead of writing twice. */
export const newMemberRequestId = (): string => createClientRequestId('pm')

const memberPath = (id: number | string, tail = ''): string => `${BASE}/${encodeURIComponent(String(id))}${tail}`
const post = <T>(path: string, body: unknown): Promise<T> => apiFetch('POST', path, body)

export function listMembers(params: ListMembersParams = {}): Promise<MemberList> {
  return apiFetch('GET', appendQuery(BASE, buildQueryString({
    filter: params.filter && params.filter !== 'all' ? params.filter : undefined,
    q: params.q?.trim() || undefined,
    limit: params.limit,
    offset: params.offset,
  })))
}

export async function listLinkRequests(status: MemberLinkRequest['status'] = 'pending'): Promise<MemberLinkRequest[]> {
  const body = await apiFetch('GET', appendQuery(`${BASE}/link-requests`, buildQueryString({ status })))
  return Array.isArray(body?.requests) ? body.requests : []
}

export async function getMemberHistory(id: number): Promise<MemberHistory> {
  return apiFetch('GET', memberPath(id, '/history'))
}

export async function getMemberSuggestions(id: number): Promise<MemberSuggestion[]> {
  const body = await apiFetch('GET', memberPath(id, '/suggestions'))
  return Array.isArray(body?.suggestions) ? body.suggestions : []
}

export async function searchMemberCustomers(q: string): Promise<MemberCustomerHit[]> {
  const body = await apiFetch('GET', appendQuery(`${BASE}/customer-search`, buildQueryString({ q: q.trim() })))
  return Array.isArray(body?.customers) ? body.customers : []
}

export interface MemberWriteResult { ok: true; replayed?: boolean; member: StaffMember }

export const linkMember = (id: number, body: MemberLinkBody): Promise<MemberWriteResult> => post(memberPath(id, '/link'), body)
export const unlinkMember = (id: number, body: MemberUnlinkBody): Promise<MemberWriteResult> => post(memberPath(id, '/unlink'), body)
export const revertMemberEvent = (id: number, body: MemberRevertBody): Promise<MemberWriteResult> => post(memberPath(id, '/revert'), body)
export const suspendMember = (id: number, note?: string): Promise<MemberWriteResult> => post(memberPath(id, '/suspend'), { note: note || undefined })
export const reactivateMember = (id: number, note?: string): Promise<MemberWriteResult> => post(memberPath(id, '/reactivate'), { note: note || undefined })
export const resetMemberPassword = (id: number, body: MemberResetBody): Promise<{ ok: true; temporaryPassword: string }> => post(memberPath(id, '/reset-password'), body)
export const rejectLinkRequest = (requestId: number, note?: string): Promise<{ ok: true }> => post(`${BASE}/link-requests/${encodeURIComponent(String(requestId))}/reject`, { note: note || undefined })

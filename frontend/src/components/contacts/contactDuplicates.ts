import { apiFetch, route } from '../../api/http.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { dispatchResolvedSyncError, type SyncProblemReference } from '../../utils/syncProblemLifecycle.ts'

// Frontend transport for the live/whole-table duplicate-detection endpoints
// added to routes/contacts.ts (see cloudflare/src/lib/contactDuplicates.ts
// for the shared severity rules this mirrors). Deliberately NOT routed
// through api/http.ts's route()/cache layer the way other contact reads
// are (contactReadTransport.ts) -- a live-typing duplicate check needs the
// current server answer every call, not a stale-while-revalidate cache hit
// from a moment ago, and a failed check should just mean "no flag shown
// yet" rather than falling back to a stale local-DB mirror the way a real
// contact list read does.

export type ContactTableKind = 'customers' | 'suppliers' | 'delivery_contacts'

export type ContactDuplicateSeverity = 'phone_conflict' | 'exact_match' | 'name_only'

export type ContactDuplicateMatch = {
  id: number
  name: string
  phone: string | null
  membershipNumber: string | null
  matchedPhone: string | null
  severity: ContactDuplicateSeverity
  version: string
  syncProblem?: SyncProblemReference
}

export type ContactDuplicateCandidateVersion = { id: number; version: string }

export type ContactDuplicateReview = {
  candidateIds: number[]
  candidateVersions: ContactDuplicateCandidateVersion[]
  fingerprint: string
}

export type ContactDuplicateCheck = {
  matches: ContactDuplicateMatch[]
  duplicateReview: ContactDuplicateReview
  allowedActions: Array<'use_existing' | 'create_separate'>
  syncProblem?: SyncProblemReference
}

export type ContactDuplicateDecision = ContactDuplicateReview & { action: 'create_separate' }

// Per-contact "worth knowing before you act" history the /duplicates
// endpoint attaches to every cluster member (routes/contacts.ts's
// computeContactHistorySummaryMap). It's what makes "merge into the survivor"
// tangible in the panel -- the reviewer sees the sales/returns/points that
// merge will MOVE onto the keeper, which is also why a raw delete of a member
// isn't offered here (it would orphan exactly these). pointsBalance is
// customers-only.
export type ContactDuplicateEntryHistory = { pointsBalance?: number; salesCount: number; returnsCount: number }

// updated_at is the version a merge sends back as `expected` for the record.
export type ContactDuplicateClusterEntry = { id: number; name: string | null; phone: string | null; membershipNumber: string | null; updated_at?: string | null; history?: ContactDuplicateEntryHistory | null }

export type ContactDuplicateCluster = {
  type: 'phone' | 'name'
  value: string
  severity: ContactDuplicateSeverity
  contacts: ContactDuplicateClusterEntry[]
  // True only for a cluster returned by an includeDismissed sweep that was
  // previously "kept" (dismissed as not-a-duplicate). The panel shows these
  // under "Show kept" with a Reopen action (undismissContactDuplicateCluster)
  // so keeping a conflict is never a one-way door -- it can always be
  // reopened and resolved.
  dismissed?: boolean
}

const TABLE_ENDPOINT: Record<ContactTableKind, string> = {
  customers: '/api/customers',
  suppliers: '/api/suppliers',
  delivery_contacts: '/api/delivery-contacts',
}

function appendQuery(path: string, params: Record<string, string | string[]>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) if (item) query.append(key, item)
    } else if (value) query.set(key, value)
  }
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

// Debounced live-typing check (useContactDuplicateFlag.ts). Fails soft --
// a network error just means no flag shows yet, since the real block/allow
// decision always happens again server-side on save regardless (see
// routes/contacts.ts's checkContactDuplicateBlock).
export async function checkContactDuplicate(
  table: ContactTableKind,
  subject: { name: string; phones: string[]; excludeId?: number | string | null },
): Promise<ContactDuplicateCheck> {
  const empty = (): ContactDuplicateCheck => ({
    matches: [],
    duplicateReview: { candidateIds: [], candidateVersions: [], fingerprint: 'v1|' },
    allowedActions: [],
  })
  const phones = [...new Set(subject.phones.map((phone) => phone.trim()).filter(Boolean))].slice(0, 4)
  if (!subject.name.trim() && !phones.length) return empty()
  try {
    const path = appendQuery(`${TABLE_ENDPOINT[table]}/check-duplicate`, {
      name: subject.name,
      phone: phones,
      excludeId: subject.excludeId != null ? String(subject.excludeId) : '',
    })
    const result = await apiFetch('GET', path)
    return normalizeContactDuplicateCheck(result) || empty()
  } catch {
    return empty()
  }
}

export function normalizeContactDuplicateCheck(value: unknown): ContactDuplicateCheck | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const reviewInput = input.duplicateReview
  if (!Array.isArray(input.matches) || !reviewInput || typeof reviewInput !== 'object' || Array.isArray(reviewInput)) return null
  const review = reviewInput as Record<string, unknown>
  if (!Array.isArray(review.candidateIds) || !Array.isArray(review.candidateVersions) || typeof review.fingerprint !== 'string') return null
  const candidateIds = review.candidateIds.map(Number)
  const candidateVersions = review.candidateVersions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const row = entry as Record<string, unknown>
    return { id: Number(row.id), version: String(row.version || '') }
  })
  if (candidateIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || candidateVersions.some((entry) => !entry || !Number.isSafeInteger(entry.id) || entry.id <= 0 || !entry.version)) return null
  const allowedActions = Array.isArray(input.allowedActions)
    ? input.allowedActions.filter((action): action is 'use_existing' | 'create_separate' => action === 'use_existing' || action === 'create_separate')
    : []
  return {
    matches: input.matches as ContactDuplicateMatch[],
    duplicateReview: { candidateIds, candidateVersions: candidateVersions as ContactDuplicateCandidateVersion[], fingerprint: review.fingerprint },
    allowedActions,
  }
}

export function readContactDuplicateDecisionError(error: unknown): ContactDuplicateCheck | null {
  const input = error as Record<string, unknown> | null
  const code = input?.code
  if (code !== 'contact_duplicate_decision_required'
    && code !== 'possible_duplicate'
    && code !== 'phone_conflict'
    && code !== 'contact_duplicate_candidates_changed') return null
  const check = normalizeContactDuplicateCheck(input)
    || normalizeContactDuplicateCheck(input?.duplicate)
  if (!check) return null
  const syncProblem = typeof input?.syncErrorId === 'string'
    ? {
        errorId: input.syncErrorId,
        channel: typeof input.syncErrorChannel === 'string' ? input.syncErrorChannel : null,
        code: typeof input.code === 'string' ? input.code : null,
      }
    : null
  return syncProblem
    ? { ...check, syncProblem, matches: check.matches.map((match) => ({ ...match, syncProblem })) }
    : check
}

export function resolveContactDuplicateSyncError(value: ContactDuplicateCheck | ContactDuplicateMatch | null | undefined): boolean {
  return dispatchResolvedSyncError(value?.syncProblem)
}

export function createSeparateContactDecision(check: ContactDuplicateCheck): ContactDuplicateDecision | null {
  if (!check.allowedActions.includes('create_separate')) return null
  return { action: 'create_separate', ...check.duplicateReview }
}

// Whole-table sweep for an admin "Possible Duplicates" review panel. Pass
// includeDismissed to also bring back already-kept clusters (flagged
// `dismissed:true`) for the "Show kept" view, where they can be reopened.
export async function getContactDuplicateClusters(
  table: ContactTableKind,
  opts: { includeDismissed?: boolean } = {},
): Promise<ContactDuplicateCluster[]> {
  try {
    const path = opts.includeDismissed
      ? `${TABLE_ENDPOINT[table]}/duplicates?includeDismissed=1`
      : `${TABLE_ENDPOINT[table]}/duplicates`
    const result = await apiFetch('GET', path)
    return Array.isArray(result?.clusters) ? result.clusters : []
  } catch {
    return []
  }
}

// Persists a "reviewed, not actually a duplicate" decision for one cluster
// server-side (routes/contacts.ts's POST .../duplicates/dismiss, backed by
// migrations/0034_contact_duplicate_dismissals.sql -- see lib/
// contactDuplicates.ts's dismissDuplicateCluster). Unlike checkContactDuplicate/
// getContactDuplicateClusters above, this is a real write DuplicatesTab.tsx
// needs to know actually succeeded (it removes the cluster from view on
// success, not on every call), so it goes through route()'s normal
// write-fails-closed handling instead of failing soft into an empty result.
export async function dismissContactDuplicateCluster(
  table: ContactTableKind,
  cluster: { type: 'phone' | 'name'; value: string },
): Promise<void> {
  await route(
    `contactDuplicates:${table}:dismiss`,
    () => apiFetch('POST', `${TABLE_ENDPOINT[table]}/duplicates/dismiss`, { type: cluster.type, value: cluster.value }),
    null,
    true,
  )
}

// Reopens a previously-kept (dismissed) cluster: the inverse of
// dismissContactDuplicateCluster (routes/contacts.ts's POST
// .../duplicates/undismiss). Drops the dismissal marker so the cluster
// returns to the open review queue and can be merged/resolved -- keeping a
// conflict is always reversible, never a one-way hide. A real write the panel
// needs confirmed (it moves the cluster from the kept list back to open on
// success), so it goes through route() like dismiss does.
export async function undismissContactDuplicateCluster(
  table: ContactTableKind,
  cluster: { type: 'phone' | 'name'; value: string },
): Promise<void> {
  await route(
    `contactDuplicates:${table}:undismiss`,
    () => apiFetch('POST', `${TABLE_ENDPOINT[table]}/duplicates/undismiss`, { type: cluster.type, value: cluster.value }),
    null,
    true,
  )
}

// The records the Resolve grid shows, read fresh (GET {path}?ids=), so the
// updated_at it sends back as `expected` is the one the reviewer saw. The
// walk-in customer is never returned; a missing id reads as "cannot merge".
export async function readContactRecords(
  table: ContactTableKind,
  ids: number[],
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  const wanted = new Set(ids.slice(0, 50))
  if (!wanted.size) return []
  const result = await apiFetch('GET', `${TABLE_ENDPOINT[table]}?ids=${[...wanted].join(',')}`, undefined, undefined, { signal })
  return Array.isArray(result)
    ? result.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && wanted.has(Number(row.id)))
    : []
}

// ---- Merge (routes/contacts.ts POST {path}/merge) -------------------------
// One request merges up to six records into the kept one in one atomic batch,
// with the reviewer's field choices, the membership number and storefront
// account that stay, and the updated_at each record had when it was read (a
// record changed since then is a 409 naming it). On the free plan a group too
// large for one request's query budget merges part now and the answer carries
// the request that merges the rest; mergeContacts follows those to the end, so
// a caller makes ONE call per group, never one per record.

export const CONTACT_MERGE_MAX_RECORDS = 6

export type ContactMergeChoice = { source_id: number } | { custom: string | null }

export type ContactMergeRequest = {
  keepId: number
  mergeIds: number[]
  /** A retry with the same id is answered from the first attempt's audit row. */
  client_request_id: string
  expected: Array<{ id: number; updated_at: string | null }>
  choices?: Record<string, ContactMergeChoice>
  membership_source_id?: number
  portal_keep_contact_id?: number
}

export type ContactMergePortalAccount = { id: number; contact_id: number | null; membership_id: string | null; name: string | null }

export type ContactMergeOutcome = {
  /** The kept record as the server stored it. */
  keeper: Record<string, unknown> | null
  merged: Array<{ id: number; name: string | null }>
  /** Storefront accounts left without a contact; they can still sign in. */
  unlinkedAccounts: ContactMergePortalAccount[]
  /** Membership numbers written into the kept record's notes. */
  membershipToNotes: string[]
  /** While records remain: the request that merges them. */
  pending: ContactMergeRequest | null
}

// Refusals the caller answers itself (the Resolve grid reads the records
// again or shows the refusal; bulk merge counts them), so the global write
// banner is cleared. contact_merge_not_duplicates: owner ruling 24 Sep 2026,
// only a current system-detected duplicate group merges (Worker-enforced).
const HANDLED_MERGE_CODES = new Set(['contact_merge_conflict', 'contact_merge_not_duplicates', 'membership_choice_required', 'portal_choice_required', 'anonymous_customer_immutable'])

type ContactMergeResponse = {
  keeper?: unknown
  merged_ids?: unknown
  after?: { merged_ids?: unknown; merged_names?: unknown; portal_accounts?: unknown; membership_to_notes?: unknown } | null
  remaining_merge_ids?: unknown
  continuation?: ContactMergeRequest | null
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

async function sendContactMerge(table: ContactTableKind, body: ContactMergeRequest): Promise<ContactMergeResponse> {
  try {
    return (await route(`contactDuplicates:${table}:merge`, () => apiFetch('POST', `${TABLE_ENDPOINT[table]}/merge`, body), null, true)) || {}
  } catch (error) {
    const problem = error as { code?: unknown; syncErrorId?: unknown; syncErrorChannel?: unknown } | null
    if (typeof problem?.code === 'string' && HANDLED_MERGE_CODES.has(problem.code)) {
      dispatchResolvedSyncError({ errorId: String(problem.syncErrorId ?? ''), channel: String(problem.syncErrorChannel ?? ''), code: problem.code })
    }
    throw error
  }
}

function absorbMergeStep(outcome: ContactMergeOutcome, response: ContactMergeResponse): void {
  if (response.keeper && typeof response.keeper === 'object') outcome.keeper = response.keeper as Record<string, unknown>
  const after = response.after && typeof response.after === 'object' ? response.after : {}
  const names = listOf(after.merged_names)
  listOf(after.merged_ids ?? response.merged_ids).forEach((value, index) => {
    const id = Number(value)
    if (Number.isSafeInteger(id) && id > 0 && !outcome.merged.some((entry) => entry.id === id)) {
      outcome.merged.push({ id, name: names[index] == null ? null : String(names[index]) })
    }
  })
  for (const value of listOf(after.portal_accounts)) {
    const account = value as Record<string, unknown> | null
    const id = Number(account?.id)
    if (!account || account.contact_id != null || !Number.isSafeInteger(id) || outcome.unlinkedAccounts.some((entry) => entry.id === id)) continue
    outcome.unlinkedAccounts.push({ id, contact_id: null, membership_id: account.membership_id == null ? null : String(account.membership_id), name: account.name == null ? null : String(account.name) })
  }
  for (const value of listOf(after.membership_to_notes)) {
    const number = String(value ?? '').trim()
    if (number && !outcome.membershipToNotes.includes(number)) outcome.membershipToNotes.push(number)
  }
}

const copyOutcome = (outcome: ContactMergeOutcome): ContactMergeOutcome => ({
  ...outcome,
  merged: [...outcome.merged],
  unlinkedAccounts: [...outcome.unlinkedAccounts],
  membershipToNotes: [...outcome.membershipToNotes],
})

/**
 * Merges request.mergeIds into request.keepId. `onStep` reports the running
 * outcome after every answered step; pass the last one back as `earlier` to
 * resume from the step that failed, which the server then answers from its
 * own audit row when that step had already committed.
 */
export async function mergeContacts(
  table: ContactTableKind,
  request: ContactMergeRequest,
  onStep?: (progress: ContactMergeOutcome) => void,
  earlier?: ContactMergeOutcome | null,
): Promise<ContactMergeOutcome> {
  const outcome = copyOutcome(earlier ?? { keeper: null, merged: [], unlinkedAccounts: [], membershipToNotes: [], pending: request })
  // Every step merges at least one record, so a group ends within one step per record.
  for (let step = 0; outcome.pending && step < CONTACT_MERGE_MAX_RECORDS; step += 1) {
    const response = await sendContactMerge(table, outcome.pending)
    absorbMergeStep(outcome, response)
    outcome.pending = listOf(response.remaining_merge_ids).length && response.continuation ? response.continuation : null
    onStep?.(copyOutcome(outcome))
  }
  if (outcome.pending) throw new Error('The merge stopped before every record was merged. Refresh the review and try again.')
  return outcome
}

// ---- Bulk merge planning (pure) ----------------------------------------
// P3-9. The Conflicts tab's Bulk Merge used to run only on clusters of
// EXACTLY two records and silently skip everything bigger, on the reasoning
// that a 3+-way cluster needs a human to pick the survivor. That reasoning
// did not survive contact with the data the hidden `ensureSupplierExists()`
// writer left behind: production carries a "j secrat" cluster of ten rows and
// a "lang" cluster of six, all created by the same accident, all identical
// apart from their ids. Those are exactly the clusters Bulk Merge exists for,
// and they were the only ones it refused.
//
// So the plan is computed for a cluster of ANY size, by a rule that is stated
// rather than guessed at, and it is pure so it can be tested without a server.
// One merge request carries at most six records, so a bigger cluster merges
// its first five others now and the rest on the next Bulk Merge (the cluster
// is still listed until then).

export type BulkContactMergePlan = {
  cluster: ContactDuplicateCluster
  keeperId: number
  /** Merged into the keeper by ONE mergeContacts() call, in id order. */
  loserIds: number[]
  /** Past the six-record limit: left for the next run. */
  laterIds: number[]
}

/**
 * Which record of a cluster survives, in priority order:
 *
 *   1. The one member that carries a phone number, when exactly one does. A
 *      duplicate minted by a hidden writer has no phone (nothing typed one),
 *      so the row that has one is the contact somebody actually created.
 *   2. Otherwise the lowest id -- created first, so the most history already
 *      points at it and the merge moves the least.
 *
 * Returns null for a cluster with nothing to merge.
 */
export function chooseBulkMergeKeeper(contacts: ContactDuplicateClusterEntry[]): ContactDuplicateClusterEntry | null {
  if (!Array.isArray(contacts) || contacts.length < 2) return null
  const byId = [...contacts].sort((a, b) => a.id - b.id)
  const withPhone = byId.filter((contact) => String(contact.phone || '').trim() !== '')
  return withPhone.length === 1 ? withPhone[0] : byId[0]
}

/** One plan per mergeable cluster; clusters with nothing to merge are dropped. */
export function planBulkContactMerges(clusters: ContactDuplicateCluster[]): BulkContactMergePlan[] {
  const plans: BulkContactMergePlan[] = []
  for (const cluster of clusters || []) {
    const keeper = chooseBulkMergeKeeper(cluster?.contacts || [])
    if (!keeper) continue
    const others = [...cluster.contacts].sort((a, b) => a.id - b.id).filter((contact) => contact.id !== keeper.id).map((contact) => contact.id)
    plans.push({
      cluster,
      keeperId: keeper.id,
      loserIds: others.slice(0, CONTACT_MERGE_MAX_RECORDS - 1),
      laterIds: others.slice(CONTACT_MERGE_MAX_RECORDS - 1),
    })
  }
  return plans
}

/**
 * The request that merges `mergeIds` into `keeperId` as the list read them.
 * Nobody chose field values here, so every field keeps the kept record's value
 * (else the first non-blank one). The server merges only a current
 * system-detected duplicate group (owner ruling 24 Sep 2026); no request can
 * skip that check. Two membership numbers or two
 * storefront accounts need a person: the server answers
 * membership_choice_required / portal_choice_required.
 */
export function contactMergeRequest(cluster: ContactDuplicateCluster, keeperId: number, mergeIds: number[]): ContactMergeRequest {
  const versions = new Map(cluster.contacts.map((contact) => [contact.id, contact.updated_at ?? null]))
  return {
    keepId: keeperId,
    mergeIds,
    client_request_id: createClientRequestId('contact_merge'),
    expected: [keeperId, ...mergeIds].map((id) => ({ id, updated_at: versions.get(id) ?? null })),
  }
}

// ---- Sale-link conflicts (the Conflicts tab's fourth section) ----------
// Sales whose customer link disagrees with the phone printed on the sale,
// and sales naming a customer that has no contact record at all (see
// routes/contacts.ts GET /customers/link-conflicts). Same no-cache
// rationale as the duplicate sweeps above: this is a live review list.

export type SaleLinkMismatch = {
  customer_id: number
  customer_name: string | null
  customer_phone: string | null
  sale_phone: string
  phone_key: string
  sale_name: string | null
  sale_count: number
  first_at: string
  last_at: string
  total_usd: number
  phone_owner_count: number
  suggested_id: number | null
  suggested_name: string | null
  suggested_phone: string | null
  // 1 when this group was previously kept-as-is (dismissed) and only surfaced
  // because the section asked to include kept groups -- shows a Reopen action.
  dismissed?: number
}

export type SaleLinkMissing = {
  name: string
  phone: string
  phone_key: string
  sale_count: number
  first_at: string
  last_at: string
  total_usd: number
  phone_owner_count: number
  suggested_id: number | null
  suggested_name: string | null
  suggested_phone: string | null
  dismissed?: number
}

export type SaleLinkConflictPage = { page: number; total: number; totalPages: number }
export type SaleLinkConflicts = {
  mismatches: SaleLinkMismatch[]
  missing: SaleLinkMissing[]
  pagination?: {
    pageSize: number
    mismatches: SaleLinkConflictPage
    missing: SaleLinkConflictPage
  }
}

export async function getSaleLinkConflicts(opts: {
  includeDismissed?: boolean
  mismatchPage?: number
  missingPage?: number
  pageSize?: number
} = {}): Promise<SaleLinkConflicts> {
  const params = new URLSearchParams()
  if (opts.includeDismissed) params.set('includeDismissed', '1')
  if (opts.mismatchPage) params.set('mismatchPage', String(opts.mismatchPage))
  if (opts.missingPage) params.set('missingPage', String(opts.missingPage))
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize))
  const query = params.toString()
  const path = `/api/customers/link-conflicts${query ? `?${query}` : ''}`
  const result = await apiFetch('GET', path) as Partial<SaleLinkConflicts> | null
  return {
    mismatches: Array.isArray(result?.mismatches) ? result!.mismatches! : [],
    missing: Array.isArray(result?.missing) ? result!.missing! : [],
    pagination: result?.pagination,
  }
}

export async function relinkConflictSales(payload: { customer_id: number; phone_key: string; target_customer_id: number }): Promise<{ relinked?: number }> {
  return await apiFetch('POST', '/api/customers/link-conflicts/relink', payload) as { relinked?: number }
}

export async function resolveMissingContact(payload: { name: string; phone: string; phone_key: string; target_customer_id?: number }): Promise<{ customer_id?: number; created?: boolean; linked?: number }> {
  return await apiFetch('POST', '/api/customers/link-conflicts/resolve-missing', payload) as { customer_id?: number; created?: boolean; linked?: number }
}

export async function dismissSaleLinkConflict(kind: 'mismatch' | 'missing', value: string): Promise<void> {
  await apiFetch('POST', '/api/customers/link-conflicts/dismiss', { kind, value })
}

// Reopen a kept-as-is sale-link conflict group (routes/contacts.ts's POST
// .../link-conflicts/undismiss) -- drops the keep marker so the group returns
// to the live sweep and can be relinked/resolved. Keeping is never a one-way
// hide.
export async function undismissSaleLinkConflict(kind: 'mismatch' | 'missing', value: string): Promise<void> {
  await apiFetch('POST', '/api/customers/link-conflicts/undismiss', { kind, value })
}

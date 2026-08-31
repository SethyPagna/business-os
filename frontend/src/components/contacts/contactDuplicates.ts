import { apiFetch, route } from '../../api/http.ts'

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
}

// Per-contact "worth knowing before you act" history the /duplicates
// endpoint attaches to every cluster member (routes/contacts.ts's
// computeContactHistorySummaryMap). It's what makes "merge into the survivor"
// tangible in the panel -- the reviewer sees the sales/returns/points that
// merge will MOVE onto the keeper, which is also why a raw delete of a member
// isn't offered here (it would orphan exactly these). pointsBalance is
// customers-only.
export type ContactDuplicateEntryHistory = { pointsBalance?: number; salesCount: number; returnsCount: number }

export type ContactDuplicateClusterEntry = { id: number; name: string | null; phone: string | null; membershipNumber: string | null; history?: ContactDuplicateEntryHistory | null }

export type ContactDuplicateCluster = {
  type: 'phone' | 'name'
  value: string
  severity: ContactDuplicateSeverity
  contacts: ContactDuplicateClusterEntry[]
}

const TABLE_ENDPOINT: Record<ContactTableKind, string> = {
  customers: '/api/customers',
  suppliers: '/api/suppliers',
  delivery_contacts: '/api/delivery-contacts',
}

function appendQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
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
  subject: { name: string; phone: string; excludeId?: number | string | null },
): Promise<ContactDuplicateMatch[]> {
  if (!subject.name.trim() && !subject.phone.trim()) return []
  try {
    const path = appendQuery(`${TABLE_ENDPOINT[table]}/check-duplicate`, {
      name: subject.name,
      phone: subject.phone,
      excludeId: subject.excludeId != null ? String(subject.excludeId) : '',
    })
    const result = await apiFetch('GET', path)
    return Array.isArray(result?.matches) ? result.matches : []
  } catch {
    return []
  }
}

// Whole-table sweep for an admin "Possible Duplicates" review panel.
export async function getContactDuplicateClusters(table: ContactTableKind): Promise<ContactDuplicateCluster[]> {
  try {
    const result = await apiFetch('GET', `${TABLE_ENDPOINT[table]}/duplicates`)
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

// Merges `mergeId` into `keepId` (routes/contacts.ts's POST .../merge) --
// every historical reference to mergeId is repointed at keepId, any field
// left blank on the keeper is backfilled from the merged record, and the
// merged row is then deleted. Resolves with the refreshed keeper record.
export async function mergeContacts(
  table: ContactTableKind,
  keepId: number | string,
  mergeId: number | string,
): Promise<unknown> {
  return route(
    `contactDuplicates:${table}:merge`,
    () => apiFetch('POST', `${TABLE_ENDPOINT[table]}/merge`, { keepId, mergeId }),
    null,
    true,
  )
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
}

export type SaleLinkConflicts = { mismatches: SaleLinkMismatch[]; missing: SaleLinkMissing[] }

export async function getSaleLinkConflicts(): Promise<SaleLinkConflicts> {
  const result = await apiFetch('GET', '/api/customers/link-conflicts') as Partial<SaleLinkConflicts> | null
  return {
    mismatches: Array.isArray(result?.mismatches) ? result!.mismatches! : [],
    missing: Array.isArray(result?.missing) ? result!.missing! : [],
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

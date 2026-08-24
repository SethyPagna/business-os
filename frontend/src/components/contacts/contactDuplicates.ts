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

export type ContactDuplicateClusterEntry = { id: number; name: string | null; phone: string | null; membershipNumber: string | null }

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

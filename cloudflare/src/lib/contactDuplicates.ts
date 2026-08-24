import type { D1Compat } from './db'
import { parseStoredContactOptions, type ContactOptionMode } from './contactOptions'

// Duplicate detection for customers/suppliers/delivery_contacts, backing
// the rule these three tables now share: name, phone, and (customers
// only) membership_number should each identify one real contact -- a
// contact CAN carry multiple phone numbers (its primary `phone` column
// plus up to CONTACT_OPTION_LIMIT secondary phones on its Contact Options,
// see contactOptions.ts), but any single phone value may only ever belong
// to one contact record. membership_number uniqueness already lives in
// routes/contacts.ts (generateMembershipNumber/its POST+PUT checks) --
// this file is the phone/name half.
//
// Three severities, worst first:
//  - phone_conflict: the hard violation this feature exists to catch --
//    a phone already belongs to a DIFFERENTLY-named contact. Always
//    blocking.
//  - exact_match: same normalized name AND a shared phone -- almost
//    certainly the same real-world contact being entered a second time.
//    Blocking unless the caller explicitly confirms (see routes/
//    contacts.ts's `confirmDuplicate` body flag).
//  - name_only: same normalized name, no phone overlap -- could genuinely
//    be two different people who happen to share a name (common with
//    Khmer given names in particular). Never blocking, flagged for a
//    human glance only.

export type ContactDuplicateSeverity = 'phone_conflict' | 'exact_match' | 'name_only'

export type ContactDuplicateMatch = {
  id: number
  name: string
  phone: string | null
  membershipNumber: string | null
  matchedPhone: string | null
  severity: ContactDuplicateSeverity
}

export type ContactDuplicateCandidateRow = {
  id: number
  name: string | null
  phone: string | null
  address: string | null
  membership_number?: string | null
}

export type ContactDuplicateTable = 'customers' | 'suppliers' | 'delivery_contacts'

export function normalizeContactName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Phones are compared on digits (+ leading +) only, so "012 345 678",
// "012-345-678", and "(012) 345 678" all normalize to the same key -- the
// same formatting tolerance classifyContacts() already relies on for CSV-
// import phone matching (see importEngine.ts).
export function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/[^\d+]/g, '')
  return digits || null
}

// Every phone number a contact record actually carries: its primary
// `phone` column plus any secondary phone entered on one of its Contact
// Options (serialized into the `address` column -- see contactOptions.ts;
// `mode` only changes which value field an option itself uses, options
// always keep their own `phone` field either way).
export function collectContactPhones(row: { phone?: unknown; address?: unknown }, mode: ContactOptionMode = 'address'): string[] {
  const phones = new Set<string>()
  const primary = normalizePhone(row.phone)
  if (primary) phones.add(primary)
  for (const option of parseStoredContactOptions(row.address, mode)) {
    const optionPhone = normalizePhone(option.phone)
    if (optionPhone) phones.add(optionPhone)
  }
  return [...phones]
}

const SEVERITY_RANK: Record<ContactDuplicateSeverity, number> = { phone_conflict: 0, exact_match: 1, name_only: 2 }

// Pure classification -- given the record being saved (name + every phone
// it carries, already normalized) and a pool of OTHER already-fetched
// candidate rows (caller has excluded the record's own id), decides which
// candidates are worth flagging and how severely. Kept separate from the
// DB fetch below so it's unit-testable without a database.
export function classifyContactDuplicates(
  subject: { name: string; phones: string[] },
  candidates: ContactDuplicateCandidateRow[],
  mode: ContactOptionMode = 'address',
): ContactDuplicateMatch[] {
  const subjectName = normalizeContactName(subject.name)
  const subjectPhones = new Set(subject.phones.filter(Boolean))
  const matches: ContactDuplicateMatch[] = []

  for (const candidate of candidates) {
    const candidateName = normalizeContactName(candidate.name)
    const sameName = !!subjectName && subjectName === candidateName
    const sharedPhone = collectContactPhones(candidate, mode).find((phone) => subjectPhones.has(phone)) || null
    if (!sharedPhone && !sameName) continue
    matches.push({
      id: candidate.id,
      name: candidate.name || '',
      phone: candidate.phone || null,
      membershipNumber: candidate.membership_number || null,
      matchedPhone: sharedPhone,
      severity: sharedPhone ? (sameName ? 'exact_match' : 'phone_conflict') : 'name_only',
    })
  }
  return matches.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

// DB-backed lookup for a single record being created/edited. Prefilters
// with SQL (exact name match, exact primary-phone match, or a LIKE probe
// against the serialized Contact Options column -- the same tolerance
// GET /customers's own search already relies on, see routes/contacts.ts's
// comment there on why LIKE against that JSON text is fine), then
// classifies precisely in JS so a LIKE false-positive (e.g. "123" inside
// a longer unrelated number) can never surface as a real match. Bounded
// to 50 candidates -- this is a duplicate *check*, not a report; a
// genuine name/phone collision will be in the first handful of rows.
export async function findContactDuplicates(
  db: D1Compat,
  table: ContactDuplicateTable,
  subject: { id?: number | string | null; name: string; phones: string[] },
  mode: ContactOptionMode = 'address',
): Promise<ContactDuplicateMatch[]> {
  const nameKey = normalizeContactName(subject.name)
  const phones = [...new Set(subject.phones.map(normalizePhone).filter((p): p is string => !!p))]
  if (!nameKey && !phones.length) return []

  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  if (nameKey) {
    params.nameKey = nameKey
    conditions.push(`lower(trim(name)) = @nameKey`)
  }
  phones.forEach((phone, index) => {
    params[`phone${index}`] = phone
    conditions.push(`phone = @phone${index}`)
    params[`addr${index}`] = `%${phone}%`
    conditions.push(`address LIKE @addr${index}`)
  })
  if (!conditions.length) return []

  const excludeSql = subject.id != null && subject.id !== '' ? 'AND id != @excludeId' : ''
  if (excludeSql) params.excludeId = subject.id

  const rows = await db
    .prepare(`SELECT id, name, phone, address, membership_number FROM ${table} WHERE (${conditions.join(' OR ')}) ${excludeSql} LIMIT 50`)
    .all<ContactDuplicateCandidateRow>(params)

  return classifyContactDuplicates({ name: subject.name, phones }, rows, mode)
}

export type ContactDuplicateClusterEntry = { id: number; name: string | null; phone: string | null; membershipNumber: string | null }

export type ContactDuplicateCluster = {
  type: 'phone' | 'name'
  value: string
  severity: ContactDuplicateSeverity
  contacts: ContactDuplicateClusterEntry[]
}

// Persists a "reviewed, not actually a duplicate" decision for one cluster
// (see migrations/0034_contact_duplicate_dismissals.sql's own comment for
// why this is scoped to (table, cluster_type, cluster_value) rather than a
// specific pair of ids). Upserts on the table's unique index so dismissing
// the same cluster a second time (e.g. after it briefly resurfaced) just
// refreshes who/when instead of failing on the constraint.
export async function dismissDuplicateCluster(
  db: D1Compat,
  table: ContactDuplicateTable,
  type: 'phone' | 'name',
  value: string,
  reviewer: { id: number | string | null; name: string | null },
): Promise<void> {
  await db.prepare(`
    INSERT INTO contact_duplicate_dismissals (contact_table, cluster_type, cluster_value, dismissed_by_id, dismissed_by_name, dismissed_at)
    VALUES (@table, @type, @value, @dismissedById, @dismissedByName, CURRENT_TIMESTAMP)
    ON CONFLICT(contact_table, cluster_type, cluster_value) DO UPDATE SET
      dismissed_by_id = @dismissedById, dismissed_by_name = @dismissedByName, dismissed_at = CURRENT_TIMESTAMP
  `).run({ table, type, value, dismissedById: reviewer.id ?? null, dismissedByName: reviewer.name ?? null })
}

// Proactive whole-table sweep for the admin "Possible Duplicates" review
// panel -- surfaces clusters already sitting in the data (most commonly
// from records entered or imported before this feature existed) instead
// of waiting for someone to re-save a colliding record. Mirrors
// productIdentity.ts's findDuplicateProductGroups() shape/intent for the
// equivalent product-catalog sweep. Dismissed clusters (see
// dismissDuplicateCluster above) are filtered out here, server-side, so a
// dismissal holds across every device/browser instead of the old
// localStorage-only version's single-browser scope.
export async function findDuplicateContactClusters(
  db: D1Compat,
  table: ContactDuplicateTable,
  mode: ContactOptionMode = 'address',
): Promise<ContactDuplicateCluster[]> {
  const [rows, dismissalRows] = await Promise.all([
    db.prepare(`SELECT id, name, phone, address, membership_number FROM ${table} ORDER BY id ASC`).all<ContactDuplicateCandidateRow>({}),
    db.prepare(`SELECT cluster_type, cluster_value FROM contact_duplicate_dismissals WHERE contact_table = @table`).all<{ cluster_type: string; cluster_value: string }>({ table }),
  ])
  // Compared against normalized values on both sides (normalizeContactName
  // for a 'name' cluster, already-normalized digits for a 'phone' one) --
  // a dismissal stores whatever display-cased value the panel showed at
  // dismiss time (e.g. "Ly Ratha"), but the SAME two people typed as
  // "ly ratha" on a later sweep must still match the same dismissal, not
  // resurface as a "new" cluster over a casing difference.
  const dismissed = new Set(dismissalRows.map((row) => `${row.cluster_type}\u0001${row.cluster_type === 'name' ? normalizeContactName(row.cluster_value) : row.cluster_value}`))

  const byPhone = new Map<string, ContactDuplicateCandidateRow[]>()
  const byName = new Map<string, ContactDuplicateCandidateRow[]>()
  for (const row of rows) {
    for (const phone of collectContactPhones(row, mode)) {
      if (!byPhone.has(phone)) byPhone.set(phone, [])
      byPhone.get(phone)!.push(row)
    }
    const nameKey = normalizeContactName(row.name)
    if (nameKey) {
      if (!byName.has(nameKey)) byName.set(nameKey, [])
      byName.get(nameKey)!.push(row)
    }
  }

  const toEntry = (row: ContactDuplicateCandidateRow): ContactDuplicateClusterEntry => ({ id: row.id, name: row.name, phone: row.phone, membershipNumber: row.membership_number || null })

  const clusters: ContactDuplicateCluster[] = []
  for (const [phone, group] of byPhone) {
    if (dismissed.has(`phone\u0001${phone}`)) continue
    const distinct = [...new Map(group.map((row) => [row.id, row])).values()]
    if (distinct.length < 2) continue
    const names = new Set(distinct.map((row) => normalizeContactName(row.name)))
    clusters.push({ type: 'phone', value: phone, severity: names.size > 1 ? 'phone_conflict' : 'exact_match', contacts: distinct.map(toEntry) })
  }
  for (const [nameKey, group] of byName) {
    if (group.length < 2) continue
    if (dismissed.has(`name\u0001${nameKey}`)) continue
    clusters.push({ type: 'name', value: group[0].name || nameKey, severity: 'name_only', contacts: group.map(toEntry) })
  }
  // Worst-first, same ordering the single-record check uses.
  return clusters.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

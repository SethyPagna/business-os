import type { D1Compat } from './db'
import { parseStoredContactOptions, serializeContactOptions, type ContactOptionMode } from './contactOptions'
import { canonicalizePhone } from './phone'

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
  version: string
}

export type ContactDuplicateCandidateRow = {
  id: number
  name: string | null
  phone: string | null
  address: string | null
  membership_number?: string | null
  phone_normalized?: string | null
  updated_at?: string | null
}

export type ContactDuplicateTable = 'customers' | 'suppliers' | 'delivery_contacts'

export type ContactDuplicateCandidateVersion = { id: number; version: string }

export type ContactDuplicateReview = {
  candidateIds: number[]
  candidateVersions: ContactDuplicateCandidateVersion[]
  fingerprint: string
}

export type ContactDuplicateCreateSeparateDecision = ContactDuplicateReview & {
  action: 'create_separate'
}

export type ContactDuplicateGuardStatement = { sql: string; params: Record<string, unknown> }

// Only customers carry membership_number (0001's schema; suppliers/
// delivery_contacts have never had the column -- production-verified).
// Selecting it unconditionally made EVERY manual supplier and
// delivery-contact create/update 500 the moment it reached the duplicate
// check, and the DuplicatesTab sweep for those tables with it -- the
// live-typing flag hid the same failure by design (it fails soft). The
// candidate row type keeps membership_number optional, so non-customer
// rows simply carry none.
function candidateColumns(table: ContactDuplicateTable): string {
  return table === 'customers'
    ? 'id, name, phone, address, membership_number, phone_normalized, updated_at'
    : 'id, name, phone, address, updated_at'
}

function textHex(value: unknown): string {
  return [...new TextEncoder().encode(String(value ?? ''))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

function candidateVersion(row: ContactDuplicateCandidateRow, table: ContactDuplicateTable): string {
  const values = [row.name, row.phone, row.address, row.updated_at]
  if (table === 'customers') values.push(row.phone_normalized, row.membership_number)
  return values.map(textHex).join('.')
}

export function buildContactDuplicateReview(matches: ContactDuplicateMatch[]): ContactDuplicateReview {
  const candidateVersions = [...new Map(matches.map((match) => [Number(match.id), {
    id: Number(match.id),
    version: String(match.version || ''),
  }])).values()].sort((a, b) => a.id - b.id)
  return {
    candidateIds: candidateVersions.map((candidate) => candidate.id),
    candidateVersions,
    fingerprint: `v1|${candidateVersions.map((candidate) => `${candidate.id}@${candidate.version}`).join('|')}`,
  }
}

export function parseContactDuplicateCreateSeparateDecision(value: unknown): ContactDuplicateCreateSeparateDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (input.action !== 'create_separate' || !Array.isArray(input.candidateIds) || !Array.isArray(input.candidateVersions)) return null
  const candidateIds = input.candidateIds.map(Number)
  const candidateVersions = input.candidateVersions.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const row = entry as Record<string, unknown>
    const id = Number(row.id)
    const version = typeof row.version === 'string' ? row.version : ''
    return Number.isSafeInteger(id) && id > 0 && version ? { id, version } : null
  })
  if (candidateIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    || candidateVersions.some((entry) => !entry)
    || typeof input.fingerprint !== 'string') return null
  const decision: ContactDuplicateCreateSeparateDecision = {
    action: 'create_separate',
    candidateIds,
    candidateVersions: candidateVersions as ContactDuplicateCandidateVersion[],
    fingerprint: input.fingerprint,
  }
  const normalized = buildContactDuplicateReview(decision.candidateVersions.map((entry) => ({
    id: entry.id,
    name: '',
    phone: null,
    membershipNumber: null,
    matchedPhone: null,
    severity: 'name_only',
    version: entry.version,
  })))
  return JSON.stringify(candidateIds) === JSON.stringify(normalized.candidateIds)
    && decision.fingerprint === normalized.fingerprint
    ? decision
    : null
}

export function contactDuplicateDecisionMatches(
  review: ContactDuplicateReview,
  decision: ContactDuplicateCreateSeparateDecision | null,
): boolean {
  return Boolean(decision
    && decision.fingerprint === review.fingerprint
    && JSON.stringify(decision.candidateIds) === JSON.stringify(review.candidateIds)
    && JSON.stringify(decision.candidateVersions) === JSON.stringify(review.candidateVersions))
}

function phoneDigitsSql(column: string): string {
  return `replace(replace(replace(replace(replace(replace(replace(COALESCE(${column}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', ''), '/', '')`
}

function canonicalPhoneSql(column: string): string {
  const digits = phoneDigitsSql(column)
  return `(CASE WHEN substr(${digits}, 1, 3) = '855' AND length(${digits}) IN (11, 12) THEN '0' || substr(${digits}, 4) ELSE ${digits} END)`
}

export function normalizeContactName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Phone identity uses the account system's canonical key. Besides ignoring
// display separators, this folds Cambodia's 855 country code to the local
// 0-leading form, so +855 12 345 678 and 012 345 678 cannot become two
// contacts merely because they were entered through different surfaces.
export function normalizePhone(value: unknown): string | null {
  return canonicalizePhone(value)
}

// P7-c: the P8 DISPLAY convention for manually entered phones -- the same
// contract the migration pack's validator pins (`0XX XXX XXX` for 9
// digits, `0XX XXX XXXX` for 10; validate-pack.cjs's PHONE_FORMATTED_RE/
// PHONE_BARE_VALID_RE). Matching stays digit-based (normalizePhone above),
// so this is display consistency only: 10,352 migrated numbers already
// carry this shape and manual creates must not drift from it. Deliberately
// conservative, mirroring the migration's own rule: only an unambiguous
// Cambodian number is reformatted -- 0-leading 9/10 digit strings, plus a
// manually typed +855/855 prefix (converted to its 0-leading local form).
// Anything else (dual numbers, foreign, partials, garbage) is preserved
// exactly as typed, the migration's "preserved as-is" rule.
export function formatPhoneP8(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  if (/^0\d{2} \d{3} \d{3,4}$/.test(raw)) return raw
  const digits = raw.replace(/\D/g, '')
  // Reject mixed content: if stripping separators dropped anything beyond
  // spaces/dashes/dots/parens/plus, this isn't a plain phone -- preserve.
  if (raw.replace(/[\d\s().+-]/g, '') !== '') return raw
  const national = /^855\d{8,9}$/.test(digits) ? `0${digits.slice(3)}` : digits
  if (!/^0\d{8,9}$/.test(national)) return raw
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
}

// Contact Options live as JSON in the address column. Format only a real JSON
// array: legacy/plain addresses and malformed historical values must survive
// byte-for-byte. This keeps every phone written by the manual/import paths in
// the same display shape as the top-level phone without rewriting old rows.
export function formatContactOptionPhones(value: unknown, mode: ContactOptionMode = 'address'): unknown {
  const raw = String(value ?? '').trim()
  if (!raw || !raw.startsWith('[')) return value
  try {
    if (!Array.isArray(JSON.parse(raw))) return value
  } catch (_) {
    return value
  }
  const options = parseStoredContactOptions(raw, mode)
  if (!options.length) return value
  return serializeContactOptions(options.map((option) => ({
    ...option,
    phone: option.phone == null ? null : formatPhoneP8(option.phone),
  })), mode)
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
  table: ContactDuplicateTable = 'customers',
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
      version: candidateVersion(candidate, table),
    })
  }
  return matches.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

// DB-backed lookup for a single record being created/edited. Phone identity
// is queried separately and without a row limit: a common name can have more
// than 50 legitimate records, and those name matches must never crowd a hard
// phone owner out of the result set. Name-only suggestions remain bounded.
export async function findContactDuplicates(
  db: D1Compat,
  table: ContactDuplicateTable,
  subject: { id?: number | string | null; name: string; phones: string[] },
  mode: ContactOptionMode = 'address',
): Promise<ContactDuplicateMatch[]> {
  const nameKey = normalizeContactName(subject.name)
  const phones = [...new Set(subject.phones.map(normalizePhone).filter((p): p is string => !!p))]
  if (!nameKey && !phones.length) return []

  const params: Record<string, unknown> = {}
  // Use the same canonical rule as normalizePhone for accepted phone shapes in the primary
  // column and each structured Contact Option. customers.phone_normalized is
  // indexed and checked first, while the expression also catches historical
  // supplier/delivery rows and imported customer rows whose key is stale.
  const phoneConditions: string[] = []
  phones.forEach((phone, index) => {
    params[`phone${index}`] = phone
    if (table === 'customers') phoneConditions.push(`phone_normalized = @phone${index}`)
    phoneConditions.push(`${canonicalPhoneSql('phone')} = @phone${index}`)
    phoneConditions.push(`EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(address) THEN CASE WHEN json_type(address) = 'array' THEN address ELSE '[]' END ELSE '[]' END) AS option
      WHERE ${canonicalPhoneSql("json_extract(option.value, '$.phone')")} = @phone${index}
    )`)
  })
  const excludeSql = subject.id != null && subject.id !== '' ? 'AND id != @excludeId' : ''
  if (excludeSql) params.excludeId = subject.id

  const phoneRows = phoneConditions.length
    ? await db
      .prepare(`SELECT ${candidateColumns(table)} FROM ${table} WHERE (${phoneConditions.join(' OR ')}) ${excludeSql}`)
      .all<ContactDuplicateCandidateRow>(params)
    : []
  const nameRows = nameKey
    ? await db
      .prepare(`SELECT ${candidateColumns(table)} FROM ${table} WHERE lower(trim(name)) = @nameKey ${excludeSql} ORDER BY id ASC LIMIT 50`)
      .all<ContactDuplicateCandidateRow>({ ...params, nameKey })
    : []
  const rows = [...new Map([...phoneRows, ...nameRows].map((row) => [Number(row.id), row])).values()]

  return classifyContactDuplicates({ name: subject.name, phones }, rows, mode, table)
}

// Re-check the reviewed candidate set inside the same D1 batch as the write.
// The fingerprint covers every raw identity field the duplicate classifier
// reads. A new/deleted candidate or any edit to an acknowledged row therefore
// invalidates the decision even when updated_at has only second precision.
function candidateIdentityVersionSql(table: ContactDuplicateTable, alias: string): string {
  const fields = [`${alias}.name`, `${alias}.phone`, `${alias}.address`, `${alias}.updated_at`]
  if (table === 'customers') fields.push(`${alias}.phone_normalized`, `${alias}.membership_number`)
  return fields.map((field) => `hex(CAST(COALESCE(${field}, '') AS TEXT))`).join(" || '.' || ")
}

export function contactDuplicateWriteGuardStatement(
  table: ContactDuplicateTable,
  subject: { id?: number | string | null; name?: string; phones: string[] },
  decision: ContactDuplicateCreateSeparateDecision | null = null,
): ContactDuplicateGuardStatement | null {
  const phones = [...new Set(subject.phones.map(normalizePhone).filter((phone): phone is string => !!phone))]
  const nameKey = normalizeContactName(subject.name)
  if (!phones.length && !decision) return null
  const phoneMatch = `(
    ${table === 'customers' ? `candidate.phone_normalized IN (SELECT CAST(value AS TEXT) FROM json_each(@phones)) OR` : ''}
    ${canonicalPhoneSql('candidate.phone')} IN (SELECT CAST(value AS TEXT) FROM json_each(@phones))
    OR EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(candidate.address) AND json_type(candidate.address) = 'array' THEN candidate.address ELSE '[]' END) AS option
      WHERE ${canonicalPhoneSql("json_extract(option.value, '$.phone')")} IN (SELECT CAST(value AS TEXT) FROM json_each(@phones))
    )
  )`
  const currentMatch = `(${decision && nameKey ? `lower(trim(COALESCE(candidate.name, ''))) = @nameKey OR` : ''} ${phoneMatch})`
  const currentFingerprint = `COALESCE((
    SELECT 'v1|' || group_concat(CAST(current.id AS TEXT) || '@' || current.version, '|')
    FROM (
      SELECT candidate.id, ${candidateIdentityVersionSql(table, 'candidate')} AS version
      FROM ${table} AS candidate
      WHERE candidate.id != COALESCE(@excludeId, -1) AND ${currentMatch}
      ORDER BY candidate.id ASC
    ) AS current
  ), 'v1|')`
  return {
    sql: `SELECT CASE
      WHEN ${currentFingerprint} = @candidateFingerprint THEN 1
      ELSE json('CONTACT_DUPLICATE_CANDIDATES_CHANGED')
    END AS contact_duplicate_guard`,
    params: {
      phones: JSON.stringify(phones),
      nameKey,
      excludeId: subject.id == null || subject.id === '' ? null : Number(subject.id),
      candidateFingerprint: decision?.fingerprint || 'v1|',
    },
  }
}

export type ContactDuplicateClusterEntry = { id: number; name: string | null; phone: string | null; membershipNumber: string | null }

export type ContactDuplicateCluster = {
  type: 'phone' | 'name'
  value: string
  severity: ContactDuplicateSeverity
  contacts: ContactDuplicateClusterEntry[]
  // Set only when a sweep was asked to include already-kept clusters
  // (findDuplicateContactClusters's includeDismissed option). A kept cluster
  // is one someone marked "reviewed, not a duplicate" -- it's hidden from the
  // default queue but never gone: the panel can reveal it and REOPEN it (see
  // undismissDuplicateCluster) so a wrongly-kept conflict can always be
  // resolved later, never a one-way door.
  dismissed?: boolean
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

// The inverse of dismissDuplicateCluster: drops the "reviewed, not a
// duplicate" marker so the cluster returns to the open review queue and can
// be merged/resolved after all. This is what makes "keep" (dismiss) a
// reversible decision rather than a one-way hide -- a kept conflict can
// always be reopened and resolved. Phone clusters match on the exact stored
// (already-normalized) digits; NAME clusters match on the normalized name
// the same way findDuplicateContactClusters filters, because the stored
// dismissal keeps whatever display casing the panel showed at dismiss time
// while a later reopen sends the current display name -- comparing raw would
// miss a row that only differs in casing.
export async function undismissDuplicateCluster(
  db: D1Compat,
  table: ContactDuplicateTable,
  type: 'phone' | 'name',
  value: string,
): Promise<void> {
  if (type === 'phone') {
    await db.prepare(`DELETE FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'phone' AND cluster_value = @value`).run({ table, value })
    return
  }
  const rows = await db.prepare(`SELECT cluster_value FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'name'`).all<{ cluster_value: string }>({ table })
  const target = normalizeContactName(value)
  for (const row of rows) {
    if (normalizeContactName(row.cluster_value) === target) {
      await db.prepare(`DELETE FROM contact_duplicate_dismissals WHERE contact_table = @table AND cluster_type = 'name' AND cluster_value = @value`).run({ table, value: row.cluster_value })
    }
  }
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
  options: { includeDismissed?: boolean } = {},
): Promise<ContactDuplicateCluster[]> {
  const includeDismissed = options.includeDismissed === true
  const [rows, dismissalRows] = await Promise.all([
    db.prepare(`SELECT ${candidateColumns(table)} FROM ${table} ORDER BY id ASC`).all<ContactDuplicateCandidateRow>({}),
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
    const isDismissed = dismissed.has(`phone${phone}`)
    if (isDismissed && !includeDismissed) continue
    const distinct = [...new Map(group.map((row) => [row.id, row])).values()]
    if (distinct.length < 2) continue
    const names = new Set(distinct.map((row) => normalizeContactName(row.name)))
    clusters.push({ type: 'phone', value: phone, severity: names.size > 1 ? 'phone_conflict' : 'exact_match', contacts: distinct.map(toEntry), ...(isDismissed ? { dismissed: true } : {}) })
  }
  for (const [nameKey, group] of byName) {
    if (group.length < 2) continue
    const isDismissed = dismissed.has(`name${nameKey}`)
    if (isDismissed && !includeDismissed) continue
    clusters.push({ type: 'name', value: group[0].name || nameKey, severity: 'name_only', contacts: group.map(toEntry), ...(isDismissed ? { dismissed: true } : {}) })
  }
  // Open conflicts first (worst-first within each), then the kept ones last
  // when they were asked for -- the queue leads with what still needs a
  // decision, with reopenable history trailing behind it.
  return clusters.sort((a, b) => {
    const ad = a.dismissed ? 1 : 0
    const bd = b.dismissed ? 1 : 0
    if (ad !== bd) return ad - bd
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  })
}

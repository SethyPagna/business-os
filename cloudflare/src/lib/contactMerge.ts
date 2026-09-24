export type ContactMergeTable = 'customers' | 'suppliers' | 'delivery_contacts'

export type ContactMergeStatement = {
  sql: string
  params?: Record<string, unknown>
}

export type ContactMergeAudit = {
  operationId: string
  clientRequestId?: string | null
  /** The system-detected cluster the route verified; a stepped merge's later steps are authorized by it. */
  clusterIds?: number[]
  userId: number | null
  userName: string | null
  deviceName: string | null
  deviceTz: string | null
}

// One Resolve-grid decision for one field: the value a record already holds,
// or a value the user typed. Membership numbers and storefront accounts are
// chosen by record instead (membershipSourceId / portalKeepContactId).
export type ContactMergeChoice = { source_id: number } | { custom: unknown }

export type ContactMergePortalAccount = {
  id: number
  contact_id: number | null
  membership_id?: string | null
  name?: string | null
}

export type ContactMergeInput = {
  table: ContactMergeTable
  entity: string
  editableColumns: readonly string[]
  keeper: Record<string, unknown>
  members: Record<string, unknown>[]
  choices?: Record<string, ContactMergeChoice>
  membershipSourceId?: number | null
  // Customers only: every storefront account linked to any of the records, as
  // read before planning. The batch refuses to run if that set has changed.
  portalAccounts?: ContactMergePortalAccount[]
  portalKeepContactId?: number | null
  hasCustomerReceivables: boolean
  hasSupplierInvoices: boolean
  audit: ContactMergeAudit
}

export type ContactMergeSnapshot = Record<string, unknown>

export type ContactMergePlan = {
  statements: ContactMergeStatement[]
  // Columns written onto the kept record (backfills, grid choices, the
  // membership note and the derived phone key).
  backfilled: string[]
  finalKeeper: Record<string, unknown>
  // Every field's chosen value before the membership note is appended; a
  // stepped merge replays these as explicit values in its first step.
  resolved: Record<string, unknown>
  mergedIds: number[]
  before: ContactMergeSnapshot
  after: ContactMergeSnapshot
}

export const CONTACT_MERGE_MAX_STATEMENTS = 80
export const CONTACT_MERGE_MAX_BINDS_PER_STATEMENT = 80
// One Resolve merges at most six records (the kept one plus five). Six
// customers plan to about 55 statements, inside the 80-statement cap.
export const CONTACT_MERGE_MAX_RECORDS = 6
// D1 queries POST {path}/merge spends outside its write batch: session auth
// (up to 3), the record, storefront, table and device reads (4), the
// system-detected cluster check (the sweep's 2 reads, plus 1 receipt read for
// a stepped merge's later step), failure reconciliation (3), the cache-version
// bump (up to 9) and the refresh read (1). Each batch statement is one more.
export const CONTACT_MERGE_ROUTE_OVERHEAD_QUERIES = 23

const SAFE_COLUMN = /^[a-z][a-z0-9_]*$/
const MEMBERSHIP_NOTE_PREFIX = 'Merged membership: '

function contactMergeValueIsBlank(column: string, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  // Historic membership identities are byte-sensitive when present, but an
  // all-whitespace value carries no identity and must not block an exact
  // nonblank loser value from being preserved on the keeper.
  return column === 'membership_number' && typeof value === 'string' && value.trim() === ''
}

function contactSnapshotGuard(
  table: ContactMergeTable,
  editableColumns: readonly string[],
  row: Record<string, unknown>,
): ContactMergeStatement {
  const columns = [...new Set([
    ...editableColumns,
    'updated_at',
    ...(table === 'customers' ? ['phone_normalized', 'is_anonymous'] : []),
  ])]
  if (columns.some((column) => !SAFE_COLUMN.test(column))) throw new Error('contact_merge_invalid_column')

  const params: Record<string, unknown> = { id: Number(row.id) }
  const match = columns.map((column, index) => {
    params[`c${index}`] = row[column] ?? null
    return `r.${column} IS @c${index}`
  }).join(' AND ')
  const profileOnly = table === 'customers' ? ' AND COALESCE(r.is_anonymous, 0) = 0' : ''

  return {
    // D1 batch rolls back only when a statement throws. Invalid JSON is a
    // deliberate deterministic SQLite error when a pre-read record changed,
    // disappeared, or became the anonymous walk-in profile before commit.
    sql: `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM ${table} AS r WHERE r.id = @id AND ${match}${profileOnly})
      THEN 1 ELSE json_extract('contact_merge_conflict', '$') END AS contact_merge_guard`,
    params,
  }
}

// The storefront accounts linked to the records must be exactly the ones the
// plan was built from: an account linked after the read would otherwise be
// moved or unlinked without anyone having chosen it.
function portalSnapshotGuard(recordIds: number[], accounts: ContactMergePortalAccount[]): ContactMergeStatement {
  const params: Record<string, unknown> = {
    portalCount: accounts.length,
    portalPairs: `,${accounts.map((account) => `${Number(account.id)}:${Number(account.contact_id)}`).join(',')},`,
  }
  const ids = recordIds.map((id, index) => {
    params[`p${index}`] = id
    return `@p${index}`
  }).join(', ')
  return {
    sql: `SELECT CASE WHEN (
        SELECT COUNT(*) = @portalCount
          AND COALESCE(SUM(instr(@portalPairs, ',' || id || ':' || contact_id || ',') > 0), 0) = @portalCount
        FROM portal_accounts WHERE contact_id IN (${ids})
      ) THEN 1 ELSE json_extract('contact_merge_conflict', '$') END AS contact_merge_guard`,
    params,
  }
}

// What each merge moves, recorded in the audit row before the move so a merge
// can be reversed by hand (there is no undo): rows linked to a merged record by
// id, and rows linked only by a name the merge rewrites.
const MOVED_BY_ID: Record<ContactMergeTable, Array<[table: string, column: string, requires?: 'receivables' | 'invoices']>> = {
  customers: [
    ['sales', 'customer_id'],
    ['returns', 'customer_id'],
    ['customer_share_submissions', 'customer_id'],
    ['loyalty_point_adjustments', 'customer_id'],
    ['customer_receivables', 'customer_id', 'receivables'],
  ],
  suppliers: [
    ['returns', 'supplier_id'],
    ['product_batches', 'supplier_id'],
    ['supplier_invoices', 'supplier_id', 'invoices'],
  ],
  delivery_contacts: [
    ['sales', 'delivery_contact_id'],
    ['fees', 'delivery_contact_id'],
  ],
}
const MOVED_BY_NAME: Record<ContactMergeTable, Array<[table: string, textColumn: string, unlinked: string | null, requires?: 'receivables' | 'invoices']>> = {
  customers: [['customer_receivables', 'customer_name', 'customer_id IS NULL', 'receivables']],
  suppliers: [
    ['products', 'supplier', null],
    ['product_batches', 'supplier_name', 'supplier_id IS NULL'],
    ['supplier_invoices', 'supplier_name', 'supplier_id IS NULL', 'invoices'],
  ],
  delivery_contacts: [],
}

function assertPlanBounds(statements: ContactMergeStatement[]): void {
  if (statements.length > CONTACT_MERGE_MAX_STATEMENTS) throw new Error('contact_merge_statement_budget_exceeded')
  for (const statement of statements) {
    // lib/db.ts binds every @name occurrence as its own positional parameter.
    const binds = (statement.sql.match(/@\w+/g) || []).length
    if (binds > CONTACT_MERGE_MAX_BINDS_PER_STATEMENT) throw new Error('contact_merge_bind_budget_exceeded')
  }
}

function withoutVersion(row: Record<string, unknown>): Record<string, unknown> {
  const { updated_at: _updatedAt, ...rest } = row
  return rest
}

export function buildContactMergePlan(input: ContactMergeInput): ContactMergePlan {
  const { table, entity, editableColumns, keeper, members, audit } = input
  const keepId = Number(keeper.id)
  const mergedIds = members.map((member) => Number(member.id))
  const recordIds = [keepId, ...mergedIds]
  if (!mergedIds.length || recordIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(recordIds).size !== recordIds.length) {
    throw new Error('contact_merge_invalid_ids')
  }
  if (recordIds.length > CONTACT_MERGE_MAX_RECORDS) throw new Error('contact_merge_too_many_records')
  if (editableColumns.some((column) => !SAFE_COLUMN.test(column))) throw new Error('contact_merge_invalid_column')

  const records = [keeper, ...members]
  const recordById = new Map(records.map((row) => [Number(row.id), row]))
  const fieldColumns = editableColumns.filter((column) => column !== 'membership_number')
  const choices = input.choices || {}
  for (const [column, choice] of Object.entries(choices)) {
    const valid = fieldColumns.includes(column) && choice !== null && typeof choice === 'object'
      && ('source_id' in choice ? recordById.has(Number(choice.source_id)) : 'custom' in choice)
    if (!valid) throw new Error('contact_merge_invalid_choice')
  }

  // A decision the user made always applies. A field nobody chose keeps the
  // kept record's value unless it is blank, then takes the first non-blank one.
  const resolved: Record<string, unknown> = {}
  for (const column of fieldColumns) {
    const choice = choices[column]
    if (choice && 'source_id' in choice) resolved[column] = recordById.get(Number(choice.source_id))?.[column] ?? null
    else if (choice) resolved[column] = choice.custom ?? null
    else if (!contactMergeValueIsBlank(column, keeper[column])) resolved[column] = keeper[column]
    else resolved[column] = members.map((member) => member[column]).find((value) => !contactMergeValueIsBlank(column, value)) ?? keeper[column] ?? null
  }
  if (fieldColumns.includes('name') && !String(resolved.name ?? '').trim()) throw new Error('contact_merge_name_required')

  const backfill: Record<string, unknown> = {}
  for (const column of fieldColumns) {
    if ((resolved[column] ?? null) !== (keeper[column] ?? null)) backfill[column] = resolved[column]
  }

  // Membership numbers are exact legacy identities. One survives -- the only
  // one, or the one chosen when the records hold different numbers -- and
  // every other number is kept as a line in the notes, never dropped.
  let membershipToNotes: unknown[] = []
  if (table === 'customers') {
    const numbers = [...new Set(records.map((row) => row.membership_number).filter((value) => !contactMergeValueIsBlank('membership_number', value)))]
    let finalNumber = numbers.length === 1 ? numbers[0] : keeper.membership_number ?? null
    if (numbers.length > 1) {
      const source = recordById.get(Number(input.membershipSourceId))
      if (!source || contactMergeValueIsBlank('membership_number', source.membership_number)) {
        throw new Error('contact_merge_membership_lineage_required')
      }
      finalNumber = source.membership_number
    }
    if (finalNumber !== (keeper.membership_number ?? null)) backfill.membership_number = finalNumber
    membershipToNotes = numbers.filter((value) => value !== finalNumber)
    if (membershipToNotes.length) {
      const notes = String(('notes' in resolved ? resolved.notes : keeper.notes) ?? '')
      const present = new Set(notes.split(/\r?\n/))
      const lines = membershipToNotes.map((value) => `${MEMBERSHIP_NOTE_PREFIX}${value}`).filter((line) => !present.has(line))
      if (lines.length) backfill.notes = notes.trim() ? `${notes}\n${lines.join('\n')}` : lines.join('\n')
    }
    // phone_normalized is the storefront's lookup key for phone; it moves
    // with the phone it is derived from.
    const phoneNormalized = canonicalizePhone('phone' in backfill ? backfill.phone : keeper.phone)
    if (phoneNormalized !== (keeper.phone_normalized ?? null)) backfill.phone_normalized = phoneNormalized
  }
  const finalKeeper = { ...keeper, ...backfill }

  // Storefront accounts: when more than one record has one, the chosen
  // record's accounts stay linked and every other account is unlinked
  // (contact_id NULL still signs in; it is just no longer this customer).
  const accounts = table === 'customers' ? (input.portalAccounts || []) : []
  if (accounts.some((account) => !recordById.has(Number(account.contact_id)))) throw new Error('contact_merge_invalid_portal_snapshot')
  const holders = [...new Set(accounts.map((account) => Number(account.contact_id)))]
  let keptHolder: number | null = holders[0] ?? null
  if (holders.length > 1) {
    keptHolder = Number(input.portalKeepContactId)
    if (!holders.includes(keptHolder)) throw new Error('contact_merge_portal_choice_required')
  }
  const unlinkedPortalAccountIds = accounts.filter((account) => Number(account.contact_id) !== keptHolder).map((account) => Number(account.id))

  const keeperName = String(finalKeeper.name || '')
  const nameChanged = keeperName !== String(keeper.name || '')
  const snapshotChanged = nameChanged
    || (finalKeeper.phone ?? null) !== (keeper.phone ?? null)
    || (contactDisplayAddress(finalKeeper.address) || null) !== (contactDisplayAddress(keeper.address) || null)
  const renamedFrom: string[] = []

  // The statements that move one record's links onto the keeper. For the
  // keeper itself (mergeId = keepId) only the display carries run, and only
  // when the chosen name/phone/address changed its snapshot.
  const repoint = (mergeId: number, mergedName: string, keeperOnly: boolean): ContactMergeStatement[] => {
    const statements: ContactMergeStatement[] = []
    const carryName = !keeperOnly || nameChanged
    const mergedNameLower = mergedName.trim().toLowerCase()
    const byName = carryName && Boolean(mergedNameLower) && !renamedFrom.includes(mergedNameLower)
    if (byName) renamedFrom.push(mergedNameLower)
    if (table === 'customers') {
      if (!keeperOnly || snapshotChanged) statements.push({ sql: 'UPDATE sales SET customer_id = @keepId, customer_name = @keeperName, customer_phone = @keeperPhone, customer_address = @keeperAddress WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName, keeperPhone: finalKeeper.phone ?? null, keeperAddress: contactDisplayAddress(finalKeeper.address) || null } })
      if (carryName) {
        statements.push(
          { sql: 'UPDATE returns SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } },
          { sql: 'UPDATE customer_share_submissions SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } },
        )
      }
      if (!keeperOnly) {
        statements.push(
          { sql: 'UPDATE loyalty_point_adjustments SET customer_id = @keepId WHERE customer_id = @mergeId', params: { keepId, mergeId } },
          { sql: 'UPDATE portal_accounts SET contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE contact_id = @mergeId', params: { keepId, mergeId } },
        )
      }
      if (input.hasCustomerReceivables) {
        if (carryName) statements.push({ sql: 'UPDATE customer_receivables SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } })
        if (byName) statements.push({ sql: 'UPDATE customer_receivables SET customer_name = @keeperName WHERE customer_id IS NULL AND lower(trim(customer_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } })
      }
    } else if (table === 'suppliers') {
      if (carryName) {
        statements.push(
          { sql: 'UPDATE returns SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } },
          { sql: 'UPDATE product_batches SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } },
        )
      }
      if (byName) {
        statements.push(
          { sql: "UPDATE products SET supplier = @keeperName, updated_at = CURRENT_TIMESTAMP WHERE lower(trim(COALESCE(supplier, ''))) = @mergedNameLower", params: { keeperName, mergedNameLower } },
          { sql: 'UPDATE product_batches SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } },
        )
      }
      if (input.hasSupplierInvoices) {
        if (carryName) statements.push({ sql: 'UPDATE supplier_invoices SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } })
        if (byName) statements.push({ sql: 'UPDATE supplier_invoices SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } })
      }
    } else {
      if (carryName) statements.push({ sql: 'UPDATE sales SET delivery_contact_id = @keepId, delivery_contact_name = @keeperName WHERE delivery_contact_id = @mergeId', params: { keepId, mergeId, keeperName } })
      if (!keeperOnly) statements.push({ sql: 'UPDATE fees SET delivery_contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE delivery_contact_id = @mergeId', params: { keepId, mergeId } })
    }
    return statements
  }
  // The keeper's own rows first, so rows moved below are written only once.
  const moves = [
    ...repoint(keepId, String(keeper.name || ''), true),
    ...members.flatMap((member) => repoint(Number(member.id), String(member.name || ''), false)),
  ]

  const unlink: ContactMergeStatement[] = []
  if (unlinkedPortalAccountIds.length) {
    const params: Record<string, unknown> = {}
    const ids = unlinkedPortalAccountIds.map((id, index) => {
      params[`u${index}`] = id
      return `@u${index}`
    }).join(', ')
    unlink.push({ sql: `UPDATE portal_accounts SET contact_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id IN (${ids})`, params })
  }

  const keeperUpdate: ContactMergeStatement[] = []
  const backfilled = Object.keys(backfill)
  if (backfilled.length) {
    keeperUpdate.push({
      sql: `UPDATE ${table} SET ${backfilled.map((column) => `${column} = @${column}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
      params: { ...backfill, id: keepId },
    })
  }

  const keptAccounts = accounts.map((account) => ({ ...account, contact_id: unlinkedPortalAccountIds.includes(Number(account.id)) ? null : keepId }))
  const before: ContactMergeSnapshot = {
    keeper: withoutVersion(keeper),
    members,
    ...(table === 'customers' ? { portal_accounts: accounts } : {}),
  }
  const after: ContactMergeSnapshot = {
    merged_ids: mergedIds,
    merged_names: members.map((member) => member.name ?? null),
    keeper: withoutVersion(finalKeeper),
    ...(table === 'customers' ? { portal_accounts: keptAccounts, membership_to_notes: membershipToNotes } : {}),
  }

  const auditParams: Record<string, unknown> = {
    userId: audit.userId,
    userName: audit.userName,
    entity,
    // audit_logs.entity_id is TEXT and the route finds this row by
    // String(keepId); bind the same text on every driver.
    entityId: String(keepId),
    details: JSON.stringify({
      operationId: audit.operationId,
      clientRequestId: audit.clientRequestId ?? null,
      ...(audit.clusterIds?.length ? { clusterIds: audit.clusterIds } : {}),
      mergedIds,
      mergedNames: members.map((member) => member.name ?? null),
      backfilled,
    }),
    before: JSON.stringify(before),
    after: JSON.stringify(after),
    deviceName: audit.deviceName,
    deviceTz: audit.deviceTz,
  }
  const listOf = (prefix: string, values: unknown[]) => values.map((value, index) => {
    auditParams[`${prefix}${index}`] = value
    return `@${prefix}${index}`
  }).join(', ')
  const available = (requires?: 'receivables' | 'invoices') => !requires
    || (requires === 'receivables' ? input.hasCustomerReceivables : input.hasSupplierInvoices)
  const moved: string[] = MOVED_BY_ID[table].filter(([, , requires]) => available(requires)).map(([movedTable, column], index) => (
    `'${movedTable}', json((SELECT json_group_array(json_array(id, ${column})) FROM ${movedTable} WHERE ${column} IN (${listOf(`m${index}_`, mergedIds)})))`
  ))
  if (renamedFrom.length) {
    MOVED_BY_NAME[table].filter(([, , , requires]) => available(requires)).forEach(([movedTable, textColumn, unlinked], index) => {
      moved.push(`'${movedTable}_by_name', json((SELECT json_group_array(json_array(id, ${textColumn})) FROM ${movedTable}
        WHERE ${unlinked ? `${unlinked} AND ` : ''}lower(trim(COALESCE(${textColumn}, ''))) IN (${listOf(`n${index}_`, renamedFrom)})))`)
    })
  }
  const auditInsert: ContactMergeStatement = {
    sql: `INSERT INTO audit_logs (
        user_id, user_name, action, entity, entity_id, details,
        table_name, record_id, old_value, new_value, device_name, device_tz
      ) VALUES (
        @userId, @userName, 'merge', @entity, @entityId, @details,
        @entity, @entityId, json_set(@before, '$.moved', json_object(${moved.join(', ')})), @after, @deviceName, @deviceTz
      )`,
    params: auditParams,
  }

  // Order matters: guards first; the audit row captures what is about to move
  // before anything moves; unlinked accounts leave before the per-record
  // repoint would carry them along; membership_number is unique, so a merged
  // record is deleted before the keeper takes its number. One batch, so any
  // failure restores every record, link and note.
  const statements: ContactMergeStatement[] = [
    ...records.map((row) => contactSnapshotGuard(table, editableColumns, row)),
    ...(table === 'customers' ? [portalSnapshotGuard(recordIds, accounts)] : []),
    auditInsert,
    ...unlink,
    ...moves,
    ...mergedIds.map((id) => ({ sql: `DELETE FROM ${table} WHERE id = @id`, params: { id } })),
    ...keeperUpdate,
  ]
  assertPlanBounds(statements)
  return { statements, backfilled, finalKeeper, resolved, mergedIds, before, after }
}

export function contactMergeStatementBudget(queriesPerInvocation: number): number {
  return Math.max(1, Math.min(CONTACT_MERGE_MAX_STATEMENTS, Math.floor(queriesPerInvocation) - CONTACT_MERGE_ROUTE_OVERHEAD_QUERIES))
}

// Free plan: a merge whose batch would not fit the request's D1 query budget
// takes fewer records now and hands back the rest. The records holding the
// chosen membership number and storefront account go first, and every field
// is replayed as the value already resolved from all records, so the kept
// record ends exactly as one full merge would leave it.
export function stepContactMergePlan(
  input: ContactMergeInput,
  full: ContactMergePlan,
  statementBudget: number,
): { plan: ContactMergePlan; remaining: Record<string, unknown>[] } {
  if (full.statements.length <= statementBudget || input.members.length < 2) return { plan: full, remaining: [] }
  const sources = new Set([Number(input.membershipSourceId), Number(input.portalKeepContactId)])
  const ordered = [
    ...input.members.filter((member) => sources.has(Number(member.id))),
    ...input.members.filter((member) => !sources.has(Number(member.id))),
  ]
  const minimum = Math.max(1, input.members.filter((member) => sources.has(Number(member.id))).length)
  const choices = Object.fromEntries(Object.entries(full.resolved).map(([column, value]) => [column, { custom: value }]))
  let step: { plan: ContactMergePlan; remaining: Record<string, unknown>[] } = { plan: full, remaining: [] }
  for (let size = ordered.length - 1; size >= minimum; size -= 1) {
    const stepIds = new Set([Number(input.keeper.id), ...ordered.slice(0, size).map((member) => Number(member.id))])
    const plan = buildContactMergePlan({
      ...input,
      members: ordered.slice(0, size),
      choices,
      portalAccounts: (input.portalAccounts || []).filter((account) => stepIds.has(Number(account.contact_id))),
    })
    step = { plan, remaining: ordered.slice(size) }
    if (plan.statements.length <= statementBudget) break
  }
  return step
}

// The request that finishes a stepped merge: the kept record now holds every
// chosen value, number and account, so the rest simply keep the kept record's.
export function contactMergeContinuation(
  keeper: Record<string, unknown>,
  remaining: Record<string, unknown>[],
  editableColumns: readonly string[],
  clientRequestId: string | null,
) {
  const keepId = Number(keeper.id)
  return {
    keepId,
    mergeIds: remaining.map((row) => Number(row.id)),
    client_request_id: clientRequestId ? `${clientRequestId.replace(/:r\d+$/, '')}:r${remaining.length}` : null,
    expected: [keeper, ...remaining].map((row) => ({ id: Number(row.id), updated_at: row.updated_at ?? null })),
    choices: Object.fromEntries(editableColumns.filter((column) => column !== 'membership_number').map((column) => [column, { source_id: keepId }])),
    membership_source_id: keepId,
    portal_keep_contact_id: keepId,
  }
}
import { contactDisplayAddress } from './contactOptions'
import { canonicalizePhone } from './phone'

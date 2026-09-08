export type ContactMergeTable = 'customers' | 'suppliers' | 'delivery_contacts'

export type ContactMergeStatement = {
  sql: string
  params?: Record<string, unknown>
}

export type ContactMergeAudit = {
  operationId: string
  userId: number | null
  userName: string | null
  deviceName: string | null
  deviceTz: string | null
}

export type ContactMergePlan = {
  statements: ContactMergeStatement[]
  backfilled: string[]
  finalKeeper: Record<string, unknown>
}

export const CONTACT_MERGE_MAX_STATEMENTS = 80
export const CONTACT_MERGE_MAX_BINDS_PER_STATEMENT = 80

const SAFE_COLUMN = /^[a-z][a-z0-9_]*$/

function contactMergeValueIsBlank(column: string, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  // Historic membership identities are byte-sensitive when present, but an
  // all-whitespace value carries no identity and must not block an exact
  // nonblank loser value from being preserved on the keeper.
  return column === 'membership_number' && typeof value === 'string' && value.trim() === ''
}

export function contactMergeHasDistinctMemberships(
  keeper: Record<string, unknown>,
  merged: Record<string, unknown>,
): boolean {
  const keeperMembership = keeper.membership_number
  const mergedMembership = merged.membership_number
  // Preserve exact legacy identity. Case, punctuation, and historic prefixes
  // can be meaningful; a merge may not normalize either value away.
  return !contactMergeValueIsBlank('membership_number', keeperMembership)
    && !contactMergeValueIsBlank('membership_number', mergedMembership)
    && keeperMembership !== mergedMembership
}

function contactSnapshotGuard(
  table: ContactMergeTable,
  editableColumns: readonly string[],
  keeper: Record<string, unknown>,
  merged: Record<string, unknown>,
): ContactMergeStatement {
  const columns = [...new Set([
    ...editableColumns,
    'updated_at',
    ...(table === 'customers' ? ['phone_normalized', 'is_anonymous'] : []),
  ])]
  if (columns.some((column) => !SAFE_COLUMN.test(column))) throw new Error('contact_merge_invalid_column')

  const params: Record<string, unknown> = {
    keepId: Number(keeper.id),
    mergeId: Number(merged.id),
  }
  const rowMatch = (alias: 'keeper' | 'merged', row: Record<string, unknown>) => columns.map((column, index) => {
    const key = `${alias}${index}`
    params[key] = row[column] ?? null
    return `${alias}.${column} IS @${key}`
  }).join(' AND ')
  const portalCollisionGuard = table === 'customers'
    ? `AND NOT (
        EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id = @keepId)
        AND EXISTS(SELECT 1 FROM portal_accounts WHERE contact_id = @mergeId)
      )
      AND COALESCE((SELECT is_anonymous FROM customers WHERE id = @keepId), 0) = 0
      AND COALESCE((SELECT is_anonymous FROM customers WHERE id = @mergeId), 0) = 0`
    : ''

  return {
    // D1 batch rolls back only when a statement throws. Invalid JSON is a
    // deliberate deterministic SQLite error when either pre-read row changed,
    // disappeared, or acquired a second storefront account before commit.
    sql: `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM ${table} AS keeper WHERE keeper.id = @keepId AND ${rowMatch('keeper', keeper)})
      AND EXISTS(SELECT 1 FROM ${table} AS merged WHERE merged.id = @mergeId AND ${rowMatch('merged', merged)})
      ${portalCollisionGuard}
      THEN 1 ELSE json_extract('contact_merge_conflict', '$') END AS contact_merge_guard`,
    params,
  }
}

function assertPlanBounds(statements: ContactMergeStatement[]): void {
  if (statements.length > CONTACT_MERGE_MAX_STATEMENTS) throw new Error('contact_merge_statement_budget_exceeded')
  for (const statement of statements) {
    const binds = Object.keys(statement.params || {}).length
    if (binds > CONTACT_MERGE_MAX_BINDS_PER_STATEMENT) throw new Error('contact_merge_bind_budget_exceeded')
  }
}

export function buildContactMergePlan(input: {
  table: ContactMergeTable
  entity: string
  editableColumns: readonly string[]
  keeper: Record<string, unknown>
  merged: Record<string, unknown>
  hasCustomerReceivables: boolean
  hasSupplierInvoices: boolean
  audit: ContactMergeAudit
}): ContactMergePlan {
  const { table, entity, editableColumns, keeper, merged, audit } = input
  const keepId = Number(keeper.id)
  const mergeId = Number(merged.id)
  if (!Number.isSafeInteger(keepId) || keepId <= 0 || !Number.isSafeInteger(mergeId) || mergeId <= 0 || keepId === mergeId) {
    throw new Error('contact_merge_invalid_ids')
  }
  if (table === 'customers' && contactMergeHasDistinctMemberships(keeper, merged)) {
    throw new Error('contact_merge_membership_lineage_required')
  }

  const backfill: Record<string, unknown> = {}
  for (const column of editableColumns) {
    if (!SAFE_COLUMN.test(column)) throw new Error('contact_merge_invalid_column')
    const keeperValue = keeper[column]
    const mergedValue = merged[column]
    const keeperBlank = contactMergeValueIsBlank(column, keeperValue)
    const mergedHasValue = !contactMergeValueIsBlank(column, mergedValue)
    if (keeperBlank && mergedHasValue) backfill[column] = mergedValue
  }
  const finalKeeper = { ...keeper, ...backfill }
  const keeperName = String(finalKeeper.name || '')
  const statements: ContactMergeStatement[] = [contactSnapshotGuard(table, editableColumns, keeper, merged)]

  const backfilled = Object.keys(backfill)
  const keeperUpdate: ContactMergeStatement | null = backfilled.length
    ? {
      sql: `UPDATE ${table} SET ${backfilled.map((column) => `${column} = @${column}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
      params: { ...backfill, id: keepId },
    }
    : null

  if (table === 'customers') {
    const mergedNameLower = String(merged.name || '').trim().toLowerCase()
    statements.push(
      { sql: 'UPDATE sales SET customer_id = @keepId, customer_name = @keeperName, customer_phone = @keeperPhone, customer_address = @keeperAddress WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName, keeperPhone: finalKeeper.phone ?? null, keeperAddress: contactDisplayAddress(finalKeeper.address) || null } },
      { sql: 'UPDATE returns SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } },
      { sql: 'UPDATE customer_share_submissions SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } },
      { sql: 'UPDATE loyalty_point_adjustments SET customer_id = @keepId WHERE customer_id = @mergeId', params: { keepId, mergeId } },
      { sql: 'UPDATE portal_accounts SET contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE contact_id = @mergeId', params: { keepId, mergeId } },
    )
    if (input.hasCustomerReceivables) {
      statements.push({ sql: 'UPDATE customer_receivables SET customer_id = @keepId, customer_name = @keeperName WHERE customer_id = @mergeId', params: { keepId, mergeId, keeperName } })
      if (mergedNameLower) statements.push({ sql: 'UPDATE customer_receivables SET customer_name = @keeperName WHERE customer_id IS NULL AND lower(trim(customer_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } })
    }
  } else if (table === 'suppliers') {
    const mergedName = String(merged.name || '')
    const mergedNameLower = mergedName.trim().toLowerCase()
    statements.push(
      { sql: 'UPDATE returns SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } },
      { sql: 'UPDATE product_batches SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } },
    )
    if (mergedName) {
      statements.push(
        { sql: "UPDATE products SET supplier = @keeperName, updated_at = CURRENT_TIMESTAMP WHERE lower(trim(COALESCE(supplier, ''))) = @mergedNameLower", params: { keeperName, mergedNameLower } },
        { sql: 'UPDATE product_batches SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } },
      )
    }
    if (input.hasSupplierInvoices) {
      statements.push({ sql: 'UPDATE supplier_invoices SET supplier_id = @keepId, supplier_name = @keeperName WHERE supplier_id = @mergeId', params: { keepId, mergeId, keeperName } })
      if (mergedName) statements.push({ sql: 'UPDATE supplier_invoices SET supplier_name = @keeperName WHERE supplier_id IS NULL AND lower(trim(supplier_name)) = @mergedNameLower', params: { keeperName, mergedNameLower } })
    }
  } else {
    statements.push(
      { sql: 'UPDATE sales SET delivery_contact_id = @keepId, delivery_contact_name = @keeperName WHERE delivery_contact_id = @mergeId', params: { keepId, mergeId, keeperName } },
      { sql: 'UPDATE fees SET delivery_contact_id = @keepId, updated_at = CURRENT_TIMESTAMP WHERE delivery_contact_id = @mergeId', params: { keepId, mergeId } },
    )
  }

  const auditDetails = JSON.stringify({
    operationId: audit.operationId,
    mergedId: mergeId,
    mergedName: merged.name ?? null,
    backfilled,
  })
  statements.push({ sql: `DELETE FROM ${table} WHERE id = @id`, params: { id: mergeId } })
  // membership_number is unique. Delete its source row before backfilling the
  // same exact value onto a blank keeper; both statements remain in one batch,
  // so a later failure restores the source and removes the attempted backfill.
  if (keeperUpdate) statements.push(keeperUpdate)
  statements.push(
    {
      sql: `INSERT INTO audit_logs (
        user_id, user_name, action, entity, entity_id, details,
        table_name, record_id, new_value, device_name, device_tz
      ) VALUES (
        @userId, @userName, 'merge', @entity, @entityId, @details,
        @entity, @entityId, @details, @deviceName, @deviceTz
      )`,
      params: {
        userId: audit.userId,
        userName: audit.userName,
        entity,
        entityId: keepId,
        details: auditDetails,
        deviceName: audit.deviceName,
        deviceTz: audit.deviceTz,
      },
    },
  )
  assertPlanBounds(statements)
  return { statements, backfilled, finalKeeper }
}
import { contactDisplayAddress } from './contactOptions'

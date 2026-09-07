import { createHash } from 'node:crypto'

export const PLAN_ID = 'historical-shop-branch-metadata-20260907-grouped'
export const EXPECTED_ACCOUNT_ID = '743e5b727d139e85ed11679097f6f99e'
export const EXPECTED_DATABASE_ID = '49795be9-eabe-43f1-8e16-b86faed60cb1'
export const MAX_IDS_PER_GROUP = 99
export const EXPECTED_COUNTS = Object.freeze({ fees: 4255, sales: 22, sale_items: 56 })
export const APPLY_ACTION = 'historical_branch_metadata_repair_group_applied'
export const RECOVERY_ACTION = 'historical_branch_metadata_repair_group_recovered'
export const START_ACTION = 'historical_branch_metadata_repair_started'
export const COMPLETE_ACTION = 'historical_branch_metadata_repair_completed'
export const EXPECTED_ACTOR = Object.freeze({
  kind: 'service',
  user_id: null,
  user_name: 'Codex maintenance (owner-authorized)',
  origin: 'private_grouped_historical_repair_operator',
  task: PLAN_ID,
  cloudflare_account_id: EXPECTED_ACCOUNT_ID,
})

const TABLES = Object.freeze(['fees', 'sales', 'sale_items'])
const TARGET_VALUES = Object.freeze({
  fees: Object.freeze({ branch_id: 2 }),
  sales: Object.freeze({ branch_id: 2, branch_name: 'Shop' }),
  sale_items: Object.freeze({ branch_id: 2 }),
})

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}
export const stableJson = (value) => JSON.stringify(stable(value))
export const fingerprint = (value) => sha256(stableJson(value))
export const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key))
export const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`
const positiveInteger = (value, label = 'ID') => {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`)
  return value
}
const idLiterals = (ids) => ids.map((id) => String(positiveInteger(id))).join(',')
const chunk = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
const safeIdentifier = (value) => {
  assert(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value), 'invalid SQL identifier')
  return `"${value}"`
}

export function balancedAnd(terms) {
  assert(Array.isArray(terms) && terms.length > 0 && terms.every((term) => typeof term === 'string' && term), 'balanced AND requires non-empty terms')
  let level = [...terms]
  while (level.length > 1) {
    const next = []
    for (let index = 0; index < level.length; index += 2) next.push(index + 1 < level.length ? `(${level[index]}\n      AND ${level[index + 1]})` : level[index])
    level = next
  }
  return level[0]
}

const sortRows = (rows) => [...rows].sort((left, right) => Number(left.id) - Number(right.id))
const exactColumnSet = (row, columns) => Object.keys(row).sort().join('\n') === [...columns].sort().join('\n')
const validateScalar = (value) => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))

export function rowsHash(rows) {
  return fingerprint(sortRows(rows))
}

export function withTargetValues(rows, table, repaired) {
  const values = TARGET_VALUES[table]
  assert(values, `unknown repair table ${table}`)
  return sortRows(rows).map((row) => {
    const copy = { ...row }
    for (const [field, repairedValue] of Object.entries(values)) copy[field] = repaired ? repairedValue : null
    return copy
  })
}

function validateSchemaColumns(columns) {
  assert(columns && typeof columns === 'object' && !Array.isArray(columns), 'schema columns are required')
  const expectedLengths = { fees: 14, sales: 65, sale_items: 30 }
  for (const table of TABLES) {
    const list = columns[table]
    assert(Array.isArray(list) && list.length === expectedLengths[table], `${table} schema must contain exactly ${expectedLengths[table]} columns`)
    assert(new Set(list).size === list.length && list.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)), `${table} schema columns are invalid`)
    assert(list.includes('id'), `${table} schema lacks id`)
    for (const field of Object.keys(TARGET_VALUES[table])) assert(list.includes(field), `${table} schema lacks ${field}`)
  }
  assert(columns.sales.at(-1) === 'creation_snapshot_json', 'Sales column 65 must be creation_snapshot_json')
}

function validateReadSet(rows, columns, phase = 'pre') {
  assert(rows && typeof rows === 'object' && !Array.isArray(rows), `${phase} row set is required`)
  for (const table of TABLES) {
    assert(Array.isArray(rows[table]) && rows[table].length === EXPECTED_COUNTS[table], `${phase} ${table} row count mismatch`)
    const sorted = sortRows(rows[table])
    const ids = new Set()
    for (const row of sorted) {
      assert(row && typeof row === 'object' && !Array.isArray(row), `${phase} ${table} contains a non-object row`)
      assert(exactColumnSet(row, columns[table]), `${phase} ${table} row columns do not match the pinned schema`)
      positiveInteger(row.id, `${phase} ${table}.id`)
      assert(!ids.has(row.id), `${phase} ${table} contains duplicate ID ${row.id}`)
      ids.add(row.id)
      assert(Object.values(row).every(validateScalar), `${phase} ${table} contains a value that cannot be guarded without type loss`)
      for (const field of Object.keys(TARGET_VALUES[table])) assert(row[field] === null, `${phase} ${table}.${field} is already populated`)
    }
  }
  assert(rows.fees.every((row) => row.sale_id === null), 'fee targets must remain independent of Sales rows')
  assert(rows.sales.every((row) => row.creation_snapshot_json === null), 'historical Sales targets must have NULL creation_snapshot_json')
  const saleIds = new Set(rows.sales.map((row) => Number(row.id)))
  assert(rows.sale_items.every((row) => saleIds.has(Number(row.sale_id))), 'sale-item targets must belong to the related Sales group')
}

function groupContent(group) {
  const value = without(group, 'content_sha256')
  return { ...value, content_sha256: fingerprint(value) }
}

export function buildGroupedManifest(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'execution input is required')
  validateSchemaColumns(input.schema_columns)
  validateReadSet(input.read_1, input.schema_columns, 'read 1')
  validateReadSet(input.read_2, input.schema_columns, 'read 2')
  for (const table of TABLES) assert(rowsHash(input.read_1[table]) === rowsHash(input.read_2[table]), `${table} read 2 differs from read 1`)
  assert(/^[0-9a-f]{64}$/.test(input.schema_sha256 || ''), 'production schema SHA-256 is invalid')
  assert(/^[0-9a-f]{40}$/.test(input.source_lineage_commit || ''), 'source lineage commit is invalid')
  assert(typeof input.run_id === 'string' && /^[A-Za-z0-9_-]{16,160}$/.test(input.run_id), 'run ID is invalid')
  assert(typeof input.time_travel_bookmark === 'string' && input.time_travel_bookmark.trim(), 'Time Travel bookmark is missing')
  assert(input.cloudflare_operator?.account_id === EXPECTED_ACCOUNT_ID, 'Cloudflare account mismatch')
  assert(/^[A-Za-z0-9_-]{8,128}$/.test(input.cloudflare_operator?.api_token_id || ''), 'Cloudflare API token ID is invalid')

  const first = Object.fromEntries(TABLES.map((table) => [table, sortRows(input.read_1[table])]))
  const feeGroups = chunk(first.fees, MAX_IDS_PER_GROUP).map((rows, index) => groupContent({
    id: `fees-${String(index + 1).padStart(3, '0')}`,
    ordinal: index + 1,
    kind: 'fees',
    tables: {
      fees: {
        ids: rows.map((row) => row.id),
        count: rows.length,
        pre_full_row_sha256: rowsHash(rows),
        post_full_row_sha256: rowsHash(withTargetValues(rows, 'fees', true)),
      },
    },
  }))
  assert(feeGroups.length === 43, 'the frozen fee census must produce exactly 43 bounded groups')
  const relatedGroup = groupContent({
    id: 'sales-related',
    ordinal: 44,
    kind: 'sales_related',
    tables: {
      sales: {
        ids: first.sales.map((row) => row.id),
        count: first.sales.length,
        pre_full_row_sha256: rowsHash(first.sales),
        post_full_row_sha256: rowsHash(withTargetValues(first.sales, 'sales', true)),
      },
      sale_items: {
        ids: first.sale_items.map((row) => row.id),
        count: first.sale_items.length,
        pre_full_row_sha256: rowsHash(first.sale_items),
        post_full_row_sha256: rowsHash(withTargetValues(first.sale_items, 'sale_items', true)),
      },
    },
  })
  const manifest = {
    schema_version: 1,
    plan_id: PLAN_ID,
    status: 'prepared_for_review; production execution remains hash-pinned and confirmation-gated',
    source: {
      source_lineage_commit: input.source_lineage_commit,
      production_schema_sha256: input.schema_sha256,
      census: 'fresh post-UI-merge full-row reads required',
    },
    execution: {
      run_id: input.run_id,
      time_travel_bookmark: input.time_travel_bookmark,
      actor_key: 'codex-maintenance-owner-authorized',
      actor: { ...EXPECTED_ACTOR },
      cloudflare_operator: { account_id: input.cloudflare_operator.account_id, api_token_id: input.cloudflare_operator.api_token_id },
    },
    schema_columns: Object.fromEntries(TABLES.map((table) => [table, [...input.schema_columns[table]]])),
    target: {
      branch_id: 2,
      branch_name: 'Shop',
      rows: { ...EXPECTED_COUNTS, total: Object.values(EXPECTED_COUNTS).reduce((sum, value) => sum + value, 0) },
      columns: { fees: ['branch_id'], sales: ['branch_id', 'branch_name'], sale_items: ['branch_id'] },
    },
    transaction_model: {
      group_count: 44,
      fee_group_count: 43,
      maximum_fee_rows_per_group: MAX_IDS_PER_GROUP,
      related_sales_and_items_atomic: true,
      completion: '45 exact post-state full-row guards and one immutable completion audit in one D1Database.batch()',
      ambiguity_rule: 'inspect exact group audit and full-row state; never blind retry',
    },
    groups: [...feeGroups, relatedGroup],
  }
  manifest.content_sha256 = fingerprint(manifest)
  return manifest
}

function validateGroup(group, index) {
  assert(group?.ordinal === index + 1, `group ${index} ordinal mismatch`)
  assert(group.id === (index < 43 ? `fees-${String(index + 1).padStart(3, '0')}` : 'sales-related'), `group ${index} ID mismatch`)
  assert(group.kind === (index < 43 ? 'fees' : 'sales_related'), `group ${group.id} kind mismatch`)
  assert(fingerprint(without(group, 'content_sha256')) === group.content_sha256, `group ${group.id} content hash mismatch`)
  const expectedTables = index < 43 ? ['fees'] : ['sales', 'sale_items']
  assert(Object.keys(group.tables || {}).join('\n') === expectedTables.join('\n'), `group ${group.id} table set mismatch`)
  for (const table of expectedTables) {
    const descriptor = group.tables[table]
    assert(Array.isArray(descriptor.ids) && descriptor.ids.length === descriptor.count && descriptor.count > 0, `group ${group.id} ${table} count mismatch`)
    assert(descriptor.ids.length <= MAX_IDS_PER_GROUP, `group ${group.id} exceeds the row limit`)
    assert(new Set(descriptor.ids).size === descriptor.ids.length, `group ${group.id} contains duplicate IDs`)
    descriptor.ids.forEach((id) => positiveInteger(id, `${group.id} ${table} ID`))
    assert(/^[0-9a-f]{64}$/.test(descriptor.pre_full_row_sha256 || '') && /^[0-9a-f]{64}$/.test(descriptor.post_full_row_sha256 || ''), `group ${group.id} ${table} hashes are invalid`)
    assert(descriptor.pre_full_row_sha256 !== descriptor.post_full_row_sha256, `group ${group.id} ${table} pre/post hashes are identical`)
  }
}

export function validateManifest(manifest, options = {}) {
  assert(manifest?.schema_version === 1 && manifest.plan_id === PLAN_ID, 'grouped manifest identity mismatch')
  assert(fingerprint(without(manifest, 'content_sha256')) === manifest.content_sha256, 'grouped manifest fingerprint mismatch')
  if (options.reviewedManifestSha256 !== undefined) {
    assert(/^[0-9a-f]{64}$/.test(options.reviewedManifestSha256 || ''), 'operator has no reviewed manifest pin')
    assert(manifest.content_sha256 === options.reviewedManifestSha256, 'manifest differs from the reviewed operator pin')
  }
  if (options.reviewedLineageCommit !== undefined) {
    assert(/^[0-9a-f]{40}$/.test(options.reviewedLineageCommit || ''), 'operator has no reviewed lineage pin')
    assert(manifest.source?.source_lineage_commit === options.reviewedLineageCommit, 'manifest source lineage differs from the reviewed operator pin')
  }
  assert(/^[0-9a-f]{64}$/.test(manifest.source?.production_schema_sha256 || ''), 'manifest schema hash is invalid')
  validateSchemaColumns(manifest.schema_columns)
  assert(manifest.execution?.actor_key === 'codex-maintenance-owner-authorized' && stableJson(manifest.execution.actor) === stableJson(EXPECTED_ACTOR), 'manifest service actor mismatch')
  assert(manifest.execution.cloudflare_operator?.account_id === EXPECTED_ACCOUNT_ID && /^[A-Za-z0-9_-]{8,128}$/.test(manifest.execution.cloudflare_operator?.api_token_id || ''), 'manifest Cloudflare operator mismatch')
  assert(typeof manifest.execution.run_id === 'string' && manifest.execution.run_id.length >= 16, 'manifest run ID is invalid')
  assert(typeof manifest.execution.time_travel_bookmark === 'string' && manifest.execution.time_travel_bookmark.trim(), 'manifest bookmark is missing')
  assert(manifest.target?.rows?.fees === EXPECTED_COUNTS.fees && manifest.target?.rows?.sales === EXPECTED_COUNTS.sales && manifest.target?.rows?.sale_items === EXPECTED_COUNTS.sale_items, 'manifest target counts changed')
  assert(Array.isArray(manifest.groups) && manifest.groups.length === 44, 'manifest must contain exactly 44 groups')
  manifest.groups.forEach(validateGroup)
  const seen = Object.fromEntries(TABLES.map((table) => [table, new Set()]))
  for (const group of manifest.groups) for (const [table, descriptor] of Object.entries(group.tables)) for (const id of descriptor.ids) {
    assert(!seen[table].has(id), `${table} ID ${id} appears in more than one group`)
    seen[table].add(id)
  }
  for (const table of TABLES) assert(seen[table].size === EXPECTED_COUNTS[table], `manifest ${table} union count mismatch`)
  return manifest
}

function auditKeyCondition(manifest, group, action) {
  return `action=${sqlString(action)} AND entity=${sqlString('historical_metadata_repair')} AND entity_id=${sqlString(manifest.execution.run_id)} AND record_id=${sqlString(group.id)}`
}

function planAuditCondition(manifest, action) {
  return `action=${sqlString(action)} AND entity=${sqlString('historical_metadata_repair')} AND entity_id=${sqlString(manifest.execution.run_id)} AND record_id='plan'`
}

export function fullRowGuard(table, rows, columns, label, extraConditions = []) {
  assert(TABLES.includes(table), 'full-row guard table is not allowlisted')
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_IDS_PER_GROUP, 'full-row guard row count is invalid')
  const idIndex = columns.indexOf('id')
  assert(idIndex >= 0, 'full-row guard lacks id')
  const expectedKeys = [...columns].sort().join('\n')
  const positionalRows = sortRows(rows).map((row) => {
    assert(Object.keys(row).sort().join('\n') === expectedKeys, 'full-row guard row columns do not match schema')
    return columns.map((column) => {
      const value = row[column]
      assert(validateScalar(value), 'full-row guard contains an unsupported value')
      return value
    })
  })
  const comparisons = balancedAnd(columns.map((column, index) => `actual.${safeIdentifier(column)} IS json_extract(expected.value, '$[${index}]')`))
  const rowCondition = `(SELECT COUNT(*) FROM ${safeIdentifier(table)} AS actual JOIN json_each(?) AS expected ON actual."id" IS json_extract(expected.value, '$[${idIndex}]') WHERE ${comparisons}) = ${rows.length}`
  const conditions = [...extraConditions, rowCondition]
  return {
    label,
    expected_changes: 0,
    sql: `SELECT CASE WHEN ${balancedAnd(conditions)} THEN 0 ELSE json('historical grouped repair guard failed') END AS full_row_guard`,
    params: [JSON.stringify(positionalRows)],
  }
}

function expectedAuditRow(manifest, action, recordId, details, oldValue, newValue) {
  return {
    user_id: null,
    user_name: EXPECTED_ACTOR.user_name,
    action,
    entity: 'historical_metadata_repair',
    entity_id: manifest.execution.run_id,
    details: JSON.stringify(details),
    table_name: 'historical_metadata_repair',
    record_id: recordId,
    old_value: JSON.stringify(oldValue),
    new_value: JSON.stringify(newValue),
  }
}

function auditSql(row) {
  const columns = Object.keys(row)
  const values = columns.map((column) => row[column] === null ? 'NULL' : sqlString(row[column]))
  return `INSERT INTO audit_logs (${columns.join(',')}) VALUES (${values.join(',')})`
}

function auditRowCondition(row) {
  return balancedAnd(Object.entries(row).map(([column, value]) => value === null ? `${safeIdentifier(column)} IS NULL` : `${safeIdentifier(column)}=${sqlString(value)}`))
}

function exactAuditCondition(row) {
  const keyCondition = balancedAnd(['action', 'entity', 'entity_id', 'record_id'].map((column) => `${safeIdentifier(column)}=${sqlString(row[column])}`))
  return balancedAnd([
    `(SELECT COUNT(*) FROM audit_logs WHERE ${auditRowCondition(row)})=1`,
    `(SELECT COUNT(*) FROM audit_logs WHERE ${keyCondition})=1`,
  ])
}

function auditDetails(manifest, group, phase) {
  return {
    plan_id: manifest.plan_id,
    run_id: manifest.execution.run_id,
    manifest_sha256: manifest.content_sha256,
    group_id: group?.id || 'plan',
    group_sha256: group?.content_sha256 || null,
    phase,
    tables: group?.tables || null,
    attribution: {
      actor: manifest.execution.actor,
      cloudflare_operator: manifest.execution.cloudflare_operator,
      authorization: 'owner-authorized historical branch metadata correction',
    },
  }
}

function updateStatement(group, table, recovery = false) {
  const descriptor = group.tables[table]
  const ids = idLiterals(descriptor.ids)
  if (table === 'sales') return {
    label: `${group.id}:${recovery ? 'recover' : 'apply'}:sales`,
    expected_changes: descriptor.count,
    sql: recovery
      ? `UPDATE sales SET branch_id=NULL, branch_name=NULL WHERE branch_id=2 AND branch_name='Shop' AND id IN (${ids})`
      : `UPDATE sales SET branch_id=2, branch_name='Shop' WHERE branch_id IS NULL AND branch_name IS NULL AND id IN (${ids})`,
    params: [],
  }
  return {
    label: `${group.id}:${recovery ? 'recover' : 'apply'}:${table}`,
    expected_changes: descriptor.count,
    sql: recovery
      ? `UPDATE ${safeIdentifier(table)} SET branch_id=NULL WHERE branch_id=2 AND id IN (${ids})`
      : `UPDATE ${safeIdentifier(table)} SET branch_id=2 WHERE branch_id IS NULL AND id IN (${ids})`,
    params: [],
  }
}

function applyAuditStatement(manifest, group) {
  const row = expectedApplyAuditRow(manifest, group)
  return {
    label: `${group.id}:apply-audit`,
    expected_changes: 1,
    sql: auditSql(row),
    params: [],
  }
}

function expectedApplyAuditRow(manifest, group) {
  return expectedAuditRow(manifest, APPLY_ACTION, group.id, auditDetails(manifest, group, 'apply'), Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, { full_row_sha256: descriptor.pre_full_row_sha256 }])), Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, { full_row_sha256: descriptor.post_full_row_sha256 }])))
}

function startAuditStatement(manifest) {
  const row = expectedStartAuditRow(manifest)
  return {
    label: 'plan:start-audit',
    expected_changes: 1,
    sql: auditSql(row),
    params: [],
  }
}

function expectedStartAuditRow(manifest) {
  return expectedAuditRow(manifest, START_ACTION, 'plan', auditDetails(manifest, null, 'started'), { status: 'prepared' }, { status: 'started', group_count: 44 })
}

function recoveryAuditStatement(manifest, group) {
  const row = expectedRecoveryAuditRow(manifest, group)
  return {
    label: `${group.id}:recovery-audit`,
    expected_changes: 1,
    sql: auditSql(row),
    params: [],
  }
}

function expectedRecoveryAuditRow(manifest, group) {
  return expectedAuditRow(manifest, RECOVERY_ACTION, group.id, auditDetails(manifest, group, 'recovery'), Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, { full_row_sha256: descriptor.post_full_row_sha256 }])), Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, { full_row_sha256: descriptor.pre_full_row_sha256 }])))
}

export function buildApplyStatements(manifest, group, rows) {
  const auditConditions = [
    `(SELECT COUNT(*) FROM audit_logs WHERE ${auditKeyCondition(manifest, group, APPLY_ACTION)})=0`,
    `(SELECT COUNT(*) FROM audit_logs WHERE ${auditKeyCondition(manifest, group, RECOVERY_ACTION)})=0`,
    `(SELECT COUNT(*) FROM branches WHERE id=2 AND name='Shop' AND is_active=1 AND is_default=1)=1`,
  ]
  if (group.ordinal === 1) auditConditions.push(`(SELECT COUNT(*) FROM audit_logs WHERE ${planAuditCondition(manifest, START_ACTION)})=0`)
  else auditConditions.push(exactAuditCondition(expectedStartAuditRow(manifest)))
  const guards = Object.keys(group.tables).map((table, index) => fullRowGuard(table, rows[table], manifest.schema_columns[table], `${group.id}:pre-guard:${table}`, index === 0 ? auditConditions : []))
  const statements = [...guards]
  if (group.ordinal === 1) statements.push(startAuditStatement(manifest))
  statements.push(applyAuditStatement(manifest, group))
  for (const table of Object.keys(group.tables)) statements.push(updateStatement(group, table, false))
  return statements
}

export function buildRecoveryStatements(manifest, group, rows) {
  const auditConditions = [
    exactAuditCondition(expectedApplyAuditRow(manifest, group)),
    `(SELECT COUNT(*) FROM audit_logs WHERE ${auditKeyCondition(manifest, group, RECOVERY_ACTION)})=0`,
    exactAuditCondition(expectedStartAuditRow(manifest)),
  ]
  const guards = Object.keys(group.tables).map((table, index) => fullRowGuard(table, rows[table], manifest.schema_columns[table], `${group.id}:post-guard:${table}`, index === 0 ? auditConditions : []))
  return [...guards, recoveryAuditStatement(manifest, group), ...Object.keys(group.tables).map((table) => updateStatement(group, table, true))]
}

function completeAuditStatement(manifest) {
  const row = expectedCompleteAuditRow(manifest)
  return {
    label: 'plan:complete-audit',
    expected_changes: 1,
    sql: auditSql(row),
    params: [],
  }
}

function expectedCompleteAuditRow(manifest) {
  return expectedAuditRow(manifest, COMPLETE_ACTION, 'plan', auditDetails(manifest, null, 'completed'), { status: 'started', group_count: 44 }, { status: 'completed', group_count: 44 })
}

export function buildCompletionStatements(manifest, groupRows) {
  assert(groupRows && typeof groupRows === 'object', 'completion rows are required')
  const extra = [
    exactAuditCondition(expectedStartAuditRow(manifest)),
    `(SELECT COUNT(*) FROM audit_logs WHERE action=${sqlString(RECOVERY_ACTION)} AND entity_id=${sqlString(manifest.execution.run_id)})=0`,
    `(SELECT COUNT(*) FROM audit_logs WHERE ${planAuditCondition(manifest, COMPLETE_ACTION)})=0`,
  ]
  const guards = []
  for (const group of manifest.groups) for (const [table, descriptor] of Object.entries(group.tables)) {
    const groupAuditConditions = table === Object.keys(group.tables)[0]
      ? [exactAuditCondition(expectedApplyAuditRow(manifest, group)), `(SELECT COUNT(*) FROM audit_logs WHERE ${auditKeyCondition(manifest, group, RECOVERY_ACTION)})=0`]
      : []
    guards.push(fullRowGuard(table, groupRows[group.id][table], manifest.schema_columns[table], `complete:${group.id}:${table}`, [...(guards.length === 0 ? extra : []), ...groupAuditConditions]))
    assert(rowsHash(groupRows[group.id][table]) === descriptor.post_full_row_sha256, `completion input ${group.id} ${table} hash mismatch`)
  }
  assert(guards.length === 45, 'completion must contain exactly 45 full-row guards')
  return [...guards, completeAuditStatement(manifest)]
}

async function allRows(db, sql, params = []) {
  const result = await db.prepare(sql).bind(...params).all()
  assert(Array.isArray(result?.results), 'D1 read did not return rows')
  return result.results
}

const AUDIT_COLUMNS = ['user_id', 'user_name', 'action', 'entity', 'entity_id', 'details', 'table_name', 'record_id', 'old_value', 'new_value']

async function readGroupAuditRows(db, manifest, group) {
  return allRows(db, `SELECT ${AUDIT_COLUMNS.join(',')} FROM audit_logs WHERE entity='historical_metadata_repair' AND entity_id=? AND record_id=? AND action IN (?,?) ORDER BY id`, [manifest.execution.run_id, group.id, APPLY_ACTION, RECOVERY_ACTION])
}

async function readPlanAuditRows(db, manifest) {
  return allRows(db, `SELECT ${AUDIT_COLUMNS.join(',')} FROM audit_logs WHERE entity='historical_metadata_repair' AND entity_id=? AND record_id='plan' AND action IN (?,?) ORDER BY id`, [manifest.execution.run_id, START_ACTION, COMPLETE_ACTION])
}

export async function readGroupRows(db, group) {
  const result = {}
  for (const [table, descriptor] of Object.entries(group.tables)) result[table] = sortRows(await allRows(db, `SELECT * FROM ${safeIdentifier(table)} WHERE id IN (${idLiterals(descriptor.ids)}) ORDER BY id`))
  return result
}

const auditRowMatches = (actual, expected) => stableJson(actual) === stableJson(expected)
const exactActionRows = (rows, action, expected) => {
  const selected = rows.filter((row) => row.action === action)
  return selected.length === 1 && auditRowMatches(selected[0], expected)
}

export function classifyGroup(manifest, group, rows, groupAuditRows, planAuditRows) {
  const matches = (field) => Object.entries(group.tables).every(([table, descriptor]) => rows[table]?.length === descriptor.count && rowsHash(rows[table]) === descriptor[field])
  const applyRows = groupAuditRows.filter((row) => row.action === APPLY_ACTION)
  const recoveryRows = groupAuditRows.filter((row) => row.action === RECOVERY_ACTION)
  const startRows = planAuditRows.filter((row) => row.action === START_ACTION)
  const completeRows = planAuditRows.filter((row) => row.action === COMPLETE_ACTION)
  const startExact = exactActionRows(planAuditRows, START_ACTION, expectedStartAuditRow(manifest))
  const completeIntegrity = completeRows.length === 0 || exactActionRows(planAuditRows, COMPLETE_ACTION, expectedCompleteAuditRow(manifest))
  if (!completeIntegrity || startRows.length > 1 || applyRows.length > 1 || recoveryRows.length > 1) return 'inconsistent'
  const pendingStartValid = group.ordinal === 1 ? startRows.length === 0 : startExact
  if (completeRows.length === 0 && applyRows.length === 0 && recoveryRows.length === 0 && pendingStartValid && matches('pre_full_row_sha256')) return 'pending'
  if (startExact && exactActionRows(groupAuditRows, APPLY_ACTION, expectedApplyAuditRow(manifest, group)) && recoveryRows.length === 0 && matches('post_full_row_sha256')) return 'applied'
  if (startExact && exactActionRows(groupAuditRows, APPLY_ACTION, expectedApplyAuditRow(manifest, group)) && exactActionRows(groupAuditRows, RECOVERY_ACTION, expectedRecoveryAuditRow(manifest, group)) && matches('pre_full_row_sha256')) return 'recovered'
  return 'inconsistent'
}

export async function inspectGroup(db, manifest, group) {
  const [rows, groupAuditRows, planAuditRows] = await Promise.all([readGroupRows(db, group), readGroupAuditRows(db, manifest, group), readPlanAuditRows(db, manifest)])
  return { rows, groupAuditRows, planAuditRows, state: classifyGroup(manifest, group, rows, groupAuditRows, planAuditRows) }
}

export async function executeStatements(db, statements) {
  assert(Array.isArray(statements) && statements.length > 0, 'atomic group lacks statements')
  const prepared = statements.map((statement) => db.prepare(statement.sql).bind(...(statement.params || [])))
  const results = await db.batch(prepared)
  assert(Array.isArray(results) && results.length === statements.length, 'D1 batch result count mismatch')
  assert(results.every((result) => result?.success !== false), 'D1 batch returned an unsuccessful result')
  const mismatches = statements.flatMap((statement, index) => Number(results[index]?.meta?.changes) === statement.expected_changes ? [] : [{ index, label: statement.label, expected: statement.expected_changes, observed: Number(results[index]?.meta?.changes) }])
  return { results, mismatches }
}

export async function applyGroup(db, manifest, group, dependencies = {}) {
  const before = await inspectGroup(db, manifest, group)
  if (before.state === 'applied') return { group_id: group.id, status: 'already_applied' }
  assert(before.state === 'pending', `group ${group.id} is ${before.state}; refusing apply`)
  const statements = buildApplyStatements(manifest, group, before.rows)
  await dependencies.afterPreRead?.({ group, rows: before.rows, statements })
  let execution
  try { execution = await executeStatements(db, statements) }
  catch (error) {
    const afterFailure = await inspectGroup(db, manifest, group)
    if (afterFailure.state === 'applied') return { group_id: group.id, status: 'applied_after_ambiguous_response', statement_count: statements.length }
    if (afterFailure.state === 'pending') throw new Error(`group ${group.id} batch failed without an observed commit; explicit resume is required`)
    throw new Error(`group ${group.id} batch failed and post-state is ${afterFailure.state}; manual inspection is required`)
  }
  const after = await inspectGroup(db, manifest, group)
  assert(after.state === 'applied', `group ${group.id} did not reach the exact applied state`)
  assert(execution.mismatches.length === 0, `group ${group.id} committed with unexpected change metadata`)
  return { group_id: group.id, status: 'applied_and_verified', statement_count: statements.length }
}

export async function recoverGroup(db, manifest, group, dependencies = {}) {
  const before = await inspectGroup(db, manifest, group)
  if (before.state === 'recovered') return { group_id: group.id, status: 'already_recovered' }
  assert(before.state === 'applied', `group ${group.id} is ${before.state}; refusing recovery`)
  const statements = buildRecoveryStatements(manifest, group, before.rows)
  await dependencies.afterPreRead?.({ group, rows: before.rows, statements })
  let execution
  try { execution = await executeStatements(db, statements) }
  catch (error) {
    const afterFailure = await inspectGroup(db, manifest, group)
    if (afterFailure.state === 'recovered') return { group_id: group.id, status: 'recovered_after_ambiguous_response', statement_count: statements.length }
    if (afterFailure.state === 'applied') throw new Error(`group ${group.id} recovery failed without an observed commit; explicit recovery resume is required`)
    throw new Error(`group ${group.id} recovery failed and post-state is ${afterFailure.state}; manual inspection is required`)
  }
  const after = await inspectGroup(db, manifest, group)
  assert(after.state === 'recovered', `group ${group.id} did not reach the exact recovered state`)
  assert(execution.mismatches.length === 0, `group ${group.id} recovery committed with unexpected change metadata`)
  return { group_id: group.id, status: 'recovered_and_verified', statement_count: statements.length }
}

async function completionAuditState(db, manifest) {
  const rows = await readPlanAuditRows(db, manifest)
  const selected = rows.filter((row) => row.action === COMPLETE_ACTION)
  if (selected.length === 0) return 'absent'
  if (selected.length === 1 && auditRowMatches(selected[0], expectedCompleteAuditRow(manifest))) return 'exact'
  return 'invalid'
}

export async function completePlan(db, manifest, dependencies = {}) {
  const groupRows = {}
  for (const group of manifest.groups) {
    const inspected = await inspectGroup(db, manifest, group)
    assert(inspected.state === 'applied', `cannot complete plan while group ${group.id} is ${inspected.state}`)
    groupRows[group.id] = inspected.rows
  }
  const existing = await completionAuditState(db, manifest)
  if (existing === 'exact') return { status: 'already_completed' }
  assert(existing === 'absent', 'completion audit content or count is invalid')
  const statements = buildCompletionStatements(manifest, groupRows)
  await dependencies.afterPreRead?.({ groupRows, statements })
  let execution
  try { execution = await executeStatements(db, statements) }
  catch (error) {
    const state = await completionAuditState(db, manifest)
    if (state === 'exact') return { status: 'completed_after_ambiguous_response', statement_count: statements.length }
    if (state === 'absent') throw new Error('completion batch failed without an observed audit; explicit resume is required')
    throw new Error('completion batch failed with an invalid audit count; manual inspection is required')
  }
  assert(await completionAuditState(db, manifest) === 'exact', 'completion audit was not persisted exactly once with exact content')
  assert(execution.mismatches.length === 0, 'completion batch committed with unexpected change metadata')
  return { status: 'completed_and_verified', statement_count: statements.length }
}

export async function applyAllPending(db, manifest, dependencies = {}) {
  const groups = []
  for (const group of manifest.groups) {
    const result = await applyGroup(db, manifest, group, dependencies.groupDependencies?.(group) || {})
    groups.push(result)
    if (result.status === 'applied_after_ambiguous_response') return {
      status: 'paused_after_reconciled_ambiguous_response',
      groups,
      completion: null,
    }
  }
  const completion = await completePlan(db, manifest, dependencies.completion || {})
  return { status: 'all_groups_applied_and_verified', groups, completion }
}

export function summarizeManifest(manifest) {
  return {
    plan_id: manifest.plan_id,
    run_id: manifest.execution.run_id,
    manifest_sha256: manifest.content_sha256,
    source_lineage_commit: manifest.source.source_lineage_commit,
    production_schema_sha256: manifest.source.production_schema_sha256,
    groups: manifest.groups.length,
    fee_groups: manifest.groups.filter((group) => group.kind === 'fees').length,
    related_groups: manifest.groups.filter((group) => group.kind === 'sales_related').length,
    rows: manifest.target.rows,
    remote_binding_opened: false,
    production_write: false,
  }
}

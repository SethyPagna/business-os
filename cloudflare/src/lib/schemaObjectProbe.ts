// "Does this table or trigger exist" without one sqlite_master scan per question.
// sqlite_master has no index on name, so each `WHERE name = ?` reads the whole schema (about 770 rows).
// One exact `name IN (SELECT value FROM json_each(@names))` scan answers every declared object at once,
// and the positive answers are kept for the isolate (migrations only add objects; a miss is re-probed).

export type SchemaObjectKind = 'table' | 'trigger' | 'any'
export type SchemaObject = { kind: SchemaObjectKind; name: string }

export const SCHEMA_OBJECTS_PRESENT_SQL = "SELECT type, name FROM sqlite_master WHERE name IN (SELECT value FROM json_each(@names))"

type ProbeDb = { prepare(sql: string): { all<T = Record<string, unknown>>(params?: Record<string, unknown>): Promise<T[]>; allOnce?<T = Record<string, unknown>>(params?: Record<string, unknown>): Promise<T[]> } }

/** Every object a probe site asks about. The first scan of an isolate answers all of them; test-schema-object-probe-pure pins that each site is listed. */
export const KNOWN_SCHEMA_OBJECT_NAMES: readonly string[] = [
  'system_flags', 'stock_lot_adjustment_operations', 'stock_mutation_receipts', 'telegram_scheduled_sends',
  'fee_operation_receipts', 'transfer_receipts_require_provenance_insert', 'sales_money_precision_update_0161',
  'customer_receivables', 'supplier_invoices',
  'inventory_check_sessions', 'inventory_check_items', 'inventory_check_events', 'inventory_check_events_no_update',
  'inventory_check_events_no_delete', 'inventory_check_sessions_identity', 'inventory_check_sessions_no_delete',
  'inventory_check_items_baseline', 'inventory_check_items_no_delete',
  'inventory_check_approvals', 'inventory_check_approvals_identity', 'inventory_check_approvals_decided',
  'inventory_check_approvals_claim', 'inventory_check_approvals_no_delete',
]
const declared = new Set<string>(KNOWN_SCHEMA_OBJECT_NAMES)
const present = new Map<string, Set<string>>()

/** Forget remembered answers (a module's own test reset). */
export function forgetSchemaNames(names: readonly string[]): void {
  for (const name of names) present.delete(name)
}

export function resetSchemaObjectProbeForTests(): void {
  present.clear()
}

const held = (object: SchemaObject): boolean => {
  const types = present.get(object.name)
  return !!types && (object.kind === 'any' || types.has(object.kind))
}

/** True when every object exists. Exactly the per-object answer: type and name compared exactly, case-sensitively. */
export async function schemaObjectsPresent(db: ProbeDb, objects: readonly SchemaObject[], options: { once?: boolean } = {}): Promise<boolean> {
  if (objects.every(held)) return true
  const names = [...new Set([...declared, ...objects.map((object) => object.name)])]
  const statement = db.prepare(SCHEMA_OBJECTS_PRESENT_SQL)
  const run = options.once && statement.allOnce ? statement.allOnce.bind(statement) : statement.all.bind(statement)
  const rows = await run<{ type: string; name: string }>({ names: JSON.stringify(names) })
  for (const row of Array.isArray(rows) ? rows : []) {
    const types = present.get(row.name) ?? new Set<string>()
    types.add(row.type)
    present.set(row.name, types)
  }
  return objects.every(held)
}

export const schemaObjectPresent = (db: ProbeDb, object: SchemaObject, options: { once?: boolean } = {}): Promise<boolean> =>
  schemaObjectsPresent(db, [object], options)

// A delivery person (delivery_contacts row) is named by sales.delivery_contact_id and fees.delivery_contact_id. A hard
// delete of one that is still named leaves those rows pointing at an id that no longer exists, and the Deliveries
// report, the fee list and a sale's driver edit then lose the person. History is never deleted (owner rule), so a
// delete is refused while any sale or delivery fee names the person; merging into another delivery person repoints
// both columns (lib/contactMerge.ts) and is the way to retire a duplicate.
//
// Every hard-delete writer for delivery_contacts uses this module: DELETE /delivery-contacts/:id and the bulk-delete
// engine. The in-batch guard closes the gap between the usage read and the delete.
import type { D1Compat } from './db'

export const CONTACT_HAS_SALES_CODE = 'contact_has_sales'
export const DELIVERY_CONTACT_IN_USE_MARKER = 'delivery_contact_in_use'

export type DeliveryContactUsage = { sales: number; fees: number }

type Statement = { sql: string; params: Record<string, unknown> }

// One read for any number of ids (json_each), so a bulk chunk costs one call whatever its size.
export async function loadDeliveryContactUsage(db: D1Compat, ids: number[]): Promise<Map<number, DeliveryContactUsage>> {
  const usage = new Map<number, DeliveryContactUsage>()
  if (!ids.length) return usage
  const rows = await db.prepare(`
    SELECT contact_id, kind, COUNT(*) AS n FROM (
      SELECT delivery_contact_id AS contact_id, 'sales' AS kind FROM sales
        WHERE delivery_contact_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids))
      UNION ALL
      SELECT delivery_contact_id AS contact_id, 'fees' AS kind FROM fees
        WHERE delivery_contact_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids))
    ) GROUP BY contact_id, kind`).all<{ contact_id: number; kind: 'sales' | 'fees'; n: number }>({ ids: JSON.stringify(ids) })
  for (const row of rows) {
    const id = Number(row.contact_id)
    const entry = usage.get(id) ?? { sales: 0, fees: 0 }
    entry[row.kind] = Number(row.n) || 0
    usage.set(id, entry)
  }
  return usage
}

// Aborts the batch it sits in when any of the ids is named by a sale or fee.
export function buildDeliveryContactUsageGuard(ids: number[]): Statement {
  const named = `delivery_contact_id IN (SELECT CAST(value AS INTEGER) FROM json_each(@ids))`
  return {
    sql: `SELECT CASE WHEN EXISTS (SELECT 1 FROM sales WHERE ${named}) OR EXISTS (SELECT 1 FROM fees WHERE ${named})
      THEN json_extract('[]', '$[${DELIVERY_CONTACT_IN_USE_MARKER}]') ELSE 1 END AS delivery_contact_guard`,
    params: { ids: JSON.stringify(ids) },
  }
}

export function isDeliveryContactInUseError(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes(DELIVERY_CONTACT_IN_USE_MARKER)
}

export function deliveryContactInUseBody(name: unknown, usage: DeliveryContactUsage | undefined) {
  const sales = usage?.sales ?? 0
  const fees = usage?.fees ?? 0
  const label = String(name || '').trim() || 'This delivery person'
  return {
    error: `${label} is on ${sales} sale(s) and ${fees} delivery fee(s), so it can't be deleted. If it's a duplicate, merge it in Conflicts.`,
    code: CONTACT_HAS_SALES_CODE,
    sales,
    fees,
  }
}

// DELETE /delivery-contacts/:id: one atomic batch, the guard then the delete. A person a sale or fee names aborts the batch and
// nothing is deleted; only then are the counts read, for the message. A successful delete therefore costs one D1 call and no scan.
export async function deleteDeliveryContactUnlessUsed(db: D1Compat, id: number, name: unknown): Promise<{ deleted: true } | { deleted: false; body: ReturnType<typeof deliveryContactInUseBody> }> {
  try {
    await db.batch([buildDeliveryContactUsageGuard([id]), { sql: 'DELETE FROM delivery_contacts WHERE id = @id', params: { id } }])
  } catch (error) {
    if (!isDeliveryContactInUseError(error)) throw error
    return { deleted: false, body: deliveryContactInUseBody(name, (await loadDeliveryContactUsage(db, [id])).get(id)) }
  }
  return { deleted: true }
}

// reset-section "Delivery contacts": clears every delivery person no sale or fee names. Named ones stay, so no sale or
// fee is left pointing at a missing id; the rest of the table is what remains after this runs (the kept count).
export const RESET_UNUSED_DELIVERY_CONTACTS_SQL = `DELETE FROM delivery_contacts
  WHERE NOT EXISTS (SELECT 1 FROM sales WHERE sales.delivery_contact_id = delivery_contacts.id)
    AND NOT EXISTS (SELECT 1 FROM fees WHERE fees.delivery_contact_id = delivery_contacts.id)`

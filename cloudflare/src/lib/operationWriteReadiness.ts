import type { D1Compat } from './db'

/** Check each affected write so the Worker can safely precede its schema. */
export async function operationWritesReady(db: D1Compat): Promise<boolean> {
  try {
    const row = await db.prepare(`SELECT COUNT(*) AS ready FROM sqlite_master
      WHERE (type='table' AND name='fee_operation_receipts')
         OR (type='trigger' AND name='transfer_receipts_require_provenance_insert')`).get<{ ready: number }>()
    return row?.ready === 2
  } catch {
    return false
  }
}

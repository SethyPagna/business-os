// Which fee rows the cached sales report snapshot (the Sales stats strip, keyed on the 'sales' cache version) actually reads.
//
// lib/salesAnalytics.ts reads the fees table in exactly these ways, and in no other:
//   1. deliveryActualCostExpr / the delivery-courier EXISTS probes (:649, :1359, :1890): a row with COALESCE(fee_type,'') = 'delivery'
//      linked by sale_id decides whether a sale's own courier-cost column or the fee row is the courier cost.
//   2. the 'deliveryFees' read groups (:1447, :1955) and the standalone courier expense totals (:3470): every row with a
//      delivery_contact_id, whatever its type, by amount, contact and created_at.
// Neither reads a fee's label, notes or any other type, and nothing else under the 'sales' key reads fees (rankings, loyalty and the
// customer list do not). So a fee write moves what the snapshot shows only when the row, BEFORE or AFTER the write, is a delivery-type
// row or carries a delivery contact. A rent or stationery expense, a label rename and a rename between two custom types change
// nothing the snapshot reads, and bumping the shared 'sales' version for them would only throw away the Sales list, the customer list
// and the rankings caches for no reason. Keep this in step with those readers: if one starts reading another fee column or type, widen it
// (test-fee-sales-impact-pure.cjs pins the readers).
//
// feeWriteNeedsSalesBump: a write that turns `before` into `after` (either may be null for a create or a delete) needs a 'sales' bump only when
// either side is read.
//
// routes/fees.ts and lib/reviewApply.ts carry a byte-identical inline copy of everything below this line (marked feeSalesImpact:begin / end), so the
// many tests that load them with a hand-built require map need no new stub. test-fee-sales-impact-pure.cjs fails if a copy drifts.
export type FeeSnapshotShape = { fee_type?: unknown; delivery_contact_id?: unknown } | null | undefined

export function feeAffectsSalesSnapshot(fee: FeeSnapshotShape): boolean {
  if (!fee) return false
  if ((fee.fee_type ?? '') === 'delivery') return true
  return fee.delivery_contact_id != null && fee.delivery_contact_id !== ''
}

export function feeWriteNeedsSalesBump(before: FeeSnapshotShape, after: FeeSnapshotShape): boolean {
  return feeAffectsSalesSnapshot(before) || feeAffectsSalesSnapshot(after)
}

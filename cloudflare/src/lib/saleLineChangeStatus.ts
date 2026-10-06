// A change to a recorded sale's lines or delivery that leaves a PAID sale
// owing money makes it Not Paid -- the one rule POST /:id/items and
// POST /:id/amendments both apply, and the add-items undo/redo replays.
//
// Owner model (sale-status-and-edit-rules, Sep 23-24 2026): a sale has three
// statuses and paid means Completed, so a sale that still owes is Not Paid --
// its balance due is in every Not Paid list and total, and is collected later
// through a settlement or recorded as owed. The release verifier (6 Oct 2026)
// found both line-change routes broke that: raising a line's quantity on a
// paid $9.50 Completed sale left it Completed at $28.50 with $9.50 paid, and
// adding items did exactly the same. Neither route takes money, so the extra
// is recorded as owed: the sale becomes Not Paid in the same batch that moves
// its total.
//
// Coverage is the kernel's one definition of paid (lib/saleStatusResolution:
// covered to within half a cent); money that cannot be read owes the whole
// total, as outstandingAfterLineChangeUsd already answers in the responses.
//
// FORWARD ONLY. A change that leaves a Not Paid sale covered does not promote
// it: moving a sale to Completed stays the shop's act (PATCH /:id/status or a
// settlement), as the owner described Not Paid. Statuses other than the paid
// ones are left as they are.
//
// STOCK-NEUTRAL. completed, awaiting_delivery and awaiting_payment all hold
// stock deducted (lib/salesStatus.ts STOCK_DEDUCTED_STATUSES), so the move
// changes no held quantity.
//
// NOT A PAYMENT-CORRECTION REOPEN. The callers record the move under their
// own audit keys (sale_status_before / sale_status_after), never the
// newStatus/oldStatus pair PATCH /:id/status writes: that pair is what
// switches on payment_correction_allowed (routes/sales.ts
// saleAllowsPaymentCorrection), which lets the recorded tender be rewritten.
// Owing money because the basket grew is not that.
import { NOT_PAID_STATUS, PAID_SALE_STATUSES, recordedSaleOutstandingUsd, type RecordedSaleMoney } from './saleStatusResolution'

/** The sale's status once a line/delivery change moved its money to `saleAfter`. */
export function saleStatusAfterLineChange(statusBefore: unknown, saleAfter: RecordedSaleMoney): string {
  const before = String(statusBefore || 'completed')
  if (!PAID_SALE_STATUSES.includes(before.trim().toLowerCase())) return before
  let owes: boolean
  try {
    owes = recordedSaleOutstandingUsd(saleAfter) > 0
  } catch {
    owes = true
  }
  return owes ? NOT_PAID_STATUS : before
}

// The status write itself is saleStatusChangeStatements in lib/saleLineAddition.ts,
// beside the money write it travels with (the undo appliers replay both).

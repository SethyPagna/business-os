// 6.0.992: "Convert to current format" for an old-format return locked on a current-format sale.
//
// The Worker (cloudflare/src/lib/returnLegacyConvert.ts) is the authority: POST /api/returns/legacy-convert/preview
// shows what would be written and why a return cannot be converted; POST /api/returns/legacy-convert writes exactly the
// previewed digest and records one undoable history entry (both called from ReturnLegacyConvert.tsx). This file is pure:
// it decides only what the screen offers, so tests/returnLegacyConvert.test.ts runs it under node:
//   - the lock is shown to everyone who sees the return (a v0 return on a v1 sale, the Worker's PATCH refusal);
//   - Convert is offered only to an admin (canConvertLegacyReturns mirrors the Worker: admin + Returns Edit at Full,
//     and an admin always holds Returns Edit at Full); everyone else reads "an admin can review and convert it".
import { isAdminControlUser, type PermissionUser } from '../../../utils/permissions.ts'

export type LegacyConvertRow = {
  id: number
  return_number: string | null
  sale_id: number | null
  receipt_number: string | null
  status: string
  outcome: 'convert' | 'already_converted' | 'refused'
  code: string | null
  params: Record<string, unknown> | null
  total_refund_usd: number
  refund_currency: string | null
  owed_reduction_usd: number
  before: { total_refund_khr: number; calculated_refund_usd: number | null; rounding_adjustment_usd: number }
  after: { total_refund_khr: number; calculated_refund_usd: number | null; rounding_adjustment_usd: number } | null
  lines: Array<{ id: number; product_name: string | null; quantity: number; before_total_usd: number; after_total_usd: number | null }>
}
export type LegacyConvertPreview = { digest: string; rows: LegacyConvertRow[]; convertible: number[] }
export type LegacyConvertResult = { success: boolean; replayed: boolean; history_id: number | null; converted: number[] }

type LockSource = { money_precision_version?: unknown; sale_money_precision_version?: unknown; return_scope?: unknown } | null | undefined

/** A customer return stored in the older money format whose sale is in the current one: the Worker refuses to edit it. */
export function isLegacyReturnOnExactSale(ret: LockSource): boolean {
  if (!ret) return false
  if (String(ret.return_scope || 'customer') !== 'customer') return false
  return Number(ret.money_precision_version) !== 1 && Number(ret.sale_money_precision_version) === 1
}

export function canConvertLegacyReturns(user: PermissionUser): boolean {
  return isAdminControlUser(user)
}

/** What the screen offers for one return: nothing (not locked), the reason only, or the reason plus Convert. */
export function legacyConvertAccess(ret: LockSource, user: PermissionUser): 'convert' | 'reason_only' | null {
  if (!isLegacyReturnOnExactSale(ret)) return null
  return canConvertLegacyReturns(user) ? 'convert' : 'reason_only'
}

type Translate = (key: string, fallback: string) => string
const fill = (text: string, params: Record<string, unknown> | null | undefined): string =>
  text.replace(/\{(\w+)\}/g, (match, name: string) => (params && params[name] != null ? String(params[name]) : match))

/** The operator's-language reason one return cannot be converted. Pack keys are named after the Worker codes. */
export function legacyConvertReasonText(code: string | null, rawParams: Record<string, unknown> | null, T: Translate,
  money: { usd?: (value: number) => string; khr?: (value: number) => string } = {}): string {
  // Amounts arrive as numbers; the sentence shows them the way the rest of the screen does.
  const format = code === 'return_convert_riel_changed' ? money.khr : money.usd
  const params = rawParams && format
    ? Object.fromEntries(Object.entries(rawParams).map(([key, value]) => [key, (key === 'before' || key === 'after') && typeof value === 'number' ? format(value) : value]))
    : rawParams
  switch (code) {
    case 'return_convert_amount_changed':
      return fill(T('return_convert_amount_changed', 'The saved refund ({before}) is not what this sale allows today ({after}), so converting would change money. To correct it, cancel this return and record it again.'), params)
    case 'return_convert_line_changed':
      return fill(T('return_convert_line_changed', 'A line refund ({before}) differs from what the sale allows ({after}), so converting would change money. To correct it, cancel this return and record it again.'), params)
    case 'return_convert_riel_changed':
      return fill(T('return_convert_riel_changed', 'The riel refund ({before}) would change. Cancel this return and record it again to correct it.'), params)
    case 'return_convert_report_changed':
      return fill(T('return_convert_report_changed', 'Converting would change this sale in the sales report (revenue {before} to {after}). To correct it, cancel this return and record it again.'), params)
    case 'return_convert_sale_amended':
      return T('return_convert_sale_amended', 'The sale was changed after this return was recorded, so it cannot be converted. Record a new return instead.')
    case 'return_convert_line_unlinked':
    case 'return_convert_line_split':
    case 'return_convert_no_lines':
      return T('return_convert_line_unlinked', 'A line of this return cannot be matched to one line of the sale. Cancel this return and record it again.')
    case 'return_convert_not_locked':
      return T('return_convert_not_locked', 'This return is not locked. It can be edited as it is.')
    case 'return_convert_supplier':
      return T('return_convert_supplier', 'Supplier returns are not converted.')
    default:
      return T('return_convert_quote_refused', 'This sale cannot price this return today, so it cannot be converted. Cancel this return and record it again.')
  }
}

/** The operator's-language text for a failed preview or convert request: every Worker code has a pack sentence, so a
 * Khmer session never shows the Worker's English. */
export function legacyConvertFailureText(code: string, T: Translate): string {
  switch (code) {
    case 'return_convert_forbidden': return T('return_convert_admin_only', 'An admin can review and convert it.')
    case 'return_convert_preview_stale':
    case 'return_convert_changed': return T('return_convert_stale', 'These returns changed. Nothing was converted. Try again.')
    case 'return_convert_not_found': return T('return_convert_not_found', 'This return no longer exists. Refresh the list.')
    case 'maintenance_active': return T('return_convert_paused', 'Saving is paused for maintenance. Nothing was converted.')
    case 'return_convert_uncertain': return T('return_convert_uncertain', 'The result is not confirmed. Check the return before trying again.')
    default: return T('return_convert_failed', 'Nothing was converted. Try again.')
  }
}

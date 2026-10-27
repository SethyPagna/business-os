// 6.0.997 slice S1: the Edit Return screen for a current-format customer return -- reason, notes, handling method and each line's
// stock handling. Quantities, the refund and its currency are shown but cannot be changed here yet (the Worker refuses them with
// return_edit_money_locked and asserts every money figure unchanged). The screen never says "format", "v0" or "v1" (owner,
// 27 Oct 2026): where it must name the money it says "money details".
//
// The Worker (cloudflare/src/lib/returnEditV1.ts) is the authority: POST /api/returns/:id/edit/preview reads and plans,
// PATCH /api/returns/:id writes exactly the previewed digest. This file is pure so tests/returnEditCurrent.test.ts runs it
// under node: who is offered the form, the request body it builds, the review rows, and a sentence for every refusal code.
import { canConvertLegacyReturns } from './returnLegacyConvert.ts'
import { normalizeStockAction, type ReturnStockAction } from './returnOptions.ts'
import type { PermissionUser } from '../../../utils/permissions.ts'

export type CurrentReturnItem = {
  id?: number | string | null
  sale_item_id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  quantity?: number | string | null
  stock_action?: unknown
  return_to_stock?: unknown
}
export type CurrentReturn = {
  id?: number | string
  money_precision_version?: unknown
  return_scope?: unknown
  status?: unknown
  updated_at?: string | null
  reason?: string | null
  notes?: string | null
  return_type?: string | null
  items?: CurrentReturnItem[] | null
}

/** Full access to Returns with Edit not switched off -- admins AND managers. Mirrors the Worker's canEditCurrentReturns. */
export const canEditCurrentReturns = (user: PermissionUser): boolean => canConvertLegacyReturns(user)

export function isCurrentFormatCustomerReturn(ret: CurrentReturn | null | undefined): boolean {
  return !!ret && Number(ret.money_precision_version) === 1 && String(ret.return_scope || 'customer') === 'customer'
}

/** What the screen offers for one return: the form, only the reason (ask a manager), or the cancelled-return way out. */
export function currentReturnEditAccess(ret: CurrentReturn | null | undefined, user: PermissionUser): 'form' | 'ask_manager' | 'cancelled' | null {
  if (!isCurrentFormatCustomerReturn(ret)) return null
  if (String(ret!.status || 'completed') === 'cancelled') return 'cancelled'
  return canEditCurrentReturns(user) ? 'form' : 'ask_manager'
}

export type LineDraft = { id: number; action: ReturnStockAction; tag: string | null; tagTouched: boolean }
export type EditDraft = { reason: string; notes: string; returnType: string; lines: LineDraft[] }

export function initialDraft(ret: CurrentReturn): EditDraft {
  return {
    reason: String(ret.reason ?? ''), notes: String(ret.notes ?? ''), returnType: String(ret.return_type || 'restock'),
    lines: (Array.isArray(ret.items) ? ret.items : []).map((item) => ({ id: Number(item.id), action: normalizeStockAction(item), tag: null, tagTouched: false })),
  }
}

/** Has anything the Worker could save moved? (A tag only counts once the person picked one.) */
export function draftChanged(ret: CurrentReturn, draft: EditDraft): boolean {
  const start = initialDraft(ret)
  return draft.reason.trim() !== start.reason.trim() || draft.notes.trim() !== start.notes.trim() || draft.returnType !== start.returnType
    || draft.lines.some((line, index) => line.action !== start.lines[index]?.action || (line.action === 'damaged' && line.tagTouched))
}

/**
 * The preview/apply body. It carries the quantity each line already has (the Worker compares it) and NEVER a refund, a currency,
 * a price or a branch. A damaged line carries a tag only when the person chose one, so an untouched damaged line keeps its own.
 */
export function buildCurrentEditBody(ret: CurrentReturn, draft: EditDraft): Record<string, unknown> {
  const items = Array.isArray(ret.items) ? ret.items : []
  return {
    expected_updated_at: ret.updated_at ?? '',
    reason: draft.reason.trim(),
    notes: draft.notes.trim() || null,
    return_type: draft.returnType,
    items: items.map((item, index) => {
      const line = draft.lines[index]
      return {
        id: Number(item.id),
        ...(item.sale_item_id ? { sale_item_id: Number(item.sale_item_id) } : {}),
        quantity: Number(item.quantity),
        stock_action: line.action,
        ...(line.action === 'damaged' && line.tagTouched && line.tag ? { condition_tag: line.tag } : {}),
      }
    }),
  }
}

type Translate = (key: string, fallback: string) => string
const fill = (text: string, params: Record<string, unknown> | null | undefined): string =>
  text.replace(/\{(\w+)\}/g, (token, name: string) => (params && params[name] != null ? String(params[name]) : token))

export type EditPreview = {
  digest: string; changed: boolean
  header: Array<{ field: 'reason' | 'notes' | 'return_type'; before: string | null; after: string | null }>
  lines: Array<{ id: number; product_name: string | null; quantity: number; before: ReturnStockAction; after: ReturnStockAction; tag_before: string | null; tag_after: string | null }>
  stock: Array<{ product_id: number; product_name: string | null; branch_id: number; branch_name: string | null; batch_id: number | null; quantity: number; kind: 'sellable' | 'damaged' }>
}

const METHOD_WORD: Record<string, string> = { restock: 'Restock', writeoff: 'Write-off', refund: 'Refund Only' }
const ACTION_KEY: Record<ReturnStockAction, [string, string]> = {
  restock: ['stock_action_restock', 'Restock'], damaged: ['stock_action_damaged', 'Damaged'], none: ['stock_action_none', 'No restock'],
}
export function actionWord(action: ReturnStockAction, T: Translate): string { const [key, fallback] = ACTION_KEY[action] ?? ACTION_KEY.none; return T(key, fallback) }
const signed = (value: number): string => (value > 0 ? `+${value}` : String(value))

/** The compact review dialog rows: what moves, before -> after, in the operator's language. Money is not listed: it does not move. */
export function reviewRows(preview: EditPreview, T: Translate): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  for (const change of preview.header) {
    const label = change.field === 'reason' ? T('return_reason', 'Return reason') : change.field === 'notes' ? T('return_notes', 'Notes') : T('return_type_label', 'Handling Method')
    const word = (value: string | null) => (change.field === 'return_type' && value ? T(`return_type_${value}`, METHOD_WORD[value] ?? value) : value || '—')
    rows.push({ label, value: `${word(change.before)} → ${word(change.after)}` })
  }
  for (const line of preview.lines) {
    const tag = (value: string | null) => (value ? ` (${value})` : '')
    rows.push({ label: line.product_name || `#${Math.abs(line.id)}`,
      value: `${actionWord(line.before, T)}${tag(line.tag_before)} → ${actionWord(line.after, T)}${tag(line.tag_after)}` })
  }
  for (const move of preview.stock) {
    rows.push({ label: `${move.product_name || `#${move.product_id}`}${move.branch_name ? ` · ${move.branch_name}` : ''}`,
      value: `${signed(move.quantity)}${move.kind === 'damaged' ? ` ${T('stock_action_damaged', 'Damaged')}` : ''}` })
  }
  return rows
}

const SENTENCES: Record<string, string> = {
  return_edit_forbidden: 'Ask a manager or admin to edit this return.',
  return_edit_money_locked: "Quantities, lines, the refund and its currency can't be changed on this return yet. You can change the reason, notes and stock handling now. To correct an amount, cancel this return and record a new one.",
  return_edit_preview_stale: 'This return changed. Nothing was saved. Review it again.',
  return_edit_changed: 'This return or its stock changed while saving. Nothing was saved. Review it again.',
  return_edit_stock_too_low: 'Only {available} of {product} are in stock at {branch}, and {needed} must be taken back. Count it with Set, then edit again.',
  return_edit_damaged_used: 'Some damaged {product} from this return were already used or written off. Change the other lines, or record the correction with Set stock.',
  return_edit_damaged_unmatched: 'The damaged-stock record of {product} cannot be matched to the line, so its handling cannot change here. You can still change the reason and notes.',
  return_edit_damaged_remove: 'Keep it as damaged stock with a tag. Dispose of it from the product page afterwards.',
  return_edit_damaged_mixed_tags: 'Choose one tag for the damaged lines you change together.',
  return_edit_lot_unavailable: "No received date is recorded for {product}, so its units can't be put back from here. Add them with Add stock, or choose no stock change.",
  return_edit_provenance: 'This return has incomplete stock records. Count the stock with Set instead.',
  return_edit_sale_cancelled: "The sale was cancelled. Un-cancel the sale in Sales to change this return's stock handling, or change only the reason and notes.",
  return_edit_cancelled: 'This return is cancelled. Restore it, then edit.',
  return_edit_needs_money_update: "Update this return's money details first, then edit it.",
  return_edit_too_large: 'Edit fewer lines at a time.',
  return_edit_empty: 'A return must keep at least one line. To undo the whole return, cancel it instead.',
  return_edit_not_found: 'This return no longer exists. Refresh the list.',
  return_edit_invalid: 'Check the reason and notes, then try again.',
  return_edit_supplier: 'Supplier returns are edited from the supplier return screen.',
  idempotency_conflict: 'This change was already saved under another request. Open the return again.',
  expected_updated_at_required: 'Refresh this return before editing it.',
  client_request_id_required: 'Review the change again before saving it.',
  maintenance_active: 'Saving is paused for maintenance. Nothing was saved.',
  return_edit_uncertain: 'The result is not confirmed. Check the return before trying again.',
  return_edit_duplicate: 'This edit was recorded twice. Ask an administrator to review it.',
  return_edit_unreadable: 'The edit record cannot be read. Ask an administrator to review it.',
}
export const CURRENT_EDIT_CODES: readonly string[] = Object.freeze(Object.keys(SENTENCES))

/** The operator's-language sentence for a failed preview or save: every Worker code has a pack key named after it. */
export function currentEditFailureText(error: unknown, T: Translate): string | null {
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '') : ''
  if (!Object.prototype.hasOwnProperty.call(SENTENCES, code)) return null
  const params = (error as { params?: Record<string, unknown> }).params
  return fill(T(code, SENTENCES[code]), params)
}

/** A refusal the person fixes by reviewing again (the screen offers Reload). */
export const isStaleEdit = (error: unknown): boolean => ['return_edit_preview_stale', 'return_edit_changed'].includes(String((error as { code?: unknown } | null)?.code ?? ''))

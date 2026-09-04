import { useEffect, useState } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { fmtTime } from '../../utils/formatters.ts'
import CopyableId from '../shared/CopyableId.tsx'
import { DetailRow, DetailRowGroup, MoneyRow } from '../shared/DetailRows.tsx'
import { getReturn as fetchReturnDetail } from '../../api/returnsReadTransport.ts'
import { normalizeStockAction, stockActionOption } from './helpers/returnOptions.ts'

const CUSTOMER_SCOPE = 'customer'
const SUPPLIER_SCOPE = 'supplier'

type ReturnScope = typeof CUSTOMER_SCOPE | typeof SUPPLIER_SCOPE

interface ReturnLineItem {
  id?: string | number | null
  product_id?: string | number | null
  product_name?: string | null
  quantity?: number | string | null
  total_usd?: number | string | null
  total_khr?: number | string | null
  stock_action?: string | null
  return_to_stock?: boolean | number | null
}

interface ReplacementLineItem {
  id?: string | number | null
  product_name?: string | null
  quantity?: number | string | null
  total_usd?: number | string | null
  total_khr?: number | string | null
}

interface ReturnDetail {
  id?: number | string | null
  return_number?: string | null
  created_at?: string | Date | null
  items?: ReturnLineItem[] | null
  return_scope?: string | null
  supplier_settlement?: string | null
  return_type?: string | null
  receipt_number?: string | null
  replacement_sale_id?: number | string | null
  replacement_receipt_number?: string | null
  supplier_name?: string | null
  customer_name?: string | null
  branch_name?: string | null
  cashier_name?: string | null
  reason?: string | null
  notes?: string | null
  supplier_compensation_usd?: number | string | null
  supplier_loss_usd?: number | string | null
  supplier_compensation_khr?: number | string | null
  supplier_loss_khr?: number | string | null
  total_refund_usd?: number | string | null
  total_refund_khr?: number | string | null
  replacement_items?: ReplacementLineItem[] | null
  settlement_mode?: string | null
  settlement_diff_usd?: number | string | null
  settlement_diff_khr?: number | string | null
}

interface ReturnDetailModalProps {
  ret?: ReturnDetail | null
  onClose: () => void
  onEdit?: () => void
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

const useApp = useAppHook as () => {
  t?: (key: string) => string | undefined
}

function normalizeScope(value: unknown): ReturnScope {
  return value === SUPPLIER_SCOPE ? SUPPLIER_SCOPE : CUSTOMER_SCOPE
}

function coerceMoney(value: number | string | null | undefined): number | string {
  return value || 0
}

function isPositiveMoney(value: number | string | null | undefined): boolean {
  return Number(value || 0) > 0
}

export default function ReturnDetailModal({ ret, onClose, onEdit, fmtUSD, fmtKHR }: ReturnDetailModalProps) {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  // The Returns list read deliberately does not carry items -- one row per
  // return, no per-line fan-out (see routes/returns.ts GET /'s includeItems
  // gate). So the row this modal is handed has none, and every return opened
  // from the list read "Items (0)" with no lines and no replacement block.
  // Fetch them here, once per return, the same way the edit path already
  // does: the prop stays authoritative whenever it does carry them.
  const [fetched, setFetched] = useState<{ items: ReturnLineItem[]; replacement_items: ReplacementLineItem[] } | null>(null)
  const returnId = ret?.id ?? null
  const propItems = Array.isArray(ret?.items) && ret.items.length ? ret.items : null
  const needsFetch = returnId != null && !propItems
  useEffect(() => {
    if (!needsFetch || returnId == null) { setFetched(null); return }
    let alive = true
    setFetched(null)
    void (async () => {
      try {
        const detail = await fetchReturnDetail(returnId) as { items?: ReturnLineItem[] | null; replacement_items?: ReplacementLineItem[] | null } | null
        if (!alive || !detail) return
        setFetched({
          items: Array.isArray(detail.items) ? detail.items : [],
          replacement_items: Array.isArray(detail.replacement_items) ? detail.replacement_items : [],
        })
      } catch {
        // A failed line fetch must not blank a return the operator can already
        // read: the header keeps rendering what the list row carried.
      }
    })()
    return () => { alive = false }
  }, [needsFetch, returnId])

  if (!ret) return null
  const items = propItems && propItems.length ? propItems : (fetched?.items || [])
  const replacementItems = Array.isArray(ret.replacement_items) && ret.replacement_items.length
    ? ret.replacement_items
    : (fetched?.replacement_items || [])
  const scope = normalizeScope(ret.return_scope)
  const isSupplier = scope === SUPPLIER_SCOPE

  const typeLabel = isSupplier
    ? (ret.supplier_settlement || tr('settlement_refund', 'refund'))
    : (ret.return_type || tr('manual_return', 'manual'))

  return createPortal(
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center" onClick={onClose}>
      <div className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800" onClick={(event) => event.stopPropagation()}>
        {/* Same treatment as the sale receipt id: below sm the return id takes
            a full-width row of its own and wraps rather than being clipped or
            scrolled, with a one-tap copy control. */}
        <div className="flex flex-col gap-2 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CopyableId
              value={ret.return_number || ''}
              copyLabel={tr('copy_return_id', 'Copy return ID')}
              copiedLabel={tr('copied', 'Copied')}
              valueClassName="font-mono text-base font-bold text-gray-900 dark:text-white"
            />
            <div className="mt-1 text-xs text-gray-400">{fmtTime(ret.created_at)}</div>
          </div>
          {/* S4-24 (user, Sep 4 2026): "returns, print buttons end of page...
              not on top near the x close button". Edit moved to the footer,
              the same treatment the sale detail got, so the two records do not
              disagree about where a record's actions live. X stays: it is how
              you leave, not something you do to the return. */}
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onClose} aria-label={tr('close', 'Close')} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Same rhythm as the sale detail (fx/sale-detail-rows, Sep 3 2026):
            label/value ROWS through the shared DetailRow, and the money
            summary as MoneyRows inside the items table so the refund lands in
            the same right-aligned column as the line amounts. This modal had
            the identical defects -- stacked label-above-value blocks and a
            bare unlabelled KHR line under the refund total -- and fixing only
            the sale would have left the two record details disagreeing. */}
        <div className="modal-scroll space-y-4 p-4">
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <DetailRowGroup>
              <DetailRow
                label={tr('scope', 'Scope')}
                value={isSupplier ? tr('supplier_returns', 'Supplier Return') : tr('customer_returns', 'Customer Return')}
              />
              <DetailRow label={tr('type', 'Type')} value={typeLabel} />
              {ret.receipt_number ? (
                <DetailRow label={tr('original_receipt', 'Original Receipt')}>
                  <CopyableId
                    value={ret.receipt_number}
                    copyLabel={tr('copy_receipt_number', 'Copy receipt number')}
                    copiedLabel={tr('copied', 'Copied')}
                    valueClassName="font-mono text-sm text-blue-600 dark:text-blue-400"
                  />
                </DetailRow>
              ) : null}
              {ret.replacement_receipt_number ? (
                <DetailRow label={tr('replacement_sale_receipt', 'Replacement Sale Receipt')}>
                  <CopyableId
                    value={ret.replacement_receipt_number}
                    copyLabel={tr('copy_receipt_number', 'Copy receipt number')}
                    copiedLabel={tr('copied', 'Copied')}
                    valueClassName="font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400"
                  />
                </DetailRow>
              ) : null}
              <DetailRow
                label={isSupplier ? tr('supplier', 'Supplier') : tr('customer', 'Customer')}
                value={(isSupplier ? ret.supplier_name : ret.customer_name) || '-'}
              />
              <DetailRow label={tr('branch', 'Branch')} value={ret.branch_name || '-'} />
              <DetailRow label={tr('cashier', 'Cashier')} value={ret.cashier_name || '-'} />
              <DetailRow label={tr('reason', 'Reason')} value={ret.reason || '-'} />
              <DetailRow label={tr('notes', 'Notes')} value={ret.notes} />
            </DetailRowGroup>
          </div>

          <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {tr('items', 'Items')} ({items.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/35 dark:text-gray-400">
                  <tr>
                    <th className="px-1.5 py-1.5 text-left sm:px-2">{tr('product', 'Product')}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{tr('qty_short', 'Qty')}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{tr('line_total', 'Line total')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-sm text-gray-400">{tr('no_item_details', 'No item details available.')}</td>
                    </tr>
                  ) : items.map((item, index) => (
                    <tr key={`${item.id || item.product_id || 'item'}-${index}`}>
                      <td className="px-1.5 py-1.5 align-top sm:px-2">
                        {/* Damaged is a TAG on the line, next to the name -- the
                            product itself is never renamed to say so, so the name
                            here is the catalog name and the chip carries the
                            state. It sits beside the name rather than only in the
                            meta line below, where it read as one more attribute
                            instead of the flag that keeps the units out of
                            sellable stock. */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-words font-medium text-gray-800 dark:text-gray-200">{item.product_name || '-'}</span>
                          {!isSupplier && normalizeStockAction({ stock_action: item.stock_action, return_to_stock: item.return_to_stock !== 0 && item.return_to_stock !== false }) === 'damaged' ? (
                            <span
                              data-tag="damaged"
                              title={tr('stock_action_damaged_hint', 'Tracked as a damaged lot tied to this return — kept out of sellable stock.')}
                              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                            >
                              {stockActionOption('damaged').icon} {tr('stock_action_damaged', 'Damaged')}
                            </span>
                          ) : null}
                        </div>
                        {!isSupplier ? (() => {
                          const option = stockActionOption(normalizeStockAction({ stock_action: item.stock_action, return_to_stock: item.return_to_stock !== 0 && item.return_to_stock !== false }))
                          return <div className="text-[11px] text-gray-400">{option.icon} {tr(option.labelKey, option.labelEn)}</div>
                        })() : null}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-200">{item.quantity || 0}</td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 font-semibold tabular-nums text-gray-900 dark:text-white">
                        {fmtUSD(coerceMoney(item.total_usd))}
                        {isPositiveMoney(item.total_khr) ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(coerceMoney(item.total_khr))}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700">
                  {isSupplier ? (
                    <>
                      <MoneyRow
                        labelSpan={2}
                        tone="credit"
                        label={tr('supplier_compensation', 'Supplier compensation')}
                        amount={fmtUSD(coerceMoney(ret.supplier_compensation_usd))}
                        sub={isPositiveMoney(ret.supplier_compensation_khr) ? fmtKHR(coerceMoney(ret.supplier_compensation_khr)) : null}
                      />
                      <MoneyRow
                        labelSpan={2}
                        tone="discount"
                        label={tr('business_loss', 'Business loss')}
                        amount={fmtUSD(coerceMoney(ret.supplier_loss_usd))}
                        sub={isPositiveMoney(ret.supplier_loss_khr) ? fmtKHR(coerceMoney(ret.supplier_loss_khr)) : null}
                      />
                    </>
                  ) : (
                    <MoneyRow
                      labelSpan={2}
                      strong
                      label={tr('total_refunded', 'Total Refunded')}
                      amount={fmtUSD(coerceMoney(ret.total_refund_usd))}
                      sub={isPositiveMoney(ret.total_refund_khr) ? fmtKHR(coerceMoney(ret.total_refund_khr)) : null}
                    />
                  )}
                </tfoot>
              </table>
            </div>
          </section>

          {/* The replacement sale is a second, separate document, so it keeps
              its own table rather than being folded into the return's rows --
              but it now uses the same columns and the same MoneyRow footer as
              everything else instead of its own flex list. The supplier /
              customer money summary that used to repeat down here is gone: it
              is the tfoot of the items table above, where it aligns with the
              line amounts it is the sum of. */}
          {replacementItems.length > 0 ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                🔁 {tr('replacement_sale_items_label', 'Replacement sale items')} ({replacementItems.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-emerald-200 text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:border-emerald-800 dark:text-emerald-300/80">
                    <tr>
                      <th className="px-1.5 py-1.5 text-left sm:px-2">{tr('product', 'Product')}</th>
                      <th className="px-1.5 py-1.5 text-right sm:px-2">{tr('qty_short', 'Qty')}</th>
                      <th className="px-1.5 py-1.5 text-right sm:px-2">{tr('line_total', 'Line total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-100 dark:divide-emerald-800/60">
                    {replacementItems.map((line, index) => (
                      <tr key={`${line.id || 'replacement'}-${index}`}>
                        <td className="break-words px-1.5 py-1.5 align-top sm:px-2 text-gray-700 dark:text-gray-300">{line.product_name || '-'}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-300">{line.quantity || 0}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 font-medium tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(coerceMoney(line.total_usd))}
                          {isPositiveMoney(line.total_khr) ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(coerceMoney(line.total_khr))}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Two eras read side by side, on the shared row rhythm.
                      CURRENT: the replacement is its own sale, so the totals
                      row names that sale's receipt and its own total --
                      nothing is netted.
                      HISTORICAL: a return recorded under the old exchange
                      model carries settlement_mode/settlement_diff_usd
                      (migration 0074). Nothing writes those any more, but they
                      are the only record of what actually happened on that
                      day, so they are still read and shown -- labelled as the
                      settlement they were, never re-presented as today's
                      model. */}
                  <tfoot className="border-t border-emerald-200 dark:border-emerald-800">
                    {ret.settlement_mode ? (
                      <MoneyRow
                        marker="data-historical-settlement"
                        labelSpan={2}
                        tone="credit"
                        label={`${tr('historical_settlement', 'Recorded as an exchange')} · ${ret.settlement_mode === 'price_difference'
                          ? tr('price_difference', 'Price difference')
                          : tr('even_exchange', 'Even exchange')}`}
                        amount={ret.settlement_mode === 'price_difference'
                          ? (Number(ret.settlement_diff_usd || 0) > 0 ? '+' : '−') + fmtUSD(Math.abs(Number(ret.settlement_diff_usd || 0)))
                          : '±0'}
                        sub={ret.settlement_mode === 'price_difference' && isPositiveMoney(Math.abs(Number(ret.settlement_diff_khr || 0)))
                          ? (Number(ret.settlement_diff_usd || 0) > 0 ? '+' : '−') + fmtKHR(Math.abs(Number(ret.settlement_diff_khr || 0)))
                          : null}
                      />
                    ) : (
                      <MoneyRow
                        marker="data-replacement-sale"
                        labelSpan={2}
                        tone="credit"
                        label={`${tr('replacement_sale_total', 'New sale total')}${ret.replacement_receipt_number ? ` · ${ret.replacement_receipt_number}` : ''}`}
                        amount={fmtUSD(replacementItems.reduce((sum, line) => sum + Number(line.total_usd || 0), 0))}
                      />
                    )}
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}

          {/* S4-24: the record's actions, at the end of the record. */}
          {onEdit ? (
            <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end dark:border-gray-700">
              <button type="button" onClick={onEdit} className="btn-secondary w-full px-4 py-2 text-sm sm:w-auto">{tr('edit', 'Edit')}</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

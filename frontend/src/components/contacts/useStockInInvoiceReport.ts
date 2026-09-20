import { useEffect, useRef, useState } from 'react'
import { getStockInInvoiceLines, getStockInInvoiceReport } from '../../api/contactReadTransport.ts'
import { captureActorReadScope, isActorReadScopeCurrent } from '../../api/actorReadScope.ts'
import { clampPage } from '../shared/PaginationControls'

export type InvoiceGroup = {
  supplier_key: string
  supplier_name?: string | null
  received_day: string
  line_count: number
  units_received: number | null
  cost_usd: number | null
  lines_without_cost: number
  credit_lines: number
  branch_ids?: string | null
}

export type ReportTotals = {
  invoices?: number
  lines?: number
  units_received?: number
  cost_usd?: number
  lines_without_cost?: number
  credit_lines?: number
  invoices_without_branch?: number
}

export type ReportPayload = {
  invoices?: InvoiceGroup[]
  totals?: ReportTotals
  page?: number
  page_size?: number
  total_invoices?: number
  meta?: {
    branches?: Array<{ id: number; name?: string | null }>
    suppliers?: Array<{ key: string; name?: string | null }>
  }
}

export type InvoiceLine = {
  id: number
  batch_number?: number | null
  lot_code?: string | null
  received_at?: string | null
  received_quantity?: number | null
  unit_cost_usd?: number | null
  line_total_usd?: number | null
  payment_status?: string | null
  credit_due_date?: string | null
  received_branch_name?: string | null
  product_name?: string | null
  barcode?: string | null
  unit?: string | null
  remaining_quantity?: number | null
}

export type LinesState = {
  lines: InvoiceLine[]
  page: number
  pageSize: number
  total: number
  loading: boolean
  error: string
}

export const LINE_PAGE_SIZE = 100
export function groupKeyOf(group: InvoiceGroup): string {
  return `${group.supplier_key}|${group.received_day || 'none'}`
}

type Input = {
  branchId: string; supplierKey: string; fromDate: string; toDate: string
  page: number; pageSize: number; refreshToken: number; actorKey: string
  setPage: (page: number) => void; errorText: string
}
type View = {
  data: ReportPayload | null; loading: boolean; error: string
  lineCache: Record<string, LinesState>; detailGroup: InvoiceGroup | null
}
const emptyView = (): View => ({ data: null, loading: true, error: '', lineCache: {}, detailGroup: null })

/** One report generation owns its groups, selected detail and all line pages.
 * Mask at render, not effect time: even a response arriving before effect
 * cleanup cannot restore a previous filter/account's private invoice data. */
export function useStockInInvoiceReport(input: Input) {
  const { branchId, supplierKey, fromDate, toDate, page, pageSize, refreshToken, actorKey, setPage, errorText } = input
  const actor = captureActorReadScope('suppliers:stock-in-invoices')
  const key = JSON.stringify([actor.authority, actor.revision, actorKey, branchId, supplierKey, fromDate, toDate, page, pageSize, refreshToken])
  const scopeRef = useRef({ key, actor, lineRequests: new Map<string, object>() })
  if (scopeRef.current.key !== key) scopeRef.current = { key, actor, lineRequests: new Map() }
  const scope = scopeRef.current
  const alive = useRef(true)
  const [stored, setStored] = useState<{ scope: typeof scope; view: View }>(() => ({ scope, view: emptyView() }))
  const current = () => alive.current && scopeRef.current === scope && isActorReadScopeCurrent(scope.actor)
  const view = stored.scope === scope && current() ? stored.view : emptyView()
  const update = (fn: (previous: View) => View) => {
    if (!current()) return
    setStored(previous => current()
      ? { scope, view: fn(previous.scope === scope ? previous.view : emptyView()) }
      : previous)
  }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; scopeRef.current.lineRequests.clear() }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!current()) return
    getStockInInvoiceReport({
      branch_id: branchId === 'all' ? '' : branchId,
      supplier: supplierKey === 'all' ? '' : supplierKey,
      from: fromDate, to: toDate, page, page_size: pageSize,
    }).then(result => {
      if (cancelled || !current()) return
      const data = (result || {}) as ReportPayload
      const nextPage = clampPage(page, Number(data.total_invoices) || 0, pageSize)
      if (nextPage !== page) { setPage(nextPage); return }
      update(previous => ({ ...previous, data, loading: false, error: '' }))
    }).catch((error: unknown) => {
      if (cancelled || !current()) return
      update(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : errorText }))
    })
    return () => { cancelled = true }
    // The scope key includes every query and authority input; text changes
    // alone do not refetch or revoke the selected invoice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  const loadLines = (group: InvoiceGroup, linePage: number) => {
    if (!current()) return
    const groupKey = groupKeyOf(group)
    const request = {}
    scope.lineRequests.set(groupKey, request)
    const ownsRequest = () => current() && scope.lineRequests.get(groupKey) === request
    update(previous => ({ ...previous, lineCache: { ...previous.lineCache,
      [groupKey]: { lines: [], page: linePage, pageSize: LINE_PAGE_SIZE,
        total: previous.lineCache[groupKey]?.total || 0, loading: true, error: '' },
    } }))
    getStockInInvoiceLines({
      supplier_key: group.supplier_key, day: group.received_day || 'none',
      branch_id: branchId === 'all' ? '' : branchId, page: linePage, page_size: LINE_PAGE_SIZE,
    }).then(result => {
      if (!ownsRequest()) return
      const payload = (result || {}) as { lines?: InvoiceLine[]; total_lines?: number }
      const total = Number(payload.total_lines) || 0
      const nextPage = clampPage(linePage, total, LINE_PAGE_SIZE)
      // Recheck ownership before issuing a corrected-page request; no old
      // timer may reopen work after a filter change or unmount.
      if (nextPage !== linePage) { loadLines(group, nextPage); return }
      update(previous => !ownsRequest() ? previous : ({ ...previous, lineCache: { ...previous.lineCache,
        [groupKey]: { lines: Array.isArray(payload.lines) ? payload.lines : [], page: linePage,
          pageSize: LINE_PAGE_SIZE, total, loading: false, error: '' },
      } }))
    }).catch((error: unknown) => {
      if (!ownsRequest()) return
      update(previous => !ownsRequest() ? previous : ({ ...previous, lineCache: { ...previous.lineCache,
        [groupKey]: { ...previous.lineCache[groupKey], loading: false,
          error: error instanceof Error ? error.message : errorText },
      } }))
    })
  }
  const openGroup = (group: InvoiceGroup) => {
    if (!current()) return
    update(previous => ({ ...previous, detailGroup: group }))
    if (!view.lineCache[groupKeyOf(group)]) loadLines(group, 1)
  }
  return { ...view, loadLines, openGroup, closeGroup: () => update(previous => ({ ...previous, detailGroup: null })) }
}

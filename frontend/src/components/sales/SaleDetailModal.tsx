import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import X from 'lucide-react/dist/esm/icons/x.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { searchProducts } from '../../api/methods.ts'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { fmtDateTime24, fmtTime } from '../../utils/formatters.ts'
import { getSaleReturnBlockReason } from '../../utils/saleReturnGuard.ts'
import { buildProductGroups } from '../../utils/productGrouping.ts'
// S4-30: the STAFF-facing half of an amended sale. The receipt uses none of
// this -- it renders the net state the backend keeps in sale_items and the
// sales row, which is the whole point of the ledger split.
import {
  pairReplacements,
  saleLooksAmendable,
  toAmendmentDisplayRows,
  type AmendmentDisplayRow,
  type SaleAmendmentRow,
} from '../../utils/saleAmendments.ts'
import { receiptTotalsFigures } from '../../utils/receiptTotals.ts'
import CopyableId from '../shared/CopyableId.tsx'
import { DetailRow, DetailRowGroup, MoneyRow } from '../shared/DetailRows.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import StatusBadge, { getStatusLabel } from './StatusBadge.tsx'
import SaleDetailProductPicker, { type SaleDetailProductCandidate, type SaleDetailProductChoice } from './SaleDetailProductPicker.tsx'
import SaleStatusWorkflow from './SaleStatusWorkflow.tsx'
import { sanitizeSaleDetailText } from './saleDetailText.ts'
import SaleSettlementEditor, { MAX_SETTLEMENT_ROWS } from './SaleSettlementEditor.tsx'
import {
  buildSettlementPayload,
  configuredSettlementMethods,
  createSettlementRequestId,
  initialSettlementRows,
  recordedSettlementIssue,
  settlementRowsEqual,
  settlementRowsIssue,
  settlementTotals,
  type SettlementRow,
} from './saleSettlement.ts'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'

type TranslateFn = (key: string) => string
type MoneyFormatter = (value: number | string) => string

interface SaleLineItem {
  id?: string | number | null
  product_id?: string | number | null
  product_name?: string | null
  name?: string | null
  quantity?: number | string | null
  qty?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  price_usd?: number | string | null
  price_khr?: number | string | null
  price?: number | string | null
  branch_name?: string | null
  branch_id?: number | string | null
  returned_quantity?: number | string | null
}

interface SaleDetail {
  id: string | number
  receipt_number?: string | null
  source_return_id?: number | string | null
  created_at?: string | Date | null
  updated_at?: string | null
  sale_status?: string | null
  customer_membership_number?: string | null
  items?: SaleLineItem[] | string | null
  total_usd?: number | string | null
  total?: number | string | null
  total_khr?: number | string | null
  refund_usd?: number | string | null
  refund_khr?: number | string | null
  membership_discount_usd?: number | string | null
  membership_discount_khr?: number | string | null
  membership_points_redeemed?: number | string | null
  discount_usd?: number | string | null
  tax_usd?: number | string | null
  subtotal_usd?: number | string | null
  amount_paid_usd?: number | string | null
  amount_paid_khr?: number | string | null
  change_usd?: number | string | null
  cashier_name?: string | null
  payment_method?: string | null
  branch_name?: string | null
  branch_id?: number | string | null
  device_tz?: string | null
  device_name?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_address?: string | null
  notes?: string | null
  // Cancellation record (migration 0066) -- present only on cancelled
  // sales cancelled through the Part 383 flow; legacy/imported cancelled
  // rows keep these null and render as plain "cancelled".
  cancel_reason?: string | null
  cancel_note?: string | null
  cancelled_at?: string | null
  cancelled_by_name?: string | null
  status_before_cancel?: string | null
  cancel_fee_id?: number | string | null
  // Payment + delivery + KHR fields the admin detail view now surfaces. All
  // are already returned by GET /api/sales (SELECT s.*); the audit flagged
  // them as captured-but-shown-only-on-the-printable-receipt.
  subtotal_khr?: number | string | null
  discount_khr?: number | string | null
  tax_khr?: number | string | null
  /** S4-2's sticky flag: this sale is permanently outside the stock ledger. */
  stock_skipped?: number | string | null
  change_khr?: number | string | null
  exchange_rate?: number | string | null
  payment_currency?: string | null
  payment_details?: string | Array<{ method?: string | null; amount_usd?: number | string | null; amount_khr?: number | string | null }> | null
  is_delivery?: number | null
  delivery_fee_usd?: number | string | null
  delivery_fee_khr?: number | string | null
  /**
   * Who the fee fell on. `store` means the shop absorbed it and the customer
   * was NOT charged, so it is absent from total_usd -- see
   * utils/receiptTotals.ts. Already returned by GET /api/sales (SELECT s.*);
   * this screen simply never read it.
   */
  delivery_fee_paid_by?: string | null
  delivery_actual_cost_usd?: number | string | null
  delivery_actual_cost_khr?: number | string | null
  delivery_contact_name?: string | null
  delivery_contact_phone?: string | null
  delivery_contact_address?: string | null
  credit_due_date?: string | null
}

type ParsedPayment = { method: string; amount_usd: number; amount_khr: number }

// S4-24b -- the product picker's rows, and a line staged for adding.
type AddProductCandidate = SaleDetailProductCandidate

// S4-30: what this modal asks the server to change. Mirrors
// api/salesTransport.ts's SaleAmendmentRequest -- one shape, so the button and
// the request cannot drift.
interface SaleAmendmentRequest {
  kind: 'line_quantity_increased' | 'line_quantity_decreased' | 'line_removed' | 'line_replaced' | 'delivery_fee_changed'
  sale_item_id?: number
  quantity?: number
  delivery_fee_usd?: number
  replacement?: { product_id: number; quantity: number; applied_price_usd?: number; branch_id?: number | null }
  notes?: string
}

type StagedAddLine = {
  productId: number
  name: string
  quantity: number
  unitPriceUsd: number
  // The typed text is kept beside the number so a half-typed price ("1.")
  // survives a keystroke; unitPriceUsd stays the single numeric authority.
  priceText: string
  // What the picker last saw on hand, so the form can block an already-invalid
  // local choice. Never a substitute for the server's check: this number is
  // seconds old and another till may already have taken the units.
  stockQuantity: number
  barcode: string
  batchId: number | null
  batchLabel: string
  batchReceivedAt: string
  batchExpiryDate: string
  batchQuantity: number | null
}

// Which sale states accept a new line. Hand-synced twin of the Worker's
// SALE_STATUSES_ACCEPTING_NEW_LINES (lib/saleLineAddition.ts) -- the server
// is the authority and refuses anything else with a 400; this list only
// decides whether the surface is offered, so a cashier is never invited into
// a form whose submit is guaranteed to fail.
const STATUSES_ACCEPTING_ADDED_ITEMS = ['completed', 'awaiting_delivery', 'awaiting_payment']

function parsePaymentDetails(raw: SaleDetail['payment_details']): ParsedPayment[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? (() => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] } })()
      : []
  return list
    .map((entry) => ({
      method: String((entry as { method?: unknown })?.method ?? '').trim(),
      amount_usd: Number((entry as { amount_usd?: unknown })?.amount_usd) || 0,
      amount_khr: Number((entry as { amount_khr?: unknown })?.amount_khr) || 0,
    }))
    .filter((entry) => entry.method && (entry.amount_usd > 0 || entry.amount_khr > 0))
}

interface SaleDetailModalProps {
  sale?: SaleDetail | null
  settings?: unknown
  onClose: () => void
  // recordHistory/extra mirror Sales.tsx's handleStatusChange -- `extra`
  // carries the reviewed full tender when settling an awaiting-payment sale.
  onStatusChange?: (saleId: string | number, status: string, notes: string, recordHistory?: boolean, extra?: Record<string, unknown> | null) => Promise<unknown> | unknown
  onAttachMembership?: (saleId: string | number, membershipNumber: string) => Promise<boolean | unknown> | boolean | unknown
  onPrint?: (sale: SaleDetail) => void
  // Opens the SAME new-return flow the Returns section uses
  // (returns/NewReturnModal), pre-filled with this sale. Omitted entirely
  // when the signed-in user lacks `returns:add` -- the identical
  // hide-by-omission pattern as onStatusChange / onAttachMembership above.
  onReturn?: (sale: SaleDetail) => void
  // S4-24b: add product lines to this already-recorded sale. Omitted entirely
  // when the signed-in user lacks `sales:add_items` -- the same
  // hide-by-omission gate as the write callbacks above, and the Worker
  // enforces the identical action server-side.
  onAddItems?: (saleId: string | number, items: Array<{ product_id: number; quantity: number; applied_price_usd?: number; batch_id?: number; batch_label?: string; batch_expiry_date?: string }>) => Promise<boolean | unknown> | boolean | unknown
  // S4-30: amend this already-recorded sale -- change a line's quantity,
  // remove a line, replace one product with another, or correct the delivery
  // fee. Omitted entirely when the signed-in user lacks `sales:amend`, the
  // same hide-by-omission gate as every write callback above; the Worker
  // enforces the identical action server-side.
  onAmend?: (saleId: string | number, request: SaleAmendmentRequest) => Promise<boolean | unknown> | boolean | unknown
  // The sale's audit trail. NOT gated on the write permission: anyone who can
  // open the sale can see how it got that way -- hiding the trail from the
  // people who reconcile the books would defeat the feature. Resolves to null
  // when the history could not be fetched, which the view shows differently
  // from "this sale was never amended".
  onLoadAmendments?: (saleId: string | number) => Promise<SaleAmendmentRow[] | null>
  t: TranslateFn
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Every card in this modal wears the same shell, so "Sale", "Customer",
// "Delivery" and the items/money block are visibly one family instead of the
// four different treatments they used to be.
function SectionCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 p-3 dark:border-gray-700 ${className}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</div>
      {children}
    </section>
  )
}

function parseItems(raw: SaleDetail['items']): SaleLineItem[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is SaleLineItem => !!item && typeof item === 'object') : []
  } catch {
    return []
  }
}

export default function SaleDetailModal({
  sale,
  settings,
  onClose,
  onStatusChange,
  onAttachMembership,
  onPrint,
  onReturn,
  onAddItems,
  onAmend,
  onLoadAmendments,
  t,
  fmtUSD,
  fmtKHR,
}: SaleDetailModalProps) {
  const [newStatus, setNewStatus] = useState(sale?.sale_status || 'completed')
  const [statusNotes, setStatusNotes] = useState('')
  const [statusSaving, setStatusSaving] = useState(false)
  const settlementSnapshot = (selectedSale: SaleDetail | null | undefined) => {
    const rawSettings = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
    const configuredMethods = configuredSettlementMethods(rawSettings.pos_payment_methods)
    const exchangeRateValue = Number(rawSettings.exchange_rate)
    const exchangeRate = Number.isFinite(exchangeRateValue) && exchangeRateValue > 0 ? exchangeRateValue : 4100
    const rows = initialSettlementRows({
      paymentDetails: selectedSale?.payment_details,
      paymentMethod: selectedSale?.payment_method,
      amountPaidUsd: selectedSale?.amount_paid_usd,
      amountPaidKhr: selectedSale?.amount_paid_khr,
      totalUsd: toNumber(selectedSale?.total_usd || selectedSale?.total),
      exchangeRate,
      configuredMethods,
    })
    return {
      saleId: String(selectedSale?.id ?? ''),
      expectedUpdatedAt: String(selectedSale?.updated_at || ''),
      configuredMethods,
      exchangeRate,
      rows,
      recordedIssue: recordedSettlementIssue({
        paymentDetails: selectedSale?.payment_details,
        paymentMethod: selectedSale?.payment_method,
        amountPaidUsd: selectedSale?.amount_paid_usd,
        amountPaidKhr: selectedSale?.amount_paid_khr,
      }),
    }
  }
  const [settlementSession, setSettlementSession] = useState(() => settlementSnapshot(sale))
  const [settlementRows, setSettlementRows] = useState<SettlementRow[]>(settlementSession.rows)
  const settlementBaselineRef = useRef<SettlementRow[]>(settlementSession.rows)
  const settlementRequestIdRef = useRef(createSettlementRequestId())
  const modalPanelRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const [payError, setPayError] = useState('')
  const [statusReviewRequestId, setStatusReviewRequestId] = useState(0)
  // Z8 (user, Aug 29): "credit is the same as awaiting payment, just that you
  // can click near the payment method to edit later." The Record-payment
  // affordance lives on the Payment-method field for an awaiting-payment
  // sale; clicking it selects the completing status (revealing the payment
  // inputs) and scrolls this section into view.
  const statusSectionRef = useRef<HTMLDivElement | null>(null)
  const startRecordPayment = () => {
    if (newStatus === 'awaiting_payment' || newStatus === (sale?.sale_status || 'completed')) setNewStatus('completed')
    setStatusReviewRequestId((requestId) => requestId + 1)
    setTimeout(() => statusSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }
  const [membershipNumber, setMembershipNumber] = useState(sale?.customer_membership_number || '')
  const [membershipSaving, setMembershipSaving] = useState(false)
  // S4-24b: "add items to this sale". Staged locally, written in one request,
  // and reviewed in a ConfirmDialog first -- this write deducts real stock, so
  // it gets the same review-before-commit treatment every other stock write on
  // this app has.
  const [addQuery, setAddQuery] = useState('')
  const [addCandidates, setAddCandidates] = useState<AddProductCandidate[]>([])
  const [addSearching, setAddSearching] = useState(false)
  const [addLines, setAddLines] = useState<StagedAddLine[]>([])
  const [addSaving, setAddSaving] = useState(false)
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)
  const [addPicking, setAddPicking] = useState<AddProductCandidate | null>(null)
  const addSearchSeqRef = useRef(0)
  const addSearchInputRef = useRef<HTMLInputElement | null>(null)
  const addCandidateGroups = useMemo(() => buildProductGroups(addCandidates, new Map(), { preserveInputOrder: true }).map((group) => {
    const choices = (group.sellableItems.length ? group.sellableItems : [group.leadProduct]) as AddProductCandidate[]
    const lead = choices[0] || group.leadProduct as AddProductCandidate
    return {
      ...lead,
      __displayName: group.name || String(lead.name || ''),
      __groupKey: group.key,
      __groupChoices: choices,
      __groupStock: choices.reduce((sum, row) => sum + toNumber(row.stock_quantity), 0),
      __groupMinPrice: group.minSellingPriceUsd,
      __groupMaxPrice: group.maxSellingPriceUsd,
    } satisfies AddProductCandidate
  }), [addCandidates])
  const closeAddPicker = (): void => {
    setAddPicking(null)
    requestAnimationFrame(() => addSearchInputRef.current?.focus())
  }

  // S4-30. `amendments === null` means "not loaded / could not load"; an empty
  // array means "the server says this sale was never amended". They render
  // differently on purpose -- showing the second for the first would be the
  // exact silent gap this feature exists to close.
  const [amendments, setAmendments] = useState<SaleAmendmentRow[] | null>(null)
  const [amendmentsLoading, setAmendmentsLoading] = useState(false)
  const [amendmentsFailed, setAmendmentsFailed] = useState(false)
  // Which line's inline amend controls are open, and what is typed in them.
  const [amendLineId, setAmendLineId] = useState<number | null>(null)
  const [amendQtyText, setAmendQtyText] = useState('')
  const [amendSaving, setAmendSaving] = useState(false)
  const [amendConfirm, setAmendConfirm] = useState<{ request: SaleAmendmentRequest; title: string; summary: string } | null>(null)
  // The delivery fee editor: the CORRECTED value, not a delta. A cashier
  // reading "$1.50" and typing what it should be cannot get the arithmetic
  // wrong; the ledger derives the "+$0.50" the owner asked to see.
  const [feeEditing, setFeeEditing] = useState(false)
  const [feeText, setFeeText] = useState('')
  // Replace: the line being replaced, while the existing product search picks
  // its replacement. Reuses the add-items search rather than growing a second
  // picker with its own bugs.
  const [replaceLineId, setReplaceLineId] = useState<number | null>(null)
  // Bumped after every successful amendment so the trail below reloads. The
  // history is the record of what just happened; a stale one would be the
  // least useful thing on the screen.
  const [amendReloadToken, setAmendReloadToken] = useState(0)

  const saleId = sale?.id
  useEffect(() => {
    const next = settlementSnapshot(sale)
    setSettlementSession(next)
    setSettlementRows(next.rows)
    settlementBaselineRef.current = next.rows
    settlementRequestIdRef.current = createSettlementRequestId()
    setPayError('')
    // Settings changes while this sale is open deliberately do not alter the
    // reviewed rate/method snapshot. A different sale starts a new review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId])
  useEffect(() => {
    if (!onLoadAmendments || saleId === undefined || saleId === null) return
    let cancelled = false
    setAmendmentsLoading(true)
    setAmendmentsFailed(false)
    void (async () => {
      const rows = await onLoadAmendments(saleId)
      if (cancelled) return
      setAmendments(rows)
      setAmendmentsFailed(rows === null)
      setAmendmentsLoading(false)
    })()
    return () => { cancelled = true }
  }, [onLoadAmendments, saleId, amendReloadToken])

  useEffect(() => {
    const text = addQuery.trim()
    if (!onAddItems || text.length < 2) { setAddCandidates([]); setAddSearching(false); return }
    const seq = ++addSearchSeqRef.current
    setAddSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        // The endpoint paginates product FAMILIES, not raw child rows, and a
        // text search expands every matched family/name sibling before this
        // payload returns (routes/products.ts). Eight therefore bounds the
        // visible groups without truncating the options inside any one group.
        const payload = await searchProducts({ query: text, pageSize: 8, branchId: sale?.branch_id ?? undefined }) as { items?: AddProductCandidate[] }
        if (seq !== addSearchSeqRef.current) return
        setAddCandidates(Array.isArray(payload?.items) ? payload.items : [])
      } catch {
        // Suggestions only -- typing again retries. Never a blocking error:
        // the write itself is what has to be reliable, not the picker.
        if (seq === addSearchSeqRef.current) setAddCandidates([])
      } finally {
        if (seq === addSearchSeqRef.current) setAddSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [addQuery, onAddItems, sale?.branch_id])

  const stageAddLine = (choice: SaleDetailProductChoice): void => {
    const productId = Number(choice.productId)
    if (!Number.isFinite(productId) || productId <= 0) return
    const quantity = Math.max(1, Math.floor(Number(choice.quantity) || 1))
    const price = toNumber(choice.unitPriceUsd)
    setAddQuery('')
    setAddCandidates([])
    setAddLines((current) => {
      // A second pick of the same product bumps the quantity rather than
      // adding a duplicate row -- the server would accept two lines, but the
      // person meant "two of these".
      const existing = current.findIndex((line) => line.productId === productId && line.batchId === choice.batchId)
      if (existing >= 0) {
        const next = [...current]
        // A reopened picker is an explicit edit. The most recently confirmed
        // unit price wins instead of silently retaining the earlier staged
        // price while still combining the quantities for this product+batch.
        next[existing] = {
          ...next[existing],
          quantity: next[existing].quantity + quantity,
          unitPriceUsd: price,
          priceText: price > 0 ? String(price) : '0',
          stockQuantity: choice.batchQuantity ?? toNumber(choice.stockQuantity),
          barcode: choice.barcode,
          batchLabel: choice.batchLabel,
          batchReceivedAt: choice.batchReceivedAt,
          batchExpiryDate: choice.batchExpiryDate,
          batchQuantity: choice.batchQuantity,
        }
        return next
      }
      return [...current, {
        productId,
        name: String(choice.name || `#${productId}`),
        quantity,
        unitPriceUsd: price,
        priceText: price > 0 ? String(price) : '0',
        stockQuantity: choice.batchQuantity ?? toNumber(choice.stockQuantity),
        barcode: choice.barcode,
        batchId: choice.batchId,
        batchLabel: choice.batchLabel,
        batchReceivedAt: choice.batchReceivedAt,
        batchExpiryDate: choice.batchExpiryDate,
        batchQuantity: choice.batchQuantity,
      }]
    })
    setAddPicking(null)
  }
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const translateOr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const items = useMemo(() => parseItems(sale?.items), [sale?.items])

  // ---- S4-30: amending ----
  //
  // Every amendment moves stock or money on a sale the customer has already
  // been given a receipt for, so each one is reviewed in a ConfirmDialog
  // before it is sent -- the same review-before-commit treatment every other
  // stock write in this app has. `submitAmendment` is the ONE place a request
  // is actually sent, so there is one error path and one reload.
  const amendmentRows: AmendmentDisplayRow[] = useMemo(
    () => toAmendmentDisplayRows(amendments, (value) => fmtUSD(value), t('delivery') || 'Delivery'),
    [amendments, fmtUSD, t],
  )
  const amendmentGroups = useMemo(() => pairReplacements(amendmentRows), [amendmentRows])
  // The controls are offered only where the server would accept them. This is
  // a mirror of the server's guard, never the enforcement: the Worker also
  // checks the edit window and reads the real return records, neither of which
  // this side can prove.
  const canAmendThisSale = !!onAmend && saleLooksAmendable(sale as { sale_status?: string | null; return_count?: number | null })
  // Whether this amendment will touch stock, predicted the way the Worker
  // decides it (lib/saleAmendments.ts saleAmendmentMovesStock): S4-2's sticky
  // `stock_skipped` flag wins over the status, because a sale the system never
  // took units for must not have units handed back to it either.
  const amendStockMoves = !Number(sale?.stock_skipped || 0)
    && String(sale?.sale_status || 'completed') !== 'awaiting_payment'

  const submitAmendment = async (request: SaleAmendmentRequest): Promise<void> => {
    if (!onAmend || !sale) return
    setAmendSaving(true)
    try {
      const ok = await onAmend(sale.id, request)
      if (ok !== false) {
        setAmendLineId(null)
        setReplaceLineId(null)
        setFeeEditing(false)
        setAmendQtyText('')
        setAmendConfirm(null)
        setAmendReloadToken((token) => token + 1)
      }
    } finally {
      setAmendSaving(false)
    }
  }

  /** Open the amend controls on one line, prefilled with its current quantity. */
  const startAmendLine = (lineId: number, currentQuantity: number): void => {
    setAmendLineId(lineId)
    setReplaceLineId(null)
    setAmendQtyText(String(currentQuantity))
  }

  /**
   * "1 and now 2", or "2 back to 1". One control for both directions, because
   * a cashier types the number the line SHOULD say -- deriving which way that
   * is, is the computer's job, not theirs.
   */
  const stageQuantityAmendment = (lineId: number, currentQuantity: number, name: string): void => {
    const next = Number(amendQtyText)
    if (!Number.isFinite(next) || next < 0) return
    if (next === currentQuantity) return
    if (next === 0) {
      stageRemoval(lineId, currentQuantity, name)
      return
    }
    const rising = next > currentQuantity
    setAmendConfirm({
      request: {
        kind: rising ? 'line_quantity_increased' : 'line_quantity_decreased',
        sale_item_id: lineId,
        quantity: Math.abs(next - currentQuantity),
      },
      title: rising
        ? translateOr('amend_increase_title', 'Add to this line?', 'បន្ថែមទៅជួរនេះ?')
        : translateOr('amend_decrease_title', 'Reduce this line?', 'បន្ថយជួរនេះ?'),
      summary: `${name}: ${currentQuantity} → ${next}`,
    })
  }

  const stageRemoval = (lineId: number, currentQuantity: number, name: string): void => {
    setAmendConfirm({
      request: { kind: 'line_removed', sale_item_id: lineId },
      title: translateOr('amend_remove_title', 'Take this off the sale?', 'ដកចេញពីការលក់នេះ?'),
      summary: `${name} × ${currentQuantity}`,
    })
  }

  /**
   * Replace one product with another. Sent as ONE request so the server can
   * pair the removal and the addition under a single group id and the history
   * reads as the single act the cashier performed.
   */
  const stageReplacement = (candidate: AddProductCandidate): void => {
    const lineId = replaceLineId
    const productId = Number(candidate?.id)
    if (!lineId || !Number.isFinite(productId) || productId <= 0) return
    const line = items.find((item) => Number(item.id) === lineId)
    const quantity = toNumber(line?.quantity ?? line?.qty) || 1
    setAddQuery('')
    setAddCandidates([])
    setAmendConfirm({
      request: {
        kind: 'line_replaced',
        sale_item_id: lineId,
        replacement: { product_id: productId, quantity },
      },
      title: translateOr('amend_replace_title', 'Replace this product?', 'ជំនួសផលិតផលនេះ?'),
      summary: `${line?.product_name || line?.name || ''} → ${candidate?.name || `#${productId}`} × ${quantity}`,
    })
  }

  const stageDeliveryFeeAmendment = (currentFeeUsd: number): void => {
    const next = Number(feeText)
    if (!Number.isFinite(next) || next < 0) return
    if (next === currentFeeUsd) return
    setAmendConfirm({
      request: { kind: 'delivery_fee_changed', delivery_fee_usd: next },
      title: translateOr('amend_fee_title', 'Correct the delivery fee?', 'កែថ្លៃដឹកជញ្ជូន?'),
      summary: `${fmtUSD(currentFeeUsd)} → ${fmtUSD(next)}`,
    })
  }

  const settlementDirty = sale?.sale_status === 'awaiting_payment'
    && (newStatus === 'completed' || newStatus === 'awaiting_delivery')
    && !settlementRowsEqual(settlementRows, settlementBaselineRef.current)
  const closeGuard = useCloseGuard({ dirty: settlementDirty }, onClose)

  useEffect(() => {
    if (!saleId) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => previousFocus?.focus()
  }, [saleId])

  useEffect(() => {
    if (!saleId || addPicking || closeGuard.promptOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeGuard.requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = modalPanelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [addPicking, closeGuard.promptOpen, closeGuard.requestClose, saleId])

  if (!sale) return null

  const currentStatus = sale.sale_status || 'completed'
  // The Return action reuses the Returns section's own guards rather than
  // inventing new ones -- see utils/saleReturnGuard.ts, shared with the
  // receipt view so the two surfaces never disagree. The reason is stated up
  // front (disabled button + InfoHint) instead of letting someone walk into a
  // dead-end form.
  const returnBlockReason = getSaleReturnBlockReason({ sale_status: currentStatus, items })
  const returnBlockedReason = returnBlockReason === 'cancelled'
    ? translateOr('return_blocked_cancelled_sale', 'This sale was cancelled, so there is nothing to return.', 'ការលក់នេះត្រូវបានបោះបង់ ដូច្នេះគ្មានអ្វីត្រូវប្រគល់មកវិញទេ។')
    : returnBlockReason === 'fully_returned'
      ? translateOr('return_blocked_fully_returned', 'Every item on this sale has already been returned.', 'ទំនិញទាំងអស់ក្នុងការលក់នេះ ត្រូវបានប្រគល់មកវិញរួចហើយ។')
      : ''
  // ONE derivation of this sale's money column, shared with the printed
  // receipt (utils/receiptTotals.ts): the delivery fee split by who actually
  // paid it, the refund and net total, and a 'still owed' that counts riel.
  // Reading the raw row separately in each surface is how the two drifted
  // apart -- receiptTotals.test.ts asserts the column reconciles to total_usd
  // on fixtures rather than a reader trusting that it does.
  const totals = receiptTotalsFigures(sale)
  const totalUsd = totals.totalUsd
  const totalKhr = toNumber(sale.total_khr)
  const refundUsd = totals.refundUsd
  const refundKhr = totals.refundKhr
  const membershipDiscountUsd = totals.membershipDiscountUsd
  const membershipDiscountKhr = toNumber(sale.membership_discount_khr)
  const baseDiscountUsd = totals.discountUsd
  const taxUsd = totals.taxUsd
  const subtotalUsd = totals.subtotalUsd
  // subtotal_khr was already returned by GET /api/sales and already stored by
  // the POS, but the old Totals block printed a KHR line for the discounts and
  // the total while leaving the subtotal USD-only -- so the riel column had a
  // hole in it right at the top. It is shown now for the same reason the rest
  // are: the KHR column has to read straight down.
  const subtotalKhr = toNumber(sale.subtotal_khr)
  const amountPaidUsd = totals.paidUsd
  const amountPaidKhr = totals.paidKhr
  const changeUsd = totals.changeUsd
  const changeKhr = totals.changeKhr
  const discountKhr = toNumber(sale.discount_khr)
  const taxKhr = toNumber(sale.tax_khr)
  // The fee AS STORED -- what the Edit control corrects -- plus the split by
  // who actually paid it. `total_usd` only ever carries a CUSTOMER-paid fee,
  // so printing the stored figure whoever paid it left this column over by
  // exactly the fee on every delivery the shop absorbed.
  const deliveryFeeUsd = totals.delivery.faceUsd
  const deliveryFeeKhr = totals.delivery.faceKhr
  const deliveryPaidByStore = totals.delivery.printsAsFree
  const isDelivery = !!toNumber(sale.is_delivery) || !!String(sale.delivery_contact_name || '').trim()
  // Driver info is DRIVER info. User, Sep 4 2026: "delivery only needs phone
  // and driver name...this is driver info, for customer name, phone and
  // address keep it same in customer section... make them compact".
  //
  // This SUPERSEDES S4-25, which hung all three delivery fields off the
  // delivery-fee row's label. That was one place too clever: three wrapped
  // lines of contact detail grew out of the left of a money row and shoved the
  // amount column down with them, and it put the driver's name in the totals
  // block, which is where money lives, not people. The two fields that are
  // genuinely about the driver now sit in the Sale card as ordinary compact
  // rows, on the same label/value rhythm as everything else there.
  const deliveryDriverName = sanitizeSaleDetailText(sale.delivery_contact_name)
  const deliveryDriverPhone = sanitizeSaleDetailText(sale.delivery_contact_phone)
  // The drop address is the one delivery field that can legitimately differ
  // from what the Customer card already shows -- "keep it same in customer
  // section" is where an address belongs, so it is shown THERE, and only when
  // it is not simply a restatement of the customer's own address. Dropping it
  // outright would have deleted the only place a deliver-somewhere-else
  // address is visible on this screen.
  const deliveryAddress = String(sale.delivery_contact_address || '').trim()
  const sameAddressText = (left: string, right: string): boolean =>
    left.replace(/\s+/g, ' ').trim().toLowerCase() === right.replace(/\s+/g, ' ').trim().toLowerCase()
  const deliveryAddressToShow = deliveryAddress && !sameAddressText(deliveryAddress, String(sale.customer_address || ''))
    ? deliveryAddress
    : ''
  const paymentDetails = parsePaymentDetails(sale.payment_details)
  // Outstanding balance: an on-credit / partially-paid sale (tender below
  // total). Shown so the admin detail no longer hides "still owed".
  //
  // Derived in receiptTotals.ts, which counts amount_paid_KHR as well. This
  // used to be `totalUsd - amountPaidUsd`, so a sale settled entirely in riel
  // -- the ordinary shape at this counter -- read as fully unpaid and showed
  // the whole total as still owed.
  const outstandingUsd = totals.outstandingUsd

  // An awaiting-payment sale is settled here even when it already has a
  // partial tender. The editor carries the full existing tender snapshot and
  // appends the outstanding amount; the server remains the coverage authority.
  const needsPaymentEntry = currentStatus === 'awaiting_payment'
    && (newStatus === 'completed' || newStatus === 'awaiting_delivery')

  // S4-24b. The surface is offered only where the Worker would actually
  // accept the write: a status that takes new lines, and no recorded returns
  // (a returned sale's contents belong to the Returns flow -- adding to it
  // would change what "already came back" means for records already written).
  const hasRecordedReturns = refundUsd > 0 || items.some((item) => toNumber(item.returned_quantity) > 0)
  const canOfferAddItems = !!onAddItems
    && STATUSES_ACCEPTING_ADDED_ITEMS.includes(currentStatus)
    && !hasRecordedReturns
  const addedSubtotalUsd = Math.round(addLines.reduce((sum, line) => sum + line.unitPriceUsd * line.quantity, 0) * 100) / 100
  // Every other money field is frozen by the server (see
  // lib/saleLineAddition.ts's decision 3), so the new total is exactly the
  // old total plus what is being added -- which is what makes this preview
  // safe to show before the write.
  const projectedTotalUsd = Math.round((totalUsd + addedSubtotalUsd) * 100) / 100
  // Same shape as outstandingUsd above -- one definition of "still owed"
  // on this screen, so the projection cannot disagree with the figure it is
  // projecting from.
  const projectedOutstandingUsd = Math.max(0, Math.round((projectedTotalUsd - totals.paidTotalUsd) * 100) / 100)
  // Every status accepted by POST /:id/items now holds stock (including
  // awaiting_payment); only the sticky migration flag keeps a sale outside
  // the stock ledger. A branchless stock_skipped sale is therefore valid,
  // while a branchless stock-moving sale remains blocked in the picker.
  const addStockMoves = !Number(sale?.stock_skipped || 0)
  const addHasStockError = addStockMoves && addLines.some((line) => (
    line.stockQuantity <= 0 || line.quantity > line.stockQuantity
  ))

  const submitAddItems = async (): Promise<void> => {
    if (!onAddItems || !addLines.length || addHasStockError) return
    setAddSaving(true)
    try {
      const ok = await onAddItems(sale.id, addLines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
        applied_price_usd: line.unitPriceUsd,
        ...(line.batchId != null ? { batch_id: line.batchId } : {}),
        ...(line.batchLabel ? { batch_label: line.batchLabel } : {}),
        ...(line.batchExpiryDate ? { batch_expiry_date: line.batchExpiryDate } : {}),
      })))
      // The caller raises its own success/failure notice (it is the one that
      // knows whether stock actually moved), so this only clears the form and
      // steps out of the way on success.
      if (ok !== false) {
        setAddLines([])
        setAddConfirmOpen(false)
        onClose()
      } else {
        setAddConfirmOpen(false)
      }
    } finally {
      setAddSaving(false)
    }
  }

  const handleStatusUpdate = async (): Promise<void> => {
    if (!onStatusChange || newStatus === currentStatus) return
    let extra: Record<string, unknown> | null = null
    if (needsPaymentEntry) {
      if (settlementSession.recordedIssue === 'malformed') {
        setPayError(translateOr('sale_settlement_record_malformed', 'The recorded payment details are malformed. Review and repair this sale before settling it.', 'ព័ត៌មានការទូទាត់ដែលបានកត់ត្រាមិនត្រឹមត្រូវ។ សូមពិនិត្យ និងកែការលក់នេះ មុនបញ្ចប់ការទូទាត់។'))
        return
      }
      if (settlementSession.recordedIssue === 'mismatch') {
        setPayError(translateOr('sale_settlement_record_mismatch', 'The recorded payment total does not match its payment lines. Review and repair this sale before settling it.', 'ចំនួនការទូទាត់ដែលបានកត់ត្រា មិនត្រូវនឹងបន្ទាត់ការទូទាត់ទេ។ សូមពិនិត្យ និងកែការលក់នេះ មុនបញ្ចប់ការទូទាត់។'))
        return
      }
      if (settlementSession.recordedIssue === 'allocation') {
        setPayError(translateOr('sale_settlement_allocation_missing', 'This sale has a combined payment summary without its original tender allocation. Repair the payment details before settling it.', 'ការលក់នេះមានសង្ខេបការទូទាត់រួម ប៉ុន្តែគ្មានការបែងចែកការទូទាត់ដើម។ សូមកែព័ត៌មានការទូទាត់ មុនបញ្ចប់។'))
        return
      }
      const payload = buildSettlementPayload(settlementRows, settlementSession.configuredMethods)
      const rowIssue = settlementRowsIssue(settlementRows, settlementSession.configuredMethods)
      if (rowIssue === 'method') {
        setPayError(translateOr('sale_settlement_method_unavailable', 'Choose an active configured payment method for every row.', 'សូមជ្រើសវិធីទូទាត់សកម្មដែលបានកំណត់ សម្រាប់គ្រប់បន្ទាត់។'))
        return
      }
      if (rowIssue === 'amount') {
        setPayError(translateOr('sale_settlement_amount_invalid', 'Every payment row needs a positive USD or whole KHR amount.', 'គ្រប់បន្ទាត់ការទូទាត់ត្រូវការចំនួន USD វិជ្ជមាន ឬចំនួន KHR គត់។'))
        return
      }
      if (!payload) {
        setPayError(translateOr('payment_amount_required', 'Enter the amount received.', 'បញ្ចូលចំនួនទឹកប្រាក់ដែលបានទទួល។'))
        return
      }
      const reviewedTotals = settlementTotals(settlementRows, settlementSession.exchangeRate)
      if (Math.round(reviewedTotals.paidEquivalentUsd * 10000) < Math.round(totalUsd * 10000)) {
        setPayError(translateOr('sale_settlement_full_required', 'The full sale balance must be covered before completing it.', 'ត្រូវទូទាត់គ្រប់ចំនួនសរុប មុនបញ្ចប់ការលក់។'))
        return
      }
      setPayError('')
      extra = {
        ...payload,
        client_request_id: settlementRequestIdRef.current,
        expected_exchange_rate: settlementSession.exchangeRate,
        expected_updated_at: settlementSession.expectedUpdatedAt,
      }
    }
    setStatusSaving(true)
    try {
      const result = await onStatusChange(sale.id, newStatus, statusNotes, true, extra)
      const changedRate = result && typeof result === 'object'
        ? Number((result as { exchangeRateChanged?: unknown }).exchangeRateChanged)
        : NaN
      const settlementError = result && typeof result === 'object'
        ? String((result as { settlementError?: unknown }).settlementError || '')
        : ''
      if (Number.isFinite(changedRate) && changedRate > 0) {
        setSettlementSession((current) => ({ ...current, exchangeRate: changedRate }))
        settlementRequestIdRef.current = createSettlementRequestId()
        setPayError(translateOr('sale_settlement_rate_changed', 'The exchange rate changed. Review the updated balance, then confirm again.', 'អត្រាប្តូរប្រាក់បានផ្លាស់ប្តូរ។ សូមពិនិត្យសមតុល្យថ្មី ហើយបញ្ជាក់ម្តងទៀត។'))
      } else if (settlementError) {
        setPayError(settlementError)
      } else if (result !== false) {
        onClose()
      }
    } finally {
      setStatusSaving(false)
    }
  }

  const handleMembershipAttach = async (): Promise<void> => {
    const value = String(membershipNumber || '').trim()
    if (!value || !onAttachMembership) return
    setMembershipSaving(true)
    try {
      const ok = await onAttachMembership(sale.id, value)
      if (ok) onClose()
    } finally {
      setMembershipSaving(false)
    }
  }

  return createPortal(
    <div
      className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-end justify-center overflow-y-auto bg-black/50 sm:items-center sm:p-4"
      onClick={addPicking ? undefined : closeGuard.requestClose}
      inert={addPicking ? true : undefined}
      aria-hidden={addPicking ? true : undefined}
    >
      <div
        ref={modalPanelRef}
        role="dialog"
        aria-modal="true"
        aria-label={translateOr('sale_details', 'Sale details', 'ព័ត៌មានលម្អិតការលក់')}
        className="modal-panel-safe flex w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}
      >
        {/* The receipt id owns a full-width row of its own below sm (user,
            Sep 3 2026: "for smaller screens the receipt id must be shown
            clearly fully, no scroll; can push to second row and copy
            easily"), so it wraps instead of scrolling sideways and the
            status/actions cluster drops underneath it. From sm the two share
            one compact row again, with the same copy button. */}
        <div className="flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 p-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CopyableId
              value={sale.receipt_number || ''}
              copyLabel={translateOr('copy_receipt_number', 'Copy receipt number', 'ចម្លងលេខវិក្កយបត្រ')}
              copiedLabel={t('copied') || 'Copied'}
              valueClassName="font-mono text-sm font-bold text-gray-900 dark:text-white sm:text-base"
            />
            <div className="mt-1 text-xs text-gray-400">{fmtTime(sale.created_at)}</div>
          </div>
          {/* S4-24 (user, Sep 4 2026): "print buttons end of page...not on top
              near the x close button". Print and Return moved to the footer at
              the end of the record. Only the status badge and the close control
              stay up here -- a badge is a fact about the record, and X is how
              you leave, not something you do to the sale. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusBadge status={currentStatus} t={t} />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeGuard.requestClose}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
              aria-label={t('close') || 'Close'}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* One rhythm for the whole record (user, Sep 3 2026: "a row view is
            better instead of current broken view"). Every field is a
            label/value ROW -- Sale, Customer and Delivery no longer stack the
            label above the value while Totals used rows, which is what made
            the same modal read in two shapes at once. The money summary is
            not a separate box any more either: it lives in the SAME table as
            the line items, so subtotal / discounts / total land in the same
            right-aligned column as the line totals and can be scanned
            straight down. Every KHR figure now sits inside its own row's
            amount cell instead of floating underneath as an unlabelled
            right-aligned line. */}
        <div className="modal-scroll space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title={t('sale') || 'Sale'}>
              <DetailRowGroup>
                <DetailRow label={t('cashier') || 'Cashier'} value={sale.cashier_name} />
                {/* Z8: an awaiting-payment (credit) sale carries no method yet
                    -- the field becomes a Record-payment affordance right here
                    "near the payment method", per the user. */}
                {currentStatus === 'awaiting_payment' ? (
                  <DetailRow label={t('payment_method') || 'Payment method'}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
                        {translateOr('credit_awaiting_payment', 'Credit — awaiting payment', 'ឥណទាន — រង់ចាំការទូទាត់')}
                      </span>
                      <button
                        type="button"
                        onClick={startRecordPayment}
                        className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                      >
                        {translateOr('record_payment', 'Record payment', 'កត់ត្រាការទូទាត់')}
                      </button>
                    </span>
                  </DetailRow>
                ) : (
                  /* S4-24: the split payment is no longer a row called
                     "Payment breakdown" -- it is the payment row's own detail,
                     which is exactly how the receipt prints it (Receipt.tsx
                     order_info passes the same list as the payment Row's
                     subValue). One fact, one row. */
                  <DetailRow label={t('payment_method') || 'Payment method'}>
                    <span className="block">
                      <span className="badge-blue text-xs">{sale.payment_method}</span>
                      {paymentDetails.length > 1 ? (
                        <span className="mt-1 block space-y-0.5">
                          {paymentDetails.map((detail, index) => (
                            <span key={`${detail.method}-${index}`} className="flex justify-between gap-3 text-xs font-normal text-gray-500 dark:text-gray-400">
                              <span className="min-w-0 flex-1 break-words">{detail.method}</span>
                              <span className="shrink-0 tabular-nums">{fmtUSD(detail.amount_usd)}{detail.amount_khr > 0 ? ` · ${fmtKHR(detail.amount_khr)}` : ''}</span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </DetailRow>
                )}
                <DetailRow label={t('branch') || 'Branch'} value={sale.branch_name} />
                <DetailRow label={t('status') || 'Status'} value={getStatusLabel(currentStatus, t)} />
                {sale.source_return_id ? (
                  <DetailRow label={translateOr('replacement_for_return', 'Replacement for return', 'ការលក់ជំនួសសម្រាប់ការបង្វិលត្រឡប់')} value={`#${sale.source_return_id}`} mono />
                ) : null}
                {/* Driver, compact, in the section that describes the sale --
                    not in the money block and not in a card of its own. Each
                    row hides itself when empty (DetailRow's own rule), so a
                    walk-in sale is unchanged and a free delivery still names
                    its driver, which the fee row could not do when the fee was
                    zero and the row did not render. */}
                <DetailRow label={translateOr('driver', 'Driver', 'អ្នកដឹកជញ្ជូន')} value={deliveryDriverName} />
                <DetailRow label={translateOr('driver_phone', 'Driver phone', 'ទូរស័ព្ទអ្នកដឹក')} value={deliveryDriverPhone} />
                {/* The note the cashier typed at checkout. It used to be a
                    SectionCard of its own ABOVE the items -- user, Sep 4 2026:
                    "the notes did not show in the notes area for sales, it
                    went to above". A note is a field OF the sale, so it reads
                    as one, on the same rhythm as the rows around it.
                    whitespace-pre-wrap keeps a multi-line note multi-line. */}
                <DetailRow label={t('notes') || 'Notes'} value={sale.notes} valueClassName="whitespace-pre-wrap" />
                {/* S4-24: Timezone, Device and Payment currency are gone from
                    this card. They are device telemetry -- no receipt prints
                    them, and the user asked for the detail to read like one.
                    The data is not lost: it is still on the sale row, still
                    exported, and still on the Sales list's own columns. If a
                    till ever needs to be identified from a receipt, put it
                    back deliberately rather than by re-adding a row nobody
                    asked for. */}
              </DetailRowGroup>
            </SectionCard>

            <SectionCard title={t('customer') || 'Customer'}>
              <DetailRowGroup>
                <DetailRow label={t('customer_name') || 'Customer'} value={sale.customer_name} />
                <DetailRow label={t('phone') || 'Phone'} value={sale.customer_phone} />
                <DetailRow label={t('address') || 'Address'} value={sale.customer_address} />
                <DetailRow label={translateOr('delivery_address', 'Delivery address', 'អាសយដ្ឋានដឹកជញ្ជូន')} value={deliveryAddressToShow} />
                <DetailRow label={t('membership') || 'Membership'} value={sale.customer_membership_number} mono />
              </DetailRowGroup>
              {/* An ACTION, not a field -- kept in the Customer card but held
                  below the row list so it cannot break the row rhythm. */}
              <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700/60">
                <label htmlFor="sale-membership-attach" className="mb-1 block text-xs text-gray-400">
                  {translateOr('attach_membership', 'Attach membership to this sale', 'ភ្ជាប់សមាជិកទៅការលក់នេះ')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="sale-membership-attach"
                    className="input text-sm"
                    value={membershipNumber}
                    onChange={(event) => setMembershipNumber(event.target.value)}
                    placeholder={t('membership_number') || 'Membership number'}
                  />
                  <button
                    type="button"
                    className="btn-primary whitespace-nowrap text-xs"
                    disabled={membershipSaving || !String(membershipNumber || '').trim()}
                    onClick={handleMembershipAttach}
                  >
                    {membershipSaving ? (t('loading') || 'Saving') : (t('save') || 'Save')}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {translateOr('sale_membership_attach_hint', 'Use this when a sale was created anonymously and staff need to link it to a member later.', 'ប្រើពេលការលក់ត្រូវបានបង្កើតដោយមិនមានសមាជិក ហើយបុគ្គលិកត្រូវភ្ជាប់ទៅសមាជិកនៅពេលក្រោយ។')}
                </p>
              </div>
            </SectionCard>

            {/* S4-25: delivery is no longer a card of its own. The driver,
                their phone and the drop address now ride the delivery-fee row
                inside the items table, which is where the receipt puts the
                fee -- next to the total. A card sitting beside Customer made
                the reader hold two addresses apart before reaching a single
                number they both explain. */}

          </div>

          {/* Items AND the money summary in ONE table: the tfoot amounts sit in
              the same column as the line totals above them, which is the whole
              point of a row view -- the numbers can be read straight down. The
              product name wraps instead of living in a 151px horizontal scroll
              box (measured on the old shape at 1280), and the table keeps the
              same shape at every width, so the phone no longer loses the Qty
              and Unit price columns to a separate card list. */}
          <SectionCard title={`${t('items') || 'Items'} (${items.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/35 dark:text-gray-400">
                  <tr>
                    <th className="px-1.5 py-1.5 text-left sm:px-2">{t('product') || 'Product'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('qty_short') || 'Qty'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('unit_price') || 'Unit price'}</th>
                    <th className="px-1.5 py-1.5 text-right sm:px-2">{t('line_total') || 'Line total'}</th>
                    {/* A visible header, because this is now a real column:
                        every editable row on this table -- product lines and
                        the delivery fee alike -- puts its control here. An
                        sr-only header described a column the eye could not
                        find. */}
                    {canAmendThisSale ? <th className="px-1.5 py-1.5 text-right sm:px-2">{translateOr('amend_line', 'Edit', 'កែ')}</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={canAmendThisSale ? 5 : 4} className="px-2 py-3 text-sm text-gray-400">{t('no_item_details') || 'No item details available.'}</td>
                    </tr>
                  ) : items.map((item, index) => {
                    const qty = toNumber(item.quantity || item.qty || 1) || 1
                    const unitUsd = toNumber(item.applied_price_usd ?? item.price_usd ?? item.price)
                    const unitKhr = toNumber(item.applied_price_khr ?? item.price_khr)
                    const lineUsd = unitUsd * qty
                    const lineKhr = unitKhr * qty
                    // The sale_items row id, which every amendment addresses.
                    // A legacy row without one gets no controls rather than a
                    // button that would 404 -- the sale is still fully
                    // readable, which is the important part.
                    const lineId = Number(item.id) || 0
                    return (
                      <Fragment key={`${item.product_id || item.id || index}-${index}`}>
                      <tr>
                        <td className="px-1.5 py-1.5 align-top sm:px-2">
                          <div className="break-words font-medium text-gray-900 dark:text-white">{item.product_name || item.name}</div>
                          {toNumber(item.returned_quantity) > 0 ? (
                            <div className="mt-0.5 inline-flex rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">↩ {toNumber(item.returned_quantity)} {t('returned_quantity_tag') || 'returned'}</div>
                          ) : null}
                          {item.branch_name ? <div className="break-words text-[11px] text-gray-400">{item.branch_name}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-200">{qty}</td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 tabular-nums text-gray-700 dark:text-gray-200">
                          {fmtUSD(unitUsd)}
                          {unitKhr > 0 ? <div className="text-[11px] text-gray-400">{fmtKHR(unitKhr)}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top sm:px-2 font-semibold tabular-nums text-gray-900 dark:text-white">
                          {fmtUSD(lineUsd)}
                          {lineKhr > 0 ? <div className="text-[11px] font-normal text-gray-400">{fmtKHR(lineKhr)}</div> : null}
                        </td>
                        {/* S4-30: the amend affordance. Inline rather than in a
                            menu, because "the customer changed their mind" is a
                            thing that happens at the counter with someone
                            waiting -- and the whole control set is on screen
                            from first paint, never a stub that expands once a
                            prerequisite field is answered. */}
                        {/* The amend cell carries the same
                            tabular-nums/whitespace-nowrap tokens as its numeric
                            siblings even though it holds a button:
                            recordDetailRowRhythm locks the shape of every
                            right-aligned cell in this table, and a control cell
                            that opted out would weaken the lock for the money
                            columns beside it. */}
                        {canAmendThisSale ? (
                          <td className="whitespace-nowrap px-1.5 py-1.5 text-right align-top tabular-nums sm:px-2">
                            {lineId > 0 ? (
                              <button
                                type="button"
                                onClick={() => (amendLineId === lineId ? setAmendLineId(null) : startAmendLine(lineId, qty))}
                                className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                              >
                                {amendLineId === lineId
                                  ? (t('cancel') || 'Cancel')
                                  : translateOr('amend_line', 'Edit', 'កែ')}
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      {canAmendThisSale && amendLineId === lineId && lineId > 0 ? (
                        <tr className="bg-gray-50 dark:bg-gray-900/40">
                          <td colSpan={5} className="px-1.5 py-2 sm:px-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300" htmlFor={`amend-qty-${lineId}`}>
                                {translateOr('amend_new_quantity', 'New quantity', 'ចំនួនថ្មី')}
                              </label>
                              <input
                                id={`amend-qty-${lineId}`}
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                value={amendQtyText}
                                onChange={(event) => setAmendQtyText(event.target.value)}
                                className="w-20 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                              />
                              <button
                                type="button"
                                disabled={amendSaving}
                                onClick={() => stageQuantityAmendment(lineId, qty, String(item.product_name || item.name || ''))}
                                className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              >
                                {translateOr('amend_apply', 'Apply', 'អនុវត្ត')}
                              </button>
                              <button
                                type="button"
                                disabled={amendSaving}
                                onClick={() => stageRemoval(lineId, qty, String(item.product_name || item.name || ''))}
                                className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
                              >
                                <Trash2 className="h-3 w-3" />
                                {translateOr('amend_remove', 'Remove', 'ដកចេញ')}
                              </button>
                              <button
                                type="button"
                                disabled={amendSaving}
                                onClick={() => { setReplaceLineId(replaceLineId === lineId ? null : lineId); setAddQuery(''); setAddCandidates([]) }}
                                className="rounded border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
                              >
                                {translateOr('amend_replace', 'Replace', 'ជំនួស')}
                              </button>
                            </div>
                            {/* Replace reuses the SAME product search the
                                add-items surface uses, rather than growing a
                                second picker with its own bugs. */}
                            {replaceLineId === lineId ? (
                              <div className="mt-2">
                                <input
                                  type="search"
                                  value={addQuery}
                                  onChange={(event) => setAddQuery(event.target.value)}
                                  placeholder={translateOr('add_items_search_placeholder', 'Search by name or barcode', 'ស្វែងរកតាមឈ្មោះ ឬបាកូដ')}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                />
                                {addSearching ? (
                                  <div className="mt-1 text-[11px] text-gray-400">{t('loading') || 'Loading'}</div>
                                ) : addCandidates.length ? (
                                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                                    {addCandidates.map((candidate) => (
                                      <li key={String(candidate.id)}>
                                        <button
                                          type="button"
                                          onClick={() => stageReplacement(candidate)}
                                          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                        >
                                          <span className="break-words">{candidate.name}</span>
                                          <span className="shrink-0 tabular-nums text-[11px] text-gray-500">{fmtUSD(toNumber(candidate.selling_price_usd))}</span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : addQuery.trim().length >= 2 ? (
                                  <div className="mt-1 text-[11px] text-gray-400">{translateOr('add_items_no_matches', 'No products matched.', 'រកមិនឃើញផលិតផលទេ។')}</div>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="border-t border-gray-200 dark:border-gray-700">
                  <MoneyRow
                    label={t('subtotal') || 'Subtotal'}
                    amount={fmtUSD(subtotalUsd)}
                    sub={subtotalKhr > 0 ? fmtKHR(subtotalKhr) : null}
                  />
                  {baseDiscountUsd > 0 ? (
                    <MoneyRow
                      label={t('discount') || 'Store discount'}
                      tone="discount"
                      amount={`-${fmtUSD(baseDiscountUsd)}`}
                      sub={discountKhr > 0 ? `-${fmtKHR(discountKhr)}` : null}
                    />
                  ) : null}
                  {membershipDiscountUsd > 0 ? (
                    <MoneyRow
                      label={t('membership_discount') || 'Membership discount'}
                      tone="credit"
                      amount={`-${fmtUSD(membershipDiscountUsd)}`}
                      sub={membershipDiscountKhr > 0 ? `-${fmtKHR(membershipDiscountKhr)}` : null}
                    />
                  ) : null}
                  {/* S4-24: "Points redeemed" is gone. It is not money -- it
                      sat in a money column stating the mechanism behind the
                      membership discount printed directly above it, which is
                      the kind of second explanation of one number the user
                      meant by "no need so much break downs". */}
                  {taxUsd > 0 ? (
                    <MoneyRow label={t('tax') || 'Tax'} amount={fmtUSD(taxUsd)} sub={taxKhr > 0 ? fmtKHR(taxKhr) : null} />
                  ) : null}
                  {/* S4-25: the row renders when the sale IS a delivery even
                      if the fee is zero -- a free delivery still has a driver,
                      and dropping the row on a zero fee would have hidden the
                      contact the old card used to show. */}
                  {isDelivery || deliveryFeeUsd > 0 || deliveryFeeKhr > 0 ? (
                    <MoneyRow
                      label={translateOr('delivery_fee', 'Delivery fee', 'ថ្លៃដឹកជញ្ជូន')}
                      {...(deliveryPaidByStore ? { tone: 'credit' as const } : {})}
                      /* A fee the shop absorbed reads "Free" with the figure
                         struck through -- the same wording the receipt prints.
                         Free is what total_usd already assumed; the struck
                         figure still says what the delivery was worth. */
                      amount={deliveryPaidByStore ? (
                        <>
                          {translateOr('delivery_free', 'Free', 'ឥតគិតថ្លៃ')}{' '}
                          <span className="font-normal text-gray-400 line-through">{fmtUSD(deliveryFeeUsd)}</span>
                        </>
                      ) : fmtUSD(deliveryFeeUsd)}
                      sub={deliveryFeeKhr > 0
                        ? (deliveryPaidByStore ? <span className="line-through">{fmtKHR(deliveryFeeKhr)}</span> : fmtKHR(deliveryFeeKhr))
                        : null}
                      action={canAmendThisSale ? (
                        <button
                          type="button"
                          onClick={() => { if (!feeEditing) setFeeText(String(deliveryFeeUsd)); setFeeEditing(!feeEditing) }}
                          className="rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                          {feeEditing ? (t('cancel') || 'Cancel') : translateOr('amend_line', 'Edit', 'កែ')}
                        </button>
                      ) : null}
                    />
                  ) : null}
                  {/* The owner's own example: "before 1.5 dollar delivery,
                      then we add another 0.5 dollar". The row above always
                      shows the NET fee -- what the receipt prints -- and the
                      history card below shows both halves. Typing the new
                      TOTAL rather than a delta is deliberate: it is the number
                      on the paper the customer is looking at. */}
                  {/* The editor is a ROW of the table, spanning it, exactly
                      like the per-line quantity editor above. It used to be a
                      bare <div> parked between two <tr>s inside <tfoot>; a
                      table section may only contain rows, so the browser
                      hoisted that div out of the table box and dropped it
                      wherever it landed -- the "placed all over the place" the
                      user was looking at. Opening it is now the Edit button in
                      the Edit column, so products and delivery are amended the
                      same way from the same place. */}
                  {canAmendThisSale && feeEditing && (isDelivery || deliveryFeeUsd > 0) ? (
                    <tr className="bg-gray-50 dark:bg-gray-900/40">
                      <td colSpan={5} className="px-1.5 py-2 sm:px-2">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300" htmlFor="amend-delivery-fee">
                            {translateOr('amend_fee_new_total', 'New delivery fee', 'ថ្លៃដឹកជញ្ជូនថ្មី')}
                          </label>
                          <input
                            id="amend-delivery-fee"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={feeText}
                            onChange={(event) => setFeeText(event.target.value)}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          />
                          <button
                            type="button"
                            disabled={amendSaving}
                            onClick={() => stageDeliveryFeeAmendment(deliveryFeeUsd)}
                            className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            {translateOr('amend_apply', 'Apply', 'អនុវត្ត')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setFeeEditing(false)}
                            className="rounded border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-600 dark:text-gray-300"
                          >
                            {t('cancel') || 'Cancel'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {refundUsd > 0 ? (
                    <MoneyRow
                      label={t('returns_refunded') || 'Refunded by returns'}
                      tone="refund"
                      amount={`-${fmtUSD(refundUsd)}`}
                      sub={refundKhr > 0 ? `-${fmtKHR(refundKhr)}` : null}
                    />
                  ) : null}
                  <MoneyRow
                    label={t('total') || 'Total'}
                    strong
                    amount={fmtUSD(totalUsd)}
                    sub={totalKhr > 0 ? fmtKHR(totalKhr) : null}
                  />
                  {/* What the customer is left with once returns are booked.
                      total_usd is what the sale RANG UP and does not net a
                      refund, so the minus row above it describes a subtraction
                      the Total line never makes; this row states the result so
                      the reader is not left to do it. It carries no bold
                      weight: the sale total keeps the heavier type (one grand
                      total per column, pinned by recordDetailRowRhythm.test.ts),
                      which is also why the refund row keeps its pinned position
                      above the Total here while the printed receipt puts it
                      below. */}
                  {refundUsd > 0 ? (
                    <MoneyRow
                      label={translateOr('net_total_after_returns', 'Net total', 'សរុបសុទ្ធ')}
                      amount={fmtUSD(totals.netTotalUsd)}
                      sub={totals.netTotalKhr > 0 ? fmtKHR(totals.netTotalKhr) : null}
                    />
                  ) : null}
                  {/* Riel-only tender is a payment. Gating this row on the USD
                      figure alone hid the whole payment on a sale settled in
                      riel and left the reader with an unexplained balance. */}
                  {amountPaidUsd > 0 || amountPaidKhr > 0 ? (
                    <MoneyRow
                      label={t('amount_paid') || 'Amount paid'}
                      tone="muted"
                      amount={fmtUSD(amountPaidUsd)}
                      sub={amountPaidKhr > 0 ? fmtKHR(amountPaidKhr) : null}
                    />
                  ) : null}
                  {outstandingUsd > 0 && currentStatus !== 'cancelled' ? (
                    <MoneyRow
                      label={translateOr('outstanding_balance', 'Outstanding (on credit)', 'នៅជំពាក់')}
                      note={sale.credit_due_date ? `· ${translateOr('due', 'due', 'កំណត់')} ${String(sale.credit_due_date).slice(0, 10)}` : null}
                      tone="due"
                      amount={fmtUSD(outstandingUsd)}
                    />
                  ) : null}
                  {changeUsd > 0 ? (
                    <MoneyRow
                      label={t('change') || 'Change'}
                      tone="change"
                      amount={fmtUSD(changeUsd)}
                      sub={changeKhr > 0 ? fmtKHR(changeKhr) : null}
                    />
                  ) : null}
                  {/* S4-24: "Actual delivery cost" is gone from this summary.
                      It is what the shop PAID the driver, not part of what the
                      customer owes, and printing it under Change invited the
                      reader to subtract it from a total it was never in --
                      literally the "difference" the user asked to remove. It
                      stays on the sale row and in the delivery reports, which
                      is where a margin question belongs. */}
                </tfoot>
              </table>
            </div>
          </SectionCard>

          {/* S4-24b: add more products to a sale that already exists. It sits
              directly under the item list it extends, so the record still
              reads top-to-bottom and still ends in its footer actions.
              The write moves real stock, so it follows the house rule for a
              material stock mutation: one review (the ConfirmDialog below)
              before the request, and a visible outcome after it. */}
          {canOfferAddItems ? (
            <section className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {translateOr('add_items_to_sale', 'Add items to this sale', 'បន្ថែមទំនិញទៅការលក់នេះ')}
              </div>
              <label htmlFor="sale-add-item-search" className="mb-1 block text-xs text-gray-400">
                {t('product') || 'Product'}
              </label>
              <input
                id="sale-add-item-search"
                ref={addSearchInputRef}
                className="input h-10 text-sm"
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder={translateOr('add_items_search_placeholder', 'Search by name or barcode', 'ស្វែងរកតាមឈ្មោះ ឬបាកូដ')}
                autoComplete="off"
              />
              {addSearching ? (
                <p className="mt-2 text-xs text-gray-400">{t('loading') || 'Loading'}</p>
              ) : addQuery.trim().length >= 2 && addCandidates.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">
                  {translateOr('add_items_no_matches', 'No products matched.', 'រកមិនឃើញផលិតផលទេ។')}
                </p>
              ) : null}
              {addCandidates.length > 0 ? (
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                  {addCandidateGroups.map((candidate) => (
                    <li key={String(candidate.id)}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => setAddPicking(candidate)}
                      >
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-gray-900 dark:text-white">{candidate.__displayName || candidate.name}</span>
                          <span className="block text-[11px] text-gray-400">
                            {`${candidate.__groupChoices?.length || 1} ${t('options') || 'options'} · ${t('current_stock') || 'Stock'}: ${toNumber(candidate.__groupStock)}`}
                          </span>
                        </span>
                        <span className="whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-200">
                          {toNumber(candidate.__groupMinPrice) !== toNumber(candidate.__groupMaxPrice)
                            ? `${fmtUSD(toNumber(candidate.__groupMinPrice))}–${fmtUSD(toNumber(candidate.__groupMaxPrice))}`
                            : fmtUSD(toNumber(candidate.__groupMinPrice))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {addPicking ? (
                <SaleDetailProductPicker
                  candidate={addPicking}
                  candidates={addCandidates}
                  branchId={sale.branch_id ?? null}
                  fmtUSD={fmtUSD}
                  t={t}
                  stockMoves={addStockMoves}
                  stagedLines={addLines}
                  onCancel={closeAddPicker}
                  onChoose={stageAddLine}
                />
              ) : null}

              {addLines.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400">
                  {translateOr('add_items_none_staged', 'Pick a product above to add it to this sale.', 'ជ្រើសរើសផលិតផលខាងលើ ដើម្បីបន្ថែមទៅការលក់នេះ។')}
                </p>
              ) : (
                <>
                  <ul className="mt-3 space-y-2">
                    {addLines.map((line) => (
                      <li key={`${line.productId}:${line.batchId ?? 'stock'}`} className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900 dark:text-white">
                            {line.name}
                            {line.barcode ? <span className="mt-0.5 block font-mono text-[11px] font-normal text-gray-400">{line.barcode}</span> : null}
                            {line.batchLabel ? <span className="mt-0.5 block text-[11px] font-normal text-blue-700 dark:text-blue-300">{line.batchLabel}{line.batchReceivedAt ? ` · ${translateOr('received_date', 'Received', 'ថ្ងៃទទួល')}: ${line.batchReceivedAt.slice(0, 10)}` : ''}{line.batchExpiryDate ? ` · ${t('expiry_date') || 'Expiry'}: ${line.batchExpiryDate}` : ''}</span> : null}
                          </span>
                          <span className="flex items-center gap-1">
                            <label htmlFor={`sale-add-qty-${line.productId}`} className="text-[11px] text-gray-400">{t('qty_short') || 'Qty'}</label>
                            <input
                              id={`sale-add-qty-${line.productId}`}
                              className="input h-9 w-16 text-right text-sm"
                              inputMode="numeric"
                              value={String(line.quantity)}
                              onChange={(event) => {
                                // Whole units only, never below one: a zero or
                                // negative line would ask the server to move
                                // stock the wrong way through an add.
                                const next = Math.max(1, Math.floor(Number(event.target.value) || 1))
                                setAddLines((current) => current.map((row) => (
                                  row.productId === line.productId && row.batchId === line.batchId ? { ...row, quantity: next } : row
                                )))
                              }}
                            />
                          </span>
                          <span className="flex items-center gap-1">
                            <label htmlFor={`sale-add-price-${line.productId}`} className="text-[11px] text-gray-400">{t('unit_price') || 'Unit price'}</label>
                            <input
                              id={`sale-add-price-${line.productId}`}
                              className="input h-9 w-24 text-right text-sm"
                              inputMode="decimal"
                              value={line.priceText}
                              onChange={(event) => {
                                const text = event.target.value
                                setAddLines((current) => current.map((row) => (
                                  row.productId === line.productId && row.batchId === line.batchId
                                    ? { ...row, priceText: text, unitPriceUsd: toNumber(text) }
                                    : row
                                )))
                              }}
                            />
                          </span>
                          <span className="w-20 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                            {fmtUSD(line.unitPriceUsd * line.quantity)}
                          </span>
                          <button
                            type="button"
                            aria-label={t('remove') || 'Remove'}
                            className="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => setAddLines((current) => current.filter((row) => row.productId !== line.productId || row.batchId !== line.batchId))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {addStockMoves && (line.stockQuantity <= 0 || line.quantity > line.stockQuantity) ? (
                          <p role="alert" className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {`${t('error') || 'Error'}: ${line.stockQuantity <= 0 ? t('no_stock_in_branch') : t('not_enough_stock')}`}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <DetailRowGroup>
                      <DetailRow
                        label={translateOr('add_items_added_subtotal', 'Added subtotal', 'សរុបរងបន្ថែម')}
                        value={fmtUSD(addedSubtotalUsd)}
                      />
                      <DetailRow
                        label={translateOr('add_items_new_total', 'New total', 'សរុបថ្មី')}
                        value={fmtUSD(projectedTotalUsd)}
                      />
                      {outstandingUsd > 0 || projectedOutstandingUsd > 0 ? (
                        <DetailRow
                          label={translateOr('add_items_new_due', 'New amount due', 'ចំនួនត្រូវបង់ថ្មី')}
                          value={fmtUSD(projectedOutstandingUsd)}
                        />
                      ) : null}
                    </DetailRowGroup>
                  </div>
                  {/* Says out loud whether this write touches stock. The
                      answer is the sale's status (see decision 2 in the
                      Worker's lib/saleLineAddition.ts), and a cashier should
                      not have to know the rule to predict the effect. */}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {addStockMoves
                      ? translateOr('add_items_moves_stock', 'These units leave stock now, exactly as they would at checkout.', 'ចំនួននេះនឹងចេញពីស្តុកភ្លាមៗ ដូចពេលទូទាត់ដែរ។')
                      : translateOr('add_items_holds_stock', 'This sale has not taken stock yet, so nothing leaves stock until it is completed.', 'ការលក់នេះមិនទាន់យកស្តុកទេ ដូច្នេះគ្មានអ្វីចេញពីស្តុក រហូតដល់វាបញ្ចប់។')}
                  </p>
                  <button
                    type="button"
                    className="btn-primary mt-3 w-full text-xs"
                    disabled={addSaving || addLines.length === 0 || addHasStockError}
                    onClick={() => setAddConfirmOpen(true)}
                  >
                    {addSaving ? (t('loading') || 'Saving') : (translateOr('add_items_submit', 'Add to sale', 'បន្ថែមទៅការលក់'))}
                  </button>
                </>
              )}
            </section>
          ) : null}

          {/* THE AUDIT TRAIL (S4-30). This is the half of the feature the
              receipt deliberately does not have: the receipt prints the net
              result as one finalized sale, and this prints how it got there --
              the original value, every add-on-top, by how much, who did it and
              when. A removed line lives ONLY here, because it is gone from the
              item list above and from the receipt by design.

              It renders whenever the sale has any history, regardless of
              whether the viewer may amend: reading what happened is a
              different capability from doing it, and hiding the trail from
              whoever is reconciling the till would defeat the point. */}
          {amendmentsLoading || amendmentsFailed || amendmentGroups.length > 0 ? (
            <SectionCard title={translateOr('amendment_history', 'Changes after the sale', 'ការកែប្រែក្រោយការលក់')}>
              {amendmentsLoading ? (
                <div className="text-xs text-gray-400">{t('loading') || 'Loading'}</div>
              ) : amendmentsFailed ? (
                /* "Could not load" and "never amended" are different answers,
                   and printing the second when the first is true would be a
                   lie about the record. */
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  {translateOr('amendment_history_failed', 'The change history could not be loaded. It has not been lost — reopen this sale to try again.', 'មិនអាចផ្ទុកប្រវត្តិការកែប្រែបានទេ។ វាមិនបាត់ទេ — សូមបើកការលក់នេះឡើងវិញដើម្បីព្យាយាមម្តងទៀត។')}
                </div>
              ) : (
                <ol className="space-y-2">
                  {amendmentGroups.map((entry) => {
                    const key = entry.type === 'replacement' ? `r-${entry.removed.id}-${entry.added.id}` : `s-${entry.row.id}`
                    const head = entry.type === 'replacement' ? entry.removed : entry.row
                    return (
                      <li key={key} className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {entry.type === 'replacement'
                              ? `${entry.removed.subject} → ${entry.added.subject}`
                              : entry.row.subject}
                          </div>
                          {/* who, and when -- the two questions a shop asks
                              of a changed receipt before any other.

                              Formatted HERE, not in utils/saleAmendments.ts,
                              which deliberately keeps `at` as the raw server
                              value. D1's CURRENT_TIMESTAMP is "YYYY-MM-DD
                              HH:MM:SS" in UTC with no zone marker, and
                              fmtDateTime24 is what converts it to business
                              time (Asia/Phnom_Penh, +7) instead of printing an
                              ISO-ish string seven hours off. Keeping the raw
                              value in the shaped row is the point: a display
                              string is not a timestamp, and anything that ever
                              sorts or compares these entries must read the
                              real one. S4-33 hit exactly that bug in posCore,
                              where a lot sort key built by splitting a
                              rendered date moved lots into the wrong year the
                              moment the display went day-first. */}
                          <div className="tabular-nums text-[11px] text-gray-500 dark:text-gray-400">
                            {[head.actor, head.at ? fmtDateTime24(head.at) : null].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {entry.type === 'replacement' ? (
                          <div className="mt-1 text-gray-600 dark:text-gray-300">
                            {translateOr('amendment_replaced', 'Replaced', 'បានជំនួស')}
                            {` — ${entry.removed.subject} ${entry.removed.deltaText}, ${entry.added.subject} ${entry.added.deltaText}`}
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-gray-600 dark:text-gray-300">
                            {/* "1 -> 2 (+1)": the before is kept on the screen,
                                which is the whole of the owner's "in details it
                                shows both". */}
                            <span className="tabular-nums">{entry.row.beforeText}</span>
                            <span aria-hidden="true">→</span>
                            <span className="tabular-nums font-semibold text-gray-900 dark:text-white">{entry.row.afterText}</span>
                            <span className={`tabular-nums font-semibold ${entry.row.isRemoval ? 'text-red-600 dark:text-red-400' : entry.row.isIncrease ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                              ({entry.row.deltaText})
                            </span>
                          </div>
                        )}
                        {head.via !== 'amend' ? (
                          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {head.via === 'undo'
                              ? translateOr('amendment_via_undo', 'Recorded by an undo', 'កត់ត្រាដោយការត្រឡប់ក្រោយ')
                              : translateOr('amendment_via_redo', 'Recorded by a redo', 'កត់ត្រាដោយការធ្វើឡើងវិញ')}
                          </div>
                        ) : null}
                        {/* A change that moved no stock says WHY. Without this
                            it reads as a bug to whoever counts the shelf. */}
                        {head.stockNote === 'stock_skipped' ? (
                          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {translateOr('amendment_stock_skipped', 'Stock was not touched: this sale is marked as not affecting stock.', 'ស្តុកមិនត្រូវបានប៉ះពាល់ទេ៖ ការលក់នេះត្រូវបានសម្គាល់ថាមិនប៉ះពាល់ស្តុក។')}
                          </div>
                        ) : head.stockNote === 'not_deducted' ? (
                          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {translateOr('amendment_stock_not_deducted', 'Stock was not touched: this sale had not taken stock yet.', 'ស្តុកមិនត្រូវបានប៉ះពាល់ទេ៖ ការលក់នេះមិនទាន់យកស្តុក។')}
                          </div>
                        ) : null}
                        {head.note ? (
                          <div className="mt-1 break-words text-[11px] text-gray-500 dark:text-gray-400">{head.note}</div>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              )}
            </SectionCard>
          ) : null}

          {currentStatus === 'cancelled' ? (
            <section className="rounded-xl border border-red-200 bg-red-50/50 p-3 dark:border-red-800/60 dark:bg-red-900/15">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">
                {t('cancelled_sale') || 'Cancelled sale'}
              </div>
              {/* Same label/value rows as every other block -- the reason used
                  to be inline prose ("Reason: Mistake -- note"), the only
                  field in the modal whose label sat on the same line as its
                  value with a colon. */}
              <DetailRowGroup>
                <DetailRow
                  label={t('cancel_reason_label') || 'Reason'}
                  value={sale.cancel_reason
                    ? `${sale.cancel_reason === 'mistake'
                      ? (t('cancel_reason_mistake') || 'Mistake')
                      : sale.cancel_reason === 'buyer_refused'
                        ? (t('cancel_reason_buyer_refused') || "Buyer didn't buy")
                        : (t('cancel_reason_other') || 'Other')}${sale.cancel_note ? ` — ${sale.cancel_note}` : ''}`
                    : null}
                />
                <DetailRow
                  label={t('cancelled_by') || 'Cancelled by'}
                  value={[sale.cancelled_by_name, sale.cancelled_at ? fmtTime(sale.cancelled_at) : ''].filter(Boolean).join(' · ') || null}
                />
              </DetailRowGroup>
              {toNumber(sale.cancel_fee_id) > 0 ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {t('cancel_lost_fee_recorded') || 'A lost fee was recorded on the Expenses page for this cancellation.'}
                </p>
              ) : null}
              {onStatusChange ? (
                <button
                  type="button"
                  className="btn-secondary mt-3 w-full text-xs"
                  disabled={statusSaving}
                  onClick={async () => {
                    // Un-cancel: the backend only accepts the status the
                    // sale was in when cancelled (it re-deducts the
                    // un-returned stock and removes the linked fee row).
                    const target = String(sale.status_before_cancel || 'completed')
                    setStatusSaving(true)
                    try {
                      await onStatusChange(sale.id, target, statusNotes)
                      onClose()
                    } finally {
                      setStatusSaving(false)
                    }
                  }}
                >
                  {statusSaving
                    ? (t('loading') || 'Saving')
                    : `${t('uncancel_sale') || 'Un-cancel'} (${getStatusLabel(String(sale.status_before_cancel || 'completed'), t)})`}
                </button>
              ) : null}
            </section>
          ) : null}

          {!['returned', 'cancelled'].includes(currentStatus) ? (
            <section ref={statusSectionRef} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('update_status') || 'Update status'}
              </div>
              <SaleStatusWorkflow
                currentStatus={currentStatus}
                selectedStatus={newStatus}
                notes={statusNotes}
                saving={statusSaving}
                t={t}
                onSelect={(status) => {
                  setNewStatus(status)
                  settlementRequestIdRef.current = createSettlementRequestId()
                }}
                onNotesChange={(notes) => {
                  setStatusNotes(notes)
                  settlementRequestIdRef.current = createSettlementRequestId()
                }}
                onConfirm={handleStatusUpdate}
                reviewRequestId={statusReviewRequestId}
                confirmDisabled={needsPaymentEntry && settlementRows.length > MAX_SETTLEMENT_ROWS}
                showNotes={!needsPaymentEntry}
              >
              {needsPaymentEntry ? (
                <SaleSettlementEditor
                  rows={settlementRows}
                  configuredMethods={settlementSession.configuredMethods}
                  exchangeRate={settlementSession.exchangeRate}
                  totalUsd={totalUsd}
                  saving={statusSaving}
                  error={payError}
                  recordedIssue={settlementSession.recordedIssue}
                  translate={translateOr}
                  fmtUSD={fmtUSD}
                  fmtKHR={fmtKHR}
                  onChange={(rows) => {
                    setSettlementRows(rows)
                    settlementRequestIdRef.current = createSettlementRequestId()
                    setPayError('')
                  }}
                />
              ) : null}
              </SaleStatusWorkflow>
            </section>
          ) : null}

          {/* S4-24: the record's actions, at the end of the record. They read
              in the order you reach them -- you have just finished reading the
              sale, so Print and Return are the next things you might do.
              Full-width and stacked below sm so a thumb cannot miss them; a
              row from sm. */}
          {onPrint || onReturn ? (
            <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end dark:border-gray-700">
              {onReturn ? (
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onReturn(sale)}
                    disabled={returnBlockedReason !== ''}
                    className="w-full rounded-lg bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50"
                  >
                    {t('return') || 'Return'}
                  </button>
                  {/* Why the action is unavailable stays behind the hint, not
                      as inline prose next to the button. */}
                  {returnBlockedReason ? (
                    <InfoHint text={returnBlockedReason} label={t('return') || 'Return'} />
                  ) : null}
                </span>
              ) : null}
              {onPrint ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onPrint(sale)
                  }}
                  className="w-full rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100 sm:w-auto dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                >
                  {t('print') || 'Print'}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* The review step. A stock write never leaves this app on a single
              click: the person sees each line, the money it adds, and whether
              stock moves, and confirms that summary. */}
          {addConfirmOpen ? (
            <ConfirmDialog
              t={t}
              title={translateOr('add_items_to_sale', 'Add items to this sale', 'បន្ថែមទំនិញទៅការលក់នេះ')}
              message={sale.receipt_number ? `#${sale.receipt_number}` : undefined}
              items={[
                ...addLines.map((line): ConfirmReviewItem => ({
                  label: line.name,
                  value: `${line.quantity} × ${fmtUSD(line.unitPriceUsd)} = ${fmtUSD(line.unitPriceUsd * line.quantity)}`,
                })),
                {
                  label: translateOr('add_items_added_subtotal', 'Added subtotal', 'សរុបរងបន្ថែម'),
                  value: fmtUSD(addedSubtotalUsd),
                },
                {
                  label: translateOr('add_items_new_total', 'New total', 'សរុបថ្មី'),
                  value: fmtUSD(projectedTotalUsd),
                },
                {
                  label: t('stock') || 'Stock',
                  value: addStockMoves
                    ? translateOr('add_items_confirm_deducts', 'Deducted now', 'កាត់ភ្លាមៗ')
                    : translateOr('add_items_confirm_no_deduct', 'Not deducted yet', 'មិនទាន់កាត់'),
                },
              ]}
              note={translateOr('add_items_undo_note', 'You can undo this from the history bar right after.', 'អ្នកអាចត្រឡប់វិញភ្លាមៗបន្ទាប់ពីនេះ ពីរបារប្រវត្តិ។')}
              confirmLabel={translateOr('add_items_submit', 'Add to sale', 'បន្ថែមទៅការលក់')}
              working={addSaving}
              onConfirm={submitAddItems}
              onClose={() => { if (!addSaving) setAddConfirmOpen(false) }}
            />
          ) : null}

          {/* Every amendment gets the same single review the addition does --
              they change a receipt the customer already holds, and half of
              them move stock. One dialog for all five kinds, so no amendment
              can ever be the one that slipped through on a single click. */}
          {amendConfirm ? (
            <ConfirmDialog
              t={t}
              title={amendConfirm.title}
              message={sale.receipt_number ? `#${sale.receipt_number}` : undefined}
              items={[
                { label: translateOr('amend_change', 'Change', 'ការកែប្រែ'), value: amendConfirm.summary },
                {
                  label: t('stock') || 'Stock',
                  value: amendStockMoves
                    ? translateOr('amend_confirm_moves_stock', 'Stock moves now', 'ស្តុកនឹងផ្លាស់ប្តូរភ្លាមៗ')
                    : translateOr('amend_confirm_no_stock', 'Stock is not touched', 'ស្តុកមិនត្រូវបានប៉ះពាល់'),
                },
              ]}
              note={translateOr('amend_confirm_note', 'The receipt keeps its number and prints the new total. This change stays in the sale history.', 'វិក្កយបត្ររក្សាលេខដដែល ហើយបោះពុម្ពសរុបថ្មី។ ការកែប្រែនេះនៅក្នុងប្រវត្តិការលក់។')}
              confirmLabel={translateOr('amend_confirm', 'Apply change', 'អនុវត្តការកែប្រែ')}
              working={amendSaving}
              onConfirm={() => submitAmendment(amendConfirm.request)}
              onClose={() => { if (!amendSaving) setAmendConfirm(null) }}
            />
          ) : null}
        </div>
      </div>
      <UnsavedChangesPrompt guard={closeGuard} />
    </div>,
    document.body,
  )
}

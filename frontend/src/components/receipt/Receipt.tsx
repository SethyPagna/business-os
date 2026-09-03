import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import ImageDown from 'lucide-react/dist/esm/icons/image-down.js'
import Printer from 'lucide-react/dist/esm/icons/printer.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { parseReceiptTemplate } from '../receipt-settings/template'
import { buildAppliedReceiptConfig } from '../../utils/receiptAppliedConfig.ts'
import ReceiptQrCodes, { normalizeQrSocialLinksForReceipt, type ReceiptQrEntry } from './ReceiptQrCodes.tsx'
import LazyPortalMenu from '../shared/LazyPortalMenu'

type LanguageMode = 'en' | 'km' | 'both'
type ReceiptExportMode = 'print' | 'open' | 'image'
type ReceiptLabelKey = keyof typeof LABELS.en
type ReceiptPrintModule = typeof import('../../utils/printReceipt')
type TranslateFn = (key: string) => string | undefined
type MoneyFormatter = (value: number | string) => string

interface ReceiptItem {
  id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  name?: string | null
  sku?: string | null
  quantity?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  price_usd?: number | string | null
  price_khr?: number | string | null
  price?: number | string | null
  // Z2: the line's selling/base price (before the manual discount) and any
  // product-level (promotion/special) cut, so the receipt can show the full
  // per-line discount (list − charged) as (-$x.xx).
  base_price_usd?: number | string | null
  product_discount_usd?: number | string | null
  // The line's price tier -- comes straight through on the stored sale_items
  // row (the list query SELECTs si.*) and on the POS in-memory checkout
  // payload, so the receipt can print a small tier tag ("VIP" / "Wholesale")
  // under the item name. Absent or 'selling' -> no tag. Toggled per line in
  // the cart (the VIP marker), so a deselected line arrives here as 'selling'.
  price_mode?: string | null
  product_discount_label?: string | null
}

interface ReceiptSale {
  receiptNumber?: string | null
  receipt_number?: string | null
  created_at?: string | number | Date | null
  items?: ReceiptItem[] | string | null
  exchange_rate?: number | string | null
  subtotal_usd?: number | string | null
  subtotal?: number | string | null
  discount_usd?: number | string | null
  discount?: number | string | null
  discount_khr?: number | string | null
  membership_discount_usd?: number | string | null
  membership_discount_khr?: number | string | null
  membership_points_redeemed?: number | string | null
  tax_usd?: number | string | null
  tax?: number | string | null
  tax_khr?: number | string | null
  delivery_fee_usd?: number | string | null
  delivery_fee_khr?: number | string | null
  total_usd?: number | string | null
  total?: number | string | null
  total_khr?: number | string | null
  amount_paid_usd?: number | string | null
  amount_paid?: number | string | null
  amount_paid_khr?: number | string | null
  change_usd?: number | string | null
  change_returned?: number | string | null
  change_khr?: number | string | null
  refund_usd?: number | string | null
  refund_khr?: number | string | null
  sale_status?: string | null
  cashier_name?: string | null
  payment_method?: string | null
  payment_details?: string | Array<{ method?: string | null; amount_usd?: number | string | null; amount_khr?: number | string | null }> | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_address?: string | null
  customer_membership_number?: string | null
  is_delivery?: boolean | number | string | null
  delivery_contact_name?: string | null
  delivery_contact_phone?: string | null
  delivery_contact_address?: string | null
}

type ReceiptSettings = Record<string, unknown> & {
  business_name?: string
  business_address?: string
  business_phone?: string
  business_email?: string
  tax_id?: string
  receipt_footer?: string
  exchange_rate?: number | string
}

interface ReceiptProps {
  sale: ReceiptSale
  settings?: ReceiptSettings
  onClose: () => void
  _previewMode?: boolean
}

interface RowProps {
  label: ReactNode
  value: ReactNode
  subValue?: ReactNode
  bold?: boolean
  tone?: string
}

const useApp = useAppHook as () => {
  fmtUSD: MoneyFormatter
  fmtKHR: MoneyFormatter
  khrSymbol: string
  t?: TranslateFn
}

let receiptPrintModulePromise: Promise<ReceiptPrintModule> | null = null

function loadReceiptPrintModule(): Promise<ReceiptPrintModule> {
  if (!receiptPrintModulePromise) receiptPrintModulePromise = import('../../utils/printReceipt')
  return receiptPrintModulePromise
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function stripEmoji(text: string): string
function stripEmoji<T>(text: T): T
function stripEmoji(text: unknown): unknown {
  if (typeof text !== 'string') return text
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').replace(/\s{2,}/g, ' ').trim()
}

function displayAddress(raw: unknown): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(String(raw))
    if (Array.isArray(parsed)) return String(parsed[0] || '')
  } catch {}
  return String(raw)
}

function parseItems(raw: ReceiptSale['items']): ReceiptItem[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePaymentDetails(raw: ReceiptSale['payment_details']): Array<{ method: string; amount_usd: number; amount_khr: number }> {
  const candidate = Array.isArray(raw) ? raw : (() => {
    if (typeof raw !== 'string') return []
    try { return JSON.parse(raw) } catch { return [] }
  })()
  if (!Array.isArray(candidate)) return []
  return candidate.map((detail) => ({
    method: String(detail?.method || '').trim(),
    amount_usd: toNumber(detail?.amount_usd),
    amount_khr: toNumber(detail?.amount_khr),
  })).filter((detail) => detail.method && (detail.amount_usd > 0 || detail.amount_khr > 0))
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function getReceiptPaperWidthMm(printSettings: { paperSize?: unknown; customWidth?: unknown }, fallback = 80): number {
  const paperSize = String(printSettings.paperSize || '').toLowerCase()
  if (paperSize === 'custom') return Math.max(40, Number.parseFloat(String(printSettings.customWidth || fallback)) || fallback)
  if (paperSize === '58mm') return 58
  if (paperSize === '72mm') return 72
  if (paperSize === '80mm') return 80
  if (paperSize === '80x50mm') return 80
  if (paperSize === 'a4') return 210
  if (paperSize === 'letter') return 216
  return Math.max(40, fallback)
}

const LABELS = {
  en: {
    receipt: 'RECEIPT',
    receiptNum: 'Receipt #:',
    date: 'Date:',
    cashier: 'Cashier:',
    payment: 'Payment:',
    rate: 'Rate:',
    status: 'Status:',
    customer: 'Customer:',
    phone: 'Phone:',
    address: 'Address:',
    membership: 'Membership:',
    delivery: 'Delivery:',
    driver: 'Driver:',
    subtotal: 'Subtotal:',
    discount: 'Discount:',
    membershipDiscount: 'Membership discount:',
    pointsRedeemed: 'Points redeemed:',
    tax: 'Tax:',
    total: 'TOTAL',
    paid: 'Paid:',
    change: 'Change:',
    refunded: 'Refunded:',
    thankYou: 'Thank you for your patronage!',
    qty: 'Qty',
    visitWebsite: 'Visit our website',
    followUs: 'Follow us',
  },
  km: {
    receipt: 'បង្កាន់ដៃ',
    receiptNum: 'លេខបង្កាន់ដៃ:',
    date: 'កាលបរិច្ឆេទ:',
    cashier: 'អ្នកគិតលុយ:',
    payment: 'ការទូទាត់:',
    rate: 'អត្រាប្តូរ:',
    status: 'ស្ថានភាព:',
    customer: 'អតិថិជន:',
    phone: 'ទូរស័ព្ទ:',
    address: 'អាសយដ្ឋាន:',
    membership: 'លេខសមាជិក:',
    delivery: 'ការដឹកជញ្ជូន:',
    driver: 'អ្នកដឹកជញ្ជូន:',
    subtotal: 'សរុបរង:',
    discount: 'បញ្ចុះតម្លៃ:',
    membershipDiscount: 'បញ្ចុះតម្លៃសមាជិក:',
    pointsRedeemed: 'ពិន្ទុបានប្រើ:',
    tax: 'ពន្ធ:',
    total: 'សរុប',
    paid: 'បានបង់:',
    change: 'ប្រាក់អាប់:',
    refunded: 'បានសងវិញ:',
    thankYou: 'សូមអរគុណសម្រាប់ការទិញទំនិញ!',
    qty: 'ចំនួន',
    visitWebsite: 'ទស្សនាគេហទំព័ររបស់យើង',
    followUs: 'តាមដានពួកយើង',
  },
}

const RECEIPT_KHMER_LABELS = LABELS.km satisfies Record<ReceiptLabelKey, string>

function stripTrailingColon(value: string): string {
  return value.endsWith(':') ? value.slice(0, -1) : value
}

function labelFor(mode: LanguageMode, key: ReceiptLabelKey): string {
  if (mode === 'km') return RECEIPT_KHMER_LABELS[key]
  if (mode !== 'both') return LABELS.en[key]
  // Bilingual labels: join the English/Khmer terms with a single trailing
  // colon instead of concatenating two colon-terminated strings (which
  // produced "Receipt #: / លេខបង្កាន់ដៃ:" -- two colons for one label).
  const enLabel = LABELS.en[key]
  const kmLabel = RECEIPT_KHMER_LABELS[key]
  const endsWithColon = enLabel.endsWith(':')
  return `${stripTrailingColon(enLabel)} / ${stripTrailingColon(kmLabel)}${endsWithColon ? ':' : ''}`
}

function Row({ label, value, subValue, bold = false, tone = '' }: RowProps) {
  return (
    <div data-receipt-line="true" className={`my-1 grid grid-cols-[minmax(0,1fr)_minmax(4.6rem,auto)] items-start gap-x-3 gap-y-1 ${tone}`}>
      <span className={`min-w-0 overflow-visible whitespace-normal break-words pr-1 leading-snug ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <div className="min-w-0 whitespace-normal break-words text-right leading-snug">
        <div className={`${bold ? 'font-semibold' : ''}`}>{value}</div>
        {subValue ? <div className="text-[10px] text-gray-500">{subValue}</div> : null}
      </div>
    </div>
  )
}

export default function Receipt({ sale, settings = {}, onClose, _previewMode }: ReceiptProps) {
  const { fmtUSD, fmtKHR, khrSymbol, t } = useApp()
  const printRef = useRef<HTMLDivElement | null>(null)
  const compactPrintRef = useRef<HTMLDivElement | null>(null)
  const appliedConfig = useMemo(() => buildAppliedReceiptConfig({ settings }), [settings])
  const tpl = parseReceiptTemplate(appliedConfig.serializedTemplate)
  const appliedSettings = appliedConfig.settings
  const appliedPrintSettings = appliedConfig.printSettings
  const highContrastBold = appliedPrintSettings.highContrastBold
  const compactSalesReceipt = tpl.sales_receipt_enabled === true || String(appliedPrintSettings.paperSize || '').toLowerCase() === '80x50mm'
  // B5: enabling the 80x50 card must not make the FULL receipt unreachable
  // -- with it on, BOTH renditions preview and Print offers BOTH sizes.
  // The card prints on its fixed 80x50 sheet (zero margins, the sheet IS
  // the layout); the full receipt prints on the continuous roll -- an
  // '80x50mm' paper setting maps to the 80mm roll for it, any other
  // configured size is kept as the operator set it.
  const compactPrintSettings = { ...appliedPrintSettings, paperSize: 'custom', customWidth: '80', customHeight: '50', marginTop: '0', marginRight: '0', marginBottom: '0', marginLeft: '0' }
  const fullPrintSettings = String(appliedPrintSettings.paperSize || '').toLowerCase() === '80x50mm'
    ? { ...appliedPrintSettings, paperSize: '80mm' }
    : appliedPrintSettings
  const effectivePrintSettings = compactSalesReceipt ? compactPrintSettings : appliedPrintSettings
  const receiptWidthMm = getReceiptPaperWidthMm(effectivePrintSettings, tpl.width || 80)
  const fullReceiptWidthMm = getReceiptPaperWidthMm(fullPrintSettings, tpl.width || 80)
  const [lang, setLang] = useState<LanguageMode>((tpl.receipt_language as LanguageMode) || 'en')
  const [pdfBusy, setPdfBusy] = useState<ReceiptExportMode | ''>('')

  useEffect(() => {
    if (_previewMode) setLang((tpl.receipt_language as LanguageMode) || 'en')
  }, [_previewMode, tpl.receipt_language])

  const em = (text: string): string => (tpl.show_emojis === false ? stripEmoji(text) : text)
  const items = useMemo(() => parseItems(sale.items), [sale.items])
  const paymentDetails = useMemo(() => parsePaymentDetails(sale.payment_details), [sale.payment_details])
  const rNum = sale.receiptNumber || sale.receipt_number || 'Receipt'
  const createdAt = sale.created_at
  // Route every supported timestamp shape through the shared formatter:
  // Date objects, epoch numbers, ISO values, and SQLite's timezone-less UTC
  // all resolve to the same mm/dd/yyyy HH:mm Phnom Penh wall clock.
  const dateStr = fmtDateTime24(createdAt || new Date())
  const exchangeRate = toNumber(sale.exchange_rate) || toNumber(appliedSettings.exchange_rate as number | string | undefined) || 4100
  const subtotalUsd = toNumber(sale.subtotal_usd ?? sale.subtotal)
  const discountUsd = toNumber(sale.discount_usd ?? sale.discount)
  const discountKhr = toNumber(sale.discount_khr) || discountUsd * exchangeRate
  const membershipDiscountUsd = toNumber(sale.membership_discount_usd)
  const membershipDiscountKhr = toNumber(sale.membership_discount_khr) || membershipDiscountUsd * exchangeRate
  const membershipPointsRedeemed = toNumber(sale.membership_points_redeemed)
  const taxUsd = toNumber(sale.tax_usd ?? sale.tax)
  const taxKhr = toNumber(sale.tax_khr) || taxUsd * exchangeRate
  const deliveryFeeUsd = toNumber(sale.delivery_fee_usd)
  const deliveryFeeKhr = toNumber(sale.delivery_fee_khr) || deliveryFeeUsd * exchangeRate
  const totalUsd = toNumber(sale.total_usd ?? sale.total)
  const totalKhr = toNumber(sale.total_khr) || totalUsd * exchangeRate
  const paidUsd = toNumber(sale.amount_paid_usd ?? sale.amount_paid)
  const paidKhr = toNumber(sale.amount_paid_khr)
  const changeUsd = toNumber(sale.change_usd ?? sale.change_returned)
  const changeKhr = toNumber(sale.change_khr)
  const refundUsd = toNumber(sale.refund_usd)
  const refundKhr = toNumber(sale.refund_khr)
  const actualFont =
    lang === 'km' || lang === 'both'
      ? `"Khmer OS", "Noto Sans Khmer", "Segoe UI", sans-serif`
      : tpl.font_family === 'serif'
        ? 'Georgia, "Times New Roman", serif'
        : tpl.font_family === 'sans'
          ? 'system-ui, -apple-system, sans-serif'
          : '"Courier New", Courier, monospace'
  const fs = tpl.font_size || 12
  const divider = (tpl.line_char || '-').repeat(28)
  const headerDivider = (tpl.header_separator || '=').repeat(28)
  const footerDivider = (tpl.footer_separator || '-').repeat(28)
  const headerAlignClass = tpl.align_header === 'left' ? 'text-left' : tpl.align_header === 'right' ? 'text-right' : 'text-center'

  const showMembershipId = tpl.show_customer_membership !== false
  const hasCustomer = sale.customer_name || sale.customer_phone || sale.customer_address || (showMembershipId && sale.customer_membership_number)
  const hasDelivery = !!sale.is_delivery && (sale.delivery_contact_name || sale.delivery_contact_phone || sale.delivery_contact_address)
  const showDeliveryContactSection = tpl.delivery_show_contact !== false
  const showDeliveryDriverName = showDeliveryContactSection && tpl.delivery_show_driver_name !== false
  const showDeliveryDriverPhone = showDeliveryContactSection && tpl.delivery_show_driver_phone !== false

  const sectionMap: Record<string, ReactNode> = {
    header: (
      <div key="header">
        {tpl.custom_header ? <div data-receipt-line="true" className={`${headerAlignClass} font-semibold`}>{em(tpl.custom_header)}</div> : null}
        {tpl.show_business_name && settings?.business_name ? <div data-receipt-line="true" className={`${headerAlignClass} break-words text-lg font-bold`}>{settings.business_name}</div> : null}
        {tpl.show_address && settings?.business_address ? <div data-receipt-line="true" className={`${headerAlignClass} break-words text-[11px]`}>{settings.business_address}</div> : null}
        {tpl.show_phone && settings?.business_phone ? <div data-receipt-line="true" className={`${headerAlignClass} break-words text-[11px]`}>{settings.business_phone}</div> : null}
        {tpl.show_email && settings?.business_email ? <div data-receipt-line="true" className={`${headerAlignClass} break-all text-[11px]`}>{settings.business_email}</div> : null}
        {tpl.show_tax_id && settings?.tax_id ? <div data-receipt-line="true" className={`${headerAlignClass} break-words text-[11px]`}>Tax ID: {settings.tax_id}</div> : null}
        <div data-receipt-line="true" data-receipt-align="center" className="my-1 text-center text-[11px] text-gray-500">{headerDivider}</div>
      </div>
    ),
    order_info: (
      <div key="order_info">
        {tpl.show_receipt_number ? <Row label={labelFor(lang, 'receiptNum')} value={rNum} bold /> : null}
        {tpl.show_date ? <Row label={labelFor(lang, 'date')} value={dateStr} /> : null}
        {tpl.show_cashier ? <Row label={labelFor(lang, 'cashier')} value={sale.cashier_name || '-'} /> : null}
        {tpl.show_payment_method ? <Row label={labelFor(lang, 'payment')} value={sale.payment_method || 'Cash'} subValue={paymentDetails.length > 1 ? paymentDetails.map((detail) => `${detail.method}: ${detail.amount_usd > 0 ? fmtUSD(detail.amount_usd) : ''}${detail.amount_usd > 0 && detail.amount_khr > 0 ? ' + ' : ''}${detail.amount_khr > 0 ? fmtKHR(detail.amount_khr) : ''}`).join(' · ') : ''} /> : null}
        {tpl.show_exchange_rate ? <Row label={labelFor(lang, 'rate')} value={`1 USD = ${Number(exchangeRate).toLocaleString()} ${khrSymbol}`} /> : null}
      </div>
    ),
    customer: hasCustomer ? (
      <div key="customer" className="mt-2 border-t border-dashed border-gray-300 pt-2">
        {tpl.show_customer_name && sale.customer_name ? <Row label={labelFor(lang, 'customer')} value={sale.customer_name} /> : null}
        {tpl.show_customer_phone && sale.customer_phone ? <Row label={labelFor(lang, 'phone')} value={sale.customer_phone} /> : null}
        {tpl.show_customer_address && sale.customer_address ? <Row label={labelFor(lang, 'address')} value={displayAddress(sale.customer_address)} /> : null}
        {showMembershipId && sale.customer_membership_number ? <Row label={labelFor(lang, 'membership')} value={sale.customer_membership_number} /> : null}
      </div>
    ) : null,
    delivery: hasDelivery && showDeliveryContactSection ? (
      <div key="delivery" className="mt-2 border-t border-dashed border-gray-300 pt-2">
        <div className="mb-1 font-semibold">{labelFor(lang, 'delivery')}</div>
        {showDeliveryDriverName && sale.delivery_contact_name ? <Row label={labelFor(lang, 'driver') || 'Driver:'} value={sale.delivery_contact_name} /> : null}
        {showDeliveryDriverPhone && sale.delivery_contact_phone ? <Row label={labelFor(lang, 'phone')} value={sale.delivery_contact_phone} /> : null}
        {showDeliveryContactSection && sale.delivery_contact_address && tpl.delivery_show_address !== false ? <Row label={labelFor(lang, 'address')} value={sale.delivery_contact_address} /> : null}
      </div>
    ) : null,
    items: (
      <div key="items" className="mt-2 border-t border-dashed border-gray-300 pt-2">
        <div data-receipt-line="true" className="mb-1 grid grid-cols-[minmax(0,1fr)_2.8rem_minmax(4.6rem,auto)] gap-x-2 border-b border-dashed border-gray-300 pb-1 text-[10px] font-semibold text-gray-500">
          <span data-receipt-cell="name">Name</span>
          <span data-receipt-cell="qty" className="whitespace-normal text-center leading-tight">{labelFor(lang, 'qty')}</span>
          <span data-receipt-cell="price" className="text-right">Price</span>
        </div>
        {items.map((item, index) => {
          const qty = toNumber(item.quantity) || 1
          const unitUsd = toNumber(item.applied_price_usd ?? item.price_usd ?? item.price)
          const unitKhr = toNumber(item.applied_price_khr ?? item.price_khr)
          const lineUsd = unitUsd * qty
          const lineKhr = unitKhr * qty
          // Per-line discount = the line's ORIGINAL selling price minus what
          // was actually charged, shown as a crossed-out original + savings.
          // Z2: the original is the base/selling price plus any product-level
          // cut (base_price + product_discount = the pre-discount list price),
          // so BOTH the product-level discount AND the cashier's manual
          // discount show -- previously this used price_usd, which checkout
          // stores as the CHARGED price, so real sales showed no discount at
          // all. Falls back to price_usd for older sales without base_price.
          const baseUnitUsd = toNumber(item.base_price_usd)
          const productDiscUnitUsd = toNumber(item.product_discount_usd)
          const originalUnitUsd = baseUnitUsd > 0
            ? baseUnitUsd + productDiscUnitUsd
            : toNumber(item.price_usd ?? item.price)
          const hasItemDiscount = tpl.show_item_discount !== false
            && originalUnitUsd > 0
            && unitUsd > 0
            && originalUnitUsd > unitUsd + 0.005
            && item.applied_price_usd != null
          const itemSavingsUsd = hasItemDiscount ? (originalUnitUsd - unitUsd) * qty : 0
          // Price-tier tag printed under the item name (user). Derived from
          // the persisted price_mode, so a VIP line the cashier left marked
          // prints "VIP" and one they deselected (recorded as 'selling') prints
          // nothing. "VIP" is identical in both packs; Wholesale carries its
          // Khmer បោះដុំ for the forthcoming wholesale tier.
          const tierTag = item.price_mode === 'special'
            ? 'VIP'
            : item.price_mode === 'wholesale'
              ? (lang === 'km' ? 'បោះដុំ' : 'Wholesale')
              : ''
          return (
            <div key={`${item.product_id || item.id || index}-${index}`} className="py-1.5">
              <div data-receipt-line="true" className="grid grid-cols-[minmax(0,1fr)_2.8rem_minmax(4.6rem,auto)] items-start gap-x-2">
                <div data-receipt-cell="name" className="min-w-0 overflow-visible whitespace-normal break-words font-semibold leading-snug">
                  <div data-receipt-main="true">
                    {item.product_name || item.name}
                    {/* Tier tag kept INLINE with the name (user: compact, don't
                        take extra space) -- a tiny marker beside the title, like
                        the SKU chip, not its own line. */}
                    {tierTag ? <span className="ml-1 text-[10px] font-semibold text-emerald-700">{tierTag}</span> : null}
                    {tpl.show_item_sku && item.sku ? <span className="ml-1 text-[10px] text-gray-500">[{item.sku}]</span> : null}
                  </div>
                </div>
                <div data-receipt-cell="qty" className="whitespace-nowrap text-center leading-snug">{tpl.show_item_qty ? qty : ''}</div>
                <div data-receipt-cell="price" className="min-w-0 whitespace-nowrap text-right font-semibold leading-snug">
                  {/* Savings describe the charged price, so they belong in
                      the Price column—not as a second price block beneath the
                      product name. This keeps a discounted row readable as
                      "$2.50 (-$0.50)" at a glance. */}
                  <div>
                    {fmtUSD(lineUsd)}
                    {hasItemDiscount ? <span className="ml-1 text-[10px] font-normal text-red-600">(-{fmtUSD(itemSavingsUsd)})</span> : null}
                  </div>
                  {tpl.show_item_unit_price && qty > 1 ? (
                    <div data-receipt-subline="true" className="text-[10px] font-normal text-gray-500">
                      {qty} × {fmtUSD(unitUsd)}
                    </div>
                  ) : null}
                  {tpl.show_item_khr && lineKhr > 0 ? <div className="text-[10px] font-normal text-gray-500">{fmtKHR(lineKhr)}</div> : null}
                </div>
              </div>
              {tpl.item_separator && index < items.length - 1 ? <div aria-hidden="true" className="mt-1.5 border-t border-gray-200/80" /> : null}
            </div>
          )
        })}
      </div>
    ),
    subtotal: tpl.show_subtotal ? <Row key="subtotal" label={labelFor(lang, 'subtotal')} value={fmtUSD(subtotalUsd)} /> : null,
    discount: tpl.show_discount && discountUsd > 0 ? (
      <Row key="discount" label={labelFor(lang, 'discount')} value={`-${fmtUSD(discountUsd)}`} subValue={tpl.show_discount_khr !== false && discountKhr > 0 ? `-${fmtKHR(discountKhr)}` : ''} tone="text-red-600" />
    ) : null,
    membership_discount: tpl.show_membership_discount !== false && membershipDiscountUsd > 0 ? (
      <Row
        key="membership_discount"
        label={labelFor(lang, 'membershipDiscount')}
        value={`-${fmtUSD(membershipDiscountUsd)}`}
        subValue={tpl.show_membership_discount_khr !== false && membershipDiscountKhr > 0 ? `-${fmtKHR(membershipDiscountKhr)}` : ''}
        tone="text-emerald-600"
      />
    ) : null,
    membership_points: tpl.show_membership_points !== false && membershipPointsRedeemed > 0 ? (
      <Row key="membership_points" label={labelFor(lang, 'pointsRedeemed')} value={membershipPointsRedeemed.toLocaleString()} />
    ) : null,
    tax: tpl.show_tax && taxUsd > 0 ? (
      <Row key="tax" label={labelFor(lang, 'tax')} value={fmtUSD(taxUsd)} subValue={taxKhr > 0 ? fmtKHR(taxKhr) : ''} />
    ) : null,
    delivery_fee: tpl.show_delivery !== false && tpl.delivery_show_fee !== false && deliveryFeeUsd > 0 ? (
      <Row key="delivery_fee" label={labelFor(lang, 'delivery')} value={fmtUSD(deliveryFeeUsd)} subValue={tpl.show_delivery_khr !== false && deliveryFeeKhr > 0 ? fmtKHR(deliveryFeeKhr) : ''} />
    ) : null,
    refund: refundUsd > 0 ? (
      <Row key="refund" label={labelFor(lang, 'refunded')} value={`-${fmtUSD(refundUsd)}`} subValue={refundKhr > 0 ? `-${fmtKHR(refundKhr)}` : ''} tone="text-orange-600" />
    ) : null,
    total: (
      <div key="total" className="my-2 border-y-2 border-black py-2">
        <Row label={labelFor(lang, 'total')} value={fmtUSD(totalUsd)} subValue={tpl.show_total_khr ? fmtKHR(totalKhr) : ''} bold />
      </div>
    ),
    payment: tpl.show_amount_paid ? (
      <div key="payment">
        {paidUsd > 0 ? <Row label={`${labelFor(lang, 'paid')} (USD)`} value={fmtUSD(paidUsd)} /> : null}
        {paidKhr > 0 ? <Row label={`${labelFor(lang, 'paid')} (KHR)`} value={fmtKHR(paidKhr)} /> : null}
      </div>
    ) : null,
    change: tpl.show_change && (changeUsd > 0 || changeKhr > 0) ? (
      <Row key="change" label={labelFor(lang, 'change')} value={changeUsd > 0 ? fmtUSD(changeUsd) : fmtKHR(changeKhr)} subValue={changeUsd > 0 && changeKhr > 0 ? fmtKHR(changeKhr) : ''} bold />
    ) : null,
    footer: (
      <div key="footer" className="mt-2">
        <div data-receipt-line="true" data-receipt-align="center" className="text-center text-[11px] text-gray-500">{footerDivider}</div>
        <div data-receipt-line="true" className="mt-1 text-center text-[11px]">
          {tpl.custom_footer || settings?.receipt_footer || (lang === 'both' ? (
            <><div>{LABELS.en.thankYou}</div><div className="mt-0.5">{RECEIPT_KHMER_LABELS.thankYou}</div></>
          ) : labelFor(lang, 'thankYou'))}
        </div>
        <div data-receipt-line="true" data-receipt-align="center" className="text-center text-[11px] text-gray-500">{footerDivider}</div>
      </div>
    ),
  }

  const fieldOrderBase = Array.isArray(tpl.field_order) && tpl.field_order.length
    ? tpl.field_order
    : ['header', 'order_info', 'customer', 'delivery', 'items', 'subtotal', 'discount', 'tax', 'total', 'payment', 'change', 'footer']

  const fieldOrder: string[] = []
  for (const key of fieldOrderBase) {
    if (key === 'discount') {
      fieldOrder.push('discount')
      fieldOrder.push('membership_discount')
      fieldOrder.push('membership_points')
      continue
    }
    fieldOrder.push(key)
  }
  if ((tpl.delivery_fee_position || 'totals') === 'after_items') {
    const withoutDeliveryFee = fieldOrder.filter((key) => key !== 'delivery_fee')
    const itemsIndex = withoutDeliveryFee.indexOf('items')
    if (itemsIndex >= 0) withoutDeliveryFee.splice(itemsIndex + 1, 0, 'delivery_fee')
    else withoutDeliveryFee.push('delivery_fee')
    fieldOrder.length = 0
    fieldOrder.push(...withoutDeliveryFee)
  }
  if (!fieldOrder.includes('membership_discount')) fieldOrder.push('membership_discount')
  if (!fieldOrder.includes('membership_points')) fieldOrder.push('membership_points')
  if (!fieldOrder.includes('refund')) fieldOrder.splice(Math.max(fieldOrder.indexOf('total'), 0), 0, 'refund')

  const renderedSections = fieldOrder
    .map((key, index) => (key === '---divider---' || key.startsWith('divider_')
      ? <div key={`divider-${index}`} className="text-center text-[11px] text-gray-400">{divider}</div>
      : sectionMap[key]))
    .filter(Boolean)

  const qrEntries: ReceiptQrEntry[] = tpl.show_qr_codes ? [
    ...(tpl.qr_show_portal !== false && tpl.qr_portal_url ? [{
      key: 'portal',
      label: tpl.qr_portal_label || t?.('qr_scan_shop') || 'Shop Online',
      url: String(tpl.qr_portal_url),
    }] : []),
    ...(tpl.qr_show_social ? normalizeQrSocialLinksForReceipt(tpl.qr_social_links) : []),
  ] : []
  const qrBlock = qrEntries.length ? (
    <ReceiptQrCodes key="qr_codes" entries={qrEntries} scanLabel={t?.('qr_scan_to_visit') || 'Scan to visit'} />
  ) : null
  const compactReceiptBlock = compactSalesReceipt ? (
    <div className="space-y-1 text-[10px] leading-snug">
      {settings.business_name ? <div className="text-center text-sm font-bold">{settings.business_name}</div> : null}
      {settings.business_phone ? <div className="text-center">{settings.business_phone}</div> : null}
      <div className="border-t border-gray-300 pt-1">
        <Row label={labelFor(lang, 'date')} value={dateStr} />
        {sale.customer_phone ? <Row label={labelFor(lang, 'phone')} value={sale.customer_phone} /> : null}
        {sale.customer_address ? <Row label={labelFor(lang, 'address')} value={displayAddress(sale.customer_address)} /> : null}
        <Row label={labelFor(lang, 'qty')} value={items.reduce((sum, item) => sum + (toNumber(item.quantity) || 1), 0).toLocaleString()} />
      </div>
      <div className="border-y border-gray-900 py-1">
        <Row label={labelFor(lang, 'total')} value={fmtUSD(totalUsd)} subValue={fmtKHR(totalKhr)} bold />
      </div>
      {tpl.sales_receipt_aba_account_name || tpl.sales_receipt_aba_account_number ? (
        <div className="text-center">
          <div className="font-semibold">{tpl.sales_receipt_aba_account_name || 'ABA'}</div>
          {tpl.sales_receipt_aba_account_number ? <div>{tpl.sales_receipt_aba_account_number}</div> : null}
        </div>
      ) : null}
      {tpl.sales_receipt_aba_qr_image ? <div className="flex justify-center pt-1"><img src={tpl.sales_receipt_aba_qr_image} alt="ABA payment QR" className="h-16 w-16 object-contain" /></div> : null}
      {tpl.sales_receipt_note === 'received_payment' ? <div className="text-center font-semibold">Received payment</div> : null}
    </div>
  ) : null

  const receiptTitle = `Receipt ${rNum}`
  // Which rendition an action targets. Export must mirror the detailed
  // receipt the cashier is looking at, even when the optional 80x50 summary
  // card is enabled. The compact card remains an explicit Print-menu choice;
  // silently exporting it made Open PDF / Image show different data and a
  // fixed 80x50 page instead of the complete continuous receipt.
  type ReceiptVariant = 'full' | 'compact'
  const defaultVariant: ReceiptVariant = 'full'
  const variantTitle = (variant: ReceiptVariant) => `${receiptTitle} - ${variant === 'compact' ? '80x50mm' : `${fullReceiptWidthMm}mm`}`

  const exportReceiptVariant = async (printTools: ReceiptPrintModule, mode: ReceiptExportMode, variant: ReceiptVariant) => {
    const target = variant === 'compact' ? compactPrintRef.current : printRef.current
    const variantSettings = variant === 'compact' ? compactPrintSettings : fullPrintSettings
    if (!target) return
    const title = variantTitle(variant)
    if (mode === 'image') {
      await printTools.downloadReceiptImage(target, {
        title,
        fileName: title,
        printSettings: variantSettings,
      })
    } else if (mode === 'print') {
      await printTools.printReceipt(target, {
        title,
        printSettings: variantSettings,
      })
    } else {
      await printTools.openReceiptPdf(target, {
        title,
        fileName: title,
        printSettings: variantSettings,
        previewFallback: true,
        previewFallbackNote: t?.('receipt_pdf_preview_fallback') || 'PDF export was unavailable, so a printable receipt preview was opened instead.',
      })
    }
  }

  const exportReceiptPdf = async (mode: ReceiptExportMode, variant: ReceiptVariant = defaultVariant) => {
    setPdfBusy(mode)
    try {
      const printTools = await loadReceiptPrintModule()
      await exportReceiptVariant(printTools, mode, variant)
    } catch (error) {
      window.alert(getErrorMessage(error, t?.('unable_generate_receipt_pdf') || 'Unable to generate receipt PDF'))
    } finally {
      setPdfBusy('')
    }
  }

  // "All" keeps the 80x50 card and the full receipt as separate exports. It
  // works for Print, PDF, and Image so a cashier can deliberately choose the
  // compact version, the detailed version, or both without a hidden default.
  const exportBothSeparately = async (mode: ReceiptExportMode) => {
    if (!compactPrintRef.current || !printRef.current) return
    setPdfBusy(mode)
    try {
      const printTools = await loadReceiptPrintModule()
      const results = await Promise.allSettled([
        exportReceiptVariant(printTools, mode, 'compact'),
        exportReceiptVariant(printTools, mode, 'full'),
      ])
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failure) throw failure.reason
    } catch (error) {
      window.alert(getErrorMessage(error, t?.('unable_generate_receipt_pdf') || 'Unable to generate receipt PDF'))
    } finally {
      setPdfBusy('')
    }
  }

  const shellStyleFor = (widthMm: number): CSSProperties => ({
    fontFamily: actualFont,
    fontSize: fs,
    width: `${widthMm}mm`,
    maxWidth: '100%',
    minWidth: 0,
    background: '#ffffff',
    color: highContrastBold ? '#000000' : '#111827',
    fontWeight: highContrastBold ? 700 : 400,
    padding: '18px 16px 20px',
    borderRadius: 12,
    lineHeight: 1.45,
    whiteSpace: 'normal',
    overflow: 'hidden',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    boxSizing: 'border-box',
  })
  const shellStyle = shellStyleFor(receiptWidthMm)

  if (_previewMode) {
    // Z4: enabling the 80x50 card must not REPLACE the full-receipt preview
    // in Receipt Settings -- the settings preview now stacks BOTH renditions
    // (each labeled with the size its Print button uses), the same way the
    // receipt view has since B5. Non-compact configs preview the single full
    // receipt exactly as before.
    if (compactSalesReceipt) {
      return (
        <div>
          <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">80 × 50 mm</p>
          <div data-receipt-export-root="true" data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyle}>{compactReceiptBlock}</div>
          <p className="mb-1 mt-4 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">{fullReceiptWidthMm} mm</p>
          <div data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyleFor(fullReceiptWidthMm)}>{renderedSections}{qrBlock}</div>
        </div>
      )
    }
    return <div data-receipt-export-root="true" data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyle}>{renderedSections}{qrBlock}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-100 dark:bg-zinc-900">
      {/* ONE compact toolbar row (user, Aug 30: the buttons stacked into
          multiple rows here, "not compact one row"). On phones the
          secondary actions (Open PDF / Image / Back) collapse to icon-only
          buttons -- same treatment as the Branches toolbar -- so
          Print + PDF + Image + language + Back all fit a single row;
          labels return from sm up. */}
      <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 sm:gap-2 sm:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
        {compactSalesReceipt ? (
          // The 80x50 card and the full receipt are two print FORMATS. Rather
          // than two dimension-labeled Print buttons (the old B5 layout),
          // Print is ONE menu offering All / 80×50 / Default (user, Aug 29:
          // "it should mention two options ... all, 80x50 and default").
          // "All" opens the two as SEPARATE print files, never one combined
          // print (printBothSeparately fires both windows together).
          <LazyPortalMenu
            align="auto"
            compact
            triggerWrapperClassName="min-w-0"
            menuClassName="min-w-[11rem]"
            trigger={(
              <button
                type="button"
                className="btn-primary w-full min-w-0 justify-center px-3 py-2 text-sm"
                disabled={pdfBusy !== ''}
                aria-haspopup="true"
              >
                <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
                  <Printer className="h-4 w-4 shrink-0" />
                  <span className="truncate">{pdfBusy === 'print' ? (t?.('preparing_pdf') || 'Preparing PDF...') : (t?.('print') || 'Print')}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" />
                </span>
              </button>
            )}
            items={[
              { label: t?.('all') || 'All', disabled: pdfBusy !== '', onClick: () => { void exportBothSeparately('print') } },
              { label: '80 × 50 mm', disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('print', 'compact') } },
              { label: `${t?.('print_default') || 'Default'} · ${fullReceiptWidthMm} mm`, disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('print', 'full') } },
            ]}
          />
        ) : (
        <button
          type="button"
          className="btn-primary min-w-0 justify-center px-3 py-2 text-sm"
          onClick={() => exportReceiptPdf('print')}
          disabled={pdfBusy !== ''}
        >
          <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
            <Printer className="h-4 w-4 shrink-0" />
            <span className="truncate">{pdfBusy === 'print' ? (t?.('preparing_pdf') || 'Preparing PDF...') : (t?.('print') || 'Print')}</span>
          </span>
        </button>
        )}
        {compactSalesReceipt ? (
          <>
            <LazyPortalMenu
              align="auto"
              compact
              triggerWrapperClassName="min-w-0"
              menuClassName="min-w-[11rem]"
              trigger={(
                <button type="button" className="btn-secondary min-w-0 justify-center px-2.5 py-2 text-sm sm:px-3" disabled={pdfBusy !== ''} aria-haspopup="true" aria-label={t?.('open_pdf') || 'Open PDF'} title={t?.('open_pdf') || 'Open PDF'}>
                  <span className="inline-flex min-w-0 items-center justify-center gap-1.5"><FileText className="h-4 w-4 shrink-0" /><span className="hidden truncate sm:inline">{pdfBusy === 'open' ? (t?.('preparing_pdf') || 'Preparing PDF...') : (t?.('open_pdf') || 'Open PDF')}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" /></span>
                </button>
              )}
              items={[
                { label: `${fullReceiptWidthMm} mm`, disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('open', 'full') } },
                { label: '80 × 50 mm', disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('open', 'compact') } },
                { label: t?.('all') || 'All', disabled: pdfBusy !== '', onClick: () => { void exportBothSeparately('open') } },
              ]}
            />
            <LazyPortalMenu
              align="auto"
              compact
              triggerWrapperClassName="min-w-0"
              menuClassName="min-w-[11rem]"
              trigger={(
                <button type="button" className="btn-secondary min-w-0 justify-center px-2.5 py-2 text-sm sm:px-3" disabled={pdfBusy !== ''} aria-haspopup="true" aria-label={t?.('receipt_image_short') || 'Image'} title={t?.('receipt_image_short') || 'Image'}>
                  <span className="inline-flex min-w-0 items-center justify-center gap-1.5"><ImageDown className="h-4 w-4 shrink-0" /><span className="hidden truncate sm:inline">{pdfBusy === 'image' ? (t?.('saving_image') || 'Saving image...') : (t?.('receipt_image_short') || 'Image')}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" /></span>
                </button>
              )}
              items={[
                { label: `${fullReceiptWidthMm} mm`, disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('image', 'full') } },
                { label: '80 × 50 mm', disabled: pdfBusy !== '', onClick: () => { void exportReceiptPdf('image', 'compact') } },
                { label: t?.('all') || 'All', disabled: pdfBusy !== '', onClick: () => { void exportBothSeparately('image') } },
              ]}
            />
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary min-w-0 justify-center px-2.5 py-2 text-sm sm:px-3"
              onClick={() => exportReceiptPdf('open')}
              disabled={pdfBusy !== ''}
              title={t?.('open_pdf') || 'Open PDF'}
              aria-label={t?.('open_pdf') || 'Open PDF'}
            >
              <span className="inline-flex min-w-0 items-center justify-center gap-1.5"><FileText className="h-4 w-4 shrink-0" /><span className="hidden truncate sm:inline">{pdfBusy === 'open' ? (t?.('preparing_pdf') || 'Preparing PDF...') : (t?.('open_pdf') || 'Open PDF')}</span></span>
            </button>
            <button
              type="button"
              className="btn-secondary min-w-0 justify-center px-2.5 py-2 text-sm sm:px-3"
              onClick={() => exportReceiptPdf('image')}
              disabled={pdfBusy !== ''}
              title={t?.('receipt_image_short') || 'Image'}
              aria-label={t?.('receipt_image_short') || 'Image'}
            >
              <span className="inline-flex min-w-0 items-center justify-center gap-1.5"><ImageDown className="h-4 w-4 shrink-0" /><span className="hidden truncate sm:inline">{pdfBusy === 'image' ? (t?.('saving_image') || 'Saving image...') : (t?.('receipt_image_short') || 'Image')}</span></span>
            </button>
          </>
        )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-zinc-700">
          {([
            ['en', 'EN'],
            ['km', 'KH'],
            ['both', 'EN/KH'],
          ] as Array<[LanguageMode, string]>).map(([code, text]) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 ${lang === code ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-zinc-600'}`}
            >
              {text}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary min-w-0 justify-center px-2.5 py-2 text-sm sm:px-3"
          onClick={onClose}
          title={t?.('back') || 'Back'}
          aria-label={t?.('back') || 'Back'}
        >
          <span className="inline-flex min-w-0 items-center justify-center gap-1.5">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden truncate sm:inline">{t?.('back') || 'Back'}</span>
          </span>
        </button>
        </div>
      </div>

      <div className="flex flex-1 justify-center overflow-auto p-4">
        <div style={{ width: '100%', maxWidth: `calc(${Math.max(receiptWidthMm, compactSalesReceipt ? fullReceiptWidthMm : 0)}mm + 32px)` }}>
          {compactSalesReceipt ? (
            // B5: BOTH renditions preview -- the 80x50 card first (it is the
            // configured primary), the full roll receipt under it, each
            // labeled with the size its Print button uses.
            <>
              <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">80 × 50 mm</p>
              <div className="mx-auto rounded-[18px] border border-gray-200 bg-white p-2 shadow-[0_22px_48px_rgba(15,23,42,0.14)] dark:border-zinc-700 dark:bg-white" style={{ maxWidth: `calc(${receiptWidthMm}mm + 16px)` }}>
                <div ref={compactPrintRef} data-receipt-export-root="true" data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyle}>
                  {compactReceiptBlock}
                </div>
              </div>
              <p className="mb-1 mt-4 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">{fullReceiptWidthMm} mm</p>
              <div className="mx-auto rounded-[18px] border border-gray-200 bg-white p-2 shadow-[0_22px_48px_rgba(15,23,42,0.14)] dark:border-zinc-700 dark:bg-white" style={{ maxWidth: `calc(${fullReceiptWidthMm}mm + 16px)` }}>
                <div ref={printRef} data-receipt-export-root="true" data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyleFor(fullReceiptWidthMm)}>
                  {renderedSections}{qrBlock}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[18px] border border-gray-200 bg-white p-2 shadow-[0_22px_48px_rgba(15,23,42,0.14)] dark:border-zinc-700 dark:bg-white">
            <div ref={printRef} data-receipt-export-root="true" data-receipt-high-contrast={highContrastBold ? 'true' : 'false'} style={shellStyle}>
              {renderedSections}{qrBlock}
            </div>
            </div>
          )}
          <p className="mt-3 inline-flex w-full items-center justify-center gap-2 text-center text-xs text-gray-400">
            <FileText className="h-3.5 w-3.5" />
            {t?.('receipt_pdf_layout_note') || 'PDF export uses this exact receipt layout.'}
          </p>
        </div>
      </div>
    </div>
  )
}

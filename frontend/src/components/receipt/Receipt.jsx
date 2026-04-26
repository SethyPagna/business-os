import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, FileText, Printer } from 'lucide-react'
import { useApp } from '../../AppContext'
import { downloadReceiptPdf, openReceiptPdf } from '../../utils/printReceipt'
import { DEFAULT_TEMPLATE } from '../receipt-settings/constants'
import { getStatusLabel } from '../sales/StatusBadge'

export function parseTpl(str) {
  try {
    return { ...DEFAULT_TEMPLATE, ...(str ? JSON.parse(str) : {}) }
  } catch {
    return { ...DEFAULT_TEMPLATE }
  }
}

function stripEmoji(text) {
  if (typeof text !== 'string') return text
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, '').replace(/\s{2,}/g, ' ').trim()
}

function displayAddress(raw) {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed[0] || ''
  } catch {}
  return raw
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
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
    thankYou: 'Thank you for your business!',
    qty: 'Qty',
  },
  km: {
    receipt: 'បង្កាន់ដៃ',
    receiptNum: 'លេខបង្កាន់ដៃ:',
    date: 'កាលបរិច្ឆេទ:',
    cashier: 'អ្នកគិតលុយ:',
    payment: 'ការទូទាត់:',
    rate: 'អត្រាប្ដូរ:',
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
    thankYou: 'សូមអរគុណសម្រាប់ការគាំទ្រ!',
    qty: 'ចំនួន',
  },
}

function labelFor(mode, key) {
  if (mode === 'both') return `${LABELS.en[key]} / ${LABELS.km[key]}`
  return (mode === 'km' ? LABELS.km : LABELS.en)[key]
}

function Row({ label, value, subValue, bold = false, tone = '' }) {
  return (
    <div className={`my-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 ${tone}`}>
      <span className={`min-w-0 break-words pr-2 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <div className="min-w-[5.5rem] text-right">
        <div className={`${bold ? 'font-semibold' : ''}`}>{value}</div>
        {subValue ? <div className="text-[10px] text-gray-500">{subValue}</div> : null}
      </div>
    </div>
  )
}

export default function Receipt({ sale, settings, onClose, _previewMode }) {
  const { fmtUSD, fmtKHR, khrSymbol, t } = useApp()
  const printRef = useRef(null)
  const tpl = parseTpl(settings?.receipt_template)
  const [lang, setLang] = useState(tpl.receipt_language || 'en')
  const [pdfBusy, setPdfBusy] = useState('')

  useEffect(() => {
    if (_previewMode) setLang(tpl.receipt_language || 'en')
  }, [_previewMode, tpl.receipt_language])

  const em = (text) => (tpl.show_emojis === false ? stripEmoji(text) : text)
  const items = useMemo(() => parseItems(sale.items), [sale.items])
  const rNum = sale.receiptNumber || sale.receipt_number || 'Receipt'
  const createdAt = sale.created_at
  const parsedDate = createdAt ? new Date(String(createdAt).includes('T') ? createdAt : `${createdAt}Z`) : new Date()
  const dateStr = Number.isNaN(parsedDate.getTime()) ? String(createdAt || '') : parsedDate.toLocaleString()
  const exchangeRate = sale.exchange_rate || parseFloat(settings?.exchange_rate || '4100') || 4100
  const subtotalUsd = sale.subtotal_usd || sale.subtotal || 0
  const discountUsd = sale.discount_usd || sale.discount || 0
  const discountKhr = sale.discount_khr || discountUsd * exchangeRate
  const membershipDiscountUsd = sale.membership_discount_usd || 0
  const membershipDiscountKhr = sale.membership_discount_khr || membershipDiscountUsd * exchangeRate
  const membershipPointsRedeemed = sale.membership_points_redeemed || 0
  const taxUsd = sale.tax_usd || sale.tax || 0
  const taxKhr = sale.tax_khr || taxUsd * exchangeRate
  const deliveryFeeUsd = sale.delivery_fee_usd || 0
  const deliveryFeeKhr = sale.delivery_fee_khr || deliveryFeeUsd * exchangeRate
  const totalUsd = sale.total_usd || sale.total || 0
  const totalKhr = sale.total_khr || totalUsd * exchangeRate
  const paidUsd = sale.amount_paid_usd || sale.amount_paid || 0
  const paidKhr = sale.amount_paid_khr || 0
  const changeUsd = sale.change_usd || sale.change_returned || 0
  const changeKhr = sale.change_khr || 0
  const refundUsd = sale.refund_usd || 0
  const refundKhr = sale.refund_khr || 0
  const saleStatus = sale.sale_status || 'completed'
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

  const hasCustomer = sale.customer_name || sale.customer_phone || sale.customer_address || sale.customer_membership_number
  const hasDelivery = !!sale.is_delivery && (sale.delivery_contact_name || sale.delivery_contact_phone || sale.delivery_contact_address)
  const showDeliveryContactSection = tpl.delivery_show_contact !== false
  const showDeliveryDriverName = showDeliveryContactSection && tpl.delivery_show_driver_name !== false
  const showDeliveryDriverPhone = showDeliveryContactSection && tpl.delivery_show_driver_phone !== false

  const sectionMap = {
    header: (
      <div key="header">
        {tpl.custom_header ? <div className={`${headerAlignClass} font-semibold`}>{em(tpl.custom_header)}</div> : null}
        <div className="my-1 text-center text-[11px] text-gray-500">{headerDivider}</div>
        {tpl.show_business_name && settings?.business_name ? <div className={`${headerAlignClass} break-words text-lg font-bold`}>{settings.business_name}</div> : null}
        {tpl.show_address && settings?.business_address ? <div className={`${headerAlignClass} break-words text-[11px]`}>{settings.business_address}</div> : null}
        {tpl.show_phone && settings?.business_phone ? <div className={`${headerAlignClass} break-words text-[11px]`}>{settings.business_phone}</div> : null}
        {tpl.show_email && settings?.business_email ? <div className={`${headerAlignClass} break-all text-[11px]`}>{settings.business_email}</div> : null}
        {tpl.show_tax_id && settings?.tax_id ? <div className={`${headerAlignClass} break-words text-[11px]`}>Tax ID: {settings.tax_id}</div> : null}
        <div className="my-1 text-center text-[11px] text-gray-500">{headerDivider}</div>
      </div>
    ),
    order_info: (
      <div key="order_info">
        {tpl.show_receipt_number ? <Row label={labelFor(lang, 'receiptNum')} value={rNum} bold /> : null}
        {tpl.show_date ? <Row label={labelFor(lang, 'date')} value={dateStr} /> : null}
        {tpl.show_cashier ? <Row label={labelFor(lang, 'cashier')} value={sale.cashier_name || '-'} /> : null}
        {tpl.show_payment_method ? <Row label={labelFor(lang, 'payment')} value={sale.payment_method || 'Cash'} /> : null}
        <Row label={labelFor(lang, 'status')} value={getStatusLabel(saleStatus)} />
        {tpl.show_exchange_rate ? <Row label={labelFor(lang, 'rate')} value={`1 USD = ${Number(exchangeRate).toLocaleString()} ${khrSymbol}`} /> : null}
      </div>
    ),
    customer: hasCustomer ? (
      <div key="customer" className="mt-2 border-t border-dashed border-gray-300 pt-2">
        {tpl.show_customer_name && sale.customer_name ? <Row label={labelFor(lang, 'customer')} value={sale.customer_name} /> : null}
        {tpl.show_customer_phone && sale.customer_phone ? <Row label={labelFor(lang, 'phone')} value={sale.customer_phone} /> : null}
        {tpl.show_customer_address && sale.customer_address ? <Row label={labelFor(lang, 'address')} value={displayAddress(sale.customer_address)} /> : null}
        {sale.customer_membership_number ? <Row label={labelFor(lang, 'membership')} value={sale.customer_membership_number} /> : null}
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
        {items.map((item, index) => {
          const qty = item.quantity || 1
          const unitUsd = item.applied_price_usd ?? item.price_usd ?? item.price ?? 0
          const unitKhr = item.applied_price_khr ?? item.price_khr ?? 0
          const lineUsd = unitUsd * qty
          const lineKhr = unitKhr * qty
          return (
            <div key={`${item.product_id || item.id || index}-${index}`} className="my-1">
              <div className="font-semibold">
                {item.product_name || item.name}
                {tpl.show_item_sku && item.sku ? <span className="ml-1 text-[10px] text-gray-500">[{item.sku}]</span> : null}
              </div>
              <Row
                label={[
                  tpl.show_item_qty ? `${labelFor(lang, 'qty')} ${qty}` : '',
                  tpl.show_item_unit_price ? `@ ${fmtUSD(unitUsd)}` : '',
                ].filter(Boolean).join(' ')}
                value={fmtUSD(lineUsd)}
                subValue={tpl.show_item_khr && lineKhr > 0 ? fmtKHR(lineKhr) : ''}
              />
              {tpl.item_separator && index < items.length - 1 ? <div className="text-center text-[11px] text-gray-400">{divider}</div> : null}
            </div>
          )
        })}
      </div>
    ),
    subtotal: tpl.show_subtotal ? <Row key="subtotal" label={labelFor(lang, 'subtotal')} value={fmtUSD(subtotalUsd)} /> : null,
    discount: tpl.show_discount && discountUsd > 0 ? (
      <Row key="discount" label={labelFor(lang, 'discount')} value={`-${fmtUSD(discountUsd)}`} subValue={discountKhr > 0 ? `-${fmtKHR(discountKhr)}` : ''} tone="text-red-600" />
    ) : null,
    membership_discount: membershipDiscountUsd > 0 ? (
      <Row
        key="membership_discount"
        label={labelFor(lang, 'membershipDiscount')}
        value={`-${fmtUSD(membershipDiscountUsd)}`}
        subValue={membershipDiscountKhr > 0 ? `-${fmtKHR(membershipDiscountKhr)}` : ''}
        tone="text-emerald-600"
      />
    ) : null,
    membership_points: membershipPointsRedeemed > 0 ? (
      <Row key="membership_points" label={labelFor(lang, 'pointsRedeemed')} value={membershipPointsRedeemed.toLocaleString()} />
    ) : null,
    tax: tpl.show_tax && taxUsd > 0 ? (
      <Row key="tax" label={labelFor(lang, 'tax')} value={fmtUSD(taxUsd)} subValue={taxKhr > 0 ? fmtKHR(taxKhr) : ''} />
    ) : null,
    delivery_fee: tpl.show_delivery !== false && tpl.delivery_show_fee !== false && deliveryFeeUsd > 0 ? (
      <Row key="delivery_fee" label={labelFor(lang, 'delivery')} value={fmtUSD(deliveryFeeUsd)} subValue={deliveryFeeKhr > 0 ? fmtKHR(deliveryFeeKhr) : ''} />
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
        <div className="text-center text-[11px] text-gray-500">{footerDivider}</div>
        <div className="mt-1 text-center text-[11px]">
          {tpl.custom_footer || settings?.receipt_footer || labelFor(lang, 'thankYou')}
        </div>
        <div className="text-center text-[11px] text-gray-500">{footerDivider}</div>
      </div>
    ),
  }

  const fieldOrderBase = Array.isArray(tpl.field_order) && tpl.field_order.length
    ? tpl.field_order
    : ['header', 'order_info', 'customer', 'delivery', 'items', 'subtotal', 'discount', 'tax', 'total', 'payment', 'change', 'footer']

  const fieldOrder = []
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

  const receiptTitle = `Receipt ${rNum}`
  const exportReceiptPdf = async (mode) => {
    if (!printRef.current) return
    setPdfBusy(mode)
    try {
      if (mode === 'download') {
        await downloadReceiptPdf(printRef.current, {
          title: receiptTitle,
          fileName: receiptTitle,
        })
      } else {
        await openReceiptPdf(printRef.current, {
          title: receiptTitle,
          fileName: receiptTitle,
        })
      }
    } catch (error) {
      window.alert(error?.message || (t?.('unable_generate_receipt_pdf') || 'Unable to generate receipt PDF'))
    } finally {
      setPdfBusy('')
    }
  }

  const shellStyle = {
    fontFamily: actualFont,
    fontSize: fs,
    background: 'white',
    color: '#111',
    padding: '16px 14px',
    borderRadius: 10,
    lineHeight: 1.45,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  }

  if (_previewMode) {
    return <div style={shellStyle}>{renderedSections}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gray-100 dark:bg-zinc-900">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800">
        <button type="button" className="btn-primary px-4 py-2" onClick={() => exportReceiptPdf('open')} disabled={pdfBusy !== ''}>
          <span className="inline-flex items-center gap-2">
            <Printer className="h-4 w-4" />
            {pdfBusy === 'open' ? (t?.('preparing_pdf') || 'Preparing PDF...') : (t?.('open_pdf') || 'Open PDF')}
          </span>
        </button>
        <button type="button" className="btn-secondary px-4 py-2" onClick={() => exportReceiptPdf('download')} disabled={pdfBusy !== ''}>
          <span className="inline-flex items-center gap-2">
            <Download className="h-4 w-4" />
            {pdfBusy === 'download' ? (t?.('saving_pdf') || 'Saving PDF...') : (t?.('download_pdf') || 'Download PDF')}
          </span>
        </button>
        <button type="button" className="btn-secondary flex-1 py-2" onClick={onClose}>
          <span className="inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t?.('back') || 'Back'}
          </span>
        </button>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-zinc-700">
          {[
            ['en', 'EN'],
            ['km', 'KH'],
            ['both', 'EN/KH'],
          ].map(([code, text]) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${lang === code ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-zinc-600'}`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 justify-center overflow-auto p-4">
        <div style={{ width: '100%', maxWidth: 520 }}>
          <div ref={printRef} style={shellStyle}>
            {renderedSections}
          </div>
          <p className="mt-3 inline-flex w-full items-center justify-center gap-2 text-center text-xs text-gray-400">
            <FileText className="h-3.5 w-3.5" />
            {t?.('receipt_pdf_layout_note') || 'PDF export uses this exact receipt layout.'}
          </p>
        </div>
      </div>
    </div>
  )
}

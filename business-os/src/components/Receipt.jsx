import { useRef, useState, useEffect } from 'react'
import { useApp } from '../AppContext'

const DEFAULT_TPL = {
  font_family: 'monospace', font_size: 12,
  show_business_name: true, show_address: true, show_phone: true,
  show_email: false, show_tax_id: true,
  show_receipt_number: true, show_date: true, show_cashier: true,
  show_payment_method: true, show_exchange_rate: true,
  show_customer_name: true, show_customer_phone: true, show_customer_address: true,
  show_item_sku: false, show_item_qty: true, show_item_unit_price: true, show_item_khr: true,
  show_subtotal: true, show_discount: true, show_tax: true,
  show_total_khr: true, show_amount_paid: true, show_change: true,
  custom_header: '', custom_footer: '',
  header_separator: '═', footer_separator: '─', line_char: '-', item_separator: true,
  receipt_language: 'en',
  width: 80,
}

function parseTpl(str) {
  try { return { ...DEFAULT_TPL, ...(str ? JSON.parse(str) : {}) } }
  catch { return { ...DEFAULT_TPL } }
}

const KM_LABELS = {
  receipt: 'វិក្កយបត្រ',
  receipt_num: 'លេខ:',
  date: 'កាលបរិច្ឆេទ:',
  cashier: 'អ្នកគិតលុយ:',
  payment: 'ការទូទាត់:',
  rate: 'អត្រា:',
  customer: 'អត្រាក្រោះ?:', // keep original Khmer translations as-is if correct
  phone: 'ទូរស័ព្ទ:',
  address: 'អាសយដ្ឋាន:',
  subtotal: 'សរុបរង:',
  discount: 'បញ្ចុះតម្លៃ:',
  tax: 'អាករ:',
  total: 'អស់សរុប',
  paid: 'បានទូទាត់:',
  change: 'អាប់:',
  thank_you: 'អរគុណសម្រាប់ការទិញទំនិញ!',
  qty: 'ចំនួន',
}

const EN_LABELS = {
  receipt: 'RECEIPT',
  receipt_num: 'Receipt #:',
  date: 'Date:',
  cashier: 'Cashier:',
  payment: 'Payment:',
  rate: 'Rate:',
  customer: 'Customer:',
  phone: 'Phone:',
  address: 'Address:',
  subtotal: 'Subtotal:',
  discount: 'Discount:',
  tax: 'Tax:',
  total: 'TOTAL',
  paid: 'Paid:',
  change: 'Change:',
  thank_you: 'Thank you for your business!',
  qty: 'Qty',
}

export default function Receipt({ sale, settings, onClose }) {
  const { fmtUSD, fmtKHR, usdSymbol, khrSymbol } = useApp()
  const printRef = useRef()
  const tpl = parseTpl(settings.receipt_template)

  // Use receipt language from template settings as default
  const [receiptLang, setReceiptLang] = useState(tpl.receipt_language || 'en')

  const L = receiptLang === 'km' ? KM_LABELS : EN_LABELS
  const label = (key) => {
    if (receiptLang === 'both') return `${EN_LABELS[key]} / ${KM_LABELS[key]}`
    return L[key]
  }

  const items  = typeof sale.items === 'string' ? JSON.parse(sale.items || '[]') : (sale.items || [])
  const rNum   = sale.receiptNumber || sale.receipt_number || '—'
  const date   = sale.created_at ? new Date(sale.created_at).toLocaleString() : new Date().toLocaleString()
  const er     = sale.exchange_rate || parseFloat(settings.exchange_rate || '4100')

  const subtotalUsd = sale.subtotal_usd  || sale.subtotal  || 0
  const discountUsd = sale.discount_usd  || sale.discount  || 0
  const discountKhr = sale.discount_khr  || 0
  const taxUsd      = sale.tax_usd       || sale.tax       || 0
  const taxKhr      = sale.tax_khr       || 0
  const totalUsd    = sale.total_usd     || sale.total     || 0
  const totalKhr    = sale.total_khr     || totalUsd * er
  const paidUsd     = sale.amount_paid_usd || sale.amount_paid || 0
  const paidKhr     = sale.amount_paid_khr || 0
  const changeUsd   = sale.change_usd    || sale.change_returned || 0
  const changeKhr   = sale.change_khr    || 0

  const fontFamilyCss = tpl.font_family === 'sans'  ? 'system-ui, -apple-system, sans-serif'
    : tpl.font_family === 'serif' ? 'Georgia, "Times New Roman", serif'
    : '"Courier New", Courier, monospace'

  const actualFontCss = receiptLang === 'km' || receiptLang === 'both'
    ? `"Khmer OS", "Noto Sans Khmer", ${fontFamilyCss}`
    : fontFamilyCss

  const handlePrint = () => {
    const content = printRef.current.innerHTML
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Receipt ${rNum}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer&display=swap');
        * { box-sizing: border-box; }
        @page { margin: 4mm; size: 80mm auto; }
        @media print {
          html, body { margin: 0; padding: 0; }
          .no-print { display: none !important; }
        }
        body { font-family: ${actualFontCss}; font-size: ${tpl.font_size}px; margin: 0; padding: 8px 10px; width: 72mm; color: #000; line-height: 1.45; }
        .r-center { text-align: center; }
        .r-row { display: flex; justify-content: space-between; align-items: flex-start; margin: 1.5px 0; }
        .r-bold { font-weight: 700; }
        .r-small { font-size: ${Math.max(8, tpl.font_size - 2)}px; color: #555; }
        .r-div { border-top: 1px dashed #000; margin: 5px 0; }
        .r-div-solid { border-top: 1px solid #000; margin: 5px 0; }
        .r-total { font-weight: 700; font-size: ${tpl.font_size + 2}px; }
        .r-tag { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
        .r-red { color: #c00; }
        .r-item-block { margin: 3px 0; }
      </style>
      </head><body onload="window.print(); window.close();">${content}</body></html>`)
    win.document.close()
  }

  const fs = tpl.font_size
  const HSep = () => <div style={{textAlign:'center', fontSize: fs - 1, color:'#777', margin:'3px 0', letterSpacing:1}}>{(tpl.header_separator || '═').repeat(32)}</div>
  const FSep = () => <div style={{textAlign:'center', fontSize: fs - 1, color:'#777', margin:'3px 0'}}>{(tpl.footer_separator || '─').repeat(32)}</div>
  const DSep = () => <hr style={{border:'none', borderTop:'1px dashed #ccc', margin:'4px 0'}} />

  const Row = ({ label: lbl, right, rightSub, bold, red, small }) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', margin:'1.5px 0', fontWeight: bold?'700':'normal', color: red?'#c00':'inherit', fontSize: small ? Math.max(9, fs-1) : fs }}>
      <span style={{ flexShrink:0, marginRight:6 }}>{lbl}</span>
      <div style={{ textAlign:'right' }}>
        <div>{right}</div>
        {rightSub && <div style={{fontSize: Math.max(8, fs-2), color:'#777'}}>{rightSub}</div>}
      </div>
    </div>
  )

  const Center = ({ children, small, bold, big }) => (
    <div style={{ textAlign:'center', fontSize: big ? fs+3 : small ? Math.max(9, fs-1) : fs, fontWeight: bold?'700':'normal', margin:'1px 0' }}>
      {children}
    </div>
  )

  const taxRate = parseFloat(settings.tax_rate || '0')
  const hasCustomer = sale.customer_name || sale.customer_phone || sale.customer_address

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 dark:bg-gray-900">
      {/* Top action bar */}
      <div className="flex gap-2 p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <button className="btn-primary flex-1 py-2" onClick={handlePrint}>🖨️ Print Receipt</button>
        <button className="btn-secondary flex-1 py-2" onClick={onClose}>✓ New Sale</button>
        {/* Language toggle */}
        <div className="flex gap-1 ml-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {[['en','EN'], ['km','KH'], ['both','🌐']].map(([code, lbl]) => (
            <button key={code} onClick={() => setReceiptLang(code)}
              title={code === 'en' ? 'English' : code === 'km' ? 'ខ្មែរ' : 'Both'}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${receiptLang === code ? 'bg-blue-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable receipt area */}
      <div className="flex-1 overflow-auto p-4 flex justify-center">
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* Receipt paper */}
          <div
            ref={printRef}
            style={{
              fontFamily: actualFontCss,
              fontSize: fs,
              background: 'white',
              color: '#111',
              padding: '16px 14px',
              borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
              lineHeight: 1.45,
            }}
          >
            {/* Jagged top edge */}
            <div style={{ height:6, background:'repeating-linear-gradient(90deg, white 0px, white 8px, #f3f3f3 8px, #f3f3f3 12px)', margin:'-16px -14px 10px', borderBottom:'1px solid #eee' }} />

            {tpl.custom_header && <Center bold>{tpl.custom_header}</Center>}
            <HSep />

            {tpl.show_business_name && settings.business_name && (
              <Center bold big>{settings.business_name}</Center>
            )}
            {tpl.show_address && settings.business_address && <Center small>{settings.business_address}</Center>}
            {tpl.show_phone && settings.business_phone && <Center small>📞 {settings.business_phone}</Center>}
            {tpl.show_email && settings.business_email && <Center small>✉ {settings.business_email}</Center>}
            {tpl.show_tax_id && settings.tax_id && <Center small>Tax ID: {settings.tax_id}</Center>}

            <HSep />

            <div style={{ margin: '3px 0 5px', fontSize: Math.max(9, fs - 1) }}>
              {tpl.show_receipt_number && <Row label={label('receipt_num')} right={<strong>{rNum}</strong>} />}
              {tpl.show_date          && <Row label={label('date')} right={date} small />}
              {tpl.show_cashier       && <Row label={label('cashier')} right={sale.cashier_name || '—'} small />}
              {tpl.show_payment_method && (
                <Row label={label('payment')} right={
                  <span style={{background:'#e0f2fe',borderRadius:4,padding:'0 5px',fontSize:Math.max(8,fs-2)}}>
                    {sale.payment_method || 'Cash'}
                    {sale.payment_currency && sale.payment_currency !== 'USD' ? ` (${sale.payment_currency})` : ''}
                  </span>
                } />
              )}
              {tpl.show_exchange_rate && <Row label={label('rate')} right={`1 USD = ${Number(er).toLocaleString()}${khrSymbol}`} small />}
            </div>

            {hasCustomer && (
              <>
                <DSep />
                <div style={{ margin: '3px 0 5px', fontSize: Math.max(9, fs - 1) }}>
                  {tpl.show_customer_name !== false && sale.customer_name && <Row label={label('customer')} right={sale.customer_name} small />}
                  {tpl.show_customer_phone !== false && sale.customer_phone && <Row label={label('phone')} right={sale.customer_phone} small />}
                  {tpl.show_customer_address !== false && sale.customer_address && <Row label={label('address')} right={sale.customer_address} small />}
                </div>
              </>
            )}

            <DSep />

            <div style={{ margin:'5px 0' }}>
              {items.map((item, idx) => {
                const unitPriceUsd = item.price_usd || item.price || 0
                const unitPriceKhr = item.price_khr || 0
                const lineUsd = unitPriceUsd * item.quantity
                const lineKhr = unitPriceKhr * item.quantity
                return (
                  <div key={idx} style={{ margin: tpl.item_separator ? '5px 0' : '2px 0' }}>
                    <div style={{ fontWeight:600, fontSize: fs }}>
                      {item.name}
                      {tpl.show_item_sku && item.sku && <span style={{fontSize:Math.max(8,fs-2),color:'#888',marginLeft:4}}>[{item.sku}]</span>}
                    </div>
                    <Row
                      label={
                        <span style={{color:'#555',fontSize:Math.max(9,fs-1)}}>
                          {tpl.show_item_qty && `${item.quantity} × `}
                          {tpl.show_item_unit_price && fmtUSD(unitPriceUsd)}
                        </span>
                      }
                      right={fmtUSD(lineUsd)}
                      rightSub={tpl.show_item_khr && lineKhr > 0 ? fmtKHR(lineKhr) : null}
                      small
                    />
                    {tpl.item_separator && idx < items.length - 1 && <div style={{borderTop:'1px dashed #eee',margin:'4px 0'}} />}
                  </div>
                )
              })}
            </div>

            <DSep />

            <div style={{ margin: '3px 0', fontSize: Math.max(9, fs - 1) }}>
              {tpl.show_subtotal && <Row label={label('subtotal')} right={fmtUSD(subtotalUsd)} small />}
              {tpl.show_discount && discountUsd > 0 && (
                <Row label={label('discount')} right={`-${fmtUSD(discountUsd)}`} rightSub={discountKhr > 0 ? `-${fmtKHR(discountKhr)}` : null} red small />
              )}
              {tpl.show_tax && taxUsd > 0 && (
                <Row label={`${label('tax')} (${taxRate}%):`} right={fmtUSD(taxUsd)} rightSub={taxKhr > 0 ? fmtKHR(taxKhr) : null} small />
              )}
            </div>

            <div style={{ borderTop:'2px solid #000', borderBottom:'2px solid #000', padding:'4px 0', margin:'5px 0' }}>
              <Row
                label={<strong style={{fontSize: fs+2}}>{receiptLang === 'both' ? `${EN_LABELS.total} / ${KM_LABELS.total}` : L.total}</strong>}
                right={<strong style={{fontSize: fs+2}}>{fmtUSD(totalUsd)}</strong>}
                rightSub={tpl.show_total_khr ? fmtKHR(totalKhr) : null}
              />
            </div>

            {tpl.show_amount_paid && (
              <div style={{ margin:'3px 0', fontSize: Math.max(9, fs - 1) }}>
                {paidUsd > 0 && <Row label={`${label('paid')} (${usdSymbol}):`} right={fmtUSD(paidUsd)} small />}
                {paidKhr > 0 && <Row label={`${label('paid')} (${khrSymbol}):`} right={fmtKHR(paidKhr)} small />}
                {tpl.show_change && changeUsd > 0 && (
                  <Row label={label('change')} right={fmtUSD(changeUsd)} rightSub={changeKhr > 0 ? fmtKHR(changeKhr) : null} bold small />
                )}
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <FSep />
              <div style={{ textAlign:'center', fontSize: Math.max(9, fs - 1), color:'#666', margin:'3px 0'  }}>
                {receiptLang === 'both'
                  ? <><div>{tpl.custom_footer || settings.receipt_footer || EN_LABELS.thank_you}</div><div>{KM_LABELS.thank_you}</div></>
                  : receiptLang === 'km'
                    ? (tpl.custom_footer || settings.receipt_footer || KM_LABELS.thank_you)
                    : (tpl.custom_footer || settings.receipt_footer || EN_LABELS.thank_you)
                }
              </div>
              <FSep />
            </div>

            <div style={{ height: 6, background: 'repeating-linear-gradient(90deg, white 0px, white 8px, #f3f3f3 8px, #f3f3f3 12px)', margin: '6px -14px -16px', borderTop: '1px solid #eee' }} />
          </div>
          <p className="text-center text-xs text-gray-400 mt-3">Customize in Receipt Settings · Language default set in template</p>
        </div>
      </div>
    </div>
  )
}
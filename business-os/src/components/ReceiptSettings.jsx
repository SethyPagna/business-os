import { useState, useEffect } from 'react'
import { useApp } from '../AppContext'

// ── Default template ──────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE = {
  font_family: 'monospace',
  font_size: 12,
  width: 80,
  line_char: '-',
  align_header: 'center',

  // Header
  show_logo: false,
  show_business_name: true,
  show_address: true,
  show_phone: true,
  show_email: false,
  show_tax_id: true,

  // Order info
  show_receipt_number: true,
  show_date: true,
  show_cashier: true,
  show_payment_method: true,
  show_exchange_rate: true,

  // Customer info (new)
  show_customer_name: true,
  show_customer_phone: true,
  show_customer_address: true,

  // Items
  show_item_sku: false,
  show_item_qty: true,
  show_item_unit_price: true,
  show_item_khr: true,

  // Totals
  show_subtotal: true,
  show_discount: true,
  show_tax: true,
  show_total_khr: true,
  show_amount_paid: true,
  show_change: true,

  // Custom text
  custom_header: '',
  custom_footer: '',

  // Style
  header_separator: '═',
  footer_separator: '─',
  item_separator: true,

  // Language: 'en' | 'km' | 'both'
  receipt_language: 'en',
}

function parseTemplate(str) {
  try { return { ...DEFAULT_TEMPLATE, ...(typeof str === 'string' ? JSON.parse(str) : str) } }
  catch { return { ...DEFAULT_TEMPLATE } }
}

// ── Bilingual labels — must match Receipt.jsx exactly ─────────────────────────
const KM_LABELS = {
  receipt_num: 'លេខ:',
  date: 'កាលបរិច្ឆេទ:',
  cashier: 'អ្នកគិតលុយ:',
  payment: 'ការទូទាត់:',
  rate: 'អត្រា:',
  customer: 'អតិថិជន:',
  phone: 'ទូរស័ព្ទ:',
  address: 'អាសយដ្ឋាន:',
  subtotal: 'សរុបរង:',
  discount: 'បញ្ចុះតម្លៃ:',
  tax: 'អាករ:',
  total: 'សរុប',
  paid: 'បានទូទាត់:',
  change: 'អាប់:',
  thank_you: 'អរគុណសម្រាប់ការទិញទំនិញ!',
}

const EN_LABELS = {
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
}

// ── Reusable UI components ────────────────────────────────────────────────────
function Toggle({ label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-2 cursor-pointer select-none" onClick={() => onChange(!value)}>
      <div>
        <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
        {desc && <span className="text-xs text-gray-400 ml-2">{desc}</span>}
      </div>
      <div className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-3 ${value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="card p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-white mb-3 pb-2 border-b border-gray-100 dark:border-gray-700">{title}</h3>
      {children}
    </div>
  )
}

// ── Live preview — mirrors Receipt.jsx rendering exactly ──────────────────────
function ReceiptPreview({ tpl, settings, fmtUSD, fmtKHR }) {
  const lang = tpl.receipt_language || 'en'
  const L = lang === 'km' ? KM_LABELS : EN_LABELS

  const lbl = (key) => {
    if (lang === 'both') return `${EN_LABELS[key]} / ${KM_LABELS[key]}`
    return L[key]
  }

  const er     = parseFloat(settings.exchange_rate || '4100')
  const khrSym = settings.currency_khr_symbol || '៛'
  const usdSym = settings.currency_usd_symbol || '$'

  const fontFamilyCss =
    tpl.font_family === 'sans'  ? 'system-ui, -apple-system, sans-serif' :
    tpl.font_family === 'serif' ? 'Georgia, "Times New Roman", serif' :
    '"Courier New", Courier, monospace'

  const actualFontCss = (lang === 'km' || lang === 'both')
    ? `"Noto Sans Khmer", "Khmer OS", ${fontFamilyCss}`
    : fontFamilyCss

  // Sample data
  const sampleItems = [
    { name: 'Coca Cola 330ml',     sku:'SKU001', quantity:2, price_usd:1.25, price_khr:1.25*er },
    { name: 'Lays Original Chips', sku:'SKU002', quantity:1, price_usd:2.00, price_khr:2.00*er },
  ]
  const subtotalUsd = sampleItems.reduce((s,i) => s + i.price_usd*i.quantity, 0)
  const discUsd = 0.50, discKhr = discUsd*er
  const taxUsd  = (subtotalUsd-discUsd)*0.1, taxKhr = taxUsd*er
  const totalUsd = subtotalUsd-discUsd+taxUsd, totalKhr = totalUsd*er
  const paidUsd = 6, changeUsd = paidUsd-totalUsd, changeKhr = changeUsd*er

  const sampleCustomer = { name: 'Dara Chan', phone: '012 345 678', address: '25 Monivong Blvd' }
  const hasCustomer = tpl.show_customer_name || tpl.show_customer_phone || tpl.show_customer_address

  // Renderers
  const HSep = () => (
    <div style={{textAlign:'center', fontSize:tpl.font_size-1, color:'#777', margin:'4px 0', letterSpacing:1}}>
      {(tpl.header_separator||'═').repeat(32)}
    </div>
  )
  const FSep = () => (
    <div style={{textAlign:'center', fontSize:tpl.font_size-1, color:'#777', margin:'4px 0'}}>
      {(tpl.footer_separator||'─').repeat(32)}
    </div>
  )
  const DSep = () => <hr style={{border:'none', borderTop:'1px dashed #bbb', margin:'5px 0'}} />
  const Row = ({ left, right, rightSub, bold, red, small }) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', margin:'1.5px 0', fontWeight:bold?'700':'normal', color:red?'#c00':'inherit', fontSize:small?Math.max(9,tpl.font_size-1):tpl.font_size}}>
      <span style={{flexShrink:0, marginRight:6}}>{left}</span>
      <div style={{textAlign:'right'}}>
        <div>{right}</div>
        {rightSub && <div style={{fontSize:Math.max(8,tpl.font_size-2), color:'#888'}}>{rightSub}</div>}
      </div>
    </div>
  )
  const Center = ({ children, big }) => (
    <div style={{textAlign:'center', fontWeight:big?'700':'normal', fontSize:big?tpl.font_size+3:tpl.font_size, margin:'1px 0'}}>
      {children}
    </div>
  )

  return (
    <div style={{fontFamily:actualFontCss, fontSize:tpl.font_size, background:'white', color:'#111', padding:'20px 16px', borderRadius:12, boxShadow:'0 8px 30px rgba(0,0,0,0.12)', lineHeight:1.5, maxWidth:340, margin:'0 auto'}}>
      {/* Jagged top */}
      <div style={{height:8, background:'repeating-linear-gradient(90deg,white 0,white 8px,#f0f0f0 8px,#f0f0f0 12px)', margin:'-20px -16px 12px', borderBottom:'1px solid #eee'}} />

      {tpl.custom_header && <Center>{tpl.custom_header}</Center>}
      <HSep />

      {/* Business */}
      {tpl.show_business_name && <Center big>{settings.business_name || 'My Business'}</Center>}
      {tpl.show_address  && settings.business_address && <Center><span style={{fontSize:Math.max(9,tpl.font_size-1),color:'#555'}}>{settings.business_address}</span></Center>}
      {tpl.show_phone    && settings.business_phone   && <Center><span style={{fontSize:Math.max(9,tpl.font_size-1),color:'#555'}}>📞 {settings.business_phone}</span></Center>}
      {tpl.show_email    && settings.business_email   && <Center><span style={{fontSize:Math.max(9,tpl.font_size-1),color:'#555'}}>✉ {settings.business_email}</span></Center>}
      {tpl.show_tax_id   && settings.tax_id           && <Center><span style={{fontSize:Math.max(9,tpl.font_size-1),color:'#555'}}>Tax ID: {settings.tax_id}</span></Center>}

      <HSep />

      {/* Order info */}
      <div style={{margin:'4px 0 6px', fontSize:Math.max(9,tpl.font_size-1)}}>
        {tpl.show_receipt_number && <Row left={lbl('receipt_num')} right={<strong>RCP-1001</strong>} />}
        {tpl.show_date           && <Row left={lbl('date')} right={new Date().toLocaleString()} small />}
        {tpl.show_cashier        && <Row left={lbl('cashier')} right="Admin" small />}
        {tpl.show_payment_method && (
          <Row left={lbl('payment')} right={
            <span style={{background:'#e0f2fe', borderRadius:4, padding:'0 5px', fontSize:Math.max(8,tpl.font_size-2)}}>Cash</span>
          } />
        )}
        {tpl.show_exchange_rate && <Row left={lbl('rate')} right={`1 USD = ${er.toLocaleString()}${khrSym}`} small />}
      </div>

      {/* Customer */}
      {hasCustomer && (
        <>
          <DSep />
          <div style={{margin:'4px 0 6px', fontSize:Math.max(9,tpl.font_size-1)}}>
            {tpl.show_customer_name    && <Row left={lbl('customer')} right={sampleCustomer.name} small />}
            {tpl.show_customer_phone   && <Row left={lbl('phone')} right={sampleCustomer.phone} small />}
            {tpl.show_customer_address && <Row left={lbl('address')} right={sampleCustomer.address} small />}
          </div>
        </>
      )}

      <DSep />

      {/* Items */}
      <div style={{margin:'6px 0'}}>
        {sampleItems.map((item, idx) => {
          const lineUsd = item.price_usd * item.quantity
          const lineKhr = item.price_khr * item.quantity
          return (
            <div key={idx} style={{margin:tpl.item_separator?'6px 0':'3px 0'}}>
              <div style={{fontWeight:600}}>
                {item.name}
                {tpl.show_item_sku && <span style={{fontSize:Math.max(8,tpl.font_size-2),color:'#888',marginLeft:4}}>[{item.sku}]</span>}
              </div>
              <Row
                left={<span style={{color:'#555',fontSize:Math.max(9,tpl.font_size-1)}}>
                  {tpl.show_item_qty && `${item.quantity} × `}
                  {tpl.show_item_unit_price && `${usdSym}${item.price_usd.toFixed(2)}`}
                </span>}
                right={fmtUSD(lineUsd)}
                rightSub={tpl.show_item_khr && lineKhr>0 ? fmtKHR(lineKhr) : null}
                small
              />
            </div>
          )
        })}
      </div>

      <DSep />

      {/* Totals */}
      <div style={{margin:'4px 0', fontSize:Math.max(9,tpl.font_size-1)}}>
        {tpl.show_subtotal && <Row left={lbl('subtotal')} right={fmtUSD(subtotalUsd)} small />}
        {tpl.show_discount && <Row left={lbl('discount')} right={`-${fmtUSD(discUsd)}`} rightSub={`-${fmtKHR(discKhr)}`} red small />}
        {tpl.show_tax      && <Row left={`${lbl('tax')} (10%):`} right={fmtUSD(taxUsd)} rightSub={fmtKHR(taxKhr)} small />}
      </div>

      {/* Grand Total */}
      <div style={{borderTop:'2px solid #000', borderBottom:'2px solid #000', padding:'5px 0', margin:'6px 0'}}>
        <Row
          left={<strong style={{fontSize:tpl.font_size+2}}>{lang==='both' ? `${EN_LABELS.total} / ${KM_LABELS.total}` : L.total}</strong>}
          right={<strong style={{fontSize:tpl.font_size+2}}>{fmtUSD(totalUsd)}</strong>}
          rightSub={tpl.show_total_khr ? fmtKHR(totalKhr) : null}
        />
      </div>

      {/* Payment */}
      {tpl.show_amount_paid && (
        <div style={{margin:'4px 0', fontSize:Math.max(9,tpl.font_size-1)}}>
          <Row left={`${lbl('paid')} (${usdSym}):`} right={fmtUSD(paidUsd)} small />
          {tpl.show_change && changeUsd>0 && <Row left={lbl('change')} right={fmtUSD(changeUsd)} rightSub={fmtKHR(changeKhr)} bold small />}
        </div>
      )}

      {/* Footer */}
      <div style={{marginTop:10}}>
        <FSep />
        <div style={{textAlign:'center', fontSize:Math.max(9,tpl.font_size-1), color:'#666', margin:'4px 0'}}>
          {lang === 'both'
            ? <><div>{tpl.custom_footer || settings.receipt_footer || EN_LABELS.thank_you}</div><div>{KM_LABELS.thank_you}</div></>
            : lang === 'km'
              ? (tpl.custom_footer || settings.receipt_footer || KM_LABELS.thank_you)
              : (tpl.custom_footer || settings.receipt_footer || EN_LABELS.thank_you)
          }
        </div>
        <FSep />
      </div>

      {/* Jagged bottom */}
      <div style={{height:8, background:'repeating-linear-gradient(90deg,white 0,white 8px,#f0f0f0 8px,#f0f0f0 12px)', margin:'8px -16px -20px', borderTop:'1px solid #eee'}} />
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ReceiptSettings() {
  const { t, settings, saveSettings, notify, fmtUSD, fmtKHR } = useApp()
  const [tpl, setTpl] = useState(DEFAULT_TEMPLATE)
  const [activeSection, setActiveSection] = useState('header')

  useEffect(() => {
    if (settings.receipt_template) setTpl(parseTemplate(settings.receipt_template))
  }, [settings.receipt_template])

  const setT = (key, val) => setTpl(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    await saveSettings({ receipt_template: JSON.stringify(tpl) })
    notify('Receipt template saved')
  }

  const handleReset = () => {
    if (confirm('Reset receipt template to defaults?')) setTpl({ ...DEFAULT_TEMPLATE })
  }

  const SECTIONS = [
    { id:'header',   label:'🏢 Header' },
    { id:'info',     label:'ℹ️ Order Info' },
    { id:'customer', label:'🧑‍💼 Customer' },
    { id:'items',    label:'📋 Items' },
    { id:'totals',   label:'💰 Totals' },
    { id:'footer',   label:'📝 Footer' },
    { id:'style',    label:'🎨 Style' },
    { id:'language', label:'🌐 Language' },
  ]

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── Left: Editor ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-6 pb-3 flex-shrink-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🧾 {t('receipt_template')}</h1>
          <div className="flex gap-2">
            <button onClick={handleReset} className="btn-secondary text-sm">↺ {t('reset_template')}</button>
            <button onClick={handleSave} className="btn-primary text-sm">💾 {t('save_template')}</button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 px-6 mb-4 flex-wrap">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeSection===s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6">

          {activeSection === 'header' && (
            <>
              <Section title="Business Header">
                <Toggle label="Business Name" value={tpl.show_business_name} onChange={v=>setT('show_business_name',v)} />
                <Toggle label="Address" value={tpl.show_address} onChange={v=>setT('show_address',v)} />
                <Toggle label="Phone" value={tpl.show_phone} onChange={v=>setT('show_phone',v)} />
                <Toggle label="Email" value={tpl.show_email} onChange={v=>setT('show_email',v)} />
                <Toggle label="Tax ID" value={tpl.show_tax_id} onChange={v=>setT('show_tax_id',v)} />
              </Section>
              <Section title="Custom Header Text">
                <label className="text-xs text-gray-500 mb-1 block">Text above business name (optional)</label>
                <input className="input mb-3" value={tpl.custom_header} onChange={e=>setT('custom_header',e.target.value)} placeholder="e.g. ** OFFICIAL RECEIPT **" />
                <label className="text-xs text-gray-500 mb-1 block">Header separator character</label>
                <input className="input w-24" value={tpl.header_separator} onChange={e=>setT('header_separator',e.target.value)} maxLength={2} placeholder="═" />
              </Section>
            </>
          )}

          {activeSection === 'info' && (
            <Section title="Order Information">
              <Toggle label="Receipt Number" value={tpl.show_receipt_number} onChange={v=>setT('show_receipt_number',v)} />
              <Toggle label="Date & Time" value={tpl.show_date} onChange={v=>setT('show_date',v)} />
              <Toggle label="Cashier Name" value={tpl.show_cashier} onChange={v=>setT('show_cashier',v)} />
              <Toggle label="Payment Method" value={tpl.show_payment_method} onChange={v=>setT('show_payment_method',v)} />
              <Toggle label="Exchange Rate" desc="(USD → KHR)" value={tpl.show_exchange_rate} onChange={v=>setT('show_exchange_rate',v)} />
            </Section>
          )}

          {activeSection === 'customer' && (
            <Section title="Customer Information on Receipt">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-3 text-xs text-blue-700 dark:text-blue-400">
                ℹ️ These fields appear on the receipt only when a customer is selected at POS. Toggle each field to show or hide it.
              </div>
              <Toggle label="Customer Name" value={tpl.show_customer_name} onChange={v=>setT('show_customer_name',v)} />
              <Toggle label="Customer Phone" value={tpl.show_customer_phone} onChange={v=>setT('show_customer_phone',v)} />
              <Toggle label="Customer Address" value={tpl.show_customer_address} onChange={v=>setT('show_customer_address',v)} />
            </Section>
          )}

          {activeSection === 'items' && (
            <Section title="Line Items">
              <Toggle label="Show SKU / Code" value={tpl.show_item_sku} onChange={v=>setT('show_item_sku',v)} />
              <Toggle label="Show Quantity × Unit Price" value={tpl.show_item_qty} onChange={v=>setT('show_item_qty',v)} />
              <Toggle label="Show Unit Price" value={tpl.show_item_unit_price} onChange={v=>setT('show_item_unit_price',v)} />
              <Toggle label="Show KHR price per line" value={tpl.show_item_khr} onChange={v=>setT('show_item_khr',v)} />
              <Toggle label="Separator between items" value={tpl.item_separator} onChange={v=>setT('item_separator',v)} />
              <label className="text-xs text-gray-500 mt-3 mb-1 block">Row separator character</label>
              <input className="input w-24" value={tpl.line_char} onChange={e=>setT('line_char',e.target.value)} maxLength={2} placeholder="-" />
            </Section>
          )}

          {activeSection === 'totals' && (
            <Section title="Totals & Payment">
              <Toggle label="Show Subtotal" value={tpl.show_subtotal} onChange={v=>setT('show_subtotal',v)} />
              <Toggle label="Show Discount (if any)" value={tpl.show_discount} onChange={v=>setT('show_discount',v)} />
              <Toggle label="Show Tax (if any)" value={tpl.show_tax} onChange={v=>setT('show_tax',v)} />
              <Toggle label="Show Total in KHR" value={tpl.show_total_khr} onChange={v=>setT('show_total_khr',v)} />
              <Toggle label="Show Amount Paid" value={tpl.show_amount_paid} onChange={v=>setT('show_amount_paid',v)} />
              <Toggle label="Show Change" value={tpl.show_change} onChange={v=>setT('show_change',v)} />
            </Section>
          )}

          {activeSection === 'footer' && (
            <>
              <Section title="Thank You / Footer Message">
                <label className="text-xs text-gray-500 mb-1 block">Footer message (leave blank to use Settings value)</label>
                <textarea className="input resize-none" rows={3}
                  value={tpl.custom_footer}
                  onChange={e=>setT('custom_footer',e.target.value)}
                  placeholder={settings.receipt_footer || 'Thank you for your business!'}
                />
                <p className="text-xs text-gray-400 mt-2">
                  When language is "Both", the English message shows first, then the Khmer thank-you line is added automatically.
                </p>
              </Section>
              <Section title="Footer Separator">
                <input className="input w-24" value={tpl.footer_separator} onChange={e=>setT('footer_separator',e.target.value)} maxLength={2} placeholder="─" />
              </Section>
            </>
          )}

          {activeSection === 'style' && (
            <>
              <Section title="Font">
                <label className="text-sm text-gray-700 dark:text-gray-300 block mb-2">Font Family</label>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[['monospace','Monospace'],['sans','Sans-serif'],['serif','Serif']].map(([val,label]) => (
                    <button key={val} onClick={() => setT('font_family',val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${tpl.font_family===val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="text-sm text-gray-700 dark:text-gray-300 block mb-2">Font Size: {tpl.font_size}px</label>
                <input type="range" min="9" max="16" value={tpl.font_size} onChange={e=>setT('font_size',parseInt(e.target.value))} className="w-full" />
              </Section>
              <Section title="Header Alignment">
                <div className="grid grid-cols-3 gap-2">
                  {[['left','Left'],['center','Center'],['right','Right']].map(([val,label]) => (
                    <button key={val} onClick={() => setT('align_header',val)}
                      className={`py-2 rounded-lg text-xs font-medium border-2 ${tpl.align_header===val ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {activeSection === 'language' && (
            <Section title={t('language')}>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4 text-xs text-blue-700 dark:text-blue-400">
                🌐 Sets the <strong>default</strong> language for printed receipts. The cashier can also switch language per-sale from the receipt preview screen before printing.
              </div>

              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-3">{t('language')}</label>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  ['en',   `🇺🇸 English`, 'Labels in English only'],
                  ['km',   '🇰🇭 ខ្មែរ',    'Labels in Khmer only'],
                  ['both', '🌐 Both',     'Bilingual EN + KH on each label'],
                ].map(([code, lbl, desc]) => (
                  <button key={code} onClick={() => setT('receipt_language', code)}
                    className={`p-3 rounded-xl border-2 text-left transition-colors ${(tpl.receipt_language||'en')===code ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
                    <div className={`text-sm font-medium mb-1 ${(tpl.receipt_language||'en')===code ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>{lbl}</div>
                    <div className="text-xs text-gray-400">{desc}</div>
                  </button>
                ))}
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-xs text-gray-500 space-y-1.5">
                <p className="font-semibold text-gray-600 dark:text-gray-400">Label examples:</p>
                <p><span className="font-medium">English:</span> Receipt #, Date, Cashier, Subtotal, TOTAL, Change</p>
                <p><span className="font-medium">ខ្មែរ:</span> លេខ, កាលបរិច្ឆេទ, អ្នកគិតលុយ, សរុបរង, សរុប, អាប់</p>
                <p><span className="font-medium">Both:</span> Receipt # / លេខ, TOTAL / សរុប …</p>
              </div>
            </Section>
          )}

        </div>
      </div>

      {/* ── Right: Live Preview ── */}
      <div className="w-96 bg-gray-100 dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <h2 className="font-semibold text-gray-800 dark:text-white text-sm">👁 {t('live_preview')}</h2>
          {/* Quick language switcher in preview panel */}
          <div className="flex gap-1">
            {[['en','EN'],['km','KH'],['both','Both']].map(([code, lbl]) => (
              <button key={code} onClick={() => setT('receipt_language', code)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${(tpl.receipt_language||'en')===code ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <ReceiptPreview tpl={tpl} settings={settings} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
        </div>
      </div>

    </div>
  )
}

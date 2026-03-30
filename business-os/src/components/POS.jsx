import { useState, useEffect, useRef } from 'react'
import { useApp } from '../AppContext'
import Receipt from './Receipt'

function multiMatch(text, terms) {
  return terms.every(term => text.toLowerCase().includes(term.toLowerCase()))
}

// ─── Inline Add Customer Modal ────────────────────────────────────────────────
function AddCustomerModal({ onSave, onClose, t, notify }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', company: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim()) return notify(t('name_required'), 'error')
    setSaving(true)
    try {
      await window.api.createCustomer(form)
      notify(t('customer_added'))
      onSave(form)
    } catch (e) {
      notify(t('error'), 'error')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('add_new_customer')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">x</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('name')} *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('customer_name')} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('phone')}</label>
              <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="012 345 678" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('email')}</label>
              <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@..." />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('company')}</label>
            <input className="input" value={form.company} onChange={e => set('company', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('address')}</label>
            <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('notes')}</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          <div className="flex gap-3 pt-1">
            <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
              {saving ? t('loading') : t('save')}
            </button>
            <button className="btn-secondary" onClick={onClose}>{t('cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function POS() {
  const { t, user, notify, settings, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp()
  const [products, setProducts] = useState([])
  const [branches, setBranches] = useState([])
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [paymentMethodCustom, setPaymentMethodCustom] = useState(false)
  const [paidUsd, setPaidUsd] = useState('')
  const [paidKhr, setPaidKhr] = useState('')
  const [discountUsd, setDiscountUsd] = useState('')
  const [discountKhr, setDiscountKhr] = useState('')
  const [checkoutDone, setCheckoutDone] = useState(null)
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState([])
  const [catFilter, setCatFilter] = useState('all')
  const [catColors, setCatColors] = useState({})
  const searchRef = useRef()
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerSuggestions, setCustomerSuggestions] = useState([])
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '' })
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [defaultBranchId, setDefaultBranchId] = useState(null)
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('all') // 'all' or branchId

  const taxRate = parseFloat(settings.tax_rate || '0') / 100

  const loadCustomers = () => window.api.getCustomers().then(setCustomers)

  useEffect(() => {
    Promise.all([
      window.api.getProducts(),
      window.api.getCategories(),
      window.api.getCustomers(),
      window.api.getBranches(),
    ]).then(([prods, cats, custs, brs]) => {
      setProducts(prods.filter(p => p.is_active))
      setCategories(cats)
      setCatColors(Object.fromEntries(cats.map(c => [c.name, c.color])))
      setCustomers(custs)
      const activeBranches = brs.filter(b => b.is_active)
      setBranches(activeBranches)
      const defBranch = activeBranches.find(b => b.is_default) || activeBranches[0]
      if (defBranch) setDefaultBranchId(defBranch.id)
    })
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!customerSearch.trim()) { setCustomerSuggestions([]); return }
    const q = customerSearch.toLowerCase()
    setCustomerSuggestions(customers.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone||'').includes(q)
    ).slice(0, 6))
  }, [customerSearch, customers])

  const selectCustomer = (c) => {
    setCustomer({ name: c.name, phone: c.phone || '', address: c.address || '' })
    setCustomerSearch(c.name)
    setCustomerSuggestions([])
    setShowCustomerDrop(false)
  }

  const clearCustomer = () => {
    setCustomer({ name: '', phone: '', address: '' })
    setCustomerSearch('')
  }

  const handleCustomerAdded = async (form) => {
    setCustomer({ name: form.name, phone: form.phone || '', address: form.address || '' })
    setCustomerSearch(form.name)
    setShowAddCustomer(false)
    await loadCustomers()
  }

  const searchTerms = search.trim().split(/\s+/).filter(Boolean)
  const filtered = products.filter(p => {
    const haystack = `${p.name} ${p.sku||''} ${p.barcode||''} ${p.category||''}`
    const matchSearch = searchTerms.length === 0 || multiMatch(haystack, searchTerms)
    const matchCat = catFilter === 'all' || p.category === catFilter
    if (!matchSearch || !matchCat) return false
    // If filtering by branch, only show products that have stock in that branch
    if (selectedBranchFilter !== 'all') {
      const branchEntry = (p.branch_stock || []).find(b => b.branch_id === parseInt(selectedBranchFilter))
      return branchEntry && branchEntry.quantity > 0
    }
    return true
  })

  // Get display stock for a product: branch-specific if branch filter active, else global
  const getDisplayStock = (p) => {
    if (selectedBranchFilter !== 'all') {
      const branchEntry = (p.branch_stock || []).find(b => b.branch_id === parseInt(selectedBranchFilter))
      return branchEntry ? branchEntry.quantity : 0
    }
    return p.stock_quantity
  }

  const addToCart = (product) => {
    const displayStock = getDisplayStock(product)
    setCart(cart => {
      const existing = cart.find(i => i.id === product.id)
      if (existing) {
        if (existing.quantity >= displayStock) { notify(t('not_enough_stock'), 'error'); return cart }
        return cart.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      const assignedBranch = selectedBranchFilter !== 'all' ? parseInt(selectedBranchFilter) : (defaultBranchId || null)
      return [...cart, {
        ...product,
        quantity: 1,
        applied_price_usd: product.selling_price_usd || 0,
        applied_price_khr: product.selling_price_khr || 0,
        branch_id: assignedBranch,
      }]
    })
    setSearch('')
    searchRef.current?.focus()
  }

  const updateQty = (id, qty) => {
    if (qty <= 0) { setCart(c => c.filter(i => i.id !== id)); return }
    const prod = products.find(p => p.id === id)
    const maxStock = getDisplayStock(prod)
    if (qty > maxStock) { notify(t('not_enough_stock'), 'error'); return }
    setCart(c => c.map(i => i.id === id ? { ...i, quantity: qty } : i))
  }

  const updatePrice = (id, field, val) => {
    const num = parseFloat(val) || 0
    setCart(c => c.map(i => {
      if (i.id !== id) return i
      if (field === 'usd') return { ...i, applied_price_usd: num, applied_price_khr: num * exchangeRate }
      if (field === 'khr') return { ...i, applied_price_khr: num, applied_price_usd: num / exchangeRate }
      return i
    }))
  }

  const updateItemBranch = (id, branchId) => {
    setCart(c => c.map(i => i.id === id ? { ...i, branch_id: branchId ? parseInt(branchId) : null } : i))
  }

  const subtotalUsd = cart.reduce((s, i) => s + i.applied_price_usd * i.quantity, 0)
  const subtotalKhr = cart.reduce((s, i) => s + i.applied_price_khr * i.quantity, 0)

  const discUsd = parseFloat(discountUsd) || 0
  const discKhr = parseFloat(discountKhr) || discUsd * exchangeRate

  const afterDiscUsd = subtotalUsd - discUsd
  const afterDiscKhr = subtotalKhr - discKhr

  const taxUsd = afterDiscUsd * taxRate
  const taxKhr = afterDiscKhr * taxRate

  const totalUsd = afterDiscUsd + taxUsd
  const totalKhr = afterDiscKhr + taxKhr

  const paidUsdNum = parseFloat(paidUsd) || 0
  const paidKhrNum = parseFloat(paidKhr) || 0
  const totalPaidInUsd = paidUsdNum + (paidKhrNum / exchangeRate)
  const changeUsd = totalPaidInUsd - totalUsd
  const changeKhr = changeUsd * exchangeRate

  const handleDiscountUsd = (v) => {
    setDiscountUsd(v)
    const n = parseFloat(v) || 0
    setDiscountKhr(String(n * exchangeRate))
  }
  const handleDiscountKhr = (v) => {
    setDiscountKhr(v)
    const n = parseFloat(v) || 0
    setDiscountUsd(String(n / exchangeRate))
  }

  const PAYMENT_PRESETS = ['Cash', 'Card', 'ABA Bank', 'Wing', 'KHQR', 'Pi Pay', 'Transfer']

  const handleCheckout = async () => {
    if (cart.length === 0) return notify(t('cart_empty'), 'error')
    if (totalPaidInUsd < totalUsd - 0.005) return notify(t('insufficient_amount'), 'error')
    setLoading(true)

    // Compute sale-level branch_id: use single branch if all items share same branch
    const itemBranchIds = cart.map(i => i.branch_id).filter(Boolean)
    const uniqueBranchIds = [...new Set(itemBranchIds)]
    const saleBranchId = uniqueBranchIds.length === 1 ? uniqueBranchIds[0] : null

    const saleData = {
      cashier_id: user.id, cashier_name: user.name,
      customer_name: customer.name || null,
      customer_phone: customer.phone || null,
      customer_address: customer.address || null,
      branch_id: saleBranchId,
      items: cart.map(i => ({
        id: i.id, name: i.name, quantity: i.quantity,
        price_usd: i.applied_price_usd, price_khr: i.applied_price_khr,
        total: i.applied_price_usd * i.quantity,
        branch_id: i.branch_id || null,
      })),
      subtotal_usd: subtotalUsd, subtotal_khr: subtotalKhr,
      discount_usd: discUsd, discount_khr: discKhr,
      tax_usd: taxUsd, tax_khr: taxKhr,
      total_usd: totalUsd, total_khr: totalKhr,
      payment_method: paymentMethod,
      payment_currency: (paidUsdNum > 0 && paidKhrNum > 0) ? 'MIXED' : paidKhrNum > 0 ? 'KHR' : 'USD',
      amount_paid_usd: paidUsdNum, amount_paid_khr: paidKhrNum,
      change_usd: Math.max(0, changeUsd), change_khr: Math.max(0, changeKhr),
      exchange_rate: exchangeRate
    }

    const result = await window.api.createSale(saleData)
    if (result.success) {
      setCheckoutDone({ ...saleData, id: result.id, receiptNumber: result.receiptNumber, created_at: new Date().toISOString() })
      window.api.getProducts().then(d => setProducts(d.filter(p => p.is_active)))
    } else {
      notify(t('error'), 'error')
    }
    setLoading(false)
  }

  const resetPOS = () => {
    setCart([]); setDiscountUsd(''); setDiscountKhr(''); setPaidUsd(''); setPaidKhr('')
    setPaymentMethod('Cash'); setPaymentMethodCustom(false); setCheckoutDone(null)
    clearCustomer()
  }

  if (checkoutDone) return <Receipt sale={checkoutDone} settings={settings} onClose={resetPOS} />

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left: Products */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-3 space-y-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <input ref={searchRef} className="input" placeholder={`${t('search')} (type multiple words)...`} value={search} onChange={e => setSearch(e.target.value)} />
          {searchTerms.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {searchTerms.map((term, i) => <span key={i} className="badge-blue text-xs">{term}</span>)}
            </div>
          )}
          <div className="flex gap-1 overflow-x-auto pb-1">
            <button onClick={() => setCatFilter('all')} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap font-medium ${catFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{t('all')}</button>
            {categories.map(c => (
              <button key={c.id} onClick={() => setCatFilter(catFilter===c.name ? 'all' : c.name)} className="px-3 py-1 rounded-full text-xs whitespace-nowrap font-medium text-white" style={{ background: c.color, opacity: catFilter!=='all' && catFilter!==c.name ? 0.4 : 1 }}>{c.name}</button>
            ))}
          </div>
          {branches.length > 1 && (
            <div className="flex gap-1 overflow-x-auto pb-1 pt-1 border-t border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-400 self-center pr-1">🏪</span>
              <button onClick={() => setSelectedBranchFilter('all')} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap font-medium ${selectedBranchFilter==='all' ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{t('all')}</button>
              {branches.map(b => (
                <button key={b.id} onClick={() => setSelectedBranchFilter(selectedBranchFilter===b.id ? 'all' : b.id)} className={`px-3 py-1 rounded-full text-xs whitespace-nowrap font-medium ${selectedBranchFilter===b.id ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{b.name}{b.is_default ? ' ★' : ''}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3">
          <div className="pos-product-grid">
            {filtered.map(p => {
              const displayStock = getDisplayStock(p)
              const stockOk = displayStock > (p.out_of_stock_threshold || 0)
              return (
                <button key={p.id} onClick={() => stockOk && addToCart(p)} disabled={!stockOk}
                  className={`card p-3 text-left transition-all active:scale-95 ${stockOk ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                  <div className="w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-2 overflow-hidden">
                    {p.image_path ? <img src={`file://${p.image_path}`} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-3xl">📦</span>}
                  </div>
                  <p className="text-xs font-medium text-gray-900 dark:text-white leading-tight mb-1 line-clamp-2">{p.name}</p>
                  <p className="text-sm font-bold text-blue-600">{fmtUSD(p.selling_price_usd)}</p>
                  {p.selling_price_khr > 0 && <p className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</p>}
                  <p className={`text-xs mt-0.5 ${displayStock <= (p.low_stock_threshold||10) && displayStock > 0 ? 'text-yellow-500 font-medium' : 'text-gray-400'}`}>
                    {displayStock} {p.unit}
                    {selectedBranchFilter !== 'all' && p.stock_quantity !== displayStock && <span className="text-gray-300 ml-1">(total: {p.stock_quantity})</span>}
                  </p>
                  {!stockOk && <span className="text-xs text-red-500 font-medium">{t('out_of_stock')}</span>}
                </button>
              )
            })}
            {filtered.length === 0 && <div className="col-span-full text-center py-12 text-gray-400">{t('no_data')}</div>}
          </div>
        </div>
      </div>

      {/* Right: Cart + Payment */}
      <div className="bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col" style={{width:360}}>
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 dark:text-white">🛒 {t('cart')} ({cart.length})</h2>
          {cart.length > 0 && <button onClick={() => setCart([])} className="text-xs text-red-500 hover:underline">{t('clear_cart')}</button>}
        </div>

        {/* Customer selector with inline add */}
        <div className="px-3 pt-2 pb-1 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-500">🧑 {t('customer_optional')}</p>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium"
              title={t('add_new_customer')}
            >
              + {t('new_customer')}
            </button>
          </div>
          <div className="relative">
            <input
              className="input text-xs py-1.5 pr-8"
              placeholder={t('search_customer')}
              value={customerSearch}
              onChange={e => { setCustomerSearch(e.target.value); setCustomer(c => ({...c, name: e.target.value})); setShowCustomerDrop(true) }}
              onFocus={() => setShowCustomerDrop(true)}
            />
            {customerSearch && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-base" onClick={clearCustomer}>x</button>
            )}
            {showCustomerDrop && customerSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-40 overflow-auto mt-0.5">
                {customerSuggestions.map(c => (
                  <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-xs" onClick={() => selectCustomer(c)}>
                    <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                    {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {customer.name && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              <input className="input text-xs py-1" placeholder={t('phone')} value={customer.phone} onChange={e => setCustomer(c => ({...c, phone: e.target.value}))} />
              <input className="input text-xs py-1" placeholder={t('address')} value={customer.address} onChange={e => setCustomer(c => ({...c, address: e.target.value}))} />
            </div>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">{t('cart_empty')}<br/><span className="text-xs">Click a product to add</span></div>
          ) : cart.map(item => (
            <div key={item.id} className="p-3">
              <div className="flex items-start justify-between mb-1.5">
                <p className="text-sm font-medium text-gray-900 dark:text-white flex-1 mr-2 leading-tight">{item.name}</p>
                <button onClick={() => setCart(c => c.filter(i => i.id !== item.id))} className="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0">x</button>
              </div>

              {/* Per-item branch selector — only shown when multiple branches exist */}
              {branches.length > 1 && (
                <div className="mb-2">
                  <label className="text-xs text-gray-400 block mb-0.5">🏪 {t('source_branch')}</label>
                  <select
                    className="input text-xs py-1"
                    value={item.branch_id || ''}
                    onChange={e => updateItemBranch(item.id, e.target.value)}
                  >
                    <option value="">-- {t('select_branch')} --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.is_default ? ` (${t('default_branch')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex items-center border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                  <button className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => updateQty(item.id, item.quantity-1)}>-</button>
                  <input className="w-10 text-center text-xs border-x border-gray-200 dark:border-gray-600 bg-transparent py-1 text-gray-900 dark:text-white" type="number" value={item.quantity} onChange={e => updateQty(item.id, parseInt(e.target.value)||1)} min="1" />
                  <button className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => updateQty(item.id, item.quantity+1)}>+</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-xs text-gray-400">{usdSymbol} {t('price')}</label>
                  <input className="input text-xs py-1 px-2" type="number" step="any" value={item.applied_price_usd} onChange={e => updatePrice(item.id,'usd',e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">{khrSymbol} {t('price')}</label>
                  <input className="input text-xs py-1 px-2" type="number" step="any" value={Number(item.applied_price_khr).toFixed(0)} onChange={e => updatePrice(item.id,'khr',e.target.value)} />
                </div>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-gray-400">Line:</span>
                <div className="text-right">
                  <span className="text-xs font-semibold text-gray-900 dark:text-white">{fmtUSD(item.applied_price_usd * item.quantity)}</span>
                  {item.applied_price_khr > 0 && <div className="text-xs text-gray-400">{fmtKHR(item.applied_price_khr * item.quantity)}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Totals + Payment */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 space-y-2.5">
          <div>
            <label className="text-xs text-gray-500 font-medium">{t('discount')}</label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{usdSymbol}</span><input className="input text-xs py-1 pl-5" type="number" step="any" value={discountUsd} onChange={e => handleDiscountUsd(e.target.value)} placeholder="0.00" /></div>
              <div className="relative"><input className="input text-xs py-1 pr-5" type="number" step="any" value={discountKhr ? Number(discountKhr).toFixed(0) : ''} onChange={e => handleDiscountKhr(e.target.value)} placeholder="0" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{khrSymbol}</span></div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-2.5 space-y-1 text-xs">
            <div className="flex justify-between text-gray-500"><span>{t('subtotal')}</span><span>{fmtUSD(subtotalUsd)}</span></div>
            {discUsd > 0 && <div className="flex justify-between text-red-500"><span>- {t('discount')}</span><span>-{fmtUSD(discUsd)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between text-gray-500"><span>{t('tax')} ({settings.tax_rate}%)</span><span>{fmtUSD(taxUsd)}</span></div>}
            <div className="flex justify-between font-bold text-gray-900 dark:text-white text-sm border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
              <span>{t('total')}</span>
              <div className="text-right">
                <div>{fmtUSD(totalUsd)}</div>
                <div className="text-xs font-normal text-gray-400">{fmtKHR(totalKhr)}</div>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium">{t('payment_method')}</label>
            <div className="flex flex-wrap gap-1 mt-1 mb-1">
              {PAYMENT_PRESETS.map(m => (
                <button key={m} onClick={() => { setPaymentMethod(m); setPaymentMethodCustom(false) }} className={`px-2 py-1 rounded-lg text-xs font-medium ${paymentMethod===m && !paymentMethodCustom ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{m}</button>
              ))}
              <button onClick={() => setPaymentMethodCustom(true)} className={`px-2 py-1 rounded-lg text-xs font-medium ${paymentMethodCustom ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>Other</button>
            </div>
            {paymentMethodCustom && (
              <input className="input text-xs py-1.5" placeholder="Type payment method..." value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} autoFocus />
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium">{t('amount_paid')} (USD + KHR)</label>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{usdSymbol}</span><input className="input text-xs py-1.5 pl-5" type="number" step="any" value={paidUsd} onChange={e => setPaidUsd(e.target.value)} placeholder="0.00" /></div>
              <div className="relative"><input className="input text-xs py-1.5 pr-5" type="number" step="any" value={paidKhr} onChange={e => setPaidKhr(e.target.value)} placeholder="0" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{khrSymbol}</span></div>
            </div>
            <div className="flex gap-1 mt-1">
              <button className="text-xs text-blue-500 hover:underline" onClick={() => { setPaidUsd(totalUsd.toFixed(2)); setPaidKhr('') }}>Exact USD</button>
              <span className="text-gray-300">|</span>
              <button className="text-xs text-blue-500 hover:underline" onClick={() => { setPaidKhr(Math.ceil(totalKhr).toString()); setPaidUsd('') }}>Exact KHR</button>
            </div>
            {(paidUsdNum > 0 || paidKhrNum > 0) && (
              <div className={`mt-1 p-2 rounded-lg text-xs ${changeUsd >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{t('change')}:</span>
                  <div className="text-right font-bold">
                    <div className={changeUsd >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtUSD(Math.abs(changeUsd))}{changeUsd < 0 ? ' short' : ''}</div>
                    {Math.abs(changeKhr) > 1 && <div className="text-gray-400 font-normal">{fmtKHR(Math.abs(changeKhr))}{changeKhr < 0 ? ' short' : ''}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button className="btn-success w-full py-2.5 text-sm font-bold" onClick={handleCheckout} disabled={loading || cart.length === 0}>
            {loading ? t('loading') : `✓ ${t('complete_sale')}`}
          </button>
        </div>
      </div>

      {/* Inline Add Customer Modal */}
      {showAddCustomer && (
        <AddCustomerModal
          onSave={handleCustomerAdded}
          onClose={() => setShowAddCustomer(false)}
          t={t}
          notify={notify}
        />
      )}
    </div>
  )
}

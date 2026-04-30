// ?�?� POS ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
/**
 * Point-of-Sale screen.
 * Sub-components (ProductImage, CartItem, QuickAddModal) are imported from
 * sibling files. The POS doc-comment from the original is preserved below.
 *
 * Key features:
 *   ??Multiple concurrent orders (tabs) ??cashiers can hold up to 6 open orders
 *   ??Fully-scrollable cart panel
 *   ??Collapsible customer / delivery sections
 *   ??Inline "add new" modals for customers and delivery contacts
 *   ??Receipt shown as an overlay
 *
 * Layout (desktop ??md):   [Products] | [Cart + Payment]  side-by-side, full height.
 * Layout (mobile  < md):   Tab bar toggles between Products and Cart views.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ImageOff, Info, X } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import Receipt from '../receipt/Receipt'
import {
  PAYMENT_METHODS,
  DELIVERY_FEE_PAYER,
  CURRENCY,
  LAYOUT,
  EMPTY_CUSTOMER,
  createEmptyOrder,
} from '../../constants'
import ProductImage from './ProductImage'
import CartItem     from './CartItem'
import QuickAddModal from './QuickAddModal'
import FilterPanel from './FilterPanel'
import ImageGalleryLightbox from '../shared/ImageGalleryLightbox'
import { useIsPageActive } from '../shared/pageActivity'
import {
  buildProductsById,
  buildVariantChildrenByParentId,
  buildVisibleProductCards,
  getVariantChoices as getVariantChoicesForProduct,
  resolveCartPriceValues,
  getCartLineId,
  findMatchingCartLineIndex,
} from './posCore.mjs'
import { getStatusLabel } from '../sales/StatusBadge'
import { getClientDeviceInfo } from '../../utils/deviceInfo'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'
import { normalizePriceValue } from '../../utils/pricing.js'

// ?�?� Customer contact-option helpers (mirrors CustomersTab) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
import { parseContactOptions } from '../contacts/CustomersTab'


function allTermsMatch(text, terms) {
  const lower = text.toLowerCase()
  return terms.every(t => lower.includes(t.toLowerCase()))
}

export default function POS() {
  const { t, user, notify, settings, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('pos')
  const posCopy = useCallback((en, km) => ((settings.language || 'en') === 'km' ? km : en), [settings.language])

  // ?�?� Remote data (shared across all orders) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const [products,         setProducts]         = useState([])
  const [categories,       setCategories]       = useState([])
  const [branches,         setBranches]         = useState([])
  const [customers,        setCustomers]        = useState([])
  const [deliveryContacts, setDeliveryContacts] = useState([])
  const [defaultBranchId,  setDefaultBranchId]  = useState(null)

  // ?�?� Product filter state ??persisted in sessionStorage so navigation doesn't reset them ?�?�
  const [search,          setSearch]          = useState('')
  const [searchMode,      setSearchMode]      = useState('AND') // 'AND' | 'OR'
  const [categoryFilter,  setCategoryFilter]  = useState(() => sessionStorage.getItem('pos_cat')      || 'all')
  const [brandFilter,     setBrandFilter]     = useState(() => sessionStorage.getItem('pos_brand')    || 'all')
  const [branchFilter,    setBranchFilter]    = useState(() => sessionStorage.getItem('pos_branch')   || 'all')
  const [stockFilter,     setStockFilter]     = useState(() => sessionStorage.getItem('pos_stock')    || 'all')
  const [supplierFilter,  setSupplierFilter]  = useState(() => sessionStorage.getItem('pos_supplier') || 'all')
  const [filterOpen,      setFilterOpen]      = useState(false)
  const [quickFilters, setQuickFilters] = useState(() => {
    const defaults = { category: true, brand: true, branch: true, stock: true, supplier: false }
    try {
      const parsed = JSON.parse(sessionStorage.getItem('pos_quick_filters') || '{}')
      return { ...defaults, ...(parsed || {}) }
    } catch {
      return defaults
    }
  })

  // Persist filter changes
  const setPersistedCat      = v => { sessionStorage.setItem('pos_cat',      v); setCategoryFilter(v) }
  const setPersistedBrand    = v => { sessionStorage.setItem('pos_brand',    v); setBrandFilter(v) }
  const setPersistedBranch   = v => { sessionStorage.setItem('pos_branch',   v); setBranchFilter(v) }
  const setPersistedStock    = v => { sessionStorage.setItem('pos_stock',    v); setStockFilter(v) }
  const setPersistedSupplier = v => { sessionStorage.setItem('pos_supplier', v); setSupplierFilter(v) }
  const setQuickFilter = (key, enabled) => {
    setQuickFilters((prev) => {
      const next = { ...prev, [key]: !!enabled }
      try { sessionStorage.setItem('pos_quick_filters', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }

  // ?�?� Multi-order state ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  // Restore orders from sessionStorage so navigating away and back preserves
  // all open orders, carts, customer info, and delivery details.
  const [orders, setOrders] = useState(() => {
    try {
      const saved = sessionStorage.getItem('bos_pos_orders')
      if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed) && parsed.length) return parsed }
    } catch {}
    return [createEmptyOrder(1)]
  })
  const [activeId, setActiveId] = useState(() => {
    try {
      const saved = sessionStorage.getItem('bos_pos_active')
      if (saved) return saved
    } catch {}
    return null
  })
  const [orderCounter, setOrderCounter] = useState(() => {
    try { return parseInt(sessionStorage.getItem('bos_pos_counter') || '2', 10) } catch { return 2 }
  })

  // The currently-visible order. Derived ??not stored separately.
  const resolvedActiveId = activeId && orders.find(o => o.id === activeId) ? activeId : orders[0]?.id
  const active = orders.find(o => o.id === resolvedActiveId) || orders[0]

  // ?�?� Sync payment method default when settings load ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  useEffect(() => {
    if (!settings.pos_payment_methods) return
    try {
      const methods = JSON.parse(settings.pos_payment_methods)
      if (!methods.length) return
      const firstMethod = methods[0]
      // Update any orders still on the hardcoded 'Cash' default
      setOrders(prev => prev.map(o =>
        o.paymentMethod === 'Cash' && !o.customPayment && !o.cart.length
          ? { ...o, paymentMethod: firstMethod }
          : o
      ))
    } catch {}
  }, [settings.pos_payment_methods]) // eslint-disable-line

  // Persist whenever orders or activeId change
  useEffect(() => {
    try { sessionStorage.setItem('bos_pos_orders', JSON.stringify(orders)) } catch {}
  }, [orders])
  useEffect(() => {
    try { if (resolvedActiveId) sessionStorage.setItem('bos_pos_active', resolvedActiveId) } catch {}
  }, [resolvedActiveId])
  useEffect(() => {
    try { sessionStorage.setItem('bos_pos_counter', String(orderCounter)) } catch {}
  }, [orderCounter])

  /** Apply a partial update to the active order. Mirrors React's setState signature. */
  const patchActive = useCallback((patch) => {
    setOrders(prev => prev.map(o => o.id === resolvedActiveId ? { ...o, ...patch } : o))
  }, [resolvedActiveId])

  const addNewOrder = () => {
    if (orders.length >= LAYOUT.MAX_CONCURRENT_ORDERS) {
      notify(`Maximum ${LAYOUT.MAX_CONCURRENT_ORDERS} open orders at once`, 'info')
      return
    }
    const nextNum = orders.length + 1
    const newOrder = createEmptyOrder(nextNum)
    setOrders(prev => [...prev, newOrder])
    setActiveId(newOrder.id)
    setOrderCounter(nextNum + 1)
  }

  const closeOrder = (orderId) => {
    if (orders.length === 1) {
      const reset = createEmptyOrder(1)
      setOrders([reset])
      setActiveId(reset.id)
      setOrderCounter(2)
      return
    }
    const idx = orders.findIndex(o => o.id === orderId)
    const remaining = orders.filter(o => o.id !== orderId)
    // Renumber labels sequentially so tabs always show Order 1, 2, 3...
    const renumbered = remaining.map((o, i) => ({ ...o, label: `Order ${i + 1}` }))
    setOrders(renumbered)
    setOrderCounter(renumbered.length + 1)
    if (resolvedActiveId === orderId) setActiveId(renumbered[Math.max(0, idx - 1)].id)
  }

  // ?�?� Collapsible section visibility ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const [showCustomer,  setShowCustomer]  = useState(false)
  const [showDelivery,  setShowDelivery]  = useState(false)

  // Auto-open the relevant section when the active order already has data
  useEffect(() => {
    if (active?.customer?.name)  setShowCustomer(true)
    if (active?.isDelivery)      setShowDelivery(true)
  }, [activeId]) // eslint-disable-line ??intentionally only on tab switch

  // ?�?� Autocomplete suggestions (UI-level, not per-order) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const [customerSuggestions,  setCustomerSuggestions]  = useState([])
  const [deliverySuggestions,  setDeliverySuggestions]  = useState([])
  const [showCustomerDrop,     setShowCustomerDrop]     = useState(false)
  const [showDeliveryDrop,     setShowDeliveryDrop]     = useState(false)

  // ?�?� Inline quick-add modals ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const [showAddCustomer,  setShowAddCustomer]  = useState(false)
  const [newCustomerForm,  setNewCustomerForm]  = useState({ name: '', phone: '', address: '' })
  const [savingCustomer,   setSavingCustomer]   = useState(false)

  const [showAddDelivery,  setShowAddDelivery]  = useState(false)
  const [newDeliveryForm,  setNewDeliveryForm]  = useState({ name: '', phone: '', area: '' })

  // ?�?� Customer option picker (shown after selecting a customer with multiple options) ?�?�
  const [customerOptionsList, setCustomerOptionsList] = useState([])
  const [showOptionPicker,    setShowOptionPicker]    = useState(false)
  const [savingDelivery,   setSavingDelivery]   = useState(false)

  // ?�?� Other UI state ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const [mobileView,       setMobileView]       = useState('products') // 'products' | 'cart'
  const [detailProduct,    setDetailProduct]    = useState(null)
  const [loading,          setLoading]          = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [membershipInfo,   setMembershipInfo]   = useState(null)
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membershipError,  setMembershipError]  = useState('')
  const [imageLightbox, setImageLightbox] = useState(null)

  // Completed receipts shown as overlay modals (queue so multiple can stack)
  const [receiptQueue, setReceiptQueue] = useState([])

  const searchRef = useRef()
  const catalogRequestRef = useRef(0)
  const customerRequestRef = useRef(0)
  const deliveryRequestRef = useRef(0)
  const membershipRequestRef = useRef(0)
  const savingCustomerRef = useRef(false)
  const savingDeliveryRef = useRef(false)
  const checkoutInFlightRef = useRef(false)
  const taxRate   = parseFloat(settings.tax_rate || '0') / 100
  const redeemPointsStep = Math.max(1, parseInt(settings.customer_portal_redeem_points || '100', 10) || 100)
  const redeemValueUsdStep = Math.max(0, Math.round(parseFloat(settings.customer_portal_redeem_value_usd || '1') || 1))
  const rawRedeemValueKhrStep = Math.max(0, Math.round(parseFloat(settings.customer_portal_redeem_value_khr || String(exchangeRate)) || exchangeRate))
  const redeemValueKhrStep = rawRedeemValueKhrStep === 0 ? 0 : Math.max(1000, Math.ceil(rawRedeemValueKhrStep / 1000) * 1000)

  const applyCatalogData = useCallback((prods, cats, brs) => {
    setProducts(Array.isArray(prods) ? prods.filter((product) => product?.is_active) : [])
    setCategories(Array.isArray(cats) ? cats : [])
    const activeBranches = Array.isArray(brs) ? brs.filter((branch) => branch?.is_active) : []
    setBranches(activeBranches)
    setDefaultBranchId((current) => {
      if (current && activeBranches.some((branch) => Number(branch.id) === Number(current))) {
        return current
      }
      const fallbackBranch = activeBranches.find((branch) => branch.is_default) || activeBranches[0]
      return fallbackBranch ? fallbackBranch.id : null
    })
  }, [])

  const loadCatalogData = useCallback(async (label = 'POS catalog data') => {
    const requestId = beginTrackedRequest(catalogRequestRef)
    try {
      const [prods, cats, brs] = await withLoaderTimeout(
        () => Promise.all([
          window.api.getProducts(),
          window.api.getCategories(),
          window.api.getBranches(),
        ]),
        label,
      )
      if (!isTrackedRequestCurrent(catalogRequestRef, requestId)) return null
      applyCatalogData(prods, cats, brs)
      return { prods, cats, brs }
    } catch (error) {
      if (!isTrackedRequestCurrent(catalogRequestRef, requestId)) return null
      console.error('[POS] catalog load failed:', error.message)
      return null
    }
  }, [applyCatalogData])

  const loadCustomers = useCallback(async (label = 'POS customers') => {
    const requestId = beginTrackedRequest(customerRequestRef)
    try {
      const data = await withLoaderTimeout(() => window.api.getCustomers(), label)
      if (!isTrackedRequestCurrent(customerRequestRef, requestId)) return null
      const nextCustomers = Array.isArray(data) ? data : []
      setCustomers(nextCustomers)
      return nextCustomers
    } catch (error) {
      if (!isTrackedRequestCurrent(customerRequestRef, requestId)) return null
      console.error('[POS] customers load failed:', error.message)
      return null
    }
  }, [])

  const loadDeliveryContacts = useCallback(async (label = 'POS delivery contacts') => {
    const requestId = beginTrackedRequest(deliveryRequestRef)
    try {
      const data = await withLoaderTimeout(
        () => window.api.getDeliveryContacts().catch(() => []),
        label,
      )
      if (!isTrackedRequestCurrent(deliveryRequestRef, requestId)) return null
      const nextContacts = Array.isArray(data) ? data : []
      setDeliveryContacts(nextContacts)
      return nextContacts
    } catch (error) {
      if (!isTrackedRequestCurrent(deliveryRequestRef, requestId)) return null
      console.error('[POS] delivery contacts load failed:', error.message)
      return null
    }
  }, [])

  const loadMembershipInfo = useCallback(async (
    membershipNumber,
    label = 'POS membership lookup',
  ) => {
    const requestId = beginTrackedRequest(membershipRequestRef)
    setMembershipLoading(true)
    setMembershipError('')
    try {
      const data = await withLoaderTimeout(
        () => window.api.lookupPortalMembership(membershipNumber),
        label,
      )
      if (!isTrackedRequestCurrent(membershipRequestRef, requestId)) return null
      setMembershipInfo(data || null)
      if (!data) setMembershipError(posCopy('Membership not found'))
      return data || null
    } catch (error) {
      if (!isTrackedRequestCurrent(membershipRequestRef, requestId)) return null
      setMembershipInfo(null)
      setMembershipError(error?.message || posCopy('Membership lookup failed'))
      return null
    } finally {
      if (isTrackedRequestCurrent(membershipRequestRef, requestId)) {
        setMembershipLoading(false)
      }
    }
  }, [posCopy])

  // ?�?� Initial data load ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(catalogRequestRef)
      invalidateTrackedRequest(customerRequestRef)
      invalidateTrackedRequest(deliveryRequestRef)
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipLoading(false)
      return
    }

    void Promise.allSettled([
      loadCatalogData('POS initial catalog'),
      loadCustomers('POS initial customers'),
      loadDeliveryContacts('POS initial delivery contacts'),
    ])
    searchRef.current?.focus()
  }, [isActive, loadCatalogData, loadCustomers, loadDeliveryContacts])

  // ?�?� Sync-push: reload when another device changes data ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  useEffect(() => {
    if (!isActive || !syncChannel) return
    const { channel } = syncChannel
    if (channel === 'products' || channel === 'branches' || channel === 'categories') {
      void loadCatalogData('POS sync catalog')
    }
    if (channel === 'customers') {
      void loadCustomers('POS sync customers')
    }
    if (channel === 'deliveryContacts') {
      void loadDeliveryContacts('POS sync delivery contacts')
    }
  }, [isActive, loadCatalogData, loadCustomers, loadDeliveryContacts, syncChannel])

  useEffect(() => () => {
    invalidateTrackedRequest(catalogRequestRef)
    invalidateTrackedRequest(customerRequestRef)
    invalidateTrackedRequest(deliveryRequestRef)
    invalidateTrackedRequest(membershipRequestRef)
  }, [])

  // ?�?� Customer autocomplete ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  useEffect(() => {
    const q = (active?.customerSearch || '').toLowerCase().trim()
    if (!q) { setCustomerSuggestions([]); return }
    setCustomerSuggestions(
      customers
        .filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
        .slice(0, LAYOUT.AUTOCOMPLETE_MAX_RESULTS)
    )
  }, [active?.customerSearch, customers])

  // ?�?� Delivery autocomplete ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  useEffect(() => {
    const q = (active?.deliverySearch || '').toLowerCase().trim()
    if (!q) { setDeliverySuggestions([]); return }
    setDeliverySuggestions(
      deliveryContacts
        .filter(d =>
          d.name.toLowerCase().includes(q) ||
          (d.phone || '').includes(q) ||
          (d.area  || '').toLowerCase().includes(q)
        )
        .slice(0, LAYOUT.AUTOCOMPLETE_MAX_RESULTS)
    )
  }, [active?.deliverySearch, deliveryContacts])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipInfo(null)
      setMembershipError('')
      setMembershipLoading(false)
      return
    }

    const membershipNumber = String(active?.customer?.membership_number || '').trim()

    if (!membershipNumber) {
      invalidateTrackedRequest(membershipRequestRef)
      setMembershipInfo(null)
      setMembershipError('')
      setMembershipLoading(false)
      return
    }

    void loadMembershipInfo(membershipNumber, 'POS membership lookup')
  }, [active?.customer?.membership_number, isActive, loadMembershipInfo, syncChannel?.ts])

  // ?�?� Customer actions ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const selectCustomer = (c) => {
    const opts = parseContactOptions(c.address)
    setCustomerSuggestions([])
    setShowCustomerDrop(false)
    if (opts.length > 1) {
      // Store base customer, then show option picker
      patchActive({
        customer: { id: c.id || null, name: c.name, phone: c.phone || '', address: '', email: c.email || '', membership_number: c.membership_number || '', _rawOptions: c.address || '', _baseCustomer: c },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setCustomerOptionsList(opts)
      setShowOptionPicker(true)
    } else if (opts.length === 1) {
      // Single option ??auto-apply it
      const o = opts[0]
      patchActive({
        customer: {
          id:      c.id || null,
          name:    o.name    || c.name,
          phone:   o.phone   || c.phone   || '',
          email:   o.email   || c.email   || '',
          membership_number: c.membership_number || '',
          address: o.address || '',
          _rawOptions: c.address || '',
          _optionLabel: o.label || '',
        },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setShowOptionPicker(false)
    } else {
      // No options ??use customer top-level data
      patchActive({
        customer: { id: c.id || null, name: c.name, phone: c.phone || '', email: c.email || '', membership_number: c.membership_number || '', address: '' },
        customerSearch: c.name,
        membershipDiscountUsd: '',
        membershipDiscountKhr: '',
        membershipRedeemUnits: '',
      })
      setShowOptionPicker(false)
    }
  }

  const applyCustomerOption = (opt) => {
    patchActive({
      customer: {
        ...active.customer,
        name:    opt.name    || active.customer.name,
        phone:   opt.phone   || active.customer.phone || '',
        email:   opt.email   || active.customer.email || '',
        address: opt.address || '',
        _optionLabel: opt.label || '',
      }
    })
    setShowOptionPicker(false)
    setCustomerOptionsList([])
  }
  const clearCustomer = () => patchActive({
    customer: { ...EMPTY_CUSTOMER },
    customerSearch: '',
    membershipDiscountUsd: '',
    membershipDiscountKhr: '',
    membershipRedeemUnits: '',
  })

  const handleAddCustomer = async () => {
    if (!newCustomerForm.name.trim()) return notify('Name required', 'error')
    if (savingCustomerRef.current) return
    savingCustomerRef.current = true
    setSavingCustomer(true)
    try {
      const created = await window.api.createCustomer(newCustomerForm)
      notify(t('customer_added'))
      selectCustomer({ ...newCustomerForm, id: created?.id || null })
      setShowAddCustomer(false)
      setNewCustomerForm({ name: '', phone: '', address: '' })
      await loadCustomers('POS refresh customers after create')
    } catch (e) {
      notify(e.message || 'Failed', 'error')
    } finally {
      savingCustomerRef.current = false
      setSavingCustomer(false)
    }
  }

  // ?�?� Delivery actions ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const selectDelivery = (d) => {
    patchActive({ selectedDelivery: d, deliverySearch: d.name })
    setDeliverySuggestions([])
    setShowDeliveryDrop(false)
  }
  const clearDelivery = () => patchActive({ selectedDelivery: null, deliverySearch: '' })

  const handleAddDelivery = async () => {
    if (!newDeliveryForm.name.trim() && !newDeliveryForm.phone.trim()) {
      return notify('Driver name or phone is required', 'error')
    }
    if (savingDeliveryRef.current) return
    savingDeliveryRef.current = true
    setSavingDelivery(true)
    try {
      const payload = {
        ...newDeliveryForm,
        name: newDeliveryForm.name.trim() || `Driver ${newDeliveryForm.phone.trim()}`,
      }
      const res = await window.api.createDeliveryContact(payload)
      notify('Delivery contact added')
      const created = { ...payload, id: res.id }
      setDeliveryContacts(prev => [...prev, created])
      selectDelivery(created)
      setShowAddDelivery(false)
      setNewDeliveryForm({ name: '', phone: '', area: '' })
    } catch (e) {
      notify(e.message || 'Failed', 'error')
    } finally {
      savingDeliveryRef.current = false
      setSavingDelivery(false)
    }
  }

  // ?�?� Product filter ??comma-separated terms, AND/OR mode (same as Products page) ?�
  const searchTerms = search.trim()
    ? search.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : []

  // Derived filter lists from products
  const posSuppliers = [...new Set(products.map((p) => p.supplier).filter(Boolean))].sort()
  const posBrands = useMemo(() => {
    const fromProducts = products.map((p) => String(p.brand || '').trim()).filter(Boolean)
    let fromSettings = []
    try {
      const parsed = JSON.parse(settings?.product_brand_options || '[]')
      if (Array.isArray(parsed)) {
        fromSettings = parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
      }
    } catch (_) {}
    return Array.from(new Set([...fromProducts, ...fromSettings])).sort((a, b) => a.localeCompare(b))
  }, [products, settings?.product_brand_options])

  // ?�?� Foolproof product filter ??products NOT matching ALL active filters are 100% hidden ?�?�
  const filteredProducts = (() => {
    const terms = searchTerms  // already computed above

    return products.filter(p => {
      // ??Search
      if (terms.length > 0) {
        const hay = `${p.name} ${p.sku||''} ${p.barcode||''} ${p.category||''} ${p.brand||''} ${p.supplier||''} ${p.description||''} ${p.unit||''}`.toLowerCase()
        const hit = searchMode === 'AND'
          ? terms.every(t => hay.includes(t))
          : terms.some(t => hay.includes(t))
        if (!hit) return false
      }

      // ??Category ??exact match, hide all others
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false

      // ??Brand ??exact match (case-insensitive), hide all others
      if (brandFilter !== 'all' && (p.brand || '').toLowerCase() !== brandFilter.toLowerCase()) return false

      // ??Supplier ??exact match (case-insensitive), hide all others
      if (supplierFilter !== 'all' && (p.supplier||'').toLowerCase() !== supplierFilter.toLowerCase()) return false

      // ??Branch ??require a branch_stock entry for the selected branch; hide if absent
      if (branchFilter !== 'all') {
        const bs = (p.branch_stock||[]).find(b => b.branch_id === parseInt(branchFilter))
        if (!bs) return false
      }

      // ??Compute effective quantity for this product in the active context
      const qty = (() => {
        if (branchFilter !== 'all') {
          const bs = (p.branch_stock||[]).find(b => b.branch_id === parseInt(branchFilter))
          return bs ? bs.quantity : 0
        }
        // When no explicit branch filter is selected, show the product's
        // global `stock_quantity` rather than falling back to the default
        // branch's stock. This prevents "All" from appearing empty when
        // the default branch has no entries for many products.
        return p.stock_quantity
      })()

      // ??Stock filter (explicit)
      if (stockFilter === 'out')      return qty <= (p.out_of_stock_threshold || 0)
      if (stockFilter === 'low')      return qty > (p.out_of_stock_threshold || 0) && qty <= (p.low_stock_threshold || 10)
      if (stockFilter === 'in_stock') return qty > (p.low_stock_threshold || 10)

      // ??Default (stockFilter === 'all'): always hide out-of-stock in POS ??you can't sell them
      if (qty <= (p.out_of_stock_threshold || 0)) return false

      return true
    })
  })()

  const productsById = useMemo(() => buildProductsById(products), [products])

  const variantChildrenByParentId = useMemo(
    () => buildVariantChildrenByParentId(products),
    [products],
  )

  const visibleProductCards = useMemo(
    () => buildVisibleProductCards(filteredProducts, productsById),
    [filteredProducts, productsById],
  )

  const getVariantChoices = useCallback((product) => {
    return getVariantChoicesForProduct(product, variantChildrenByParentId)
  }, [variantChildrenByParentId])

  const hasVariantChoices = useCallback((product) => getVariantChoices(product).length > 0, [getVariantChoices])


  const getBranchStockQty = useCallback((product, branchId) => {
    const id = parseInt(branchId, 10)
    if (!product || !Number.isFinite(id)) return 0
    const row = (product.branch_stock || []).find((entry) => Number(entry.branch_id) === id)
    return row ? Number(row.quantity || 0) : 0
  }, [])

  const pickBestBranchId = useCallback((product) => {
    const stockRows = (product?.branch_stock || [])
      .map((entry) => ({ branchId: Number(entry.branch_id), qty: Number(entry.quantity || 0) }))
      .filter((entry) => Number.isFinite(entry.branchId) && entry.qty > 0)

    if (!stockRows.length) return defaultBranchId || null

    const defaultRow = defaultBranchId ? stockRows.find((entry) => entry.branchId === Number(defaultBranchId)) : null
    if (defaultRow) return defaultRow.branchId

    stockRows.sort((a, b) => b.qty - a.qty)
    return stockRows[0].branchId
  }, [defaultBranchId])

  /** Stock quantity relevant to the active branch filter or item branch assignment. */
  const getDisplayStock = useCallback((product, cartItem = null) => {
    if (!product) return 0

    if (branchFilter !== 'all') {
      return getBranchStockQty(product, branchFilter)
    }

    if (cartItem?.branch_id) {
      return getBranchStockQty(product, cartItem.branch_id)
    }

    return Number(product.stock_quantity || 0)
  }, [branchFilter, getBranchStockQty])

  const openProductCard = useCallback((product, { groupProduct = false, inStock = false } = {}) => {
    if (!product) return
    if (groupProduct) {
      setDetailProduct(product)
      return
    }
    if (inStock) {
      addToCart(product, 'selling')
      return
    }
    setDetailProduct(product)
  }, [addToCart])

  /** Build a normalized image list for POS product lightbox (gallery + fallback image). */
  const getProductGallery = useCallback((product) => {
    const raw = product?.image_gallery
    const list = Array.isArray(raw)
      ? raw
      : (() => {
          if (!raw || typeof raw !== 'string') return []
          try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return raw.split('|').map((entry) => entry.trim()).filter(Boolean)
          }
        })()
    const combined = [...list, product?.image_path || '']
    return [...new Set(combined.map((entry) => String(entry || '').trim()).filter(Boolean))]
  }, [])

  /** Resolve uploads paths so the lightbox can render both local and sync-server URLs. */
  const resolveProductImage = useCallback((src) => {
    const raw = String(src || '').trim()
    if (!raw) return ''
    if (raw.startsWith('http') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw
    if (raw.startsWith('/uploads/')) {
      const base = window.api?.getSyncServerUrl?.() || localStorage.getItem('businessos_sync_server') || ''
      return base ? `${base.replace(/\/$/, '')}${raw}` : raw
    }
    return raw
  }, [])

  /** Open shared image lightbox from POS product cards/detail sheet. */
  const openImageLightbox = useCallback((product, startIndex = 0) => {
    const images = getProductGallery(product).map(resolveProductImage).filter(Boolean)
    if (!images.length) return
    const safeIndex = Math.max(0, Math.min(startIndex, images.length - 1))
    setImageLightbox({
      title: product?.name || t('products'),
      images,
      index: safeIndex,
    })
  }, [getProductGallery, resolveProductImage, t])

  /** Primary image used by cards/sheets, with gallery-first fallback. */
  const getPrimaryProductImage = useCallback((product) => {
    return getProductGallery(product)[0] || product?.image_path || ''
  }, [getProductGallery])

  // ?�?� Cart mutations ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const addToCart = (product, priceMode = 'selling') => {
    const assignedBranchId = branchFilter !== 'all'
      ? parseInt(branchFilter, 10)
      : pickBestBranchId(product)
    const priceValues = resolveCartPriceValues(product, priceMode, exchangeRate, {
      usdToKhr: CURRENCY.usdToKhr,
    })
    const existingIndex = findMatchingCartLineIndex(active.cart, {
      productId: product?.id,
      priceMode: priceValues.price_mode,
      branchId: assignedBranchId,
    })
    const existing = existingIndex >= 0 ? active.cart[existingIndex] : null
    let newCart
    if (existing) {
      const stock = getDisplayStock(product, existing)
      if (existing.quantity >= stock) { notify(t('not_enough_stock'), 'error'); return }
      const existingLineId = getCartLineId(existing)
      newCart = active.cart.map((item) => (
        getCartLineId(item) === existingLineId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ))
    } else {
      const stock = getDisplayStock(product, { branch_id: assignedBranchId })
      if (stock <= 0) { notify(t('not_enough_stock'), 'error'); return }
      newCart = [...active.cart, {
        ...product,
        cart_line_id: `${Number(product.id)}:${priceValues.price_mode}:${Number(assignedBranchId || 0)}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        quantity: 1,
        ...priceValues,
        branch_id: assignedBranchId || null,
      }]
    }
    patchActive({ cart: newCart })
    setSearch('')
    searchRef.current?.focus()
  }

  const updateQty = (cartLineId, qty) => {
    if (qty <= 0) { patchActive({ cart: active.cart.filter((item) => getCartLineId(item) !== cartLineId) }); return }
    const cartItem = active.cart.find((item) => getCartLineId(item) === cartLineId)
    const product = products.find((entry) => Number(entry.id) === Number(cartItem?.id))
    if (qty > getDisplayStock(product, cartItem)) { notify(t('not_enough_stock'), 'error'); return }
    patchActive({ cart: active.cart.map((item) => getCartLineId(item) === cartLineId ? { ...item, quantity: qty } : item) })
  }

  const updatePrice = (cartLineId, field, rawValue) => {
    const num = normalizePriceValue(rawValue, 0)
    patchActive({
      cart: active.cart.map((item) => {
        if (getCartLineId(item) !== cartLineId) return item
        if (field === 'usd') {
          return {
            ...item,
            applied_price_usd: num,
            applied_price_khr: normalizePriceValue(CURRENCY.usdToKhr(num, exchangeRate), 0),
          }
        }
        if (field === 'khr') {
          return {
            ...item,
            applied_price_khr: num,
            applied_price_usd: normalizePriceValue(CURRENCY.khrToUsd(num, exchangeRate), 0),
          }
        }
        return item
      }),
    })
  }

  const updateItemBranch = (cartLineId, branchId) => {
    const nextBranchId = branchId ? parseInt(branchId, 10) : null
    const item = active.cart.find((entry) => getCartLineId(entry) === cartLineId)
    const product = products.find((entry) => Number(entry.id) === Number(item?.id))
    if (!item || !product) return

    const available = getDisplayStock(product, { ...item, branch_id: nextBranchId })
    if (item.quantity > available) {
      const branchName = branches.find((branch) => Number(branch.id) === Number(nextBranchId))?.name || t('selected_branch') || 'selected branch'
      notify(`${t('not_enough_stock') || 'Not enough stock'} (${branchName})`, 'error')
      return
    }

    patchActive({ cart: active.cart.map((entry) => getCartLineId(entry) === cartLineId ? { ...entry, branch_id: nextBranchId } : entry) })
  }

  // ?�?� Totals (derived from active order) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const subtotalUsd  = active.cart.reduce((s, i) => s + i.applied_price_usd * i.quantity, 0)
  const subtotalKhr  = active.cart.reduce((s, i) => s + i.applied_price_khr * i.quantity, 0)

  const discUsd      = parseFloat(active.discountUsd) || 0
  const discKhr      = parseFloat(active.discountKhr) || CURRENCY.usdToKhr(discUsd, exchangeRate)
  const membershipDiscUsd = parseFloat(active.membershipDiscountUsd) || 0
  const membershipDiscKhr = parseFloat(active.membershipDiscountKhr) || CURRENCY.usdToKhr(membershipDiscUsd, exchangeRate)
  const membershipRedeemUnits = Math.max(0, parseInt(active.membershipRedeemUnits || '0', 10) || 0)
  const maxMembershipUnits = Math.max(0, Math.floor((membershipInfo?.points?.balance || 0) / redeemPointsStep))

  const afterDiscUsd = Math.max(0, subtotalUsd - discUsd - membershipDiscUsd)
  const afterDiscKhr = Math.max(0, subtotalKhr - discKhr - membershipDiscKhr)

  const taxUsd       = afterDiscUsd * taxRate
  const taxKhr       = afterDiscKhr * taxRate

  const feeUsd       = parseFloat(active.deliveryFeeUsd) || 0
  const feeKhr       = CURRENCY.usdToKhr(feeUsd, exchangeRate)

  // Delivery fee is only added to the customer's bill when THEY are the payer
  const customerFeeUsd = active.isDelivery && active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? feeUsd : 0
  const customerFeeKhr = active.isDelivery && active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? feeKhr : 0

  const totalUsd     = afterDiscUsd + taxUsd + customerFeeUsd
  const totalKhr     = afterDiscKhr + taxKhr + customerFeeKhr

  const paidUsdNum   = parseFloat(active.paidUsd) || 0
  const paidKhrNum   = parseFloat(active.paidKhr) || 0
  const totalPaid    = paidUsdNum + paidKhrNum / exchangeRate
  const changeUsd    = totalPaid - totalUsd
  const changeKhr    = changeUsd * exchangeRate

  const handleDiscountUsd = (v) => patchActive({ discountUsd: v, discountKhr: String(CURRENCY.usdToKhr(parseFloat(v) || 0, exchangeRate)) })
  const handleDiscountKhr = (v) => patchActive({ discountKhr: v, discountUsd: String(CURRENCY.khrToUsd(parseFloat(v) || 0, exchangeRate)) })
  const handleMembershipUnits = (value) => {
    const rawUnits = Math.max(0, parseInt(value || '0', 10) || 0)
    const units = Math.min(rawUnits, maxMembershipUnits)
    patchActive({
      membershipRedeemUnits: units ? String(units) : '',
      membershipDiscountUsd: units ? String((units * redeemValueUsdStep).toFixed(2)) : '',
      membershipDiscountKhr: units ? String(Math.round(units * redeemValueKhrStep)) : '',
    })
  }

  useEffect(() => {
    if (membershipRedeemUnits > maxMembershipUnits) {
      handleMembershipUnits(String(maxMembershipUnits))
    }
  }, [membershipRedeemUnits, maxMembershipUnits]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?�?� Checkout ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  const openStatusPicker = useCallback(() => {
    if (loading || checkoutInFlightRef.current || active.cart.length === 0) return
    setShowStatusPicker(true)
  }, [active.cart.length, loading])

  const closeStatusPicker = useCallback(() => {
    if (loading || checkoutInFlightRef.current) return
    setShowStatusPicker(false)
  }, [loading])

  const closeAddCustomerModal = useCallback(() => {
    if (savingCustomerRef.current) return
    setShowAddCustomer(false)
    setNewCustomerForm({ name: '', phone: '', address: '' })
  }, [])

  const closeAddDeliveryModal = useCallback(() => {
    if (savingDeliveryRef.current) return
    setShowAddDelivery(false)
    setNewDeliveryForm({ name: '', phone: '', area: '' })
  }, [])

  const handleCheckout = async (saleStatus = 'completed') => {
    if (active.cart.length === 0)        return notify(t('cart_empty'), 'error')
    if (totalPaid < totalUsd - 0.005)    return notify(t('insufficient_amount'), 'error')
    if (loading || checkoutInFlightRef.current) return

    const branchIds = new Set(branches.map((branch) => Number(branch.id)))
    const invalidBranchItem = active.cart.find((item) => item.branch_id && !branchIds.has(Number(item.branch_id)))
    if (invalidBranchItem) {
      return notify(posCopy('One or more cart items use an inactive branch. Please re-select the branch before checkout.'), 'error')
    }

    if (branches.length > 1) {
      const missingBranchItem = active.cart.find((item) => !item.branch_id)
      if (missingBranchItem) {
        return notify(
          `${posCopy('Select a branch for')} ${missingBranchItem.name}`,
          'error',
        )
      }
    }

    checkoutInFlightRef.current = true
    setLoading(true)

    const uniqueBranches = [...new Set(active.cart.map(i => Number(i.branch_id)).filter(Boolean))]
    const saleBranchId   = uniqueBranches.length === 1 ? uniqueBranches[0] : null

    const device = getClientDeviceInfo()
    const saleData = {
      cashier_id:   user.id,
      cashier_name: user.name,
      customer_name:    active.customer.name    || null,
      customer_id:      active.customer.id      || null,
      customer_membership_number: active.customer.membership_number || null,
      customer_phone:   active.customer.phone   || null,
      customer_address: active.customer.address || null,
      branch_id: saleBranchId,
      items: active.cart.map(i => ({
        id:                i.id,
        name:              i.name,
        quantity:          i.quantity,
        price_usd:         i.applied_price_usd,
        price_khr:         i.applied_price_khr,
        applied_price_usd: i.applied_price_usd,
        applied_price_khr: i.applied_price_khr,
        cost_price_usd:    i.cost_price_usd    || i.purchase_price_usd    || 0,
        cost_price_khr:    i.cost_price_khr    || i.purchase_price_khr    || 0,
        purchase_price_usd: i.purchase_price_usd || 0,
        purchase_price_khr: i.purchase_price_khr || 0,
        total:     i.applied_price_usd * i.quantity,
        branch_id: i.branch_id || null,
      })),
      subtotal_usd: subtotalUsd, subtotal_khr: subtotalKhr,
      discount_usd: discUsd,    discount_khr: discKhr,
      membership_discount_usd: membershipDiscUsd,
      membership_discount_khr: membershipDiscKhr,
      membership_points_redeemed: membershipRedeemUnits * redeemPointsStep,
      tax_usd:      taxUsd,     tax_khr:      taxKhr,
      total_usd:    totalUsd,   total_khr:    totalKhr,
      payment_method:   active.paymentMethod,
      payment_currency: (paidUsdNum > 0 && paidKhrNum > 0) ? 'MIXED' : paidKhrNum > 0 ? 'KHR' : 'USD',
      amount_paid_usd: paidUsdNum,
      amount_paid_khr: paidKhrNum,
      change_usd: Math.max(0, changeUsd),
      change_khr: Math.max(0, changeKhr),
      exchange_rate: exchangeRate,
      is_delivery:               active.isDelivery ? 1 : 0,
      delivery_contact_id:       active.selectedDelivery?.id      || null,
      delivery_contact_name:     active.selectedDelivery?.name    || null,
      delivery_contact_phone:    active.selectedDelivery?.phone   || null,
      delivery_contact_address:  active.selectedDelivery?.address || null,
      delivery_fee_usd:          feeUsd,
      delivery_fee_khr:          feeKhr,
      delivery_fee_paid_by:      active.isDelivery ? active.deliveryFeePaidBy : DELIVERY_FEE_PAYER.CUSTOMER,
      sale_status: saleStatus,
      client_time: device.clientTime,
      device_tz: device.deviceTz || '',
      device_name: device.deviceName || null,
    }

    try {
      const result = await window.api.createSale(saleData)
      if (result.success) {
        const receiptNumber = result.receiptNumber || result.receipt_number || `RCP-${Date.now()}`
        setReceiptQueue(q => [...q, { ...saleData, id: result.id, receiptNumber, created_at: new Date().toISOString() }])
        closeOrder(resolvedActiveId)
        void loadCatalogData('POS catalog after checkout')
        // Trigger local inventory refresh immediately
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'inventory' } }))
        window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'sales' } }))
      } else {
        notify(result.error || t('error'), 'error')
      }
    } catch (e) {
      notify(e?.message || t('error'), 'error')
    } finally {
      checkoutInFlightRef.current = false
      setLoading(false)
    }
  }

  // ?�?� Render ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ?�?� Mobile tab bar ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
      <div className="md:hidden flex flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <button onClick={() => setMobileView('products')} className={`flex-1 py-2.5 text-sm font-medium ${mobileView === 'products' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}>{t('products') || 'Products'}</button>
        <button onClick={() => setMobileView('cart')}     className={`flex-1 py-2.5 text-sm font-medium relative ${mobileView === 'cart' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}>
          {t('cart') || 'Cart'}
          {active.cart.length > 0 && <span className="absolute top-1.5 right-1/4 w-4 h-4 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">{active.cart.length}</span>}
        </button>
      </div>

      {/* ?�?� Two-panel main layout ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ?��??��??��??��??��??��??��??��??��???LEFT: Products panel ?��??��??��??��??��??��??��??��??��??��???*/}
        <div className={`flex flex-col flex-1 min-h-0 min-w-0 bg-gray-50 dark:bg-gray-900 ${mobileView === 'cart' ? 'hidden md:flex' : 'flex'}`}>

          {/* Filter bar */}
          <div className="flex-shrink-0 p-3 space-y-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            {/* Search + AND/OR + Filter toggle */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                ref={searchRef}
                className="input flex-1 min-w-0"
                placeholder={searchMode === 'AND'
                  ? `${t('search') || 'Search'} (${t('search_and_tip') || 'comma = AND terms'})`
                  : `${t('search') || 'Search'} (${t('search_or_tip') || 'comma = OR terms'})`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="flex flex-1 rounded-lg border border-gray-300 dark:border-zinc-600 overflow-hidden sm:flex-none">
                  {['AND','OR'].map(m => (
                    <button key={m} onClick={() => setSearchMode(m)}
                      className={`flex-1 px-2 py-1.5 text-xs font-bold transition-colors sm:flex-none ${searchMode===m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-zinc-800 text-gray-500 dark:text-gray-400'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                {/* Filter toggle button ??shows active count badge */}
                {(() => {
                  const activeFilters = [
                    categoryFilter !== 'all' ? 1 : 0,
                    brandFilter    !== 'all' ? 1 : 0,
                    branchFilter   !== 'all' ? 1 : 0,
                    stockFilter    !== 'all' ? 1 : 0,
                    supplierFilter !== 'all' ? 1 : 0,
                  ].reduce((a, b) => a + b, 0)
                  return (
                    <button
                      onClick={() => setFilterOpen(v => !v)}
                      className={`flex flex-1 items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors sm:flex-none ${
                        filterOpen || activeFilters > 0
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                      }`}
                    >
                      {activeFilters > 0 ? (t('filters_active')||`Filters (${activeFilters})`).replace('{n}', activeFilters) : (t('filters')||'Filters')}
                    </button>
                  )
                })()}
              </div>
            </div>

            {searchTerms.length > 1 && (
              <div className="flex gap-1 flex-wrap">{searchTerms.map((term, i) => <span key={i} className="badge-blue text-xs">{term}</span>)}</div>
            )}

            <div className="relative z-20">
              <div className="pointer-events-none absolute inset-x-0 top-0 pt-2">
                <FilterPanel
                  open={filterOpen}
                  t={t}
                  onClose={() => setFilterOpen(false)}
                  categories={categories}
                  brands={posBrands}
                  branches={branches}
                  suppliers={posSuppliers}
                  categoryFilter={categoryFilter}   setCategoryFilter={setPersistedCat}
                  brandFilter={brandFilter}         setBrandFilter={setPersistedBrand}
                  branchFilter={branchFilter}       setBranchFilter={setPersistedBranch}
                  stockFilter={stockFilter}         setStockFilter={setPersistedStock}
                  supplierFilter={supplierFilter}   setSupplierFilter={setPersistedSupplier}
                  quickFilters={quickFilters}
                  setQuickFilter={setQuickFilter}
                />
              </div>
            </div>

          </div>

          {/* Product grid */}
          <div className={`flex-1 overflow-y-auto overflow-x-hidden p-3 ${filterOpen ? 'pt-[20.5rem] sm:pt-[18rem]' : ''}`}>
            <div className="pos-product-grid">
              {visibleProductCards.map(p => {
                const variants = getVariantChoices(p)
                const groupProduct = hasVariantChoices(p)
                const groupMeta = p.__groupMeta || null
                const choiceLabel = groupMeta?.groupKind === 'variant'
                  ? posCopy('variants', 'variants')
                  : posCopy('options', 'options')
                const stock   = getDisplayStock(p)
                const variantInStock = variants.some((variant) => getDisplayStock(variant) > (variant.out_of_stock_threshold || 0))
                const inStock = groupProduct ? variantInStock : stock > (p.out_of_stock_threshold || 0)
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    className={`card relative cursor-pointer p-3 text-left transition-all ${inStock ? 'hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600' : 'opacity-60'}`}
                    onClick={() => openProductCard(p, { groupProduct, inStock })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openProductCard(p, { groupProduct, inStock })
                      }
                    }}
                  >
                    <button className="absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-gray-500 shadow-sm hover:text-blue-600 dark:bg-gray-900/70" onClick={e => { e.stopPropagation(); setDetailProduct(p) }} title="Details">
                      <Info className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-2 overflow-hidden"
                      onClick={(event) => { event.stopPropagation(); openImageLightbox(p, 0) }}
                      aria-label={posCopy('Preview product images', 'Preview product images')}
                    >
                      {getPrimaryProductImage(p) ? <ProductImage src={getPrimaryProductImage(p)} alt={p.__displayName || p.name} className="w-full h-full object-cover" /> : <ImageOff className="h-5 w-5 text-gray-400" />}
                    </button>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-gray-900 dark:text-white leading-tight mb-1 line-clamp-2">{p.__displayName || p.name}</p>
                      {groupProduct ? (
                        <span
                          className="inline-flex flex-shrink-0 items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                          aria-label={`${variants.length} ${choiceLabel}`}
                        >
                          {variants.length}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-bold text-blue-600">
                      {groupProduct && groupMeta?.minSellingPriceUsd !== groupMeta?.maxSellingPriceUsd
                        ? `${fmtUSD(groupMeta?.minSellingPriceUsd || 0)} - ${fmtUSD(groupMeta?.maxSellingPriceUsd || 0)}`
                        : fmtUSD(p.selling_price_usd)}
                    </p>
                    {p.selling_price_khr > 0 && !groupProduct ? <p className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</p> : null}
                    {(p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0 ? (
                      <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Special {fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}</p>
                    ) : null}
                    <p className={`text-xs mt-0.5 ${stock <= (p.low_stock_threshold || 10) && stock > 0 ? 'text-yellow-500 font-medium' : 'text-gray-400'}`}>
                      {groupProduct ? `${variants.length} ${choiceLabel}` : `${stock} ${p.unit}`}
                    </p>
                    {groupProduct && groupMeta?.stockTotal ? (
                      <p className="text-[11px] text-gray-400">{groupMeta.stockTotal} {posCopy('total in stock', 'total in stock')}</p>
                    ) : null}
                    {!inStock ? <span className="text-xs text-red-500 font-medium">{t('out_of_stock')}</span> : null}
                    <p className="mt-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                      {groupProduct
                        ? posCopy('Tap to view choices', 'Tap to view choices')
                        : inStock
                          ? posCopy('Tap to add instantly', 'Tap to add instantly')
                          : posCopy('Tap to view details', 'Tap to view details')}
                    </p>
                  </div>
                )
              })}
              {visibleProductCards.length === 0 && <div className="col-span-full text-center py-12 text-gray-400">{t('no_data')}</div>}
            </div>
          </div>
        </div>

        {/* ?��??��??��??��??��??��???RIGHT: Cart panel ?��??��??��??��??��??��???*/}
        <div className={`flex flex-col flex-shrink-0 w-full md:w-80 lg:w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 h-full min-h-0 ${mobileView === 'products' ? 'hidden md:flex' : 'flex'}`}>

          {/* ?�?� Order tabs ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto bg-gray-50 dark:bg-gray-900 scroll-x">
            {orders.map(order => (
              <div key={order.id} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors cursor-pointer
                ${resolvedActiveId === order.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-blue-400'}`}
                onClick={() => setActiveId(order.id)}
              >
                <span>{order.label}</span>
                {order.cart.length > 0 && (
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${resolvedActiveId === order.id ? 'bg-white/30 text-white' : 'bg-blue-600 text-white'}`}>{order.cart.length}</span>
                )}
                {orders.length > 1 && (
                  <span className="text-[11px] opacity-60 hover:opacity-100 ml-0.5 leading-none" onClick={e => { e.stopPropagation(); closeOrder(order.id) }}>x</span>
                )}
              </div>
            ))}
            {orders.length < LAYOUT.MAX_CONCURRENT_ORDERS && (
              <button onClick={addNewOrder} className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg bg-white dark:bg-gray-800 border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 text-gray-400 hover:text-blue-600 text-sm font-bold transition-colors" title="New order">+</button>
            )}
          </div>

          {/* ?�?� Scrollable area: items + customer + delivery + payment ?�?�?� */}
          {/*    Everything EXCEPT order tabs and checkout button scrolls.  */}
          <div className="flex-1 overflow-y-auto min-h-0">

            {/* Cart items */}
            <div>
              {active.cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
                  <span className="text-4xl">Cart</span>
                  <p className="text-sm">{t('cart_empty')}</p>
                  <p className="text-xs">{t('tap_product_to_add')||'Tap a product to add it'}</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1">
                    <span className="text-xs text-gray-400 font-medium">{active.cart.length} item{active.cart.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => patchActive({ cart: [] })} className="text-xs text-red-500 hover:underline">{t('clear_cart')}</button>
                  </div>
                  {active.cart.map(item => (
                    <CartItem key={item.cart_line_id || `${item.id}-${item.price_mode || 'selling'}-${item.branch_id || 'none'}`} item={item} branches={branches} t={t}
                      onQtyChange={updateQty} onPriceChange={updatePrice}
                      onBranchChange={updateItemBranch}
                      onRemove={id => patchActive({ cart: active.cart.filter(i => getCartLineId(i) !== id) })}
                      onShowDetails={() => { const p = products.find(pr => pr.id === item.id); if (p) setDetailProduct(p) }}
                      fmtUSD={fmtUSD} fmtKHR={fmtKHR} usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate}
                    />
                  ))}
                </>
              )}
            </div>

            {/* ?�?� Customer section (collapsible) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-3 py-2">
                <button className="flex-1 text-left flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400" onClick={() => setShowCustomer(v => !v)}>
                  <span>{t('pos_customer')||t('customer')||'Customer'}</span>
                  {active.customer.name
                    ? <span className="text-blue-600 truncate max-w-[120px]">{active.customer.name}</span>
                    : <span className="text-gray-400">({t('optional')||'optional'})</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{showCustomer ? 'Hide' : 'Show'}</span>
                </button>
                <button onClick={() => setShowAddCustomer(true)} className="ml-2 text-xs text-blue-500 hover:text-blue-700 font-medium whitespace-nowrap">{t('add_new')||'+ New'}</button>
              </div>
              {showCustomer && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="relative">
                    <label htmlFor="pos-customer-search" className="sr-only">{t('search_customer')}</label>
                    <input id="pos-customer-search" name="pos_customer_search" autoComplete="name" className="input text-xs py-1.5 pr-8" placeholder={t('search_customer')} value={active.customerSearch || ''}
                      onChange={e => { patchActive({ customerSearch: e.target.value, customer: { ...active.customer, name: e.target.value } }); setShowCustomerDrop(true) }}
                      onFocus={() => setShowCustomerDrop(true)} />
                    {active.customerSearch && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500" onClick={clearCustomer}>Clear</button>}
                    {showCustomerDrop && customerSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-32 overflow-auto mt-0.5">
                        {customerSuggestions.map(c => (
                          <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-xs" onClick={() => selectCustomer(c)}>
                            <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
                            {c.phone && <span className="text-gray-400 ml-2">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {active.customer.name && (
                    <div className="space-y-1.5">
                      {/* Option label badge ??shown when an option is selected */}
                      {active.customer._optionLabel && (
                        <div className="flex items-center gap-1.5">
                          <span className="badge-blue text-xs">{active.customer._optionLabel}</span>
                          {customerOptionsList.length > 1 && (
                            <button className="text-xs text-blue-500 hover:underline" onClick={() => setShowOptionPicker(true)}>change</button>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        <label htmlFor="pos-customer-phone-inline" className="sr-only">{t('phone')}</label>
                        <input id="pos-customer-phone-inline" name="pos_customer_phone_inline" autoComplete="tel" className="input text-xs py-1" placeholder={t('phone')} value={active.customer.phone||''} onChange={e => patchActive({ customer: { ...active.customer, phone: e.target.value } })} />
                        <label htmlFor="pos-customer-address-inline" className="sr-only">{t('address')}</label>
                        <input id="pos-customer-address-inline" name="pos_customer_address_inline" autoComplete="street-address" className="input text-xs py-1" placeholder={t('address')} value={active.customer.address||''} onChange={e => patchActive({ customer: { ...active.customer, address: e.target.value } })} />
                      </div>
                      {/* Option picker ??appears inline when customer has multiple options */}
                      {showOptionPicker && customerOptionsList.length > 0 && (
                        <div className="border border-blue-200 dark:border-blue-700 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Choose contact option</span>
                            <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setShowOptionPicker(false)}>Close</button>
                          </div>
                          {customerOptionsList.map((opt, i) => (
                            <button key={i} onClick={() => applyCustomerOption(opt)}
                              className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-t border-gray-100 dark:border-gray-700 first:border-t-0 text-xs transition-colors">
                              <div className="font-semibold text-gray-800 dark:text-gray-200">{opt.label || `Option ${i + 1}`}</div>
                              <div className="text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2 mt-0.5">
                                {opt.name    && <span>Name: {opt.name}</span>}
                                {opt.phone   && <span>Phone: {opt.phone}</span>}
                                {opt.address && <span>Address: {opt.address}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ?�?� Delivery section (collapsible with toggle) ?�?�?�?�?�?�?�?�?�?�?�?�?� */}
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between px-3 py-2">
                <button className="flex-1 text-left flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400" onClick={() => setShowDelivery(v => !v)}>
                  <span>{t('pos_delivery')||t('delivery_fees')||'Delivery'}</span>
                  {active.isDelivery && active.selectedDelivery?.name && <span className="text-orange-500 truncate max-w-[80px]">{active.selectedDelivery.name}</span>}
                  {active.isDelivery && feeUsd > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{fmtUSD(feeUsd)}</span>}
                  <span className="ml-auto text-[10px] text-gray-400">{showDelivery ? 'Hide' : 'Show'}</span>
                </button>
                {/* Toggle switch */}
                <button onClick={() => { patchActive({ isDelivery: !active.isDelivery }); if (!active.isDelivery) setShowDelivery(true) }}
                  className={`relative ml-2 w-9 h-5 rounded-full transition-colors flex-shrink-0 ${active.isDelivery ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${active.isDelivery ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {showDelivery && active.isDelivery && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Delivery contact picker */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{t('rider_contact')||'Rider / Contact'}</span>
                      <button onClick={() => setShowAddDelivery(true)} className="text-xs text-orange-500 hover:text-orange-700 font-medium">{t('add_new')||'+ New'}</button>
                    </div>
                    <div className="relative">
                      <label htmlFor="pos-delivery-search" className="sr-only">{t('search')}</label>
                      <input id="pos-delivery-search" name="pos_delivery_search" autoComplete="name" className="input text-xs py-1.5 pr-8" placeholder={`${t('search')}...`} value={active.deliverySearch || ''}
                        onChange={e => { patchActive({ deliverySearch: e.target.value }); setShowDeliveryDrop(true) }}
                        onFocus={() => setShowDeliveryDrop(true)} />
                      {active.deliverySearch && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500" onClick={clearDelivery}>Clear</button>}
                      {showDeliveryDrop && deliverySuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-32 overflow-auto mt-0.5">
                          {deliverySuggestions.map(d => (
                            <button key={d.id} className="w-full text-left px-3 py-2 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-xs" onClick={() => selectDelivery(d)}>
                              <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
                              {d.phone && <span className="text-gray-400 ml-2">{d.phone}</span>}
                              {d.area  && <span className="text-orange-500 ml-2 text-[10px]">{d.area}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {deliveryContacts.length === 0 && (
                      <p className="text-xs text-gray-400 mt-1">No contacts yet. <button className="text-orange-500 underline" onClick={() => setShowAddDelivery(true)}>Add one</button></p>
                    )}
                  </div>

                  {/* Delivery fee ??USD input + KHR auto-display */}
                  <div>
                    <label htmlFor="pos-delivery-fee-usd" className="text-xs text-gray-400 block mb-1">{t('delivery_fee')||'Delivery fee'}</label>
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span>
                        <input id="pos-delivery-fee-usd" name="pos_delivery_fee_usd" className="input text-xs py-1 pl-5 w-full" type="number" step="any" placeholder="0.00" value={active.deliveryFeeUsd} onChange={e => patchActive({ deliveryFeeUsd: e.target.value })} autoComplete="off" />
                      </div>
                      {feeUsd > 0 && <span className="text-xs text-gray-400 whitespace-nowrap">= {fmtKHR(feeKhr)}</span>}
                    </div>
                  </div>

                  {/* Who pays the fee */}
                  <div>
                    <div className="text-xs text-gray-400 block mb-1">{t('fee_paid_by')||'Fee paid by'}</div>
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs">
                      <button onClick={() => patchActive({ deliveryFeePaidBy: DELIVERY_FEE_PAYER.CUSTOMER })} className={`flex-1 py-1.5 font-medium transition-colors ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-500 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('fee_by_customer')||'Customer'}</button>
                      <button onClick={() => patchActive({ deliveryFeePaidBy: DELIVERY_FEE_PAYER.STORE })}    className={`flex-1 py-1.5 font-medium transition-colors ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.STORE    ? 'bg-blue-600 text-white'   : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{t('fee_by_store')||'Store'}</button>
                    </div>
                    {feeUsd > 0 && (
                      <p className={`text-xs mt-1 px-2 py-1 rounded-lg ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'}`}>
                        {active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER
                          ? `${fmtUSD(feeUsd)} (${fmtKHR(feeKhr)}) ${t('added_to_total')||'added to total'}`
                          : `${fmtUSD(feeUsd)} (${fmtKHR(feeKhr)}) ${t('absorbed_by_store')||'absorbed by store'}`}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ?�?� Discount + Order Summary + Payment ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 pt-3 pb-2 space-y-3">

              {/* Discount */}
              <div>
                <label htmlFor="pos-discount-usd" className="text-xs text-gray-500 font-medium">{t('discount')}</label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span><input id="pos-discount-usd" name="pos_discount_usd" className="input text-xs py-1 pl-5" type="number" step="any" placeholder="0.00" value={active.discountUsd} onChange={e => handleDiscountUsd(e.target.value)} autoComplete="off" /></div>
                  <div className="relative"><label htmlFor="pos-discount-khr" className="sr-only">{`${t('discount')} ${khrSymbol}`}</label><input id="pos-discount-khr" name="pos_discount_khr" className="input text-xs py-1 pr-5" type="number" step="any" placeholder="0" value={active.discountKhr ? Number(active.discountKhr).toFixed(0) : ''} onChange={e => handleDiscountKhr(e.target.value)} autoComplete="off" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{khrSymbol}</span></div>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 font-medium">{posCopy('Membership discount')}</div>
                <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50/80 p-2.5">
                  {!active.customer?.membership_number ? (
                    <p className="text-xs text-emerald-700">{posCopy('Select a customer with a membership number to apply membership discount separately from store discount.')}</p>
                  ) : membershipLoading ? (
                    <p className="text-xs text-emerald-700">{posCopy('Checking membership points...')}</p>
                  ) : membershipError ? (
                    <p className="text-xs text-red-600">{membershipError}</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-emerald-800">{active.customer.membership_number}</span>
                        <span className="text-emerald-700">
                          {posCopy('Balance')}: {(membershipInfo?.points?.balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts
                        </span>
                      </div>
                      <div className="grid grid-cols-[110px,1fr] gap-2">
                        <div>
                          <label htmlFor="pos-membership-redeem-units" className="mb-1 block text-[11px] font-medium text-emerald-700">{posCopy('Units')}</label>
                          <input id="pos-membership-redeem-units" name="pos_membership_redeem_units" className="input text-xs py-1" type="number" min="0" step="1" value={active.membershipRedeemUnits || ''} onChange={e => handleMembershipUnits(e.target.value)} />
                        </div>
                        <div className="rounded-lg bg-white/90 px-3 py-2 text-xs text-emerald-900">
                          <div>{posCopy('1 unit')} = {redeemPointsStep} pts = {fmtUSD(redeemValueUsdStep)}</div>
                          <div className="mt-1">{posCopy('Available units')}: {maxMembershipUnits}</div>
                          <div className="mt-1">{posCopy('Membership discount')}: {fmtUSD(membershipDiscUsd)} / {fmtKHR(membershipDiscKhr)}</div>
                          <div className="mt-1 text-[11px] text-emerald-700">{posCopy('Staff applies this during checkout. Customers can only view points in the customer portal.')}</div>
                        </div>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button className="text-emerald-700 hover:underline" onClick={() => handleMembershipUnits('0')}>{posCopy('Clear')}</button>
                        <span className="text-emerald-300">|</span>
                        <button className="text-emerald-700 hover:underline" onClick={() => handleMembershipUnits(String(maxMembershipUnits))}>{posCopy('Use max')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Order summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-2.5 space-y-1 text-xs">
                <div className="flex justify-between text-gray-500"><span>{t('subtotal')}</span><span>{fmtUSD(subtotalUsd)}</span></div>
                {discUsd > 0 && <div className="flex justify-between text-red-500"><span>{t('discount')}</span><span>-{fmtUSD(discUsd)}</span></div>}
                {membershipDiscUsd > 0 && <div className="flex justify-between text-emerald-600"><span>{posCopy('Membership discount')}</span><span>-{fmtUSD(membershipDiscUsd)}</span></div>}
                {taxRate > 0  && <div className="flex justify-between text-gray-500"><span>{t('tax')} ({settings.tax_rate}%)</span><span>{fmtUSD(taxUsd)}</span></div>}
                {active.isDelivery && feeUsd > 0 && (
                  <div className={`flex justify-between ${active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? 'text-orange-600' : 'text-blue-500'}`}>
                    <span>{t('pos_delivery')||'Delivery'}{active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.STORE ? ' ('+( t('store_pays')||'store pays')+')' : ''}</span>
                    <span>{active.deliveryFeePaidBy === DELIVERY_FEE_PAYER.CUSTOMER ? `+${fmtUSD(feeUsd)}` : `${fmtUSD(feeUsd)} included`}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 dark:text-white text-sm border-t border-gray-200 dark:border-gray-600 pt-1.5 mt-1">
                  <span>{t('total')}</span>
                  <div className="text-right">
                    <div>{fmtUSD(totalUsd)}</div>
                    <div className="text-xs font-normal text-gray-400">{fmtKHR(totalKhr)}</div>
                  </div>
                </div>
              </div>

              {/* Payment method */}
              <div>
                <div className="text-xs text-gray-500 font-medium">{t('payment_method')}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {((() => { try { const p=JSON.parse(settings.pos_payment_methods||'[]'); return p.length?p:['Cash','Card','ABA Bank','Wing','KHQR','Pi Pay','Transfer'] } catch { return ['Cash','Card','ABA Bank','Wing','KHQR','Pi Pay','Transfer'] } })()).map(m => (
                    <button key={m} onClick={() => patchActive({ paymentMethod: m, customPayment: false })}
                      className={`px-2 py-1 rounded-lg text-xs font-medium ${active.paymentMethod === m && !active.customPayment ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{m}</button>
                  ))}
                  <button onClick={() => patchActive({ customPayment: true })} className={`px-2 py-1 rounded-lg text-xs font-medium ${active.customPayment ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>Other</button>
                </div>
                {active.customPayment && <input id="pos-custom-payment-method" name="pos_custom_payment_method" className="input text-xs py-1.5 mt-1" placeholder="Payment method" value={active.paymentMethod} onChange={e => patchActive({ paymentMethod: e.target.value })} autoComplete="off" autoFocus />}
              </div>

              {/* Amount paid */}
              <div>
                <label htmlFor="pos-paid-usd" className="text-xs text-gray-500 font-medium">{t('amount_paid')}</label>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{usdSymbol}</span><input id="pos-paid-usd" name="pos_paid_usd" className="input text-xs py-1.5 pl-5" type="number" step="any" placeholder="0.00" value={active.paidUsd} onChange={e => patchActive({ paidUsd: e.target.value })} autoComplete="off" /></div>
                  <div className="relative"><label htmlFor="pos-paid-khr" className="sr-only">{`${t('amount_paid')} ${khrSymbol}`}</label><input id="pos-paid-khr" name="pos_paid_khr" className="input text-xs py-1.5 pr-5" type="number" step="any" placeholder="0" value={active.paidKhr} onChange={e => patchActive({ paidKhr: e.target.value })} autoComplete="off" /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">{khrSymbol}</span></div>
                </div>
                <div className="flex gap-2 mt-1">
                  <button className="text-xs text-blue-500 hover:underline" onClick={() => patchActive({ paidUsd: totalUsd.toFixed(2), paidKhr: '' })}>Exact {usdSymbol}</button>
                  <span className="text-gray-300">|</span>
                  <button className="text-xs text-blue-500 hover:underline" onClick={() => patchActive({ paidKhr: Math.ceil(totalKhr).toString(), paidUsd: '' })}>Exact {khrSymbol}</button>
                </div>
                {(paidUsdNum > 0 || paidKhrNum > 0) && (
                  <div className={`mt-1.5 p-2 rounded-lg text-xs ${changeUsd >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">{t('change')}:</span>
                      <div className="text-right font-bold">
                        <div className={changeUsd >= 0 ? 'text-green-600' : 'text-red-600'}>{fmtUSD(Math.abs(changeUsd))}{changeUsd < 0 ? ' short' : ''}</div>
                        {Math.abs(changeKhr) > 1 && <div className="text-gray-400 font-normal">{fmtKHR(Math.abs(changeKhr))}</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>{/* end scroll area content */}
          </div>{/* end scrollable area */}

          {/* ?�?� Checkout button ??always pinned at the bottom ?�?�?�?�?�?�?�?�?�?�?� */}
          <div className="flex-shrink-0 px-3 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <button className="btn-success w-full py-3 text-sm font-bold" onClick={openStatusPicker} disabled={loading || showStatusPicker || active.cart.length === 0}>
              {loading ? t('loading') : `${t('done') || 'Done'}${active.isDelivery ? ` - ${t('pos_delivery') || 'Delivery'}` : ''}`}
            </button>
          </div>

        </div>{/* end cart panel */}
      </div>{/* end two-panel layout */}

      {/* ?�?� Sale Status Picker ??shown when Done is tapped ?�?�?�?�?�?�?�?�?�?�?� */}
      {showStatusPicker && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm fade-in">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-bold text-gray-900 dark:text-white">Record Sale As</h3>
              <button onClick={closeStatusPicker} disabled={loading} className="text-gray-400 hover:text-gray-600 text-sm leading-none w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">Close</button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('pos_status_choose_desc')||'Choose how this sale is being processed. This will appear in Sales history.'}</p>
              {[
                ['completed',         getStatusLabel('completed',         t), t('pos_status_completed_desc')||'Payment received - stock deducted now'],
                ['awaiting_payment',  getStatusLabel('awaiting_payment',  t), t('pos_status_awaiting_payment_desc')||'Order placed, payment pending - stock held'],
                ['awaiting_delivery', getStatusLabel('awaiting_delivery', t), t('pos_status_awaiting_delivery_desc')||'Paid, not yet delivered - stock deducted'],
              ].map(([status, label, desc]) => (
                <button key={status}
                  onClick={() => { closeStatusPicker(); void handleCheckout(status) }}
                  disabled={loading}
                  className="w-full p-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left transition-colors disabled:opacity-50">
                  <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ?�?� Quick-add Customer modal ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
      {showAddCustomer && (
        <QuickAddModal title={t('add_new_customer')} saving={savingCustomer} onSave={handleAddCustomer} t={t} onClose={closeAddCustomerModal}>
          <div><label htmlFor="pos-quick-customer-name" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('name')} *</label><input id="pos-quick-customer-name" name="pos_quick_customer_name" className="input" value={newCustomerForm.name} onChange={e => setNewCustomerForm(f => ({ ...f, name: e.target.value }))} autoComplete="name" autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label htmlFor="pos-quick-customer-phone" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('phone')}</label><input id="pos-quick-customer-phone" name="pos_quick_customer_phone" className="input" value={newCustomerForm.phone} onChange={e => setNewCustomerForm(f => ({ ...f, phone: e.target.value }))} autoComplete="tel" /></div>
            <div><label htmlFor="pos-quick-customer-address" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('address')}</label><input id="pos-quick-customer-address" name="pos_quick_customer_address" className="input" value={newCustomerForm.address} onChange={e => setNewCustomerForm(f => ({ ...f, address: e.target.value }))} autoComplete="street-address" /></div>
          </div>
        </QuickAddModal>
      )}

      {/* ?�?� Quick-add Delivery Contact modal ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
      {showAddDelivery && (
        <QuickAddModal title={t('add_delivery_contact')||'Add Delivery Contact'} saving={savingDelivery} onSave={handleAddDelivery} t={t} onClose={closeAddDeliveryModal}>
          <div><label htmlFor="pos-quick-delivery-name" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Driver / Rider Name</label><input id="pos-quick-delivery-name" name="pos_quick_delivery_name" className="input" value={newDeliveryForm.name} onChange={e => setNewDeliveryForm(f => ({ ...f, name: e.target.value }))} autoComplete="name" autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label htmlFor="pos-quick-delivery-phone" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Phone</label><input id="pos-quick-delivery-phone" name="pos_quick_delivery_phone" className="input" value={newDeliveryForm.phone} onChange={e => setNewDeliveryForm(f => ({ ...f, phone: e.target.value }))} placeholder="012 345 678" autoComplete="tel" /></div>
            <div><label htmlFor="pos-quick-delivery-area" className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Area / Zone</label><input id="pos-quick-delivery-area" name="pos_quick_delivery_area" className="input" value={newDeliveryForm.area} onChange={e => setNewDeliveryForm(f => ({ ...f, area: e.target.value }))} placeholder="Central, North" autoComplete="address-level2" /></div>
          </div>
          <p className="text-xs text-gray-400">Enter at least a driver name or phone number.</p>
        </QuickAddModal>
      )}

      {/* ?�?� Product detail bottom-sheet ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?� */}
      {detailProduct && (() => {
        const p = detailProduct
        const stock = getDisplayStock(p)
        const variants = getVariantChoices(p)
        const groupProduct = hasVariantChoices(p)
        const groupMeta = p.__groupMeta || null
        const choiceLabel = groupMeta?.groupKind === 'variant'
          ? posCopy('Variants', 'Variants')
          : posCopy('Options', 'Options')
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setDetailProduct(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0"
                    onClick={() => openImageLightbox(p, 0)}
                      aria-label={posCopy('Preview product images')}
                  >
                    {getPrimaryProductImage(p) ? <ProductImage src={getPrimaryProductImage(p)} alt={p.__displayName || p.name} className="w-full h-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-400" />}
                  </button>
                  <div className="min-w-0"><div className="font-bold text-gray-900 dark:text-white truncate">{p.__displayName || p.name}</div>{p.sku && <div className="text-xs text-gray-400 font-mono">{p.sku}</div>}</div>
                </div>
                <button onClick={() => setDetailProduct(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2 text-sm">
                {[
                  [t('label_category')||'Category',    p.category],
                  [t('label_supplier')||'Supplier',    p.supplier],
                  [t('label_unit')||'Unit',            p.unit],
                  [t('label_barcode')||'Barcode',      p.barcode],
                  [t('label_description')||'Description', p.description],
                ].map(([label, val]) => val ? (
                  <div key={label} className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{label}</span><span className="text-sm text-gray-800 dark:text-gray-200">{val}</span></div>
                ) : null)}
                <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_selling_price')||'Price'}</span><div><span className="font-bold text-blue-600">{fmtUSD(p.selling_price_usd)}</span>{p.selling_price_khr > 0 && <span className="text-xs text-gray-400 ml-2">{fmtKHR(p.selling_price_khr)}</span>}</div></div>
                {((p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0) ? (
                  <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('special_price')||'Special'}</span><div><span className="font-bold text-emerald-600">{fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}</span>{(p.special_price_khr || p.selling_price_khr || 0) > 0 && <span className="text-xs text-gray-400 ml-2">{fmtKHR(p.special_price_khr || p.selling_price_khr || 0)}</span>}</div></div>
                ) : null}
                <div className="flex gap-3"><span className="text-xs text-gray-400 w-24 flex-shrink-0 pt-0.5">{t('label_stock')||'Stock'}</span><span className={`font-bold ${stock <= 0 ? 'text-red-600' : stock <= (p.low_stock_threshold || 10) ? 'text-yellow-600' : 'text-green-600'}`}>{stock} {p.unit}</span></div>
                {groupProduct ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{choiceLabel}</div>
                    <div className="space-y-2">
                      {variants.map((variant) => {
                        const variantStock = getDisplayStock(variant)
                        const variantInStockNow = variantStock > (variant.out_of_stock_threshold || 0)
                        return (
                          <div key={variant.id} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                            <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{variant.name}</div>
                            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{variantStock} {variant.unit}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <button className="btn-primary flex-1 text-xs" disabled={!variantInStockNow} onClick={() => { addToCart(variant, 'selling'); setDetailProduct(null) }}>
                                {fmtUSD(variant.selling_price_usd || 0)}
                              </button>
                              {(variant.special_price_usd || 0) > 0 || (variant.special_price_khr || 0) > 0 ? (
                                <button className="btn-secondary flex-1 text-xs" disabled={!variantInStockNow} onClick={() => { addToCart(variant, 'special'); setDetailProduct(null) }}>
                                  {posCopy('Special', 'Special')} {fmtUSD(variant.special_price_usd || variant.selling_price_usd || 0)}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              {!groupProduct ? (
                <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1" disabled={stock <= (p.out_of_stock_threshold || 0)} onClick={() => { addToCart(p, 'selling'); setDetailProduct(null) }}>
                      {stock <= (p.out_of_stock_threshold || 0) ? t('out_of_stock') : `+ ${t('add_to_cart')}`}
                    </button>
                    {((p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0) ? (
                      <button className="btn-secondary flex-1" disabled={stock <= (p.out_of_stock_threshold || 0)} onClick={() => { addToCart(p, 'special'); setDetailProduct(null) }}>
                        {posCopy('Special', 'Special')}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )
      })()}

      {/* ?�?� Receipt overlay ??shown after each completed sale ?�?�?�?�?�?�?�?�?�?� */}
      {/*   Displayed on top of the POS so other orders remain intact.   */}
      <ImageGalleryLightbox
        open={!!(imageLightbox && imageLightbox.images?.length)}
        title={imageLightbox?.title || t('products')}
        images={imageLightbox?.images || []}
        index={imageLightbox?.index || 0}
        onClose={() => setImageLightbox(null)}
        onIndexChange={(index) => setImageLightbox((current) => (current ? { ...current, index } : current))}
        labels={{
        prev: posCopy('Prev'),
        next: posCopy('Next'),
          imageCount: '{current}/{total}',
          dotsLabel: 'Image {current} of {total}',
        }}
      />
      {receiptQueue.length > 0 && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md max-h-[90vh] flex flex-col bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-2xl">
            {receiptQueue.length > 1 && (
              <div className="flex-shrink-0 bg-blue-600 text-white text-xs text-center py-1 px-3">{receiptQueue.length} receipts waiting - close this one to see the next</div>
            )}
            <Receipt
              sale={receiptQueue[0]}
              settings={settings}
              onClose={() => setReceiptQueue(q => q.slice(1))}
            />
          </div>
        </div>
      )}

    </div>
  )
}

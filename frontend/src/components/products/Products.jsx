// ?�?� Products ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
// Main Products page ??all sub-modals imported from sibling files.

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronDown, ChevronRight, PackageSearch } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { ThreeDotPortal } from '../shared/PortalMenu'
import Modal from '../shared/Modal'
import ImageGalleryLightbox from '../shared/ImageGalleryLightbox'
import FilterMenu from '../shared/FilterMenu'
import { ProductImg, ProductImagePlaceholder } from './primitives'
import ManageCategoriesModal from './ManageCategoriesModal'
import ManageBrandsModal from './ManageBrandsModal'
import ManageUnitsModal      from './ManageUnitsModal'
import BulkImportModal       from './BulkImportModal'
import BulkAddStockModal     from './BulkAddStockModal'
import VariantFormModal      from './VariantFormModal'
import ProductForm           from './ProductForm'
import ProductDetailModal    from './ProductDetailModal'
import ProductsHeaderActions from './HeaderActions'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, matchesYearMonthFilters, toggleIdSet } from '../../utils/groupedRecords.mjs'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
} from '../../utils/loaders.mjs'
import { getContrastingTextColor } from '../../utils/color.js'

function multiMatch(text, terms) {
  return terms.every(t => text.toLowerCase().includes(t.toLowerCase()))
}

function ThreeDot({ onDetails, onEdit, onDelete, onAddVariant }) {
  return <ThreeDotPortal onDetails={onDetails} onEdit={onEdit} onDelete={onDelete} onAddVariant={onAddVariant} />
}

const CREATED_MONTH_OPTIONS = [
  ['1', 'Jan'],
  ['2', 'Feb'],
  ['3', 'Mar'],
  ['4', 'Apr'],
  ['5', 'May'],
  ['6', 'Jun'],
  ['7', 'Jul'],
  ['8', 'Aug'],
  ['9', 'Sep'],
  ['10', 'Oct'],
  ['11', 'Nov'],
  ['12', 'Dec'],
]

const PRODUCT_JUMP_OFFSET = 88

function getScrollContainer(node) {
  let current = node?.parentElement
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY || '') && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return document.scrollingElement || document.documentElement
}

function scrollNodeWithOffset(node, offset = PRODUCT_JUMP_OFFSET) {
  if (!node) return
  const container = getScrollContainer(node)
  if (!container || container === document.documentElement || container === document.body || container === document.scrollingElement) {
    const top = window.scrollY + node.getBoundingClientRect().top - offset
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
    return
  }
  const containerRect = container.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const top = container.scrollTop + (nodeRect.top - containerRect.top) - offset
  container.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
}

// ?�?� Product detail modal ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

export default function Products() {
  const { t, user, settings, notify, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate, page } = useApp()
  const { syncChannel } = useSync()
  const syncChannelName = String(syncChannel?.channel || '')
  const syncChannelReason = String(syncChannel?.reason || '')
  const syncChannelSource = String(syncChannel?.source || '')
  const syncChannelTs = Number(syncChannel?.ts || 0)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const [products,     setProducts]     = useState([])
  const [categories,   setCategories]   = useState([])
  const [units,        setUnits]        = useState([])
  const [branches,     setBranches]     = useState([])
  const [branchFilter, setBranchFilter] = useState('all')
  const [stockFilter,  setStockFilter]  = useState('all') // all | in_stock | low | out
  const [createdYearFilter, setCreatedYearFilter] = useState('all')
  const [createdMonthFilter, setCreatedMonthFilter] = useState('all')
  const [productSortDirection, setProductSortDirection] = useState('desc')
  const [search,       setSearch]       = useState('')
  const [searchMode,   setSearchMode]   = useState('AND') // 'AND' | 'OR'
  const [selectedIds,    setSelectedIds]    = useState(new Set())
  const [bulkEditOpen,   setBulkEditOpen]   = useState(false)
  const [bulkEditMode,   setBulkEditMode]   = useState(null)  // 'info'|'pricing'|'stock'|'branch'
  const [bulkEditForm,   setBulkEditForm]   = useState({})
  const [catFilter,    setCatFilter]    = useState('all')
  const [brandFilter,  setBrandFilter]  = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [modal,        setModal]        = useState(null)
  const [selected,     setSelected]     = useState(null)
  const [detailProduct,setDetailProduct]= useState(null)
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState(null)
  const [bulkActionBusy, setBulkActionBusy] = useState(false)
  const [variantModal, setVariantModal] = useState(null) // parent product for adding variant
  const [collapsedProductSections, setCollapsedProductSections] = useState(() => new Set())
  const loadedOnceRef = useRef(false)
  const loadRequestRef = useRef(0)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const desktopSelectAllRef = useRef(null)
  const mobileSelectAllRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      window.clearTimeout(loadWatchdogRef.current)
      if (!silent || !loadedOnceRef.current) {
        setLoadError(null)
        setLoading(true)
        loadWatchdogRef.current = window.setTimeout(() => {
          if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
          setLoading(false)
          setLoadError(tr('products_load_slow', 'Products are taking longer than expected. Tap Retry or revisit the page in a moment.'))
        }, 10000)
      }
      try {
        const result = await settleLoaderMap({
          products: () => window.api.getProducts(),
          categories: () => window.api.getCategories(),
          units: () => window.api.getUnits(),
          branches: () => window.api.getBranches(),
        })
        const prods = result.values.products
        const cats = result.values.categories
        const unitList = result.values.units
        const brs = result.values.branches

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        if (Array.isArray(prods)) setProducts(prods)
        if (Array.isArray(cats)) setCategories(cats)
        if (Array.isArray(unitList)) setUnits(unitList)
        if (Array.isArray(brs)) setBranches((brs || []).filter((branch) => branch.is_active))

        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, tr('products_load_failed', 'Failed to load products')))
        }
        loadedOnceRef.current = true
        setLoadError(null)
        if (result.hasErrors && !silent) {
          notify(t('products_partial_load') || 'Some product data is still catching up. The page will keep refreshing as data arrives.', 'warning')
        }
      } catch (e) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const nextMessage = e?.message || tr('products_load_failed', 'Failed to load products')
        if (!loadedOnceRef.current) {
          setLoadError(nextMessage)
          notify(nextMessage, 'error')
        } else if (!silent) {
          notify(tr('products_refresh_failed', 'Unable to refresh products right now. Showing the latest loaded data.'), 'warning')
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        setLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) {
        loadPromiseRef.current = null
      }
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [notify, t, tr])

  useEffect(() => {
    if (page !== 'products') {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      return
    }
    const silent = loadedOnceRef.current
    load(silent)
  }, [load, page])
  useEffect(() => {
    if (page !== 'products' || !syncChannelTs) return
    if (syncChannelReason === 'cache-refresh') {
      const sourceTable = syncChannelSource.split(':')[0]
      if (['products', 'categories', 'units', 'branches'].includes(sourceTable)) return
    }
    if (['products', 'categories', 'units', 'branches'].includes(syncChannelName)) load(true)
  }, [load, page, syncChannelName, syncChannelReason, syncChannelSource, syncChannelTs])
  useEffect(() => () => {
    window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const handleSave = async (form) => {
    if (!form.name?.trim()) return notify(t('name') + ' required', 'error')
    try {
      const data = { ...form, userId: user.id, userName: user.name }

      if (!selected) {
        const res = await window.api.createProduct(data)
        if (!res?.success) return notify(res?.error || 'Failed to create product', 'error')
      } else {
        const res = await window.api.updateProduct(selected.id, data, user.id, user.name)
        if (res?.success === false) return notify(res.error || 'Failed to update product', 'error')
      }

      notify(selected ? t('product_updated') || 'Product updated' : t('product_created') || 'Product created')
      setModal(null); setSelected(null); setDetailProduct(null); load()
    } catch(e) {
      console.error('[handleSave] error:', e)
      notify(e.message || 'Failed to save product', 'error')
    }
  }

  const normalizeGallery = (value, fallback = null) => {
    const input = Array.isArray(value) ? value : []
    const seen = new Set()
    const list = []
    for (const entry of input) {
      const path = String(entry || '').trim()
      if (!path || seen.has(path)) continue
      seen.add(path)
      list.push(path)
      if (list.length >= 5) break
    }
    const fallbackValue = String(fallback || '').trim()
    if (!list.length && fallbackValue) list.push(fallbackValue)
    return list.slice(0, 5)
  }

  const uploadGalleryImages = async (productId, gallery = []) => {
    const next = []
    for (const entry of normalizeGallery(gallery)) {
      if (!entry.startsWith('data:image/')) {
        next.push(entry)
        continue
      }
      const ext = entry.startsWith('data:image/png')
        ? '.png'
        : entry.startsWith('data:image/webp')
          ? '.webp'
          : entry.startsWith('data:image/gif')
            ? '.gif'
            : '.jpg'
      const fileName = `product_${productId || 'new'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
      const uploaded = await window.api.uploadProductImage({ productId, filePath: entry, fileName })
      if (!uploaded?.path) throw new Error(uploaded?.error || 'Image upload failed')
      next.push(uploaded.path)
    }
    return normalizeGallery(next)
  }

  const handleSaveWithGallery = async (form) => {
    if (!form.name?.trim()) return notify(t('name') + ' required', 'error')
    try {
      const galleryInput = normalizeGallery(form.image_gallery, form.image_path || null)
      const uploadedGallery = await uploadGalleryImages(selected?.id || null, galleryInput)
      const payload = {
        ...form,
        image_gallery: uploadedGallery,
        image_path: uploadedGallery[0] || null,
        userId: user.id,
        userName: user.name,
      }

      if (!selected) {
        const res = await window.api.createProduct(payload)
        if (!res?.success) return notify(res?.error || 'Failed to create product', 'error')
      } else {
        const res = await window.api.updateProduct(selected.id, payload, user.id, user.name)
        if (res?.success === false) return notify(res.error || 'Failed to update product', 'error')
      }

      notify(selected ? t('product_updated') || 'Product updated' : t('product_created') || 'Product created')
      setModal(null)
      setSelected(null)
      setDetailProduct(null)
      load()
    } catch (e) {
      console.error('[handleSaveWithGallery] error:', e)
      notify(e.message || 'Failed to save product', 'error')
    }
  }

  const handleBulkDelete = async () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    if (!confirm(`Delete ${selectedVisibleCount} product${selectedVisibleCount > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkActionBusy(true)
    let failed = 0
    let done = 0
    try {
      for (const id of selectedVisibleIds) {
        try {
          const result = await window.api.deleteProduct(id)
          if (result?.success === false) throw new Error(result.error || 'Failed to delete product')
          done++
        } catch {
          failed++
        }
      }
      setSelectedIds(new Set())
      await load(true)
      if (failed) notify(`Deleted ${done}, ${failed} failed`, 'warning')
      else notify(`${done} product${done > 1 ? 's' : ''} deleted`)
    } finally {
      setBulkActionBusy(false)
    }
  }

  const handleBulkOutOfStock = async () => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    if (!confirm(`Set ${selectedVisibleCount} product(s) to out-of-stock (quantity = 0)?`)) return
    setBulkActionBusy(true)
    let done = 0
    let failed = 0
    try {
      for (const id of selectedVisibleIds) {
        try {
          const result = await window.api.updateProduct(id, { stock_quantity: 0, userId: user.id, userName: user.name })
          if (result?.success === false) throw new Error(result.error || 'Failed to update product')
          done++
        } catch {
          failed++
        }
      }
      setSelectedIds(new Set())
      await load(true)
      notify(
        failed
          ? `${done} product(s) set to out-of-stock, ${failed} failed`
          : `${done} product(s) set to out-of-stock`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }

  const handleBulkChangeBranch = async (branchId) => {
    if (!selectedVisibleIds.length || !branchId || bulkActionBusy) return
    const branch = branches.find(b => String(b.id) === String(branchId))
    if (!branch) return
    if (!confirm(`Move stock of ${selectedVisibleCount} product(s) to "${branch.name}"?`)) return
    setBulkActionBusy(true)
    let done = 0
    let failed = 0
    try {
      for (const id of selectedVisibleIds) {
        const p = products.find(x => x.id === id)
        if (!p) continue
        try {
          const currentBranch = (p.branch_stock||[]).find(bs => (bs?.quantity ?? 0) > 0)
          if (currentBranch && currentBranch.branch_id !== parseInt(branchId) && (currentBranch?.quantity ?? 0) > 0) {
            await window.api.transferStock({
              fromBranchId: currentBranch.branch_id,
              toBranchId: parseInt(branchId),
              productId: id, productName: p.name,
              quantity: currentBranch.quantity,
              note: 'Bulk branch change',
              userId: user.id, userName: user.name,
            })
          } else if (!currentBranch) {
            await window.api.adjustStock({
              productId: id, productName: p.name, type: 'add', quantity: 0,
              branchId: parseInt(branchId), userId: user.id, userName: user.name,
            })
          }
          done++
        } catch {
          failed++
        }
      }
      setSelectedIds(new Set())
      await load(true)
      notify(
        failed
          ? `${done} product(s) moved to "${branch.name}", ${failed} failed`
          : `${done} product(s) branch updated to "${branch.name}"`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }

  const [bulkAddModal, setBulkAddModal] = useState(null)
  const handleBulkAddStock = () => {
    if (!selectedVisibleIds.length) return
    setBulkAddModal({ ids: [...selectedVisibleIds] })
  }

  const toggleSelect = (id) => setSelectedIds((prev) => {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return prev
    const n = new Set(prev)
    n.has(numericId) ? n.delete(numericId) : n.add(numericId)
    return n
  })
  const toggleSelectAll = (checked) => {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(visibleIds))
  }
  const handleDelete = async (p) => {
    if (!confirm(`${t('confirm_delete')} "${p.name}"?`)) return
    try {
      await window.api.deleteProduct(p.id, user.id, user.name)
      notify('Product deleted'); setDetailProduct(null); load()
    } catch(e) { notify(e.message || 'Failed', 'error') }
  }

  const catMap = Object.fromEntries(categories.map(c => [c.name, c]))
  const unitMap = Object.fromEntries(units.map(unit => [unit.name, unit]))
  const brandOptions = useMemo(() => {
    const fromProducts = products
      .map((product) => String(product?.brand || '').trim())
      .filter(Boolean)
    let fromSettings = []
    try {
      const parsed = JSON.parse(settings?.product_brand_options || '[]')
      if (Array.isArray(parsed)) {
        fromSettings = parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
      }
    } catch (_) {}
    return Array.from(new Set([...fromProducts, ...fromSettings])).sort((a, b) => a.localeCompare(b))
  }, [products, settings?.product_brand_options])
  const [lightbox, setLightbox] = useState(null)
  const availableCreatedYears = useMemo(
    () => getAvailableYears(products, (product) => product?.created_at),
    [products],
  )
  const productTimeMode = useMemo(
    () => getTimeGroupingMode(createdYearFilter, createdMonthFilter),
    [createdMonthFilter, createdYearFilter],
  )

  const resolveImageUrl = (src) => {
    const raw = String(src || '').trim()
    if (!raw) return ''
    if (raw.startsWith('http') || raw.startsWith('data:') || raw.startsWith('blob:')) return raw
    if (raw.startsWith('/uploads/')) {
      const base = (window.api?.getSyncServerUrl?.()) || localStorage.getItem('businessos_sync_server') || ''
      return base ? `${base.replace(/\/$/, '')}${raw}` : raw
    }
    return raw
  }

  const getProductGallery = (product) => normalizeGallery(product?.image_gallery, product?.image_path || null)
  const renderUnitChip = (unitName) => {
    if (!unitName) return null
    const color = unitMap[unitName]?.color
    if (!color) return <span className="ml-1 text-xs font-normal text-gray-400">{unitName}</span>
    return (
      <span
        className="ml-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ background: color, color: getContrastingTextColor(color) }}
      >
        {unitName}
      </span>
    )
  }

  const openLightbox = (gallery, startIndex = 0, title = '') => {
    const list = normalizeGallery(gallery).map(resolveImageUrl).filter(Boolean)
    if (!list.length) return
    const index = Math.max(0, Math.min(startIndex, list.length - 1))
    setLightbox({ images: list, index, title })
  }

  // Define helper functions before using them in filters
  const getBranchQty = useCallback((p, branchId) => (
    p.branch_stock || []
  ).find((stock) => String(stock.branch_id) === String(branchId))?.quantity ?? 0, [])
  const getStockBadge = (p) => {
    const qty = branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity
    if (qty<=(p.out_of_stock_threshold||0)) return <span className="badge-red">{t('out_of_stock')}</span>
    if (qty<=(p.low_stock_threshold||10))   return <span className="badge-yellow">{t('low_stock')}</span>
    return <span className="badge-green">{t('in_stock')}</span>
  }

  // Search: comma-separated terms. Mode AND = all terms must match. Mode OR = any term matches.
  // Spaces within a term are treated as part of the search string (no space=AND split).
  const searchTerms = useMemo(
    () => (search.trim()
      ? search.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
      : []),
    [search],
  )
  const filtered = useMemo(() => products.filter((p) => {
    const hay = `${p.name} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''} ${p.brand || ''} ${p.supplier || ''} ${p.description || ''}`.toLowerCase()
    const matchSearch = searchTerms.length === 0 || (
      searchMode === 'AND'
        ? searchTerms.every((term) => hay.includes(term))
        : searchTerms.some((term) => hay.includes(term))
    )
    const matchCat = catFilter === 'all' || p.category === catFilter
    const matchBrand = brandFilter === 'all' || (p.brand || '').toLowerCase() === brandFilter.toLowerCase()
    const matchBranch = branchFilter === 'all' || (p.branch_stock || []).some((bs) => String(bs.branch_id) === branchFilter)
    const matchSupplier = supplierFilter === 'all' || (p.supplier || '').toLowerCase() === supplierFilter.toLowerCase()
    const matchCreated = matchesYearMonthFilters(p.created_at, { year: createdYearFilter, month: createdMonthFilter })
    const qty = branchFilter !== 'all' ? getBranchQty(p, branchFilter) : p.stock_quantity

    if (branchFilter !== 'all' && stockFilter !== 'out' && qty <= (p.out_of_stock_threshold || 0)) return false

    const matchStock =
      stockFilter === 'all' ? true
        : stockFilter === 'out' ? qty <= (p.out_of_stock_threshold || 0)
          : stockFilter === 'low' ? qty > (p.out_of_stock_threshold || 0) && qty <= (p.low_stock_threshold || 10)
            : stockFilter === 'in_stock' ? qty > (p.low_stock_threshold || 10)
              : true
    return matchSearch && matchCat && matchBrand && matchBranch && matchSupplier && matchCreated && matchStock
  }), [brandFilter, branchFilter, catFilter, createdMonthFilter, createdYearFilter, getBranchQty, products, searchMode, searchTerms, stockFilter, supplierFilter])

  const exportProductsCsv = useCallback((rowsToExport = filtered, filePrefix = 'products') => {
    const toImageName = (value) => String(value || '').split(/[\\/]/).pop() || ''
    const toImageUrl = (value) => String(value || '').trim()
    const rows = rowsToExport.map((p) => ({
      Name: p.name || '', SKU: p.sku || '', Barcode: p.barcode || '',
      Category: p.category || '', Brand: p.brand || '', Unit: p.unit || '', Description: p.description || '',
      Created_At: p.created_at || '',
      Selling_Price_USD: p.selling_price_usd || 0, Selling_Price_KHR: p.selling_price_khr || 0,
      Purchase_Price_USD: p.purchase_price_usd || 0, Purchase_Price_KHR: p.purchase_price_khr || 0, Stock_Quantity: p.stock_quantity || 0,
      Low_Stock_Threshold: p.low_stock_threshold || 0, Supplier: p.supplier || '',
      Image_Filename_1: toImageName((p.image_gallery || [])[0] || p.image_path || ''),
      Image_Filename_2: toImageName((p.image_gallery || [])[1] || ''),
      Image_Filename_3: toImageName((p.image_gallery || [])[2] || ''),
      Image_Filename_4: toImageName((p.image_gallery || [])[3] || ''),
      Image_Filename_5: toImageName((p.image_gallery || [])[4] || ''),
      Image_URL_1: toImageUrl((p.image_gallery || [])[0] || p.image_path || ''),
      Image_URL_2: toImageUrl((p.image_gallery || [])[1] || ''),
      Image_URL_3: toImageUrl((p.image_gallery || [])[2] || ''),
      Image_URL_4: toImageUrl((p.image_gallery || [])[3] || ''),
      Image_URL_5: toImageUrl((p.image_gallery || [])[4] || ''),
      Image_Filenames: (p.image_gallery || []).map((entry) => toImageName(entry)).filter(Boolean).join('|'),
      Image_URLs: (p.image_gallery || []).map((entry) => toImageUrl(entry)).filter(Boolean).join('|'),
      Image_Conflict_Mode: '',
      Branch: (() => {
        const primary = (p.branch_stock || []).find(bs => (bs.quantity || 0) > 0)
        return primary?.branch_name || ''
      })(),
      Branch_Stock_JSON: JSON.stringify((p.branch_stock || []).map(bs => ({
        branch_id: bs.branch_id,
        branch_name: bs.branch_name,
        quantity: bs.quantity || 0,
      }))),
      Parent_ID: p.parent_id || '',
      Is_Group: p.is_group ? 'Yes' : 'No',
      Active: p.is_active ? 'Yes' : 'No',
    }))
    downloadCSV(`${filePrefix}-${new Date().toISOString().slice(0,10)}.csv`, rows)
  }, [filtered])

  const productSections = useMemo(() => buildTimeActionSections(filtered, {
    getDate: (product) => product?.created_at,
    getItemId: (product) => Number(product?.id),
    getActionKey: () => 'products',
    getActionLabel: () => 'Products',
    year: createdYearFilter,
    month: createdMonthFilter,
    timeMode: productTimeMode,
    groupMode: 'time',
    sortDirection: productSortDirection,
  }).map((section) => ({
    ...section,
    items: [...section.groups.flatMap((group) => group.items)].sort((left, right) => {
      const nameDelta = String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' })
      if (nameDelta !== 0) return nameDelta
      return Number(left?.id || 0) - Number(right?.id || 0)
    }),
  })), [createdMonthFilter, createdYearFilter, filtered, productSortDirection, productTimeMode])

  const visibleProducts = useMemo(
    () => productSections.flatMap((section) => section.items),
    [productSections],
  )

  const visibleIds = useMemo(
    () => visibleProducts.map((product) => Number(product.id)).filter((id) => Number.isFinite(id)),
    [visibleProducts],
  )
  const visibleIdsSignature = useMemo(() => visibleIds.join(','), [visibleIds])
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIdsSignature])
  const selectedVisibleIds = useMemo(
    () => [...selectedIds].filter((id) => visibleIdSet.has(Number(id))),
    [selectedIds, visibleIdSet],
  )
  const selectedVisibleIdsSet = useMemo(
    () => new Set(selectedVisibleIds),
    [selectedVisibleIds],
  )
  const selectedVisibleCount = selectedVisibleIds.length

  const selectedProducts = useMemo(
    () => visibleProducts.filter((product) => selectedVisibleIdsSet.has(Number(product.id))),
    [selectedVisibleIdsSet, visibleProducts],
  )
  const jumpTargetIdsByLetter = useMemo(() => {
    const targets = new Map()
    productSections.forEach((section) => {
      if (collapsedProductSections.has(section.id)) return
      section.items.forEach((product) => {
        const letter = String(product?.name || '').trim().charAt(0).toUpperCase()
        if (!/[A-Z]/.test(letter) || targets.has(letter)) return
        targets.set(letter, Number(product.id))
      })
    })
    return targets
  }, [collapsedProductSections, productSections])
  const visibleLetters = useMemo(
    () => [...jumpTargetIdsByLetter.keys()].sort((left, right) => left.localeCompare(right)),
    [jumpTargetIdsByLetter],
  )
  const hasSelected = selectedVisibleCount > 0

  useEffect(() => {
    setCollapsedProductSections((current) => {
      const validIds = new Set(productSections.map((section) => section.id))
      const next = new Set([...current].filter((id) => validIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [productSections])

  useEffect(() => {
    const indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length
    if (desktopSelectAllRef.current) desktopSelectAllRef.current.indeterminate = indeterminate
    if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = indeterminate
  }, [selectedVisibleCount, visibleIds.length])

  const toggleSelectionScope = useCallback((ids, checked) => {
    setSelectedIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const isSelectionScopeFullySelected = useCallback(
    (ids = []) => ids.length > 0 && ids.every((id) => selectedVisibleIdsSet.has(Number(id))),
    [selectedVisibleIdsSet],
  )

  const isSelectionScopePartiallySelected = useCallback(
    (ids = []) => ids.some((id) => selectedVisibleIdsSet.has(Number(id))) && !isSelectionScopeFullySelected(ids),
    [isSelectionScopeFullySelected, selectedVisibleIdsSet],
  )
  const isProductSelected = useCallback(
    (id) => selectedVisibleIdsSet.has(Number(id)),
    [selectedVisibleIdsSet],
  )

  const productExportItems = useMemo(() => ([
    { label: tr('export_visible_products', 'Export visible products', 'នាំចេញផលិតផលដែលកំពុងបង្ហាញ'), onClick: () => exportProductsCsv(filtered, 'products-visible') },
    selectedProducts.length ? { label: tr('export_selected_products', 'Export selected products', 'នាំចេញផលិតផលដែលបានជ្រើស'), onClick: () => exportProductsCsv(selectedProducts, 'products-selected'), color: 'blue' } : null,
    stockFilter !== 'all' ? { label: tr('export_filtered_stock_state', 'Export filtered stock state', 'នាំចេញតាមស្ថានភាពស្តុកដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, `products-${stockFilter}`) } : null,
    catFilter !== 'all' ? { label: tr('export_filtered_category', 'Export filtered category', 'នាំចេញតាមប្រភេទដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, 'products-category') } : null,
    brandFilter !== 'all' ? { label: tr('export_filtered_brand', 'Export filtered brand', 'នាំចេញតាមម៉ាកដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, 'products-brand') } : null,
    supplierFilter !== 'all' ? { label: tr('export_filtered_supplier', 'Export filtered supplier', 'នាំចេញតាមអ្នកផ្គត់ផ្គង់ដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, 'products-supplier') } : null,
    branchFilter !== 'all' ? { label: tr('export_filtered_branch', 'Export filtered branch', 'នាំចេញតាមសាខាដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, 'products-branch') } : null,
    createdYearFilter !== 'all' || createdMonthFilter !== 'all' ? { label: tr('export_filtered_created_time', 'Export filtered created-time range', 'នាំចេញតាមពេលបង្កើតដែលបានតម្រង'), onClick: () => exportProductsCsv(filtered, 'products-created-filter') } : null,
    'divider',
    { label: tr('export_full_product_list', 'Export full product list', 'នាំចេញបញ្ជីផលិតផលទាំងមូល'), onClick: () => exportProductsCsv(products, 'products-all'), color: 'green' },
  ].filter(Boolean)), [brandFilter, branchFilter, catFilter, createdMonthFilter, createdYearFilter, exportProductsCsv, filtered, products, selectedProducts, stockFilter, supplierFilter, tr])

  const suppliers = useMemo(
    () => [...new Set(products.map((product) => product.supplier).filter(Boolean))].sort(),
    [products],
  )

  const activeFilters = [
    catFilter !== 'all' ? 1 : 0,
    brandFilter !== 'all' ? 1 : 0,
    branchFilter !== 'all' ? 1 : 0,
    supplierFilter !== 'all' ? 1 : 0,
    stockFilter !== 'all' ? 1 : 0,
    createdYearFilter !== 'all' ? 1 : 0,
    createdMonthFilter !== 'all' ? 1 : 0,
    productSortDirection !== 'desc' ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0)

  const clearAllFilters = useCallback(() => {
    setCatFilter('all')
    setBrandFilter('all')
    setBranchFilter('all')
    setSupplierFilter('all')
    setStockFilter('all')
    setCreatedYearFilter('all')
    setCreatedMonthFilter('all')
    setProductSortDirection('desc')
  }, [])

  const toggleProductSection = useCallback((sectionId) => {
    setCollapsedProductSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const jumpToLetter = useCallback((letter) => {
    const targetId = jumpTargetIdsByLetter.get(String(letter || '').toUpperCase())
    if (!targetId) return
    const nodes = Array.from(document.querySelectorAll(`[data-product-jump-id="${targetId}"]`))
    const node = nodes.find((entry) => entry.getClientRects().length > 0) || nodes[0]
    scrollNodeWithOffset(node)
  }, [jumpTargetIdsByLetter])

  const runBulkProductUpdates = useCallback(async (updates) => {
    if (!selectedVisibleIds.length || bulkActionBusy) return
    const nextUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    )
    if (!Object.keys(nextUpdates).length) {
      notify('No changes specified', 'warning')
      return
    }
    setBulkActionBusy(true)
    let done = 0
    let failed = 0
    try {
      for (const id of selectedVisibleIds) {
        try {
          const result = await window.api.updateProduct(id, { ...nextUpdates, userId: user.id, userName: user.name })
          if (result?.success === false) throw new Error(result.error || 'Failed to update product')
          done++
        } catch {
          failed++
        }
      }
      setSelectedIds(new Set())
      setBulkEditMode(null)
      setBulkEditForm({})
      await load(true)
      notify(
        failed
          ? `Updated ${done} products, ${failed} failed`
          : `Updated ${done} products`,
        failed ? 'warning' : 'success',
      )
    } finally {
      setBulkActionBusy(false)
    }
  }, [bulkActionBusy, load, notify, selectedVisibleIds, user.id, user.name])

  const productFilterSections = useMemo(() => ([
    {
      id: 'stock',
      label: t('stock_status') || 'Stock status',
      options: [
        { id: 'stock-all', label: t('all') || 'All', active: stockFilter === 'all', onClick: () => setStockFilter('all') },
        { id: 'stock-in', label: t('in_stock') || 'In Stock', active: stockFilter === 'in_stock', onClick: () => setStockFilter('in_stock') },
        { id: 'stock-low', label: t('low_stock') || 'Low', active: stockFilter === 'low', onClick: () => setStockFilter('low') },
        { id: 'stock-out', label: t('out_of_stock') || 'Out', active: stockFilter === 'out', onClick: () => setStockFilter('out') },
      ],
    },
    categories.length ? {
      id: 'category',
      label: t('category') || 'Category',
      options: [
        { id: 'cat-all', label: t('all') || 'All', active: catFilter === 'all', onClick: () => setCatFilter('all') },
        ...categories.map((category) => ({
          id: `cat-${category.id}`,
          label: category.name,
          active: catFilter === category.name,
          onClick: () => setCatFilter(catFilter === category.name ? 'all' : category.name),
        })),
      ],
    } : null,
    brandOptions.length ? {
      id: 'brand',
      label: t('brand') || 'Brand',
      options: [
        { id: 'brand-all', label: t('all_brands') || 'All Brands', active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
        ...brandOptions.map((brand) => ({
          id: `brand-${brand}`,
          label: brand,
          active: brandFilter === brand,
          onClick: () => setBrandFilter(brandFilter === brand ? 'all' : brand),
        })),
      ],
    } : null,
    branches.length > 1 ? {
      id: 'branch',
      label: t('branch') || 'Branch',
      options: [
        { id: 'branch-all', label: t('all') || 'All', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
        ...branches.map((branch) => ({
          id: `branch-${branch.id}`,
          label: branch.name,
          active: branchFilter === String(branch.id),
          onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
        })),
      ],
    } : null,
    suppliers.length ? {
      id: 'supplier',
      label: t('supplier') || 'Supplier',
      options: [
        { id: 'supplier-all', label: t('suppliers') || 'All Suppliers', active: supplierFilter === 'all', onClick: () => setSupplierFilter('all') },
        ...suppliers.map((supplier) => ({
          id: `supplier-${supplier}`,
          label: supplier,
          active: supplierFilter === supplier,
          onClick: () => setSupplierFilter(supplierFilter === supplier ? 'all' : supplier),
        })),
      ],
    } : null,
    availableCreatedYears.length ? {
      id: 'created-year',
      label: t('year') || 'Year',
      options: [
        { id: 'created-year-all', label: t('all') || 'All', active: createdYearFilter === 'all', onClick: () => { setCreatedYearFilter('all'); setCreatedMonthFilter('all') } },
        ...availableCreatedYears.map((year) => ({
          id: `created-year-${year}`,
          label: String(year),
          active: createdYearFilter === String(year),
          onClick: () => {
            const nextYear = createdYearFilter === String(year) ? 'all' : String(year)
            setCreatedYearFilter(nextYear)
            if (nextYear === 'all') setCreatedMonthFilter('all')
          },
        })),
      ],
    } : null,
    {
      id: 'created-month',
      label: t('month') || 'Month',
      options: [
        { id: 'created-month-all', label: t('all') || 'All', active: createdMonthFilter === 'all', onClick: () => setCreatedMonthFilter('all') },
        ...CREATED_MONTH_OPTIONS.map(([value, label]) => ({
          id: `created-month-${value}`,
          label,
          active: createdMonthFilter === value,
          onClick: () => setCreatedMonthFilter(createdMonthFilter === value ? 'all' : value),
        })),
      ],
    },
    {
      id: 'sort',
      label: t('sort') || 'Sort',
      options: [
        { id: 'created-desc', label: t('newest_first') || 'Newest first', active: productSortDirection === 'desc', onClick: () => setProductSortDirection('desc') },
        { id: 'created-asc', label: t('oldest_first') || 'Oldest first', active: productSortDirection === 'asc', onClick: () => setProductSortDirection('asc') },
      ],
    },
  ].filter(Boolean)), [availableCreatedYears, branches, brandFilter, brandOptions, catFilter, categories, createdMonthFilter, createdYearFilter, productSortDirection, stockFilter, supplierFilter, suppliers, t])

  if (loadError && !loading && !products.length && !categories.length && !units.length && !branches.length) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">!</div>
      <p className="text-red-600 dark:text-red-400 font-medium">{loadError}</p>
      <button type="button" onClick={() => load(false)} className="btn-primary">Retry</button>
    </div>
  )

  return (
    <div className="page-scroll p-3 sm:p-6">
      {/* ?�?� Single-row header ??compact on mobile, expanded on desktop ?�?� */}
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h1 className="mr-1 flex min-w-0 flex-1 items-center gap-2 truncate text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
          <PackageSearch className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
          <span className="truncate">{t('products')}</span>
        </h1>
        <div className="w-full min-w-0 overflow-x-auto pb-1 sm:ml-auto sm:w-auto sm:flex-shrink-0 sm:pb-0">
          <ProductsHeaderActions
            onManageCats={()=>setModal('cats')}
            onManageBrands={()=>setModal('brands')}
            onManageUnits={()=>setModal('units')}
            onImport={()=>setModal('bulk')}
            onExport={() => exportProductsCsv(filtered)}
            exportMenuItems={productExportItems}
            onAdd={()=>{setSelected(null);setModal('form')}}
            t={t}
          />
        </div>
      </div>

      {/* ?�?� Search row + Filter toggle ?�?� */}
      <div className="mb-3 overflow-x-auto pb-1">
        <div className="flex min-w-[19.5rem] items-center gap-1.5 sm:min-w-0">
          <input
            className="input min-w-0 flex-1 text-sm"
            placeholder={t('search_products_placeholder') || `${t('search') || 'Search'} products`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
            {['AND', 'OR'].map((mode) => (
              <button
                key={mode}
                onClick={() => setSearchMode(mode)}
                className={`min-w-[2.9rem] px-2 py-1.5 text-xs font-bold transition-colors ${searchMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400'}`}
              >
                {mode}
              </button>
            ))}
          </div>
          <FilterMenu
            label={t('filters') || 'Filters'}
            activeCount={activeFilters}
            sections={productFilterSections}
            onClear={clearAllFilters}
            compact
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {hasSelected && (
        <div className="sticky top-2 z-30 mb-2 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/95 shadow-sm backdrop-blur dark:border-blue-700 dark:bg-blue-900/40">
          {/* Primary action row */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
            <span className="mr-1 w-full text-sm font-semibold text-blue-700 dark:text-blue-300 sm:w-auto">{selectedVisibleCount} selected</span>
            {/* Collapsible edit options */}
            {[
              { id:'info', icon:'Edit', label:'Edit Info' },
              { id:'pricing', icon:'Price', label:'Pricing' },
              { id:'stock', icon:'Stock', label:'Stock' },
              { id:'branch', icon:'Branch', label:'Branch' },
            ].map(opt => (
              <button key={opt.id}
                disabled={bulkActionBusy}
                onClick={() => { setBulkEditMode(bulkEditMode===opt.id?null:opt.id); setBulkEditOpen(true); setBulkEditForm({}) }}
                className={`text-xs py-1.5 px-3 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${bulkEditMode===opt.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-zinc-600 hover:border-blue-400'}`}>
                {opt.icon} {opt.label}
              </button>
            ))}
            <button disabled={bulkActionBusy} onClick={handleBulkOutOfStock} className="btn-secondary text-xs py-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-60">Out of Stock</button>
            <button disabled={bulkActionBusy} onClick={handleBulkDelete} className="btn-danger text-xs py-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-60">Delete</button>
            <button disabled={bulkActionBusy} onClick={() => { setSelectedIds(new Set()); setBulkEditMode(null) }} className="text-xs text-blue-500 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-400 sm:ml-auto">Clear</button>
          </div>

          {/* Expanded edit panel */}
          {bulkEditMode === 'info' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Update basic info for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><label className="text-xs text-gray-500 block mb-1">Category</label>
                  <select className="input text-xs py-1" value={bulkEditForm.category||''} onChange={e=>setBulkEditForm(f=>({...f,category:e.target.value}))}>
                    <option value="">Keep current</option>
                    {categories.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 block mb-1">Unit</label>
                  <select className="input text-xs py-1" value={bulkEditForm.unit||''} onChange={e=>setBulkEditForm(f=>({...f,unit:e.target.value}))}>
                    <option value="">Keep current</option>
                    {units.map(u=><option key={u.id} value={u.name}>{u.name}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-gray-500 block mb-1">Supplier</label>
                  <input className="input text-xs py-1" value={bulkEditForm.supplier||''} onChange={e=>setBulkEditForm(f=>({...f,supplier:e.target.value}))} placeholder="Leave blank to keep" />
                </div>
                <div><label className="text-xs text-gray-500 block mb-1">{t('brand')||'Brand'}</label>
                  <input className="input text-xs py-1" value={bulkEditForm.brand||''} onChange={e=>setBulkEditForm(f=>({...f,brand:e.target.value}))} placeholder="Leave blank to keep" />
                </div>
                <div className="flex gap-2 items-center mt-1">
                  <label className="text-xs text-gray-500">Low Stock Threshold</label>
                  <input className="input text-xs py-1 w-20" type="number" min="0" value={bulkEditForm.low_stock_threshold??''} onChange={e=>setBulkEditForm(f=>({...f,low_stock_threshold:e.target.value}))} placeholder="Keep" />
                </div>
              </div>
              <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={async () => {
                const updates = {}
                if (bulkEditForm.category) updates.category = bulkEditForm.category
                if (bulkEditForm.unit) updates.unit = bulkEditForm.unit
                if (bulkEditForm.supplier) updates.supplier = bulkEditForm.supplier
                if (bulkEditForm.brand) updates.brand = bulkEditForm.brand
                if (bulkEditForm.low_stock_threshold !== undefined && bulkEditForm.low_stock_threshold !== '') updates.low_stock_threshold = parseInt(bulkEditForm.low_stock_threshold)
                await runBulkProductUpdates(updates)
              }}>Apply to {selectedVisibleCount} products</button>
            </div>
          )}

          {bulkEditMode === 'pricing' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Update pricing for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500 block mb-1">Selling Price (USD)</label>
                  <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
                <div><label className="text-xs text-gray-500 block mb-1">Purchase Price (USD)</label>
                  <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.purchase_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,purchase_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
              </div>
              <p className="text-xs text-gray-400 mt-1">KHR prices will auto-calculate at current exchange rate</p>
              <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={async () => {
                const updates = {}
                if (bulkEditForm.selling_price_usd !== '' && bulkEditForm.selling_price_usd !== undefined) updates.selling_price_usd = parseFloat(bulkEditForm.selling_price_usd)
                if (bulkEditForm.purchase_price_usd !== '' && bulkEditForm.purchase_price_usd !== undefined) updates.purchase_price_usd = parseFloat(bulkEditForm.purchase_price_usd)
                await runBulkProductUpdates(updates)
              }}>Apply to {selectedVisibleCount} products</button>
            </div>
          )}

          {bulkEditMode === 'stock' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Adjust stock for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="flex gap-3 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">Quantity</label>
                  <input className="input text-xs py-1 w-24" type="number" min="0" value={bulkEditForm.qty??1} onChange={e=>setBulkEditForm(f=>({...f,qty:e.target.value}))} /></div>
                <div><label className="text-xs text-gray-500 block mb-1">Action</label>
                  <div className="flex gap-1">
                    {[['add', t('add') || 'Add'],['remove', t('remove') || 'Remove'],['set', `= ${t('set')||'Set'}`]].map(([v,l])=>(
                    <button key={v} onClick={()=>setBulkEditForm(f=>({...f,action:v}))} className={`text-xs py-1.5 px-2.5 rounded-lg border font-medium ${(bulkEditForm.action||'add')===v?'bg-blue-600 text-white border-blue-600':'bg-white dark:bg-zinc-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-zinc-600'}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <button disabled={bulkActionBusy} className="btn-primary mt-3 px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={handleBulkAddStock}>Apply to {selectedVisibleCount} products</button>
            </div>
          )}

          {bulkEditMode === 'branch' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Move stock to a branch for <strong>{selectedVisibleCount}</strong> products</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">Target Branch</label>
                  <select className="input text-xs py-1" value={bulkEditForm.branchId||''} onChange={e=>setBulkEditForm(f=>({...f,branchId:e.target.value}))}>
                    <option value="">Select branch</option>
                    {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <button disabled={bulkActionBusy} className="btn-primary px-4 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { if (bulkEditForm.branchId) { handleBulkChangeBranch(bulkEditForm.branchId) } else notify('Select a branch first','error') }}>Move Stock</button>
              </div>
            </div>
          )}
        </div>
      )}

      {visibleLetters.length ? (
        <div className="fixed right-0.5 top-1/2 z-20 flex -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white/95 px-1 py-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
          {visibleLetters.map((letter) => (
            <button
              key={letter}
              type="button"
              className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-semibold text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-blue-300"
              onClick={() => jumpToLetter(letter)}
              title={`Jump to ${letter}`}
            >
              {letter}
            </button>
          ))}
        </div>
      ) : null}

      {/* Desktop table */}
      <div className="card sm:flex-1 sm:overflow-hidden flex-col hidden sm:flex">
        <div className="overflow-auto sm:flex-1">
          <table className="w-full text-sm table-bordered">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input type="checkbox"
                    className="rounded"
                    checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
                    ref={desktopSelectAllRef}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                  />
                </th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold w-16">Image</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('product_name')}</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold hidden lg:table-cell">{t('sku')}</th>
                <th className="text-left px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold hidden md:table-cell">{t('category')}</th>
                <th className="text-right px-3 py-3 text-red-600 dark:text-red-400 font-semibold col-highlight-red">{t('cost_in_purchase')}</th>
                <th className="text-right px-3 py-3 text-green-600 dark:text-green-400 font-semibold col-highlight-green">{t('selling_price_label')}</th>
                <th className="text-right px-3 py-3 text-blue-600 dark:text-blue-400 font-semibold hidden lg:table-cell">{t('margin')}</th>
                <th className="text-right px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('stock')}</th>
                <th className="text-center px-3 py-3 text-gray-600 dark:text-gray-400 font-semibold">{t('status')}</th>
                <th className="w-10 px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
              : visibleProducts.length === 0 ? <tr><td colSpan={11} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
              : productSections.map((section) => {
                const isCollapsed = collapsedProductSections.has(section.id)
                return (
                <Fragment key={section.id}>
                  <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                    <td colSpan={11} className="px-4 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isSelectionScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                            aria-label={`Select ${section.label}`}
                          />
                          <span>{section.label}</span>
                          <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                        </label>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                          onClick={() => toggleProductSection(section.id)}
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed ? section.items.map(p => {
                const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
                const purchaseKhr = p.purchase_price_khr || p.cost_price_khr || 0
                const marginUsd   = p.selling_price_usd - purchaseUsd
                const marginPct   = p.selling_price_usd > 0 ? (marginUsd / p.selling_price_usd * 100) : 0
                return (
                  <tr
                    key={p.id}
                    data-product-jump-id={p.id}
                    className={`table-row cursor-pointer ${isProductSelected(p.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                    onClick={()=>setDetailProduct(p)}
                  >
                    <td className="px-3 py-2 w-8" onClick={e=>{e.stopPropagation();toggleSelect(p.id)}}>
                      <input type="checkbox" className="rounded" checked={isProductSelected(p.id)} onChange={()=>toggleSelect(p.id)} />
                    </td>
                    <td className="px-3 py-2">
                      {getProductGallery(p).length
                        ? <ProductImg src={getProductGallery(p)[0]} alt={p.name} className="w-10 h-10 rounded-lg object-cover cursor-zoom-in hover:ring-2 hover:ring-blue-400" onClick={e=>{e.stopPropagation(); openLightbox(getProductGallery(p), 0, p.name)}} />
                        : <ProductImagePlaceholder className="h-10 w-10 rounded-lg" compact />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                        {p.is_group ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">group</span> : null}
                        {p.parent_id ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">variant</span> : null}
                      </div>
                      {p.supplier && <div className="text-xs text-gray-400 truncate max-w-32">{p.supplier}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-400 font-mono text-xs hidden lg:table-cell">{p.sku||'N/A'}</td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      {p.category ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs"
                          style={{
                            background: catMap[p.category]?.color || '#6b7280',
                            color: getContrastingTextColor(catMap[p.category]?.color || '#6b7280'),
                          }}
                        >
                          {p.category}
                        </span>
                      ) : 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-right col-highlight-red">
                      <div className="font-medium text-red-700 dark:text-red-400">{fmtUSD(purchaseUsd)}</div>
                      {purchaseKhr>0 && <div className="text-xs text-gray-400">{fmtKHR(purchaseKhr)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right col-highlight-green">
                      <div className="font-semibold text-green-700 dark:text-green-400">{fmtUSD(p.selling_price_usd)}</div>
                      {p.selling_price_khr>0 && <div className="text-xs text-gray-400">{fmtKHR(p.selling_price_khr)}</div>}
                    </td>
                    <td className="px-3 py-2 text-right hidden lg:table-cell">
                      {purchaseUsd>0 && p.selling_price_usd>0
                        ? <div><div className={`font-medium text-xs ${marginUsd>=0?'text-blue-600':'text-yellow-600'}`}>{fmtUSD(marginUsd)}</div><div className="text-xs text-gray-400">{marginPct.toFixed(1)}%</div></div>
                        : <span className="text-gray-300">N/A</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-bold text-gray-900 dark:text-white">
                        {branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity}
                        {renderUnitChip(p.unit)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">{getStockBadge(p)}</td>
                    <td className="px-2 py-2 text-right" onClick={e=>e.stopPropagation()}>
                      <ThreeDot
                        onDetails={()=>setDetailProduct(p)}
                        onEdit={()=>{setSelected(p);setModal('form')}}
                        onDelete={()=>handleDelete(p)}
                        onAddVariant={!p.parent_id ? ()=>setVariantModal(p) : undefined}
                      />
                    </td>
                  </tr>
                )
                  }) : null}
                </Fragment>
              )})}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 dark:border-gray-700">{visibleProducts.length} {t('products')}</div>
      </div>

      {/* Mobile card list */}
      <div className="flex-1 overflow-auto space-y-2 sm:hidden">
        {/* Mobile select-all bar */}
        {!loading && visibleProducts.length > 0 && (
          <div className="flex items-center gap-3 px-1 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700">
            <input
              type="checkbox"
              className="w-4 h-4 cursor-pointer rounded flex-shrink-0"
              checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
              ref={mobileSelectAllRef}
              onChange={(event) => toggleSelectAll(event.target.checked)}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {hasSelected
                ? `${selectedVisibleCount} / ${visibleProducts.length} ${t('selected')||'selected'}`
                : `${t('select_all')||'Select all'} (${visibleProducts.length})`}
            </span>
            {hasSelected && (
              <button
                className="ml-auto text-xs text-blue-500 hover:text-blue-700"
                onClick={() => { setSelectedIds(new Set()); setBulkEditMode(null) }}
              >{t('cancel')}</button>
            )}
          </div>
        )}
        {loading ? <div className="text-center py-10 text-gray-400">{t('loading')}</div>
        : visibleProducts.length===0 ? <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
        : productSections.map((section) => {
          const isCollapsed = collapsedProductSections.has(section.id)
          return (
          <div key={section.id} className="space-y-2">
            <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded"
                    checked={isSelectionScopeFullySelected(section.ids)}
                    ref={(node) => {
                      if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                    }}
                    onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                    aria-label={`Select ${section.label}`}
                  />
                  <span>{section.label}</span>
                  <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                </label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                  onClick={() => toggleProductSection(section.id)}
                >
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                </button>
              </div>
            </div>
            {!isCollapsed ? section.items.map(p => {
          const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
          const qty = branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity
          return (
            <div
              key={p.id}
              data-product-jump-id={p.id}
              className={`card p-3 flex gap-3 cursor-pointer active:bg-blue-50 dark:active:bg-blue-900/10 ${isProductSelected(p.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              onClick={()=>setDetailProduct(p)}
            >
              <input type="checkbox" className="rounded mt-1 flex-shrink-0 cursor-pointer" checked={isProductSelected(p.id)} onChange={e=>{e.stopPropagation();toggleSelect(p.id)}} onClick={e=>e.stopPropagation()} />
              <div className="flex-shrink-0">
                {getProductGallery(p).length
                  ? <ProductImg src={getProductGallery(p)[0]} alt={p.name} className="w-14 h-14 rounded-xl object-cover cursor-zoom-in" onClick={e=>{e.stopPropagation();openLightbox(getProductGallery(p),0,p.name)}} />
                  : <ProductImagePlaceholder className="h-14 w-14 rounded-xl" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <div className="font-semibold text-gray-900 dark:text-white text-sm truncate">{p.name}</div>
                  {getStockBadge(p)}
                </div>
                {p.category && (
                  <span
                    className="mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-xs"
                    style={{
                      background: catMap[p.category]?.color || '#6b7280',
                      color: getContrastingTextColor(catMap[p.category]?.color || '#6b7280'),
                    }}
                  >
                    {p.category}
                  </span>
                )}
                <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
                  <span className="text-red-600">{fmtUSD(purchaseUsd)}</span>
                  <span className="text-green-700">{fmtUSD(p.selling_price_usd)}</span>
                  <span className="flex items-center text-gray-500">{qty}{renderUnitChip(p.unit)}</span>
                </div>
              </div>
              <div onClick={e=>e.stopPropagation()}>
                <ThreeDot
                  onDetails={()=>setDetailProduct(p)}
                  onEdit={()=>{setSelected(p);setModal('form')}}
                  onDelete={()=>handleDelete(p)}
                  onAddVariant={!p.parent_id ? ()=>setVariantModal(p) : undefined}
                />
              </div>
            </div>
          )
            }) : null}
          </div>
        )})}
      </div>

      {/* Product detail modal */}
      {detailProduct && (
        <ProductDetailModal
          p={detailProduct} catMap={catMap} unitMap={unitMap} fmtUSD={fmtUSD} fmtKHR={fmtKHR} t={t}
          onEdit={()=>{setSelected(detailProduct);setDetailProduct(null);setModal('form')}}
          onDelete={()=>handleDelete(detailProduct)}
          onClose={()=>setDetailProduct(null)}
          onImageClick={(src, gallery, startIndex = 0) => {
            const sourceGallery = Array.isArray(gallery) && gallery.length ? gallery : [src]
            openLightbox(sourceGallery, startIndex, detailProduct?.name || '')
          }}
        />
      )}

      {false && lightbox && lightbox.images?.length && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 cursor-zoom-out" onClick={() => { setLightbox(null) }}>
          <div className="relative max-w-3xl w-full max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <img src={lightbox.images[lightbox.index]} alt="Product preview" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain" />
            <div className="absolute top-2 left-2 flex items-center gap-2">
              <button
                onClick={() => setLightbox((curr) => {
                  if (!curr?.images?.length) return curr
                  const total = curr.images.length
                  const index = (curr.index - 1 + total) % total
                  return { ...curr, index }
                })}
                className="bg-black/60 text-white rounded-full px-3 py-1 text-sm hover:bg-black/80"
              >
                Prev
              </button>
              <button
                onClick={() => setLightbox((curr) => {
                  if (!curr?.images?.length) return curr
                  const total = curr.images.length
                  const index = (curr.index + 1) % total
                  return { ...curr, index }
                })}
                className="bg-black/60 text-white rounded-full px-3 py-1 text-sm hover:bg-black/80"
              >
                Next
              </button>
              <span className="text-xs text-white/90 bg-black/50 rounded-full px-2.5 py-1">
                {lightbox.index + 1}/{lightbox.images.length}
              </span>
            </div>
            <button onClick={() => { setLightbox(null) }} className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-9 h-9 flex items-center justify-center text-xl hover:bg-black/80">?</button>
          </div>
        </div>
      )}

      <ImageGalleryLightbox
        open={!!(lightbox && lightbox.images?.length)}
        title={lightbox?.title || detailProduct?.name || t('products')}
        images={lightbox?.images || []}
        index={lightbox?.index || 0}
        onClose={() => setLightbox(null)}
        onIndexChange={(index) => setLightbox((curr) => (curr ? { ...curr, index } : curr))}
        labels={{
          prev: t('prev') || 'Prev',
          next: t('next') || 'Next',
          imageCount: '{current}/{total}',
          dotsLabel: 'Image {current} of {total}',
        }}
      />

      {bulkAddModal && (
        <BulkAddStockModal
          productIds={bulkAddModal.ids}
          products={products}
          branches={branches}
          user={user}
          onClose={() => setBulkAddModal(null)}
          onDone={() => { setBulkAddModal(null); setSelectedIds(new Set()); load() }}
          t={t}
        />
      )}
      {modal==='form'   && <ProductForm product={selected} categories={categories} units={units} branches={branches} brandOptions={brandOptions} onSave={handleSaveWithGallery} onClose={()=>{setModal(null);setSelected(null)}} t={t} usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate} user={user} />}
      {variantModal && (
        <VariantFormModal
          parent={variantModal}
          categories={categories} units={units} branches={branches} user={user}
          onClose={()=>setVariantModal(null)}
          onDone={()=>{setVariantModal(null);load()}}
          t={t} usdSymbol={usdSymbol} khrSymbol={khrSymbol} exchangeRate={exchangeRate}
        />
      )}
      {modal==='cats'   && <ManageCategoriesModal onClose={()=>{setModal(null);load()}} t={t} />}
      {modal==='brands' && <ManageBrandsModal onClose={()=>setModal(null)} onDone={load} products={products} user={user} t={t} />}
      {modal==='units'  && <ManageUnitsModal onClose={()=>{setModal(null);load()}} t={t} />}
      {modal==='bulk'   && <BulkImportModal onClose={()=>setModal(null)} onDone={load} t={t} />}
    </div>
  )
}



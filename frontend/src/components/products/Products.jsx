// ?�?� Products ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�
// Main Products page ??all sub-modals imported from sibling files.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PackageSearch } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { downloadCSV } from '../../utils/csv'
import { ThreeDotPortal } from '../shared/PortalMenu'
import Modal from '../shared/Modal'
import ImageGalleryLightbox from '../shared/ImageGalleryLightbox'
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
import { getFirstLoaderError, settleLoaderMap } from '../../utils/loaders.mjs'

function multiMatch(text, terms) {
  return terms.every(t => text.toLowerCase().includes(t.toLowerCase()))
}

function ThreeDot({ onDetails, onEdit, onDelete, onAddVariant }) {
  return <ThreeDotPortal onDetails={onDetails} onEdit={onEdit} onDelete={onDelete} onAddVariant={onAddVariant} />
}

// ?�?� Product detail modal ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

export default function Products() {
  const { t, user, settings, notify, fmtUSD, fmtKHR, usdSymbol, khrSymbol, exchangeRate } = useApp()
  const { syncChannel } = useSync()
  const [products,     setProducts]     = useState([])
  const [categories,   setCategories]   = useState([])
  const [units,        setUnits]        = useState([])
  const [branches,     setBranches]     = useState([])
  const [branchFilter, setBranchFilter] = useState('all')
  const [stockFilter,  setStockFilter]  = useState('all') // all | in_stock | low | out
  const [filterOpen,   setFilterOpen]   = useState(false)
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
  const [variantModal, setVariantModal] = useState(null) // parent product for adding variant

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoadError(null)
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

      if (Array.isArray(prods) && (prods.length > 0 || !silent)) setProducts(prods)
      if (Array.isArray(cats)) setCategories(cats)
      if (Array.isArray(unitList)) setUnits(unitList)
      if (Array.isArray(brs)) setBranches((brs || []).filter(b => b.is_active))

      if (!result.hasAnySuccess) {
        throw new Error(getFirstLoaderError(result.errors, 'Failed to load products'))
      }
      if (result.hasErrors && !silent) {
        notify(t('products_partial_load') || 'Some product data is still catching up. The page will keep refreshing as data arrives.', 'warning')
      }
    } catch (e) { if (!silent) setLoadError(e.message || 'Failed to load products') }
    finally { if (!silent) setLoading(false) }
  }, [notify, t])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!syncChannel) return
    const ch = syncChannel.channel
    if (ch==='products'||ch==='categories'||ch==='units'||ch==='branches') load(true)
  }, [syncChannel, load])

  const handleSave = async (form) => {
    if (!form.name?.trim()) return notify(t('name') + ' required', 'error')
    try {
      // Strip _tempImagePath from the main data object ??it's a large base64 string
      // and must never be sent as part of create/update (separate upload call below)
      const { _tempImagePath, ...dataWithoutImage } = form
      const data = { ...dataWithoutImage, userId: user.id, userName: user.name }

      let productId = selected?.id
      if (!selected) {
        const res = await window.api.createProduct(data)
        if (!res?.success) return notify(res?.error || 'Failed to create product', 'error')
        productId = res.id
      } else {
        const res = await window.api.updateProduct(selected.id, data, user.id, user.name)
        if (res?.success === false) return notify(res.error || 'Failed to update product', 'error')
      }

      // Upload image separately after the product exists (so we have a productId)
      if (_tempImagePath && productId) {
        const ext = _tempImagePath.startsWith('data:image/png')  ? '.png'
                  : _tempImagePath.startsWith('data:image/webp') ? '.webp'
                  : _tempImagePath.startsWith('data:image/gif')  ? '.gif' : '.jpg'
        const fn = `product_${productId}_${Date.now()}${ext}`
        try {
          const imgRes = await window.api.uploadProductImage({ productId, filePath: _tempImagePath, fileName: fn })
          if (imgRes && imgRes.path) {
            // Update the product record with the uploaded image path
            await window.api.updateProduct(productId, {
              ...dataWithoutImage,
              image_path: imgRes.path,
              userId: user.id,
              userName: user.name,
            })
          } else if (imgRes && !imgRes.success) {
            notify(`Product saved but image upload failed: ${imgRes.error || 'unknown error'}`, 'warning')
          }
        } catch (imgErr) {
          console.error('[handleSave] image upload error:', imgErr.message)
          notify(`Product saved but image failed: ${imgErr.message}`, 'warning')
        }
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
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} product${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    let failed = 0
    for (const id of selectedIds) {
      try { await window.api.deleteProduct(id) } catch { failed++ }
    }
    setSelectedIds(new Set())
    load()
    if (failed) notify(`Deleted ${selectedIds.size - failed}, ${failed} failed`, 'warning')
    else notify(`${selectedIds.size} product${selectedIds.size > 1 ? 's' : ''} deleted`)
  }

  const handleBulkOutOfStock = async () => {
    if (!selectedIds.size) return
    if (!confirm(`Set ${selectedIds.size} product(s) to out-of-stock (quantity = 0)?`)) return
    let done = 0
    for (const id of selectedIds) {
      const p = products.find(x => x.id === id)
      if (!p) continue
      try {
        await window.api.updateProduct(id, { ...p, stock_quantity: 0, userId: user.id, userName: user.name })
        done++
      } catch {}
    }
    setSelectedIds(new Set()); load()
    notify(`${done} product(s) set to out-of-stock`)
  }

  const handleBulkChangeBranch = async (branchId) => {
    if (!selectedIds.size || !branchId) return
    const branch = branches.find(b => String(b.id) === String(branchId))
    if (!branch) return
    if (!confirm(`Move stock of ${selectedIds.size} product(s) to "${branch.name}"?`)) return
    let done = 0
    const defaultBranch = branches.find(b => b.is_default)
    for (const id of selectedIds) {
      const p = products.find(x => x.id === id)
      if (!p) continue
      try {
        // Transfer from current branch to target branch
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
          // No stock in any branch ??just assign to that branch with 0
          await window.api.adjustStock({
            productId: id, productName: p.name, type: 'add', quantity: 0,
            branchId: parseInt(branchId), userId: user.id, userName: user.name,
          })
        }
        done++
      } catch {}
    }
    setSelectedIds(new Set()); load()
    notify(`${done} product(s) branch updated to "${branch.name}"`)
  }

  const [bulkAddModal, setBulkAddModal] = useState(null)
  const handleBulkAddStock = () => {
    if (!selectedIds.size) return
    setBulkAddModal({ ids: [...selectedIds] })
  }

  const toggleSelect = (id) => setSelectedIds(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map(p => p.id)))
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
      <span className="ml-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: color }}>
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
  const getBranchQty = (p, branchId) => (p.branch_stock||[]).find(s=>String(s.branch_id)===String(branchId))?.quantity ?? 0
  const getStockBadge = (p) => {
    const qty = branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity
    if (qty<=(p.out_of_stock_threshold||0)) return <span className="badge-red">{t('out_of_stock')}</span>
    if (qty<=(p.low_stock_threshold||10))   return <span className="badge-yellow">{t('low_stock')}</span>
    return <span className="badge-green">{t('in_stock')}</span>
  }

  // Search: comma-separated terms. Mode AND = all terms must match. Mode OR = any term matches.
  // Spaces within a term are treated as part of the search string (no space=AND split).
  const searchTerms = search.trim()
    ? search.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : []
  const filtered = products.filter(p => {
    const hay = `${p.name} ${p.sku||''} ${p.barcode||''} ${p.category||''} ${p.brand||''} ${p.supplier||''} ${p.description||''}`.toLowerCase()
    const matchSearch = searchTerms.length === 0 || (
      searchMode === 'AND'
        ? searchTerms.every(term => hay.includes(term))
        : searchTerms.some(term => hay.includes(term))
    )
    const matchCat      = catFilter==='all' || p.category===catFilter
    const matchBrand    = brandFilter==='all' || (p.brand||'').toLowerCase() === brandFilter.toLowerCase()
    const matchBranch   = branchFilter==='all' || (p.branch_stock||[]).some(bs=>String(bs.branch_id)===branchFilter)
    const matchSupplier = supplierFilter==='all' || (p.supplier||'').toLowerCase() === supplierFilter.toLowerCase()
    const qty = branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity

    // When a branch is selected, fully hide products with no stock at that branch
    // (unless the user is explicitly looking for out-of-stock items)
    if (branchFilter !== 'all' && stockFilter !== 'out' && qty <= (p.out_of_stock_threshold || 0)) return false

    const matchStock =
      stockFilter === 'all'      ? true :
      stockFilter === 'out'      ? qty <= (p.out_of_stock_threshold||0) :
      stockFilter === 'low'      ? qty > (p.out_of_stock_threshold||0) && qty <= (p.low_stock_threshold||10) :
      stockFilter === 'in_stock' ? qty > (p.low_stock_threshold||10) : true
    return matchSearch && matchCat && matchBrand && matchBranch && matchSupplier && matchStock
  })

  if (loadError) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">!</div>
      <p className="text-red-600 dark:text-red-400 font-medium">{loadError}</p>
      <button onClick={load} className="btn-primary">Retry</button>
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
            onExport={() => {
              const toImageName = (value) => String(value || '').split(/[\\/]/).pop() || ''
              const toImageUrl = (value) => String(value || '').trim()
              const rows = filtered.map(p => ({
                Name: p.name || '', SKU: p.sku || '', Barcode: p.barcode || '',
                Category: p.category || '', Brand: p.brand || '', Unit: p.unit || '', Description: p.description || '',
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
              downloadCSV(`products-${new Date().toISOString().slice(0,10)}.csv`, rows)
            }}
            onAdd={()=>{setSelected(null);setModal('form')}}
            t={t}
          />
        </div>
      </div>

      {/* ?�?� Search row + Filter toggle ?�?� */}
      {(() => {
        const brands = brandOptions
        const suppliers = [...new Set(products.map(p => p.supplier).filter(Boolean))].sort()
        const activeFilters = [
          catFilter !== 'all' ? 1 : 0,
          brandFilter !== 'all' ? 1 : 0,
          branchFilter !== 'all' ? 1 : 0,
          supplierFilter !== 'all' ? 1 : 0,
          stockFilter !== 'all' ? 1 : 0,
        ].reduce((a,b) => a+b, 0)

        return (
          <>
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="input flex-1 min-w-0 text-sm"
                placeholder={t('search_products_placeholder') || `${t('search') || 'Search'} products`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="flex flex-1 rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden sm:flex-none">
                  {['AND','OR'].map(m => (
                    <button key={m} onClick={() => setSearchMode(m)}
                      className={`flex-1 px-2.5 py-1.5 text-xs font-bold transition-colors sm:flex-none ${searchMode===m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setFilterOpen(v => !v)}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors sm:flex-none
                    ${filterOpen || activeFilters > 0
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}>
                  {activeFilters > 0 ? (t('filters_active')||`Filters (${activeFilters})`).replace('{n}',activeFilters) : (t('filters')||'Filters')}
                </button>
              </div>
            </div>

            {/* ?�?� Collapsible filter panel ?�?� */}
            {filterOpen && (
              <div className="card p-3 mb-2 space-y-3">
                {/* Stock status */}
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('stock_status')||'Stock Status'}</div>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      ['all',      t('all')||'All'],
                      ['in_stock', t('in_stock') || 'In Stock'],
                      ['low',      t('low_stock')||'Low'],
                      ['out',      t('out_of_stock')||'Out'],
                    ].map(([v,lbl]) => (
                      <button key={v} onClick={() => setStockFilter(v)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${stockFilter===v ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category */}
                {categories.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('category')||'Category'}</div>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setCatFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${catFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {t('all')||'All'}
                      </button>
                      {categories.map(c => (
                        <button key={c.id} onClick={() => setCatFilter(catFilter===c.name ? 'all' : c.name)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${catFilter===c.name ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                          style={catFilter===c.name ? {background: c.color || '#2563eb'} : {}}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Brand */}
                {brands.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('brand')||'Brand'}</div>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setBrandFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${brandFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {t('all_brands')||'All Brands'}
                      </button>
                      {brands.map(b => (
                        <button key={b} onClick={() => setBrandFilter(brandFilter===b ? 'all' : b)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${brandFilter===b ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Branch */}
                {branches.length > 1 && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('branch')||'Branch'}</div>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setBranchFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${branchFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {t('all')||'All'}
                      </button>
                      {branches.map(b => (
                        <button key={b.id} onClick={() => setBranchFilter(branchFilter===String(b.id) ? 'all' : String(b.id))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${branchFilter===String(b.id) ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {b.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Supplier */}
                {suppliers.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{t('supplier')||'Supplier'}</div>
                    <div className="flex gap-1 flex-wrap">
                      <button onClick={() => setSupplierFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium ${supplierFilter==='all' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                        {t('suppliers')||'All Suppliers'}
                      </button>
                      {suppliers.map(s => (
                        <button key={s} onClick={() => setSupplierFilter(supplierFilter===s ? 'all' : s)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${supplierFilter===s ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clear all */}
                {activeFilters > 0 && (
                  <button
                    onClick={() => { setCatFilter('all'); setBrandFilter('all'); setBranchFilter('all'); setSupplierFilter('all'); setStockFilter('all') }}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400">
                    {t('clear_filters')||'Clear all filters'}
                  </button>
                )}
              </div>
            )}
          </>
        )
      })()}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-xl overflow-hidden">
          {/* Primary action row */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
            <span className="mr-1 w-full text-sm font-semibold text-blue-700 dark:text-blue-300 sm:w-auto">{selectedIds.size} selected</span>
            {/* Collapsible edit options */}
            {[
              { id:'info', icon:'Edit', label:'Edit Info' },
              { id:'pricing', icon:'Price', label:'Pricing' },
              { id:'stock', icon:'Stock', label:'Stock' },
              { id:'branch', icon:'Branch', label:'Branch' },
            ].map(opt => (
              <button key={opt.id}
                onClick={() => { setBulkEditMode(bulkEditMode===opt.id?null:opt.id); setBulkEditOpen(true); setBulkEditForm({}) }}
                className={`text-xs py-1.5 px-3 rounded-lg border font-medium transition-colors ${bulkEditMode===opt.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-zinc-600 hover:border-blue-400'}`}>
                {opt.icon} {opt.label}
              </button>
            ))}
            <button onClick={handleBulkOutOfStock} className="btn-secondary text-xs py-1.5 px-3">Out of Stock</button>
            <button onClick={handleBulkDelete} className="btn-danger text-xs py-1.5 px-3">Delete</button>
            <button onClick={() => { setSelectedIds(new Set()); setBulkEditMode(null) }} className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 sm:ml-auto">Clear</button>
          </div>

          {/* Expanded edit panel */}
          {bulkEditMode === 'info' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Update basic info for <strong>{selectedIds.size}</strong> products</p>
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
              <button className="btn-primary text-xs py-1.5 px-4 mt-3" onClick={async () => {
                const updates = {}
                if (bulkEditForm.category) updates.category = bulkEditForm.category
                if (bulkEditForm.unit) updates.unit = bulkEditForm.unit
                if (bulkEditForm.supplier) updates.supplier = bulkEditForm.supplier
                if (bulkEditForm.brand) updates.brand = bulkEditForm.brand
                if (bulkEditForm.low_stock_threshold !== undefined && bulkEditForm.low_stock_threshold !== '') updates.low_stock_threshold = parseInt(bulkEditForm.low_stock_threshold)
                if (!Object.keys(updates).length) return notify('No changes specified', 'warning')
                let ok = 0
                for (const id of selectedIds) { try { await window.api.updateProduct(id, {...updates, userId: user.id, userName: user.name}); ok++ } catch {} }
                notify(`Updated ${ok} products`); load(); setBulkEditMode(null); setSelectedIds(new Set())
              }}>Apply to {selectedIds.size} products</button>
            </div>
          )}

          {bulkEditMode === 'pricing' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Update pricing for <strong>{selectedIds.size}</strong> products</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-gray-500 block mb-1">Selling Price (USD)</label>
                  <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.selling_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,selling_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
                <div><label className="text-xs text-gray-500 block mb-1">Purchase Price (USD)</label>
                  <input className="input text-xs py-1" type="number" step="0.01" min="0" value={bulkEditForm.purchase_price_usd??''} onChange={e=>setBulkEditForm(f=>({...f,purchase_price_usd:e.target.value}))} placeholder="Leave blank to keep" /></div>
              </div>
              <p className="text-xs text-gray-400 mt-1">KHR prices will auto-calculate at current exchange rate</p>
              <button className="btn-primary text-xs py-1.5 px-4 mt-3" onClick={async () => {
                const updates = {}
                if (bulkEditForm.selling_price_usd !== '' && bulkEditForm.selling_price_usd !== undefined) updates.selling_price_usd = parseFloat(bulkEditForm.selling_price_usd)
                if (bulkEditForm.purchase_price_usd !== '' && bulkEditForm.purchase_price_usd !== undefined) updates.purchase_price_usd = parseFloat(bulkEditForm.purchase_price_usd)
                if (!Object.keys(updates).length) return notify('No changes specified', 'warning')
                let ok = 0
                for (const id of selectedIds) { try { await window.api.updateProduct(id, {...updates, userId: user.id, userName: user.name}); ok++ } catch {} }
                notify(`Updated ${ok} products`); load(); setBulkEditMode(null); setSelectedIds(new Set())
              }}>Apply to {selectedIds.size} products</button>
            </div>
          )}

          {bulkEditMode === 'stock' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Adjust stock for <strong>{selectedIds.size}</strong> products</p>
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
              <button className="btn-primary text-xs py-1.5 px-4 mt-3" onClick={handleBulkAddStock}>Apply to {selectedIds.size} products</button>
            </div>
          )}

          {bulkEditMode === 'branch' && (
            <div className="px-4 py-3 border-t border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-800">
              <p className="text-xs text-gray-500 mb-2">Move stock to a branch for <strong>{selectedIds.size}</strong> products</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div><label className="text-xs text-gray-500 block mb-1">Target Branch</label>
                  <select className="input text-xs py-1" value={bulkEditForm.branchId||''} onChange={e=>setBulkEditForm(f=>({...f,branchId:e.target.value}))}>
                    <option value="">Select branch</option>
                    {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <button className="btn-primary text-xs py-1.5 px-4" onClick={() => { if (bulkEditForm.branchId) { handleBulkChangeBranch(bulkEditForm.branchId); setBulkEditMode(null) } else notify('Select a branch first','error') }}>Move Stock</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Desktop table */}
      <div className="card sm:flex-1 sm:overflow-hidden flex-col hidden sm:flex">
        <div className="overflow-auto sm:flex-1">
          <table className="w-full text-sm table-bordered">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input type="checkbox"
                    className="rounded"
                    checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
                    onChange={toggleSelectAll}
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
              : filtered.length === 0 ? <tr><td colSpan={11} className="text-center py-10 text-gray-400">{t('no_data')}</td></tr>
              : filtered.map(p => {
                const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
                const purchaseKhr = p.purchase_price_khr || p.cost_price_khr || 0
                const marginUsd   = p.selling_price_usd - purchaseUsd
                const marginPct   = p.selling_price_usd > 0 ? (marginUsd / p.selling_price_usd * 100) : 0
                return (
                  <tr key={p.id} className={`table-row cursor-pointer ${selectedIds.has(p.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`} onClick={()=>setDetailProduct(p)}>
                    <td className="px-3 py-2 w-8" onClick={e=>{e.stopPropagation();toggleSelect(p.id)}}>
                      <input type="checkbox" className="rounded" checked={selectedIds.has(p.id)} onChange={()=>toggleSelect(p.id)} />
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
                      {p.category ? <span className="text-xs px-2 py-0.5 rounded-full text-white" style={{background:catMap[p.category]?.color||'#6b7280'}}>{p.category}</span> : 'N/A'}
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
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">{filtered.length} {t('products')}</div>
      </div>

      {/* Mobile card list */}
      <div className="flex-1 overflow-auto space-y-2 sm:hidden">
        {/* Mobile select-all bar */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center gap-3 px-1 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700">
            <input
              type="checkbox"
              className="w-4 h-4 cursor-pointer rounded flex-shrink-0"
              checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
              onChange={toggleSelectAll}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {selectedIds.size > 0
                ? `${selectedIds.size} / ${filtered.length} ${t('selected')||'selected'}`
                : `${t('select_all')||'Select all'} (${filtered.length})`}
            </span>
            {selectedIds.size > 0 && (
              <button
                className="ml-auto text-xs text-blue-500 hover:text-blue-700"
                onClick={() => { setSelectedIds(new Set()); setBulkEditMode(null) }}
              >{t('cancel')}</button>
            )}
          </div>
        )}
        {loading ? <div className="text-center py-10 text-gray-400">{t('loading')}</div>
        : filtered.length===0 ? <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
        : filtered.map(p => {
          const purchaseUsd = p.purchase_price_usd || p.cost_price_usd || 0
          const qty = branchFilter!=='all' ? getBranchQty(p,branchFilter) : p.stock_quantity
          return (
            <div key={p.id} className={`card p-3 flex gap-3 cursor-pointer active:bg-blue-50 dark:active:bg-blue-900/10 ${selectedIds.has(p.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`} onClick={()=>setDetailProduct(p)}>
              <input type="checkbox" className="rounded mt-1 flex-shrink-0 cursor-pointer" checked={selectedIds.has(p.id)} onChange={e=>{e.stopPropagation();toggleSelect(p.id)}} onClick={e=>e.stopPropagation()} />
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
                {p.category && <span className="text-xs px-1.5 py-0.5 rounded-full text-white inline-block mt-0.5" style={{background:catMap[p.category]?.color||'#6b7280'}}>{p.category}</span>}
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
        })}
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


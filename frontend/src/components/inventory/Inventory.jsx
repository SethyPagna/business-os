// ?? Inventory ????????????????????????????????????????????????????????????????
// Main Inventory page ??sub-components imported from sibling files.

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react'
import { ArrowRightLeft, Boxes, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Package, Upload, X } from 'lucide-react'
import { useApp, useSync } from '../../AppContext'
import { fmtTime } from '../../utils/formatters'
import { buildCSV, downloadCSV, downloadZipFiles } from '../../utils/csv'
import { buildStandaloneReportHtml } from '../../utils/exportReports'
import { buildReportManifestRows, buildReportPackageFiles } from '../../utils/exportPackage'
import { calculateProductDiscount, formatPriceNumber } from '../../utils/pricing.js'
import ExportMenu from '../shared/ExportMenu'
import FilterMenu from '../shared/FilterMenu'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import PaginationControls, { PAGE_SIZE_OPTIONS, clampPage } from '../shared/PaginationControls.jsx'
import SectionSwitcher from '../shared/SectionSwitcher.jsx'
import LoadingWatchdog from '../shared/LoadingWatchdog.jsx'
import DualMoney from './DualMoney'
import ProductDetailModal from './ProductDetailModal'
import InventoryImportModal from './InventoryImportModal'
import { buildMovementGroups, getMovementGroupPage, movementGroupHaystack } from './movementGroups'
import { useIsPageActive } from '../shared/pageActivity'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import { cloneHistorySnapshot } from '../../utils/historyHelpers.mjs'
import { buildTimeActionSections, getAvailableYears, getTimeGroupingMode, toggleIdSet } from '../../utils/groupedRecords.mjs'
import { aggregateInitialOptions } from '../../utils/initials.mjs'
import { isApiVersionMismatchError } from '../../api/http.js'
import {
  beginTrackedRequest,
  getFirstLoaderError,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  settleLoaderMap,
} from '../../utils/loaders.mjs'

function reuseSetWhenUnchanged(current, nextValues = []) {
  const next = new Set(nextValues)
  if (next.size !== current.size) return next
  for (const value of current) {
    if (!next.has(value)) return next
  }
  return current
}

function priceCsv(value) {
  return formatPriceNumber(value || 0)
}

function parseInventoryTimestamp(value) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function InventoryDiscountBadge({ product, fmtUSD, t }) {
  const promotion = calculateProductDiscount(product)
  if (!promotion.active) return null
  const label = product?.discount_label || (typeof t === 'function' ? (t('discounts') || 'Discounts') : 'Discounts')
  return (
    <span className="inline-flex max-w-[10rem] truncate rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60" title={`${label} ${fmtUSD(promotion.applied_price_usd || 0)}`}>
      {label} {fmtUSD(promotion.applied_price_usd || 0)}
    </span>
  )
}

const RFID_INVENTORY_WORKFLOWS = [
  { id: 'receiving', labelKey: 'rfid_workflow_receiving', descriptionKey: 'rfid_workflow_receiving_desc', label: 'Receiving', description: 'Pair EPC tags to new stock, supplier lots, cartons, or individual products before adding inventory.' },
  { id: 'stock-count', labelKey: 'rfid_workflow_stock_count', descriptionKey: 'rfid_workflow_stock_count_desc', label: 'Stock count', description: 'Walk shelves with a reader, compare reads against on-hand stock, then approve counted differences.' },
  { id: 'transfer', labelKey: 'rfid_workflow_branch_transfer', descriptionKey: 'rfid_workflow_branch_transfer_desc', label: 'Branch transfer', description: 'Scan tags out of one branch and into another so transfer movements keep item identity.' },
  { id: 'pos-verify', labelKey: 'rfid_workflow_pos_verify', descriptionKey: 'rfid_workflow_pos_verify_desc', label: 'POS verify', description: 'Use doorway or counter reads to confirm sold items before bagging and reduce missed scans.' },
  { id: 'returns', labelKey: 'rfid_workflow_returns', descriptionKey: 'rfid_workflow_returns_desc', label: 'Returns', description: 'Validate returned tags against the original sale before restock, write-off, or supplier return.' },
]

const RFID_READER_REQUIREMENTS = [
  { id: 'gateway', key: 'rfid_requirement_gateway', text: 'RFID reader gateway must post reads with EPC / TID, antenna, branch, RSSI, and timestamp.' },
  { id: 'mapping', key: 'rfid_requirement_mapping', text: 'Each tag must be mapped to a product, variant, lot, carton, or serial-level unit before stock can change.' },
  { id: 'fallback', key: 'rfid_requirement_barcode_fallback', text: 'Barcode fallback remains available for products that are not tagged or when the reader is offline.' },
]

const INVENTORY_SECTION_OPTIONS = [
  { value: 'all', label: 'All', hint: 'Show inventory statistics, products, movements, and RFID tools together.' },
  { value: 'stats', label: 'Stats', hint: 'Show only the inventory summary cards.' },
  { value: 'products', label: 'Products', hint: 'Show product stock, values, and item-level controls.' },
  { value: 'movements', label: 'Movements', hint: 'Show stock movement history and grouped movement filters.' },
  { value: 'rfid', label: 'RFID', hint: 'Show branch-locked RFID tagging, stock count, search, exception, and session tools.' },
]

const RFID_SECTION_OPTIONS = [
  { value: 'overview', labelKey: 'rfid_section_overview', hintKey: 'rfid_section_overview_hint', label: 'Overview', hint: 'Show RFID status, branch lock state, reader readiness, and the pilot checklist.' },
  { value: 'tagging', labelKey: 'rfid_section_tagging', hintKey: 'rfid_section_tagging_hint', label: 'Tagging', hint: 'Link EPC/TID tags to products without changing the master stock ledger.' },
  { value: 'stock-count', labelKey: 'rfid_section_stock_count', hintKey: 'rfid_section_stock_count_hint', label: 'Stock Count', hint: 'Run a branch-locked scan session and compare RFID presence against barcode stock.' },
  { value: 'search', labelKey: 'rfid_section_search', hintKey: 'rfid_section_search_hint', label: 'Search', hint: 'Find a product or tag with the handheld reader and browser scan box.' },
  { value: 'exceptions', labelKey: 'rfid_section_exceptions', hintKey: 'rfid_section_exceptions_hint', label: 'Exceptions', hint: 'Review wrong-branch, unknown, missing, and extra tag detections before applying.' },
  { value: 'sessions', labelKey: 'rfid_section_sessions', hintKey: 'rfid_section_sessions_hint', label: 'Sessions', hint: 'Audit RFID scan sessions and manually apply approved results.' },
]

export default function Inventory() {
  const { t, user, notify, fmtUSD, fmtKHR, usdSymbol } = useApp()
  const { syncChannel } = useSync()
  const isActive = useIsPageActive('inventory')
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = useCallback((key, fallbackEn, fallbackKm = fallbackEn) => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }, [isKhmer, t])
  const [summary,       setSummary]       = useState([])
  const [stockStats,    setStockStats]    = useState(null)
  const [stockStatsLoaded, setStockStatsLoaded] = useState(false)
  const [statsRefreshError, setStatsRefreshError] = useState('')
  const [movements,     setMovements]     = useState([])
  const [movementMeta,  setMovementMeta]  = useState({ total: 0, page: 1, pageSize: 10000, totalPages: 1 })
  const [branches,      setBranches]      = useState([])
  const [returnStats,   setReturnStats]   = useState(null)
  const [taxDelivery,   setTaxDelivery]   = useState({ tax: 0, delivery: 0, deliveryCount: 0 })
  const [branchFilter,  setBranchFilter]  = useState('all')
  const [adjustModal,   setAdjustModal]   = useState(null)
  const [adjustForm,    setAdjustForm]    = useState({ type:'add', quantity:1, unit_cost_usd:0, unit_cost_khr:0, reason:'', branch_id:'' })
  const [moveModal,     setMoveModal]     = useState(null)
  const [moveForm,      setMoveForm]      = useState({ mode: 'existing', destination_product_id: '', destination_name: '', quantity: 1, branch_id: '', reason: 'broken', note: '', selling_price_usd: '', special_price_usd: '', discount_enabled: false, discount_type: 'percent', discount_percent: '', discount_amount_usd: '' })
  const [transferModal, setTransferModal] = useState(null)
  const [transferForm,  setTransferForm]  = useState({ from_branch_id: '', to_branch_id: '', quantity: 1, reason: '' })
  const [search,        setSearch]        = useState('')
  const [searchMode, setSearchMode] = useState('AND') // 'AND' | 'OR'
  const deferredSearch = useDeferredValue(search)
  const [brandFilter,   setBrandFilter]   = useState('all')
  const [stockFilter,   setStockFilter]   = useState('all')
  const [groupFilter,   setGroupFilter]   = useState('all') // all | grouped | parent | variant | standalone
  const [inventoryProductPage, setInventoryProductPage] = useState(1)
  const [inventoryProductPageSize, setInventoryProductPageSize] = useState(20)
  const [inventoryProductPageDraft, setInventoryProductPageDraft] = useState('1')
  const [inventoryProductTotal, setInventoryProductTotal] = useState(0)
  const [inventoryProductsLoaded, setInventoryProductsLoaded] = useState(false)
  const [inventoryInitialFilter, setInventoryInitialFilter] = useState('all')
  const [inventoryInitials, setInventoryInitials] = useState([])
  const [inventoryProductFilters, setInventoryProductFilters] = useState({ brands: [] })
  const [selectedProductIds, setSelectedProductIds] = useState(() => new Set())
  const [inventoryBatch, setInventoryBatch] = useState(null)
  const [batchApplying, setBatchApplying] = useState(false)
  const [rfidStatus, setRfidStatus] = useState(null)
  const [tab,           setTab]           = useState('products')
  const [inventorySection, setInventorySection] = useState('all')
  const [rfidSection, setRfidSection] = useState('all')
  const [movFilter,     setMovFilter]     = useState('all')
  const [movementUserFilter, setMovementUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState([])
  const [movementStartDate, setMovementStartDate] = useState('')
  const [movementEndDate, setMovementEndDate] = useState('')
  const [movementYearFilter, setMovementYearFilter] = useState('all')
  const [movementMonthFilter, setMovementMonthFilter] = useState('all')
  const [movementGroupMode, setMovementGroupMode] = useState('time')
  const [movementSortDirection, setMovementSortDirection] = useState('desc')
  const [selectedMovementIds, setSelectedMovementIds] = useState(() => new Set())
  const [detailProduct, setDetailProduct] = useState(null)
  const [expandedMovementGroups, setExpandedMovementGroups] = useState(() => new Set())
  const [expandedMovementPages, setExpandedMovementPages] = useState({})
  const [collapsedMovementSections, setCollapsedMovementSections] = useState(() => new Set())
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState(null)
  const [adjustSaving,  setAdjustSaving]  = useState(false)
  const [moveSaving,    setMoveSaving]    = useState(false)
  const [transferSaving, setTransferSaving] = useState(false)
  const [statDetail,    setStatDetail]    = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [inventoryReasons, setInventoryReasons] = useState([])
  const [reasonManager, setReasonManager] = useState({ open: false, type: 'adjust' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const movementSelectAllRef = useRef(null)
  const inventorySelectAllRef = useRef(null)
  const loadRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const loadWatchdogRef = useRef(null)
  const loadPromiseRef = useRef(null)
  const actionHistory = useActionHistory({ limit: 3, notify, scope: 'inventory' })
  const movementTimeMode = useMemo(
    () => getTimeGroupingMode(movementYearFilter, movementMonthFilter),
    [movementMonthFilter, movementYearFilter],
  )
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    let permissions = user?.permissions || {}
    try {
      permissions = typeof permissions === 'string' ? JSON.parse(permissions || '{}') : permissions
    } catch {
      permissions = {}
    }
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])

  const rfidGatewayStatus = useMemo(() => {
    const branchName = branchFilter === 'all'
      ? (t('all_branches') || 'All branches')
      : (branches.find((branch) => String(branch.id) === String(branchFilter))?.name || `Branch ${branchFilter}`)
    return {
      connected: false,
      label: tr('rfid_not_connected', 'Not connected', 'មិនបានភ្ជាប់'),
      branchName,
      readerCount: Number(rfidStatus?.readerCount || 0),
      activeSession: rfidStatus?.activeSession?.id ? `${tr('rfid_session', 'Session', 'សម័យ')} #${rfidStatus.activeSession.id}` : tr('rfid_no_active_session', 'No active RFID session', 'មិនមានសម័យ RFID កំពុងដំណើរការ'),
      queuedReads: 0,
      unknownTags: Number(rfidStatus?.exceptionCount || 0),
      lastHeartbeat: rfidStatus?.tagCount ? `${rfidStatus.tagCount} ${tr('rfid_tags_linked', 'tags linked', 'ស្លាកបានភ្ជាប់')}` : tr('rfid_no_reader_heartbeat', 'No reader heartbeat yet', 'មិនទាន់មាន heartbeat ពី reader'),
    }
  }, [branchFilter, branches, rfidStatus, t, tr])

  const rfidSectionOptions = useMemo(() => (
    RFID_SECTION_OPTIONS.map((option) => ({
      ...option,
      label: tr(option.labelKey, option.label),
      hint: tr(option.hintKey, option.hint),
    }))
  ), [tr])

  const reasonsByType = useMemo(() => ({
    adjust: inventoryReasons.filter((item) => item?.type === 'adjust'),
    transfer: inventoryReasons.filter((item) => item?.type === 'transfer'),
    move: inventoryReasons.filter((item) => item?.type === 'move'),
  }), [inventoryReasons])

  const loadInventoryReasons = useCallback(async () => {
    try {
      const result = await window.api.getInventoryReasons?.()
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
    } catch {
      setInventoryReasons([])
    }
  }, [])

  const load = useCallback(async (silent = false) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    const requestId = beginTrackedRequest(loadRequestRef)
    const promise = (async () => {
      if (!silent) {
        setLoadError(null)
        setLoading(true)
        window.clearTimeout(loadWatchdogRef.current)
        if (!loadedOnceRef.current) {
          loadWatchdogRef.current = window.setTimeout(() => {
            if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
            setLoading(false)
            setLoadError(tr('inventory_load_slow', 'Inventory is taking longer than expected. Tap Refresh or revisit in a moment.', 'ស្តុកកំពុងចំណាយពេលយូរជាងដែលរំពឹងទុក។ សូមចុចស្រស់ថ្មី ឬត្រឡប់មកវិញបន្តិចទៀត។'))
          }, 15000)
        }
      }
      const branchOpts = {
        ...(branchFilter !== 'all' ? { branchId: parseInt(branchFilter, 10) } : {}),
        ...(isAdmin && movementUserFilter !== 'all' ? { userId: movementUserFilter } : {}),
      }
      const productQuery = {
        ...branchOpts,
        page: inventoryProductPage,
        pageSize: inventoryProductPageSize,
        query: deferredSearch,
        searchMode,
        brand: brandFilter,
        stockState: stockFilter,
        groupState: groupFilter,
        initial: inventoryInitialFilter,
      }
      try {
        const result = await settleLoaderMap({
          stats: () => window.api.getInventoryStats(branchOpts),
          summary: () => window.api.searchInventoryProducts(productQuery),
          movements: () => window.api.getInventoryMovements({
            ...branchOpts,
            startDate: movementStartDate || undefined,
            endDate: movementEndDate || undefined,
            page: movementMeta.page,
            pageSize: movementMeta.pageSize,
          }),
          rfid: () => (window.api.getRfidStatus ? window.api.getRfidStatus(branchOpts).catch(() => null) : Promise.resolve(null)),
          branches: () => window.api.getBranches(),
          returns: () => window.api.getReturns({ scope: 'all' }).catch(() => []),
          dashboard: () => window.api.getDashboard().catch(() => ({})),
        })
        const sumResult = result.values.summary
        const statsResult = result.values.stats
        const sum = Array.isArray(sumResult) ? sumResult : (Array.isArray(sumResult?.items) ? sumResult.items : [])
        const movs = result.values.movements
        const rfid = result.values.rfid
        const brs = result.values.branches
        const rets = result.values.returns
        const dash = result.values.dashboard

        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        const versionMismatchError = Object.values(result.errors || {}).find(isApiVersionMismatchError)
        if (versionMismatchError) {
          setLoadError(versionMismatchError.message)
          throw versionMismatchError
        }
        if (Array.isArray(sum)) {
          setSummary(sum || [])
          setInventoryProductsLoaded(true)
          if (sumResult && !Array.isArray(sumResult)) {
            setInventoryProductTotal(Number(sumResult.total || 0))
            setInventoryProductPage(Number(sumResult.page || inventoryProductPage) || 1)
            setInventoryProductPageSize(Number(sumResult.pageSize || inventoryProductPageSize) || inventoryProductPageSize)
            setInventoryInitials(Array.isArray(sumResult.initials) ? sumResult.initials : [])
            setInventoryProductFilters(sumResult.filters && typeof sumResult.filters === 'object' ? sumResult.filters : { brands: [] })
          } else {
            setInventoryProductTotal(sum.length)
            setInventoryInitials([])
            setInventoryProductFilters({ brands: [] })
          }
        }
        if (statsResult?.item) {
          setStockStats(statsResult.item)
          setStockStatsLoaded(true)
          setStatsRefreshError('')
        } else if (loadedOnceRef.current) {
          setStatsRefreshError(tr('inventory_stats_refresh_failed', 'Inventory stats could not refresh. Showing the last confirmed values.', 'មិនអាចធ្វើបច្ចុប្បន្នភាពស្ថិតិស្តុកបានទេ។ កំពុងបង្ហាញតម្លៃចុងក្រោយដែលបានបញ្ជាក់។'))
        }
        if (Array.isArray(movs)) {
          setMovements(movs || [])
          setMovementMeta((current) => ({
            ...current,
            total: movs.length,
            totalPages: 1,
          }))
        } else if (movs && typeof movs === 'object') {
          setMovements(Array.isArray(movs.items) ? movs.items : [])
          setMovementMeta({
            total: Number(movs.total || 0),
            page: Number(movs.page || movementMeta.page) || 1,
            pageSize: Number(movs.pageSize || movementMeta.pageSize) || movementMeta.pageSize,
            totalPages: Number(movs.totalPages || 1) || 1,
          })
        }
        if (rfid?.item) setRfidStatus(rfid.item)
        if (Array.isArray(brs)) setBranches(brs.filter((branch) => branch.is_active))
        if (dash && typeof dash === 'object') {
          setTaxDelivery({
            tax: dash.all_tax_usd || 0,
            delivery: dash.all_delivery_usd || 0,
            deliveryCount: dash.all_delivery_count || 0,
          })
        }
        if (Array.isArray(rets)) {
          const active = rets.filter((ret) => (ret.status || 'completed') !== 'cancelled')
          const customerReturns = active.filter((ret) => (ret.return_scope || 'customer') !== 'supplier')
          const supplierReturns = active.filter((ret) => (ret.return_scope || 'customer') === 'supplier')
          const totalItems = customerReturns.reduce((sumItems, ret) => sumItems + (ret.items?.reduce((acc, item) => acc + (item.quantity || 0), 0) || 0), 0)
          setReturnStats({
            count: customerReturns.length,
            refund_usd: customerReturns.reduce((sumRefund, ret) => sumRefund + (ret.total_refund_usd || 0), 0),
            refund_khr: customerReturns.reduce((sumRefund, ret) => sumRefund + (ret.total_refund_khr || 0), 0),
            items: totalItems,
            restock: customerReturns.filter((ret) => (ret.return_type || 'restock') === 'restock').length,
            supplier_count: supplierReturns.length,
            supplier_compensation_usd: supplierReturns.reduce((sumCompensation, ret) => sumCompensation + (ret.supplier_compensation_usd || 0), 0),
            supplier_loss_usd: supplierReturns.reduce((sumLoss, ret) => sumLoss + (ret.supplier_loss_usd || 0), 0),
          })
        }
        if (!result.hasAnySuccess) {
          throw new Error(getFirstLoaderError(result.errors, 'Failed to load inventory'))
        }
        loadedOnceRef.current = true
        setLoadError(null)
      } catch (e) {
        if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
        console.warn('[Inventory] load failed:', e.message)
        if (!silent && !loadedOnceRef.current) {
          setLoadError(e.message || 'Failed to load inventory')
        } else if (!silent) {
          setLoadError(tr('inventory_refresh_failed', 'Inventory could not refresh right now. Showing the latest loaded data.', 'មិនអាចធ្វើបច្ចុប្បន្នភាពស្តុកបានទេ។ កំពុងបង្ហាញទិន្នន័យចុងក្រោយដែលបានផ្ទុក។'))
        }
      } finally {
        window.clearTimeout(loadWatchdogRef.current)
        if (!silent && isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
      }
    })()
    const wrappedPromise = promise.finally(() => {
      if (loadPromiseRef.current === wrappedPromise) loadPromiseRef.current = null
    })
    loadPromiseRef.current = wrappedPromise
    return wrappedPromise
  }, [
    branchFilter,
    brandFilter,
    deferredSearch,
    groupFilter,
    inventoryInitialFilter,
    inventoryProductPage,
    inventoryProductPageSize,
    isAdmin,
    movementUserFilter,
    movementStartDate,
    movementEndDate,
    movementMeta.page,
    movementMeta.pageSize,
    searchMode,
    stockFilter,
    tr,
  ])

  useEffect(() => {
    if (!isActive) {
      window.clearTimeout(loadWatchdogRef.current)
      invalidateTrackedRequest(loadRequestRef)
      loadPromiseRef.current = null
      setLoading(false)
      return
    }
    load(loadedOnceRef.current)
  }, [isActive, load])
  useEffect(() => {
    if (!isActive) return
    loadInventoryReasons()
  }, [isActive, loadInventoryReasons])
  useEffect(() => {
    if (!isActive || !syncChannel?.channel) return
    const ch = syncChannel.channel
    if (ch === 'inventory' || ch === 'products' || ch === 'sales' || ch === 'returns') load(true)
  }, [isActive, load, syncChannel?.channel, syncChannel?.ts])

  const saveReasonCatalog = useCallback(async (nextItems) => {
    setSavingReasons(true)
    try {
      const result = await window.api.saveInventoryReasons?.(nextItems)
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [])

  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `${reasonManager.type}:${Date.now()}`, type: reasonManager.type, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, reasonManager.type, saveReasonCatalog])

  const renameSavedReason = useCallback(async (entry) => {
    const nextLabel = window.prompt(tr('rename_reason_prompt', 'Rename saved reason', 'ប្ដូរឈ្មោះមូលហេតុដែលបានរក្សាទុក'), entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => item.id === entry.id ? { ...item, label: nextLabel.trim() } : item)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])

  const deleteSavedReason = useCallback(async (entry) => {
    if (!window.confirm(tr('delete_saved_reason_confirm', `Delete saved reason "${entry?.label || ''}"?`, `លុបមូលហេតុ "${entry?.label || ''}"?`))) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog, tr])
  useEffect(() => {
    if (!isActive || !isAdmin) return
    window.api.getUsers()
      .then((rows) => setUserOptions(Array.isArray(rows) ? rows : []))
      .catch(() => setUserOptions([]))
  }, [isActive, isAdmin])
  useEffect(() => () => {
    window.clearTimeout(loadWatchdogRef.current)
    invalidateTrackedRequest(loadRequestRef)
    loadPromiseRef.current = null
  }, [])

  const getStockQty = useCallback((product) => {
    if (!product) return 0
    if (branchFilter !== 'all') return product.display_quantity ?? product.stock_quantity ?? 0
    return product.stock_quantity ?? 0
  }, [branchFilter])
  const parentProductIds = useMemo(() => new Set(
    summary
      .map((product) => Number(product?.parent_id || 0))
      .filter(Boolean),
  ), [summary])
  const adjustTargetOptions = useMemo(() => {
    if (!adjustModal) return []
    const selectedId = Number(adjustModal.id || 0)
    const familyRootId = Number(adjustModal.parent_id || selectedId)
    return summary.filter((product) => {
      const productId = Number(product?.id || 0)
      const parentId = Number(product?.parent_id || 0)
      return productId === selectedId || productId === familyRootId || parentId === familyRootId
    })
  }, [adjustModal, summary])

  const handleAdjust = async () => {
    if (adjustSaving) return
    const qty = parseFloat(adjustForm.quantity)
    if (!qty || qty <= 0) return notify('Invalid quantity', 'error')
    const selectedAdjustProduct = summary.find((product) => Number(product.id) === Number(adjustForm.product_id || adjustModal?.id)) || adjustModal
    const previousSnapshot = cloneHistorySnapshot(selectedAdjustProduct)
    const numericBranchId = adjustForm.branch_id ? parseInt(adjustForm.branch_id, 10) : null
    const previousQuantity = numericBranchId
      ? Number((selectedAdjustProduct?.branch_stock || []).find((entry) => Number(entry?.branch_id || 0) === numericBranchId)?.quantity || 0)
      : Number(getStockQty(selectedAdjustProduct) || 0)
    const adjustmentRequest = {
      productId: selectedAdjustProduct.id,
      productName: selectedAdjustProduct.name,
      type: adjustForm.type,
      quantity: qty,
      unitCostUsd: parseFloat(adjustForm.unit_cost_usd) || 0,
      unitCostKhr: parseFloat(adjustForm.unit_cost_khr) || 0,
      reason: adjustForm.reason || '',
      branchId: numericBranchId,
      userId: user?.id,
      userName: user?.name || user?.username,
    }
    if (adjustForm.type === 'remove') {
      if (numericBranchId) {
        const bs = (adjustModal.branch_stock || []).find(s => s.branch_id === numericBranchId)
        const available = bs?.quantity || 0
        if (available <= 0) { notify(t('error')||'No stock in this branch to remove', 'error'); return }
        if (qty > available) { notify(`Cannot remove ${qty} - only ${available} available`, 'error'); return }
      } else {
        const totalQty = getStockQty(adjustModal)
        if (totalQty <= 0) { notify('No stock available to remove', 'error'); return }
        if (qty > totalQty) { notify(`Cannot remove ${qty} - only ${totalQty} available`, 'error'); return }
      }
    }
    setAdjustSaving(true)
    try {
      const res = await window.api.adjustStock(adjustmentRequest)
      if (res?.success) {
        actionHistory.pushAction({
          label: `Adjust stock for ${previousSnapshot?.name || adjustModal?.name || 'product'}`,
          undo: async () => {
            const inverseRequest = adjustmentRequest.type === 'set'
              ? { ...adjustmentRequest, type: 'set', quantity: previousQuantity, reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
              : adjustmentRequest.type === 'remove'
                ? { ...adjustmentRequest, type: 'add', reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
                : { ...adjustmentRequest, type: 'remove', reason: `Undo: ${adjustmentRequest.reason || 'inventory adjustment'}` }
            const undoResult = await window.api.adjustStock(inverseRequest)
            if (!undoResult?.success) throw new Error(undoResult?.error || 'Failed to undo stock adjustment')
            await load(true)
          },
          redo: async () => {
            const redoResult = await window.api.adjustStock({ ...adjustmentRequest, reason: `Redo: ${adjustmentRequest.reason || 'inventory adjustment'}` })
            if (!redoResult?.success) throw new Error(redoResult?.error || 'Failed to redo stock adjustment')
            await load(true)
          },
        })
        notify('Stock adjusted')
        setAdjustModal(null)
        await load(true)
      }
      else notify(res?.error || 'Adjustment failed', 'error')
    } catch (e) { notify(e?.message || 'Error', 'error') }
    finally { setAdjustSaving(false) }
  }

  const openAdjust = (p) => {
    setAdjustModal(p)
    const defaultBranchId = branches.find(branch => branch.is_default)?.id?.toString() || branches[0]?.id?.toString() || ''
    setAdjustForm({ product_id: p.id, type:'add', quantity:1, unit_cost_usd: p.purchase_price_usd || p.cost_price_usd || 0, unit_cost_khr: p.purchase_price_khr || 0, reason:'', branch_id: defaultBranchId })
  }

  const openMove = (p) => {
    setMoveModal(p)
    const defaultBranchId = branchFilter !== 'all'
      ? String(branchFilter)
      : branches.find(branch => branch.is_default)?.id?.toString() || branches[0]?.id?.toString() || ''
    setMoveForm({
      mode: 'existing',
      destination_product_id: '',
      destination_name: `${p.name} - ${tr('damaged', 'Damaged', 'ខូច')}`,
      quantity: 1,
      branch_id: defaultBranchId,
      reason: 'broken',
      note: '',
      selling_price_usd: p.selling_price_usd || '',
      special_price_usd: p.special_price_usd || '',
      discount_enabled: false,
      discount_type: 'percent',
      discount_percent: '',
      discount_amount_usd: '',
    })
  }

  const openTransfer = (p) => {
    const branchStock = Array.isArray(p?.branch_stock) ? p.branch_stock : []
    const firstStockBranch = branchStock.find((item) => Number(item?.quantity || 0) > 0)?.branch_id
    const defaultSourceId = branchFilter !== 'all'
      ? String(branchFilter)
      : String(firstStockBranch || branches.find((branch) => branch.is_default)?.id || branches[0]?.id || '')
    const defaultDestinationId = String(
      branches.find((branch) => String(branch.id) !== defaultSourceId)?.id
      || branches[0]?.id
      || '',
    )
    setTransferModal(p)
    setTransferForm({
      from_branch_id: defaultSourceId,
      to_branch_id: defaultDestinationId !== defaultSourceId ? defaultDestinationId : '',
      quantity: 1,
      reason: '',
    })
  }

  const openMovementProductDetail = useCallback(async (movement) => {
    const productId = Number(movement?.product_id || 0)
    const current = productId ? summary.find((product) => Number(product.id) === productId) : null
    if (current) {
      setDetailProduct(current)
      return
    }
    if (productId && window.api.getProductsByIds) {
      try {
        const result = await window.api.getProductsByIds([productId], { include: 'branch_stock,images' })
        const product = Array.isArray(result?.items) ? result.items[0] : null
        if (product) {
          setDetailProduct(product)
          return
        }
      } catch (_) {}
    }
    setDetailProduct({
      id: productId || movement?.id,
      name: movement?.product_name || t('product') || 'Product',
      stock_quantity: Number(movement?.quantity || 0),
      unit: movement?.unit || '',
      purchase_price_usd: Number(movement?.unit_cost_usd || 0),
      purchase_price_khr: Number(movement?.unit_cost_khr || 0),
      branch_stock: movement?.branch_id ? [{
        branch_id: movement.branch_id,
        branch_name: movement.branch_name || '',
        quantity: Number(movement.quantity || 0),
      }] : [],
    })
  }, [summary, t])

  const handleMoveStock = async () => {
    if (moveSaving || !moveModal) return
    const qty = parseFloat(moveForm.quantity)
    if (!qty || qty <= 0) return notify(tr('invalid_quantity', 'Invalid quantity', 'ចំនួនមិនត្រឹមត្រូវ'), 'error')
    const request = {
      sourceProductId: moveModal.id,
      destinationProductId: moveForm.mode === 'existing' ? Number(moveForm.destination_product_id || 0) : null,
      destinationProduct: moveForm.mode === 'new'
        ? {
            name: moveForm.destination_name,
            selling_price_usd: moveForm.selling_price_usd,
            special_price_usd: moveForm.special_price_usd,
            discount_enabled: moveForm.discount_enabled ? 1 : 0,
            discount_type: moveForm.discount_type,
            discount_percent: moveForm.discount_percent,
            discount_amount_usd: moveForm.discount_amount_usd,
          }
        : null,
      branchId: moveForm.branch_id || null,
      quantity: qty,
      reason: moveForm.reason || 'stock move',
      note: moveForm.note || '',
      userId: user?.id,
      userName: user?.name || user?.username,
    }
    if (moveForm.mode === 'existing' && !request.destinationProductId) {
      return notify(tr('choose_destination_product', 'Choose a destination product row.', 'សូមជ្រើសរើសជួរផលិតផលគោលដៅ។'), 'error')
    }
    if (moveForm.mode === 'new' && !String(moveForm.destination_name || '').trim()) {
      return notify(tr('name_required_alert', 'Name is required', 'ត្រូវការឈ្មោះ'), 'error')
    }
    setMoveSaving(true)
    try {
      const result = await window.api.moveStockRow(request)
      if (!result?.success) throw new Error(result?.error || tr('stock_move_failed', 'Stock move failed', 'ការផ្លាស់ទីស្តុកបានបរាជ័យ'))
      actionHistory.pushAction({
        label: `${tr('move_stock', 'Move stock', 'ផ្លាស់ទីស្តុក')}: ${moveModal.name}`,
        undo: async () => {
          const undoResult = await window.api.moveStockRow({
            sourceProductId: result.destinationProductId || request.destinationProductId,
            destinationProductId: request.sourceProductId,
            branchId: request.branchId,
            quantity: qty,
            reason: `Undo: ${request.reason}`,
          })
          if (!undoResult?.success) throw new Error(undoResult?.error || tr('undo_failed', 'Undo failed', 'Undo បានបរាជ័យ'))
          await load(true)
        },
        redo: async () => {
          const redoResult = await window.api.moveStockRow(request)
          if (!redoResult?.success) throw new Error(redoResult?.error || tr('redo_failed', 'Redo failed', 'Redo បានបរាជ័យ'))
          await load(true)
        },
      })
      notify(tr('stock_moved', 'Stock moved', 'បានផ្លាស់ទីស្តុក'))
      setMoveModal(null)
      await load(true)
    } catch (error) {
      notify(error?.message || tr('stock_move_failed', 'Stock move failed', 'ការផ្លាស់ទីស្តុកបានបរាជ័យ'), 'error')
    } finally {
      setMoveSaving(false)
    }
  }

  const handleTransferStock = async () => {
    if (transferSaving || !transferModal) return
    const quantity = Number.parseFloat(transferForm.quantity)
    if (!transferForm.from_branch_id || !transferForm.to_branch_id) {
      notify(tr('select_transfer_branches', 'Choose both source and destination branches.', 'សូមជ្រើសរើសទាំងសាខាដើម និងសាខាគោលដៅ។'), 'error')
      return
    }
    if (transferForm.from_branch_id === transferForm.to_branch_id) {
      notify(tr('transfer_branch_must_differ', 'Source and destination branches must be different.', 'សាខាដើម និងសាខាគោលដៅ ត្រូវតែខុសគ្នា។'), 'error')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      notify(tr('invalid_quantity', 'Invalid quantity', 'ចំនួនមិនត្រឹមត្រូវ'), 'error')
      return
    }
    if (!String(transferForm.reason || '').trim()) {
      notify(tr('transfer_reason_required', 'A transfer reason is required.', 'ត្រូវការមូលហេតុសម្រាប់ការផ្ទេរ។'), 'error')
      return
    }

    setTransferSaving(true)
    try {
      const result = await window.api.transferInventoryStock({
        productId: transferModal.id,
        fromBranchId: transferForm.from_branch_id,
        toBranchId: transferForm.to_branch_id,
        quantity,
        reason: transferForm.reason,
        userId: user?.id,
        userName: user?.name || user?.username,
      })
      if (!result?.success) throw new Error(result?.error || tr('stock_transfer_failed', 'Stock transfer failed', 'ការផ្ទេរស្តុកបានបរាជ័យ'))
      notify(tr('stock_transferred', 'Stock transferred', 'បានផ្ទេរស្តុក'))
      setTransferModal(null)
      await load(true)
    } catch (error) {
      notify(error?.message || tr('stock_transfer_failed', 'Stock transfer failed', 'ការផ្ទេរស្តុកបានបរាជ័យ'), 'error')
    } finally {
      setTransferSaving(false)
    }
  }

  // Search: comma-separated terms, AND/OR mode matching Products page behaviour
  const searchTerms = deferredSearch.trim()
    ? deferredSearch.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : []

  const matchesSearch = (hay) => {
    if (!searchTerms.length) return true
    return searchMode === 'AND'
      ? searchTerms.every(term => hay.includes(term))
      : searchTerms.some(term => hay.includes(term))
  }

  const productHay = (p) =>
    `${p.name} ${p.category||''} ${p.brand||''} ${p.supplier||''} ${p.sku||''} ${p.barcode||''} ${p.description||''} ${p.unit||''}`.toLowerCase()

  const movHay = (m) =>
    `${m.product_name||''} ${m.branch_name||''} ${m.reason||''} ${m.user_name||''} ${m.movement_type||''}`.toLowerCase()

  const filteredSummary = summary.filter(p => {
    if (!matchesSearch(productHay(p))) return false
    if (brandFilter !== 'all' && String(p.brand || '').toLowerCase() !== brandFilter.toLowerCase()) return false
    const isParent = Boolean(p.is_group || parentProductIds.has(Number(p.id)))
    const isVariant = Boolean(p.parent_id)
    if (groupFilter === 'grouped' && !isParent && !isVariant) return false
    if (groupFilter === 'parent' && (!isParent || isVariant)) return false
    if (groupFilter === 'variant' && !isVariant) return false
    if (groupFilter === 'standalone' && (isParent || isVariant)) return false
    const qty = getStockQty(p)
    if (stockFilter === 'low')      return qty > 0 && qty <= p.low_stock_threshold
    if (stockFilter === 'out')      return qty <= (p.out_of_stock_threshold || 0)
    if (stockFilter === 'in_stock') return qty > (p.low_stock_threshold || 0)
    return true
  })

  useEffect(() => {
    setInventoryProductPage(1)
  }, [branchFilter, brandFilter, deferredSearch, groupFilter, inventoryInitialFilter, searchMode, stockFilter, tab])

  useEffect(() => {
    setMovementMeta((current) => ({ ...current, page: 1 }))
  }, [branchFilter, movementEndDate, movementStartDate, movementUserFilter])

  const pagedSummary = useMemo(
    () => filteredSummary,
    [filteredSummary],
  )

  useEffect(() => {
    const validIds = new Set(filteredSummary.map((product) => Number(product.id)).filter((id) => Number.isFinite(id)))
    setSelectedProductIds((current) => reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id))))
  }, [filteredSummary])

  useEffect(() => {
    if (!inventorySelectAllRef.current) return
    inventorySelectAllRef.current.indeterminate = selectedProductIds.size > 0 && selectedProductIds.size < filteredSummary.length
  }, [filteredSummary.length, selectedProductIds.size])

  const toggleSelectedProduct = useCallback((productId) => {
    const numericId = Number(productId)
    if (!Number.isFinite(numericId)) return
    setSelectedProductIds((current) => toggleIdSet(current, [numericId], !current.has(numericId)))
  }, [])

  const toggleSelectAllProducts = useCallback((checked) => {
    if (!checked) {
      setSelectedProductIds(new Set())
      return
    }
    setSelectedProductIds(new Set(filteredSummary.map((product) => Number(product.id)).filter((id) => Number.isFinite(id))))
  }, [filteredSummary])

  const selectedProducts = useMemo(
    () => filteredSummary.filter((product) => selectedProductIds.has(Number(product.id))),
    [filteredSummary, selectedProductIds],
  )
  const hasSelectedProducts = selectedProducts.length > 0

  const buildBatchDraft = useCallback((product) => {
    const defaultBranchId = branchFilter !== 'all'
      ? String(branchFilter)
      : branches.find((branch) => branch.is_default)?.id?.toString() || branches[0]?.id?.toString() || ''
    const branchStock = Array.isArray(product?.branch_stock) ? product.branch_stock : []
    const firstStockBranch = branchStock.find((item) => Number(item?.quantity || 0) > 0)?.branch_id
    const defaultSourceId = branchFilter !== 'all'
      ? String(branchFilter)
      : String(firstStockBranch || branches.find((branch) => branch.is_default)?.id || branches[0]?.id || '')
    const defaultDestinationId = String(
      branches.find((branch) => String(branch.id) !== defaultSourceId)?.id
      || branches[0]?.id
      || '',
    )
    return {
      id: Number(product.id),
      productId: Number(product.id),
      productName: product.name,
      unit: product.unit || '',
      quantity: '1',
      action: 'adjust',
      adjustType: 'add',
      branchId: defaultBranchId,
      fromBranchId: defaultSourceId,
      toBranchId: defaultDestinationId !== defaultSourceId ? defaultDestinationId : '',
      reason: '',
      note: '',
      moveMode: 'existing',
      destinationProductId: '',
      destinationName: `${product.name} - ${tr('damaged', 'Damaged', 'ខូច')}`,
      sellingPriceUsd: product.selling_price_usd || '',
      specialPriceUsd: product.special_price_usd || '',
      discountEnabled: false,
      discountType: 'percent',
      discountPercent: '',
      discountAmountUsd: '',
      unitCostUsd: product.purchase_price_usd || product.cost_price_usd || 0,
      unitCostKhr: product.purchase_price_khr || 0,
      stockQty: getStockQty(product),
      error: '',
    }
  }, [branchFilter, branches, getStockQty, tr])

  const openInventoryBatchSession = useCallback(() => {
    if (!selectedProducts.length) return
    setInventoryBatch({
      items: selectedProducts.map((product) => buildBatchDraft(product)),
    })
  }, [buildBatchDraft, selectedProducts])

  const updateInventoryBatchLine = useCallback((productId, patch) => {
    setInventoryBatch((current) => {
      if (!current?.items?.length) return current
      return {
        ...current,
        items: current.items.map((item) => (
          Number(item.productId) === Number(productId)
            ? { ...item, ...patch, error: patch?.error ?? '' }
            : item
        )),
      }
    })
  }, [])

  const removeInventoryBatchLine = useCallback((productId) => {
    const numericId = Number(productId)
    setInventoryBatch((current) => {
      if (!current?.items?.length) return current
      const nextItems = current.items.filter((item) => Number(item.productId) !== numericId)
      return nextItems.length ? { ...current, items: nextItems } : null
    })
    setSelectedProductIds((current) => {
      const next = new Set(current)
      next.delete(numericId)
      return next
    })
  }, [])

  const applyInventoryBatchSession = useCallback(async () => {
    if (batchApplying || !inventoryBatch?.items?.length) return
    setBatchApplying(true)
    const failedItems = []
    let successCount = 0
    try {
      for (const item of inventoryBatch.items) {
        const quantity = Number.parseFloat(item.quantity)
        try {
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error(tr('invalid_quantity', 'Invalid quantity', 'ចំនួនមិនត្រឹមត្រូវ'))
          }
          if (item.action === 'adjust') {
            const result = await window.api.adjustStock({
              productId: item.productId,
              productName: item.productName,
              type: item.adjustType,
              quantity,
              reason: item.reason || tr('inventory_adjustment', 'Inventory adjustment', 'កែសម្រួលស្តុក'),
              branchId: item.branchId,
              unitCostUsd: item.unitCostUsd,
              unitCostKhr: item.unitCostKhr,
            })
            if (!result?.success) throw new Error(result?.error || tr('adjust_failed', 'Adjustment failed', 'ការកែសម្រួលបានបរាជ័យ'))
          } else if (item.action === 'transfer') {
            const result = await window.api.transferInventoryStock({
              productId: item.productId,
              fromBranchId: item.fromBranchId,
              toBranchId: item.toBranchId,
              quantity,
              reason: item.reason,
            })
            if (!result?.success) throw new Error(result?.error || tr('transfer_failed', 'Transfer failed', 'ការផ្ទេរបានបរាជ័យ'))
          } else if (item.action === 'move') {
            const request = {
              sourceProductId: item.productId,
              destinationProductId: item.moveMode === 'existing' ? Number(item.destinationProductId || 0) : null,
              branchId: item.branchId,
              quantity,
              reason: item.reason || 'broken',
              note: item.note || '',
            }
            if (item.moveMode === 'new') {
              request.destinationProduct = {
                name: item.destinationName,
                selling_price_usd: item.sellingPriceUsd,
                special_price_usd: item.specialPriceUsd,
                discount_enabled: !!item.discountEnabled,
                discount_type: item.discountType,
                discount_percent: item.discountPercent,
                discount_amount_usd: item.discountAmountUsd,
              }
            }
            const result = await window.api.moveStockRow(request)
            if (!result?.success) throw new Error(result?.error || tr('stock_move_failed', 'Stock move failed', 'ការផ្លាស់ទីស្តុកបានបរាជ័យ'))
          }
          successCount += 1
        } catch (error) {
          failedItems.push({ ...item, error: error?.message || tr('save_failed', 'Save failed', 'ការរក្សាទុកបានបរាជ័យ') })
        }
      }
      await load(true)
      if (!failedItems.length) {
        setInventoryBatch(null)
        setSelectedProductIds(new Set())
        notify(
          successCount === 1
            ? tr('batch_inventory_done_one', 'Applied inventory update.', 'បានអនុវត្តបច្ចុប្បន្នភាពស្តុក។')
            : tr('batch_inventory_done_many', `${successCount} inventory updates applied.`, `${successCount} បច្ចុប្បន្នភាពស្តុកត្រូវបានអនុវត្ត។`),
        )
        return
      }
      setInventoryBatch({ items: failedItems })
      setSelectedProductIds(new Set(failedItems.map((item) => Number(item.productId)).filter((id) => Number.isFinite(id))))
      notify(
        tr(
          'batch_inventory_partial_failure',
          `${successCount} applied, ${failedItems.length} need review.`,
          `${successCount} បានអនុវត្ត ហើយ ${failedItems.length} ត្រូវពិនិត្យឡើងវិញ។`,
        ),
        'warning',
      )
    } finally {
      setBatchApplying(false)
    }
  }, [batchApplying, inventoryBatch, load, notify, tr])

  const filteredMovements = movements.filter(m => {
    if (movFilter !== 'all' && m.movement_type !== movFilter) return false
    return matchesSearch(movHay(m))
  })

  const groupedMovements = useMemo(() => (
    buildMovementGroups(filteredMovements).filter((group) => matchesSearch(movementGroupHaystack(group)))
  ), [filteredMovements, searchTerms, searchMode])

  const movementYears = useMemo(
    () => getAvailableYears(groupedMovements, (group) => group?.latest_at || group?.created_at),
    [groupedMovements],
  )

  const movementSections = useMemo(() => (
    buildTimeActionSections(groupedMovements, {
      getDate: (group) => group?.latest_at || group?.created_at,
      getItemId: (group) => group?.id,
      getActionKey: (group) => group?.movement_type || 'other',
      getActionLabel: (group) => group?.movementLabel || group?.movement_type || 'Other',
      year: movementYearFilter,
      month: movementMonthFilter,
      timeMode: movementTimeMode,
      groupMode: movementGroupMode,
      sortDirection: movementSortDirection,
    })
  ), [groupedMovements, movementGroupMode, movementMonthFilter, movementSortDirection, movementTimeMode, movementYearFilter])

  const visibleMovementGroups = useMemo(
    () => movementSections.flatMap((section) => section.groups.flatMap((group) => group.items)),
    [movementSections],
  )

  useEffect(() => {
    setExpandedMovementGroups((current) => {
      const validIds = new Set(visibleMovementGroups.map((group) => group.id))
      return reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id)))
    })
  }, [visibleMovementGroups])

  useEffect(() => {
    setExpandedMovementPages((current) => Object.fromEntries(
      Object.entries(current).filter(([groupId]) => visibleMovementGroups.some((group) => group.id === groupId)),
    ))
  }, [visibleMovementGroups])

  useEffect(() => {
    const validIds = new Set(visibleMovementGroups.map((group) => group.id))
    setSelectedMovementIds((current) => reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id))))
  }, [visibleMovementGroups])

  useEffect(() => {
    if (!movementSelectAllRef.current) return
    movementSelectAllRef.current.indeterminate = selectedMovementIds.size > 0 && selectedMovementIds.size < visibleMovementGroups.length
  }, [selectedMovementIds.size, visibleMovementGroups.length])

  const toggleMovementGroup = useCallback((groupId) => {
    setExpandedMovementGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
    setExpandedMovementPages((current) => ({ ...current, [groupId]: current[groupId] || 1 }))
  }, [])

  const setExpandedMovementGroupPage = useCallback((groupId, page) => {
    setExpandedMovementPages((current) => ({ ...current, [groupId]: Math.max(1, Number(page || 1) || 1) }))
  }, [])

  const toggleMovementSelection = useCallback((groupId) => {
    setSelectedMovementIds((current) => toggleIdSet(current, [groupId], !current.has(groupId)))
  }, [])

  const toggleMovementScopeSelection = useCallback((ids, checked) => {
    setSelectedMovementIds((current) => toggleIdSet(current, ids, checked))
  }, [])

  const toggleAllMovementSelection = useCallback((checked) => {
    if (!checked) {
      setSelectedMovementIds(new Set())
      return
    }
    setSelectedMovementIds(new Set(visibleMovementGroups.map((group) => group.id)))
  }, [visibleMovementGroups])

  const toggleMovementSectionCollapsed = useCallback((sectionId) => {
    setCollapsedMovementSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  useEffect(() => {
    setCollapsedMovementSections((current) => {
      const validIds = new Set(movementSections.map((section) => section.id))
      return reuseSetWhenUnchanged(current, [...current].filter((id) => validIds.has(id)))
    })
  }, [movementSections])

  const MOV_COLORS = {
    add:             'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    remove:          'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
    sale:            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
    purchase:        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    return:          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    supplier_return: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300',
    return_reversal: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
    adjust:          'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    adjustment:      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    set:             'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    writeoff:        'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200',
    transfer:        'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    row_move_in:     'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
    row_move_out:    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  }

  // Stats ??backend SQL already nets out returned quantities and revenue
  const visibleTotalValue = filteredSummary.reduce((s, p) => s + (p.stock_value_usd || 0), 0)
  const visibleLowStockCount = filteredSummary.filter(p => {
    const qty = getStockQty(p)
    return qty > 0 && qty <= p.low_stock_threshold
  }).length
  const visibleOutStockCount = filteredSummary.filter(p => getStockQty(p) <= (p.out_of_stock_threshold || 0)).length
  const totalValue = Number(stockStats?.stock_value_usd ?? visibleTotalValue)
  const lowStockCount = Number(stockStats?.low_stock ?? visibleLowStockCount)
  const outStockCount = Number(stockStats?.out_of_stock ?? visibleOutStockCount)
  const inStockCount = Number(stockStats?.in_stock ?? filteredSummary.filter((p) => getStockQty(p) > (p.out_of_stock_threshold || 0)).length)
  const totalProducts = Number(
    stockStats?.total_products
    ?? (inventoryProductsLoaded ? inventoryProductTotal : null)
    ?? summary.length,
  )
  const totalQtySold  = filteredSummary.reduce((s, p) => s + Math.max(0, p.qty_sold || 0), 0)
  const totalRevenue  = filteredSummary.reduce((s, p) => s + Math.max(0, p.revenue_usd || 0), 0)
  const totalCOGS     = filteredSummary.reduce((s, p) => s + Math.max(0, p.cogs_usd || 0), 0)
  const totalStoreDiscounts = filteredSummary.reduce((s, p) => s + Math.max(0, p.store_discount_usd || 0), 0)
  const totalMembershipDiscounts = filteredSummary.reduce((s, p) => s + Math.max(0, p.membership_discount_usd || 0), 0)
  const totalProfit   = totalRevenue - totalCOGS
  const inventoryProductSafePageSize = Math.max(1, Number(inventoryProductPageSize || PAGE_SIZE_OPTIONS[0]))
  const inventoryProductSafePage = clampPage(inventoryProductPage, totalProducts, inventoryProductSafePageSize)
  const inventoryProductTotalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalProducts || 0)) / inventoryProductSafePageSize))
  const inventoryProductStart = totalProducts ? (((inventoryProductSafePage - 1) * inventoryProductSafePageSize) + 1) : 0
  const inventoryProductEnd = totalProducts ? Math.min(totalProducts, inventoryProductSafePage * inventoryProductSafePageSize) : 0
  const inventoryProductSummaryLabel = totalProducts
    ? `${inventoryProductStart.toLocaleString()}-${inventoryProductEnd.toLocaleString()} / ${Number(totalProducts || 0).toLocaleString()}`
    : '0 / 0'
  const inventoryControlLabels = useMemo(() => ({
    selected: tr('inventory_selected_count', `${selectedProducts.length} selected`, `${selectedProducts.length} បានជ្រើស`),
    selectAll: `${t('select_all') || 'Select all'} (${filteredSummary.length})`,
    batch: tr('inventory_batch_session', 'Batch', 'សម័យបាច់'),
    reasons: tr('saved_reasons', 'Reasons', 'មូលហេតុ'),
  }), [filteredSummary.length, selectedProducts.length, t, tr])
  useEffect(() => {
    setInventoryProductPageDraft(String(inventoryProductSafePage))
  }, [inventoryProductSafePage])
  const commitInventoryProductPageDraft = useCallback(() => {
    const parsed = Number.parseInt(String(inventoryProductPageDraft || '').trim(), 10)
    if (!Number.isFinite(parsed)) {
      setInventoryProductPageDraft(String(inventoryProductSafePage))
      return
    }
    const nextPage = Math.min(inventoryProductTotalPages, Math.max(1, parsed))
    setInventoryProductPage(nextPage)
    setInventoryProductPageDraft(String(nextPage))
  }, [inventoryProductPageDraft, inventoryProductSafePage, inventoryProductTotalPages])
  const inventoryThresholdFormulaText = tr('inventory_formula_thresholds', 'Low/Out counts are derived from stock thresholds', 'ចំនួនស្តុកទាប និងអស់ស្តុក ត្រូវបានគណនាពីកម្រិតកំណត់ស្តុក។')
  const inventoryStockValueFormulaText = tr('inventory_formula_stock_value', 'Stock value = positive quantity x effective cost for all matching stock, not just the visible page', 'តម្លៃស្តុក = បរិមាណវិជ្ជមាន x ថ្លៃដើមជាក់ស្តែង សម្រាប់ស្តុកដែលត្រូវគ្នាទាំងអស់ មិនមែនតែទំព័រដែលមើលឃើញទេ។')
  const inventoryNetSoldFormulaText = tr('inventory_formula_net_sold', 'Net sold = sold quantity - returned quantity', 'លក់សុទ្ធ = បរិមាណដែលបានលក់ - បរិមាណដែលបានត្រឡប់')
  const inventoryRevenueFormulaText = tr('inventory_formula_revenue', 'Revenue shown is net after discounts and refunds', 'ចំណូលដែលបង្ហាញ គឺជាចំណូលសុទ្ធ បន្ទាប់ពីបញ្ចុះតម្លៃ និងការសងប្រាក់ត្រឡប់។')
  const inventoryCogsFormulaText = tr('inventory_formula_cogs', 'COGS excludes quantities restored by restocked returns', 'COGS មិនរាប់បញ្ចូលបរិមាណដែលត្រូវបានស្តារវិញពីការត្រឡប់ដែលបានដាក់ចូលស្តុកឡើងវិញទេ។')
  const inventoryProfitFormulaText = tr('inventory_formula_profit', 'Profit = Revenue - COGS', 'ប្រាក់ចំណេញ = ចំណូល - COGS')
  const inventoryDiscountFormulaText = tr('inventory_formula_discounts', 'Discount totals show store-funded and membership-funded reductions allocated across sold items.', 'សរុបការបញ្ចុះតម្លៃបង្ហាញការកាត់បន្ថយដែលចេញដោយហាង និងសមាជិកភាព ដែលត្រូវបានបែងចែកទៅផលិតផលដែលបានលក់។')
  const inventoryFeesFormulaText = tr('inventory_formula_fees', 'Fees collected combines sales tax and delivery fees captured on completed sales.', 'ថ្លៃដែលបានប្រមូល រួមបញ្ចូលពន្ធលើការលក់ និងថ្លៃដឹកជញ្ជូនពីការលក់ដែលបានបញ្ចប់។')
  const inventoryReturnsFormulaText = tr('inventory_formula_returns', 'Returns combines customer refunds and supplier return cases so you can review every recovery path together.', 'ការប្រគល់មកវិញ រួមបញ្ចូលការសងប្រាក់ជូនអតិថិជន និងករណីប្រគល់ទៅអ្នកផ្គត់ផ្គង់ ដើម្បីពិនិត្យផ្លូវស្ដារវិញទាំងអស់ក្នុងកន្លែងតែមួយ។')
  const statsValue = (value) => (stockStatsLoaded ? value : '...')
  const primaryStats = [
    {
      id: 'products',
      label: t('products'),
      value: statsValue(totalProducts),
      cls: 'text-gray-800 dark:text-gray-200',
      sub: stockStatsLoaded ? `${lowStockCount} ${t('low_stock') || 'low'} - ${outStockCount} ${t('out_of_stock') || 'out'}` : (t('loading') || 'Loading...'),
      details: [
        { label: t('products') || 'Products', value: totalProducts },
        { label: t('low_stock') || 'Low stock', value: lowStockCount },
        { label: t('out_of_stock') || 'Out of stock', value: outStockCount },
        { label: t('formula') || 'Formula', value: inventoryThresholdFormulaText },
      ],
    },
    {
      id: 'stock-value',
      label: t('stock_value'),
      value: statsValue(fmtUSD(totalValue)),
      cls: 'text-blue-700 dark:text-blue-300',
      details: [
        { label: t('stock_value') || 'Stock value', value: fmtUSD(totalValue) },
        { label: t('products') || 'Products', value: totalProducts },
        { label: t('formula') || 'Formula', value: inventoryStockValueFormulaText },
      ],
    },
    {
      id: 'net-sold',
      label: t('net_sold'),
      value: totalQtySold,
      cls: 'text-purple-700 dark:text-purple-300',
      sub: t('after_returns'),
      details: [
        { label: t('net_sold') || 'Net sold', value: totalQtySold },
        { label: t('returns_count') || 'Returns', value: returnStats?.count ?? 0 },
        { label: t('items') || 'Returned items', value: returnStats?.items ?? 0 },
        { label: t('formula') || 'Formula', value: inventoryNetSoldFormulaText },
      ],
    },
    {
      id: 'cogs',
      label: t('cogs'),
      value: fmtUSD(totalCOGS),
      cls: 'text-orange-600 dark:text-orange-400',
      sub: t('cost_of_goods_sold'),
      details: [
        { label: t('cogs') || 'COGS', value: fmtUSD(totalCOGS) },
        { label: t('store_discounts') || 'Store discounts', value: fmtUSD(totalStoreDiscounts) },
        { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(totalMembershipDiscounts) },
        { label: t('formula') || 'Formula', value: inventoryCogsFormulaText },
      ],
    },
    {
      id: 'revenue-profit',
      label: tr('revenue_profit', 'Revenue & Profit', 'ចំណូល និងចំណេញ'),
      value: fmtUSD(totalRevenue),
      cls: totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      sub: `${tr('gross_profit', 'Gross profit', 'ចំណេញដុល')} ${fmtUSD(totalProfit)}`,
      detailSections: [
        {
          title: t('revenue') || 'Revenue',
          rows: [
            { label: t('revenue') || 'Revenue', value: fmtUSD(totalRevenue) },
            { label: t('total_refunded') || 'Refunded', value: fmtUSD(returnStats?.refund_usd || 0) },
            { label: t('formula') || 'Formula', value: inventoryRevenueFormulaText },
          ],
        },
        {
          title: t('gross_profit') || 'Gross profit',
          rows: [
            { label: t('gross_profit') || 'Gross profit', value: fmtUSD(totalProfit) },
            { label: t('cogs') || 'COGS', value: fmtUSD(totalCOGS) },
            { label: t('formula') || 'Formula', value: inventoryProfitFormulaText },
          ],
        },
      ],
    },
  ]
  const financeStats = [
    {
      id: 'discounts',
      label: tr('discounts_combined', 'Discounts', 'ការបញ្ចុះតម្លៃ'),
      value: fmtUSD(totalStoreDiscounts + totalMembershipDiscounts),
      cls: 'text-amber-600 dark:text-amber-400',
      border: 'border-amber-400',
      sub: t('allocated_to_products') || 'Allocated to sold products',
      detailSections: [
        {
          title: tr('discount_breakdown', 'Discount breakdown', 'ការបំបែកការបញ្ចុះតម្លៃ'),
          rows: [
            { label: t('store_discounts') || 'Store discounts', value: fmtUSD(totalStoreDiscounts) },
            { label: t('membership_discounts') || 'Membership discounts', value: fmtUSD(totalMembershipDiscounts) },
            { label: tr('discounts_total', 'Total discounts', 'សរុបការបញ្ចុះតម្លៃ'), value: fmtUSD(totalStoreDiscounts + totalMembershipDiscounts) },
            { label: t('formula') || 'Formula', value: inventoryDiscountFormulaText },
          ],
        },
      ],
    },
    {
      id: 'fees',
      label: tr('fees_collected', 'Fees collected', 'ថ្លៃដែលបានប្រមូល'),
      value: fmtUSD((taxDelivery.tax || 0) + (taxDelivery.delivery || 0)),
      cls: 'text-indigo-600 dark:text-indigo-400',
      border: 'border-indigo-400',
      sub: `${t('tax_collected') || 'Tax'} + ${t('delivery_fees') || 'Delivery'}`,
      detailSections: [
        {
          title: tr('fees_breakdown', 'Fee breakdown', 'ការបំបែកថ្លៃសេវា'),
          rows: [
            { label: t('tax_collected') || 'Tax collected', value: fmtUSD(taxDelivery.tax || 0) },
            { label: t('delivery_fees') || 'Delivery fees', value: fmtUSD(taxDelivery.delivery || 0) },
            { label: t('transactions') || 'Transactions', value: taxDelivery.deliveryCount || 0 },
            { label: t('formula') || 'Formula', value: inventoryFeesFormulaText },
          ],
        },
      ],
    },
    {
      id: 'returns',
      label: tr('returns_combined', 'Returns', 'ការប្រគល់មកវិញ'),
      value: (returnStats?.count ?? 0) + (returnStats?.supplier_count ?? 0),
      cls: 'text-orange-600 dark:text-orange-400',
      border: 'border-orange-400',
      sub: `${returnStats?.count ?? 0} ${t('customer_returns') || 'customer'} • ${returnStats?.supplier_count ?? 0} ${t('supplier_returns') || 'supplier'}`,
      detailSections: [
        {
          title: t('returns_count') || 'Customer returns',
          rows: [
            { label: t('returns_count') || 'Returns', value: returnStats?.count ?? 0 },
            { label: t('total_refunded') || 'Refunded', value: fmtUSD(returnStats?.refund_usd || 0) },
            { label: t('items') || 'Items', value: returnStats?.items ?? 0 },
            { label: t('restocked_to_inventory') || 'Restocked', value: returnStats?.restock ?? 0 },
          ],
        },
        {
          title: t('supplier_returns') || 'Supplier returns',
          rows: [
            { label: t('supplier_returns') || 'Supplier returns', value: returnStats?.supplier_count ?? 0 },
            { label: t('supplier_compensation') || 'Compensation', value: fmtUSD(returnStats?.supplier_compensation_usd || 0) },
            { label: t('business_loss') || 'Business loss', value: fmtUSD(returnStats?.supplier_loss_usd || 0) },
            { label: t('formula') || 'Formula', value: inventoryReturnsFormulaText },
          ],
        },
      ],
    },
  ]
  const inventoryBrands = (Array.isArray(inventoryProductFilters.brands) && inventoryProductFilters.brands.length
    ? inventoryProductFilters.brands
    : [...new Set(summary.map((p) => String(p.brand || '').trim()).filter(Boolean))]
  ).sort((a, b) => a.localeCompare(b))
  const inventoryInitialOptions = useMemo(
    () => aggregateInitialOptions(Array.isArray(inventoryInitials) ? inventoryInitials : []),
    [inventoryInitials],
  )
  const selectedMovementGroups = visibleMovementGroups.filter((group) => selectedMovementIds.has(group.id))
  const exportStamp = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const movementDateRangeLabel = useMemo(() => {
    const timestamps = visibleMovementGroups
      .map((group) => group.latest_at || group.items?.[0]?.created_at || '')
      .map((raw) => {
        return parseInventoryTimestamp(raw)
      })
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime())
    if (!timestamps.length) {
      if (movementStartDate || movementEndDate) {
        return `${movementStartDate || '...'} - ${movementEndDate || '...'}`
      }
      if (movementYearFilter !== 'all' || movementMonthFilter !== 'all') {
        return `${movementYearFilter === 'all' ? 'All years' : movementYearFilter} / ${movementMonthFilter === 'all' ? 'All months' : movementMonthFilter}`
      }
      return 'All available movement dates'
    }
    return `${timestamps[0].toLocaleDateString()} - ${timestamps[timestamps.length - 1].toLocaleDateString()}`
  }, [movementEndDate, movementMonthFilter, movementStartDate, movementYearFilter, visibleMovementGroups])

  const visibleMovementQuantity = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.totalQuantity || 0), 0),
    [visibleMovementGroups],
  )
  const visibleMovementRecordCount = useMemo(
    () => visibleMovementGroups.reduce((sum, group) => sum + Number(group.items?.length || group.recordCount || 0), 0),
    [visibleMovementGroups],
  )
  const movementActivityRows = useMemo(() => {
    const map = new Map()
    visibleMovementGroups.forEach((group) => {
      const key = String(group.movement_type || group.movementLabel || 'other')
      const current = map.get(key) || {
        name: group.movementLabel || key,
        groups: 0,
        quantity: 0,
        total_cost_usd: 0,
      }
      current.groups += 1
      current.quantity += Number(group.totalQuantity || 0)
      current.total_cost_usd += Number(group.totalCostUsd || 0)
      map.set(key, current)
    })
    return [...map.values()].sort((left, right) => right.quantity - left.quantity || right.groups - left.groups)
  }, [visibleMovementGroups])

  const movementVolumeRows = useMemo(() => {
    const map = new Map()
    visibleMovementGroups.forEach((group) => {
      const raw = group.latest_at || group.items?.[0]?.created_at || ''
      const date = parseInventoryTimestamp(raw)
      if (!date) return
      const period = movementTimeMode === 'year'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : movementTimeMode === 'month'
          ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const current = map.get(period) || { period, count: 0, quantity: 0, total_cost_usd: 0 }
      current.count += Number(group.items?.length || 0)
      current.quantity += Number(group.totalQuantity || 0)
      current.total_cost_usd += Number(group.totalCostUsd || 0)
      map.set(period, current)
    })
    return [...map.values()]
  }, [movementTimeMode, visibleMovementGroups])

  const stockStatusRows = useMemo(() => ([
    { name: tr('in_stock', 'In Stock', 'មានស្តុក'), value: inStockCount },
    { name: tr('low_stock', 'Low Stock', 'ស្តុកទាប'), value: lowStockCount },
    { name: tr('out_of_stock', 'Out of Stock', 'អស់ស្តុក'), value: outStockCount },
  ]), [inStockCount, lowStockCount, outStockCount, tr])

  const topStockValueRows = useMemo(() => (
    [...filteredSummary]
      .sort((left, right) => Number(right.stock_value_usd || 0) - Number(left.stock_value_usd || 0))
      .slice(0, 10)
      .map((product) => ({
        Product: product.name || '',
        Stock_Value_USD: Number(product.stock_value_usd || 0),
        Stock_Qty: getStockQty(product),
        Revenue_USD: Number(product.revenue_usd || 0),
        Brand: product.brand || '',
      }))
  ), [filteredSummary, getStockQty])

  const branchComparisonRows = useMemo(() => {
    const map = new Map()
    filteredSummary.forEach((product) => {
      const cost = Number(product.purchase_price_usd || product.cost_price_usd || 0)
      if (Array.isArray(product.branch_stock) && product.branch_stock.length) {
        product.branch_stock.forEach((branchStock) => {
          const key = String(branchStock.branch_id || branchStock.branch_name || '')
          if (!key) return
          const current = map.get(key) || {
            branch_name: branchStock.branch_name || branches.find((branch) => String(branch.id) === key)?.name || key,
            quantity: 0,
            stock_value_usd: 0,
            product_count: 0,
          }
          const quantity = Number(branchStock.quantity || 0)
          current.quantity += quantity
          current.stock_value_usd += quantity * cost
          if (quantity > 0) current.product_count += 1
          map.set(key, current)
        })
      }
    })
    return [...map.values()].sort((left, right) => right.stock_value_usd - left.stock_value_usd || right.quantity - left.quantity)
  }, [branches, filteredSummary])

  const buildInventoryStatsRows = useCallback(() => ([
    { Section: 'Inventory Stats', Metric: 'View Tab', Value: tab },
    { Section: 'Inventory Stats', Metric: 'Branch Filter', Value: branchFilter === 'all' ? 'All branches' : (branches.find((branch) => String(branch.id) === String(branchFilter))?.name || branchFilter) },
    { Section: 'Inventory Stats', Metric: 'Brand Filter', Value: brandFilter === 'all' ? 'All brands' : brandFilter },
    { Section: 'Inventory Stats', Metric: 'Stock Filter', Value: stockFilter },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Date Range', Value: movementDateRangeLabel },
    { Section: 'Inventory Stats', Metric: 'Search', Value: search || '' },
    { Section: 'Inventory Stats', Metric: 'Movement Year Filter', Value: movementYearFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Month Filter', Value: movementMonthFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Type Filter', Value: movFilter },
    { Section: 'Inventory Stats', Metric: 'Movement Group Mode', Value: movementGroupMode },
    { Section: 'Inventory Stats', Metric: 'Movement Sort Direction', Value: movementSortDirection },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Groups', Value: visibleMovementGroups.length },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Records', Value: visibleMovementRecordCount },
    { Section: 'Inventory Stats', Metric: 'Visible Movement Quantity', Value: visibleMovementQuantity },
    { Section: 'Inventory Stats', Metric: 'Visible Products', Value: filteredSummary.length },
    { Section: 'Inventory Stats', Metric: 'Total Products', Value: totalProducts },
    { Section: 'Inventory Stats', Metric: 'Low Stock Count', Value: lowStockCount },
    { Section: 'Inventory Stats', Metric: 'Out Of Stock Count', Value: outStockCount },
    { Section: 'Inventory Stats', Metric: 'Stock Value (USD)', Value: totalValue.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Net Sold Qty', Value: totalQtySold },
    { Section: 'Inventory Stats', Metric: 'Revenue (USD)', Value: totalRevenue.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'COGS (USD)', Value: totalCOGS.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Gross Profit (USD)', Value: totalProfit.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Store Discounts (USD)', Value: totalStoreDiscounts.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Membership Discounts (USD)', Value: totalMembershipDiscounts.toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Returns Count', Value: returnStats?.count ?? 0 },
    { Section: 'Inventory Stats', Metric: 'Return Refunds (USD)', Value: Number(returnStats?.refund_usd || 0).toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Tax Collected (USD)', Value: Number(taxDelivery.tax || 0).toFixed(2) },
    { Section: 'Inventory Stats', Metric: 'Delivery Fees (USD)', Value: Number(taxDelivery.delivery || 0).toFixed(2) },
  ]), [
    branchFilter,
    branches,
    brandFilter,
    filteredSummary.length,
    lowStockCount,
    movFilter,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementDateRangeLabel,
    movementYearFilter,
    outStockCount,
    returnStats?.count,
    returnStats?.refund_usd,
    search,
    stockFilter,
    tab,
    taxDelivery.delivery,
    taxDelivery.tax,
    totalCOGS,
    totalMembershipDiscounts,
    totalProducts,
    totalProfit,
    totalQtySold,
    totalRevenue,
    totalStoreDiscounts,
    totalValue,
    visibleMovementGroups.length,
    visibleMovementQuantity,
    visibleMovementRecordCount,
  ])

  const buildInventoryFormulaRows = useCallback(() => ([
    {
      Section: 'Calculation',
      Metric: 'Visible stock value',
      Formula: 'Stock value = sum(stock quantity * unit cost)',
      Example: `${fmtUSD(totalValue)} across ${filteredSummary.length} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Gross profit',
      Formula: 'Gross profit = revenue - COGS',
      Example: `${fmtUSD(totalProfit)} = ${fmtUSD(totalRevenue)} - ${fmtUSD(totalCOGS)}`,
    },
    {
      Section: 'Calculation',
      Metric: 'In-stock count',
      Formula: 'In stock = quantity greater than the low-stock threshold',
      Example: `${stockStatusRows[0]?.value || 0} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Low-stock count',
      Formula: 'Low stock = quantity above out-of-stock threshold and at or below low-stock threshold',
      Example: `${lowStockCount} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Out-of-stock count',
      Formula: 'Out of stock = quantity at or below out-of-stock threshold',
      Example: `${outStockCount} visible products`,
    },
    {
      Section: 'Calculation',
      Metric: 'Visible movement quantity',
      Formula: 'Visible movement quantity = sum(group quantities after filters/grouping)',
      Example: `${visibleMovementQuantity} units across ${visibleMovementRecordCount} records in ${visibleMovementGroups.length} visible movement groups`,
    },
  ]), [
    filteredSummary.length,
    fmtUSD,
    lowStockCount,
    outStockCount,
    stockStatusRows,
    totalCOGS,
    totalProfit,
    totalRevenue,
    totalValue,
    visibleMovementGroups.length,
    visibleMovementRecordCount,
    visibleMovementQuantity,
  ])

  const buildMovementFilterRows = useCallback(() => ([
    { Section: 'Movement Filters', Metric: 'Branch Filter', Value: branchFilter === 'all' ? 'All branches' : (branches.find((branch) => String(branch.id) === String(branchFilter))?.name || branchFilter) },
    { Section: 'Movement Filters', Metric: 'Movement Type Filter', Value: movFilter },
    { Section: 'Movement Filters', Metric: 'Year Filter', Value: movementYearFilter },
    { Section: 'Movement Filters', Metric: 'Month Filter', Value: movementMonthFilter },
    { Section: 'Movement Filters', Metric: 'Group Mode', Value: movementGroupMode },
    { Section: 'Movement Filters', Metric: 'Sort Direction', Value: movementSortDirection },
    { Section: 'Movement Filters', Metric: 'Search', Value: search || '' },
    { Section: 'Movement Filters', Metric: 'Visible Movement Groups', Value: visibleMovementGroups.length },
    { Section: 'Movement Filters', Metric: 'Visible Movement Records', Value: visibleMovementRecordCount },
    { Section: 'Movement Filters', Metric: 'Visible Movement Quantity', Value: visibleMovementQuantity },
  ]), [
    branchFilter,
    branches,
    movFilter,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementYearFilter,
    search,
    visibleMovementGroups.length,
    visibleMovementQuantity,
    visibleMovementRecordCount,
  ])

  const buildInventoryExportContextRows = useCallback(() => ([
    { Section: 'Export Context', Metric: 'Active Tab', Value: tab },
    { Section: 'Export Context', Metric: 'Branch Filter', Value: branchFilter === 'all' ? 'All branches' : (branches.find((branch) => String(branch.id) === String(branchFilter))?.name || branchFilter) },
    { Section: 'Export Context', Metric: 'Brand Filter', Value: brandFilter === 'all' ? 'All brands' : brandFilter },
    { Section: 'Export Context', Metric: 'Stock Filter', Value: stockFilter },
    { Section: 'Export Context', Metric: 'Movement Type Filter', Value: movFilter },
    { Section: 'Export Context', Metric: 'Movement Date Range', Value: movementDateRangeLabel },
    { Section: 'Export Context', Metric: 'Movement Group Mode', Value: movementGroupMode },
    { Section: 'Export Context', Metric: 'Movement Sort Direction', Value: movementSortDirection },
    { Section: 'Export Context', Metric: 'Year Filter', Value: movementYearFilter },
    { Section: 'Export Context', Metric: 'Month Filter', Value: movementMonthFilter },
    { Section: 'Export Context', Metric: 'Search', Value: search || '' },
    { Section: 'Export Context', Metric: 'Visible Products', Value: filteredSummary.length },
    { Section: 'Export Context', Metric: 'Visible Movement Groups', Value: visibleMovementGroups.length },
    { Section: 'Export Context', Metric: 'Visible Movement Records', Value: visibleMovementRecordCount },
    { Section: 'Export Context', Metric: 'Generated At', Value: new Date().toISOString() },
  ]), [
    branchFilter,
    branches,
    brandFilter,
    filteredSummary.length,
    movFilter,
    movementDateRangeLabel,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementYearFilter,
    search,
    stockFilter,
    tab,
    visibleMovementGroups.length,
    visibleMovementRecordCount,
  ])

  const buildMovementRows = useCallback((groups) => groups.map((group) => ({
    Date: group.latest_at || '',
    Activity: group.movementLabel || '',
    Products: group.productSummary || '',
    Records: group.items?.length || 0,
    Qty: group.totalQuantity || 0,
    Total_Cost_USD: priceCsv(group.totalCostUsd || 0),
    Branch: group.branchSummary || '',
    Reason: group.reasonSummary || '',
    User: group.userSummary || '',
  })), [])

  const buildInventoryProductRows = useCallback((productsToExport = filteredSummary) => (
    productsToExport.map((p) => ({
      Name: p.name || '',
      SKU: p.sku || '',
      Category: p.category || '',
      Brand: p.brand || '',
      Selling_Price_USD: priceCsv(p.selling_price_usd || 0),
      Selling_Price_KHR: priceCsv(p.selling_price_khr || 0),
      Special_Price_USD: priceCsv(p.special_price_usd || p.selling_price_usd || 0),
      Special_Price_KHR: priceCsv(p.special_price_khr || p.selling_price_khr || 0),
      Discount_Enabled: p.discount_enabled ? 'yes' : 'no',
      Discount_Type: p.discount_type || '',
      Discount_Percent: priceCsv(p.discount_percent || 0),
      Discount_Amount_USD: priceCsv(p.discount_amount_usd || 0),
      Discount_Amount_KHR: priceCsv(p.discount_amount_khr || 0),
      Discount_Label: p.discount_label || '',
      Discount_Badge_Color: p.discount_badge_color || '',
      Discount_Starts_At: p.discount_starts_at || '',
      Discount_Ends_At: p.discount_ends_at || '',
      Cost_Price_USD: priceCsv(p.purchase_price_usd || p.cost_price_usd || 0),
      Cost_Price_KHR: priceCsv(p.purchase_price_khr || p.cost_price_khr || 0),
      Stock_Qty: getStockQty(p),
      Sold_Qty: p.qty_sold || 0,
      Revenue_USD: priceCsv(p.revenue_usd || 0),
      COGS_USD: priceCsv(p.cogs_usd || 0),
      Profit_USD: priceCsv((p.revenue_usd || 0) - (p.cogs_usd || 0)),
      Stock_Value_USD: priceCsv(getStockQty(p) * (p.purchase_price_usd || p.cost_price_usd || 0)),
      Unit: p.unit || '',
      Supplier: p.supplier || '',
    }))
  ), [filteredSummary, getStockQty])

  const exportMovementGroups = useCallback((groups, filePrefix = 'inventory-movements') => {
    downloadCSV(`${filePrefix}-${exportStamp}.csv`, buildMovementRows(groups))
  }, [buildMovementRows, exportStamp])

  const exportInventorySummary = useCallback((productsToExport = filteredSummary, filePrefix = 'inventory') => {
    downloadCSV(`${filePrefix}-${exportStamp}.csv`, buildInventoryProductRows(productsToExport))
  }, [buildInventoryProductRows, exportStamp, filteredSummary])

  const exportInventoryStats = useCallback((filePrefix = 'inventory-stats') => {
    const rows = [
      ...buildInventoryExportContextRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: row.Value,
        Formula: '',
        Example: '',
      })),
      ...buildInventoryStatsRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: row.Value,
        Formula: '',
        Example: '',
      })),
      ...buildInventoryFormulaRows().map((row) => ({
        Section: row.Section,
        Metric: row.Metric,
        Value: '',
        Formula: row.Formula,
        Example: row.Example,
      })),
    ]
    downloadCSV(`${filePrefix}-${exportStamp}.csv`, rows)
  }, [buildInventoryExportContextRows, buildInventoryFormulaRows, buildInventoryStatsRows, exportStamp])

  const exportInventoryPackage = useCallback((mode = tab) => {
    const movementRows = buildMovementRows(visibleMovementGroups)
    const productRows = buildInventoryProductRows(filteredSummary)
    const statsRows = buildInventoryStatsRows()
    const formulaRows = buildInventoryFormulaRows()
    const contextRows = buildInventoryExportContextRows()
    const manifestRows = buildReportManifestRows(contextRows.map((row) => ({
      metric: row.Metric,
      value: row.Value,
    })))
    const reportContent = buildStandaloneReportHtml({
      fileName: 'inventory-report.html',
      title: 'Inventory Report',
      subtitle: `${mode === 'movements' ? 'Movements' : 'Products'} • ${movementDateRangeLabel}`,
      exportedAt: new Date().toISOString(),
      summaryCards: [
        { label: 'Visible Products', value: filteredSummary.length, sub: `${totalProducts} total products` },
        { label: 'Visible Movement Groups', value: visibleMovementGroups.length, sub: movementDateRangeLabel },
        { label: tr('stock_value', 'Stock Value', 'តម្លៃស្តុក'), value: fmtUSD(totalValue), sub: `${tr('gross_profit', 'Gross profit', 'ចំណេញដុល')} ${fmtUSD(totalProfit)}` },
        { label: tr('revenue', 'Revenue', 'ចំណូល'), value: fmtUSD(totalRevenue), sub: `${tr('cogs', 'COGS', 'តម្លៃទំនិញដែលបានលក់')} ${fmtUSD(totalCOGS)}` },
        { label: tr('low_stock', 'Low Stock', 'ស្តុកទាប'), value: lowStockCount, sub: `${tr('out_of_stock', 'Out of stock', 'អស់ស្តុក')} ${outStockCount}` },
        { label: tr('returns_count', 'Returns', 'ការប្រគល់មកវិញ'), value: returnStats?.count ?? 0, sub: `${tr('total_refunded', 'Refunded', 'បានសងវិញ')} ${fmtUSD(returnStats?.refund_usd || 0)}` },
      ],
      metadataGroups: [
        {
          title: 'Active Filters',
          subtitle: 'Visible inventory scope captured in this export',
          rows: [
            { label: 'View', value: mode },
            { label: 'Branch', value: branchFilter === 'all' ? 'All branches' : (branches.find((branch) => String(branch.id) === String(branchFilter))?.name || branchFilter) },
            { label: 'Brand', value: brandFilter === 'all' ? 'All brands' : brandFilter },
            { label: 'Stock status', value: stockFilter },
            { label: 'Search', value: search || 'None' },
          ],
        },
        {
          title: 'Movement Filters',
          subtitle: 'Grouping and date metadata for the visible movement set',
          rows: [
            { label: 'Date range', value: movementDateRangeLabel },
            { label: 'Year filter', value: movementYearFilter },
            { label: 'Month filter', value: movementMonthFilter },
            { label: 'Activity type', value: movFilter },
            { label: 'Group mode', value: movementGroupMode },
            { label: 'Sort direction', value: movementSortDirection },
          ],
        },
      ],
      charts: [
        {
          type: 'donut',
          title: 'Stock status distribution',
          subtitle: 'Visible products by current stock state',
          props: { data: stockStatusRows, valueKey: 'value' },
        },
        {
          type: 'bar',
          title: 'Top stock-value products',
          subtitle: 'Highest stock value in the visible set',
          props: { data: topStockValueRows.map((row) => ({ product_name: row.Product, stock_value_usd: row.Stock_Value_USD })), valueKey: 'stock_value_usd', labelKey: 'product_name', color: '#2563eb' },
        },
        {
          type: 'donut',
          title: 'Movement activity mix',
          subtitle: 'Visible movement groups by activity type',
          props: { data: movementActivityRows.map((row) => ({ name: row.name, value: row.quantity })), valueKey: 'value' },
        },
        {
          type: 'bar',
          title: 'Movement volume over time',
          subtitle: 'Visible movement quantity by period bucket',
          props: { data: movementVolumeRows, valueKey: 'quantity', labelKey: 'period', color: '#7c3aed', isCount: true },
        },
        ...(branchComparisonRows.length > 1 ? [{
          type: 'bar',
          title: 'Branch comparison',
          subtitle: 'Stock value by branch',
          props: { data: branchComparisonRows, valueKey: 'stock_value_usd', labelKey: 'branch_name', color: '#0891b2' },
        }] : []),
      ],
      tables: [
        { title: 'Inventory stats', subtitle: 'Core figures and active filters', rows: statsRows },
        { title: 'Inventory calculations', subtitle: 'Formula reference used in the visible summary', rows: formulaRows },
        { title: 'Top stock-value products', subtitle: 'Visible product leaders by stock value', rows: topStockValueRows, limit: 10 },
        { title: 'Movement activity mix', subtitle: 'Visible grouped movements by type', rows: movementActivityRows.map((row) => ({ Activity: row.name, Groups: row.groups, Quantity: row.quantity, Total_Cost_USD: row.total_cost_usd })), limit: 10 },
        { title: 'Movement volume timeline', subtitle: 'Visible movement quantity over the current time window', rows: movementVolumeRows, limit: 12 },
        ...(branchComparisonRows.length > 1 ? [{ title: 'Branch comparison', subtitle: 'Visible branch stock totals', rows: branchComparisonRows, limit: 10 }] : []),
      ],
      notes: [
        'Package includes raw CSV data, calculations, active filter metadata, and this self-contained HTML report.',
        'Single CSV exports remain available from the Export menu when you only need one dataset.',
      ],
    })
    const files = buildReportPackageFiles({
      baseName: 'inventory',
      exportStamp,
      manifestRows,
      csvFiles: mode === 'movements'
        ? [
            { name: `inventory-export-context-${exportStamp}.csv`, content: buildCSV(contextRows) },
            { name: `inventory-movement-filters-${exportStamp}.csv`, content: buildCSV(buildMovementFilterRows()) },
            { name: `inventory-movement-groups-${exportStamp}.csv`, content: buildCSV(movementRows) },
            { name: `inventory-stats-${exportStamp}.csv`, content: buildCSV(statsRows) },
            { name: `inventory-calculations-${exportStamp}.csv`, content: buildCSV(formulaRows) },
            { name: `inventory-products-reference-${exportStamp}.csv`, content: buildCSV(productRows) },
          ]
        : [
            { name: `inventory-export-context-${exportStamp}.csv`, content: buildCSV(contextRows) },
            { name: `inventory-stats-${exportStamp}.csv`, content: buildCSV(statsRows) },
            { name: `inventory-calculations-${exportStamp}.csv`, content: buildCSV(formulaRows) },
            { name: `inventory-products-${exportStamp}.csv`, content: buildCSV(productRows) },
            { name: `inventory-movement-reference-${exportStamp}.csv`, content: buildCSV(movementRows) },
          ],
      reportFileName: 'inventory-report.html',
      reportContent,
    })
    downloadZipFiles(`inventory-report-${mode}-${exportStamp}.zip`, files)
  }, [
    branchComparisonRows,
    branchFilter,
    branches,
    brandFilter,
    buildInventoryFormulaRows,
    buildInventoryProductRows,
    buildInventoryStatsRows,
    buildInventoryExportContextRows,
    buildMovementFilterRows,
    buildMovementRows,
    exportStamp,
    filteredSummary,
    fmtUSD,
    lowStockCount,
    movFilter,
    movementDateRangeLabel,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementYearFilter,
    outStockCount,
    returnStats?.count,
    returnStats?.refund_usd,
    search,
    stockFilter,
    stockStatusRows,
    tab,
    topStockValueRows,
    totalCOGS,
    totalProducts,
    totalProfit,
    totalRevenue,
    totalValue,
    tr,
    visibleMovementGroups,
    movementActivityRows,
    movementVolumeRows,
  ])

  const inventoryExportItems = useMemo(() => {
    if (tab === 'movements') {
      return [
        { label: tr('export_full_inventory_package', 'Export full inventory package', 'នាំចេញកញ្ចប់ស្តុកពេញលេញ'), onClick: () => exportInventoryPackage('movements'), color: 'green' },
        { label: tr('export_inventory_stats', 'Export inventory stats and calculations', 'នាំចេញស្ថិតិ និងការគណនាស្តុក'), onClick: () => exportInventoryStats('inventory-stats') },
        'divider',
        { label: tr('export_visible_movement_groups', `Export visible ${t('movements') || 'movements'}`, 'នាំចេញក្រុមចលនាដែលកំពុងបង្ហាញ'), onClick: () => exportMovementGroups(visibleMovementGroups) },
        selectedMovementGroups.length ? { label: tr('export_selected_movement_groups', 'Export selected movement groups', 'នាំចេញក្រុមចលនាដែលបានជ្រើស'), onClick: () => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected'), color: 'blue' } : null,
        movementYearFilter !== 'all' || movementMonthFilter !== 'all'
          ? { label: tr('export_filtered_time_range', 'Export filtered time range', 'នាំចេញតាមចន្លោះពេលដែលបានតម្រង'), onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-filtered') }
          : null,
        branchFilter !== 'all'
          ? { label: tr('export_filtered_branch_movements', 'Export filtered branch movements', 'នាំចេញចលនាតាមសាខាដែលបានតម្រង'), onClick: () => exportMovementGroups(visibleMovementGroups, 'inventory-movements-branch') }
          : null,
        movFilter !== 'all'
          ? { label: tr('export_filtered_activity_type', 'Export filtered activity type', 'នាំចេញតាមប្រភេទសកម្មភាពដែលបានតម្រង'), onClick: () => exportMovementGroups(visibleMovementGroups, `inventory-movements-${movFilter}`) }
          : null,
        'divider',
        { label: tr('export_inventory_summary', 'Export inventory summary', 'នាំចេញសង្ខេបស្តុក'), onClick: () => exportInventorySummary(summary, 'inventory-summary') },
        { label: tr('export_low_stock_summary', 'Export low-stock summary', 'នាំចេញសង្ខេបស្តុកទាប'), onClick: () => exportInventorySummary(summary.filter((product) => {
          const qty = getStockQty(product)
          return qty > (product.out_of_stock_threshold || 0) && qty <= (product.low_stock_threshold || 10)
        }), 'inventory-low-stock') },
        { label: tr('export_out_of_stock_summary', 'Export out-of-stock summary', 'នាំចេញសង្ខេបអស់ស្តុក'), onClick: () => exportInventorySummary(summary.filter((product) => getStockQty(product) <= (product.out_of_stock_threshold || 0)), 'inventory-out-of-stock') },
      ].filter(Boolean)
    }

    return [
      { label: tr('export_full_inventory_package', 'Export full inventory package', 'នាំចេញកញ្ចប់ស្តុកពេញលេញ'), onClick: () => exportInventoryPackage('products'), color: 'green' },
      { label: tr('export_inventory_stats', 'Export inventory stats and calculations', 'នាំចេញស្ថិតិ និងការគណនាស្តុក'), onClick: () => exportInventoryStats('inventory-stats') },
      'divider',
      { label: tr('export_visible_products', 'Export visible products', 'នាំចេញផលិតផលដែលកំពុងបង្ហាញ'), onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-visible') },
      branchFilter !== 'all'
        ? { label: tr('export_filtered_branch_products', 'Export filtered branch products', 'នាំចេញផលិតផលតាមសាខាដែលបានតម្រង'), onClick: () => exportInventorySummary(filteredSummary, 'inventory-products-branch') }
        : null,
      stockFilter !== 'all'
        ? { label: tr('export_filtered_stock_state', 'Export filtered stock state', 'នាំចេញតាមស្ថានភាពស្តុកដែលបានតម្រង'), onClick: () => exportInventorySummary(filteredSummary, `inventory-products-${stockFilter}`) }
        : null,
      brandFilter !== 'all'
        ? { label: tr('export_filtered_brand', 'Export filtered brand', 'នាំចេញតាមម៉ាកដែលបានតម្រង'), onClick: () => exportInventorySummary(filteredSummary, `inventory-products-brand`) }
        : null,
      { label: tr('export_full_inventory_summary', 'Export full inventory summary', 'នាំចេញសង្ខេបស្តុកទាំងមូល'), onClick: () => exportInventorySummary(summary, 'inventory-summary') },
      { label: tr('export_low_stock_summary', 'Export low-stock summary', 'នាំចេញសង្ខេបស្តុកទាប'), onClick: () => exportInventorySummary(summary.filter((product) => {
        const qty = getStockQty(product)
        return qty > (product.out_of_stock_threshold || 0) && qty <= (product.low_stock_threshold || 10)
      }), 'inventory-low-stock') },
      { label: tr('export_out_of_stock_summary', 'Export out-of-stock summary', 'នាំចេញសង្ខេបអស់ស្តុក'), onClick: () => exportInventorySummary(summary.filter((product) => getStockQty(product) <= (product.out_of_stock_threshold || 0)), 'inventory-out-of-stock') },
    ].filter(Boolean)
  }, [
    branchFilter,
    brandFilter,
    exportInventoryPackage,
    exportInventoryStats,
    exportInventorySummary,
    exportMovementGroups,
    filteredSummary,
    movFilter,
    movementMonthFilter,
    movementYearFilter,
    selectedMovementGroups,
    summary,
    tab,
    t,
    visibleMovementGroups,
  ])

  const inventoryFilterSections = useMemo(() => {
    if (tab === 'rfid') {
      return [
        branches.length > 1 ? {
          id: 'branch',
          label: t('branch') || 'Branch',
          options: [
            { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
            ...branches.map((branch) => ({
              id: `branch-${branch.id}`,
              label: branch.name,
              active: branchFilter === String(branch.id),
              onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
            })),
          ],
        } : null,
      ].filter(Boolean)
    }

    if (tab === 'movements') {
      return [
        branches.length > 1 ? {
          id: 'branch',
          label: t('branch') || 'Branch',
          options: [
            { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
            ...branches.map((branch) => ({
              id: `branch-${branch.id}`,
              label: branch.name,
              active: branchFilter === String(branch.id),
              onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
            })),
          ],
        } : null,
        {
          id: 'movement-type',
          label: t('activity') || 'Activity',
          options: [
            { id: 'all', label: t('all_types') || 'All types', active: movFilter === 'all', onClick: () => setMovFilter('all') },
            ['sale', t('sale') || 'Sale'],
            ['purchase', t('purchase') || 'Purchase'],
            ['return', t('returns') || 'Return'],
            ['return_reversal', t('return_type_writeoff') || 'Return reversal'],
            ['adjustment', t('adjustment') || 'Adjustment'],
            ['transfer', t('stock_transfer') || 'Transfer'],
          ].slice(1).map(([value, label]) => ({
            id: value,
            label,
            active: movFilter === value,
            onClick: () => setMovFilter(movFilter === value ? 'all' : value),
          })),
        },
        isAdmin ? {
          id: 'movement-user',
          label: t('user') || 'User',
          options: [
            { id: 'all', label: t('all_users') || 'All users', active: movementUserFilter === 'all', onClick: () => setMovementUserFilter('all') },
            ...userOptions.map((option) => {
              const id = String(option?.id || '')
              return {
                id: `user-${id}`,
                label: option?.name || option?.username || `User ${id}`,
                active: movementUserFilter === id,
                onClick: () => setMovementUserFilter(movementUserFilter === id ? 'all' : id),
              }
            }).filter((option) => option.id !== 'user-'),
          ],
        } : null,
        {
          id: 'movement-year',
          label: 'Year',
          options: [
            { id: 'all', label: 'All years', active: movementYearFilter === 'all', onClick: () => { setMovementYearFilter('all'); setMovementMonthFilter('all') } },
            ...movementYears.map((year) => ({
              id: `year-${year}`,
              label: year,
              active: movementYearFilter === year,
              onClick: () => {
                const next = movementYearFilter === year ? 'all' : year
                setMovementYearFilter(next)
                if (next === 'all') setMovementMonthFilter('all')
              },
            })),
          ],
        },
        {
          id: 'movement-month',
          label: 'Month',
          options: [
            { id: 'all', label: 'All months', active: movementMonthFilter === 'all', onClick: () => setMovementMonthFilter('all') },
            ...Array.from({ length: 12 }, (_, index) => {
              const month = String(index + 1)
              const label = new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })
              return {
                id: `month-${month}`,
                label,
                active: movementMonthFilter === month,
                onClick: () => setMovementMonthFilter(movementMonthFilter === month ? 'all' : month),
              }
            }),
          ],
        },
        {
          id: 'movement-grouping',
          label: t('group_by') || 'Group by',
          options: [
            { id: 'time', label: t('group_by_time') || 'Time only', active: movementGroupMode === 'time', onClick: () => setMovementGroupMode('time') },
            { id: 'time-action', label: t('group_by_time_action') || 'Time + activity', active: movementGroupMode === 'time+action', onClick: () => setMovementGroupMode('time+action') },
          ],
        },
        {
          id: 'movement-sort',
          label: t('sort') || 'Sort',
          options: [
            { id: 'desc', label: t('newest_first') || 'Newest first', active: movementSortDirection === 'desc', onClick: () => setMovementSortDirection('desc') },
            { id: 'asc', label: t('oldest_first') || 'Oldest first', active: movementSortDirection === 'asc', onClick: () => setMovementSortDirection('asc') },
          ],
        },
      ].filter(Boolean)
    }

    return [
      branches.length > 1 ? {
        id: 'branch',
        label: t('branch') || 'Branch',
        options: [
          { id: 'all', label: t('all_branches') || 'All branches', active: branchFilter === 'all', onClick: () => setBranchFilter('all') },
          ...branches.map((branch) => ({
            id: `branch-${branch.id}`,
            label: branch.name,
            active: branchFilter === String(branch.id),
            onClick: () => setBranchFilter(branchFilter === String(branch.id) ? 'all' : String(branch.id)),
          })),
        ],
      } : null,
      inventoryBrands.length ? {
        id: 'brand',
        label: t('brand') || 'Brand',
        options: [
          { id: 'all', label: t('all_brands') || 'All brands', active: brandFilter === 'all', onClick: () => setBrandFilter('all') },
          ...inventoryBrands.map((brand) => ({
            id: `brand-${brand}`,
            label: brand,
            active: brandFilter === brand,
            onClick: () => setBrandFilter(brandFilter === brand ? 'all' : brand),
          })),
        ],
      } : null,
      {
        id: 'group',
        label: t('product_group') || 'Product group',
        options: [
          { id: 'all', label: t('all') || 'All', active: groupFilter === 'all', onClick: () => setGroupFilter('all') },
          { id: 'parents-variants', label: t('groups') || 'Groups', active: groupFilter === 'grouped', onClick: () => setGroupFilter(groupFilter === 'grouped' ? 'all' : 'grouped') },
          { id: 'standalone', label: t('standalone') || 'Standalone', active: groupFilter === 'standalone', onClick: () => setGroupFilter(groupFilter === 'standalone' ? 'all' : 'standalone') },
        ],
      },
      {
        id: 'stock',
        label: t('stock_status') || 'Stock status',
        options: [
          { id: 'all', label: t('all_stock') || 'All stock', active: stockFilter === 'all', onClick: () => setStockFilter('all') },
          { id: 'in-stock', label: t('in_stock') || 'In stock', active: stockFilter === 'in_stock', onClick: () => setStockFilter(stockFilter === 'in_stock' ? 'all' : 'in_stock') },
          { id: 'low', label: t('low_stock') || 'Low stock', active: stockFilter === 'low', onClick: () => setStockFilter(stockFilter === 'low' ? 'all' : 'low') },
          { id: 'out', label: t('out_of_stock') || 'Out of stock', active: stockFilter === 'out', onClick: () => setStockFilter(stockFilter === 'out' ? 'all' : 'out') },
        ],
      },
    ].filter(Boolean)
  }, [
    branchFilter,
    branches,
    brandFilter,
    groupFilter,
    inventoryBrands,
    movFilter,
    movementGroupMode,
    movementMonthFilter,
    movementSortDirection,
    movementUserFilter,
    movementYearFilter,
    movementYears,
    isAdmin,
    stockFilter,
    t,
    tab,
    tr,
    userOptions,
  ])

  const activeInventoryFilterCount = useMemo(() => {
    if (tab === 'rfid') {
      return [
        branchFilter !== 'all',
      ].filter(Boolean).length
    }

    if (tab === 'movements') {
      return [
        branchFilter !== 'all',
        movFilter !== 'all',
        movementUserFilter !== 'all',
        movementYearFilter !== 'all',
        movementMonthFilter !== 'all',
        movementGroupMode !== 'time',
        movementSortDirection !== 'desc',
      ].filter(Boolean).length
    }

    return [
      branchFilter !== 'all',
      brandFilter !== 'all',
      groupFilter !== 'all',
      stockFilter !== 'all',
      inventoryInitialFilter !== 'all',
    ].filter(Boolean).length
  }, [branchFilter, brandFilter, groupFilter, inventoryInitialFilter, movFilter, movementGroupMode, movementMonthFilter, movementSortDirection, movementUserFilter, movementYearFilter, stockFilter, tab])

  const clearInventoryFilters = useCallback(() => {
    setBranchFilter('all')
    setBrandFilter('all')
    setGroupFilter('all')
    setStockFilter('all')
    setInventoryInitialFilter('all')
    setMovFilter('all')
    setMovementUserFilter('all')
    setMovementYearFilter('all')
    setMovementMonthFilter('all')
    setMovementGroupMode('time')
    setMovementSortDirection('desc')
  }, [])

  const isMovementScopeFullySelected = useCallback(
    (ids = []) => ids.length > 0 && ids.every((id) => selectedMovementIds.has(id)),
    [selectedMovementIds],
  )

  const isMovementScopePartiallySelected = useCallback(
    (ids = []) => ids.some((id) => selectedMovementIds.has(id)) && !isMovementScopeFullySelected(ids),
    [isMovementScopeFullySelected, selectedMovementIds],
  )
  const showMovementActionGroups = movementGroupMode === 'time+action'
  const sectionStorageKey = 'business-os:inventory:section'
  const showInventoryStats = inventorySection === 'all' || inventorySection === 'stats'
  const showInventorySections = inventorySection === 'all' || ['products', 'movements', 'rfid'].includes(inventorySection)
  const showInventoryTabs = inventorySection === 'all'
  const showProductsSection = showInventorySections && tab === 'products'
  const showMovementsSection = showInventorySections && tab === 'movements'
  const showRfidSection = showInventorySections && tab === 'rfid'
  const selectInventorySection = (nextSection) => {
    setInventorySection(nextSection)
    if (['products', 'movements', 'rfid'].includes(nextSection)) setTab(nextSection)
  }

  if (loadError && !loading && !summary.length && !movements.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-4xl">!</div>
        <p className="text-center font-medium text-red-600 dark:text-red-400">{loadError}</p>
        <button type="button" onClick={() => load(false)} className="btn-primary">
          {t('retry') || 'Retry'}
        </button>
      </div>
    )
  }

  return (
    <div className="page-scroll p-3 sm:p-6">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">
            <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            {t('inventory')}
          </h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setShowImport(true)}
            className="btn-secondary shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-sm"
            title={tr('import', 'Import', 'នាំចូល')}
          >
            <span className="inline-flex items-center gap-2">
              <Upload className="h-4 w-4" />
              {tr('import', 'Import', 'នាំចូល')}
            </span>
          </button>
          {showProductsSection ? (
            <ExportMenu
              label={tr('export', 'Export', 'នាំចេញ')}
              items={inventoryExportItems}
              compact
            />
          ) : null}
        </div>
      </div>

      <SectionSwitcher
        className="mb-3"
        label=""
        options={INVENTORY_SECTION_OPTIONS}
        value={inventorySection}
        onChange={selectInventorySection}
        storageKey={sectionStorageKey}
      />

      <LoadingWatchdog
        loading={loading}
        timeoutMs={8000}
        label={t('loading') || 'Loading...'}
        details={tab === 'rfid' ? 'Checking RFID status, tag mappings, and inventory data.' : 'Loading products, stock, and movement summaries.'}
        onRetry={() => load(false)}
        className="mb-3"
      />

      {statsRefreshError ? (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          {statsRefreshError}
        </div>
      ) : null}

      {selectedMovementGroups.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900/40 dark:bg-blue-900/20">
          <span className="font-semibold text-blue-700 dark:text-blue-300">{selectedMovementGroups.length} movement group{selectedMovementGroups.length === 1 ? '' : 's'} selected</span>
          <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => exportMovementGroups(selectedMovementGroups, 'inventory-movements-selected')}>
            Export selected
          </button>
          <button type="button" className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => setSelectedMovementIds(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {showInventoryStats ? (
      <>
      {/* ?? Primary Stats bar ?? */}
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{t('tap_any_stat_for_details') || 'Tap any stat card for details.'}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-2">
        {primaryStats.map((stat) => (
          <button
            key={stat.id}
            type="button"
            className="card px-3 py-2 text-left transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/50"
            onClick={() => setStatDetail(stat)}
          >
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub && <div className="text-[10px] text-gray-400">{stat.sub}</div>}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {financeStats.map((stat) => (
          <button
            key={stat.id}
            type="button"
            className={`card px-3 py-2 border-l-2 text-left transition hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800/50 ${stat.border}`}
            onClick={() => setStatDetail(stat)}
          >
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub ? <div className="text-[10px] text-gray-400 mt-0.5">{stat.sub}</div> : null}
          </button>
        ))}
      </div>
      </>
      ) : null}

      {false && (<>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-2">
        {[
          { label:t('products'),    value: totalProducts,            cls:'text-gray-800 dark:text-gray-200' },
          { label:t('stock_value'), value: fmtUSD(totalValue),       cls:'text-blue-700 dark:text-blue-300' },
          { label:t('net_sold'),    value: totalQtySold,             cls:'text-purple-700 dark:text-purple-300', sub:t('after_returns') },
          { label:t('revenue'),     value: fmtUSD(totalRevenue),     cls:'text-green-700 dark:text-green-300', sub:t('after_refunds') },
          { label:t('cogs'),        value: fmtUSD(totalCOGS),        cls:'text-orange-600 dark:text-orange-400', sub:t('cost_of_goods_sold') },
          { label:t('gross_profit'),value: fmtUSD(totalProfit),      cls: totalProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400' },
          { label:t('low_stock'),   value: lowStockCount,            cls: lowStockCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400', sub:t('need_restock') },
          { label:t('out_of_stock'),value: outStockCount,            cls: outStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400', sub:t('unavailable') },
        ].map(stat => (
          <div key={stat.label} className="card px-3 py-2">
            <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{stat.label}</div>
            <div className={`text-sm font-bold ${stat.cls}`}>{stat.value}</div>
            {stat.sub && <div className="text-[10px] text-gray-400">{stat.sub}</div>}
          </div>
        ))}
      </div>

      {/* ?? Secondary Stats: Returns (compact) 繚 Tax 繚 Delivery ?? */}
      <div className="hidden grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {/* Returns ??compact with inline note */}
        <div className="card px-3 py-2 border-l-2 border-orange-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('returns_count')}</div>
          <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
            {returnStats?.count ?? 0}
            <span className="text-[10px] font-normal text-gray-400 ml-1">{t('transactions')}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats && returnStats.count > 0
              ? `${returnStats.items} items 繚 refunded ${fmtUSD(returnStats.refund_usd)}`
              : t('no_returns')}
          </div>
        </div>

        {/* Refunded amount */}
        <div className="card px-3 py-2 border-l-2 border-red-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('total_refunded')}</div>
          <div className="text-sm font-bold text-red-600 dark:text-red-400">{fmtUSD(returnStats?.refund_usd ?? 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats?.restock ?? 0} {t('restocked_to_inventory')}
          </div>
        </div>

        {/* Tax collected */}
        <div className="card px-3 py-2 border-l-2 border-indigo-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('tax_collected')}</div>
          <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{fmtUSD(taxDelivery.tax)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('all_time_sales')}</div>
        </div>

        {/* Delivery fees */}
        <div className="card px-3 py-2 border-l-2 border-teal-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('delivery_fees')}</div>
          <div className="text-sm font-bold text-teal-600 dark:text-teal-400">{fmtUSD(taxDelivery.delivery)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {taxDelivery.deliveryCount} {t('deliveries_made')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <div className="card px-3 py-2 border-l-2 border-amber-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('store_discounts') || 'Store discounts'}</div>
          <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{fmtUSD(totalStoreDiscounts)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('allocated_to_products') || 'Allocated to sold products'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-emerald-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('membership_discounts') || 'Membership discounts'}</div>
          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmtUSD(totalMembershipDiscounts)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('allocated_to_products') || 'Allocated to sold products'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-rose-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('total_refunded') || 'Refunded'}</div>
          <div className="text-sm font-bold text-rose-600 dark:text-rose-400">{fmtUSD(returnStats?.refund_usd || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{returnStats?.items || 0} {t('items') || 'items'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-indigo-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('tax_collected') || 'Tax collected'}</div>
          <div className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{fmtUSD(taxDelivery.tax || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{t('completed_sales_only') || 'Completed sales only'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-sky-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('delivery_fees') || 'Delivery fees'}</div>
          <div className="text-sm font-bold text-sky-600 dark:text-sky-400">{fmtUSD(taxDelivery.delivery || 0)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{taxDelivery.deliveryCount || 0} {t('transactions') || 'transactions'}</div>
        </div>

        <div className="card px-3 py-2 border-l-2 border-orange-400">
          <div className="text-[10px] text-gray-400 mb-0.5 font-medium uppercase tracking-wide">{t('returns_count') || 'Returns'}</div>
          <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
            {returnStats?.count ?? 0}
            <span className="ml-1 text-[10px] font-normal text-gray-400">{t('transactions') || 'transactions'}</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {returnStats?.restock ?? 0} {t('restocked_to_inventory') || 'restocked'}
          </div>
        </div>
      </div>

      {/* ?? Tabs ?? */}
      </>
      )}
      {showInventoryTabs ? (
      <div className="mb-4 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {[['products', t('products')], ['movements', t('movements')], ['rfid', 'RFID']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${tab===id ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      ) : null}

      {/* ?? Filters ?? */}
      {showInventorySections ? (
      <div className="mb-2 overflow-x-auto pb-1">
        <div className="flex min-w-[19.5rem] items-center gap-1.5 sm:min-w-0">
          <input
            id="inventory-search"
            name="inventory_search"
            autoComplete="off"
            aria-label="Inventory search"
            className={`input min-w-0 flex-1 text-sm ${tab === 'products' ? 'rounded-r-none' : ''}`}
            placeholder={tab === 'products'
              ? `${t('search') || 'Search'} - separate terms with commas, then choose match mode`
              : tab === 'rfid'
                ? 'Search RFID sessions, EPC / TID, reader, or product mapping'
                : `${t('search') || 'Search'} ${t('movements') || 'Movements'}`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === 'products' && (
            <div className="flex shrink-0 overflow-hidden rounded-r-lg border border-l-0 border-gray-300 dark:border-gray-600">
              {['AND','OR'].map(m => (
                <button key={m}
                  onClick={() => setSearchMode(m)}
                  className={`min-w-[2.9rem] px-2 py-1.5 text-xs font-bold transition-colors ${searchMode===m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50'}`}>
                  {m}
                </button>
              ))}
            </div>
          )}
          <FilterMenu
            label={t('filters') || 'Filters'}
            activeCount={activeInventoryFilterCount}
            sections={inventoryFilterSections}
            onClear={clearInventoryFilters}
            compact
          />
        </div>
      </div>
      ) : null}
      {showInventorySections ? (
      <div className="inventory-history-row mb-2 overflow-x-auto pb-1">
        <ActionHistoryBar history={actionHistory} className="min-w-max" />
      </div>
      ) : null}

      {search.trim() && showProductsSection && (
        <p className="text-[10px] text-gray-400 mb-1">
          {t('inventory_and_or_tip')||'Comma separates terms. AND requires all terms, OR requires any term.'} -{' '}
          <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">cola, water</span>
          {' '}{t('search_example_finds')||'Example: AND finds items matching both terms, OR finds either term.'}
        </p>
      )}

      {showProductsSection && inventoryInitialOptions.length ? (
        <div className="mb-2 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            className={`h-8 min-w-8 rounded-lg px-2 font-semibold ${inventoryInitialFilter === 'all' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            onClick={() => setInventoryInitialFilter('all')}
          >
            {t('all') || 'All'}
          </button>
          {inventoryInitialOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`h-8 min-w-8 rounded-lg px-2 font-semibold ${inventoryInitialFilter === item.key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              onClick={() => setInventoryInitialFilter(inventoryInitialFilter === item.key ? 'all' : item.key)}
              title={`${item.label} (${item.count})`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {showInventorySections && !showProductsSection ? (
      <p className="text-xs text-gray-400 mb-2">
        {tab === 'products'
          ? `${totalProducts} ${t('products')||'products'} - ${t('tap_for_details')||'click a row for details'}`
          : tab === 'rfid'
            ? `RFID inventory for ${rfidGatewayStatus.branchName} - reader gateway, tag mapping, sessions, and barcode fallback`
            : `${visibleMovementGroups.length} grouped ${t('movements')||'movements'} - ${visibleMovementRecordCount} records - ${visibleMovementQuantity} quantity - ${t('tap_for_details')||'click a row for details'}`}
      </p>
      ) : null}

      {/* ????????????????????????????????????????
          PRODUCTS TAB
      ???????????????????????????????????????? */}
      {showProductsSection && (
        <>
          <div className="mb-2 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/85 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/25">
            <div className="px-3 py-2">
              <div className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700/90 dark:bg-blue-950/40 dark:text-blue-200/85">
                {inventoryProductSummaryLabel}
              </span>
              <label className="inline-flex min-w-0 shrink items-center gap-1 rounded-full border border-blue-200 bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                <input
                  ref={inventorySelectAllRef}
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded"
                  checked={filteredSummary.length > 0 && selectedProductIds.size === filteredSummary.length}
                  onChange={(event) => toggleSelectAllProducts(event.target.checked)}
                />
                <span className="truncate whitespace-nowrap sm:hidden">
                  {hasSelectedProducts ? selectedProducts.length : filteredSummary.length}
                </span>
                <span className="hidden truncate whitespace-nowrap sm:inline">
                  {hasSelectedProducts
                    ? inventoryControlLabels.selected
                    : inventoryControlLabels.selectAll}
                </span>
              </label>
              <label className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-white/85 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                <span className="hidden sm:inline">{t('per_page') || 'per page'}</span>
                <select
                  className="bg-transparent text-[10px] font-semibold outline-none"
                  value={inventoryProductSafePageSize}
                  onChange={(event) => {
                    setInventoryProductPageSize(Number(event.target.value))
                    setInventoryProductPage(1)
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <div className="inline-flex shrink-0 items-center overflow-hidden rounded-full border border-blue-200 bg-white/85 dark:border-blue-800 dark:bg-blue-950/50">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                  disabled={inventoryProductSafePage <= 1}
                  onClick={() => setInventoryProductPage(inventoryProductSafePage - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3 w-3" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={t('page') || 'Page'}
                  className="h-6 w-7 border-0 bg-transparent px-0.5 text-center text-[10px] font-semibold text-blue-700 outline-none dark:text-blue-200"
                  value={inventoryProductPageDraft}
                  onChange={(event) => setInventoryProductPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                  onBlur={commitInventoryProductPageDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitInventoryProductPageDraft()
                      event.currentTarget.blur()
                    } else if (event.key === 'Escape') {
                      setInventoryProductPageDraft(String(inventoryProductSafePage))
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span className="pr-1 text-[10px] font-semibold text-blue-700 dark:text-blue-200">
                  / {inventoryProductTotalPages}
                </span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                  disabled={inventoryProductSafePage >= inventoryProductTotalPages}
                  onClick={() => setInventoryProductPage(inventoryProductSafePage + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-white text-blue-700 transition hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                disabled={!hasSelectedProducts}
                onClick={openInventoryBatchSession}
                title={tr(
                  'inventory_batch_hint',
                  'Select products, review each line in one session, then apply all stock changes together.',
                  'ជ្រើសរើសផលិតផល ពិនិត្យមើលមួយជួរបន្ទាត់ក្នុងសម័យតែមួយ បន្ទាប់មកអនុវត្តការផ្លាស់ប្តូរស្តុកទាំងអស់ជាមួយគ្នា។',
                )}
                aria-label={inventoryControlLabels.batch}
              >
                <Package className="h-3 w-3" />
              </button>
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-white text-blue-700 transition hover:border-blue-400 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                onClick={() => setReasonManager({ open: true, type: 'adjust' })}
                title={inventoryControlLabels.reasons}
                aria-label={inventoryControlLabels.reasons}
              >
                <ClipboardList className="h-3 w-3" />
              </button>
              </div>
            </div>
          </div>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {loading ? (
              <div className="text-center py-10 text-gray-400">{t('loading')}</div>
            ) : filteredSummary.length === 0 ? (
              <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
            ) : pagedSummary.map(p => {
              const qty   = getStockQty(p)
              const isLow = qty > 0 && qty <= p.low_stock_threshold
              const isOut = qty <= (p.out_of_stock_threshold || 0)
              const scls  = isOut ? 'bg-red-100 dark:bg-red-900/30 text-red-600' : isLow ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700' : 'bg-green-100 dark:bg-green-900/30 text-green-700'
              const slbl  = isOut ? (t('out_of_stock') || 'Out') : isLow ? (t('low_stock') || 'Low') : (t('in_stock') || 'In Stock')
              const soldQty = Math.max(0, p.qty_sold || 0)
              const revenue = Math.max(0, p.revenue_usd || 0)
              const productTags = [p.brand, p.category, p.is_group ? 'Group' : (p.parent_id ? 'Variant' : '')].filter(Boolean)
              return (
                <div key={p.id} className="card cursor-pointer px-3 py-2.5" onClick={() => setDetailProduct(p)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded"
                          checked={selectedProductIds.has(Number(p.id))}
                          onChange={(event) => {
                            event.stopPropagation()
                            toggleSelectedProduct(p.id)
                          }}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`${t('select') || 'Select'} ${p.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{p.name}</div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-gray-400">
                            <span className="min-w-0 flex-1 truncate">{productTags.join(' · ') || (t('product') || 'Product')}</span>
                            {p.barcode ? (
                              <span className="shrink-0 whitespace-nowrap font-medium text-gray-500 dark:text-gray-300">
                                {p.barcode}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-1 text-right">
                      <div className="whitespace-nowrap text-sm font-bold leading-none text-gray-900 dark:text-white">
                        {qty}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">{p.unit}</span>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${scls}`}>{slbl}</span>
                      <button
                        onClick={e => { e.stopPropagation(); openAdjust(p) }}
                        className="px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400"
                      >
                        {t('adjust')}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <span>Cost {fmtUSD(p.purchase_price_usd || 0)}</span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>Price {fmtUSD(p.selling_price_usd || 0)}</span>
                    {(p.special_price_usd || 0) > 0 ? (
                      <>
                        <span className="text-gray-300 dark:text-gray-600">|</span>
                        <span>{t('special_price') || 'Special'} {fmtUSD(p.special_price_usd || 0)}</span>
                      </>
                    ) : null}
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>Sold {soldQty} · Rev {fmtUSD(revenue)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="card overflow-hidden hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400">
                      <span className="sr-only">{t('select') || 'Select'}</span>
                    </th>
                    <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 min-w-[140px]">{t('product_name')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('current_stock')}</th>
                    {branches.length > 1 && (
                      <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">{t('branches')}</th>
                    )}
                    <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{t('cost')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{t('price')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden lg:table-cell">{t('stock_val')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden xl:table-cell">{t('net_sold_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-green-700 dark:text-green-400 whitespace-nowrap hidden xl:table-cell">{t('revenue_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-orange-600 dark:text-orange-400 whitespace-nowrap hidden xl:table-cell">{t('cogs_header')}</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap hidden xl:table-cell">{t('profit_header')}</th>
                    <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('adjust_stock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={13} className="text-center py-10 text-gray-400">{t('loading')}</td></tr>
                  ) : filteredSummary.length === 0 ? (
                    <tr><td colSpan={13} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
                  ) : pagedSummary.map(p => {
                    const qty    = getStockQty(p)
                    const isLow  = qty > 0 && qty <= p.low_stock_threshold
                    const isOut  = qty <= (p.out_of_stock_threshold || 0)
                    const status = isOut ? { label:'Out', cls:'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs px-1.5 py-0.5 rounded-full' }
                                 : isLow ? { label:'Low', cls:'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs px-1.5 py-0.5 rounded-full' }
                                 :         { label:'OK',  cls:'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs px-1.5 py-0.5 rounded-full' }
                    const netRev  = Math.max(0, p.revenue_usd || 0)
                    const netCogs = Math.max(0, p.cogs_usd || 0)
                    const profit  = netRev - netCogs
                    return (
                      <tr key={p.id} className="table-row cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10" onClick={() => setDetailProduct(p)}>
                        <td className="px-3 py-1" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={selectedProductIds.has(Number(p.id))}
                            onChange={() => toggleSelectedProduct(p.id)}
                            aria-label={`${t('select') || 'Select'} ${p.name}`}
                          />
                        </td>
                        <td className="px-3 py-1">
                          <div className="font-medium text-gray-900 dark:text-white leading-tight">{p.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-gray-400">
                            {p.brand ? <span>{p.brand}</span> : null}
                            {p.category ? <span>{p.category}</span> : null}
                            {p.is_group ? <span>Group</span> : null}
                            {p.parent_id ? <span>Variant</span> : null}
                            {p.barcode ? <span>{p.barcode}</span> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                          </div>
                        </td>
                        <td className="px-3 py-1 text-right font-bold text-gray-900 dark:text-white whitespace-nowrap">
                          {qty} <span className="text-gray-400 font-normal text-[10px]">{p.unit}</span>
                        </td>
                        {branches.length > 1 && (
                          <td className="px-3 py-1 hidden md:table-cell">
                            <div className="flex flex-wrap gap-0.5">
                              {(p.branch_stock || []).slice(0,3).map(bs => (
                                <span key={bs.branch_id} className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1 py-0.5 rounded">
                                  {bs.branch_name?.split(' ')[0]}: {bs?.quantity ?? 0}
                                </span>
                              ))}
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-1 text-center"><span className={status.cls}>{status.label}</span></td>
                        <td className="px-3 py-1"><DualMoney usd={p.purchase_price_usd||p.cost_price_usd||0} khr={p.purchase_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1">
                          <DualMoney usd={p.selling_price_usd||0} khr={p.selling_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                          {(p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0 ? (
                            <div className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                              {t('special_price') || 'Special'} {fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}
                              {(p.special_price_khr || 0) > 0 ? ` / ${fmtKHR(p.special_price_khr || 0)}` : ''}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-1 hidden lg:table-cell"><DualMoney usd={p.stock_value_usd||0} khr={p.stock_value_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1 text-right text-gray-500 hidden xl:table-cell">{Math.max(0,p.qty_sold||0)}</td>
                        <td className="px-3 py-1 hidden xl:table-cell"><DualMoney usd={netRev} khr={0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                        <td className="px-3 py-1 hidden xl:table-cell text-right">
                          <span className="text-xs font-medium text-orange-600 dark:text-orange-400">{fmtUSD(netCogs)}</span>
                        </td>
                        <td className="px-3 py-1 hidden xl:table-cell">
                          <div className={`text-right text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(profit)}</div>
                        </td>
                        <td className="px-3 py-1 text-center" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openAdjust(p)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-2 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            {t('adjust')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ????????????????????????????????????????
          MOVEMENTS TAB
      ???????????????????????????????????????? */}
      {showMovementsSection && (
        <>
          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('grouped_movement_history', 'Grouped movement history', 'ប្រវត្តិចលនាដែលបានដាក់ជាក្រុម')}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{tr('grouped_movement_history_desc', 'Related stock changes are bundled into one activity so sales, returns, imports, and transfers are easier to review.', 'ការផ្លាស់ប្តូរស្តុកដែលពាក់ព័ន្ធ ត្រូវបានដាក់ជាសកម្មភាពតែមួយ ដើម្បីងាយពិនិត្យការលក់ ការត្រឡប់ ការនាំចូល និងការផ្ទេរ។')}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">{visibleMovementGroups.length} groups · {visibleMovementRecordCount} records · {visibleMovementQuantity} quantity</div>
                <ExportMenu
                  label={tr('export', 'Export', 'នាំចេញ')}
                  items={inventoryExportItems}
                  compact
                />
              </div>
            </div>
          </div>

          <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('start_date', 'Start date', 'កាលបរិច្ឆេទចាប់ផ្តើម')}</span>
                  <input
                    type="date"
                    className="input text-sm"
                    value={movementStartDate}
                    onChange={(event) => setMovementStartDate(event.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('end_date', 'End date', 'កាលបរិច្ឆេទបញ្ចប់')}</span>
                  <input
                    type="date"
                    className="input text-sm"
                    value={movementEndDate}
                    min={movementStartDate || undefined}
                    onChange={(event) => setMovementEndDate(event.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">{movementDateRangeLabel}</div>
                {(movementStartDate || movementEndDate) ? (
                  <button
                    type="button"
                    className="btn-secondary px-3 py-1 text-xs"
                    onClick={() => {
                      setMovementStartDate('')
                      setMovementEndDate('')
                    }}
                  >
                    {t('clear') || 'Clear'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <PaginationControls
            className="mb-3"
            page={movementMeta.page}
            pageSize={movementMeta.pageSize}
            totalItems={movementMeta.total}
            label={t('movements') || 'movements'}
            t={t}
            onPageChange={(page) => setMovementMeta((current) => ({ ...current, page }))}
            onPageSizeChange={(pageSize) => setMovementMeta((current) => ({ ...current, page: 1, pageSize }))}
          />

          <div className="space-y-2 sm:hidden">
            {loading ? (
              <div className="py-10 text-center text-gray-400">{t('loading')}</div>
            ) : visibleMovementGroups.length === 0 ? (
              <div className="py-10 text-center text-gray-400">{t('no_data')}</div>
            ) : movementSections.map((section) => {
              const isCollapsed = collapsedMovementSections.has(section.id)
              return (
              <div key={section.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 px-1 pt-1">
                  <label className="inline-flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isMovementScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                    />
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {section.label} · {section.ids.length} groups · {section.items.reduce((sum, group) => sum + Number(group.items?.length || 0), 0)} records
                    </div>
                  </label>
                  <div className="flex items-center gap-1">
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {!isCollapsed ? section.groups.map((actionGroup) => (
                  <div key={actionGroup.id} className="space-y-2">
                    {showMovementActionGroups ? (
                      <div className="flex items-center gap-2 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={isMovementScopeFullySelected(actionGroup.ids)}
                          ref={(node) => {
                            if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                          }}
                          onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                        />
                        <span>{actionGroup.label} · {actionGroup.items.length} groups · {actionGroup.items.reduce((sum, group) => sum + Number(group.items?.length || 0), 0)} records</span>
                      </div>
                    ) : null}
                    {actionGroup.items.map((group) => {
                      const isExpanded = expandedMovementGroups.has(group.id)
                      return (
                        <div key={group.id} className="card overflow-hidden">
                          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
                            <label className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={selectedMovementIds.has(group.id)}
                                onChange={() => toggleMovementSelection(group.id)}
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            className="w-full p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            onClick={() => toggleMovementGroup(group.id)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                    {group.movementLabel}
                                  </span>
                                  <span className="text-[10px] text-gray-400">{fmtTime(group.latest_at)}</span>
                                </div>
                                <div className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{group.productSummary || 'Movement'}</div>
                                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-400">
                                  <span>{group.items.length} {tr('records', 'records', 'កំណត់ត្រា')}</span>
                                  {group.branchSummary ? <span>{group.branchSummary}</span> : null}
                                  {group.userSummary ? <span>{group.userSummary}</span> : null}
                                </div>
                                {group.reasonSummary ? <div className="mt-1 truncate text-xs text-gray-500">{group.reasonSummary}</div> : null}
                              </div>
                              <div className="flex items-start gap-2 text-right">
                                <div>
                                  <div className="text-sm font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</div>
                                </div>
                                <ChevronDown className={`mt-0.5 h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </button>
                          {isExpanded ? (
                            <div className="border-t border-gray-200 p-3 dark:border-gray-700">
                              {(() => {
                                const groupPage = getMovementGroupPage(group, {
                                  page: expandedMovementPages[group.id] || 1,
                                  pageSize: 10,
                                })
                                return (
                                  <>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Records</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{group.items.length}</div>
                                </div>
                                <div>
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('quantity')}</div>
                                  <div className="text-base font-bold text-gray-900 dark:text-white">{group.totalQuantity}</div>
                                </div>
                              </div>
                              {group.reasonSummary ? (
                                <div className="mt-3">
                                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reason')}</div>
                                  <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800 dark:bg-gray-700/50 dark:text-gray-200">{group.reasonSummary}</div>
                                </div>
                              ) : null}
                              <div className="mt-3 space-y-2">
                                {groupPage.items.map((movement) => (
                                  <div key={movement.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <Package className="h-4 w-4 text-gray-400" />
                                          <button
                                            type="button"
                                            className="truncate text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
                                            onClick={() => openMovementProductDetail(movement)}
                                          >
                                            {movement.product_name || 'Product'}
                                          </button>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                          <span>{fmtTime(movement.created_at)}</span>
                                          {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                          {movement.user_name ? <span>{movement.user_name}</span> : null}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                        {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              {groupPage.totalPages > 1 ? (
                                <PaginationControls
                                  className="mt-3"
                                  page={groupPage.page}
                                  pageSize={groupPage.pageSize}
                                  totalItems={groupPage.total}
                                  label={t('records') || 'records'}
                                  t={t}
                                  onPageChange={(page) => setExpandedMovementGroupPage(group.id, page)}
                                  onPageSizeChange={() => {}}
                                  pageSizeOptions={[10]}
                                />
                              ) : null}
                                  </>
                                )
                              })()}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )) : null}
              </div>
            )})}
          </div>

          <div className="card hidden overflow-hidden sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        ref={movementSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded"
                        checked={visibleMovementGroups.length > 0 && selectedMovementIds.size === visibleMovementGroups.length}
                        onChange={(event) => toggleAllMovementSelection(event.target.checked)}
                        aria-label="Select all movement groups"
                      />
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">{t('date')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Activity</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400">Products</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('quantity')}</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-400">{t('total')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">{t('branch')}</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 hidden xl:table-cell">{t('user')}</th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-400">View</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="py-10 text-center text-gray-400">{t('loading')}</td></tr>
                  ) : visibleMovementGroups.length === 0 ? (
                    <tr><td colSpan={9} className="py-8 text-center text-gray-400">{t('no_data')}</td></tr>
                  ) : movementSections.map((section) => {
                    const isCollapsed = collapsedMovementSections.has(section.id)
                    return (
                    <Fragment key={section.id}>
                      <tr className="bg-slate-50 dark:bg-slate-800/60">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded"
                            checked={isMovementScopeFullySelected(section.ids)}
                            ref={(node) => {
                              if (node) node.indeterminate = isMovementScopePartiallySelected(section.ids)
                            }}
                            onChange={(event) => toggleMovementScopeSelection(section.ids, event.target.checked)}
                          />
                        </td>
                        <td colSpan={8} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <span>{section.label} · {section.ids.length} groups · {section.items.reduce((sum, group) => sum + Number(group.items?.length || 0), 0)} records</span>
                            <div className="flex items-center gap-1">
                              <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleMovementSectionCollapsed(section.id)}>
                                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed ? section.groups.map((actionGroup) => (
                        <Fragment key={actionGroup.id}>
                          {showMovementActionGroups ? (
                            <tr className="bg-white dark:bg-gray-800/70">
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isMovementScopeFullySelected(actionGroup.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isMovementScopePartiallySelected(actionGroup.ids)
                                  }}
                                  onChange={(event) => toggleMovementScopeSelection(actionGroup.ids, event.target.checked)}
                                />
                              </td>
                              <td colSpan={8} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {actionGroup.label} · {actionGroup.items.length} groups · {actionGroup.items.reduce((sum, group) => sum + Number(group.items?.length || 0), 0)} records
                              </td>
                            </tr>
                          ) : null}
                          {actionGroup.items.map((group) => {
                            const isExpanded = expandedMovementGroups.has(group.id)
                            return (
                              <Fragment key={group.id}>
                                <tr className="table-row hover:bg-blue-50 dark:hover:bg-blue-900/10">
                                  <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded"
                                      checked={selectedMovementIds.has(group.id)}
                                      onChange={() => toggleMovementSelection(group.id)}
                                      aria-label={`Select movement group ${group.id}`}
                                    />
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-[10px] text-gray-400">{fmtTime(group.latest_at)}</td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MOV_COLORS[group.movement_type] || 'bg-gray-100 text-gray-600'}`}>
                                        {group.movementLabel}
                                      </span>
                                      <span className="text-[10px] text-gray-400">{group.items.length} {tr('records', 'records', 'កំណត់ត្រា')}</span>
                                    </div>
                                    {group.reasonSummary ? <div className="mt-1 max-w-[220px] truncate text-[11px] text-gray-500">{group.reasonSummary}</div> : null}
                                  </td>
                                  <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">{group.productSummary || 'Movement'}</td>
                                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-white">{group.totalQuantity}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmtUSD(group.totalCostUsd || 0)}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden lg:table-cell">{group.branchSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-gray-500 hidden xl:table-cell">{group.userSummary || 'N/A'}</td>
                                  <td className="px-3 py-2 text-center">
                                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700" onClick={() => toggleMovementGroup(group.id)}>
                                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                      {isExpanded ? 'Collapse' : 'Expand'}
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded ? (
                                  <tr className="bg-gray-50/80 dark:bg-gray-900/30">
                                    <td colSpan={9} className="px-4 py-3">
                                      {(() => {
                                        const groupPage = getMovementGroupPage(group, {
                                          page: expandedMovementPages[group.id] || 1,
                                          pageSize: 10,
                                        })
                                        return (
                                          <>
                                      <div className="grid gap-3 lg:grid-cols-[220px,1fr]">
                                        <div className="space-y-3">
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('reference')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{group.reference_id || 'N/A'}</div>
                                          </div>
                                          <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('recorded_at')}</div>
                                            <div className="mt-1 text-sm text-gray-800 dark:text-gray-200">{fmtTime(group.created_at)}</div>
                                          </div>
                                        </div>
                                        <div className="space-y-2">
                                          {groupPage.items.map((movement) => (
                                            <div key={movement.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/50">
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-gray-400" />
                                                    <button
                                                      type="button"
                                                      className="truncate text-left text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline dark:text-white dark:hover:text-blue-300"
                                                      onClick={() => openMovementProductDetail(movement)}
                                                    >
                                                      {movement.product_name || 'Product'}
                                                    </button>
                                                  </div>
                                                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                                    <span>{fmtTime(movement.created_at)}</span>
                                                    {movement.branch_name ? <span>{movement.branch_name}</span> : null}
                                                    {movement.user_name ? <span>{movement.user_name}</span> : null}
                                                    {movement.reason ? <span>{movement.reason}</span> : null}
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{movement.quantity}</div>
                                                  {(movement.total_cost_usd || 0) > 0 ? <div className="text-[10px] text-emerald-600 dark:text-emerald-400">{fmtUSD(movement.total_cost_usd || 0)}</div> : null}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      {groupPage.totalPages > 1 ? (
                                        <PaginationControls
                                          className="mt-3"
                                          page={groupPage.page}
                                          pageSize={groupPage.pageSize}
                                          totalItems={groupPage.total}
                                          label={t('records') || 'records'}
                                          t={t}
                                          onPageChange={(page) => setExpandedMovementGroupPage(group.id, page)}
                                          onPageSizeChange={() => {}}
                                          pageSizeOptions={[10]}
                                        />
                                      ) : null}
                                          </>
                                        )
                                      })()}
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            )
                          })}
                        </Fragment>
                      )) : null}
                    </Fragment>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showRfidSection && (
        <div className="space-y-3">
          <SectionSwitcher
            label="RFID"
            options={rfidSectionOptions}
            value={rfidSection}
            onChange={setRfidSection}
            storageKey="business-os:inventory:rfid-section"
          />
          {(rfidSection === 'all' || rfidSection === 'overview') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
                  <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {tr('rfid_inventory_title', 'RFID inventory', 'ស្តុក RFID')}
                </div>
                <p className="mt-1 max-w-3xl text-xs text-gray-500 dark:text-gray-400">
                  {tr('rfid_inventory_desc', 'Manage reader readiness, EPC / TID mapping, stock counts, receiving, transfers, POS checks, and exceptions from one Inventory section.', 'គ្រប់គ្រង reader, ការភ្ជាប់ EPC / TID, រាប់ស្តុក, ទទួលទំនិញ, ផ្ទេរ, ពិនិត្យ POS និងករណីលើកលែងក្នុងផ្នែកស្តុកតែមួយ។')}
                </p>
              </div>
              <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${rfidGatewayStatus.connected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                {tr('rfid_reader_gateway', 'Reader gateway', 'Reader gateway')}: {rfidGatewayStatus.label}
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [tr('rfid_reader_gateway', 'Reader gateway', 'Reader gateway'), `${rfidGatewayStatus.readerCount} ${tr('online', 'online', 'online')}`, rfidGatewayStatus.lastHeartbeat],
                [tr('rfid_active_session', 'Active session', 'សម័យសកម្ម'), rfidGatewayStatus.activeSession, rfidGatewayStatus.branchName],
                [tr('rfid_queued_reads', 'Queued reads', 'ការអានកំពុងរង់ចាំ'), rfidGatewayStatus.queuedReads, tr('rfid_awaiting_sync_apply', 'Awaiting sync/apply', 'កំពុងរង់ចាំ sync/apply')],
                [tr('rfid_unknown_tags', 'Unknown tags', 'ស្លាកមិនស្គាល់'), rfidGatewayStatus.unknownTags, tr('rfid_need_product_mapping', 'Need product mapping', 'ត្រូវការភ្ជាប់ផលិតផល')],
              ].map(([label, value, note]) => (
                <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
                  <div className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{value}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{note}</div>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'tagging' || rfidSection === 'stock-count' || rfidSection === 'search') ? (
          <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_workflows', 'RFID workflows', 'ដំណើរការ RFID')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{tr('rfid_workflows_desc', 'Choose a session type before readers start changing stock.', 'ជ្រើសប្រភេទសម័យ មុនពេល reader ចាប់ផ្តើមផ្លាស់ប្តូរស្តុក។')}</div>
                </div>
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled title={tr('rfid_reader_gateway_required', 'Enable after a reader gateway is connected.', 'បើកបានក្រោយពេលភ្ជាប់ reader gateway។')}>
                  {tr('rfid_start_stock_count', 'Start RFID stock count', 'ចាប់ផ្តើមរាប់ស្តុក RFID')}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {RFID_INVENTORY_WORKFLOWS.map((workflow) => (
                  <div key={workflow.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="font-semibold text-gray-900 dark:text-white">{tr(workflow.labelKey, workflow.label)}</div>
                    <div className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{tr(workflow.descriptionKey, workflow.description)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_tag_lookup_mapping', 'Tag lookup and mapping', 'ស្វែងរក និងភ្ជាប់ស្លាក')}</div>
              <div className="mt-2 grid gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">EPC / TID</span>
                  <input className="input text-sm" placeholder={tr('rfid_paste_scan_tag_id', 'Paste or scan tag id', 'បិទភ្ជាប់ ឬស្កេនលេខស្លាក')} disabled title={tr('rfid_reader_not_connected_title', 'Reader integration is not connected yet.', 'មិនទាន់ភ្ជាប់ reader integration។')} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('rfid_map_product_variant', 'Map to product or variant', 'ភ្ជាប់ទៅផលិតផល ឬវ៉ារ្យ៉ង់')}</span>
                  <input className="input text-sm" placeholder={tr('rfid_search_product_tag_placeholder', 'Search product, SKU, barcode, or variant', 'ស្វែងរកផលិតផល SKU barcode ឬវ៉ារ្យ៉ង់')} disabled title={tr('rfid_mapping_title', 'Mapping turns reader scans into stock movements.', 'ការភ្ជាប់នេះបម្លែងការស្កេន reader ទៅជាចលនាស្តុក។')} />
                </label>
                <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                  {tr('rfid_barcode_fallback_note', 'Barcode fallback stays available for untagged products, offline readers, and emergency receiving.', 'Barcode fallback នៅតែប្រើបានសម្រាប់ផលិតផលមិនមានស្លាក reader ក្រៅបណ្ដាញ និងការទទួលទំនិញបន្ទាន់។')}
                </div>
              </div>
            </div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'exceptions') ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="font-semibold">{tr('rfid_exceptions', 'RFID exceptions', 'ករណីលើកលែង RFID')}</div>
            <div className="mt-1 text-xs">{tr('rfid_exceptions_desc', 'Wrong-location, unknown, missing, and extra tags stay in review until an authorized user applies or dismisses them.', 'ស្លាកខុសទីតាំង មិនស្គាល់ បាត់ ឬលើស នឹងនៅក្នុងការពិនិត្យរហូតដល់អ្នកមានសិទ្ធិអនុម័ត ឬបដិសេធ។')}</div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'sessions') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_sessions', 'RFID sessions', 'សម័យ RFID')}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('rfid_sessions_desc', 'Branch, area, reader, ledger totals, confirmed tag presence, and manual apply results are audited per session.', 'សាខា តំបន់ reader សរុប ledger ស្លាកដែលបានបញ្ជាក់ និងលទ្ធផល apply ដោយដៃ ត្រូវបាន audit តាមសម័យ។')}</div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'overview') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_implementation_checklist', 'Implementation checklist', 'បញ្ជីពិនិត្យការអនុវត្ត')}</div>
            <div className="grid gap-2 md:grid-cols-3">
              {RFID_READER_REQUIREMENTS.map((item, index) => (
                <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                  <span className="mr-1 font-bold text-blue-600 dark:text-blue-300">{index + 1}.</span>
                  {tr(item.key, item.text)}
                </div>
              ))}
            </div>
          </div>
          ) : null}
        </div>
      )}

      {/* ?? Adjust stock modal ?? */}
      {statDetail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setStatDetail(null)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-sm sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{statDetail.label}</h2>
                <p className="text-xs text-gray-400 mt-1">{t('inventory') || 'Inventory'}</p>
              </div>
              <button onClick={() => setStatDetail(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-2">
              {Array.isArray(statDetail.detailSections) && statDetail.detailSections.length ? statDetail.detailSections.map((section, sectionIndex) => (
                <div key={`${statDetail.id}-section-${sectionIndex}`} className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="border-b border-gray-200 pb-2 dark:border-gray-700">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{section.title}</div>
                    {section.subtitle ? <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{section.subtitle}</div> : null}
                  </div>
                  {Array.isArray(section.rows) ? section.rows.map((row, rowIndex) => (
                    <div key={`${statDetail.id}-${sectionIndex}-${rowIndex}`} className="rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-950/40">
                      <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                    </div>
                  )) : null}
                </div>
              )) : null}
              {Array.isArray(statDetail.details) && statDetail.details.length ? statDetail.details.map((row, index) => (
                <div key={`${statDetail.id}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{row.label}</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{row.value}</div>
                </div>
              )) : null}
            </div>
          </div>
        </div>
      )}

      {adjustModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAdjustModal(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{t('adjust_stock')}</h2>
                <div className="text-xs text-gray-400 mt-0.5">{adjustModal.name} - Current: {getStockQty(summary.find((product) => Number(product.id) === Number(adjustForm.product_id || adjustModal.id)) || adjustModal)} {adjustModal.unit}</div>
              </div>
              <button onClick={() => setAdjustModal(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll p-4 space-y-3">
              {adjustTargetOptions.length > 1 ? (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{tr('adjust_target', 'Adjust target', 'គោលដៅកែសម្រួល')}</label>
                  <select
                    className="input text-sm"
                    value={adjustForm.product_id || adjustModal.id}
                    onChange={(event) => setAdjustForm((current) => ({ ...current, product_id: event.target.value }))}
                  >
                    {adjustTargetOptions.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}{product.parent_id ? ' (Variant)' : product.is_group ? ' (Group)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-2">
                {[[`add`, t('adjust_add')], [`remove`, t('adjust_remove')], [`set`, t('adjust_set')]].map(([v,lbl]) => (
                  <button key={v} onClick={() => setAdjustForm(f=>({...f, type:v}))}
                    className={`py-2 rounded-xl border-2 text-xs font-medium ${adjustForm.type===v ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('quantity')} *</label>
                <input
                  id="inventory-adjust-quantity"
                  name="inventory_adjust_quantity"
                  className="input text-sm"
                  type="number"
                  step="any"
                  min="0"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f=>({...f, quantity:e.target.value}))} />
              </div>
              {adjustForm.type === 'add' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost ({usdSymbol})</label>
                    <input
                      id="inventory-adjust-cost-usd"
                      name="inventory_adjust_cost_usd"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_usd}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_usd:e.target.value}))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Cost (KHR)</label>
                    <input
                      id="inventory-adjust-cost-khr"
                      name="inventory_adjust_cost_khr"
                      className="input text-sm"
                      type="number"
                      step="any"
                      min="0"
                      value={adjustForm.unit_cost_khr}
                      onChange={e => setAdjustForm(f=>({...f, unit_cost_khr:e.target.value}))} />
                  </div>
                </div>
              )}
              {branches.length > 1 && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">{t('branch')}</label>
                  <select
                    id="inventory-adjust-branch"
                    name="inventory_adjust_branch"
                    className="input text-sm"
                    value={adjustForm.branch_id}
                    onChange={e => setAdjustForm(f=>({...f, branch_id:e.target.value}))}
                  >
                    <option value="">{t('no_specific_branch')}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block">{t('reason')}</label>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'adjust' })}>
                    {tr('manage_reasons', 'Manage reasons', 'គ្រប់គ្រងមូលហេតុ')}
                  </button>
                </div>
                {reasonsByType.adjust.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {reasonsByType.adjust.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${adjustForm.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                        onClick={() => setAdjustForm((current) => ({ ...current, reason: entry.label }))}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  id="inventory-adjust-reason"
                  name="inventory_adjust_reason"
                  className="input text-sm"
                  placeholder={t('reason_placeholder')}
                  value={adjustForm.reason} onChange={e => setAdjustForm(f=>({...f, reason:e.target.value}))} />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleAdjust} className="btn-primary flex-1 text-sm" disabled={adjustSaving}>{adjustSaving ? (t('saving') || 'Saving...') : t('save')}</button>
                <button onClick={() => setAdjustModal(null)} className="btn-secondary text-sm" disabled={adjustSaving}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setTransferModal(null)}>
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('transfer', 'Transfer', 'ផ្ទេរ')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{transferModal.name} - {getStockQty(transferModal)} {transferModal.unit}</div>
              </div>
              <button type="button" onClick={() => setTransferModal(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch', 'សាខាដើម')}</span>
                <select className="input text-sm" value={transferForm.from_branch_id} onChange={(event) => setTransferForm((current) => ({ ...current, from_branch_id: event.target.value }))}>
                  <option value="">{tr('choose_branch', 'Choose a branch', 'ជ្រើសរើសសាខា')}</option>
                  {branches.map((branch) => {
                    const branchQty = Number((transferModal.branch_stock || []).find((item) => String(item.branch_id) === String(branch.id))?.quantity || 0)
                    return <option key={branch.id} value={branch.id}>{branch.name} ({branchQty})</option>
                  })}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch', 'សាខាគោលដៅ')}</span>
                <select className="input text-sm" value={transferForm.to_branch_id} onChange={(event) => setTransferForm((current) => ({ ...current, to_branch_id: event.target.value }))}>
                  <option value="">{tr('choose_branch', 'Choose a branch', 'ជ្រើសរើសសាខា')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'} *</span>
                <input className="input text-sm" type="number" min="0" step="any" value={transferForm.quantity} onChange={(event) => setTransferForm((current) => ({ ...current, quantity: event.target.value }))} />
              </label>
              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('reason') || 'Reason'} *</span>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'transfer' })}>
                    {tr('manage_reasons', 'Manage reasons', 'គ្រប់គ្រងមូលហេតុ')}
                  </button>
                </div>
                {reasonsByType.transfer.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {reasonsByType.transfer.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${transferForm.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                        onClick={() => setTransferForm((current) => ({ ...current, reason: entry.label }))}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea className="input min-h-[84px] text-sm" value={transferForm.reason} onChange={(event) => setTransferForm((current) => ({ ...current, reason: event.target.value }))} placeholder={tr('transfer_reason_placeholder', 'Why is this stock moving between branches?', 'ហេតុអ្វីបានជាត្រូវផ្ទេរស្តុករវាងសាខា?')} />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleTransferStock} className="btn-primary flex-1 text-sm" disabled={transferSaving}>
                  {transferSaving ? (t('saving') || 'Saving...') : tr('transfer', 'Transfer', 'ផ្ទេរ')}
                </button>
                <button type="button" onClick={() => setTransferModal(null)} className="btn-secondary text-sm" disabled={transferSaving}>
                  {t('cancel') || 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {moveModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setMoveModal(null)}>
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('move_stock', 'Move stock', 'ផ្លាស់ទីស្តុក')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{moveModal.name} - {getStockQty(moveModal)} {moveModal.unit}</div>
              </div>
              <button type="button" onClick={() => setMoveModal(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" aria-label={t('close') || 'Close'}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-xl border-2 py-2 text-xs font-semibold ${moveForm.mode === 'existing' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                  onClick={() => setMoveForm((current) => ({ ...current, mode: 'existing' }))}
                >
                  {tr('existing_row', 'Existing row', 'ជួរដែលមានស្រាប់')}
                </button>
                <button
                  type="button"
                  className={`rounded-xl border-2 py-2 text-xs font-semibold ${moveForm.mode === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                  onClick={() => setMoveForm((current) => ({ ...current, mode: 'new' }))}
                >
                  {tr('quick_create_row', 'Quick-create row', 'បង្កើតជួររហ័ស')}
                </button>
              </div>

              {moveForm.mode === 'existing' ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('destination_product', 'Destination product row', 'ជួរផលិតផលគោលដៅ')}</span>
                  <select className="input text-sm" value={moveForm.destination_product_id} onChange={(event) => setMoveForm((current) => ({ ...current, destination_product_id: event.target.value }))}>
                    <option value="">{tr('choose_destination_product', 'Choose a destination product row', 'ជ្រើសរើសជួរផលិតផលគោលដៅ')}</option>
                    {summary.filter((product) => Number(product.id) !== Number(moveModal.id)).map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('name') || 'Name'}</span>
                    <input className="input text-sm" value={moveForm.destination_name} onChange={(event) => setMoveForm((current) => ({ ...current, destination_name: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('selling_price_usd_full', 'Selling Price (USD)', 'តម្លៃលក់ (USD)')}</span>
                    <input className="input text-sm" type="number" step="any" min="0" value={moveForm.selling_price_usd} onChange={(event) => setMoveForm((current) => ({ ...current, selling_price_usd: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('special_price_usd_full', 'Special Price (USD)', 'តម្លៃពិសេស (USD)')}</span>
                    <input className="input text-sm" type="number" step="any" min="0" value={moveForm.special_price_usd} onChange={(event) => setMoveForm((current) => ({ ...current, special_price_usd: event.target.value }))} autoComplete="off" />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
                    <input type="checkbox" checked={!!moveForm.discount_enabled} onChange={(event) => setMoveForm((current) => ({ ...current, discount_enabled: event.target.checked }))} />
                    {tr('product_discount', 'Discounts', 'បញ្ចុះតម្លៃ')}
                  </label>
                  {moveForm.discount_enabled ? (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{moveForm.discount_type === 'fixed' ? tr('discount_amount_usd', 'Discount amount (USD)', 'ចំនួនបញ្ចុះតម្លៃ (USD)') : tr('discount_percent', 'Percent off', 'បញ្ចុះជាភាគរយ')}</span>
                      <input className="input text-sm" type="number" step="any" min="0" value={moveForm.discount_type === 'fixed' ? moveForm.discount_amount_usd : moveForm.discount_percent} onChange={(event) => setMoveForm((current) => current.discount_type === 'fixed' ? { ...current, discount_amount_usd: event.target.value } : { ...current, discount_percent: event.target.value })} autoComplete="off" />
                    </label>
                  ) : null}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'} *</span>
                  <input className="input text-sm" type="number" step="any" min="0" value={moveForm.quantity} onChange={(event) => setMoveForm((current) => ({ ...current, quantity: event.target.value }))} autoComplete="off" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                  <select className="input text-sm" value={moveForm.branch_id} onChange={(event) => setMoveForm((current) => ({ ...current, branch_id: event.target.value }))}>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="block text-xs font-medium text-gray-600 dark:text-gray-400">{t('reason') || 'Reason'}</span>
                  <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'move' })}>
                    {tr('manage_reasons', 'Manage reasons', 'គ្រប់គ្រងមូលហេតុ')}
                  </button>
                </div>
                <select className="input text-sm" value={moveForm.reason} onChange={(event) => setMoveForm((current) => ({ ...current, reason: event.target.value }))}>
                  {reasonsByType.move.map((entry) => (
                    <option key={entry.id} value={entry.label}>{entry.label}</option>
                  ))}
                  <option value="broken">{tr('reason_broken', 'Broken', 'ខូច')}</option>
                  <option value="open">{tr('reason_opened', 'Opened', 'បានបើក')}</option>
                  <option value="loose">{tr('reason_loose', 'Loose', 'រាយ')}</option>
                  <option value="discount">{tr('reason_discount', 'Discount / promotion', 'បញ្ចុះតម្លៃ / ប្រូម៉ូសិន')}</option>
                  <option value="special_price">{tr('reason_special_price', 'Special price', 'តម្លៃពិសេស')}</option>
                  <option value="other">{t('other') || 'Other'}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('notes') || 'Notes'}</span>
                <textarea className="input min-h-[76px] text-sm" value={moveForm.note} onChange={(event) => setMoveForm((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleMoveStock} className="btn-primary flex-1 text-sm" disabled={moveSaving}>{moveSaving ? (t('saving') || 'Saving...') : tr('move_stock', 'Move stock', 'ផ្លាស់ទីស្តុក')}</button>
                <button type="button" onClick={() => setMoveModal(null)} className="btn-secondary text-sm" disabled={moveSaving}>{t('cancel') || 'Cancel'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reasonManager.open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setReasonManager((current) => ({ ...current, open: false }))}>
          <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('saved_reasons', 'Saved reasons', 'មូលហេតុដែលបានរក្សាទុក')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">{tr('saved_reasons_desc', 'Reuse common reasons for stock adjustments, transfers, and row moves.', 'ប្រើមូលហេតុទូទៅឡើងវិញសម្រាប់ការកែសម្រួលស្តុក ការផ្ទេរ និងការផ្លាស់ទីជួរ។')}</div>
              </div>
              <button type="button" onClick={() => setReasonManager((current) => ({ ...current, open: false }))} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-4 p-4">
              <div className="grid grid-cols-3 gap-2">
                {['adjust', 'transfer', 'move'].map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${reasonManager.type === type ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
                    onClick={() => setReasonManager((current) => ({ ...current, type }))}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  value={reasonDraft}
                  onChange={(event) => setReasonDraft(event.target.value)}
                  placeholder={tr('new_reason_placeholder', 'Add a reusable reason', 'បន្ថែមមូលហេតុដែលអាចប្រើឡើងវិញ')}
                  autoComplete="off"
                />
                <button type="button" className="btn-primary px-3 text-sm" onClick={addSavedReason} disabled={savingReasons || !reasonDraft.trim()}>
                  {t('add') || 'Add'}
                </button>
              </div>
              <div className="space-y-2">
                {reasonsByType[reasonManager.type]?.length ? reasonsByType[reasonManager.type].map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900/40">
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{entry.label}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30" onClick={() => renameSavedReason(entry)}>{t('edit') || 'Edit'}</button>
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30" onClick={() => deleteSavedReason(entry)}>{t('delete') || 'Delete'}</button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                    {tr('no_saved_reasons', 'No saved reasons yet for this workflow.', 'មិនទាន់មានមូលហេតុដែលបានរក្សាទុកសម្រាប់ដំណើរការនេះទេ។')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {inventoryBatch?.items?.length ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !batchApplying && setInventoryBatch(null)}>
          <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-5xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{tr('inventory_batch_session', 'Batch session', 'សម័យបាច់')}</h2>
                <div className="mt-0.5 text-xs text-gray-400">
                  {tr(
                    'inventory_batch_session_desc',
                    'Review each selected product, then apply all stock changes together.',
                    'ពិនិត្យមើលផលិតផលដែលបានជ្រើសរើសនីមួយៗ បន្ទាប់មកអនុវត្តការផ្លាស់ប្តូរស្តុកទាំងអស់ជាមួយគ្នា។',
                  )}
                </div>
              </div>
              <button type="button" onClick={() => !batchApplying && setInventoryBatch(null)} className="flex h-8 w-8 items-center justify-center text-gray-400 hover:text-gray-600" disabled={batchApplying}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="modal-scroll space-y-3 p-4">
              {inventoryBatch.items.map((item) => (
                <div key={item.productId} className="rounded-2xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {tr('current_stock', 'Current stock', 'ស្តុកបច្ចុប្បន្ន')} {item.stockQty} {item.unit || ''}
                      </div>
                      {item.error ? (
                        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                          {item.error}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <select className="input text-xs" value={item.action} onChange={(event) => updateInventoryBatchLine(item.productId, { action: event.target.value, reason: '' })}>
                        <option value="adjust">{tr('adjust_stock', 'Adjust stock', 'កែសម្រួលស្តុក')}</option>
                        <option value="transfer">{tr('transfer', 'Transfer', 'ផ្ទេរ')}</option>
                        <option value="move">{tr('move_stock', 'Move stock', 'ផ្លាស់ទីស្តុក')}</option>
                      </select>
                      <button type="button" className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30" onClick={() => removeInventoryBatchLine(item.productId)} disabled={batchApplying}>
                        {t('remove') || 'Remove'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-12">
                    <label className="block lg:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('quantity') || 'Quantity'}</span>
                      <input className="input text-sm" type="number" min="0" step="any" value={item.quantity} onChange={(event) => updateInventoryBatchLine(item.productId, { quantity: event.target.value })} autoComplete="off" />
                    </label>

                    {item.action === 'adjust' ? (
                      <>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('action') || 'Action'}</span>
                          <select className="input text-sm" value={item.adjustType} onChange={(event) => updateInventoryBatchLine(item.productId, { adjustType: event.target.value })}>
                            <option value="add">{t('add') || 'Add'}</option>
                            <option value="remove">{t('remove') || 'Remove'}</option>
                            <option value="set">{t('set') || 'Set'}</option>
                          </select>
                        </label>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                          <select className="input text-sm" value={item.branchId} onChange={(event) => updateInventoryBatchLine(item.productId, { branchId: event.target.value })}>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </label>
                      </>
                    ) : null}

                    {item.action === 'transfer' ? (
                      <>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch', 'សាខាដើម')}</span>
                          <select className="input text-sm" value={item.fromBranchId} onChange={(event) => updateInventoryBatchLine(item.productId, { fromBranchId: event.target.value })}>
                            <option value="">{tr('choose_branch', 'Choose a branch', 'ជ្រើសរើសសាខា')}</option>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </label>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch', 'សាខាគោលដៅ')}</span>
                          <select className="input text-sm" value={item.toBranchId} onChange={(event) => updateInventoryBatchLine(item.productId, { toBranchId: event.target.value })}>
                            <option value="">{tr('choose_branch', 'Choose a branch', 'ជ្រើសរើសសាខា')}</option>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </label>
                      </>
                    ) : null}

                    {item.action === 'move' ? (
                      <>
                        <div className="lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_row', 'Destination row', 'ជួរគោលដៅ')}</span>
                          <div className="flex gap-1">
                            <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'existing' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => updateInventoryBatchLine(item.productId, { moveMode: 'existing' })}>{tr('existing_row', 'Existing', 'មានស្រាប់')}</button>
                            <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${item.moveMode === 'new' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`} onClick={() => updateInventoryBatchLine(item.productId, { moveMode: 'new' })}>{tr('new_row', 'New row', 'ជួរថ្មី')}</button>
                          </div>
                        </div>
                        <label className="block lg:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('branch') || 'Branch'}</span>
                          <select className="input text-sm" value={item.branchId} onChange={(event) => updateInventoryBatchLine(item.productId, { branchId: event.target.value })}>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </label>
                        {item.moveMode === 'existing' ? (
                          <label className="block lg:col-span-4">
                            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{tr('destination_product', 'Destination product row', 'ជួរផលិតផលគោលដៅ')}</span>
                            <select className="input text-sm" value={item.destinationProductId} onChange={(event) => updateInventoryBatchLine(item.productId, { destinationProductId: event.target.value })}>
                              <option value="">{tr('choose_destination_product', 'Choose a destination product row', 'ជ្រើសរើសជួរផលិតផលគោលដៅ')}</option>
                              {summary.filter((product) => Number(product.id) !== Number(item.productId)).map((product) => (
                                <option key={product.id} value={product.id}>{product.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="block lg:col-span-4">
                            <span className="mb-1 block text-[11px] font-medium text-gray-600 dark:text-gray-400">{t('name') || 'Name'}</span>
                            <input className="input text-sm" value={item.destinationName} onChange={(event) => updateInventoryBatchLine(item.productId, { destinationName: event.target.value })} autoComplete="off" />
                          </label>
                        )}
                      </>
                    ) : null}

                    <label className="block lg:col-span-4">
                      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
                        <span>{t('reason') || 'Reason'}</span>
                        <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: item.action === 'move' ? 'move' : item.action === 'transfer' ? 'transfer' : 'adjust' })}>
                          {tr('manage_reasons', 'Manage reasons', 'គ្រប់គ្រងមូលហេតុ')}
                        </button>
                      </span>
                      <div className="space-y-2">
                        {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).length ? (
                          <div className="flex flex-wrap gap-1">
                            {(item.action === 'move' ? reasonsByType.move : item.action === 'transfer' ? reasonsByType.transfer : reasonsByType.adjust).map((entry) => (
                              <button
                                key={entry.id}
                                type="button"
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${item.reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                                onClick={() => updateInventoryBatchLine(item.productId, { reason: entry.label })}
                              >
                                {entry.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {item.action === 'move' ? (
                          <select className="input text-sm" value={item.reason} onChange={(event) => updateInventoryBatchLine(item.productId, { reason: event.target.value })}>
                            {reasonsByType.move.map((entry) => (
                              <option key={entry.id} value={entry.label}>{entry.label}</option>
                            ))}
                            <option value="broken">{tr('reason_broken', 'Broken', 'ខូច')}</option>
                            <option value="open">{tr('reason_opened', 'Opened', 'បានបើក')}</option>
                            <option value="loose">{tr('reason_loose', 'Loose', 'រាយ')}</option>
                            <option value="discount">{tr('reason_discount', 'Discount / promotion', 'បញ្ចុះតម្លៃ / ប្រូម៉ូសិន')}</option>
                            <option value="special_price">{tr('reason_special_price', 'Special price', 'តម្លៃពិសេស')}</option>
                            <option value="other">{t('other') || 'Other'}</option>
                          </select>
                        ) : (
                          <textarea className="input min-h-[80px] text-sm" value={item.reason} onChange={(event) => updateInventoryBatchLine(item.productId, { reason: event.target.value })} placeholder={t('reason') || 'Reason'} />
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-4 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {inventoryBatch.items.length} {t('products') || 'products'}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => setInventoryBatch(null)} disabled={batchApplying}>
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="button" className="btn-primary text-sm" onClick={applyInventoryBatchSession} disabled={batchApplying || !inventoryBatch.items.length}>
                  {batchApplying ? (t('saving') || 'Saving...') : tr('apply_changes', 'Apply changes', 'អនុវត្តការផ្លាស់ប្តូរ')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showImport ? (
        <InventoryImportModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false)
            load()
          }}
        />
      ) : null}

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onAdjust={openAdjust}
          onTransfer={openTransfer}
          onMoveRow={openMove}
          fmtUSD={fmtUSD}
          fmtKHR={fmtKHR}
          usdSymbol={usdSymbol}
          t={t}
        />
      )}
    </div>
  )
}




import { useEffect, useRef, useState } from 'react'
import { useApp, type AppContextCoreValue } from '../../app/AppContextCore.tsx'
import { captureActorReadScope, captureActorWriteIdentity, isActorReadScopeCurrent, isActorWriteIdentityCurrent } from '../../api/actorReadScope.ts'
import { captureInventoryCheckWriteScope, changeInventoryCheckSession, createInventoryCheckSession, readInventoryCheckHistory, readInventoryCheckProducts, readInventoryCheckSession, readInventoryCheckSessions, saveInventoryCheckObservation, type InventoryCheckSession, type InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import type { QueryParams } from '../../api/query.ts'
import { getInventoryCheckAccess, type InventoryCheckAccess } from '../../utils/inventoryCheckAccess.ts'
import { isAdminControlUser } from '../../utils/permissions.ts'
import { continuousRangeParams } from '../../utils/continuousRangeParams.ts'
import type { InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import InventoryCheckControls, { type InventoryCheckFilters } from './InventoryCheckControls.tsx'
import InventoryCheckRows from './InventoryCheckRows.tsx'
import HubSectionNav from '../shared/HubSectionNav.tsx'
import StatsStrip, { type StatCardDef } from '../shared/StatsStrip.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import Modal from '../shared/Modal.tsx'
import { statsPresetRange, type DateTimeRange } from '../shared/statsStripPresets.ts'

type ProductsResult = {
  items: InventoryCheckProduct[]; total: number; page: number; pageSize: number; totalPages?: number
  branches: Array<{ id: number; name: string }>
  stats?: Record<string, number | null | undefined>
  brands?: string[]; categories?: string[]; reasons?: string[]
}
type Selection = { branchId: string; sessionId: string }
type Section = 'products' | 'sessions' | 'issues'
type Attempt = { productId: number; patch: InventoryCheckPatch; revision: number; sessionRevision: number; requestId: string }
type HistoryResult = { items: Array<{ id: number; action: string; product_id: number | null; created_at: string; before: { state?: string; reason?: string | null } | null; after: { state?: string; reason?: string | null } | null }>; total: number; page: number; pageSize: number }
const initialFilters: InventoryCheckFilters = { branchId: '', stockState: '', state: '', reason: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc' }

function projectProduct(product: InventoryCheckProduct, fields: InventoryCheckAccess['fields']): InventoryCheckProduct {
  const visible = { ...product }
  if (!fields.stock) { delete visible.quantity; delete visible.damaged_quantity }
  if (!fields.price) delete visible.selling_price_usd
  if (!fields.cost) delete visible.cost_price_usd
  if (!fields.sales) delete visible.qty_sold
  if (!fields.customers) delete visible.customer_count
  if (!fields.brand) delete visible.brand
  if (!fields.category) delete visible.category
  if (!fields.barcode) { delete visible.barcode; delete visible.sku }
  return visible
}

export default function InventoryChecksPage() {
  const app = useApp() as AppContextCoreValue
  const access = getInventoryCheckAccess(app.user)
  const scope = captureActorReadScope('inventoryChecks')
  const identity = captureActorWriteIdentity()
  const active = app.page === 'inventory' && app.authReady && access.canView
  const boundary = JSON.stringify([userIdentity(app.user), scope.authority, identity.owner, identity.epoch, access, active])
  const authorityFence = useRef(boundary)
  authorityFence.current = boundary
  if (!active) return access.canView ? null : <app.AccessDenied />
  return <InventorySelection key={boundary} access={access} isCurrent={() => authorityFence.current === boundary} />
}

function userIdentity(user: { id?: unknown } | null) { return String(user?.id ?? '') }

function InventorySelection({ access, isCurrent }: { access: InventoryCheckAccess; isCurrent: () => boolean }) {
  const [selection, setSelection] = useState<Selection>({ branchId: '', sessionId: '' })
  const selected = useRef(selection)
  selected.current = selection
  const changeSelection = (value: Selection) => {
    if (selected.current.branchId === value.branchId && selected.current.sessionId === value.sessionId) return
    selected.current = value; setSelection(value)
  }
  return <InventoryWorkspace key={`${selection.branchId}:${selection.sessionId}`} access={access} selection={selection} onSelect={changeSelection} isCurrent={() => isCurrent() && selected.current === selection} />
}

function InventoryWorkspace({ access, selection, onSelect, isCurrent }: { access: InventoryCheckAccess; selection: Selection; onSelect: (selection: Selection) => void; isCurrent: () => boolean }) {
  const { t, user, canWriteToServer } = useApp() as AppContextCoreValue
  const { branchId, sessionId } = selection
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const [section, setSection] = useState<Section>('products')
  const [range, setRange] = useState<DateTimeRange>(() => statsPresetRange('all'))
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<InventoryCheckFilters>({ ...initialFilters, branchId })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<ProductsResult | null>(null)
  const [session, setSession] = useState<InventoryCheckSession | null>(null)
  const [items, setItems] = useState<InventoryCheckSessionItem[]>([])
  const [sessions, setSessions] = useState<{ items: InventoryCheckSession[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<InventoryCheckProduct | null>(null)
  const [historyPage, setHistoryPage] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryResult | null>(null)
  const [historyError, setHistoryError] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const attempts = useRef(new Map<number, Attempt>())
  const createAttempt = useRef<{ title: string; productIds: number[]; scope: QueryParams; requestId: string } | null>(null)
  const lifecycleAttempt = useRef<{ action: 'close' | 'resume'; revision: number; requestId: string } | null>(null)
  const [writeScope] = useState(() => captureInventoryCheckWriteScope({ branchId, sessionId, epoch: 0 }, () => mounted.current && isCurrent()))
  const current = () => mounted.current && isCurrent() && isActorReadScopeCurrent(writeScope.readScope, false) && isActorWriteIdentityCurrent(writeScope.writeIdentity)
  const params: QueryParams = { ...filters, ...continuousRangeParams(range), query, page, pageSize, sessionId, state: section === 'issues' ? 'issue' : filters.state }
  const requestKey = JSON.stringify([params, section, refresh])
  const queryFence = useRef(requestKey)
  queryFence.current = requestKey
  const [loadedKey, setLoadedKey] = useState('')
  const fresh = loadedKey === requestKey
  const canEdit = access.canCheck && !!session && (isAdminControlUser(user) || Number(session.created_by) === Number(user?.id))
  const canViewCounts = access.fields.stock || (!!session && Number(session.created_by) === Number(user?.id))

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (historyPage === null || !sessionId) return
    const abort = new AbortController()
    let live = true
    setHistory(null); setHistoryError('')
    void readInventoryCheckHistory<HistoryResult>(sessionId, { page: historyPage, pageSize: 20 }, abort.signal).then(result => {
      if (live && current()) setHistory(result)
    }).catch(() => { if (live && current()) setHistoryError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.')) })
    return () => { live = false; abort.abort() }
  }, [historyPage, sessionId])
  useEffect(() => {
    const abort = new AbortController()
    let live = true
    const publish = () => live && !abort.signal.aborted && current() && queryFence.current === requestKey
    setLoading(true)
    setError('')
    setDetail(null)
    async function load() {
      try {
        if (section === 'sessions') {
          const result = await readInventoryCheckSessions({ branchId, page, pageSize }, abort.signal)
          if (publish()) { setSessions(result); setLoadedKey(requestKey) }
        } else {
          const [products, selected] = await Promise.all([
            readInventoryCheckProducts<ProductsResult>(params, abort.signal),
            sessionId ? readInventoryCheckSession(sessionId, abort.signal) : Promise.resolve(null),
          ])
          if (publish()) {
            if (!branchId && !sessionId && products.branches?.length === 1) { onSelect({ branchId: String(products.branches[0].id), sessionId: '' }); return }
            setData(products)
            setSession(selected?.item ?? null)
            setItems(selected?.items ?? [])
            setLoadedKey(requestKey)
          }
        }
      } catch {
        if (publish()) setError(tr('inventory_check_load_failed', 'Inventory checks are unavailable. Reload to try again.'))
      } finally { if (publish()) setLoading(false) }
    }
    void load()
    return () => { live = false; abort.abort() }
  }, [requestKey])

  function changeFilters(patch: Partial<InventoryCheckFilters>) {
    if (patch.branchId !== undefined && patch.branchId !== branchId) { onSelect({ branchId: patch.branchId, sessionId: '' }); return }
    setFilters(previous => ({ ...previous, ...patch })); setPage(1)
  }

  async function save(productId: number | string, patch: InventoryCheckPatch, revision: number) {
    if (!current() || queryFence.current !== requestKey || !fresh || !canEdit || session?.status !== 'open' || !canWriteToServer || inFlight.current || lifecycleAttempt.current) throw new Error('Check cannot be saved in this context.')
    const id = Number(productId)
    let attempt = attempts.current.get(id)
    if (attempt && (JSON.stringify(attempt.patch) !== JSON.stringify(patch) || attempt.revision !== revision)) throw new Error('Resolve the previous save before changing this check.')
    if (!attempt) {
      attempt = { productId: id, patch: { ...patch }, revision, sessionRevision: session.revision, requestId: crypto.randomUUID() }
      attempts.current.set(id, attempt)
    }
    inFlight.current = true; setBusy(true); setRowErrors(previous => ({ ...previous, [id]: '' }))
    try {
      const result = await saveInventoryCheckObservation(writeScope, id, attempt.patch, attempt.revision, attempt.sessionRevision, attempt.requestId)
      if (current()) {
        attempts.current.delete(id)
        setSession(result.session)
        setItems(previous => previous.map(item => Number(item.product_id) === id ? result.item : item))
        setRefresh(value => value + 1)
      }
    } catch (cause) {
      if (current()) setRowErrors(previous => ({ ...previous, [id]: tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', (cause as { outcome?: string })?.outcome === 'unknown' ? 'Save not confirmed. Retry the same check to recover its receipt.' : 'Check not saved. Retry the same check or reload this session.') }))
      throw cause
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  async function start() {
    if (!current() || !fresh || !access.canCheck || !canWriteToServer || !branchId || sessionId || !data || inFlight.current) return
    if (!createAttempt.current) {
      const productIds = [...new Set(data.items.filter(product => !product.is_group && (product as InventoryCheckProduct & { checkable?: boolean }).checkable !== false).map(product => Number(product.id)))].filter(id => Number.isSafeInteger(id) && id > 0)
      if (!productIds.length || productIds.length > 500) return
      createAttempt.current = { title: tr('inventory_check_page_session', 'Visible page check'), productIds, scope: { ...params, membership: 'visible_page' }, requestId: crypto.randomUUID() }
    }
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const result = await createInventoryCheckSession(writeScope, createAttempt.current)
      if (current()) onSelect({ branchId, sessionId: result.item.id })
    } catch (cause) {
      if (current()) setWriteError(tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  async function lifecycle() {
    if (!current() || !canEdit || !canWriteToServer || !session || inFlight.current) return
    if (!lifecycleAttempt.current) lifecycleAttempt.current = { action: session.status === 'open' ? 'close' : 'resume', revision: session.revision, requestId: crypto.randomUUID() }
    const attempt = lifecycleAttempt.current
    inFlight.current = true; setBusy(true); setWriteError('')
    try {
      const result = await changeInventoryCheckSession(writeScope, attempt.action, attempt.revision, attempt.requestId)
      if (current()) { lifecycleAttempt.current = null; setSession(result.item); setRefresh(value => value + 1) }
    } catch (cause) {
      if (current()) setWriteError(tr((cause as { outcome?: string })?.outcome === 'unknown' ? 'inventory_check_save_unknown' : 'inventory_check_save_failed', 'Save not confirmed. Retry the same operation or reload.'))
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }

  const visibleProducts = fresh ? (data?.items ?? []).map(product => projectProduct(product, access.fields)) : []
  const observations: Record<string, InventoryCheckObservation> = {}
  if (fresh) for (const item of items) observations[String(item.product_id)] = { product_id: item.product_id, state: item.state, counted_quantity: canViewCounts ? item.counted_quantity : null, reason: item.reason, revision: item.revision, ...(access.fields.stock ? { baseline_quantity: item.baseline_quantity, current_quantity: item.current_quantity, stock_changed: item.stock_changed } : {}) }
  const cards: StatCardDef[] = []
  const stat = (key: string, label: string, allowed = true) => {
    const value = fresh ? data?.stats?.[key] : undefined
    if (allowed) cards.push({ key, label, value: value == null ? '—' : value })
  }
  stat('total_products', t('products'))
  stat('stock_quantity', tr('inventory_check_current_stock', 'Current stock'), access.fields.stock)
  stat('low_stock', t('low_stock'), access.fields.stock)
  stat('out_of_stock', t('out_of_stock'), access.fields.stock)
  stat('qty_sold', tr('inventory_check_period_sales', 'Period sales'), access.fields.sales)
  stat('unique_customer_count', tr('inventory_check_period_customers', 'Period customers'), access.fields.customers)
  const controlsLocked = busy || !!createAttempt.current
  return <div className="min-w-0 space-y-2" data-inventory-check-page>
    <HubSectionNav pageId="inventory" active={section} sections={[
      { id: 'products', label: t('products') }, { id: 'sessions', label: t('inventory_check_sessions') }, { id: 'issues', label: t('issues') },
    ]} onChange={id => { if (!controlsLocked) { setSection(id as Section); setPage(1) } }} />
    <fieldset disabled={controlsLocked} className="min-w-0">
      <InventoryCheckControls range={range} onRangeChange={value => { setRange(value); setPage(1) }} query={query} onQueryChange={value => { setQuery(value); setPage(1) }} filters={filters} onFiltersChange={changeFilters} fields={access.fields} branches={data?.branches ?? []} brands={data?.brands} categories={data?.categories} reasons={data?.reasons} t={t} />
    </fieldset>
    <p className="text-xs text-gray-500">{tr('inventory_check_cohort_hint', 'Received dates select products; sales and customers use the same period. Stock is current.')}</p>
    {section !== 'sessions' ? <StatsStrip cards={cards} t={t} loading={loading} /> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      {sessionId ? <>
        <button type="button" className="btn-secondary min-h-10 px-2" disabled={busy} onClick={() => onSelect({ branchId, sessionId: '' })}>{tr('inventory_check_leave_session', 'All products')}</button>
        {session && fresh ? <span>{session.title} · {session.status === 'open' ? t('open') : t('shift_status_closed')} · {session.progress ? `${session.progress.done + session.progress.issue}/${session.progress.total}` : `${items.filter(item => item.state !== 'unstarted').length}/${items.length}`}</span> : null}
        <button type="button" className="btn-secondary min-h-10 px-2" onClick={() => setHistoryPage(1)}>{t('history')}</button>
        {canEdit && fresh ? <button type="button" className="btn-secondary min-h-10 px-2" disabled={busy || !canWriteToServer || attempts.current.size > 0} onClick={() => { void lifecycle() }}>{lifecycleAttempt.current ? t('retry') : session?.status === 'open' ? tr('inventory_check_close_session', 'Close session') : tr('inventory_check_resume_session', 'Resume session')}</button> : null}
      </> : section !== 'sessions' && access.canCheck ? <button type="button" className="btn-primary min-h-10 px-2" disabled={busy || !fresh || !branchId || !visibleProducts.length || !canWriteToServer} onClick={() => { void start() }}>{createAttempt.current ? t('retry') : tr('inventory_check_start_page', 'Start check — visible page only')}</button> : null}
      <button type="button" className="btn-secondary min-h-10 px-2" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t('refresh')}</button>
    </div>
    {writeError ? <p role="alert" className="text-xs text-red-700">{writeError}</p> : null}
    {[...attempts.current.values()].map(attempt => <button key={attempt.productId} type="button" className="btn-secondary min-h-10 px-2 text-xs" disabled={busy || !fresh || !canEdit || !canWriteToServer} onClick={() => { void save(attempt.productId, attempt.patch, attempt.revision).catch(() => {}) }}>{tr('inventory_check_retry', 'Retry')} #{attempt.productId}</button>)}
    {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    {loading ? <p role="status" className="text-xs">{t('loading')}</p> : null}
    {section === 'sessions' ? <ul className="min-w-0 divide-y">
      {fresh ? sessions?.items.map(item => <li key={item.id}><button type="button" className="min-h-10 w-full break-words py-2 text-left text-xs" onClick={() => { setSection('products'); setPage(1); onSelect({ branchId: String(item.branch_id), sessionId: item.id }) }}>{item.title} · {item.status === 'open' ? t('open') : t('shift_status_closed')} · {item.progress ? `${item.progress.done + item.progress.issue}/${item.progress.total}` : item.started_at}</button></li>) : null}
    </ul> : <InventoryCheckRows key={requestKey} products={visibleProducts} observations={observations} errors={rowErrors} pending={Object.fromEntries(visibleProducts.map(product => [String(product.id), busy]))} canCheck={fresh && canEdit && session?.status === 'open' && canWriteToServer && !lifecycleAttempt.current} canViewStock={access.fields.stock} {...{ canViewCounts }} canViewPrice={access.fields.price} canViewCost={access.fields.cost} t={t} onOpenProduct={setDetail} onSave={save} />}
    {!loading && fresh && !(section === 'sessions' ? sessions?.items.length : visibleProducts.length) ? <p className="text-xs text-gray-500">{tr('inventory_check_empty', 'No matching checks or products.')}</p> : null}
    <PaginationControls page={page} pageSize={pageSize} totalItems={fresh ? (section === 'sessions' ? sessions?.total : data?.total) ?? 0 : 0} onPageChange={value => { if (!controlsLocked) setPage(value) }} onPageSizeChange={value => { if (!controlsLocked) { setPageSize(value); setPage(1) } }} t={t} compact />
    {detail && fresh ? <Modal title={detail.name} onClose={() => setDetail(null)} keyboard size="sm" unsavedChanges="read-only"><dl className="grid grid-cols-2 gap-2 text-xs">
      {access.fields.barcode ? <><dt>{t('barcode')}</dt><dd className="break-all">{detail.barcode || detail.sku || '—'}</dd></> : null}
      {access.fields.stock ? <><dt>{tr('inventory_check_current_stock', 'Current stock')}</dt><dd>{detail.quantity ?? '—'}</dd><dt>{tr('inventory_check_starting_stock', 'Starting stock')}</dt><dd>{items.find(item => String(item.product_id) === String(detail.id))?.baseline_quantity ?? '—'}</dd></> : null}
      {access.fields.brand ? <><dt>{t('brand')}</dt><dd>{detail.brand || '—'}</dd></> : null}
      {access.fields.category ? <><dt>{t('category')}</dt><dd>{detail.category || '—'}</dd></> : null}
      {access.fields.stock && items.find(item => String(item.product_id) === String(detail.id))?.stock_changed ? <p className="col-span-2 text-amber-700">{tr('inventory_check_stock_changed', 'Stock changed since this session started.')}</p> : null}
    </dl></Modal> : null}
    {historyPage !== null ? <Modal title={t('history')} onClose={() => setHistoryPage(null)} keyboard size="sm" unsavedChanges="read-only">
      {historyError ? <p role="alert" className="text-xs text-red-700">{historyError}</p> : !history ? <p role="status">{t('loading')}</p> : <ul className="divide-y text-xs">{history.items.map(event => <li key={event.id} className="min-w-0 break-words py-2"><span>{event.created_at} · {t(event.action)}{event.product_id !== null ? ` · #${event.product_id}` : ''}</span>{event.after?.state ? <span> · {t(event.after.state)}</span> : null}{event.after?.reason ? <p>{event.after.reason}</p> : null}</li>)}</ul>}
      <PaginationControls page={historyPage} pageSize={20} totalItems={history?.total ?? 0} onPageChange={setHistoryPage} t={t} compact />
    </Modal> : null}
  </div>
}

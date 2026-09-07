import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import Modal from '../../shared/Modal'
import ActionHistoryBar from '../../shared/ActionHistoryBar'
import RenameCascadeModal, { type RenameCascadeChoice, type RenameCascadeRequest } from '../../shared/RenameCascadeModal.tsx'
import { getRenameImpact } from '../../../api/renameCascadeTransport.ts'
import { useApp as useAppHook, useSync as useSyncHook } from '../../../AppContext.tsx'
import { useActionHistory } from '../../../utils/actionHistory.ts'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../../utils/loaders.ts'
import {
  fetchLookupProductSnapshots,
  normalizeLookup,
  restoreLookupProductSnapshots,
} from './productLookupSnapshots.ts'

const DEFAULT_UNIT_COLOR = '#6366f1'
const PRODUCT_UNIT_LOOKUP_TIMEOUT_MS = 10000
const PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS = 12000
const PRODUCT_UNIT_MUTATION_TIMEOUT_MS = 12000

type EntityId = string | number

interface UnitRow {
  id: EntityId
  name: string
  color?: string | null
  usage_count?: number
  unresolved_count?: number
  sample_products?: ProductSample[]
  updated_at?: unknown
  virtual?: boolean
}

interface UnitUsageEntry {
  name?: string
  usage_count?: unknown
  unresolved_count?: unknown
  sample_products?: ProductSample[]
}

type ProductRow = Record<string, unknown> & {
  id?: unknown
  name?: unknown
}

type ProductPayload = ProductRow[] | {
  items?: ProductRow[]
  total?: unknown
  pageSize?: unknown
  totalPages?: unknown
}

interface ProductSample {
  name?: string
}

interface UnitMutationResult {
  success?: boolean
  error?: string
  merged?: boolean
}

interface UnitApi {
  getUnits: () => Promise<UnitRow[] | unknown>
  getProductLookupUsage: () => Promise<{ units?: UnitUsageEntry[] } | unknown>
  createUnit: (payload: UnitPayload) => Promise<UnitMutationResult | undefined>
  updateUnit: (id: EntityId, payload: UnitPayload) => Promise<UnitMutationResult | undefined>
  deleteUnit: (id: EntityId, payload?: { expectedUpdatedAt?: unknown }) => Promise<UnitMutationResult | undefined>
  searchProducts?: (params: Record<string, unknown>) => Promise<ProductPayload> | ProductPayload
  getProductsByIds?: (ids: number[], options: { include: string }) => Promise<ProductPayload> | ProductPayload
  updateProduct?: (id: number, payload: Record<string, unknown>) => Promise<unknown> | unknown
}

interface UnitPayload {
  name: string
  color: string
  expectedUpdatedAt?: unknown
  cascade?: 'carry' | 'copy'
}

interface ReviewSelection {
  type: 'unit'
  value: string
}

interface ManageUnitsModalProps {
  onClose: () => void
  onReviewSelection?: (selection: ReviewSelection) => void
  t: (key: string) => string
}

interface AppContextValue {
  notify: (message: string, type?: string) => void
  user?: {
    id?: unknown
    name?: unknown
    username?: unknown
    role_code?: unknown
    permissions?: unknown
  } | null
}

interface SyncContextValue {
  syncChannel?: { channel?: string } | null
}

const useApp = useAppHook as () => AppContextValue
const useSync = useSyncHook as () => SyncContextValue

function getUnitApi(): UnitApi {
  return (window as unknown as { api: UnitApi }).api
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeUnitRows(rows: unknown): UnitRow[] {
  if (!Array.isArray(rows)) return []
  return rows
    // GET /api/units now returns the lookup table UNION the unit strings
    // products actually carry (cloudflare/src/lib/lookupSuggestions.ts), so a
    // product form can suggest a unit that has no lookup row. The MANAGER is
    // the other half of that rule: it renames and deletes lookup ROWS, and a
    // used-only name has none -- listing it here would render rename/delete
    // controls with nothing behind them.
    .filter((entry) => (entry as { source?: unknown } | null | undefined)?.source !== 'products')
    .map((row) => {
      const source = row as Partial<UnitRow> | null | undefined
      return {
        ...source,
        id: source?.id ?? 0,
        name: String(source?.name || ''),
        color: source?.color || DEFAULT_UNIT_COLOR,
      } as UnitRow
    })
    .filter((unit) => unit.name.trim())
}

function mergeUnitUsage(units: UnitRow[] = [], usageEntries: UnitUsageEntry[] = []): UnitRow[] {
  const usageMap = new Map((usageEntries || []).map((entry) => [normalizeLookup(entry?.name), entry]))
  const merged = new Map<string, UnitRow>()
  ;(units || []).forEach((unit) => {
    const key = normalizeLookup(unit?.name)
    const usage = usageMap.get(key)
    merged.set(key, {
      ...unit,
      usage_count: Number(usage?.usage_count || 0),
      unresolved_count: Number(usage?.unresolved_count || 0),
      sample_products: Array.isArray(usage?.sample_products) ? usage.sample_products : [],
    })
  })
  ;(usageEntries || []).forEach((entry) => {
    const key = normalizeLookup(entry?.name)
    if (!key || merged.has(key)) return
    merged.set(key, {
      id: `virtual:${key}`,
      name: String(entry.name || ''),
      color: DEFAULT_UNIT_COLOR,
      usage_count: Number(entry?.usage_count || 0),
      unresolved_count: Number(entry?.unresolved_count || 0),
      sample_products: Array.isArray(entry?.sample_products) ? entry.sample_products : [],
      virtual: true,
    })
  })
  return Array.from(merged.values()).sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
}

export default function ManageUnitsModal({ onClose, onReviewSelection, t }: ManageUnitsModalProps) {
  const [units, setUnits] = useState<UnitRow[]>([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_UNIT_COLOR)
  const [editing, setEditing] = useState<UnitRow | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [renameRequest, setRenameRequest] = useState<RenameCascadeRequest | null>(null)
  const renameResolveRef = useRef<((choice: RenameCascadeChoice) => void) | null>(null)
  const askRenameChoice = (request: RenameCascadeRequest) => new Promise<RenameCascadeChoice>((resolve) => {
    renameResolveRef.current = resolve
    setRenameRequest(request)
  })
  const handleRenameChoice = (choice: RenameCascadeChoice) => {
    setRenameRequest(null)
    const resolve = renameResolveRef.current
    renameResolveRef.current = null
    resolve?.(choice)
  }
  const [deletingId, setDeletingId] = useState<EntityId | 'selected' | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const { notify, user } = useApp()
  const reviewProductsLabel = t('review_products') && t('review_products') !== 'review_products'
    ? t('review_products')
    : 'Review products'
  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const bulkDeleteInFlightRef = useRef(false)
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-units', user })
  const actionHistoryForBar = actionHistory as unknown as ComponentProps<typeof ActionHistoryBar>['history']
  const unitsById = useMemo(() => {
    const index = new Map<number, UnitRow>()
    for (const unit of units) {
      const id = Number(unit?.id || 0)
      if (id) index.set(id, unit)
    }
    return index
  }, [units])

  const fetchUnits = useCallback(async (): Promise<UnitRow[]> => {
    const rows = await withLoaderTimeout(
      () => getUnitApi().getUnits(),
      'Unit lookup options',
      PRODUCT_UNIT_LOOKUP_TIMEOUT_MS,
    )
    return normalizeUnitRows(rows)
  }, [])

  const findUnitById = useCallback(async (id: EntityId): Promise<UnitRow | null> => {
    const rows = await fetchUnits()
    return rows.find((entry) => Number(entry?.id || 0) === Number(id)) || null
  }, [fetchUnits])

  const findUnitByName = useCallback(async (name: string): Promise<UnitRow | null> => {
    const key = normalizeLookup(name)
    if (!key) return null
    const rows = await fetchUnits()
    return rows.find((entry) => normalizeLookup(entry?.name) === key) || null
  }, [fetchUnits])

  const fetchUnitProductSnapshots = useCallback(async (names: string[] = []) => {
    return fetchLookupProductSnapshots({
      api: getUnitApi(),
      field: 'unit',
      names,
      label: 'Unit product snapshots',
      timeoutMs: PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS,
    })
  }, [])

  const restoreUnitProductSnapshots = useCallback(async (snapshots: Record<string, unknown>[] = []) => {
    await restoreLookupProductSnapshots({
      api: getUnitApi(),
      field: 'unit',
      snapshots,
      label: 'Unit product restore',
      timeoutMs: PRODUCT_UNIT_PRODUCTS_TIMEOUT_MS,
    })
  }, [])
  const runUnitMutation = useCallback((loader: () => Promise<UnitMutationResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, PRODUCT_UNIT_MUTATION_TIMEOUT_MS)
  ), [])

  const load = useCallback(async (): Promise<void> => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const [data, usage] = await withLoaderTimeout(() => Promise.all([
        getUnitApi().getUnits(),
        getUnitApi().getProductLookupUsage(),
      ]), 'Units', PRODUCT_UNIT_LOOKUP_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const usageRows = (usage as { units?: UnitUsageEntry[] } | null | undefined)?.units || []
      setUnits(mergeUnitUsage(normalizeUnitRows(data), usageRows))
      setSelectedIds(new Set())
      setErr('')
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setErr(getErrorMessage(error, 'Failed to load units'))
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (syncChannel?.channel === 'units') void load()
  }, [load, syncChannel])
  useEffect(() => () => {
    invalidateTrackedRequest(loadRequestRef)
  }, [])

  const handleAdd = async (): Promise<void> => {
    if (!newName.trim() || saving) return
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    setErr('')
    setSaving(true)
    try {
      const payload = { name: newName.trim(), color: newColor }
      const res = await runUnitMutation(() => getUnitApi().createUnit(payload), 'Create unit')
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setNewName('')
      setNewColor(DEFAULT_UNIT_COLOR)
      await load()
      actionHistory.pushAction({
        label: `Add unit ${payload.name}`.trim(),
        undo: async () => {
          const latest = await findUnitByName(payload.name)
          if (!latest) throw new Error('Unit no longer exists.')
          await runUnitMutation(() => getUnitApi().deleteUnit(latest.id, { expectedUpdatedAt: latest.updated_at || undefined }), 'Undo unit creation')
          await load()
        },
        redo: async () => {
          await runUnitMutation(() => getUnitApi().createUnit(payload), 'Redo unit creation')
          await load()
        },
      })
    } catch (error) {
      setErr(getErrorMessage(error, 'Failed'))
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  const handleUpdate = async (unit: UnitRow): Promise<void> => {
    if (saving) return
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    setErr('')
    setSaving(true)
    try {
      const previousSnapshot = units.find((entry) => Number(entry?.id || 0) === Number(unit?.id || 0))
      const payload: UnitPayload = { name: unit.name, color: unit.color || DEFAULT_UNIT_COLOR, expectedUpdatedAt: unit.updated_at || undefined }
      const oldName = String(previousSnapshot?.name || '').trim()
      const newName = String(unit.name || '').trim()
      if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase()) {
        const impact = await getRenameImpact('unit', oldName, newName)
        const choice = await askRenameChoice({ kind: 'unit', from: oldName, to: newName, impact, choices: ['carry', 'copy'] })
        if (choice === 'cancel') return
        payload.cascade = choice === 'copy' ? 'copy' : 'carry'
      }
      const res = await runUnitMutation(() => getUnitApi().updateUnit(unit.id, payload), 'Update unit')
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setEditing(null)
      await load()
      if (previousSnapshot && !res?.merged) {
        const nextLabel = String(payload.name || previousSnapshot.name || '').trim()
        actionHistory.pushAction({
          label: `Edit unit ${nextLabel}`.trim(),
          undo: async () => {
            const latest = await findUnitById(previousSnapshot.id)
            if (!latest) throw new Error('Unit no longer exists.')
            await runUnitMutation(() => getUnitApi().updateUnit(previousSnapshot.id, {
              name: previousSnapshot.name,
              color: previousSnapshot.color || DEFAULT_UNIT_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
              cascade: 'carry',
            }), 'Undo unit update')
            await load()
          },
          redo: async () => {
            const latest = await findUnitById(previousSnapshot.id)
            if (!latest) throw new Error('Unit no longer exists.')
            await runUnitMutation(() => getUnitApi().updateUnit(previousSnapshot.id, {
              name: payload.name,
              color: payload.color || DEFAULT_UNIT_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
              cascade: 'carry',
            }), 'Redo unit update')
            await load()
          },
        })
      }
    } catch (error) {
      setErr(getErrorMessage(error, 'Failed'))
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  const handleDelete = async (id: EntityId): Promise<void> => {
    if (saving || deletingId) return
    if (!beginSingleAction(deleteInFlightRef, { blocked: deletingId != null })) return
    if (!confirm(t('confirm_delete'))) {
      finishSingleAction(deleteInFlightRef)
      return
    }
    setDeletingId(id)
    try {
      const unit = unitsById.get(Number(id))
      const deletedEntries = unit ? [{ id: Number(unit.id), name: unit.name, color: unit.color || DEFAULT_UNIT_COLOR }] : []
      const productSnapshots = await fetchUnitProductSnapshots(deletedEntries.map((entry) => entry.name))
      await runUnitMutation(() => getUnitApi().deleteUnit(id, { expectedUpdatedAt: unit?.updated_at || undefined }), 'Delete unit')
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(Number(id))
        return next
      })
      await load()
      if (deletedEntries.length) {
        actionHistory.pushAction({
          label: `Delete unit ${deletedEntries[0].name}`.trim(),
          undo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) await runUnitMutation(() => getUnitApi().createUnit({ name: entry.name, color: entry.color || DEFAULT_UNIT_COLOR }), 'Undo unit deletion')
            }
            await restoreUnitProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) continue
              await runUnitMutation(() => getUnitApi().deleteUnit(existing.id, { expectedUpdatedAt: existing.updated_at || undefined }), 'Redo unit deletion')
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed'), 'error')
    } finally {
      finishSingleAction(deleteInFlightRef)
      setDeletingId(null)
    }
  }

  const toggleSelected = (id: EntityId): void => {
    const numericId = Number(id)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const toggleAllVisible = (): void => {
    setSelectedIds((current) => {
      const visibleIds = units.map((unit) => Number(unit.id))
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id))
      const next = new Set(current)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleDeleteSelected = async (): Promise<void> => {
    if (saving || deletingId || selectedIds.size === 0) return
    if (!beginSingleAction(bulkDeleteInFlightRef, { blocked: deletingId != null })) return
    if (!confirm(`Delete ${selectedIds.size} selected unit${selectedIds.size === 1 ? '' : 's'}?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = Array.from(selectedIds)
    setDeletingId('selected')
    try {
      const deletedEntries = ids
        .map((id) => unitsById.get(Number(id)))
        .filter((unit): unit is UnitRow => Boolean(unit))
        .map((unit) => ({
          id: Number(unit.id),
          name: unit.name,
          color: unit.color || DEFAULT_UNIT_COLOR,
          updated_at: unit.updated_at || undefined,
        }))
      const productSnapshots = await fetchUnitProductSnapshots(deletedEntries.map((entry) => entry.name))
      for (const unit of deletedEntries) {
        await runUnitMutation(() => getUnitApi().deleteUnit(unit.id, { expectedUpdatedAt: unit.updated_at || undefined }), 'Bulk delete units')
      }
      notify(`Deleted ${ids.length} unit${ids.length === 1 ? '' : 's'}`, 'success')
      setSelectedIds(new Set())
      await load()
      if (deletedEntries.length) {
        actionHistory.pushAction({
          label: `Delete ${deletedEntries.length} unit${deletedEntries.length === 1 ? '' : 's'}`.trim(),
          undo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) await runUnitMutation(() => getUnitApi().createUnit({ name: entry.name, color: entry.color || DEFAULT_UNIT_COLOR }), 'Undo unit bulk deletion')
            }
            await restoreUnitProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) continue
              await runUnitMutation(() => getUnitApi().deleteUnit(existing.id, { expectedUpdatedAt: existing.updated_at || undefined }), 'Redo unit bulk deletion')
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete selected units'), 'error')
    } finally {
      finishSingleAction(bulkDeleteInFlightRef)
      setDeletingId(null)
    }
  }

  return (
    <Modal title={t('manage_units') || 'Manage Units'} onClose={onClose} unsavedChanges={{ dirty: Boolean(newName.trim()) || editing !== null }}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}
        <ActionHistoryBar history={actionHistoryForBar} t={t} />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="new-unit-name" className="mb-1 block text-xs text-gray-500">{t('name') || 'Name'}</label>
            <input
              id="new-unit-name"
              name="new_unit_name"
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t('unit_example_placeholder') || 'e.g. bottle, bag...'}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleAdd() }}
            />
          </div>
          <div>
            <label htmlFor="new-unit-color" className="mb-1 block text-xs text-gray-500">{t('color') || 'Color'}</label>
            <input
              id="new-unit-color"
              name="new_unit_color"
              type="color"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
              className="h-10 w-10 cursor-pointer rounded-lg border border-gray-300"
            />
          </div>
          <button className="btn-primary" onClick={() => void handleAdd()} disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('add') || 'Add')}</button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto">
          {loading ? <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">{t('loading') || 'Loading...'}</div> : null}
          {!loading && units.length > 0 ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
              <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={units.length > 0 && units.every((unit) => selectedIds.has(Number(unit.id)))}
                  onChange={toggleAllVisible}
                />
                <span>{selectedIds.size ? `${selectedIds.size} selected` : 'Select visible'}</span>
              </label>
              <button
                type="button"
                className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                onClick={() => void handleDeleteSelected()}
                disabled={!selectedIds.size || saving || deletingId != null}
              >
                {deletingId === 'selected' ? (t('deleting') || 'Deleting...') : 'Delete selected'}
              </button>
            </div>
          ) : null}
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-700">
              {editing?.id === unit.id ? (
                <>
                  <input
                    id={`unit-color-${unit.id}`}
                    name={`unit_color_${unit.id}`}
                    type="color"
                    value={editing.color || DEFAULT_UNIT_COLOR}
                    onChange={(event) => setEditing((current) => current ? { ...current, color: event.target.value } : current)}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    id={`unit-name-${unit.id}`}
                    name={`unit_name_${unit.id}`}
                    className="input flex-1 py-1"
                    value={editing.name}
                    onChange={(event) => setEditing((current) => current ? { ...current, name: event.target.value } : current)}
                  />
                  <button className="btn-primary px-3 py-1 text-xs" onClick={() => void handleUpdate(editing)} disabled={saving}>
                    {saving ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                  </button>
                  <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setEditing(null)} disabled={saving}>
                    {t('cancel') || 'Cancel'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(Number(unit.id))}
                    onChange={() => toggleSelected(unit.id)}
                    disabled={saving || deletingId != null}
                    aria-label={`Select ${unit.name}`}
                  />
                  <div className="h-4 w-4 flex-shrink-0 rounded-full" style={{ background: unit.color || DEFAULT_UNIT_COLOR }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-700 dark:text-gray-300">{unit.name}</div>
                    <div className="text-xs text-gray-400">
                      {Number(unit.usage_count || 0)} product(s)
                      {unit.unresolved_count ? ` - ${unit.unresolved_count} need cleanup` : ''}
                    </div>
                    {Array.isArray(unit.sample_products) && unit.sample_products.length ? (
                      <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {unit.sample_products.map((product) => product?.name).filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => setEditing({ ...unit, color: unit.color || DEFAULT_UNIT_COLOR })}
                    className="text-xs text-blue-500 hover:underline"
                    disabled={saving || deletingId != null || unit.virtual}
                  >
                    {t('edit') || 'Edit'}
                  </button>
                  {(Number(unit.usage_count || 0) > 0 || Number(unit.unresolved_count || 0) > 0 || (Array.isArray(unit.sample_products) && unit.sample_products.length > 0)) ? (
                    <button
                      onClick={() => onReviewSelection?.({ type: 'unit', value: unit.name })}
                      className="text-xs text-slate-600 hover:underline dark:text-slate-300"
                      disabled={saving || deletingId != null}
                    >
                      {reviewProductsLabel}
                    </button>
                  ) : null}
                  <button onClick={() => void handleDelete(unit.id)} className="text-xs text-red-500 hover:underline" disabled={saving || !!deletingId || unit.virtual}>
                    {deletingId === unit.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <RenameCascadeModal request={renameRequest} busy={saving} t={(key, fallback) => t(key) || fallback || key} onChoose={handleRenameChoice} />
    </Modal>
  )
}

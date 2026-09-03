import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RenameCascadeModal, { type RenameCascadeChoice, type RenameCascadeRequest } from '../../shared/RenameCascadeModal.tsx'
import { getRenameImpact } from '../../../api/renameCascadeTransport.ts'
import type { ComponentProps } from 'react'
import Modal from '../../shared/Modal'
import ActionHistoryBar from '../../shared/ActionHistoryBar'
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

const DEFAULT_CATEGORY_COLOR = '#3b82f6'
const PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS = 10000
const PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS = 12000
const PRODUCT_CATEGORY_MUTATION_TIMEOUT_MS = 12000

type EntityId = string | number

interface CategoryRow {
  id: EntityId
  name: string
  color?: string | null
  usage_count?: number
  unresolved_count?: number
  sample_products?: ProductSample[]
  updated_at?: unknown
  virtual?: boolean
}

interface CategoryUsageEntry {
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

interface CategoryMutationResult {
  success?: boolean
  error?: string
  merged?: boolean
}

interface CategoryApi {
  getCategories: () => Promise<CategoryRow[] | unknown>
  getProductLookupUsage: () => Promise<{ categories?: CategoryUsageEntry[] } | unknown>
  createCategory: (payload: CategoryPayload) => Promise<CategoryMutationResult | undefined>
  updateCategory: (id: EntityId, payload: CategoryPayload) => Promise<CategoryMutationResult | undefined>
  deleteCategory: (id: EntityId, payload?: { expectedUpdatedAt?: unknown }) => Promise<CategoryMutationResult | undefined>
  searchProducts?: (params: Record<string, unknown>) => Promise<ProductPayload> | ProductPayload
  getProductsByIds?: (ids: number[], options: { include: string }) => Promise<ProductPayload> | ProductPayload
  updateProduct?: (id: number, payload: Record<string, unknown>) => Promise<unknown> | unknown
}

interface CategoryPayload {
  name: string
  color: string
  expectedUpdatedAt?: unknown
  cascade?: 'carry' | 'copy'
}

interface ReviewSelection {
  type: 'category'
  value: string
}

interface ManageCategoriesModalProps {
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

function getCategoryApi(): CategoryApi {
  return (window as unknown as { api: CategoryApi }).api
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function normalizeCategoryRows(rows: unknown): CategoryRow[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const source = row as Partial<CategoryRow> | null | undefined
      return {
        ...source,
        id: source?.id ?? 0,
        name: String(source?.name || ''),
        color: source?.color || DEFAULT_CATEGORY_COLOR,
      } as CategoryRow
    })
    .filter((category) => category.name.trim())
}

function mergeCategoryUsage(categories: CategoryRow[] = [], usageEntries: CategoryUsageEntry[] = []): CategoryRow[] {
  const usageMap = new Map((usageEntries || []).map((entry) => [normalizeLookup(entry?.name), entry]))
  const merged = new Map<string, CategoryRow>()
  ;(categories || []).forEach((category) => {
    const key = normalizeLookup(category?.name)
    const usage = usageMap.get(key)
    merged.set(key, {
      ...category,
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
      color: DEFAULT_CATEGORY_COLOR,
      usage_count: Number(entry?.usage_count || 0),
      unresolved_count: Number(entry?.unresolved_count || 0),
      sample_products: Array.isArray(entry?.sample_products) ? entry.sample_products : [],
      virtual: true,
    })
  })
  return Array.from(merged.values()).sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
}

export default function ManageCategoriesModal({ onClose, onReviewSelection, t }: ManageCategoriesModalProps) {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_CATEGORY_COLOR)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // D6 rename gate: a promise the save flow awaits while the shared
  // before->after dialog asks what happens to attached rows.
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
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-categories', user })
  const actionHistoryForBar = actionHistory as unknown as ComponentProps<typeof ActionHistoryBar>['history']
  const categoriesById = useMemo(() => {
    const index = new Map<number, CategoryRow>()
    for (const category of categories) {
      const id = Number(category?.id || 0)
      if (id) index.set(id, category)
    }
    return index
  }, [categories])

  const fetchCategories = useCallback(async (): Promise<CategoryRow[]> => {
    const rows = await withLoaderTimeout(
      () => getCategoryApi().getCategories(),
      'Category lookup options',
      PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS,
    )
    return normalizeCategoryRows(rows)
  }, [])

  const findCategoryById = useCallback(async (id: EntityId): Promise<CategoryRow | null> => {
    const rows = await fetchCategories()
    return rows.find((entry) => Number(entry?.id || 0) === Number(id)) || null
  }, [fetchCategories])

  const findCategoryByName = useCallback(async (name: string): Promise<CategoryRow | null> => {
    const key = normalizeLookup(name)
    if (!key) return null
    const rows = await fetchCategories()
    return rows.find((entry) => normalizeLookup(entry?.name) === key) || null
  }, [fetchCategories])

  const fetchCategoryProductSnapshots = useCallback(async (names: string[] = []) => {
    return fetchLookupProductSnapshots({
      api: getCategoryApi(),
      field: 'category',
      names,
      label: 'Category product snapshots',
      timeoutMs: PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS,
    })
  }, [])

  const restoreCategoryProductSnapshots = useCallback(async (snapshots: Record<string, unknown>[] = []) => {
    await restoreLookupProductSnapshots({
      api: getCategoryApi(),
      field: 'category',
      snapshots,
      label: 'Category product restore',
      timeoutMs: PRODUCT_CATEGORY_PRODUCTS_TIMEOUT_MS,
    })
  }, [])
  const runCategoryMutation = useCallback((loader: () => Promise<CategoryMutationResult | undefined>, label: string) => (
    withLoaderTimeout(loader, label, PRODUCT_CATEGORY_MUTATION_TIMEOUT_MS)
  ), [])

  const load = useCallback(async (): Promise<void> => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const [data, usage] = await withLoaderTimeout(() => Promise.all([
        getCategoryApi().getCategories(),
        getCategoryApi().getProductLookupUsage(),
      ]), 'Categories', PRODUCT_CATEGORY_LOOKUP_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      const usageRows = (usage as { categories?: CategoryUsageEntry[] } | null | undefined)?.categories || []
      setCategories(mergeCategoryUsage(normalizeCategoryRows(data), usageRows))
      setSelectedIds(new Set())
      setErr('')
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setErr(getErrorMessage(error, 'Failed to load categories'))
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (syncChannel?.channel === 'categories') void load()
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
      const res = await runCategoryMutation(() => getCategoryApi().createCategory(payload), 'Create category')
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setNewName('')
      setNewColor(DEFAULT_CATEGORY_COLOR)
      await load()
      actionHistory.pushAction({
        label: `Add category ${payload.name}`.trim(),
        undo: async () => {
          const latest = await findCategoryByName(payload.name)
          if (!latest) throw new Error('Category no longer exists.')
          await runCategoryMutation(() => getCategoryApi().deleteCategory(latest.id, { expectedUpdatedAt: latest.updated_at || undefined }), 'Undo category creation')
          await load()
        },
        redo: async () => {
          await runCategoryMutation(() => getCategoryApi().createCategory(payload), 'Redo category creation')
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

  const handleUpdate = async (category: CategoryRow): Promise<void> => {
    if (saving) return
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    setErr('')
    setSaving(true)
    try {
      const previousSnapshot = categories.find((entry) => Number(entry?.id || 0) === Number(category?.id || 0))
      const payload: CategoryPayload & { cascade?: 'carry' | 'copy' } = { name: category.name, color: category.color || DEFAULT_CATEGORY_COLOR, expectedUpdatedAt: category.updated_at || undefined }
      // D6: a real rename previews its blast radius and asks -- carry the
      // attached products, keep a copy (new name starts fresh), or cancel.
      const oldName = String(previousSnapshot?.name || '').trim()
      const newName = String(category.name || '').trim()
      if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase()) {
        try {
          const impact = await getRenameImpact('category', oldName, newName)
          const choice = await askRenameChoice({ kind: 'category', from: oldName, to: newName, impact, choices: ['carry', 'copy'] })
          if (choice === 'cancel') return
          if (choice === 'copy') payload.cascade = 'copy'
          if (choice === 'carry') payload.cascade = 'carry'
        } catch { /* preview unavailable -- the rename carries, as it always did */ }
      }
      const res = await runCategoryMutation(() => getCategoryApi().updateCategory(category.id, payload), 'Update category')
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setEditing(null)
      await load()
      if (previousSnapshot && !res?.merged) {
        const nextLabel = String(payload.name || previousSnapshot.name || '').trim()
        actionHistory.pushAction({
          label: `Edit category ${nextLabel}`.trim(),
          undo: async () => {
            const latest = await findCategoryById(previousSnapshot.id)
            if (!latest) throw new Error('Category no longer exists.')
            await runCategoryMutation(() => getCategoryApi().updateCategory(previousSnapshot.id, {
              name: previousSnapshot.name,
              color: previousSnapshot.color || DEFAULT_CATEGORY_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
              cascade: 'carry',
            }), 'Undo category update')
            await load()
          },
          redo: async () => {
            const latest = await findCategoryById(previousSnapshot.id)
            if (!latest) throw new Error('Category no longer exists.')
            await runCategoryMutation(() => getCategoryApi().updateCategory(previousSnapshot.id, {
              name: payload.name,
              color: payload.color || DEFAULT_CATEGORY_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
              cascade: 'carry',
            }), 'Redo category update')
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
      const category = categoriesById.get(Number(id))
      const deletedEntries = category ? [{ id: Number(category.id), name: category.name, color: category.color || DEFAULT_CATEGORY_COLOR }] : []
      const productSnapshots = await fetchCategoryProductSnapshots(deletedEntries.map((entry) => entry.name))
      await runCategoryMutation(() => getCategoryApi().deleteCategory(id, { expectedUpdatedAt: category?.updated_at || undefined }), 'Delete category')
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(Number(id))
        return next
      })
      await load()
      if (deletedEntries.length) {
        actionHistory.pushAction({
          label: `Delete category ${deletedEntries[0].name}`.trim(),
          undo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) await runCategoryMutation(() => getCategoryApi().createCategory({ name: entry.name, color: entry.color || DEFAULT_CATEGORY_COLOR }), 'Undo category deletion')
            }
            await restoreCategoryProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) continue
              await runCategoryMutation(() => getCategoryApi().deleteCategory(existing.id, { expectedUpdatedAt: existing.updated_at || undefined }), 'Redo category deletion')
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
      const visibleIds = categories.map((category) => Number(category.id))
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
    if (!confirm(`Delete ${selectedIds.size} selected categor${selectedIds.size === 1 ? 'y' : 'ies'}?`)) {
      finishSingleAction(bulkDeleteInFlightRef)
      return
    }
    const ids = Array.from(selectedIds)
    setDeletingId('selected')
    try {
      const deletedEntries = ids
        .map((id) => categoriesById.get(Number(id)))
        .filter((category): category is CategoryRow => Boolean(category))
        .map((category) => ({
          id: Number(category.id),
          name: category.name,
          color: category.color || DEFAULT_CATEGORY_COLOR,
          updated_at: category.updated_at || undefined,
        }))
      const productSnapshots = await fetchCategoryProductSnapshots(deletedEntries.map((entry) => entry.name))
      for (const category of deletedEntries) {
        await runCategoryMutation(() => getCategoryApi().deleteCategory(category.id, { expectedUpdatedAt: category.updated_at || undefined }), 'Bulk delete categories')
      }
      notify(`Deleted ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'}`, 'success')
      setSelectedIds(new Set())
      await load()
      if (deletedEntries.length) {
        actionHistory.pushAction({
          label: `Delete ${deletedEntries.length} categor${deletedEntries.length === 1 ? 'y' : 'ies'}`.trim(),
          undo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) await runCategoryMutation(() => getCategoryApi().createCategory({ name: entry.name, color: entry.color || DEFAULT_CATEGORY_COLOR }), 'Undo category bulk deletion')
            }
            await restoreCategoryProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) continue
              await runCategoryMutation(() => getCategoryApi().deleteCategory(existing.id, { expectedUpdatedAt: existing.updated_at || undefined }), 'Redo category bulk deletion')
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to delete selected categories'), 'error')
    } finally {
      finishSingleAction(bulkDeleteInFlightRef)
      setDeletingId(null)
    }
  }

  return (
    <Modal title={t('manage_categories') || 'Manage Categories'} onClose={onClose}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}
        <ActionHistoryBar history={actionHistoryForBar} t={t} />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="new-category-name" className="mb-1 block text-xs text-gray-500">{t('name') || 'Name'}</label>
            <input
              id="new-category-name"
              name="new_category_name"
              className="input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t('category') || 'Category'}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleAdd() }}
            />
          </div>
          <div>
            <label htmlFor="new-category-color" className="mb-1 block text-xs text-gray-500">{t('color') || 'Color'}</label>
            <input
              id="new-category-color"
              name="new_category_color"
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
          {!loading && categories.length > 0 ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
              <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={categories.length > 0 && categories.every((category) => selectedIds.has(Number(category.id)))}
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
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-700">
              {editing?.id === category.id ? (
                <>
                  <input
                    id={`category-color-${category.id}`}
                    name={`category_color_${category.id}`}
                    type="color"
                    value={editing.color || DEFAULT_CATEGORY_COLOR}
                    onChange={(event) => setEditing((current) => current ? { ...current, color: event.target.value } : current)}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    id={`category-name-${category.id}`}
                    name={`category_name_${category.id}`}
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
                    checked={selectedIds.has(Number(category.id))}
                    onChange={() => toggleSelected(category.id)}
                    disabled={saving || deletingId != null}
                    aria-label={`Select ${category.name}`}
                  />
                  <div className="h-4 w-4 flex-shrink-0 rounded-full" style={{ background: category.color || DEFAULT_CATEGORY_COLOR }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-700 dark:text-gray-300">{category.name}</div>
                    <div className="text-xs text-gray-400">
                      {Number(category.usage_count || 0)} product(s)
                      {category.unresolved_count ? ` - ${category.unresolved_count} need cleanup` : ''}
                    </div>
                    {Array.isArray(category.sample_products) && category.sample_products.length ? (
                      <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {category.sample_products.map((product) => product?.name).filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => setEditing({ ...category, color: category.color || DEFAULT_CATEGORY_COLOR })}
                    className="text-xs text-[var(--ui-accent-ink)] hover:underline"
                    disabled={saving || deletingId != null || category.virtual}
                  >
                    {t('edit') || 'Edit'}
                  </button>
                  {(Number(category.usage_count || 0) > 0 || Number(category.unresolved_count || 0) > 0 || (Array.isArray(category.sample_products) && category.sample_products.length > 0)) ? (
                    <button
                      onClick={() => onReviewSelection?.({ type: 'category', value: category.name })}
                      className="text-xs text-slate-600 hover:underline dark:text-slate-300"
                      disabled={saving || deletingId != null}
                    >
                      {reviewProductsLabel}
                    </button>
                  ) : null}
                  <button onClick={() => void handleDelete(category.id)} className="text-xs text-red-500 hover:underline" disabled={saving || !!deletingId || category.virtual}>
                    {deletingId === category.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
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

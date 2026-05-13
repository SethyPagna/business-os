import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { useApp, useSync } from '../../AppContext'
import { useActionHistory } from '../../utils/actionHistory.mjs'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const DEFAULT_CATEGORY_COLOR = '#3b82f6'

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function snapshotLookupProducts(products = [], field, names = []) {
  const lookups = new Set((names || []).map((name) => normalizeLookup(name)).filter(Boolean))
  if (!lookups.size) return []
  return (Array.isArray(products) ? products : [])
    .filter((product) => lookups.has(normalizeLookup(product?.[field])))
    .map((product) => ({
      id: Number(product?.id || 0),
      name: String(product?.name || ''),
      [field]: String(product?.[field] || ''),
    }))
    .filter((product) => Number.isFinite(product.id) && product.id > 0)
}

function mergeCategoryUsage(categories = [], usageEntries = []) {
  const usageMap = new Map((usageEntries || []).map((entry) => [normalizeLookup(entry?.name), entry]))
  const merged = new Map()
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
      name: entry.name,
      color: DEFAULT_CATEGORY_COLOR,
      usage_count: Number(entry?.usage_count || 0),
      unresolved_count: Number(entry?.unresolved_count || 0),
      sample_products: Array.isArray(entry?.sample_products) ? entry.sample_products : [],
      virtual: true,
    })
  })
  return Array.from(merged.values()).sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
}

export default function ManageCategoriesModal({ onClose, onReviewSelection, t }) {
  const [cats, setCats] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_CATEGORY_COLOR)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const { notify } = useApp()
  const { syncChannel } = useSync()
  const loadRequestRef = useRef(0)
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-categories' })

  const fetchCategories = useCallback(async () => {
    const rows = await window.api.getCategories()
    return Array.isArray(rows) ? rows : []
  }, [])

  const findCategoryById = useCallback(async (id) => {
    const rows = await fetchCategories()
    return rows.find((entry) => Number(entry?.id || 0) === Number(id)) || null
  }, [fetchCategories])

  const findCategoryByName = useCallback(async (name) => {
    const key = normalizeLookup(name)
    if (!key) return null
    const rows = await fetchCategories()
    return rows.find((entry) => normalizeLookup(entry?.name) === key) || null
  }, [fetchCategories])

  const fetchCategoryProductSnapshots = useCallback(async (names = []) => {
    const products = await window.api.getProducts()
    return snapshotLookupProducts(products, 'category', names)
  }, [])

  const restoreCategoryProductSnapshots = useCallback(async (snapshots = []) => {
    if (!snapshots.length) return
    const latestProducts = await window.api.getProducts()
    const latestMap = new Map(
      (Array.isArray(latestProducts) ? latestProducts : [])
        .map((product) => [Number(product?.id || 0), product])
        .filter(([id]) => Number.isFinite(id) && id > 0),
    )
    for (const snapshot of snapshots) {
      const productId = Number(snapshot?.id || 0)
      const latest = latestMap.get(productId)
      if (!latest) continue
      const nextValue = String(snapshot?.category || '').trim()
      const currentValue = String(latest?.category || '').trim()
      if (currentValue === nextValue) continue
      await window.api.updateProduct(productId, {
        category: nextValue,
        expectedUpdatedAt: latest?.updated_at || snapshot?.updated_at || undefined,
      })
    }
  }, [])

  const load = useCallback(async () => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const [data, usage] = await withLoaderTimeout(() => Promise.all([
        window.api.getCategories(),
        window.api.getProductLookupUsage(),
      ]), 'Categories')
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setCats(mergeCategoryUsage(Array.isArray(data) ? data : [], usage?.categories || []))
      setSelectedIds(new Set())
      setErr('')
    } catch (error) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setErr(error?.message || 'Failed to load categories')
    } finally {
      if (isTrackedRequestCurrent(loadRequestRef, requestId)) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (syncChannel?.channel === 'categories') load()
  }, [load, syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => invalidateTrackedRequest(loadRequestRef), [])

  const handleAdd = async () => {
    if (!newName.trim() || saving) return
    setErr('')
    setSaving(true)
    try {
      const payload = { name: newName.trim(), color: newColor }
      const res = await window.api.createCategory(payload)
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
          await window.api.deleteCategory(latest.id, { expectedUpdatedAt: latest.updated_at || undefined })
          await load()
        },
        redo: async () => {
          await window.api.createCategory(payload)
          await load()
        },
      })
    } catch (error) {
      setErr(error?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (cat) => {
    if (saving) return
    setErr('')
    setSaving(true)
    try {
      const previousSnapshot = cats.find((entry) => Number(entry?.id || 0) === Number(cat?.id || 0))
      const payload = {
        name: cat.name,
        color: cat.color,
        expectedUpdatedAt: cat.updated_at || undefined,
      }
      const res = await window.api.updateCategory(cat.id, {
        ...payload,
      })
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
            await window.api.updateCategory(previousSnapshot.id, {
              name: previousSnapshot.name,
              color: previousSnapshot.color || DEFAULT_CATEGORY_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
            })
            await load()
          },
          redo: async () => {
            const latest = await findCategoryById(previousSnapshot.id)
            if (!latest) throw new Error('Category no longer exists.')
            await window.api.updateCategory(previousSnapshot.id, {
              name: payload.name,
              color: payload.color || DEFAULT_CATEGORY_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
            })
            await load()
          },
        })
      }
    } catch (error) {
      setErr(error?.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (saving || deletingId) return
    if (!confirm(t('confirm_delete'))) return
    setDeletingId(id)
    try {
      const category = cats.find((item) => Number(item.id) === Number(id))
      const deletedEntries = category ? [{ id: Number(category.id), name: category.name, color: category.color || DEFAULT_CATEGORY_COLOR }] : []
      const productSnapshots = await fetchCategoryProductSnapshots(deletedEntries.map((entry) => entry.name))
      await window.api.deleteCategory(id, { expectedUpdatedAt: category?.updated_at || undefined })
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
              if (!existing) await window.api.createCategory({ name: entry.name, color: entry.color || DEFAULT_CATEGORY_COLOR })
            }
            await restoreCategoryProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) continue
              await window.api.deleteCategory(existing.id, { expectedUpdatedAt: existing.updated_at || undefined })
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(error?.message || 'Failed', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const toggleSelected = (id) => {
    const numericId = Number(id)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const visibleIds = cats.map((category) => Number(category.id))
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id))
      const next = new Set(current)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (saving || deletingId || selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected categor${selectedIds.size === 1 ? 'y' : 'ies'}?`)) return
    const ids = Array.from(selectedIds)
    setDeletingId('selected')
    try {
      const deletedEntries = ids
        .map((id) => cats.find((item) => Number(item.id) === Number(id)))
        .filter(Boolean)
        .map((category) => ({
          id: Number(category.id),
          name: category.name,
          color: category.color || DEFAULT_CATEGORY_COLOR,
          updated_at: category.updated_at || undefined,
        }))
      const productSnapshots = await fetchCategoryProductSnapshots(deletedEntries.map((entry) => entry.name))
      for (const id of ids) {
        const category = cats.find((item) => Number(item.id) === Number(id))
        if (!category) continue
        await window.api.deleteCategory(id, { expectedUpdatedAt: category?.updated_at || undefined })
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
              if (!existing) await window.api.createCategory({ name: entry.name, color: entry.color || DEFAULT_CATEGORY_COLOR })
            }
            await restoreCategoryProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findCategoryByName(entry.name)
              if (!existing) continue
              await window.api.deleteCategory(existing.id, { expectedUpdatedAt: existing.updated_at || undefined })
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(error?.message || 'Failed to delete selected categories', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal title={t('manage_categories') || 'Manage Categories'} onClose={onClose}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}
        <ActionHistoryBar history={actionHistory} />

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
              onKeyDown={(event) => { if (event.key === 'Enter') handleAdd() }}
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
          <button className="btn-primary" onClick={handleAdd} disabled={saving}>
            {saving ? (t('saving') || 'Saving...') : (t('add') || 'Add')}
          </button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto">
          {loading ? <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">{t('loading') || 'Loading...'}</div> : null}
          {!loading && cats.length > 0 ? (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
              <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={cats.length > 0 && cats.every((category) => selectedIds.has(Number(category.id)))}
                  onChange={toggleAllVisible}
                />
                <span>{selectedIds.size ? `${selectedIds.size} selected` : 'Select visible'}</span>
              </label>
              <button
                type="button"
                className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                onClick={handleDeleteSelected}
                disabled={!selectedIds.size || saving || deletingId != null}
              >
                {deletingId === 'selected' ? (t('deleting') || 'Deleting...') : 'Delete selected'}
              </button>
            </div>
          ) : null}
          {cats.map((category) => (
            <div key={category.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-2 dark:border-gray-700">
              {editing?.id === category.id ? (
                <>
                  <input
                    id={`category-color-${category.id}`}
                    name={`category_color_${category.id}`}
                    type="color"
                    value={editing.color || DEFAULT_CATEGORY_COLOR}
                    onChange={(event) => setEditing((current) => ({ ...current, color: event.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    id={`category-name-${category.id}`}
                    name={`category_name_${category.id}`}
                    className="input flex-1 py-1"
                    value={editing.name}
                    onChange={(event) => setEditing((current) => ({ ...current, name: event.target.value }))}
                  />
                  <button className="btn-primary px-3 py-1 text-xs" onClick={() => handleUpdate(editing)} disabled={saving}>
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
                    className="text-xs text-blue-500 hover:underline"
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
                      {t('review_products') || 'Review products'}
                    </button>
                  ) : null}
                  <button onClick={() => handleDelete(category.id)} className="text-xs text-red-500 hover:underline" disabled={!!deletingId || category.virtual}>
                    {deletingId === category.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp, useSync } from '../../AppContext'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.mjs'

const DEFAULT_CATEGORY_COLOR = '#3b82f6'

export default function ManageCategoriesModal({ onClose, t }) {
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

  const load = useCallback(async () => {
    const requestId = beginTrackedRequest(loadRequestRef)
    setLoading(true)
    try {
      const data = await withLoaderTimeout(() => window.api.getCategories(), 'Categories')
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return
      setCats(Array.isArray(data) ? data : [])
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
      const res = await window.api.createCategory({ name: newName.trim(), color: newColor })
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setNewName('')
      setNewColor(DEFAULT_CATEGORY_COLOR)
      load()
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
      const res = await window.api.updateCategory(cat.id, {
        name: cat.name,
        color: cat.color,
        expectedUpdatedAt: cat.updated_at || undefined,
      })
      if (res?.success === false) {
        setErr(res.error || 'Failed')
        return
      }
      setEditing(null)
      load()
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
      await window.api.deleteCategory(id, { expectedUpdatedAt: category?.updated_at || undefined })
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(Number(id))
        return next
      })
      load()
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
      for (const id of ids) {
        const category = cats.find((item) => Number(item.id) === Number(id))
        if (!category) continue
        await window.api.deleteCategory(id, { expectedUpdatedAt: category?.updated_at || undefined })
      }
      notify(`Deleted ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'}`, 'success')
      setSelectedIds(new Set())
      load()
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
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">{category.name}</span>
                  <button
                    onClick={() => setEditing({ ...category, color: category.color || DEFAULT_CATEGORY_COLOR })}
                    className="text-xs text-blue-500 hover:underline"
                    disabled={saving || deletingId != null}
                  >
                    {t('edit') || 'Edit'}
                  </button>
                  <button onClick={() => handleDelete(category.id)} className="text-xs text-red-500 hover:underline" disabled={!!deletingId}>
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

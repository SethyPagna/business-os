import { useCallback, useEffect, useState } from 'react'
import Modal from '../shared/Modal'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { useApp, useSync } from '../../AppContext'
import { useActionHistory } from '../../utils/actionHistory.mjs'

const DEFAULT_UNIT_COLOR = '#6366f1'

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

function mergeUnitUsage(units = [], usageEntries = []) {
  const usageMap = new Map((usageEntries || []).map((entry) => [normalizeLookup(entry?.name), entry]))
  const merged = new Map()
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
      name: entry.name,
      color: DEFAULT_UNIT_COLOR,
      usage_count: Number(entry?.usage_count || 0),
      unresolved_count: Number(entry?.unresolved_count || 0),
      sample_products: Array.isArray(entry?.sample_products) ? entry.sample_products : [],
      virtual: true,
    })
  })
  return Array.from(merged.values()).sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || '')))
}

export default function ManageUnitsModal({ onClose, onReviewSelection, t }) {
  const [units, setUnits] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_UNIT_COLOR)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const { notify } = useApp()
  const { syncChannel } = useSync()
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-units' })

  const fetchUnits = useCallback(async () => {
    const rows = await window.api.getUnits()
    return Array.isArray(rows) ? rows : []
  }, [])

  const findUnitById = useCallback(async (id) => {
    const rows = await fetchUnits()
    return rows.find((entry) => Number(entry?.id || 0) === Number(id)) || null
  }, [fetchUnits])

  const findUnitByName = useCallback(async (name) => {
    const key = normalizeLookup(name)
    if (!key) return null
    const rows = await fetchUnits()
    return rows.find((entry) => normalizeLookup(entry?.name) === key) || null
  }, [fetchUnits])

  const fetchUnitProductSnapshots = useCallback(async (names = []) => {
    const products = await window.api.getProducts()
    return snapshotLookupProducts(products, 'unit', names)
  }, [])

  const restoreUnitProductSnapshots = useCallback(async (snapshots = []) => {
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
      const nextValue = String(snapshot?.unit || '').trim()
      const currentValue = String(latest?.unit || '').trim()
      if (currentValue === nextValue) continue
      await window.api.updateProduct(productId, {
        unit: nextValue,
        expectedUpdatedAt: latest?.updated_at || snapshot?.updated_at || undefined,
      })
    }
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [data, usage] = await Promise.all([window.api.getUnits(), window.api.getProductLookupUsage()])
      setUnits(mergeUnitUsage(Array.isArray(data) ? data : [], usage?.units || []))
      setSelectedIds(new Set())
      setErr('')
    } catch (error) {
      setErr(error?.message || 'Failed to load units')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (syncChannel?.channel === 'units') load()
  }, [syncChannel]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!newName.trim() || saving) return
    setErr('')
    setSaving(true)
    try {
      const payload = { name: newName.trim(), color: newColor }
      const res = await window.api.createUnit(payload)
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
          await window.api.deleteUnit(latest.id, { expectedUpdatedAt: latest.updated_at || undefined })
          await load()
        },
        redo: async () => {
          await window.api.createUnit(payload)
          await load()
        },
      })
    } catch (error) {
      setErr(error.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (unit) => {
    if (saving) return
    setErr('')
    setSaving(true)
    try {
      const previousSnapshot = units.find((entry) => Number(entry?.id || 0) === Number(unit?.id || 0))
      const payload = { name: unit.name, color: unit.color, expectedUpdatedAt: unit.updated_at || undefined }
      const res = await window.api.updateUnit(unit.id, payload)
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
            await window.api.updateUnit(previousSnapshot.id, {
              name: previousSnapshot.name,
              color: previousSnapshot.color || DEFAULT_UNIT_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
            })
            await load()
          },
          redo: async () => {
            const latest = await findUnitById(previousSnapshot.id)
            if (!latest) throw new Error('Unit no longer exists.')
            await window.api.updateUnit(previousSnapshot.id, {
              name: payload.name,
              color: payload.color || DEFAULT_UNIT_COLOR,
              expectedUpdatedAt: latest.updated_at || undefined,
            })
            await load()
          },
        })
      }
    } catch (error) {
      setErr(error.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (saving || deletingId) return
    if (!confirm(t('confirm_delete'))) return
    setDeletingId(id)
    try {
      const unit = units.find((item) => Number(item.id) === Number(id))
      const deletedEntries = unit ? [{ id: Number(unit.id), name: unit.name, color: unit.color || DEFAULT_UNIT_COLOR }] : []
      const productSnapshots = await fetchUnitProductSnapshots(deletedEntries.map((entry) => entry.name))
      await window.api.deleteUnit(id, { expectedUpdatedAt: unit?.updated_at || undefined })
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
              if (!existing) await window.api.createUnit({ name: entry.name, color: entry.color || DEFAULT_UNIT_COLOR })
            }
            await restoreUnitProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) continue
              await window.api.deleteUnit(existing.id, { expectedUpdatedAt: existing.updated_at || undefined })
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(error.message || 'Failed', 'error')
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

  const handleDeleteSelected = async () => {
    if (saving || deletingId || selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} selected unit${selectedIds.size === 1 ? '' : 's'}?`)) return
    const ids = Array.from(selectedIds)
    setDeletingId('selected')
    try {
      const deletedEntries = ids
        .map((id) => units.find((item) => Number(item.id) === Number(id)))
        .filter(Boolean)
        .map((unit) => ({
          id: Number(unit.id),
          name: unit.name,
          color: unit.color || DEFAULT_UNIT_COLOR,
          updated_at: unit.updated_at || undefined,
        }))
      const productSnapshots = await fetchUnitProductSnapshots(deletedEntries.map((entry) => entry.name))
      for (const id of ids) {
        const unit = units.find((item) => Number(item.id) === Number(id))
        if (!unit) continue
        await window.api.deleteUnit(id, { expectedUpdatedAt: unit?.updated_at || undefined })
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
              if (!existing) await window.api.createUnit({ name: entry.name, color: entry.color || DEFAULT_UNIT_COLOR })
            }
            await restoreUnitProductSnapshots(productSnapshots)
            await load()
          },
          redo: async () => {
            for (const entry of deletedEntries) {
              const existing = await findUnitByName(entry.name)
              if (!existing) continue
              await window.api.deleteUnit(existing.id, { expectedUpdatedAt: existing.updated_at || undefined })
            }
            await load()
          },
        })
      }
    } catch (error) {
      notify(error?.message || 'Failed to delete selected units', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Modal title={t('manage_units') || 'Manage Units'} onClose={onClose}>
      <div className="space-y-4">
        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}
        <ActionHistoryBar history={actionHistory} />

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
              onKeyDown={(event) => { if (event.key === 'Enter') handleAdd() }}
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
          <button className="btn-primary" onClick={handleAdd} disabled={saving}>{saving ? (t('saving') || 'Saving...') : (t('add') || 'Add')}</button>
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
                onClick={handleDeleteSelected}
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
                    onChange={(event) => setEditing((current) => ({ ...current, color: event.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded border border-gray-300"
                  />
                  <input
                    id={`unit-name-${unit.id}`}
                    name={`unit_name_${unit.id}`}
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
                  <button onClick={() => setEditing({ ...unit, color: unit.color || DEFAULT_UNIT_COLOR })} className="text-xs text-blue-500 hover:underline" disabled={unit.virtual}>
                    {t('edit') || 'Edit'}
                  </button>
                  {(Number(unit.usage_count || 0) > 0 || Number(unit.unresolved_count || 0) > 0 || (Array.isArray(unit.sample_products) && unit.sample_products.length > 0)) ? (
                    <button
                      onClick={() => onReviewSelection?.({ type: 'unit', value: unit.name })}
                      className="text-xs text-slate-600 hover:underline dark:text-slate-300"
                      disabled={saving || deletingId != null}
                    >
                      {t('review_products') || 'Review products'}
                    </button>
                  ) : null}
                  <button onClick={() => handleDelete(unit.id)} className="text-xs text-red-500 hover:underline" disabled={!!deletingId || unit.virtual}>
                    {deletingId === unit.id ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
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

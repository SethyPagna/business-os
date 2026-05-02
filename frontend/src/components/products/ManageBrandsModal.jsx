import { useEffect, useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import { useApp } from '../../AppContext'

function parseBrandOptions(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

function toTitleCase(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export default function ManageBrandsModal({
  onClose,
  onDone,
  products = [],
  user,
  t,
}) {
  const { settings, notify } = useApp()
  const [newBrand, setNewBrand] = useState('')
  const [renamingBrand, setRenamingBrand] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedBrands, setSelectedBrands] = useState(() => new Set())

  const libraryBrands = useMemo(
    () => parseBrandOptions(settings?.product_brand_options),
    [settings?.product_brand_options]
  )

  const brandsWithUsage = useMemo(() => {
    const usage = new Map()
    for (const product of products || []) {
      const name = String(product?.brand || '').trim()
      if (!name) continue
      usage.set(name, (usage.get(name) || 0) + 1)
    }

    const merged = new Set([...libraryBrands, ...usage.keys()])
    return Array.from(merged)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, usage: usage.get(name) || 0 }))
  }, [libraryBrands, products])

  useEffect(() => {
    const available = new Set(brandsWithUsage.map((entry) => entry.name))
    setSelectedBrands((current) => {
      const next = new Set(Array.from(current).filter((name) => available.has(name)))
      return next.size === current.size ? current : next
    })
  }, [brandsWithUsage])

  const saveLibrary = async (brands) => {
    const normalizedMap = new Map()
    ;(brands || [])
      .map((entry) => toTitleCase(entry))
      .filter(Boolean)
      .forEach((entry) => {
        const key = normalizeLookup(entry)
        if (!normalizedMap.has(key)) normalizedMap.set(key, entry)
      })
    const clean = Array.from(normalizedMap.values()).sort((a, b) => a.localeCompare(b))

    await window.api.saveSettings({
      product_brand_options: JSON.stringify(clean),
    })
  }

  const addLibraryBrand = async () => {
    const clean = toTitleCase(newBrand)
    if (!clean) return
    if (brandsWithUsage.some((entry) => normalizeLookup(entry.name) === normalizeLookup(clean))) {
      setError('Brand already exists')
      return
    }

    setBusy(true)
    setError('')
    try {
      await saveLibrary([...libraryBrands, clean])
      setNewBrand('')
      notify(`${t('brand') || 'Brand'} added`, 'success')
      onDone?.()
    } catch (e) {
      setError(e?.message || 'Failed to save brand')
    } finally {
      setBusy(false)
    }
  }

  const renameBrand = async (fromName, toNameRaw) => {
    const from = String(fromName || '').trim()
    const to = toTitleCase(toNameRaw)
    if (!from || !to) return
    const fromLookup = normalizeLookup(from)
    const toLookup = normalizeLookup(to)

    setBusy(true)
    setError('')
    try {
      const affected = products.filter((product) => {
        const brandLookup = normalizeLookup(product?.brand)
        return brandLookup === fromLookup || brandLookup === toLookup
      })
      const chunkSize = 20
      for (let index = 0; index < affected.length; index += chunkSize) {
        const chunk = affected.slice(index, index + chunkSize)
        await Promise.all(chunk.map((product) => (
          window.api.updateProduct(product.id, {
            brand: to,
            userId: user?.id,
            userName: user?.name,
          })
        )))
      }

      const nextLibrary = [...libraryBrands, to]
        .map((entry) => {
          const lookup = normalizeLookup(entry)
          if (lookup === fromLookup || lookup === toLookup) return to
          return entry
        })
      await saveLibrary(nextLibrary)

      notify(`Brand updated to "${to}"`, 'success')
      setRenamingBrand('')
      setRenameValue('')
      onDone?.()
    } catch (e) {
      setError(e?.message || 'Failed to rename brand')
    } finally {
      setBusy(false)
    }
  }

  const removeBrands = async (names) => {
    const brandNames = Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean)))
    if (!brandNames.length) return

    const lookups = new Set(brandNames.map((name) => normalizeLookup(name)))
    const affected = products.filter((product) => lookups.has(normalizeLookup(product?.brand)))
    const clearAppliedBrands = affected.length > 0
      ? window.confirm(`${brandNames.length} brand${brandNames.length === 1 ? '' : 's'} are used by ${affected.length} visible product(s). Clear those product brand fields too?`)
      : window.confirm(`Delete ${brandNames.length} selected brand${brandNames.length === 1 ? '' : 's'}?`)

    if (!clearAppliedBrands) return

    setBusy(true)
    setError('')
    try {
      for (const product of affected) {
        await window.api.updateProduct(product.id, {
          brand: '',
          userId: user?.id,
          userName: user?.name,
        })
      }

      const nextLibrary = libraryBrands.filter((entry) => !lookups.has(normalizeLookup(entry)))
      await saveLibrary(nextLibrary)

      notify(`Removed ${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`, 'success')
      setSelectedBrands(new Set())
      onDone?.()
    } catch (e) {
      setError(e?.message || 'Failed to remove brand')
    } finally {
      setBusy(false)
    }
  }

  const removeBrand = (name) => removeBrands([name])

  const toggleSelectedBrand = (name) => {
    setSelectedBrands((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAllVisibleBrands = () => {
    setSelectedBrands((current) => {
      const names = brandsWithUsage.map((entry) => entry.name)
      const allSelected = names.length > 0 && names.every((name) => current.has(name))
      const next = new Set(current)
      for (const name of names) {
        if (allSelected) next.delete(name)
        else next.add(name)
      }
      return next
    })
  }

  return (
    <Modal title={`🏷️ ${t('brand') || 'Brand'} ${t('manage') || 'Manage'}`} onClose={onClose}>
      <div className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</div> : null}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Add brand</label>
            <input
              className="input"
              value={newBrand}
              onChange={(event) => setNewBrand(event.target.value)}
              placeholder="e.g. L'Oreal"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addLibraryBrand()
              }}
            />
          </div>
          <button type="button" className="btn-primary" onClick={addLibraryBrand} disabled={busy}>
            {t('add') || 'Add'}
          </button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {brandsWithUsage.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
              No brands yet
            </div>
          ) : (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
                <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={brandsWithUsage.length > 0 && brandsWithUsage.every((entry) => selectedBrands.has(entry.name))}
                    onChange={toggleAllVisibleBrands}
                  />
                  <span>{selectedBrands.size ? `${selectedBrands.size} selected` : 'Select visible'}</span>
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                  onClick={() => removeBrands(Array.from(selectedBrands))}
                  disabled={!selectedBrands.size || busy}
                >
                  Delete selected
                </button>
              </div>
              {brandsWithUsage.map((entry) => {
            const isEditing = renamingBrand === entry.name
            return (
              <div key={entry.name} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="input flex-1 py-1"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="btn-primary px-3 py-1 text-xs"
                      onClick={() => renameBrand(entry.name, renameValue)}
                      disabled={busy}
                    >
                      {t('save') || 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1 text-xs"
                      onClick={() => { setRenamingBrand(''); setRenameValue('') }}
                      disabled={busy}
                    >
                      {t('cancel') || 'Cancel'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedBrands.has(entry.name)}
                      onChange={() => toggleSelectedBrand(entry.name)}
                      disabled={busy}
                      aria-label={`Select ${entry.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{entry.name}</div>
                      <div className="text-xs text-gray-400">{entry.usage} product(s)</div>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        setRenamingBrand(entry.name)
                        setRenameValue(entry.name)
                      }}
                      disabled={busy}
                    >
                      {t('edit') || 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => removeBrand(entry.name)}
                      disabled={busy}
                    >
                      {t('delete') || 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

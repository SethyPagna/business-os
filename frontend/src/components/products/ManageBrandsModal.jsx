import { useEffect, useMemo, useState } from 'react'
import Modal from '../shared/Modal'
import ActionHistoryBar from '../shared/ActionHistoryBar.jsx'
import { useApp } from '../../AppContext'
import { useActionHistory } from '../../utils/actionHistory.mjs'

const DEFAULT_BRAND_COLOR = '#f97316'
const BRAND_REVIEW_RULES = {
  advanced: { tone: 'safe', suggestedName: 'Advanced Clinicals', reason: 'All current matches use the Advanced Clinicals name.' },
  patrick: { tone: 'safe', suggestedName: 'Patrick Ta', reason: 'Current matches consistently use Patrick Ta in the product title.' },
  real: { tone: 'safe', suggestedName: 'Real Techniques', reason: 'Current matches consistently use Real Techniques in the product title.' },
  la: { tone: 'review', reason: 'Mixed La Mer, La Prairie, and La Roche rows need a manual split.' },
  makeup: { tone: 'review', reason: 'Mixed Makeup by Mario and Makeup Forever rows need a manual split.' },
  one: { tone: 'review', reason: 'Contains both One/Size and Old Spice items.' },
  m: { tone: 'review', reason: 'Contains multiple different brands and needs manual review.' },
  miss: { tone: 'review', reason: 'Contains Miss Dior and unrelated items.' },
  beauty: { tone: 'review', reason: 'Contains Beauty Bakerie and Beauty Blender items.' },
  good: { tone: 'review', reason: 'Contains Good Girl and unrelated rows.' },
  pat: { tone: 'review', reason: 'Mostly Pat McGrath, but includes unrelated rows.' },
  perfume: { tone: 'review', reason: 'Used for packaging items rather than a real brand.' },
  old: { tone: 'review', reason: 'Contains Old Spice and unrelated Olay rows.' },
  tree: { tone: 'review', reason: 'Contains Tree Hut and unrelated Too Faced rows.' },
}

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

function parseBrandColorMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
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

function getBrandReviewRule(name) {
  return BRAND_REVIEW_RULES[normalizeLookup(name)] || null
}

function getBrandSortScore(entry) {
  if (entry?.reviewRule?.tone === 'review') return 0
  if (entry?.reviewRule?.tone === 'safe') return 1
  return 2
}

function buildSavedLibrary(brands = [], colorOverrides = {}, existingColorMap = {}) {
  const normalizedMap = new Map()
  ;(brands || [])
    .map((entry) => toTitleCase(entry))
    .filter(Boolean)
    .forEach((entry) => {
      const key = normalizeLookup(entry)
      if (!normalizedMap.has(key)) normalizedMap.set(key, entry)
    })
  const clean = Array.from(normalizedMap.values()).sort((a, b) => a.localeCompare(b))
  const cleanColorMap = {}
  clean.forEach((name) => {
    const lookup = normalizeLookup(name)
    cleanColorMap[lookup] = colorOverrides[lookup] || existingColorMap[lookup] || DEFAULT_BRAND_COLOR
  })
  return { brands: clean, colorMap: cleanColorMap }
}

export default function ManageBrandsModal({
  onClose,
  onDone,
  onReviewSelection,
  user,
  t,
}) {
  const { settings, notify } = useApp()
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-brands' })
  const reviewProductsLabel = t('review_products') && t('review_products') !== 'review_products'
    ? t('review_products')
    : 'Review products'
  const [newBrand, setNewBrand] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_BRAND_COLOR)
  const [renamingBrand, setRenamingBrand] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [renameColor, setRenameColor] = useState(DEFAULT_BRAND_COLOR)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedBrands, setSelectedBrands] = useState(() => new Set())
  const [usageSummary, setUsageSummary] = useState([])

  const libraryBrands = useMemo(
    () => parseBrandOptions(settings?.product_brand_options),
    [settings?.product_brand_options]
  )
  const brandColorMap = useMemo(
    () => parseBrandColorMap(settings?.product_brand_color_map),
    [settings?.product_brand_color_map]
  )

  const reloadUsageSummary = async () => {
    const result = await window.api.getProductLookupUsage()
    setUsageSummary(Array.isArray(result?.brands) ? result.brands : [])
  }

  const brandsWithUsage = useMemo(() => {
    const usageMap = new Map((usageSummary || []).map((entry) => [normalizeLookup(entry?.name), entry]))
    const merged = new Set([
      ...libraryBrands,
      ...Array.from(usageMap.values()).map((entry) => String(entry?.name || '').trim()).filter(Boolean),
    ])
    return Array.from(merged)
      .map((name) => {
        const usage = usageMap.get(normalizeLookup(name))
        return {
          name,
          usage: Number(usage?.usage_count || 0),
          unresolvedCount: Number(usage?.unresolved_count || 0),
          sampleProducts: Array.isArray(usage?.sample_products) ? usage.sample_products : [],
          color: brandColorMap[normalizeLookup(name)] || DEFAULT_BRAND_COLOR,
          reviewRule: getBrandReviewRule(name),
        }
      })
      .sort((a, b) => {
        const reviewDelta = getBrandSortScore(a) - getBrandSortScore(b)
        if (reviewDelta) return reviewDelta
        const usageDelta = Number(b.usage || 0) - Number(a.usage || 0)
        if (usageDelta) return usageDelta
        return a.name.localeCompare(b.name)
      })
  }, [brandColorMap, libraryBrands, usageSummary])

  const reviewSummary = useMemo(() => {
    return brandsWithUsage.reduce((acc, entry) => {
      if (entry.reviewRule?.tone === 'review') acc.review += 1
      if (entry.reviewRule?.tone === 'safe') acc.safe += 1
      return acc
    }, { review: 0, safe: 0 })
  }, [brandsWithUsage])

  useEffect(() => {
    let cancelled = false
    window.api.getProductLookupUsage()
      .then((result) => {
        if (cancelled) return
        setUsageSummary(Array.isArray(result?.brands) ? result.brands : [])
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(loadError?.message || 'Failed to load brand usage')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const available = new Set(brandsWithUsage.map((entry) => entry.name))
    setSelectedBrands((current) => {
      const next = new Set(Array.from(current).filter((name) => available.has(name)))
      return next.size === current.size ? current : next
    })
  }, [brandsWithUsage])

  const saveLibrary = async (brands, colorOverrides = {}) => {
    const { brands: clean, colorMap: cleanColorMap } = buildSavedLibrary(brands, colorOverrides, brandColorMap)

    await window.api.saveSettings({
      product_brand_options: JSON.stringify(clean),
      product_brand_color_map: JSON.stringify(cleanColorMap),
    })
  }

  const restoreProductFieldSnapshots = async (field, snapshots = []) => {
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
      const nextValue = String(snapshot?.[field] || '').trim()
      const currentValue = String(latest?.[field] || '').trim()
      if (currentValue === nextValue) continue
      await window.api.updateProduct(productId, {
        [field]: nextValue,
        expectedUpdatedAt: latest?.updated_at || snapshot?.updated_at || undefined,
        userId: user?.id,
        userName: user?.name,
      })
    }
  }

  const addLibraryBrand = async () => {
    const clean = toTitleCase(newBrand)
    if (!clean) return
    if (brandsWithUsage.some((entry) => normalizeLookup(entry.name) === normalizeLookup(clean))) {
      setError(t('brand_already_exists') || 'Brand already exists')
      return
    }

    setBusy(true)
    setError('')
    try {
      const previousLibrary = [...libraryBrands]
      const previousColorMap = { ...brandColorMap }
      const nextLookup = normalizeLookup(clean)
      const nextLibraryState = buildSavedLibrary(
        [...libraryBrands, clean],
        { [nextLookup]: newColor || DEFAULT_BRAND_COLOR },
        brandColorMap,
      )
      await saveLibrary([...libraryBrands, clean], { [normalizeLookup(clean)]: newColor || DEFAULT_BRAND_COLOR })
      await reloadUsageSummary()
      setNewBrand('')
      setNewColor(DEFAULT_BRAND_COLOR)
      notify(`${t('brand') || 'Brand'} added`, 'success')
      actionHistory.pushAction({
        label: `Add brand ${clean}`.trim(),
        undo: async () => {
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          })
          await reloadUsageSummary()
        },
        redo: async () => {
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          })
          await reloadUsageSummary()
        },
      })
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
      const targetAlreadyExists = brandsWithUsage.some((entry) => normalizeLookup(entry.name) === toLookup && normalizeLookup(entry.name) !== fromLookup)
      const previousLibrary = [...libraryBrands]
      const previousColorMap = { ...brandColorMap }
      const allProducts = await window.api.getProducts()
      const productSnapshots = snapshotLookupProducts(allProducts, 'brand', [from, to])
      await window.api.replaceProductLookupValues({
        type: 'brand',
        from: [from, to],
        to,
        userId: user?.id,
        userName: user?.name,
      })

      const nextLibrary = [...libraryBrands, to]
        .map((entry) => {
          const lookup = normalizeLookup(entry)
          if (lookup === fromLookup || lookup === toLookup) return to
          return entry
        })
      const nextLibraryState = buildSavedLibrary(
        nextLibrary,
        { [toLookup]: renameColor || brandColorMap[fromLookup] || DEFAULT_BRAND_COLOR },
        brandColorMap,
      )
      await saveLibrary(nextLibrary, { [toLookup]: renameColor || brandColorMap[fromLookup] || DEFAULT_BRAND_COLOR })
      await reloadUsageSummary()

      notify(`Brand updated to "${to}"`, 'success')
      setRenamingBrand('')
      setRenameValue('')
      actionHistory.pushAction({
        label: `${targetAlreadyExists ? 'Merge' : 'Rename'} brand ${from} to ${to}`.trim(),
        undo: async () => {
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          })
          await restoreProductFieldSnapshots('brand', productSnapshots)
          await reloadUsageSummary()
        },
        redo: async () => {
          await window.api.replaceProductLookupValues({
            type: 'brand',
            from: [from, to],
            to,
            userId: user?.id,
            userName: user?.name,
          })
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          })
          await reloadUsageSummary()
        },
      })
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
    const affectedCount = brandsWithUsage
      .filter((entry) => lookups.has(normalizeLookup(entry.name)))
      .reduce((sum, entry) => sum + Number(entry.usage || 0), 0)
    const clearAppliedBrands = affectedCount > 0
      ? window.confirm(`${brandNames.length} brand${brandNames.length === 1 ? '' : 's'} are used by ${affectedCount} product(s). Clear those product brand fields too?`)
      : window.confirm(`Delete ${brandNames.length} selected brand${brandNames.length === 1 ? '' : 's'}?`)

    if (!clearAppliedBrands) return

    setBusy(true)
    setError('')
    try {
      const allProducts = await window.api.getProducts()
      const productSnapshots = snapshotLookupProducts(allProducts, 'brand', brandNames)
      const previousLibrary = [...libraryBrands]
      const previousColorMap = { ...brandColorMap }
      await window.api.replaceProductLookupValues({
        type: 'brand',
        from: brandNames,
        to: null,
        userId: user?.id,
        userName: user?.name,
      })

      const nextLibrary = libraryBrands.filter((entry) => !lookups.has(normalizeLookup(entry)))
      const nextLibraryState = buildSavedLibrary(nextLibrary, {}, brandColorMap)
      await saveLibrary(nextLibrary)
      await reloadUsageSummary()

      notify(`Removed ${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`, 'success')
      setSelectedBrands(new Set())
      actionHistory.pushAction({
        label: `Delete ${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`.trim(),
        undo: async () => {
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          })
          await restoreProductFieldSnapshots('brand', productSnapshots)
          await reloadUsageSummary()
        },
        redo: async () => {
          await window.api.replaceProductLookupValues({
            type: 'brand',
            from: brandNames,
            to: null,
            userId: user?.id,
            userName: user?.name,
          })
          await window.api.saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          })
          await reloadUsageSummary()
        },
      })
      onDone?.()
    } catch (e) {
      setError(e?.message || 'Failed to remove brand')
    } finally {
      setBusy(false)
    }
  }

  const removeBrand = (name) => removeBrands([name])

  const applySuggestedNormalization = async (entry) => {
    const reviewRule = entry?.reviewRule
    if (!reviewRule?.suggestedName || reviewRule.tone !== 'safe') return
    await renameBrand(entry.name, reviewRule.suggestedName)
  }

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
    <Modal title={`${t('brand') || 'Brand'} ${t('manage') || 'Manage'}`} onClose={onClose}>
      <div className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</div> : null}
        <ActionHistoryBar history={actionHistory} />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">{t('add_brand') || 'Add brand'}</label>
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
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t('color') || 'Color'}
            <input
              type="color"
              className="h-10 w-12 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900"
              value={newColor}
              onChange={(event) => setNewColor(event.target.value)}
              disabled={busy}
              aria-label={t('brand_color') || 'Brand color'}
            />
          </label>
          <button type="button" className="btn-primary" onClick={addLibraryBrand} disabled={busy}>
            {t('add') || 'Add'}
          </button>
        </div>

        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {brandsWithUsage.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
              {t('no_brands_yet') || 'No brands yet'}
            </div>
          ) : (
            <>
              {(reviewSummary.review || reviewSummary.safe) ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                  <div className="font-medium">
                    {reviewSummary.review
                      ? `${reviewSummary.review} brand${reviewSummary.review === 1 ? '' : 's'} need manual review`
                      : 'No ambiguous brands need review'}
                  </div>
                  {reviewSummary.safe ? (
                    <div className="mt-1 opacity-80">
                      {reviewSummary.safe} safe normalization suggestion{reviewSummary.safe === 1 ? '' : 's'} are ready to apply.
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/95">
                <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={brandsWithUsage.length > 0 && brandsWithUsage.every((entry) => selectedBrands.has(entry.name))}
                    onChange={toggleAllVisibleBrands}
                  />
                  <span>{selectedBrands.size ? `${selectedBrands.size} ${t('selected') || 'selected'}` : (t('select_visible') || 'Select visible')}</span>
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                  onClick={() => removeBrands(Array.from(selectedBrands))}
                  disabled={!selectedBrands.size || busy}
                >
                  {t('delete_selected') || 'Delete selected'}
                </button>
              </div>
              {brandsWithUsage.map((entry) => {
            const isEditing = renamingBrand === entry.name
            return (
              <div key={entry.name} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-9 w-11 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900"
                      value={renameColor}
                      onChange={(event) => setRenameColor(event.target.value)}
                      disabled={busy}
                      aria-label={`${entry.name} ${t('color') || 'color'}`}
                    />
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
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 flex-shrink-0 rounded-full border border-black/10 dark:border-white/20"
                          style={{ backgroundColor: entry.color }}
                          aria-hidden="true"
                        />
                        <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{entry.name}</div>
                        {entry.reviewRule ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              entry.reviewRule.tone === 'safe'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}
                          >
                            {entry.reviewRule.tone === 'safe' ? 'normalize' : 'review'}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1 text-xs text-gray-400">
                        <div>{entry.usage} product(s)</div>
                        {entry.unresolvedCount ? <div className="text-amber-600 dark:text-amber-300">{entry.unresolvedCount} need cleanup</div> : null}
                        {entry.reviewRule?.reason ? (
                          <div className="text-[11px] text-amber-600 dark:text-amber-300">
                            {entry.reviewRule.reason}
                          </div>
                        ) : null}
                        {entry.sampleProducts.length ? (
                          <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                            {entry.sampleProducts.map((product) => product?.name).filter(Boolean).join(', ')}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        setRenamingBrand(entry.name)
                        setRenameValue(entry.name)
                        setRenameColor(entry.color || DEFAULT_BRAND_COLOR)
                      }}
                      disabled={busy}
                    >
                      {t('edit') || 'Edit'}
                    </button>
                    {(entry.usage > 0 || entry.unresolvedCount > 0 || entry.sampleProducts.length > 0) ? (
                      <button
                        type="button"
                        className="text-xs text-slate-600 hover:underline dark:text-slate-300"
                        onClick={() => onReviewSelection?.({ type: 'brand', value: entry.name })}
                        disabled={busy}
                      >
                        {reviewProductsLabel}
                      </button>
                    ) : null}
                    {entry.reviewRule?.tone === 'safe' && entry.reviewRule?.suggestedName ? (
                      <button
                        type="button"
                        className="text-xs text-emerald-600 hover:underline"
                        onClick={() => applySuggestedNormalization(entry)}
                        disabled={busy}
                      >
                        Normalize
                      </button>
                    ) : null}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import Modal from '../../shared/Modal'
import ActionHistoryBar from '../../shared/ActionHistoryBar'
import { useApp as useAppHook } from '../../../AppContext.tsx'
import { useActionHistory } from '../../../utils/actionHistory.ts'
import { beginNamedAction, finishNamedAction } from '../../../utils/actionGuards.ts'
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
import { getRenameImpact } from '../../../api/renameCascadeTransport.ts'

const DEFAULT_BRAND_COLOR = '#f97316'
const PRODUCT_BRAND_LOOKUP_TIMEOUT_MS = 10000
const PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS = 12000
const PRODUCT_BRAND_MUTATION_TIMEOUT_MS = 12000

type BrandReviewTone = 'safe' | 'review'

interface BrandReviewRule {
  tone: BrandReviewTone
  suggestedName?: string
  reason: string
}

interface BrandUsageEntry {
  name?: unknown
  usage_count?: unknown
  unresolved_count?: unknown
  sample_products?: ProductSample[]
}

interface ProductSample {
  name?: unknown
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

interface BrandWithUsage {
  name: string
  usage: number
  unresolvedCount: number
  sampleProducts: ProductSample[]
  color: string
  reviewRule: BrandReviewRule | null
}

type BrandColorMap = Record<string, string>

interface SavedBrandLibrary {
  brands: string[]
  colorMap: BrandColorMap
}

interface BrandApi {
  getProductLookupUsage: () => Promise<{ brands?: BrandUsageEntry[] } | unknown>
  saveSettings: (payload: Record<string, unknown>) => Promise<unknown> | unknown
  replaceProductLookupValues: (payload: Record<string, unknown>) => Promise<unknown> | unknown
  searchProducts?: (params: Record<string, unknown>) => Promise<ProductPayload> | ProductPayload
  getProductsByIds?: (ids: number[], options: { include: string }) => Promise<ProductPayload> | ProductPayload
  updateProduct?: (id: number, payload: Record<string, unknown>) => Promise<unknown> | unknown
}

interface ManageBrandsModalProps {
  onClose: () => void
  onDone?: () => void
  onReviewSelection?: (selection: { type: 'brand'; value: string }) => void
  user?: { id?: unknown; name?: unknown } | null
  t: (key: string) => string
}

interface AppContextValue {
  settings?: {
    product_brand_options?: unknown
    product_brand_color_map?: unknown
  } | null
  notify: (message: string, type?: string) => void
}

const BRAND_REVIEW_RULES: Record<string, BrandReviewRule> = {
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

const useApp = useAppHook as () => AppContextValue

function getBrandApi(): BrandApi {
  return (window as unknown as { api: BrandApi }).api
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function parseBrandOptions(raw: unknown): string[] {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

function parseBrandColorMap(raw: unknown): BrandColorMap {
  if (!raw) return {}
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [normalizeLookup(key), String(value || '').trim()])
        .filter(([key, value]) => key && value),
    )
  } catch (_) {
    return {}
  }
}

function toTitleCase(value: unknown): string {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getBrandReviewRule(name: unknown): BrandReviewRule | null {
  return BRAND_REVIEW_RULES[normalizeLookup(name)] || null
}

function hasActiveBrandUsage(entry: BrandUsageEntry | null | undefined): boolean {
  return Number(entry?.usage_count || 0) > 0 ||
    Number(entry?.unresolved_count || 0) > 0 ||
    (Array.isArray(entry?.sample_products) && entry.sample_products.length > 0)
}

function getBrandSortScore(entry: Pick<BrandWithUsage, 'reviewRule'> | null | undefined): number {
  if (entry?.reviewRule?.tone === 'review') return 0
  if (entry?.reviewRule?.tone === 'safe') return 1
  return 2
}

function buildSavedLibrary(
  brands: unknown[] = [],
  colorOverrides: BrandColorMap = {},
  existingColorMap: BrandColorMap = {},
): SavedBrandLibrary {
  const normalizedMap = new Map<string, string>()
  ;(brands || [])
    .map((entry) => toTitleCase(entry))
    .filter(Boolean)
    .forEach((entry) => {
      const key = normalizeLookup(entry)
      if (!normalizedMap.has(key)) normalizedMap.set(key, entry)
    })
  const clean = Array.from(normalizedMap.values()).sort((a, b) => a.localeCompare(b))
  const cleanColorMap: BrandColorMap = {}
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
}: ManageBrandsModalProps) {
  const { settings, notify } = useApp()
  const actionHistory = useActionHistory({ limit: 5, notify, scope: 'product-brands', user })
  const actionHistoryForBar = actionHistory as unknown as ComponentProps<typeof ActionHistoryBar>['history']
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
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(() => new Set())
  const [usageSummary, setUsageSummary] = useState<BrandUsageEntry[]>([])
  const loadRequestRef = useRef(0)
  const actionInFlightRef = useRef('')

  const libraryBrands = useMemo(
    () => parseBrandOptions(settings?.product_brand_options),
    [settings?.product_brand_options]
  )
  const brandColorMap = useMemo(
    () => parseBrandColorMap(settings?.product_brand_color_map),
    [settings?.product_brand_color_map]
  )

  const reloadUsageSummary = useCallback(async (label = 'Brand usage') => {
    const requestId = beginTrackedRequest(loadRequestRef)
    try {
      const result = await withLoaderTimeout(() => getBrandApi().getProductLookupUsage(), label, PRODUCT_BRAND_LOOKUP_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
      const brandRows = (result as { brands?: BrandUsageEntry[] } | null | undefined)?.brands
      setUsageSummary(Array.isArray(brandRows) ? brandRows : [])
      return result
    } catch (loadError) {
      if (!isTrackedRequestCurrent(loadRequestRef, requestId)) return null
      setError(getErrorMessage(loadError, 'Failed to load brand usage'))
      return null
    }
  }, [])

  const brandsWithUsage = useMemo(() => {
    const usageMap = new Map((usageSummary || []).map((entry) => [normalizeLookup(entry?.name), entry]))
    return Array.from(usageMap.values())
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean)
      .map((name): BrandWithUsage => {
        const usage = usageMap.get(normalizeLookup(name))
        const hasUsage = hasActiveBrandUsage(usage)
        return {
          name,
          usage: Number(usage?.usage_count || 0),
          unresolvedCount: Number(usage?.unresolved_count || 0),
          sampleProducts: Array.isArray(usage?.sample_products) ? usage.sample_products : [],
          color: brandColorMap[normalizeLookup(name)] || DEFAULT_BRAND_COLOR,
          reviewRule: hasUsage ? getBrandReviewRule(name) : null,
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

  const unusedLibraryBrands = useMemo(() => {
    const activeLookups = new Set(brandsWithUsage.map((entry) => normalizeLookup(entry.name)))
    return libraryBrands
      .filter((name) => !activeLookups.has(normalizeLookup(name)))
      .sort((a, b) => a.localeCompare(b))
  }, [brandsWithUsage, libraryBrands])

  const allKnownBrandNames = useMemo(() => ([
    ...brandsWithUsage.map((entry) => entry.name),
    ...unusedLibraryBrands,
  ]), [brandsWithUsage, unusedLibraryBrands])

  const reviewSummary = useMemo(() => {
    return brandsWithUsage.reduce((acc, entry) => {
      if (entry.reviewRule?.tone === 'review') acc.review += 1
      if (entry.reviewRule?.tone === 'safe') acc.safe += 1
      return acc
    }, { review: 0, safe: 0 })
  }, [brandsWithUsage])

  const brandsByLookup = useMemo(() => {
    const index = new Map()
    for (const entry of brandsWithUsage) {
      const lookup = normalizeLookup(entry?.name)
      if (lookup) index.set(lookup, entry)
    }
    return index
  }, [brandsWithUsage])

  useEffect(() => {
    reloadUsageSummary()
    return () => {
      invalidateTrackedRequest(loadRequestRef)
    }
  }, [reloadUsageSummary])

  useEffect(() => {
    const available = new Set(brandsWithUsage.map((entry) => entry.name))
    setSelectedBrands((current) => {
      const next = new Set(Array.from(current).filter((name) => available.has(name)))
      return next.size === current.size ? current : next
    })
  }, [brandsWithUsage])

  const runBrandMutation = useCallback(<T,>(loader: () => T | Promise<T>, label: string): Promise<T> => (
    withLoaderTimeout(loader, label, PRODUCT_BRAND_MUTATION_TIMEOUT_MS)
  ), [])

  const saveLibrary = async (brands: unknown[], colorOverrides: BrandColorMap = {}): Promise<void> => {
    const { brands: clean, colorMap: cleanColorMap } = buildSavedLibrary(brands, colorOverrides, brandColorMap)

    await runBrandMutation(() => getBrandApi().saveSettings({
      product_brand_options: JSON.stringify(clean),
      product_brand_color_map: JSON.stringify(cleanColorMap),
    }), 'Save brand library')
  }

  const restoreProductFieldSnapshots = async (field: string, snapshots: Record<string, unknown>[] = []): Promise<void> => {
    await restoreLookupProductSnapshots({
      api: getBrandApi(),
      field,
      snapshots,
      label: 'Brand product restore',
      timeoutMs: PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS,
      extraUpdateFields: {
        userId: user?.id,
        userName: user?.name,
      },
    })
  }

  const addLibraryBrand = async (): Promise<void> => {
    const clean = toTitleCase(newBrand)
    if (!clean) return
    if (!beginNamedAction(actionInFlightRef, 'add-brand', { blocked: busy })) return
    if (allKnownBrandNames.some((entry) => normalizeLookup(entry) === normalizeLookup(clean))) {
      setError(t('brand_already_exists') || 'Brand already exists')
      finishNamedAction(actionInFlightRef, 'add-brand')
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
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          }), 'Undo brand creation')
          await reloadUsageSummary()
        },
        redo: async () => {
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          }), 'Redo brand creation')
          await reloadUsageSummary()
        },
      })
      onDone?.()
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to save brand'))
    } finally {
      finishNamedAction(actionInFlightRef, 'add-brand')
      setBusy(false)
    }
  }

  const renameBrand = async (fromName: unknown, toNameRaw: unknown): Promise<void> => {
    const from = String(fromName || '').trim()
    const to = toTitleCase(toNameRaw)
    if (!from || !to) return
    const fromLookup = normalizeLookup(from)
    const toLookup = normalizeLookup(to)

    if (!beginNamedAction(actionInFlightRef, 'rename-brand', { blocked: busy })) return
    setBusy(true)
    setError('')
    try {
      const targetAlreadyExists = allKnownBrandNames.some((entry) => normalizeLookup(entry) === toLookup && normalizeLookup(entry) !== fromLookup)
      const impact = await getRenameImpact('brand', from, to)
      const attached = Number(impact.products_primary || 0) + Number(impact.products_secondary || 0)
      const confirmed = window.confirm(
        targetAlreadyExists
          ? `"${to}" already exists. Merge "${from}" into it and update ${attached} exact linked product${attached === 1 ? '' : 's'}? Point-in-time audit history stays unchanged.`
          : `Rename "${from}" to "${to}" and carry ${attached} exact linked product${attached === 1 ? '' : 's'}? Point-in-time audit history stays unchanged.`,
      )
      if (!confirmed) return
      const previousLibrary = [...libraryBrands]
      const previousColorMap = { ...brandColorMap }
      const productSnapshots = await fetchLookupProductSnapshots({
        api: getBrandApi(),
        field: 'brand',
        names: [from, to],
        label: 'Brand product snapshots',
        timeoutMs: PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS,
      })
      await runBrandMutation(() => getBrandApi().replaceProductLookupValues({
        type: 'brand',
        from: [from, to],
        to,
        userId: user?.id,
        userName: user?.name,
      }), 'Replace product brand values')

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
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          }), 'Undo brand library rename')
          await restoreProductFieldSnapshots('brand', productSnapshots)
          await reloadUsageSummary()
        },
        redo: async () => {
          await runBrandMutation(() => getBrandApi().replaceProductLookupValues({
            type: 'brand',
            from: [from, to],
            to,
            userId: user?.id,
            userName: user?.name,
          }), 'Redo product brand replacement')
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          }), 'Redo brand library rename')
          await reloadUsageSummary()
        },
      })
      onDone?.()
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to rename brand'))
    } finally {
      finishNamedAction(actionInFlightRef, 'rename-brand')
      setBusy(false)
    }
  }

  const removeBrands = async (names: unknown[]): Promise<void> => {
    const brandNames = Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean)))
    if (!brandNames.length) return
    if (!beginNamedAction(actionInFlightRef, 'delete-brand', { blocked: busy })) return

    const lookups = new Set(brandNames.map((name) => normalizeLookup(name)))
    const affectedEntries = brandNames
      .map((name) => brandsByLookup.get(normalizeLookup(name)))
      .filter(Boolean)
    const affectedCount = affectedEntries.reduce((sum, entry) => sum + Number(entry.usage || 0), 0)
    const clearAppliedBrands = affectedCount > 0
      ? window.confirm(`${brandNames.length} brand${brandNames.length === 1 ? '' : 's'} are used by ${affectedCount} product(s). Clear those product brand fields too?`)
      : window.confirm(`Delete ${brandNames.length} selected brand${brandNames.length === 1 ? '' : 's'}?`)

    if (!clearAppliedBrands) {
      finishNamedAction(actionInFlightRef, 'delete-brand')
      return
    }

    setBusy(true)
    setError('')
    try {
      const productSnapshots = await fetchLookupProductSnapshots({
        api: getBrandApi(),
        field: 'brand',
        names: brandNames,
        label: 'Brand product snapshots',
        timeoutMs: PRODUCT_BRAND_PRODUCTS_TIMEOUT_MS,
      })
      const previousLibrary = [...libraryBrands]
      const previousColorMap = { ...brandColorMap }
      await runBrandMutation(() => getBrandApi().replaceProductLookupValues({
        type: 'brand',
        from: brandNames,
        to: null,
        userId: user?.id,
        userName: user?.name,
      }), 'Clear deleted product brands')

      const nextLibrary = libraryBrands.filter((entry) => !lookups.has(normalizeLookup(entry)))
      const nextLibraryState = buildSavedLibrary(nextLibrary, {}, brandColorMap)
      await saveLibrary(nextLibrary)
      await reloadUsageSummary()

      notify(`Removed ${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`, 'success')
      setSelectedBrands(new Set())
      actionHistory.pushAction({
        label: `Delete ${brandNames.length} brand${brandNames.length === 1 ? '' : 's'}`.trim(),
        undo: async () => {
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(previousLibrary),
            product_brand_color_map: JSON.stringify(previousColorMap),
          }), 'Undo brand deletion')
          await restoreProductFieldSnapshots('brand', productSnapshots)
          await reloadUsageSummary()
        },
        redo: async () => {
          await runBrandMutation(() => getBrandApi().replaceProductLookupValues({
            type: 'brand',
            from: brandNames,
            to: null,
            userId: user?.id,
            userName: user?.name,
          }), 'Redo product brand clearing')
          await runBrandMutation(() => getBrandApi().saveSettings({
            product_brand_options: JSON.stringify(nextLibraryState.brands),
            product_brand_color_map: JSON.stringify(nextLibraryState.colorMap),
          }), 'Redo brand deletion')
          await reloadUsageSummary()
        },
      })
      onDone?.()
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to remove brand'))
    } finally {
      finishNamedAction(actionInFlightRef, 'delete-brand')
      setBusy(false)
    }
  }

  const removeBrand = (name: string): Promise<void> => removeBrands([name])

  const applySuggestedNormalization = async (entry: BrandWithUsage): Promise<void> => {
    const reviewRule = entry?.reviewRule
    if (!reviewRule?.suggestedName || reviewRule.tone !== 'safe') return
    await renameBrand(entry.name, reviewRule.suggestedName)
  }

  const toggleSelectedBrand = (name: string): void => {
    setSelectedBrands((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAllVisibleBrands = (): void => {
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
    <Modal title={`${t('brand') || 'Brand'} ${t('manage') || 'Manage'}`} onClose={onClose} unsavedChanges={{ dirty: Boolean(newBrand.trim()) || Boolean(renamingBrand) }}>
      <div className="space-y-4">
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{error}</div> : null}
        <ActionHistoryBar history={actionHistoryForBar} t={t} />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">{t('add_brand') || 'Add brand'}</label>
            <input
              className="input"
              value={newBrand}
              onChange={(event) => setNewBrand(event.target.value)}
              placeholder={t('brand_name_example_placeholder') || "e.g. L'Oreal"}
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
          {brandsWithUsage.length === 0 && unusedLibraryBrands.length === 0 ? (
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
              {brandsWithUsage.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  No active product brands found. Saved library brands are listed below.
                </div>
              ) : null}
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
              {unusedLibraryBrands.length ? (
                <details className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                  <summary className="cursor-pointer font-semibold">
                    {unusedLibraryBrands.length} saved brand{unusedLibraryBrands.length === 1 ? '' : 's'} with no matching products
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {unusedLibraryBrands.map((name) => (
                      <div key={name} className="flex items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5 dark:bg-slate-950/60">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 dark:border-white/20"
                          style={{ backgroundColor: brandColorMap[normalizeLookup(name)] || DEFAULT_BRAND_COLOR }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline dark:text-blue-300"
                          onClick={() => {
                            setRenamingBrand(name)
                            setRenameValue(name)
                            setRenameColor(brandColorMap[normalizeLookup(name)] || DEFAULT_BRAND_COLOR)
                          }}
                          disabled={busy}
                        >
                          {t('edit') || 'Edit'}
                        </button>
                        <button
                          type="button"
                          className="text-red-500 hover:underline"
                          onClick={() => removeBrand(name)}
                          disabled={busy}
                        >
                          {t('delete') || 'Delete'}
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

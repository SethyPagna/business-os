import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Gift from 'lucide-react/dist/esm/icons/gift.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import SectionCard from '../shared/SectionCard.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { fmtDate } from '../../utils/formatters.ts'
import {
  getPromotionRules,
  createPromotionRule,
  updatePromotionRule,
  deletePromotionRule,
  type PromotionRuleRow,
  type PromotionRuleWrite,
} from '../../api/promotionsTransport.ts'
import { searchProducts, getProductFilters, updateProduct } from '../../api/methods.ts'
import { promotionAutoLabel, normalizePromotionRule } from '../../utils/promotionRules.ts'
import { calculateProductDiscount, isProductDiscountActive } from '../../utils/pricing.ts'

// Same minimal-context cast pattern as FeesPage/LoyaltyPointsPage --
// AppContext's useApp is untyped, each page names just what it reads.
type PromotionsAppContext = {
  t: (key: string, fallback?: string) => string
  notify: (message: string, type?: string) => void
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => PromotionsAppContext

// G2: Loyalty Points renders as a SECTION of this page (its own chunk
// stays split -- the old standalone page component loads lazily only
// when the section opens).
const LoyaltyPointsSection = lazy(() => import('../loyalty-points/LoyaltyPointsPage'))

// G1 (Part 391): the promotion engine's management surface. Two sections:
//   1. Promotion RULES -- "buy >= X save Y", "% off", "fixed off", scoped
//      to chosen products, a category, or a brand, with an optional shown/
//      hidden Title and start/end dates. Stored in promotion_rules and
//      evaluated by the ONE shared kernel (utils/promotionRules.ts) that
//      POS charges with and the portal advertises with.
//   2. PER-PRODUCT discounts -- the products' own discount_* fields.
//      Managed HERE, not in the product edit form anymore (user, Aug 28:
//      "per-product discounts MANAGE in Promotions, labels stay VISIBLE in
//      Products"), saved through the same partial product update the bulk
//      editor uses, so nothing else on the product is touched.

type ProductLite = Record<string, unknown> & { id: number; name?: string }

type RuleDraft = {
  id: number | null
  title: string
  show_title: boolean
  rule_type: 'quantity_save' | 'percent_off' | 'fixed_off' | 'spend_save' | 'quantity_percent' | 'next_item'
  min_quantity: string
  save_usd: string
  save_khr: string
  percent_off: string
  min_spend_usd: string
  min_spend_khr: string
  label_style: 'save' | 'get' | 'free'
  scope_type: 'products' | 'category' | 'brand'
  products: ProductLite[]
  category: string
  brand: string
  badge_color: string
  starts_at: string
  ends_at: string
  is_active: boolean
}

const EMPTY_RULE: RuleDraft = {
  id: null, title: '', show_title: true, rule_type: 'percent_off',
  min_quantity: '', save_usd: '', save_khr: '', percent_off: '',
  min_spend_usd: '', min_spend_khr: '', label_style: 'save',
  scope_type: 'products', products: [], category: '', brand: '',
  badge_color: '#e11d48', starts_at: '', ends_at: '', is_active: true,
}

type DiscountDraft = {
  product: ProductLite
  discount_enabled: boolean
  discount_type: 'percent' | 'fixed'
  discount_percent: string
  discount_amount_usd: string
  discount_amount_khr: string
  discount_label: string
  discount_badge_color: string
  discount_starts_at: string
  discount_ends_at: string
}

// A stored window value can be date-only or carry a time; <input type=date>
// only accepts YYYY-MM-DD, so feed it just the date part.
function dateInputValue(value: unknown): string {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function ruleSummary(row: PromotionRuleRow): string {
  // The kernel's auto-label IS the human summary -- one wording source
  // (promotionAutoLabel) instead of a second copy that could drift.
  const rule = row.normalized
  if (!rule) return 'Invalid rule'
  return promotionAutoLabel(rule)
}

function ruleScopeSummary(row: PromotionRuleRow, t: (key: string, fallback?: string) => string): string {
  const rule = row.normalized
  if (!rule) return ''
  if (rule.scope_type === 'category') return `${t('category') || 'Category'}: ${rule.category}`
  if (rule.scope_type === 'brand') return `${t('brand') || 'Brand'}: ${rule.brand}`
  const count = rule.product_ids.length
  return count === 1 ? (t('promo_one_product') || '1 product') : `${count} ${t('products') || 'products'}`
}

export default function PromotionsPage() {
  const { t, notify, fmtUSD, fmtKHR, getPermissionTier } = useApp()
  // G2 section gates: the page door admits either grant (see
  // AppContext.canAccessPage); each section still needs its own.
  const canPromotions = getPermissionTier('promotions') !== 'none'
  const canLoyalty = getPermissionTier('customer_portal') !== 'none'
  const [activeSection, setActiveSection] = useState<'promotions' | 'loyalty'>(canPromotions ? 'promotions' : 'loyalty')
  const [rules, setRules] = useState<PromotionRuleRow[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesError, setRulesError] = useState('')
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [savingRule, setSavingRule] = useState(false)
  const [categories, setCategories] = useState<string[]>([])
  const [brands, setBrands] = useState<string[]>([])

  const [discounted, setDiscounted] = useState<ProductLite[]>([])
  const [discountedLoading, setDiscountedLoading] = useState(true)
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<ProductLite[]>([])
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft | null>(null)
  const [savingDiscount, setSavingDiscount] = useState(false)

  // Product picker inside the rule editor.
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<ProductLite[]>([])
  const searchSeq = useRef(0)

  const loadRules = useCallback(async () => {
    setRulesLoading(true)
    setRulesError('')
    try {
      const rows = await getPromotionRules()
      setRules(Array.isArray(rows) ? rows : [])
    } catch (error) {
      setRulesError(error instanceof Error ? error.message : String(error))
    } finally {
      setRulesLoading(false)
    }
  }, [])

  const loadDiscounted = useCallback(async () => {
    setDiscountedLoading(true)
    try {
      const payload = await searchProducts({ promo: 'discounted', pageSize: 100 }) as { items?: ProductLite[] }
      setDiscounted(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setDiscounted([])
    } finally {
      setDiscountedLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules()
    loadDiscounted()
    getProductFilters().then((filters) => {
      const f = filters as { categories?: string[]; brands?: string[] }
      setCategories(Array.isArray(f?.categories) ? f.categories : [])
      setBrands(Array.isArray(f?.brands) ? f.brands : [])
    }).catch(() => { /* selects fall back to free typing */ })
  }, [loadRules, loadDiscounted])

  // Debounced product search, shared by the rule scope picker and the
  // per-product discount search box (whichever is open).
  useEffect(() => {
    const query = draft ? pickerQuery : productQuery
    if (!query.trim()) { setPickerResults([]); setProductResults([]); return }
    const seq = ++searchSeq.current
    const timer = window.setTimeout(async () => {
      try {
        const payload = await searchProducts({ query: query.trim(), pageSize: 12 }) as { items?: ProductLite[] }
        if (seq !== searchSeq.current) return
        const items = Array.isArray(payload?.items) ? payload.items : []
        if (draft) setPickerResults(items)
        else setProductResults(items)
      } catch { /* stale/failed search -- keep previous list */ }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [pickerQuery, productQuery, draft])

  const openNewRule = () => { setPickerQuery(''); setPickerResults([]); setDraft({ ...EMPTY_RULE }) }

  const openEditRule = (row: PromotionRuleRow) => {
    const rule = row.normalized
    if (!rule) return
    setPickerQuery('')
    setPickerResults([])
    setDraft({
      id: rule.id,
      title: rule.title,
      show_title: rule.show_title,
      rule_type: rule.rule_type,
      min_quantity: rule.min_quantity ? String(rule.min_quantity) : '',
      save_usd: rule.save_usd ? String(rule.save_usd) : '',
      save_khr: rule.save_khr ? String(rule.save_khr) : '',
      percent_off: rule.percent_off ? String(rule.percent_off) : '',
      min_spend_usd: rule.min_spend_usd ? String(rule.min_spend_usd) : '',
      min_spend_khr: rule.min_spend_khr ? String(rule.min_spend_khr) : '',
      label_style: rule.label_style,
      scope_type: rule.scope_type,
      products: rule.product_ids.map((id) => ({ id, name: `#${id}` })),
      category: rule.category,
      brand: rule.brand,
      badge_color: rule.badge_color,
      starts_at: dateInputValue(rule.starts_at),
      ends_at: dateInputValue(rule.ends_at),
      is_active: rule.is_active,
    })
    // Resolve the picked products' real names for the chips (ids alone are
    // honest but unreadable). Best-effort; chips show #id until it lands.
    if (rule.product_ids.length) {
      searchProducts({ ids: rule.product_ids.join(','), pageSize: Math.min(rule.product_ids.length, 100) })
        .then((payload) => {
          const items = (payload as { items?: ProductLite[] })?.items
          if (!Array.isArray(items) || !items.length) return
          setDraft((current) => current && current.id === rule.id
            ? { ...current, products: current.products.map((p) => items.find((item) => Number(item.id) === Number(p.id)) || p) }
            : current)
        })
        .catch(() => { /* names stay as #id */ })
    }
  }

  const saveRule = async () => {
    if (!draft || savingRule) return
    const payload: PromotionRuleWrite = {
      title: draft.title.trim(),
      show_title: draft.show_title,
      rule_type: draft.rule_type,
      min_quantity: Number(draft.min_quantity) || 0,
      save_usd: Number(draft.save_usd) || 0,
      save_khr: Number(draft.save_khr) || 0,
      percent_off: Number(draft.percent_off) || 0,
      min_spend_usd: Number(draft.min_spend_usd) || 0,
      min_spend_khr: Number(draft.min_spend_khr) || 0,
      label_style: draft.label_style,
      scope_type: draft.scope_type,
      product_ids: draft.products.map((p) => Number(p.id)),
      category: draft.category,
      brand: draft.brand,
      badge_color: draft.badge_color,
      starts_at: draft.starts_at || null,
      ends_at: draft.ends_at || null,
      is_active: draft.is_active,
    }
    setSavingRule(true)
    try {
      if (draft.id) await updatePromotionRule(draft.id, payload)
      else await createPromotionRule(payload)
      notify(t('promo_rule_saved') || 'Promotion saved.')
      setDraft(null)
      await loadRules()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSavingRule(false)
    }
  }

  const removeRule = async (row: PromotionRuleRow) => {
    const rule = row.normalized
    const label = rule?.title || `#${row.id}`
    if (!window.confirm((t('promo_rule_delete_confirm') || 'Delete promotion "{name}"? Prices return to normal immediately.').replace('{name}', label))) return
    try {
      await deletePromotionRule(row.id)
      notify(t('promo_rule_deleted') || 'Promotion deleted.')
      await loadRules()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const openDiscountEditor = (product: ProductLite) => {
    setDiscountDraft({
      product,
      discount_enabled: Boolean(product.discount_enabled),
      discount_type: String(product.discount_type || 'percent') === 'fixed' ? 'fixed' : 'percent',
      discount_percent: product.discount_percent ? String(product.discount_percent) : '',
      discount_amount_usd: product.discount_amount_usd ? String(product.discount_amount_usd) : '',
      discount_amount_khr: product.discount_amount_khr ? String(product.discount_amount_khr) : '',
      discount_label: String(product.discount_label || ''),
      discount_badge_color: String(product.discount_badge_color || '#e11d48'),
      discount_starts_at: dateInputValue(product.discount_starts_at),
      discount_ends_at: dateInputValue(product.discount_ends_at),
    })
  }

  const saveDiscount = async () => {
    if (!discountDraft || savingDiscount) return
    setSavingDiscount(true)
    try {
      // Partial update: updateRow only writes the keys sent, so nothing
      // else on the product is touched (same contract the bulk editor
      // relies on).
      await updateProduct(discountDraft.product.id, {
        discount_enabled: discountDraft.discount_enabled ? 1 : 0,
        discount_type: discountDraft.discount_type,
        discount_percent: Number(discountDraft.discount_percent) || 0,
        discount_amount_usd: Number(discountDraft.discount_amount_usd) || 0,
        discount_amount_khr: Number(discountDraft.discount_amount_khr) || 0,
        discount_label: discountDraft.discount_label.trim(),
        discount_badge_color: discountDraft.discount_badge_color,
        discount_starts_at: discountDraft.discount_starts_at || null,
        discount_ends_at: discountDraft.discount_ends_at || null,
      })
      notify(t('promo_discount_saved') || 'Product discount saved.')
      setDiscountDraft(null)
      setProductQuery('')
      setProductResults([])
      await loadDiscounted()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSavingDiscount(false)
    }
  }

  const activeCount = useMemo(() => rules.filter((row) => row.currently_active).length, [rules])

  const inputCls = 'input text-sm w-full'
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

  return (
    // page-scroll (full-width) is the scroll container; the inner wrapper keeps
    // the old max-w-5xl centering. Without page-scroll here the whole page sat
    // inside PageSlot's overflow-hidden box and anything below the fold was
    // unreachable (reported: Promotions/Loyalty could not scroll).
    <div className="page-scroll p-4">
      <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <BadgePercent className="w-6 h-6 text-rose-600" />
        <h1 className="text-xl font-semibold">{t('promotions') || 'Promotions'}</h1>
        {activeSection === 'promotions' ? (
          <span className="text-sm text-gray-500">
            {activeCount} {t('promo_active_now') || 'active now'}
          </span>
        ) : null}
        {canPromotions && canLoyalty ? (
          <div className="ml-auto inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
            <button
              type="button"
              onClick={() => setActiveSection('promotions')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${activeSection === 'promotions' ? 'bg-white dark:bg-gray-900 shadow text-rose-600' : 'text-gray-500'}`}
            >
              <BadgePercent className="w-4 h-4" /> {t('promotions') || 'Promotions'}
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('loyalty')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${activeSection === 'loyalty' ? 'bg-white dark:bg-gray-900 shadow text-amber-600' : 'text-gray-500'}`}
            >
              <Gift className="w-4 h-4" /> {t('loyalty_points') || 'Loyalty Points'}
            </button>
          </div>
        ) : null}
      </div>

      {activeSection === 'loyalty' ? (
        // G2: the whole former Loyalty Points page, embedded (its own
        // header/sections/logic untouched -- one implementation, new home).
        <Suspense fallback={<p className="text-sm text-gray-500 py-4">{t('loading') || 'Loading'}...</p>}>
          <LoyaltyPointsSection />
        </Suspense>
      ) : null}

      {activeSection === 'promotions' ? (<>

      <SectionCard
        kind="sales"
        title={t('promo_rules_section') || 'Promotion rules'}
        subtitle={t('promo_rules_section_sub') || 'Buy-more deals, % off and fixed savings across products, a category or a brand. POS and the storefront price with the same rules.'}
        collapsible={false}
        actions={(
          <button type="button" className="btn btn-primary btn-sm inline-flex items-center gap-1" onClick={openNewRule}>
            <Plus className="w-4 h-4" /> {t('promo_new_rule') || 'New rule'}
          </button>
        )}
      >
        {rulesLoading ? (
          <p className="text-sm text-gray-500 py-3">{t('loading') || 'Loading'}...</p>
        ) : rulesError ? (
          <p className="text-sm text-red-600 py-3">{rulesError}</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-500 py-3">{t('promo_no_rules') || 'No promotion rules yet. Create one to put a deal on the storefront and POS.'}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rules.map((row) => {
              const rule = row.normalized
              return (
                <li key={row.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: row.currently_active ? (rule?.badge_color || '#e11d48') : '#9ca3af' }}
                    title={row.currently_active ? (t('promo_active_now') || 'active now') : (t('promo_inactive') || 'inactive')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{rule?.title || `#${row.id}`}</span>
                      {rule && !rule.show_title && (
                        <span className="text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-800 text-gray-500 rounded px-1.5 py-0.5">{t('promo_title_hidden') || 'title hidden'}</span>
                      )}
                      {!row.currently_active && (
                        <span className="text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-800 text-gray-500 rounded px-1.5 py-0.5">{t('promo_inactive') || 'inactive'}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {ruleSummary(row)} · {ruleScopeSummary(row, t)}
                      {rule?.starts_at ? ` · ${t('promo_from') || 'from'} ${fmtDate(rule.starts_at)}` : ''}
                      {rule?.ends_at ? ` · ${t('promo_until') || 'until'} ${fmtDate(rule.ends_at)}` : ''}
                    </p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditRule(row)} aria-label={t('edit') || 'Edit'}>
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={() => removeRule(row)} aria-label={t('delete') || 'Delete'}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        kind="catalog"
        title={t('promo_product_discounts_section') || 'Per-product discounts'}
        subtitle={t('promo_product_discounts_sub') || 'Single-product price cuts (the fields that used to live in the product form). Labels stay visible on Products, POS and the storefront.'}
        collapsible={false}
      >
        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className={`${inputCls} pl-8`}
            placeholder={t('promo_search_product_placeholder') || 'Search a product to set its discount...'}
            value={productQuery}
            onChange={(event) => setProductQuery(event.target.value)}
          />
          {productResults.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-auto">
              {productResults.map((product) => (
                <li key={String(product.id)}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                    onClick={() => { openDiscountEditor(product); setProductResults([]) }}
                  >
                    {String(product.name || `#${product.id}`)}
                    <span className="text-xs text-gray-400 ml-2">{fmtUSD(Number(product.selling_price_usd) || 0)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {discountedLoading ? (
          <p className="text-sm text-gray-500 py-2">{t('loading') || 'Loading'}...</p>
        ) : discounted.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">{t('promo_no_discounts') || 'No products carry their own discount right now.'}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {discounted.map((product) => {
              const promo = calculateProductDiscount(product as Parameters<typeof calculateProductDiscount>[0])
              const live = isProductDiscountActive(product as Parameters<typeof isProductDiscountActive>[0])
              return (
                <li key={String(product.id)} className="py-2.5 flex items-center gap-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: live ? String(product.discount_badge_color || '#e11d48') : '#9ca3af' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{String(product.name || `#${product.id}`)}</span>
                      {String(product.discount_label || '') && (
                        <span
                          className="text-[10px] font-semibold text-white rounded px-1.5 py-0.5"
                          style={{ backgroundColor: String(product.discount_badge_color || '#e11d48') }}
                        >
                          {String(product.discount_label)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {promo.active
                        ? `${fmtUSD(Number(product.selling_price_usd) || 0)} → ${fmtUSD(promo.applied_price_usd)} (−${promo.percent_off}%)`
                        : (t('promo_discount_not_live') || 'Configured, not currently live')}
                      {product.discount_ends_at ? ` · ${t('promo_until') || 'until'} ${fmtDate(String(product.discount_ends_at))}` : ''}
                    </p>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDiscountEditor(product)} aria-label={t('edit') || 'Edit'}>
                    <Pencil className="w-4 h-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {draft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={() => !savingRule && setDraft(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg p-4 space-y-3 mt-8" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-base font-semibold">
              {draft.id ? (t('promo_edit_rule') || 'Edit promotion') : (t('promo_new_rule') || 'New rule')}
            </h2>

            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div>
                <label className={labelCls}>{t('promo_title_label') || 'Title (shown to customers)'}</label>
                <input className={inputCls} value={draft.title} maxLength={120}
                  placeholder={t('promo_title_placeholder') || 'e.g. Buy 3 Save $5'}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-2 cursor-pointer">
                <input type="checkbox" checked={draft.show_title}
                  onChange={(event) => setDraft({ ...draft, show_title: event.target.checked })} />
                {t('promo_show_title') || 'Show title'}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('promo_rule_type') || 'Rule type'}</label>
                <AppSelect
                  value={draft.rule_type}
                  onChange={(value: string) => setDraft({ ...draft, rule_type: value as RuleDraft['rule_type'] })}
                  options={[
                    { value: 'percent_off', label: t('promo_type_percent') || '% off' },
                    { value: 'fixed_off', label: t('promo_type_fixed') || 'Fixed amount off' },
                    { value: 'quantity_save', label: t('promo_type_quantity') || 'Buy ≥ X, save Y' },
                    { value: 'quantity_percent', label: t('promo_type_quantity_percent') || 'Buy ≥ X, get % off' },
                    { value: 'spend_save', label: t('promo_type_spend') || 'Spend ≥ X, save Y' },
                    { value: 'next_item', label: t('promo_type_next_item') || 'Buy X, next item off' },
                  ]}
                />
              </div>
              <div>
                <label className={labelCls}>{t('promo_badge_color') || 'Badge color'}</label>
                <input type="color" className="input w-full h-9 p-1" value={draft.badge_color}
                  onChange={(event) => setDraft({ ...draft, badge_color: event.target.value })} />
              </div>
            </div>

            {(draft.rule_type === 'quantity_save' || draft.rule_type === 'quantity_percent' || draft.rule_type === 'next_item') && (
              <div>
                <label className={labelCls}>
                  {draft.rule_type === 'next_item'
                    ? (t('promo_buy_count') || 'Buy this many (the NEXT one gets the deal)')
                    : (t('promo_min_qty') || 'Buy at least')}
                </label>
                <input className={inputCls} inputMode="numeric" value={draft.min_quantity}
                  onChange={(event) => setDraft({ ...draft, min_quantity: event.target.value })} />
              </div>
            )}
            {draft.rule_type === 'spend_save' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>{t('promo_min_spend_usd') || 'Spend at least (USD)'}</label>
                  <input className={inputCls} inputMode="decimal" value={draft.min_spend_usd}
                    onChange={(event) => setDraft({ ...draft, min_spend_usd: event.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{t('promo_min_spend_khr') || 'Spend at least (KHR)'}</label>
                  <input className={inputCls} inputMode="numeric" value={draft.min_spend_khr}
                    onChange={(event) => setDraft({ ...draft, min_spend_khr: event.target.value })} />
                </div>
              </div>
            )}
            {(draft.rule_type === 'percent_off' || draft.rule_type === 'quantity_percent' || draft.rule_type === 'next_item') && (
              <div>
                <label className={labelCls}>
                  {draft.rule_type === 'next_item'
                    ? (t('promo_next_percent') || 'Next item: percent off (%) — leave 0 to use an amount')
                    : (t('promo_percent_label') || 'Percent off (%)')}
                </label>
                <input className={inputCls} inputMode="decimal" value={draft.percent_off}
                  onChange={(event) => setDraft({ ...draft, percent_off: event.target.value })} />
              </div>
            )}
            {(draft.rule_type === 'quantity_save' || draft.rule_type === 'fixed_off' || draft.rule_type === 'spend_save' || draft.rule_type === 'next_item') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>
                    {draft.rule_type === 'next_item'
                      ? (t('promo_next_amount_usd') || 'Next item: amount off (USD)')
                      : (t('promo_save_usd') || 'Save (USD)')}
                  </label>
                  <input className={inputCls} inputMode="decimal" value={draft.save_usd}
                    onChange={(event) => setDraft({ ...draft, save_usd: event.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>{t('promo_save_khr') || 'Save (KHR)'}</label>
                  <input className={inputCls} inputMode="numeric" value={draft.save_khr}
                    placeholder={draft.save_usd ? (t('promo_khr_auto') || 'auto from USD') : ''}
                    onChange={(event) => setDraft({ ...draft, save_khr: event.target.value })} />
                </div>
              </div>
            )}
            {/* Wording style for the AUTO title ("save to get, can change
                free or something -- same meaning, different wording") +
                a live preview of exactly what customers will read. A
                typed Title above always overrides the auto wording. */}
            <div className="grid grid-cols-[auto_1fr] items-end gap-2">
              <div>
                <label className={labelCls}>{t('promo_label_style') || 'Label wording'}</label>
                <AppSelect
                  value={draft.label_style}
                  onChange={(value: string) => setDraft({ ...draft, label_style: (value === 'get' || value === 'free') ? value : 'save' })}
                  options={[
                    { value: 'save', label: t('promo_style_save') || '“Save …”' },
                    { value: 'get', label: t('promo_style_get') || '“Get … Off”' },
                    { value: 'free', label: t('promo_style_free') || '“… Free”' },
                  ]}
                />
              </div>
              <div className="pb-1 text-xs text-gray-500 truncate">
                {(t('promo_label_preview') || 'Shown as:')}{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {draft.title.trim() || (() => {
                    const preview = normalizePromotionRule({
                      id: 1, rule_type: draft.rule_type, min_quantity: Number(draft.min_quantity) || 0,
                      save_usd: Number(draft.save_usd) || 0, save_khr: Number(draft.save_khr) || 0,
                      percent_off: Number(draft.percent_off) || 0,
                      min_spend_usd: Number(draft.min_spend_usd) || 0, min_spend_khr: Number(draft.min_spend_khr) || 0,
                      label_style: draft.label_style, scope_type: draft.scope_type, product_ids: '[1]', is_active: 1,
                    })
                    return preview ? promotionAutoLabel(preview) : ''
                  })()}
                </span>
              </div>
            </div>

            <div>
              <label className={labelCls}>{t('promo_scope') || 'Applies to'}</label>
              <AppSelect
                value={draft.scope_type}
                onChange={(value: string) => setDraft({ ...draft, scope_type: value as RuleDraft['scope_type'] })}
                options={[
                  { value: 'products', label: t('promo_scope_products') || 'Chosen products' },
                  { value: 'category', label: t('promo_scope_category') || 'A whole category' },
                  { value: 'brand', label: t('promo_scope_brand') || 'A whole brand' },
                ]}
              />
            </div>

            {draft.scope_type === 'products' && (
              <div className="space-y-2">
                {draft.products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.products.map((product) => (
                      <span key={String(product.id)} className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5 text-xs">
                        {String(product.name || `#${product.id}`)}
                        <button type="button" className="text-gray-400 hover:text-red-600"
                          onClick={() => setDraft({ ...draft, products: draft.products.filter((p) => p.id !== product.id) })}>
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <input className={inputCls} value={pickerQuery}
                    placeholder={t('promo_pick_products_placeholder') || 'Search products to add...'}
                    onChange={(event) => setPickerQuery(event.target.value)} />
                  {pickerResults.length > 0 && (
                    <ul className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-auto">
                      {pickerResults.map((product) => (
                        <li key={String(product.id)}>
                          <button type="button" className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                            onClick={() => {
                              if (!draft.products.some((p) => Number(p.id) === Number(product.id))) {
                                setDraft({ ...draft, products: [...draft.products, product] })
                              }
                              setPickerQuery('')
                              setPickerResults([])
                            }}>
                            {String(product.name || `#${product.id}`)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {draft.scope_type === 'category' && (
              <AppSelect
                value={draft.category}
                onChange={(value: string) => setDraft({ ...draft, category: value })}
                options={[{ value: '', label: t('promo_pick_category') || 'Choose a category...' }, ...categories.map((c) => ({ value: c, label: c }))]}
              />
            )}
            {draft.scope_type === 'brand' && (
              <AppSelect
                value={draft.brand}
                onChange={(value: string) => setDraft({ ...draft, brand: value })}
                options={[{ value: '', label: t('promo_pick_brand') || 'Choose a brand...' }, ...brands.map((b) => ({ value: b, label: b }))]}
              />
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('promo_starts') || 'Starts (optional)'}</label>
                <input type="date" className={inputCls} value={draft.starts_at}
                  onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })} />
              </div>
              <div>
                <label className={labelCls}>{t('promo_ends') || 'Ends (optional)'}</label>
                <input type="date" className={inputCls} value={draft.ends_at}
                  onChange={(event) => setDraft({ ...draft, ends_at: event.target.value })} />
              </div>
            </div>

            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={draft.is_active}
                onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })} />
              {t('promo_rule_active') || 'Active'}
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost btn-sm" disabled={savingRule} onClick={() => setDraft(null)}>
                {t('cancel') || 'Cancel'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingRule} onClick={saveRule}>
                {savingRule ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {discountDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={() => !savingDiscount && setDiscountDraft(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg p-4 space-y-3 mt-8" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-base font-semibold truncate">
              {(t('promo_discount_for') || 'Discount for')} {String(discountDraft.product.name || `#${discountDraft.product.id}`)}
            </h2>

            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={discountDraft.discount_enabled}
                onChange={(event) => setDiscountDraft({ ...discountDraft, discount_enabled: event.target.checked })} />
              {t('promo_discount_enabled') || 'Discount enabled'}
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('promo_rule_type') || 'Rule type'}</label>
                <AppSelect
                  value={discountDraft.discount_type}
                  onChange={(value: string) => setDiscountDraft({ ...discountDraft, discount_type: value === 'fixed' ? 'fixed' : 'percent' })}
                  options={[
                    { value: 'percent', label: t('promo_type_percent') || '% off' },
                    { value: 'fixed', label: t('promo_type_fixed') || 'Fixed amount off' },
                  ]}
                />
              </div>
              {discountDraft.discount_type === 'percent' ? (
                <div>
                  <label className={labelCls}>{t('promo_percent_label') || 'Percent off (%)'}</label>
                  <input className={inputCls} inputMode="decimal" value={discountDraft.discount_percent}
                    onChange={(event) => setDiscountDraft({ ...discountDraft, discount_percent: event.target.value })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>USD</label>
                    <input className={inputCls} inputMode="decimal" value={discountDraft.discount_amount_usd}
                      onChange={(event) => setDiscountDraft({ ...discountDraft, discount_amount_usd: event.target.value })} />
                  </div>
                  <div>
                    <label className={labelCls}>KHR</label>
                    <input className={inputCls} inputMode="numeric" value={discountDraft.discount_amount_khr}
                      onChange={(event) => setDiscountDraft({ ...discountDraft, discount_amount_khr: event.target.value })} />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className={labelCls}>{t('promo_discount_label') || 'Label (badge text, optional)'}</label>
                <input className={inputCls} value={discountDraft.discount_label} maxLength={60}
                  onChange={(event) => setDiscountDraft({ ...discountDraft, discount_label: event.target.value })} />
              </div>
              <div>
                <label className={labelCls}>{t('promo_badge_color') || 'Badge color'}</label>
                <input type="color" className="input h-9 w-16 p-1" value={discountDraft.discount_badge_color}
                  onChange={(event) => setDiscountDraft({ ...discountDraft, discount_badge_color: event.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('promo_starts') || 'Starts (optional)'}</label>
                <input type="date" className={inputCls} value={discountDraft.discount_starts_at}
                  onChange={(event) => setDiscountDraft({ ...discountDraft, discount_starts_at: event.target.value })} />
              </div>
              <div>
                <label className={labelCls}>{t('promo_ends') || 'Ends (optional)'}</label>
                <input type="date" className={inputCls} value={discountDraft.discount_ends_at}
                  onChange={(event) => setDiscountDraft({ ...discountDraft, discount_ends_at: event.target.value })} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost btn-sm" disabled={savingDiscount} onClick={() => setDiscountDraft(null)}>
                {t('cancel') || 'Cancel'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={savingDiscount} onClick={saveDiscount}>
                {savingDiscount ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
      </>) : null}
      </div>
    </div>
  )
}

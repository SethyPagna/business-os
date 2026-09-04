import { getHubDestinations, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, SVGProps } from 'react'
import Gift from 'lucide-react/dist/esm/icons/gift.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import Percent from 'lucide-react/dist/esm/icons/percent.js'
import Tag from 'lucide-react/dist/esm/icons/tag.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { useFormDirty } from '../../utils/formDirty.ts'
import { useCloseGuard } from '../../utils/useCloseGuard.ts'
import UnsavedChangesPrompt from '../shared/UnsavedChangesPrompt.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import ScanSearchButton from '../shared/ScanSearchButton.tsx'
import HubSectionNav, { type HubSectionDef } from '../shared/HubSectionNav.tsx'
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
  navigateTo: (pageId: string, anchor?: string) => void
  hasPermission: (key: string) => boolean
  t: (key: string, fallback?: string) => string
  notify: (message: string, type?: string) => void
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  getPermissionTier: (key: string) => string
  can: (permissionKey: string, actionKey: string) => boolean
}
const useApp = useAppHook as unknown as () => PromotionsAppContext

// G2: Loyalty Points renders as a SECTION of this page (its own chunk
// stays split -- the old standalone page component loads lazily only
// when the section opens).
const LoyaltyPointsSection = lazy(() => import('../loyalty-points/LoyaltyPointsPage'))

// G1 (Part 391): the promotion engine's management surface. Two promotion
// areas plus Loyalty Points, presented as one FLAT top-level section-chip row
// (one area shown at a time, matching the app's hub pattern) rather than the
// old stack of cards that jumbled two sections into a single scroll:
//   1. Promotion RULES -- "buy >= X save Y", "% off", "fixed off", scoped
//      to chosen products, a category, or a brand, with an optional shown/
//      hidden Title and start/end dates. Stored in promotion_rules and
//      evaluated by the ONE shared kernel (utils/promotionRules.ts) that
//      POS charges with and the portal advertises with.
//   2. Per-product DISCOUNTS -- the products' own discount_* fields.
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

// Live/Scheduled/Ended/Paused, derived from is_active + the server's
// currently_active flag + the date window, so a rule reads its real state at
// a glance instead of a bare active/inactive dot.
type PromoStatusKey = 'live' | 'scheduled' | 'ended' | 'paused'

const PROMO_STATUS_STYLE: Record<PromoStatusKey, string> = {
  live: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ended: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

const PROMO_STATUS_DOT: Record<PromoStatusKey, string> = {
  live: 'bg-emerald-500', scheduled: 'bg-blue-500', ended: 'bg-gray-400', paused: 'bg-amber-500',
}

function computePromoStatus(isActive: boolean, currentlyActive: boolean, startsAt?: unknown, endsAt?: unknown): PromoStatusKey {
  if (!isActive) return 'paused'
  if (currentlyActive) return 'live'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startStr = dateInputValue(startsAt)
  const endStr = dateInputValue(endsAt)
  if (endStr && new Date(`${endStr}T00:00:00`).getTime() < today.getTime()) return 'ended'
  if (startStr && new Date(`${startStr}T00:00:00`).getTime() > today.getTime()) return 'scheduled'
  return 'scheduled'
}

function ruleTypeIcon(ruleType: string): ComponentType<SVGProps<SVGSVGElement>> {
  if (ruleType === 'percent_off' || ruleType === 'quantity_percent') return Percent
  if (ruleType === 'next_item') return Gift
  return Tag
}

type PromotionsSection = 'rules' | 'discounts' | 'loyalty'

export default function PromotionsPage() {
  const { t, notify, fmtUSD, getPermissionTier, can, hasPermission, navigateTo } = useApp()
  // G2 section gates: the page door admits either grant (see
  // AppContext.canAccessPage); each section still needs its own.
  const canPromotions = getPermissionTier('promotions') !== 'none'
  // Part 557 slice 4: 'promotions' is a view-tier section. A View-only grant
  // reads the rule list but every write (new/edit/delete rule) is hidden here
  // and refused by the backend (writes keep requireKey('promotions')). Full only.
  const canManagePromotions = can('promotions', 'manage')
  // The Discounts sub-section edits PER-PRODUCT discounts via updateProduct(),
  // which the backend gates on 'products' (not 'promotions'). It was coupled to
  // canPromotions, so a promotions user without products access saw a discount
  // editor whose every save 403'd -- a fake control this view-tier slice would
  // otherwise widen to view users. Gate it on its REAL capability instead: the
  // products tier (review or full can write; review queues for approval).
  const canManageDiscounts = getPermissionTier('products') !== 'none'
  const canLoyalty = getPermissionTier('customer_portal') !== 'none'
  const [activeSection, setActiveSection] = useHubSection<PromotionsSection>('promotions', canPromotions ? 'rules' : 'loyalty', getHubDestinations('promotions', { getPermissionTier, hasPermission }).map((item) => item.id), navigateTo)
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

  // S4-21: both editors are whole-object drafts, so dirtiness is "differs
  // from the draft as it opened". The reset key goes null between openings,
  // which is what re-baselines the snapshot on the next one.
  const ruleDirty = useFormDirty(draft, draft ? String(draft.id ?? "new") : null)
  const discountDirty = useFormDirty(discountDraft, discountDraft ? String(discountDraft.product.id) : null)
  const ruleGuard = useCloseGuard({ dirty: ruleDirty.dirty }, () => setDraft(null))
  const discountGuard = useCloseGuard({ dirty: discountDirty.dirty }, () => setDiscountDraft(null))
  // Backdrop and Cancel both land here.
  const requestCloseRule = () => { if (!savingRule) ruleGuard.requestClose() }
  const requestCloseDiscount = () => { if (!savingDiscount) discountGuard.requestClose() }

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

  const openNewRule = () => {
    if (!canManagePromotions) return
    setPickerQuery(''); setPickerResults([]); setDraft({ ...EMPTY_RULE })
  }

  const openEditRule = (row: PromotionRuleRow) => {
    if (!canManagePromotions) return
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
    if (!canManagePromotions) { notify(t('perm_view_only_generic') || 'View only: you do not have permission to make this change.', 'error'); return }
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
    if (!canManagePromotions) { notify(t('perm_view_only_generic') || 'View only: you do not have permission to make this change.', 'error'); return }
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
    if (!canManageDiscounts) return
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
    if (!canManageDiscounts) { notify(t('perm_view_only_generic') || 'View only: you do not have permission to make this change.', 'error'); return }
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

  // Rule + discount rows pre-tagged with their real status, so the cards and
  // the stat strip read from one computation.
  const ruleViews = useMemo(() => rules.map((row) => ({
    row,
    status: computePromoStatus(row.normalized?.is_active ?? true, row.currently_active, row.normalized?.starts_at, row.normalized?.ends_at),
  })), [rules])
  const liveRules = useMemo(() => ruleViews.filter((v) => v.status === 'live').length, [ruleViews])
  const scheduledRules = useMemo(() => ruleViews.filter((v) => v.status === 'scheduled').length, [ruleViews])

  const discountViews = useMemo(() => discounted.map((product) => ({
    product,
    promo: calculateProductDiscount(product as Parameters<typeof calculateProductDiscount>[0]),
    live: isProductDiscountActive(product as Parameters<typeof isProductDiscountActive>[0]),
  })), [discounted])
  const liveDiscounts = useMemo(() => discountViews.filter((v) => v.live).length, [discountViews])

  const inputCls = 'input text-sm w-full'
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

  const statusLabel = (status: PromoStatusKey): string => ({
    live: t('promo_status_live') || 'Live',
    scheduled: t('promo_status_scheduled') || 'Scheduled',
    ended: t('promo_status_ended') || 'Ended',
    paused: t('promo_status_paused') || 'Paused',
  }[status])

  const StatusPill = ({ status }: { status: PromoStatusKey }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PROMO_STATUS_STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${PROMO_STATUS_DOT[status]}`} />
      {statusLabel(status)}
    </span>
  )

  const StatTile = ({ label, value, dot }: { label: string; value: number; dot?: string }) => (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-gray-900 dark:text-white">
        {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} /> : null}
        {value}
      </div>
    </div>
  )

  // Discounts self-gates on 'products' (its real backend gate), not the
  // promotions grant -- see canManageDiscounts above. Each section is always
  // present in the list (HubSectionNav filters `hidden` ones out) so the
  // gating stays legible in one place instead of three conditional spreads.
  const sections: HubSectionDef[] = [
    { id: 'rules', label: t('promo_tab_rules') || 'Rules', icon: BadgePercent, hidden: !canPromotions, tone: 'text-rose-600 dark:text-rose-400', description: t('hub_desc_promotions_rules') || undefined },
    { id: 'discounts', label: t('promo_tab_discounts') || 'Discounts', icon: Percent, hidden: !canManageDiscounts, tone: 'text-indigo-600 dark:text-indigo-400', description: t('hub_desc_promotions_discounts') || undefined },
    { id: 'loyalty', label: t('loyalty_points') || 'Loyalty Points', icon: Gift, hidden: !canLoyalty, tone: 'text-amber-600 dark:text-amber-400', description: t('hub_desc_promotions_loyalty') || undefined },
  ]

  return (
    // page-scroll (full-width) is the scroll container; the inner wrapper keeps
    // the old max-w-5xl centering. Without page-scroll here the whole page sat
    // inside PageSlot's overflow-hidden box and anything below the fold was
    // unreachable (reported: Promotions/Loyalty could not scroll).
    <div className="page-scroll p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* No page title (user, Sep 3 2026). Promotions used to be the one
            hub that kept an always-visible "Promotions" heading above its
            switcher; the other four show none, and the sidebar already says
            which page you are on. Removing it brings Promotions into line
            with its siblings and gives the sections a screenful more room.
            The name is still passed to HubSectionNav below, where layer 2 on
            a phone does need it as the mini-page heading. */}
        <HubSectionNav
          sections={sections}
          active={activeSection}
          onChange={(id) => setActiveSection(id as PromotionsSection)}
          storageKey="bos:hub:promotions:active"
          pageId="promotions"
        >
        {activeSection === 'loyalty' ? (
          // G2: the whole former Loyalty Points page, embedded (its own
          // header/sections/logic untouched -- one implementation, new home).
          <Suspense fallback={<p className="py-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
            <LoyaltyPointsSection />
          </Suspense>
        ) : null}

        {activeSection === 'rules' && canPromotions ? (
          <div className="space-y-3">
            {/* Toolbar row: description hint + the primary action. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('promo_rules_section') || 'Promotion rules'}</h2>
                <InfoHint
                  label={t('promo_rules_section') || 'Promotion rules'}
                  text={t('promo_rules_section_sub') || 'Buy-more deals, % off and fixed savings across products, a category or a brand. POS and the storefront price with the same rules.'}
                />
              </div>
              {canManagePromotions ? (
                <button type="button" className="btn btn-primary btn-sm inline-flex items-center gap-1" onClick={openNewRule}>
                  <Plus className="h-4 w-4" /> {t('promo_new_rule') || 'New rule'}
                </button>
              ) : null}
            </div>

            {/* Stats sit BELOW the toolbar row, shown inline (never behind an expander). */}
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={t('promo_status_live') || 'Live'} value={liveRules} dot={PROMO_STATUS_DOT.live} />
              <StatTile label={t('promo_status_scheduled') || 'Scheduled'} value={scheduledRules} dot={PROMO_STATUS_DOT.scheduled} />
              <StatTile label={t('promo_stat_total') || 'Total'} value={rules.length} />
            </div>

            {rulesLoading ? (
              <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
            ) : rulesError ? (
              <p className="py-6 text-center text-sm text-red-600">{rulesError}</p>
            ) : rules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center dark:border-gray-800">
                <BadgePercent className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500">{t('promo_no_rules') || 'No promotion rules yet. Create one to put a deal on the storefront and POS.'}</p>
                {canManagePromotions ? (
                  <button type="button" className="btn btn-primary btn-sm mt-3 inline-flex items-center gap-1" onClick={openNewRule}>
                    <Plus className="h-4 w-4" /> {t('promo_new_rule') || 'New rule'}
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 md:block">
                  <table className="w-full min-w-[760px] border-collapse text-xs">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Ref</th>
                        <th className="px-3 py-2 font-semibold">{t('promotions') || 'Promotion'}</th>
                        <th className="px-3 py-2 font-semibold">{t('type') || 'Type'}</th>
                        <th className="px-3 py-2 font-semibold">{t('scope') || 'Scope'}</th>
                        <th className="px-3 py-2 font-semibold">{t('date') || 'Schedule'}</th>
                        <th className="px-3 py-2 font-semibold">{t('status') || 'Status'}</th>
                        <th className="px-2 py-2 text-right font-semibold">{t('actions') || 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {ruleViews.map(({ row, status }) => {
                        const rule = row.normalized
                        const schedule = [rule?.starts_at ? fmtDate(rule.starts_at) : '', rule?.ends_at ? fmtDate(rule.ends_at) : ''].filter(Boolean).join(' – ')
                        return (
                          <tr key={`desktop-${row.id}`} className={`${canManagePromotions ? 'cursor-pointer' : ''} hover:bg-slate-50 dark:hover:bg-slate-800/50`} onClick={() => { if (canManagePromotions) openEditRule(row) }}>
                            <td className="max-w-[7rem] truncate px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400" title={`PR-${row.id}`}>PR-{row.id}</td>
                            <td className="max-w-[15rem] px-3 py-1.5"><div className="truncate font-semibold text-slate-800 dark:text-slate-100" title={rule?.title || `#${row.id}`}>{rule?.title || `#${row.id}`}</div><div className="truncate text-[11px] text-slate-400">{ruleSummary(row)}</div></td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-600 dark:text-slate-300">{String(rule?.rule_type || '').replaceAll('_', ' ')}</td>
                            <td className="max-w-[12rem] truncate px-3 py-1.5 text-slate-600 dark:text-slate-300" title={ruleScopeSummary(row, t)}>{ruleScopeSummary(row, t)}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-slate-500">{schedule || '—'}</td>
                            <td className="px-3 py-1.5"><StatusPill status={status} /></td>
                            <td className="px-2 py-1.5" onClick={(event) => event.stopPropagation()}><div className="flex flex-nowrap justify-end gap-0.5">{canManagePromotions ? <><button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" onClick={() => openEditRule(row)} aria-label={t('edit') || 'Edit'} title={t('edit') || 'Edit'}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={() => removeRule(row)} aria-label={t('delete') || 'Delete'} title={t('delete') || 'Delete'}><Trash2 className="h-3.5 w-3.5" /></button></> : <span className="text-slate-300">—</span>}</div></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 md:hidden">
                {ruleViews.map(({ row, status }) => {
                  const rule = row.normalized
                  const color = rule?.badge_color || '#e11d48'
                  const Icon = ruleTypeIcon(rule?.rule_type || 'fixed_off')
                  const window = [
                    rule?.starts_at ? `${t('promo_from') || 'from'} ${fmtDate(rule.starts_at)}` : '',
                    rule?.ends_at ? `${t('promo_until') || 'until'} ${fmtDate(rule.ends_at)}` : '',
                  ].filter(Boolean).join(' ')
                  return (
                    <div
                      key={row.id}
                      className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-rose-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900/40 dark:hover:border-rose-800"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: status === 'live' ? color : '#9ca3af' }}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{rule?.title || `#${row.id}`}</span>
                          <StatusPill status={status} />
                          {rule && !rule.show_title ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800">{t('promo_title_hidden') || 'title hidden'}</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">{ruleSummary(row)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                          <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{ruleScopeSummary(row, t)}</span>
                          {window ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{window}</span> : null}
                        </div>
                      </div>
                      {canManagePromotions ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" onClick={() => openEditRule(row)} aria-label={t('edit') || 'Edit'}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button type="button" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20" onClick={() => removeRule(row)} aria-label={t('delete') || 'Delete'}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                </div>
              </>
            )}
          </div>
        ) : null}

        {activeSection === 'discounts' && canManageDiscounts ? (
          <div className="space-y-3">
            {/* The search box is this section's own toolbar row -- it comes
                first; the stats and list drop underneath it. */}
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  className={`${inputCls} pl-8`}
                  placeholder={t('promo_search_product_placeholder') || 'Search a product to set its discount...'}
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                />
                {productResults.length > 0 ? (
                  <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                    {productResults.map((product) => (
                      <li key={String(product.id)}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                          onClick={() => { openDiscountEditor(product); setProductResults([]) }}
                        >
                          {String(product.name || `#${product.id}`)}
                          <span className="ml-2 text-xs text-gray-400">{fmtUSD(Number(product.selling_price_usd) || 0)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <ScanSearchButton onDetected={setProductQuery} t={t} />
              <InfoHint
                label={t('promo_product_discounts_section') || 'Per-product discounts'}
                text={t('promo_product_discounts_sub') || 'Single-product price cuts (the fields that used to live in the product form). Labels stay visible on Products, POS and the storefront.'}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatTile label={t('promo_status_live') || 'Live'} value={liveDiscounts} dot={PROMO_STATUS_DOT.live} />
              <StatTile label={t('promo_stat_total') || 'Total'} value={discounted.length} />
            </div>

            {discountedLoading ? (
              <p className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading'}...</p>
            ) : discounted.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center dark:border-gray-800">
                <Percent className="mx-auto mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm text-gray-500">{t('promo_no_discounts') || 'No products carry their own discount right now.'}</p>
                <p className="mt-1 text-xs text-gray-400">{t('promo_search_product_placeholder') || 'Search a product to set its discount...'}</p>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 md:block">
                  <table className="w-full min-w-[680px] border-collapse text-xs">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                      <tr><th className="px-3 py-2 font-semibold">Ref</th><th className="px-3 py-2 font-semibold">{t('product') || 'Product'}</th><th className="px-3 py-2 font-semibold">{t('price') || 'Price'}</th><th className="px-3 py-2 font-semibold">{t('promo_until') || 'Until'}</th><th className="px-3 py-2 font-semibold">{t('status') || 'Status'}</th><th className="px-2 py-2 text-right font-semibold">{t('actions') || 'Actions'}</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {discountViews.map(({ product, promo, live }) => {
                        const status: PromoStatusKey = computePromoStatus(Boolean(product.discount_enabled), live, product.discount_starts_at, product.discount_ends_at)
                        return <tr key={`desktop-${String(product.id)}`} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => openDiscountEditor(product)}>
                          <td className="max-w-[7rem] truncate px-3 py-1.5 font-mono font-semibold text-blue-600 dark:text-blue-400" title={`PD-${product.id}`}>PD-{String(product.id)}</td>
                          <td className="max-w-[16rem] truncate px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-100" title={String(product.name || `#${product.id}`)}>{String(product.name || `#${product.id}`)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5"><span className="text-slate-400 line-through">{fmtUSD(Number(product.selling_price_usd) || 0)}</span>{promo.active ? <span className="ml-1.5 font-semibold text-emerald-600 dark:text-emerald-400">{fmtUSD(promo.applied_price_usd)}</span> : null}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-[11px] text-slate-500">{product.discount_ends_at ? fmtDate(String(product.discount_ends_at)) : '—'}</td>
                          <td className="px-3 py-1.5"><StatusPill status={status} /></td>
                          <td className="px-2 py-1.5 text-right" onClick={(event) => event.stopPropagation()}><button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800" onClick={() => openDiscountEditor(product)} aria-label={t('edit') || 'Edit'} title={t('edit') || 'Edit'}><Pencil className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 md:hidden">
                {discountViews.map(({ product, promo, live }) => {
                  const status: PromoStatusKey = computePromoStatus(Boolean(product.discount_enabled), live, product.discount_starts_at, product.discount_ends_at)
                  const color = String(product.discount_badge_color || '#e11d48')
                  return (
                    <div
                      key={String(product.id)}
                      className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 transition hover:border-indigo-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900/40 dark:hover:border-indigo-800"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm" style={{ backgroundColor: live ? color : '#9ca3af' }}>
                        <Tag className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{String(product.name || `#${product.id}`)}</span>
                          <StatusPill status={status} />
                          {String(product.discount_label || '') ? (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: color }}>
                              {String(product.discount_label)}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                          {promo.active ? (
                            <>
                              <span className="text-gray-400 line-through">{fmtUSD(Number(product.selling_price_usd) || 0)}</span>
                              {' → '}
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUSD(promo.applied_price_usd)}</span>
                              <span className="ml-1 text-gray-400">(−{promo.percent_off}%)</span>
                            </>
                          ) : (t('promo_discount_not_live') || 'Configured, not currently live')}
                        </p>
                        {product.discount_ends_at ? (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                            <CalendarClock className="h-3 w-3" />{t('promo_until') || 'until'} {fmtDate(String(product.discount_ends_at))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200" onClick={() => openDiscountEditor(product)} aria-label={t('edit') || 'Edit'}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                </div>
              </>
            )}
          </div>
        ) : null}
        </HubSectionNav>

        {draft ? (
          <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-start justify-center overflow-y-auto bg-black/40" onClick={requestCloseRule}>
            <div className="modal-panel-safe my-auto w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
              <h2 className="text-base font-semibold">
                {draft.id ? (t('promo_edit_rule') || 'Edit promotion') : (t('promo_new_rule') || 'New rule')}
              </h2>

              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <div>
                  <label className={labelCls}>{t('promo_title_label') || 'Title (shown to customers)'}</label>
                  <input className={inputCls} value={draft.title} maxLength={120}
                    placeholder={t('promo_title_placeholder') || 'e.g. Buy 3 Save $5'}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 pb-2 text-xs text-gray-600">
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
                  <input type="color" className="input h-9 w-full p-1" value={draft.badge_color}
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
                <div className="truncate pb-1 text-xs text-gray-500">
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
                        <span key={String(product.id)} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
                          {String(product.name || `#${product.id}`)}
                          <button type="button" className="text-gray-400 hover:text-red-600"
                            onClick={() => setDraft({ ...draft, products: draft.products.filter((p) => p.id !== product.id) })}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex min-w-0 items-start gap-1.5">
                    <div className="relative min-w-0 flex-1">
                      <input className={inputCls} value={pickerQuery}
                        placeholder={t('promo_pick_products_placeholder') || 'Search products to add...'}
                        onChange={(event) => setPickerQuery(event.target.value)} />
                      {pickerResults.length > 0 && (
                        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                          {pickerResults.map((product) => (
                            <li key={String(product.id)}>
                              <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
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
                    <ScanSearchButton onDetected={setPickerQuery} t={t} />
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
                  <DateEntryInput className={inputCls} bare t={t} ariaLabel={t('promo_starts') || 'Starts'} value={draft.starts_at}
                    onChange={(iso) => setDraft({ ...draft, starts_at: iso })} />
                </div>
                <div>
                  <label className={labelCls}>{t('promo_ends') || 'Ends (optional)'}</label>
                  <DateEntryInput className={inputCls} bare t={t} ariaLabel={t('promo_ends') || 'Ends'} value={draft.ends_at}
                    onChange={(iso) => setDraft({ ...draft, ends_at: iso })} />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" checked={draft.is_active}
                  onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })} />
                {t('promo_rule_active') || 'Active'}
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn btn-ghost btn-sm" disabled={savingRule} onClick={requestCloseRule}>
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={savingRule} onClick={saveRule}>
                  {savingRule ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                </button>
              </div>
            </div>
            <UnsavedChangesPrompt guard={ruleGuard} />
          </div>
        ) : null}

        {discountDraft ? (
          <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1050] flex items-start justify-center overflow-y-auto bg-black/40" onClick={requestCloseDiscount}>
            <div className="modal-panel-safe my-auto w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
              <h2 className="truncate text-base font-semibold">
                {(t('promo_discount_for') || 'Discount for')} {String(discountDraft.product.name || `#${discountDraft.product.id}`)}
              </h2>

              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
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
                  <DateEntryInput className={inputCls} bare t={t} ariaLabel={t('promo_starts') || 'Starts'} value={discountDraft.discount_starts_at}
                    onChange={(iso) => setDiscountDraft({ ...discountDraft, discount_starts_at: iso })} />
                </div>
                <div>
                  <label className={labelCls}>{t('promo_ends') || 'Ends (optional)'}</label>
                  <DateEntryInput className={inputCls} bare t={t} ariaLabel={t('promo_ends') || 'Ends'} value={discountDraft.discount_ends_at}
                    onChange={(iso) => setDiscountDraft({ ...discountDraft, discount_ends_at: iso })} />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn btn-ghost btn-sm" disabled={savingDiscount} onClick={requestCloseDiscount}>
                  {t('cancel') || 'Cancel'}
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={savingDiscount} onClick={saveDiscount}>
                  {savingDiscount ? (t('saving') || 'Saving...') : (t('save') || 'Save')}
                </button>
              </div>
            </div>
            <UnsavedChangesPrompt guard={discountGuard} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

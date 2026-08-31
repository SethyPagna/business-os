import type { FilterSection } from './FilterMenu.tsx'

// G1 "Promotions" quick-filter section for the Products page -- the three
// promo states the spec names ("Filters exist for every one of these
// states (promoted / discounted / by promotion)"): everything currently
// promoted (a live per-product discount OR any active rule), only
// per-product discounts, only rule-covered products, or one specific rule.
// Single-select: the states overlap by construction (promoted is the
// union), so multi-select OR would just re-say 'promoted'.
//
// The value shape is the server's own `promo` query param on
// /api/products/search (routes/products.ts): 'promoted' | 'discounted' |
// 'rules' | 'rule:<id>'.

export type PromotionFilterOption = { id: number; title: string; rule_type?: string }

export interface BuildPromotionsFilterSectionParams {
  t?: (key: string) => string | undefined
  promoFilter: string
  setPromoFilter: (value: string) => void
  promotionOptions?: PromotionFilterOption[]
}

export function buildPromotionsFilterSection({
  t,
  promoFilter,
  setPromoFilter,
  promotionOptions = [],
}: BuildPromotionsFilterSectionParams): FilterSection {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const staticOptions = [
    { id: 'all', value: 'all', label: T('all', 'All') },
    { id: 'promoted', value: 'promoted', label: T('promo_filter_promoted', 'Promoted') },
    { id: 'discounted', value: 'discounted', label: T('promo_filter_discounted', 'Discounted') },
    ...(promotionOptions.length ? [{ id: 'rules', value: 'rules', label: T('promo_filter_any_rule', 'Any promotion rule') }] : []),
  ]

  const options = [
    ...staticOptions.map((option) => ({
      id: option.id,
      label: option.label,
      active: option.value === 'all' ? promoFilter === 'all' || !promoFilter : promoFilter === option.value,
      onClick: () => setPromoFilter(option.value === 'all' || promoFilter === option.value ? 'all' : option.value),
    })),
    ...promotionOptions.map((rule) => ({
      id: `rule-${rule.id}`,
      label: rule.title,
      active: promoFilter === `rule:${rule.id}`,
      onClick: () => setPromoFilter(promoFilter === `rule:${rule.id}` ? 'all' : `rule:${rule.id}`),
    })),
  ]

  const activeOption = options.find((option) => option.active && option.id !== 'all')
  return {
    id: 'promotions',
    label: T('promotions', 'Promotions'),
    summary: activeOption ? activeOption.label : T('all', 'All'),
    active: Boolean(activeOption),
    options,
  }
}

import { apiFetch } from './http.ts'
import type { PromotionRule } from '../utils/promotionRules.ts'

export type Promotion = {
  id: number
  title: string
  subtitle: string | null
  image_path: string | null
  link_type: 'none' | 'product' | 'url'
  link_product_id: number | null
  link_url: string | null
  badge_text: string | null
  badge_color: string | null
  is_active: number
  sort_order: number
  starts_at: string | null
  ends_at: string | null
  created_at: string
  updated_at: string
}

export function getPromotions(): Promise<Promotion[]> {
  return apiFetch('GET', '/api/promotions')
}

export function createPromotion(payload: Partial<Promotion>): Promise<Promotion> {
  return apiFetch('POST', '/api/promotions', payload)
}

export function updatePromotion(id: number | string, payload: Partial<Promotion>): Promise<Promotion> {
  return apiFetch('PUT', `/api/promotions/${id}`, payload)
}

export function deletePromotion(id: number | string): Promise<{ deleted: boolean }> {
  return apiFetch('DELETE', `/api/promotions/${id}`)
}

export function reorderPromotions(order: Array<number | string>): Promise<Promotion[]> {
  return apiFetch('PUT', '/api/promotions/reorder/all', { order })
}

// ---------------------------------------------------------------------------
// G1 promotion RULES (the pricing engine) -- a different feature from the
// announcement-strip Promotion rows above; see routes/promotions.ts.

export type PromotionRuleRow = Record<string, unknown> & {
  id: number
  normalized: PromotionRule | null
  currently_active: boolean
}

export type PromotionRuleWrite = {
  title?: string
  show_title?: boolean
  rule_type: 'quantity_save' | 'percent_off' | 'fixed_off' | 'spend_save' | 'quantity_percent' | 'next_item'
  min_quantity?: number
  save_usd?: number
  save_khr?: number
  percent_off?: number
  min_spend_usd?: number
  min_spend_khr?: number
  label_style?: 'save' | 'get' | 'free'
  scope_type: 'products' | 'category' | 'brand'
  product_ids?: number[]
  category?: string
  brand?: string
  badge_color?: string
  starts_at?: string | null
  ends_at?: string | null
  is_active?: boolean
}

export function getPromotionRules(): Promise<PromotionRuleRow[]> {
  return apiFetch('GET', '/api/promotions/rules')
}

export function getActivePromotionRules(): Promise<{ rules: PromotionRule[]; now: string }> {
  return apiFetch('GET', '/api/promotions/rules/active')
}

export function createPromotionRule(payload: PromotionRuleWrite): Promise<Record<string, unknown>> {
  return apiFetch('POST', '/api/promotions/rules', payload)
}

export function updatePromotionRule(id: number | string, payload: PromotionRuleWrite): Promise<Record<string, unknown>> {
  return apiFetch('PUT', `/api/promotions/rules/${id}`, payload)
}

export function deletePromotionRule(id: number | string): Promise<{ deleted: boolean }> {
  return apiFetch('DELETE', `/api/promotions/rules/${id}`)
}

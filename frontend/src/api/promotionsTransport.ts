import { apiFetch } from './http.ts'

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

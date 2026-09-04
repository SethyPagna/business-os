import { apiFetch } from './http.ts'

// D6: rename-cascade preview + brand carry (see cloudflare
// lib/renameCascade.ts -- one impact shape for all four rename kinds).

export type RenameKind = 'category' | 'brand' | 'unit' | 'supplier' | 'customer' | 'delivery_contact' | 'user' | 'product_name'

export type RenameImpact = {
  kind: RenameKind
  from: string
  to: string
  products_primary: number
  products_secondary: number
  batches: number
  group_rows: number
  target_exists: boolean
  historical_snapshots_preserved: string[]
  linked_records?: number
  live_snapshots?: Record<string, number>
}

export function getRenameImpact(kind: RenameKind, from: string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ kind, from, to })
  return apiFetch('GET', `/api/products/rename-impact?${query.toString()}`)
}

export function renameBrandEverywhere(from: string, to: string): Promise<{ renamed: boolean; products: number }> {
  return apiFetch('POST', '/api/products/rename-brand', { from, to })
}

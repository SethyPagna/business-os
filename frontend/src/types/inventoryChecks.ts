export type InventoryCheckId = number | string

export type InventoryCheckProduct = {
  id: InventoryCheckId
  name: string
  quantity?: number | null
  sku?: string | null
  barcode?: string | null
  image_path?: string | null
  parent_id?: InventoryCheckId | null
  is_group?: boolean
  checkable?: boolean
  matches_filters?: boolean
  brand?: string | null
  category?: string | null
  damaged_quantity?: number | null
  qty_sold?: number | null
  customer_count?: number | null
  selling_price_usd?: number | null
  cost_price_usd?: number | null
  cost_needs_review?: boolean
  stock_consistent?: boolean
  stock_diagnostics?: string | null
  unit?: string | null
  latest_received_at?: string | null
  /** Earliest expiry among lots still holding stock; sent only while received dates are visible. */
  next_expiry_date?: string | null
}

export type InventoryCheckTranslator = (key: string) => string | null | undefined

export type InventoryCheckObservation = {
  product_id: InventoryCheckId
  state: 'unstarted' | 'done' | 'issue'
  counted_quantity: number | null
  reason: string | null
  revision: number
  baseline_quantity?: number | null
  current_quantity?: number | null
  stock_changed?: boolean
}

export type InventoryCheckPatch = {
  state: 'done' | 'issue' | 'unstarted'
  counted_quantity?: number | null
  reason?: string | null
}

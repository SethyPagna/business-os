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
  brand?: string | null
  category?: string | null
  damaged_quantity?: number | null
  qty_sold?: number | null
  customer_count?: number | null
  selling_price_usd?: number | null
  cost_price_usd?: number | null
}

export type InventoryCheckObservation = {
  product_id: InventoryCheckId
  state: 'done' | 'issue'
  counted_quantity: number | null
  reason: string | null
  revision: number
  baseline_quantity?: number | null
}

export type InventoryCheckPatch = {
  state: 'done' | 'issue' | 'unstarted'
  counted_quantity?: number | null
  reason?: string | null
}

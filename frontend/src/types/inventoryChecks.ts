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
  stock_consistent?: boolean
  stock_diagnostics?: string | null
  unit?: string | null
  /** ic_wired rows, only for a viewer with the price grant: the Products row prices and the product discount (see inventoryPriceFacts.ts). */
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  wholesale_price_usd?: number | string | null
  wholesale_price_khr?: number | string | null
  discount_enabled?: number | boolean | null
  discount_type?: string | null
  discount_percent?: number | string | null
  discount_amount_usd?: number | string | null
  discount_amount_khr?: number | string | null
  discount_label?: string | null
  discount_badge_color?: string | null
  discount_starts_at?: string | null
  discount_ends_at?: string | null
  latest_received_at?: string | null
  /** Earliest expiry among lots still holding stock; sent only while received dates are visible. */
  next_expiry_date?: string | null
  /** The latest check of this product in the chosen branch scope (ic_simple list rows only). Counts and names arrive only for viewers who may see them. */
  check_status?: InventoryCheckListStatus
  check_counted_quantity?: number | null
  check_note?: string | null
  check_by?: string
  check_at?: string | null
  check_session_id?: string | null
  check_branch_id?: number | null
  /** This count differs from stock and waits for an administrator's approval (ic_fix_stock; sent only to a viewer who may see stock). */
  check_pending?: boolean
  /** ic_wired rows: computed on the client from the shared row and the overlay, never read. difference = counted - now; set_to = the figure a Set would write; last_change_at = the last recorded movement. */
  check_difference?: number | null
  check_set_to?: number | null
  check_seen_quantity?: number | null
  last_change_at?: string | null
  /** ic_wired rows with received dates: the dates this branch holds, oldest expiry first. */
  lot_rows?: InventoryCheckLotRow[]
  /** The row's dates were cut at the plan's limit: the rest load on request ("More dates"). */
  lots_more?: boolean
  /** Branch units that no received date holds (branch total minus the dates), shown read-only; absent when there are none or the dates are not known. */
  unlotted_quantity?: number
  /** ic_wired rows: what the latest count typed per received date (batch_id 0 = the branch total). */
  check_lines?: Array<{ batch_id: number; scope: 'lot' | 'branch'; counted: number; seen?: number }>
}

/** One received date held at the listed branch (ic_lot_counts): the figure a count per date is typed against. */
export type InventoryCheckLotRow = { batchId: number; receivedAt: string | null; expiry: string | null; quantity: number }

export type InventoryCheckListStatus = 'not_checked' | 'in_check' | 'ok' | 'issue'

export type InventoryCheckTranslator = (key: string) => string | null | undefined

export type InventoryCheckObservation = {
  product_id: InventoryCheckId
  /** ic_lot_counts: what the count typed per received date (batch_id 0 = the branch total). */
  lot_lines?: Array<{ batch_id: number; scope: 'lot' | 'branch'; counted: number; seen?: number; received_at?: string }>
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

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
}

export type InventoryCheckListStatus = 'not_checked' | 'in_check' | 'ok' | 'issue'

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

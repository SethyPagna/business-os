import type { ReactNode } from 'react'
import { useLowStockConfig, useT } from '../../AppContext'
import {
  stockGroupLevel,
  stockLevelState,
  type LowStockConfig,
  type StockLevel,
  type StockLevelProduct,
} from '../../utils/lowStockSettings.ts'

// The stock FIGURE tinted by its state -- green healthy, yellow low, red out. The number itself
// is the pill (the owner's "built in", 15 Nov 2026); there is no separate badge or column, and
// the tint is the text's own line box (see .stock-qty in main.css) so a row never changes height.
//
// The state is NEVER decided here: stockLevelState / stockGroupLevel (utils/lowStockSettings.ts)
// are the one rule the bell, the Dashboard overview and the alert pages also use. Colour is not
// the only signal: the title carries the state word and a screen-reader-only copy of it follows
// the number, so the accessible name reads "5 Low Stock".

const WORD_KEYS: Record<StockLevel, [string, string]> = {
  out: ['out_of_stock', 'Out of Stock'],
  low: ['low_stock', 'Low Stock'],
  healthy: ['healthy_stock', 'Healthy'],
}
// Literal class names, not built from the level: Tailwind only emits a component class it can read in the source.
const LEVEL_CLASS: Record<StockLevel, string> = {
  out: 'stock-qty-out',
  low: 'stock-qty-low',
  healthy: 'stock-qty-healthy',
}
const WORD_KEY_LIST = ['out_of_stock', 'low_stock', 'healthy_stock']

export function stockLevelWordKey(level: StockLevel): string {
  return WORD_KEYS[level][0]
}

type Members = ReadonlyArray<{ qty: unknown; product?: StockLevelProduct | null; status?: unknown }>

type Props = {
  /** The figure on screen. Also what the row's own state is computed from unless `members` is given. */
  qty: unknown
  product?: StockLevelProduct | null
  /** Defaults to the app's low-stock settings (no read: they are already in the settings map). */
  config?: LowStockConfig
  /** A status already computed under this config (a later stored table); skips the comparison. */
  status?: unknown
  /** A merged / family figure: the state is the Dashboard's family rule over these members, not the sum's own. */
  members?: Members
  /** What to print instead of the bare figure (for example `5 pcs`). */
  children?: ReactNode
  className?: string
}

export function stockQtyLevel({ qty, product, config, status, members }: Pick<Props, 'qty' | 'product' | 'status' | 'members'> & { config: LowStockConfig }): StockLevel {
  return members && members.length > 1 ? stockGroupLevel(members, config) : stockLevelState(qty, product, config, status)
}

export default function StockQty({ qty, product, config, status, members, children, className = '' }: Props) {
  const appConfig = useLowStockConfig()
  const words = useT(WORD_KEY_LIST)
  const level = stockQtyLevel({ qty, product, config: config || appConfig, status, members })
  const [key, fallback] = WORD_KEYS[level]
  const word = words[key] && words[key] !== key ? words[key] : fallback
  return (
    <span data-stock-qty="" data-stock-state={level} className={`stock-qty ${LEVEL_CLASS[level]} ${className}`.trim()} title={word}>
      {children ?? String(qty ?? 0)}
      <span className="sr-only"> {word}</span>
    </span>
  )
}

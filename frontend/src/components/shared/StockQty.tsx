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
// the number, so the accessible name reads "5 Low Stock" exactly once: the tooltip sits on an aria-hidden
// copy of the figure (mouse users only) and the screen-reader-only text carries the figure and the word.

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

type Members = ReadonlyArray<{ qty: unknown; product?: StockLevelProduct | null }>

type Props = {
  /** The figure on screen. Also what the row's own state is computed from unless `members` is given. */
  qty: unknown
  product?: StockLevelProduct | null
  /** Defaults to the app's low-stock settings (no read: they are already in the settings map). */
  config?: LowStockConfig
  /** A merged / family figure: the state is the Dashboard's family rule over these members, not the sum's own. */
  members?: Members
  className?: string
}

export function stockQtyLevel({ qty, product, config, members }: Pick<Props, 'qty' | 'product' | 'members'> & { config: LowStockConfig }): StockLevel {
  return members && members.length > 1 ? stockGroupLevel(members, config) : stockLevelState(qty, product, config)
}

export default function StockQty({ qty, product, config, members, className = '' }: Props) {
  const appConfig = useLowStockConfig()
  const words = useT(WORD_KEY_LIST)
  const level = stockQtyLevel({ qty, product, config: config || appConfig, members })
  const [key, fallback] = WORD_KEYS[level]
  const word = words[key] && words[key] !== key ? words[key] : fallback
  const figure = String(qty ?? 0)
  return (
    <span data-stock-qty="" data-stock-state={level} className={`stock-qty ${LEVEL_CLASS[level]} ${className}`.trim()}>
      <span aria-hidden="true" title={word}>{figure}</span>
      <span className="sr-only">{figure} {word}</span>
    </span>
  )
}

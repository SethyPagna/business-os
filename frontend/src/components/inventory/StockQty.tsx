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
// are the rule for one product (the bell judges each product on it) and for a merged / family row
// (the Dashboard's family rule: the best member wins), as the Dashboard overview and the alert
// pages do. A merged row can therefore be healthy while the bell lists one of its members as low.
// Colour is not the only signal: the figure is rendered ONCE and the state word follows it in
// screen-reader-only text (.stock-qty-word: inline, so innerText and copy read "5 Low Stock" on one line;
// Tailwind's sr-only is absolutely positioned and would put the word on a second line), once.
// The tooltip (title) is on the whole pill, padding included; a title on a plain span is not
// announced as a second name, and there is no duplicate figure to hide.

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
    <span data-stock-qty="" data-stock-state={level} title={word} className={`stock-qty ${LEVEL_CLASS[level]} ${className}`.trim()}>
      {figure}<span className="stock-qty-word">{` ${word}`}</span>
    </span>
  )
}

import { useLowStockConfig, useT } from '../../AppContext'
import {
  stockLevelState,
  type LowStockConfig,
  type StockLevel,
  type StockLevelProduct,
} from '../../utils/lowStockSettings.ts'

// The stock FIGURE tinted by its state -- green healthy, yellow low, red out. The number itself
// is the pill (the owner's "built in", 15 Nov 2026); there is no separate badge or column, and
// the tint is the text's own line box (see .stock-qty in main.css) so a row never changes height.
//
// The state is NEVER decided here: stockLevelState (utils/lowStockSettings.ts) is the rule for one
// product, the same one the bell and the alert pages judge each product on. There is no family
// rule on a stock row any more (owner, 16 Nov 2026): every product record is its own row.
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

type Props = {
  /** The figure on screen; the row's state is computed from it against the product's own thresholds. */
  qty: unknown
  product?: StockLevelProduct | null
  /** Defaults to the app's low-stock settings (no read: they are already in the settings map). */
  config?: LowStockConfig
  className?: string
}

export function stockQtyLevel({ qty, product, config }: Pick<Props, 'qty' | 'product'> & { config: LowStockConfig }): StockLevel {
  return stockLevelState(qty, product, config)
}

export default function StockQty({ qty, product, config, className = '' }: Props) {
  const appConfig = useLowStockConfig()
  const words = useT(WORD_KEY_LIST)
  const level = stockQtyLevel({ qty, product, config: config || appConfig })
  const [key, fallback] = WORD_KEYS[level]
  const word = words[key] && words[key] !== key ? words[key] : fallback
  const figure = String(qty ?? 0)
  return (
    <span data-stock-qty="" data-stock-state={level} title={word} className={`stock-qty ${LEVEL_CLASS[level]} ${className}`.trim()}>
      {figure}<span className="stock-qty-word">{` ${word}`}</span>
    </span>
  )
}

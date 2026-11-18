// The two per-product numbers that decide a stock state (Low stock / Out of stock), next to the global Settings rule (utils/lowStockSettings.ts stockLevelState / effectiveLowStockThreshold).
// The Worker puts them on a list row with the stock grant (cloudflare/src/lib/inventoryCheckList.ts GROUP_KEYS.stock). An Inventory row and its detail must carry them to the badge, or in the
// default per-product mode they judge a product on the Settings default while Products judges it on its own numbers.

export const STOCK_THRESHOLD_KEYS = ['low_stock_threshold', 'out_of_stock_threshold'] as const

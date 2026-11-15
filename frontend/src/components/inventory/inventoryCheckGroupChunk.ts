// The one place the grouped list's chunk is imported from. The page starts it together with the first grouped list request and draws the list only once both are in, so the first paint is already grouped
// (never flat, then regrouped); lazyRetry keeps the retry and recovery for a chunk that cannot be fetched.
let loaded: typeof import('./InventoryCheckGroupedList.tsx') | null = null
export const loadGroupedList = (): Promise<typeof import('./InventoryCheckGroupedList.tsx')> => import('./InventoryCheckGroupedList.tsx').then(module => { loaded = module; return module })
/** The chunk once it has been fetched (null before): a list drawn from it needs no Suspense, so nothing paints flat first. */
export const groupedListLoaded = (): typeof import('./InventoryCheckGroupedList.tsx') | null => loaded

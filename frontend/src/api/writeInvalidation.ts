// One declarative map: the API family a write goes to -> the cached read prefixes whose answers that write changes.
// apiFetch applies it after every successful (or outcome-unknown) mutation, and the sync:update listener applies the
// same entry for a change pushed from another device, so no screen in this tab can show the pre-write number.
// A family is the first path segment after /api/ in camelCase (import-jobs -> importJobs). The notification bell is not
// listed under any stock reader: it polls on its own cadence and a refetch after every sale would cost more than it shows.
// Every family a mutating call can reach
// must be a key here; tests/writeInvalidationMap.test.ts fails on a new /api family nobody classified, and a mutation
// to an unmapped family clears every cached read rather than leaving one stale.

const STOCK_READS = [
  'products:search', 'products:bootstrap', 'products:byIds', 'products:get',
  'inventory', 'batches', 'branches:summary', 'transfers', 'inventoryChecks',
]
const MONEY_READS = ['sales', 'returns', 'dashboard', 'analytics', 'fees', 'shifts', 'customers']
const SHARED_BY_STOCK_AND_MONEY = [...STOCK_READS, ...MONEY_READS]

export const WRITE_FAMILY_INVALIDATES: Readonly<Record<string, readonly string[]>> = {
  sales: SHARED_BY_STOCK_AND_MONEY,
  returns: SHARED_BY_STOCK_AND_MONEY,
  review: SHARED_BY_STOCK_AND_MONEY,
  actionHistory: ['products', ...SHARED_BY_STOCK_AND_MONEY, 'categories', 'units'],
  products: ['products', ...STOCK_READS, 'dashboard', 'analytics', 'categories', 'units'],
  importJobs: ['products', ...STOCK_READS, 'dashboard', 'analytics', 'categories', 'units'],
  inventory: [...STOCK_READS, 'dashboard', 'analytics'],
  batches: [...STOCK_READS, 'dashboard', 'analytics'],
  branches: [...STOCK_READS, 'dashboard', 'analytics'],
  transfers: [...STOCK_READS, 'dashboard', 'analytics'],
  inventoryChecks: STOCK_READS,
  customers: ['sales', 'returns', 'dashboard', 'analytics'],
  fees: ['fees', 'dashboard', 'analytics', 'shifts'],
  shifts: ['shifts', 'dashboard', 'analytics'],
  // Families that change only their own readers (route() already clears the channel family it writes under).
  auth: [], system: [], settings: [], users: [], roles: [], notes: [], ai: [], telegram: [], promotions: [],
  pos: [], portal: [], files: [], backups: [], runtime: [], sync: [], categories: [], units: [], suppliers: [],
  organizations: [], deliveryContacts: [], reports: [], notifications: [], dashboard: [], analytics: [],
}

// Families only ever read; listed so the coverage test can tell "read-only" from "forgotten".
export const READ_ONLY_FAMILIES: readonly string[] = []

export function apiFamilyOfPath(path: string): string {
  const match = /^\/api\/([^/?#]+)/.exec(String(path || ''))
  if (!match) return ''
  return match[1].replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** The cached read prefixes a mutation to `path` invalidates; null when its family is unmapped (the caller clears everything). */
export function invalidationsForWritePath(path: string): readonly string[] | null {
  const family = apiFamilyOfPath(path)
  if (!family) return null
  return Object.prototype.hasOwnProperty.call(WRITE_FAMILY_INVALIDATES, family) ? WRITE_FAMILY_INVALIDATES[family] : null
}

/** The same entry by channel family, for a change another device pushed over the sync socket. */
export function invalidationsForChannelFamily(family: string): readonly string[] {
  return Object.prototype.hasOwnProperty.call(WRITE_FAMILY_INVALIDATES, family) ? WRITE_FAMILY_INVALIDATES[family] : []
}

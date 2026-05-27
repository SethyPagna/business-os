export const KHMER_INITIALS = [
  '\u1780', '\u1781', '\u1782', '\u1783', '\u1784',
  '\u1785', '\u1786', '\u1787', '\u1788', '\u1789',
  '\u178A', '\u178B', '\u178C', '\u178D', '\u178E',
  '\u178F', '\u1790', '\u1791', '\u1792', '\u1793',
  '\u1794', '\u1795', '\u1796', '\u1797', '\u1798',
  '\u1799', '\u179A', '\u179B', '\u179C',
  '\u179F', '\u17A0', '\u17A1', '\u17A2',
]

type InitialType = 'latin' | 'number' | 'khmer' | 'other' | 'symbol'

interface InitialOptionInput {
  key?: unknown
  value?: unknown
  label?: unknown
  count?: unknown
}

interface ProductInitialInput {
  name?: unknown
  label?: unknown
}

const KHMER_ORDER = new Map(KHMER_INITIALS.map((letter, index) => [letter, index]))
const khmerCollator = typeof Intl !== 'undefined'
  ? new Intl.Collator('km', { sensitivity: 'base' })
  : null

export function normalizeInitialText(value: unknown): string {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function getInitialKey(value: unknown): string {
  const first = [...normalizeInitialText(value)][0] || ''
  if (!first) return '#'
  const upper = first.toLocaleUpperCase()
  if (/^[A-Z]$/.test(upper)) return upper
  if (/^[0-9]$/.test(first)) return first
  if (KHMER_ORDER.has(first) || /[\u1780-\u17FF]/.test(first)) return first
  if (/[\p{L}\p{N}]/u.test(first)) return upper || first
  return first
}

export function getInitialType(key: unknown): InitialType {
  const value = String(key || '')
  if (/^[A-Z]$/.test(value)) return 'latin'
  if (/^[0-9]$/.test(value)) return 'number'
  if (KHMER_ORDER.has(value) || /[\u1780-\u17FF]/.test(value)) return 'khmer'
  if (/[\p{L}\p{N}]/u.test(value)) return 'other'
  return 'symbol'
}

function getInitialRank(key: unknown): number {
  const type = getInitialType(key)
  if (type === 'latin') return 1
  if (type === 'number') return 2
  if (type === 'khmer') return 3
  if (type === 'other') return 4
  if (type === 'symbol') return 5
  return 6
}

export function compareInitialKeys(left: unknown, right: unknown): number {
  const a = String(left || '')
  const b = String(right || '')
  if (a === b) return 0
  const rankDelta = getInitialRank(a) - getInitialRank(b)
  if (rankDelta) return rankDelta
  if (getInitialType(a) === 'khmer' && getInitialType(b) === 'khmer') {
    const knownA = KHMER_ORDER.has(a)
    const knownB = KHMER_ORDER.has(b)
    if (knownA && knownB) return KHMER_ORDER.get(a)! - KHMER_ORDER.get(b)!
    return khmerCollator ? khmerCollator.compare(a, b) : a.localeCompare(b)
  }
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export function aggregateInitialOptions(rows: InitialOptionInput[] = []) {
  const map = new Map<string, number>()
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row?.key || getInitialKey(row?.value || row?.label || ''))
    const count = Number(row?.count || 0)
    if (!key || count <= 0) return
    map.set(key, (map.get(key) || 0) + count)
  })
  return [...map.entries()]
    .sort(([left], [right]) => compareInitialKeys(left, right))
    .map(([key, count]) => ({
      key,
      label: key,
      count,
      type: getInitialType(key),
    }))
}

export function buildInitialOptionsFromProducts(products: ProductInitialInput[] = []) {
  return aggregateInitialOptions(
    (Array.isArray(products) ? products : []).map((product) => ({
      value: product?.name || product?.label || '',
      count: 1,
    })),
  )
}

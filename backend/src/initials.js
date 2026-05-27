'use strict'

const KHMER_INITIALS = [
  '\u1780', '\u1781', '\u1782', '\u1783', '\u1784',
  '\u1785', '\u1786', '\u1787', '\u1788', '\u1789',
  '\u178A', '\u178B', '\u178C', '\u178D', '\u178E',
  '\u178F', '\u1790', '\u1791', '\u1792', '\u1793',
  '\u1794', '\u1795', '\u1796', '\u1797', '\u1798',
  '\u1799', '\u179A', '\u179B', '\u179C',
  '\u179F', '\u17A0', '\u17A1', '\u17A2',
]

function buildKhmerOrder() {
  const order = new Map()
  for (let index = 0; index < KHMER_INITIALS.length; index += 1) {
    order.set(KHMER_INITIALS[index], index)
  }
  return order
}

const KHMER_ORDER = buildKhmerOrder()
const khmerCollator = new Intl.Collator('km', { sensitivity: 'base' })

function normalizeInitialText(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ')
}

function getInitialKey(value) {
  const first = [...normalizeInitialText(value)][0] || ''
  if (!first) return '#'
  const upper = first.toLocaleUpperCase()
  if (/^[A-Z]$/.test(upper)) return upper
  if (/^[0-9]$/.test(first)) return first
  if (KHMER_ORDER.has(first) || /[\u1780-\u17FF]/.test(first)) return first
  if (/[\p{L}\p{N}]/u.test(first)) return upper || first
  return first
}

function getInitialType(key) {
  const value = String(key || '')
  if (/^[A-Z]$/.test(value)) return 'latin'
  if (/^[0-9]$/.test(value)) return 'number'
  if (KHMER_ORDER.has(value) || /[\u1780-\u17FF]/.test(value)) return 'khmer'
  if (/[\p{L}\p{N}]/u.test(value)) return 'other'
  return 'symbol'
}

function compareInitialKeys(left, right) {
  const a = String(left || '')
  const b = String(right || '')
  if (a === b) return 0
  const rank = (key) => {
    const type = getInitialType(key)
    if (type === 'latin') return 1
    if (type === 'number') return 2
    if (type === 'khmer') return 3
    if (type === 'other') return 4
    if (type === 'symbol') return 5
    return 6
  }
  const rankDelta = rank(a) - rank(b)
  if (rankDelta) return rankDelta
  if (getInitialType(a) === 'khmer' && getInitialType(b) === 'khmer') {
    const knownA = KHMER_ORDER.has(a)
    const knownB = KHMER_ORDER.has(b)
    if (knownA && knownB) return KHMER_ORDER.get(a) - KHMER_ORDER.get(b)
    return khmerCollator.compare(a, b)
  }
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

function aggregateInitialRows(rows = []) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = getInitialKey(row?.value)
    const count = Number(row?.count || 0)
    if (!key || count <= 0) continue
    map.set(key, (map.get(key) || 0) + count)
  }

  const entries = [...map.entries()]
  entries.sort(([left], [right]) => compareInitialKeys(left, right))

  const aggregates = []
  for (const [key, count] of entries) {
    aggregates.push({
      key,
      label: key,
      count,
      type: getInitialType(key),
    })
  }
  return aggregates
}

module.exports = {
  KHMER_INITIALS,
  aggregateInitialRows,
  compareInitialKeys,
  getInitialKey,
  getInitialType,
}

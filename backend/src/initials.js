'use strict'

const KHMER_INITIALS = [
  'ក', 'ខ', 'គ', 'ឃ', 'ង',
  'ច', 'ឆ', 'ជ', 'ឈ', 'ញ',
  'ដ', 'ឋ', 'ឌ', 'ឍ', 'ណ',
  'ត', 'ថ', 'ទ', 'ធ', 'ន',
  'ប', 'ផ', 'ព', 'ភ', 'ម',
  'យ', 'រ', 'ល', 'វ',
  'ស', 'ហ', 'ឡ', 'អ',
]

const KHMER_ORDER = new Map(KHMER_INITIALS.map((letter, index) => [letter, index]))
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
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = getInitialKey(row?.value)
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

module.exports = {
  KHMER_INITIALS,
  aggregateInitialRows,
  compareInitialKeys,
  getInitialKey,
  getInitialType,
}

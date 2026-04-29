function toDate(value) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function getTimeParts(value) {
  const parsed = toDate(value)
  if (!parsed) {
    return {
      date: null,
      year: '',
      month: '',
      yearLabel: 'Unknown year',
      monthLabel: 'Unknown month',
      monthKey: 'unknown-month',
      dayKey: 'unknown-day',
      dayLabel: 'Unknown day',
    }
  }

  const year = parsed.getFullYear()
  const month = parsed.getMonth() + 1
  const day = parsed.getDate()

  return {
    date: parsed,
    year,
    month,
    day,
    yearLabel: String(year),
    monthLabel: parsed.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    monthKey: `${year}-${String(month).padStart(2, '0')}`,
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    dayLabel: parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  }
}

export function matchesYearMonthFilters(value, { year = 'all', month = 'all' } = {}) {
  const parts = getTimeParts(value)
  if (year !== 'all' && parts.yearLabel !== String(year)) return false
  if (month !== 'all' && String(parts.month || '') !== String(month)) return false
  return true
}

export function getAvailableYears(items = [], getDate = (item) => item?.created_at) {
  const years = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const parts = getTimeParts(getDate(item))
    if (parts.yearLabel && parts.yearLabel !== 'Unknown year') years.add(parts.yearLabel)
  }
  return [...years].sort((left, right) => Number(right) - Number(left))
}

export function getTimeGroupingMode(year = 'all', month = 'all') {
  if (month !== 'all') return 'day'
  if (year !== 'all') return 'month'
  return 'year'
}

export function buildTimeActionSections(items = [], {
  getDate = (item) => item?.created_at,
  getItemId = (item) => item?.id,
  getActionKey = () => 'all',
  getActionLabel = () => 'All',
  year = 'all',
  month = 'all',
  timeMode = 'month',
} = {}) {
  const sections = new Map()

  for (const item of Array.isArray(items) ? items : []) {
    const dateValue = getDate(item)
    if (!matchesYearMonthFilters(dateValue, { year, month })) continue

    const parts = getTimeParts(dateValue)
    const normalizedTimeMode = timeMode === 'day' ? 'day' : (timeMode === 'year' ? 'year' : 'month')
    const sectionId = normalizedTimeMode === 'year'
      ? parts.yearLabel
      : normalizedTimeMode === 'day'
        ? parts.dayKey
        : parts.monthKey
    const sectionLabel = normalizedTimeMode === 'year'
      ? parts.yearLabel
      : normalizedTimeMode === 'day'
        ? parts.dayLabel
        : parts.monthLabel
    const actionKey = String(getActionKey(item) || 'other')
    const actionLabel = String(getActionLabel(item) || actionKey)

    const currentSection = sections.get(sectionId) || {
      id: sectionId,
      label: sectionLabel,
      sortTime: parts.date?.getTime?.() || 0,
      ids: [],
      groups: new Map(),
    }

    currentSection.ids.push(getItemId(item))

    const currentGroup = currentSection.groups.get(actionKey) || {
      id: `${sectionId}:${actionKey}`,
      actionKey,
      label: actionLabel,
      ids: [],
      items: [],
    }

    currentGroup.ids.push(getItemId(item))
    currentGroup.items.push(item)
    currentSection.groups.set(actionKey, currentGroup)
    sections.set(sectionId, currentSection)
  }

  return [...sections.values()]
    .sort((left, right) => right.sortTime - left.sortTime)
    .map((section) => ({
      id: section.id,
      label: section.label,
      ids: section.ids.filter((id) => id !== null && id !== undefined),
      groups: [...section.groups.values()].sort((left, right) => left.label.localeCompare(right.label)),
    }))
}

export function toggleIdSet(currentSet, ids = [], checked) {
  const next = new Set(currentSet || [])
  for (const id of ids) {
    if (id === null || id === undefined) continue
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}

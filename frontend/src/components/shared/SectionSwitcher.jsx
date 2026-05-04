import { useEffect, useMemo, useState } from 'react'

function readStoredSection(storageKey, fallback) {
  if (!storageKey || typeof window === 'undefined') return fallback
  try {
    return window.localStorage.getItem(storageKey) || fallback
  } catch (_) {
    return fallback
  }
}

export default function SectionSwitcher({
  options = [],
  value = 'all',
  onChange,
  storageKey = '',
  className = '',
  label = 'Sections',
}) {
  const safeOptions = useMemo(() => {
    const normalized = Array.isArray(options) ? options.filter(Boolean) : []
    const hasAll = normalized.some((option) => option.value === 'all')
    return hasAll ? normalized : [{ value: 'all', label: 'All' }, ...normalized]
  }, [options])
  const [internalValue, setInternalValue] = useState(() => readStoredSection(storageKey, value || 'all'))
  const activeValue = onChange ? value : internalValue

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    const stored = readStoredSection(storageKey, value || 'all')
    if (stored && stored !== activeValue && safeOptions.some((option) => option.value === stored)) {
      if (onChange) onChange(stored)
      else setInternalValue(stored)
    }
    // Only hydrate when the storage key/options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, safeOptions])

  const selectValue = (nextValue) => {
    const safeValue = safeOptions.some((option) => option.value === nextValue) ? nextValue : 'all'
    if (storageKey && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey, safeValue)
      } catch (_) {
        // Ignore private-mode storage failures; section navigation still works in memory.
      }
    }
    if (onChange) onChange(safeValue)
    else setInternalValue(safeValue)
  }

  return (
    <div className={`overflow-x-auto pb-1 ${className}`}>
      <div className="flex min-w-max items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <span className="px-2 font-semibold text-slate-400 dark:text-slate-500">{label}</span>
        {safeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`h-8 rounded-lg px-3 font-semibold transition ${activeValue === option.value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            title={option.hint || option.label}
            aria-pressed={activeValue === option.value}
            onClick={() => selectValue(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

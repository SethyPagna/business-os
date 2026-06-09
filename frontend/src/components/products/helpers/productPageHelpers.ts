import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])
  return debounced
}

export function parseBrandColorMap(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch (_) {
    return {}
  }
}

export function normalizeBrandLookup(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

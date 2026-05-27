import { useEffect, useState } from 'react'

export function useDebouncedValue(value, delayMs = 180) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])
  return debounced
}

export function parseBrandColorMap(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function normalizeBrandLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function waitForNextFrame() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve()
  }
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

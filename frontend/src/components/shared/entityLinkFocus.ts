/** Queue search/filter context for a guarded in-app entity link. */
export function queueEntitySearch(page: string, search: unknown, anchor?: string, focus?: Record<string, unknown>): void {
  const value = String(search ?? '').trim()
  if ((!value && !focus) || typeof window === 'undefined') return
  try {
    if (page === 'products') {
      window.sessionStorage.setItem('bos:dashboard:products-focus', JSON.stringify({ ...(focus || {}), ...(value ? { search: value } : {}) }))
      window.dispatchEvent(new CustomEvent('bos:entity-focus'))
      return
    }
    if (page === 'sales') {
      // A receipt number from another surface (the shift report's "changed
      // after close" list). Sales.tsx seeds its search and widens the date
      // range to all time, so the receipt is found whatever day it was rung.
      window.sessionStorage.setItem('bos:sales:focus', JSON.stringify({ ...(focus || {}), ...(value ? { search: value } : {}) }))
      window.dispatchEvent(new CustomEvent('bos:entity-focus'))
      return
    }
    if (page === 'contacts') {
      const section = String(anchor || '').split(':').pop() || 'customers'
      window.sessionStorage.setItem('bos:contacts:focus', JSON.stringify({ ...(focus || {}), tab: section, ...(value ? { search: value } : {}) }))
      window.dispatchEvent(new CustomEvent('bos:entity-focus'))
    }
  } catch {
    // Navigation remains useful even when storage is unavailable (private
    // browsing, quota exhaustion, or an embedded browser restriction).
  }
}

export default queueEntitySearch

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

import { useSyncExternalStore } from 'react'
import { isDocumentHidden } from './visibilityPolling.ts'

// Page visibility as React state: true while the browser tab is shown, false while it is hidden. Server render counts as shown.
export function subscribePageVisible(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

export const getPageVisible = (): boolean => !isDocumentHidden()

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribePageVisible, getPageVisible, () => true)
}

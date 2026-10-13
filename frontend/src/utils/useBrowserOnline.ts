import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

const read = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribe, read, () => true)
}

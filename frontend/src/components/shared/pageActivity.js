import { useMemo } from 'react'
import { useApp } from '../../AppContext'

export function useIsPageActive(pageId) {
  const { page } = useApp()
  return useMemo(() => page === pageId, [page, pageId])
}

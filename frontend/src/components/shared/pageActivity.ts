import { useMemo } from 'react'
import { useApp } from '../../AppContext'

type PageActivityContext = {
  page?: string
}

export function useIsPageActive(pageId: string): boolean {
  const { page } = useApp() as PageActivityContext
  return useMemo(() => page === pageId, [page, pageId])
}

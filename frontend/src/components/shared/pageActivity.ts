import { useMemo } from 'react'
// @ts-expect-error AppContext is still a JSX boundary in the TypeScript migration queue.
import { useApp } from '../../AppContext'

export function useIsPageActive(pageId: string): boolean {
  const { page } = useApp()
  return useMemo(() => page === pageId, [page, pageId])
}

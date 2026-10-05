import { useEffect, type RefObject } from 'react'

/**
 * The hub section row is one horizontally scrolling line below md, so the open
 * chip can start off-screen (a deep link, or the last section remembered).
 * Bring it into view whenever the active section changes.
 */
export function useActivePillScroll(rowRef: RefObject<HTMLElement | null>, active: string): void {
  useEffect(() => {
    const open = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    open?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [rowRef, active])
}

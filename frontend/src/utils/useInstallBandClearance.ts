import { useEffect, type RefObject } from 'react'

/** Read by the sign-in screen's bottom padding so a fixed band never hides the last link of the form. */
export const INSTALL_BAND_CLEARANCE_VAR = '--install-band-clearance'

/** Publishes how much of the screen bottom the band covers, safe area included, while it is mounted. A band pinned to the top covers none. */
export function useInstallBandClearance(bandRef: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    const band = bandRef.current
    if (!mounted || !band || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const publish = () => {
      const { top } = band.getBoundingClientRect()
      const pinnedToBottom = top > window.innerHeight / 2
      root.style.setProperty(INSTALL_BAND_CLEARANCE_VAR, `${pinnedToBottom ? Math.ceil(window.innerHeight - top) : 0}px`)
    }
    publish()
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null
    resizeObserver?.observe(band)
    window.addEventListener('resize', publish)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty(INSTALL_BAND_CLEARANCE_VAR)
    }
  }, [bandRef, mounted])
}

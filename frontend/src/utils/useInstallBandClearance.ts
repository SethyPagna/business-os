import { useEffect, type RefObject } from 'react'

/** Read by the sign-in screen's bottom padding so a fixed band never hides the last link of the form. */
export const INSTALL_BAND_CLEARANCE_VAR = '--install-band-clearance'

/** Publishes how much of the screen bottom the band covers, safe area included, for as long as it is mounted. */
export function useInstallBandClearance(bandRef: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    const band = bandRef.current
    if (!mounted || !band || typeof document === 'undefined') return undefined
    const root = document.documentElement
    const publish = () => {
      root.style.setProperty(INSTALL_BAND_CLEARANCE_VAR, `${Math.max(0, Math.ceil(window.innerHeight - band.getBoundingClientRect().top))}px`)
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

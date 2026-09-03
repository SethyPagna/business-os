import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { compareInitialKeys } from '../../utils/initials.ts'

export interface AlphaIndexRailProps {
  /** Letters/section keys that actually have data right now -- the rail only
   * renders these (sorted), so it never shows a letter with nothing behind
   * it. Grows/shrinks per page by design (Aug 22 2026 ask: "just show
   * characters that are available" -- supersedes the earlier always-show-
   * full-A-Z decision, which made rails on smaller catalogs look mostly
   * empty/disabled). */
  letters: string[]
  /** Called with the letter the user tapped or scrubbed to. Always one of
   * the letters actually present in `letters` -- see nearestAvailableLetter. */
  onJump: (letter: string) => void
  /** Accessible label for the rail (also used as the tap-scrub instruction). */
  label?: string
  className?: string
}

// "#" is the existing catch-all bucket (see utils/initials.ts's
// getInitialKey) for anything that isn't a letter/digit/Khmer character --
// kept as a recognized special key so it still sorts last when present, but
// (like every other letter) only actually renders if it's in `letters`.
const SPECIAL_LETTER = '#'

// Vertical A-Z jump-rail. Replaces the old horizontal per-page filter bars
// (see the removal note above this component's call sites in Products.tsx /
// Inventory.tsx): instead of narrowing the list to one letter, it scrolls to
// that letter's section while leaving the rest of the list visible.
//
// Desktop: fixed just to the right of the sidebar (which is a fixed 220px --
// see Sidebar.tsx -- so this rail sits at that same edge rather than
// floating disconnected from it). Mobile: sidebar is hidden (replaced by the
// bottom tab bar), so the rail moves to the right edge instead, clear of the
// bottom nav via safe-area padding.
//
// Supports both a single tap on a letter and a press-and-drag scrub across
// the whole rail (like iOS's contacts index) -- pointer events cover mouse,
// touch, and pen with one handler set, and pointer capture keeps the drag
// live even once the finger/cursor moves off the (intentionally narrow) hit
// area.
//
// Collapsed by default (a slim row of dots) so it doesn't compete with the
// page for attention; clicking/tapping/dragging it expands it to full
// letter labels for accurate targeting, and it now STAYS expanded -- no
// auto-collapse timer -- until the pointer actually leaves the rail (mouse
// hover-out) or the person clicks/taps anywhere else on the page. Previously
// this collapsed on a fixed 500ms timer after release regardless of whether
// the person was still looking at it or had moved on, which made a
// deliberate multi-glance use of the rail (tap a letter, read the section,
// come back to it) feel like it kept closing on its own.
export default function AlphaIndexRail({ letters, onJump, label, className = '' }: AlphaIndexRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // Separate from `dragging`/`activeLetter` -- this is the "stays big" state:
  // true from the moment the rail is first interacted with, false only once
  // the pointer leaves the rail or an outside click/tap closes it.
  const [stickyOpen, setStickyOpen] = useState(false)

  const availableSet = useMemo(
    () => new Set(Array.isArray(letters) ? letters.filter((letter) => typeof letter === 'string' && letter.length > 0) : []),
    [letters],
  )

  // Only the letters/keys that actually have data -- sorted the same way
  // the rest of the app orders initials, with "#" (if present) pinned last.
  const items = useMemo(() => {
    const rest = [...availableSet]
      .filter((letter) => letter !== SPECIAL_LETTER)
      .sort(compareInitialKeys)
    return availableSet.has(SPECIAL_LETTER) ? [...rest, SPECIAL_LETTER] : rest
  }, [availableSet])

  const expanded = dragging || stickyOpen

  // A tapped/dragged-to letter may not have any products today (that's the
  // whole point of always showing the full alphabet) -- fall back to the
  // closest letter on either side that does, so the rail is always
  // actionable even when the exact letter is empty.
  const nearestAvailableLetter = useCallback((letter: string | null): string | null => {
    if (!letter) return null
    if (availableSet.has(letter)) return letter
    const idx = items.indexOf(letter)
    if (idx === -1) return null
    for (let offset = 1; offset < items.length; offset++) {
      const before = items[idx - offset]
      const after = items[idx + offset]
      if (before && availableSet.has(before)) return before
      if (after && availableSet.has(after)) return after
    }
    return null
  }, [availableSet, items])

  const letterAtPoint = useCallback((clientY: number): string | null => {
    const node = railRef.current
    if (!node || items.length === 0) return null
    const rect = node.getBoundingClientRect()
    if (rect.height <= 0) return null
    const relative = Math.min(Math.max(clientY - rect.top, 0), rect.height - 1)
    const index = Math.floor((relative / rect.height) * items.length)
    return items[Math.min(Math.max(index, 0), items.length - 1)] ?? null
  }, [items])

  const jumpTo = useCallback((rawLetter: string | null) => {
    if (!rawLetter) return
    setStickyOpen(true)
    setActiveLetter(rawLetter)
    const target = nearestAvailableLetter(rawLetter)
    if (target) onJump(target)
  }, [nearestAvailableLetter, onJump])

  // Closes the rail immediately -- no fade timer -- used by both the
  // pointer-leave and click-outside paths below.
  const closeRail = useCallback(() => {
    setStickyOpen(false)
    setActiveLetter(null)
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true)
    jumpTo(letterAtPoint(event.clientY))
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [jumpTo, letterAtPoint])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    jumpTo(letterAtPoint(event.clientY))
  }, [dragging, jumpTo, letterAtPoint])

  // Release just ends the drag gesture -- it no longer collapses the rail
  // (that's now closeRail(), triggered only by pointer-leave/outside-click).
  const releaseDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDragging(false)
  }, [])

  // "Moving elsewhere" -- the mouse actually leaving the rail's own hit
  // area. Only wired up while not mid-drag (a drag already has its own
  // pointer-capture-driven move/up handling regardless of where the pointer
  // physically is).
  const handlePointerLeave = useCallback(() => {
    if (dragging) return
    closeRail()
  }, [dragging, closeRail])

  // "Click elsewhere" -- a pointerdown anywhere outside the rail's own DOM
  // node. Only listens while the rail is actually open, so this never adds
  // global listener overhead for the (default, most common) collapsed state.
  useEffect(() => {
    if (!stickyOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const node = railRef.current
      if (!node) return
      if (event.target instanceof Node && node.contains(event.target)) return
      closeRail()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [stickyOpen, closeRail])

  if (items.length === 0) return null

  return (
    <>
      <div
        ref={railRef}
        role="listbox"
        aria-label={label || 'Jump to letter'}
        aria-orientation="vertical"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseDrag}
        onPointerCancel={releaseDrag}
        onPointerLeave={handlePointerLeave}
        className={`fixed right-2 top-1/2 z-30 flex max-h-[calc(var(--app-vh-100)_*_.7)] -translate-y-1/2 touch-none select-none flex-col items-center justify-center rounded-full border border-gray-200 bg-white/90 shadow-md backdrop-blur-sm transition-[gap,padding] duration-150 dark:border-slate-700 dark:bg-slate-900/90 md:left-[228px] md:right-auto ${
          expanded ? 'gap-[1px] px-1 py-2' : 'gap-0 px-0.5 py-1.5'
        } ${className}`}
      >
        {items.map((letter) => {
          const isAvailable = availableSet.has(letter)
          const isActive = activeLetter === letter
          return (
            <span
              key={letter}
              role="option"
              aria-selected={isActive}
              aria-disabled={!isAvailable}
              // "Bigger" meant this rail's own letters, slightly larger --
              // not a separate floating duplicate of the current letter (the
              // bubble this replaced). Feedback for where the finger/cursor
              // landed now comes from the active letter itself growing in
              // place (scale) instead of a second element elsewhere on
              // screen showing the same character twice.
              className={`flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold leading-none transition-all duration-150 ${
                expanded ? 'h-5 w-6 text-xs' : 'h-1 w-1 text-[0px]'
              } ${isActive ? 'scale-125' : ''} ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : isAvailable
                    ? 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
                    : 'text-gray-300 dark:text-slate-700'
              }`}
            >
              {expanded ? letter : ''}
            </span>
          )
        })}
      </div>
    </>
  )
}

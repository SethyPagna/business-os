import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import FileClock from 'lucide-react/dist/esm/icons/file-clock.js'
import type { MinimizedWorkEntry } from '../../utils/minimizedWork.ts'
import MinimizedWorkDismissButton, { type MinimizedWorkTr } from './MinimizedWorkDismissButton.tsx'

// The phone half of MinimizedWorkTray (KNOWN-136). The phone header scrolls
// away or folds into a closed menu, so parked work looked lost in portrait;
// this chip is fixed to the viewport instead. It lives in its own lazy chunk
// (the tray shell requests it only while a draft is parked on a phone) so the
// public catalog budget does not pay for drag, clamp and the list.

export const DRAFT_CHIP_POSITION_KEY = 'bos.draftChipPos'
export const DRAFT_CHIP_DRAG_THRESHOLD_PX = 6
export const DRAFT_CHIP_NUDGE_PX = 8
const DRAFT_CHIP_EDGE_PX = 8
const TOP_BAR_PX = 64
const BOTTOM_NAV_PX = 56

export type DraftChipPoint = { x: number; y: number }
export type DraftChipInsets = { top: number; right: number; bottom: number; left: number }
export type DraftChipBounds = { minX: number; maxX: number; minY: number; maxY: number }

/** The box the chip may occupy: below the phone top bar, above the bottom nav, inside the safe areas. */
export function draftChipBounds(input: {
  viewport: { width: number; height: number }
  chip: { width: number; height: number }
  insets: DraftChipInsets
  headerBottom: number | null
  navTop: number | null
}): DraftChipBounds {
  const { viewport, chip, insets } = input
  const top = input.headerBottom != null && input.headerBottom > 0 ? input.headerBottom : TOP_BAR_PX + insets.top
  const bottom = input.navTop != null && input.navTop > 0 ? input.navTop : viewport.height - BOTTOM_NAV_PX - insets.bottom
  const minX = insets.left + DRAFT_CHIP_EDGE_PX
  const minY = Math.max(top, insets.top) + DRAFT_CHIP_EDGE_PX
  const maxX = Math.max(minX, viewport.width - insets.right - DRAFT_CHIP_EDGE_PX - chip.width)
  const maxY = Math.max(minY, bottom - DRAFT_CHIP_EDGE_PX - chip.height)
  return { minX, maxX, minY, maxY }
}

export function clampDraftChipPosition(point: DraftChipPoint, bounds: DraftChipBounds): DraftChipPoint {
  return {
    x: Math.round(Math.min(bounds.maxX, Math.max(bounds.minX, point.x))),
    y: Math.round(Math.min(bounds.maxY, Math.max(bounds.minY, point.y))),
  }
}

// Bottom centre: the right edge holds the scroll buttons and the import
// tracker, the left edge the notes launcher, and the middle is free.
export function draftChipDefaultPosition(bounds: DraftChipBounds): DraftChipPoint {
  return { x: Math.round((bounds.minX + bounds.maxX) / 2), y: bounds.maxY }
}

export function draftChipMovedPastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > DRAFT_CHIP_DRAG_THRESHOLD_PX
}

type DraftChipStorage = Pick<Storage, 'getItem' | 'setItem'>
// Touching window.localStorage itself throws on iOS with site data blocked.
const browserStorage = (): DraftChipStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readDraftChipPosition(storage: () => DraftChipStorage | null = browserStorage): DraftChipPoint | null {
  try {
    const saved = JSON.parse(storage()?.getItem(DRAFT_CHIP_POSITION_KEY) || 'null') as Partial<DraftChipPoint> | null
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: Number(saved.x), y: Number(saved.y) } : null
  } catch {
    return null
  }
}

export function writeDraftChipPosition(point: DraftChipPoint, storage: () => DraftChipStorage | null = browserStorage): void {
  try {
    storage()?.setItem(DRAFT_CHIP_POSITION_KEY, JSON.stringify({ x: point.x, y: point.y }))
  } catch {
    // Private mode or blocked storage: the chip still works, it just forgets where it was.
  }
}

function readSafeAreaInsets(): DraftChipInsets {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const insets = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  }
  probe.remove()
  return insets
}

function measureDraftChipBounds(chip: HTMLElement): DraftChipBounds {
  const header = document.querySelector<HTMLElement>('[data-bos-mobile-header]')
  // offsetTop ignores the scroll-away transform, so the chip never parks where the header returns to.
  const headerBottom = header ? Math.max(header.getBoundingClientRect().bottom, header.offsetTop + header.offsetHeight) : null
  const nav = document.querySelector<HTMLElement>('nav.safe-area-inset-bottom')
  const navRect = nav?.getBoundingClientRect()
  return draftChipBounds({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    chip: { width: chip.offsetWidth, height: chip.offsetHeight },
    insets: readSafeAreaInsets(),
    headerBottom,
    navTop: navRect && navRect.height > 0 ? navRect.top : null,
  })
}

export default function DraftChipFloat({ entries, restore, requestDismiss, holdOpen, tr }: {
  entries: MinimizedWorkEntry[]
  restore: (entry: MinimizedWorkEntry) => void
  requestDismiss: (entry: MinimizedWorkEntry) => void
  /** True while the discard prompt is up: a tap in it must not close the list underneath. */
  holdOpen: boolean
  tr: MinimizedWorkTr
}) {
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: DraftChipPoint; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const holdOpenRef = useRef(holdOpen)
  holdOpenRef.current = holdOpen
  const [position, setPosition] = useState<DraftChipPoint | null>(() => readDraftChipPosition())
  const [placed, setPlaced] = useState(false)
  const [open, setOpen] = useState(false)

  const clampToViewport = useCallback((point: DraftChipPoint | null): DraftChipPoint | null => {
    const chip = chipRef.current
    if (!chip) return point
    const bounds = measureDraftChipBounds(chip)
    return clampDraftChipPosition(point ?? draftChipDefaultPosition(bounds), bounds)
  }, [])

  useLayoutEffect(() => {
    setPosition((current) => clampToViewport(current))
    setPlaced(true)
  }, [clampToViewport, entries.length])

  useEffect(() => {
    const reclamp = () => setPosition((current) => clampToViewport(current))
    window.addEventListener('resize', reclamp)
    window.addEventListener('orientationchange', reclamp)
    return () => {
      window.removeEventListener('resize', reclamp)
      window.removeEventListener('orientationchange', reclamp)
    }
  }, [clampToViewport])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (holdOpenRef.current) return
      const target = event.target as Node | null
      if (target && (popoverRef.current?.contains(target) || chipRef.current?.contains(target))) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !holdOpenRef.current) setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const moveTo = (point: DraftChipPoint, persist: boolean) => {
    const next = clampToViewport(point)
    if (!next) return
    setPosition(next)
    if (persist) writeDraftChipPosition(next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!position || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && !draftChipMovedPastThreshold(dx, dy)) return
    drag.moved = true
    moveTo({ x: drag.origin.x + dx, y: drag.origin.y + dy }, false)
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.moved) return
    suppressClickRef.current = true
    moveTo({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY }, true)
  }
  const onClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    setOpen((value) => !value)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!step || !position) return
    event.preventDefault()
    moveTo({ x: position.x + step[0] * DRAFT_CHIP_NUDGE_PX, y: position.y + step[1] * DRAFT_CHIP_NUDGE_PX }, true)
  }

  const draftLabel = tr('draft_chip', 'Draft', 'សេចក្ដីព្រាង')
  const countedLabel = `${draftLabel} ${entries.length}`
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const chipHeight = chipRef.current?.offsetHeight ?? 44
  const chipWidth = chipRef.current?.offsetWidth ?? 96
  const opensUp = position ? position.y + chipHeight / 2 > viewportHeight / 2 : true
  const listWidth = Math.min(256, viewportWidth - 16)
  const listLeft = position ? Math.min(Math.max(8, position.x + chipWidth / 2 - listWidth / 2), viewportWidth - 8 - listWidth) : 8

  const floating = (
    <div data-draft-chip-float="" className="md:hidden">
      <button
        ref={chipRef}
        type="button"
        data-draft-chip=""
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={countedLabel}
        title={countedLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onClick}
        onKeyDown={onKeyDown}
        style={{ left: position?.x ?? 0, top: position?.y ?? 0, visibility: placed && position ? 'visible' : 'hidden', touchAction: 'none' }}
        className="fixed z-[60] flex h-11 select-none items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 pl-3 pr-3.5 text-sm font-semibold leading-relaxed text-amber-900 shadow-lg shadow-amber-900/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100"
      >
        <FileClock className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{draftLabel}</span>
        <span className="min-w-5 rounded-full bg-amber-600 px-1.5 text-center text-xs font-bold leading-5 text-white dark:bg-amber-400 dark:text-amber-950">{entries.length}</span>
      </button>
      {open && position ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={draftLabel}
          data-draft-chip-popover=""
          style={{
            ...(opensUp ? { bottom: viewportHeight - position.y + 8 } : { top: position.y + chipHeight + 8 }),
            left: listLeft,
          }}
          className="fixed z-[60] w-64 max-w-[calc(100vw-1rem)] space-y-1 rounded-xl border border-amber-200 bg-white p-1.5 shadow-xl dark:border-amber-800 dark:bg-slate-900"
        >
          {entries.map((entry) => (
            <div key={entry.key} className="flex min-w-0 items-center gap-1 rounded-lg bg-amber-50 pl-2.5 dark:bg-amber-900/30">
              <button
                type="button"
                onClick={() => { setOpen(false); restore(entry) }}
                className="min-h-10 min-w-0 flex-1 text-left text-sm font-medium leading-relaxed text-amber-900 dark:text-amber-100"
                title={`${tr('restore', 'Restore', 'ស្ដារ')} — ${entry.label}`}
              >
                <span className="detail-scroll-text">{entry.label}</span>
              </button>
              <MinimizedWorkDismissButton onDismiss={() => requestDismiss(entry)} tr={tr} large />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(floating, document.body)
}

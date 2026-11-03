import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { RAIL_SELECTED_SELECTOR, railEdges, railRevealTarget } from './chipRailMath.ts'

// The one horizontal row of choices (owner, 2 Nov 2026: the option chips and the date presets
// "are different"). Section chips, date presets, tabs, segmented toggles and filter pickers all
// sit in a ChipRail, and every chip in it is a RailChip, so height, gap, radius, font, selected
// state and scroll behaviour come from one place (the `.chip-rail*` rules in styles/main.css).
//
// Scrolling is built in and invisible: no scrollbar, a soft fade on whichever edge still has
// content, touch and trackpad pan natively, a mouse drags (runtime/horizontalDragScroll.ts) and
// the keyboard moves between chips with the arrow keys. The selected chip and the focused chip
// are scrolled into view, so the open choice is never the one off-screen.

export const CHIP_RAIL_ITEM_SELECTOR = '.chip-rail-item'

function setFlag(el: HTMLElement, name: 'data-fade-start' | 'data-fade-end', on: boolean): void {
  const value = on ? 'true' : 'false'
  if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

function syncEdges(el: HTMLElement): void {
  const edges = railEdges(el.scrollLeft, el.scrollWidth, el.clientWidth)
  setFlag(el, 'data-fade-start', edges.start)
  setFlag(el, 'data-fade-end', edges.end)
}

function fadeWidth(el: HTMLElement): number {
  const raw = typeof getComputedStyle === 'function' ? getComputedStyle(el).getPropertyValue('--chip-rail-fade') : ''
  const rem = Number.parseFloat(raw)
  return Number.isFinite(rem) ? rem * 16 : 16
}

function revealChip(rail: HTMLElement, chip: HTMLElement): void {
  if (typeof rail.getBoundingClientRect !== 'function' || typeof chip.getBoundingClientRect !== 'function') return
  const railBox = rail.getBoundingClientRect()
  const chipBox = chip.getBoundingClientRect()
  if (railBox.width === 0) return
  const left = chipBox.left - railBox.left + rail.scrollLeft
  const target = railRevealTarget(rail.scrollLeft, rail.clientWidth, left, chipBox.width, fadeWidth(rail))
  if (target !== rail.scrollLeft) rail.scrollLeft = target
}

export type ChipRailProps = Omit<HTMLAttributes<HTMLDivElement>, 'role'> & {
  /** Accessible name of the row, already translated. */
  label: string
  role?: 'group' | 'tablist' | 'toolbar'
  /** Chips share the row equally while it fits (the phone tab strip); it still scrolls when it does not. */
  stretch?: boolean
  children: ReactNode
}

export default function ChipRail({ label, role = 'group', stretch = false, className = '', children, onKeyDown, ...rest }: ChipRailProps) {
  const ref = useRef<HTMLDivElement>(null)
  const revealedRef = useRef<Element | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const sync = () => syncEdges(el)
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
    const watchChildren = () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver.observe(el)
        for (const child of Array.from(el.children)) resizeObserver.observe(child)
      }
      sync()
    }
    watchChildren()
    const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(watchChildren) : null
    mutationObserver?.observe(el, { childList: true })
    el.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      el.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const selected = el.querySelector<HTMLElement>(RAIL_SELECTED_SELECTOR)
    if (selected === revealedRef.current) return
    revealedRef.current = selected
    if (selected) revealChip(el, selected)
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    const { key } = event
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
    const el = ref.current
    const current = (event.target as HTMLElement).closest?.(CHIP_RAIL_ITEM_SELECTOR)
    if (!el || !current) return
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>(CHIP_RAIL_ITEM_SELECTOR)).filter((chip) => !chip.hasAttribute('disabled'))
    const index = chips.indexOf(current as HTMLButtonElement)
    if (index < 0) return
    const next = key === 'Home' ? 0 : key === 'End' ? chips.length - 1 : index + (key === 'ArrowRight' ? 1 : -1)
    const chip = chips[Math.max(0, Math.min(chips.length - 1, next))]
    if (!chip) return
    event.preventDefault()
    chip.focus()
    revealChip(el, chip)
  }

  return (
    <div
      {...rest}
      ref={ref}
      role={role}
      aria-label={label}
      data-chip-rail=""
      onKeyDown={handleKeyDown}
      className={`chip-rail${stretch ? ' chip-rail-stretch' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}

export type RailChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role'> & {
  /** Omit for a chip that only acts (no remembered choice); pass true/false for a toggle or an option. */
  selected?: boolean
  /** Inside a `tablist`: role=tab with aria-selected instead of a toggle button with aria-pressed. */
  tab?: boolean
  icon?: ReactNode
  badge?: ReactNode
}

export function RailChip({ selected, tab = false, icon, badge, className = '', children, ...rest }: RailChipProps) {
  const state = tab ? { role: 'tab' as const, 'aria-selected': Boolean(selected) } : selected === undefined ? {} : { 'aria-pressed': selected }
  return (
    <button type="button" {...rest} {...state} className={`chip-rail-item${className ? ` ${className}` : ''}`}>
      {icon}
      {children}
      {badge}
    </button>
  )
}

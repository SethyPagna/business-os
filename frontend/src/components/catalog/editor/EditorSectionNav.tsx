import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js'
import Megaphone from 'lucide-react/dist/esm/icons/megaphone.js'
import Palette from 'lucide-react/dist/esm/icons/palette.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import EditorIconButton from './EditorIconButton.tsx'
import type { EditorSectionDef, EditorSectionIcon, EditorSectionId } from './editorSections.ts'
import type { EditorText } from './editorText.ts'

type SectionIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
const ICONS: Record<EditorSectionIcon, SectionIcon> = {
  palette: Palette,
  phone: Phone,
  'shopping-bag': ShoppingBag,
  megaphone: Megaphone,
  store: Store,
  'help-circle': HelpCircle,
  'layout-grid': LayoutGrid,
}

type EditorSectionNavProps = {
  ed: EditorText
  /** Phone width (below 768 px): one picker. From 768 px: the chips. */
  compact: boolean
  /** The sections this person can see, in order. */
  sections: readonly EditorSectionDef[]
  active: EditorSectionId
  dirty: ReadonlySet<EditorSectionId>
  /** The seller details the storefront's legal pages print are incomplete: an amber marker on Contact. */
  sellerMissing: boolean
  onSelect: (id: EditorSectionId) => void
}

type MarkerProps = Pick<EditorSectionNavProps, 'ed'> & { dirty: boolean; amber: boolean }

// Two markers that differ in colour AND shape (a blue dot, an amber triangle), each with text for a screen reader.
function Markers({ ed, dirty, amber }: MarkerProps) {
  return (
    <>
      {dirty ? (
        <>
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-sky-600 dark:bg-sky-400" />
          <span className="sr-only">{ed('web_editor_unsaved', 'Unsaved changes', 'មិនទាន់រក្សាទុក')}</span>
        </>
      ) : null}
      {amber ? (
        <>
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
          <span className="sr-only">{ed('web_editor_seller_missing', 'Seller details missing', 'ខ្វះព័ត៌មានអ្នកលក់')}</span>
        </>
      ) : null}
    </>
  )
}

export default function EditorSectionNav(props: EditorSectionNavProps) {
  return props.compact ? <SectionPicker {...props} /> : <SectionChips {...props} />
}

// ---- below 768 px: one button that opens the list of seven ------------------------------------------------------------

type MenuPlace = { top: number; left: number; minWidth: number }

function SectionPicker({ ed, sections, active, dirty, sellerMissing, onSelect }: EditorSectionNavProps) {
  const [place, setPlace] = useState<MenuPlace | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = place !== null
  const current = sections.find((section) => section.id === active) ?? sections[0]
  const currentLabel = ed(...current.label)
  const CurrentIcon = ICONS[current.icon]

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPlace({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width })
  }
  const closeMenu = (returnFocus: boolean) => {
    setPlace(null)
    if (returnFocus) buttonRef.current?.focus()
  }

  // The menu is fixed to the screen at the button's place, so a scroll or a resize would leave it behind: either closes it, as does a press elsewhere.
  useEffect(() => {
    if (!open) return undefined
    const away = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setPlace(null)
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))) return
      setPlace(null)
    }
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    window.addEventListener('pointerdown', outside, true)
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    return () => {
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('pointerdown', outside, true)
    }
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }
    if (event.key === 'Tab') {
      closeMenu(false)
      return
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
    const at = items.indexOf(document.activeElement as HTMLElement)
    const target = event.key === 'ArrowDown' ? items[(at + 1) % items.length]
      : event.key === 'ArrowUp' ? items[(at - 1 + items.length) % items.length]
        : event.key === 'Home' ? items[0]
          : event.key === 'End' ? items[items.length - 1] : null
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  return (
    <div className="min-w-0 flex-1">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${ed('web_editor_sections', 'Sections', 'ផ្នែក')}: ${currentLabel}`}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-semibold leading-snug text-slate-900 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        onClick={() => (open ? closeMenu(false) : openMenu())}
      >
        <CurrentIcon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">{currentLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        <Markers ed={ed} dirty={dirty.has(current.id)} amber={sellerMissing && current.id === 'contact'} />
      </button>
      {place ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ed('web_editor_sections', 'Sections', 'ផ្នែក')}
          style={{ top: place.top, left: place.left, minWidth: place.minWidth }}
          className="fixed z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          onKeyDown={onMenuKeyDown}
        >
          {sections.map((section) => {
            const Icon = ICONS[section.icon]
            const checked = section.id === active
            return (
              <button
                key={section.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-editor-section={section.id}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-1 text-left text-sm font-medium leading-snug ${checked ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                onClick={() => {
                  closeMenu(true)
                  onSelect(section.id)
                }}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{ed(...section.label)}</span>
                <Markers ed={ed} dirty={dirty.has(section.id)} amber={sellerMissing && section.id === 'contact'} />
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

// ---- from 768 px: the seven as tabs, the open one with its word --------------------------------------------------------

// 44 px for a finger (phones, tablets), 40 px where a mouse is the pointer.
const CHIP_SIZE = 'min-h-11 [@media(pointer:fine)]:min-h-10'
const CHIP_LOOK = 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'

function SectionChips({ ed, sections, active, dirty, sellerMissing, onSelect }: EditorSectionNavProps) {
  const chips = useRef(new Map<EditorSectionId, HTMLElement>())

  // Arrow keys, Home and End move between the tabs and open the one reached: opening costs no request, so focus and selection travel together.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = sections.findIndex((section) => section.id === active)
    const next = event.key === 'ArrowRight' ? (at + 1) % sections.length
      : event.key === 'ArrowLeft' ? (at - 1 + sections.length) % sections.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? sections.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    const target = sections[next]
    onSelect(target.id)
    chips.current.get(target.id)?.focus()
  }

  return (
    <div role="tablist" aria-label={ed('web_editor_sections', 'Sections', 'ផ្នែក')} className="flex min-w-0 flex-1 items-center gap-1" onKeyDown={onKeyDown}>
      {sections.map((section) => {
        const Icon = ICONS[section.icon]
        const marks = <Markers ed={ed} dirty={dirty.has(section.id)} amber={sellerMissing && section.id === 'contact'} />
        const bind = (node: HTMLElement | null) => {
          if (node) chips.current.set(section.id, node)
          else chips.current.delete(section.id)
        }
        if (section.id === active) {
          return (
            <button
              key={section.id}
              ref={bind}
              type="button"
              role="tab"
              aria-selected
              aria-controls={section.domId}
              tabIndex={0}
              data-editor-section={section.id}
              className={`inline-flex ${CHIP_SIZE} shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-slate-950 px-3 py-1 text-sm font-semibold leading-snug text-white shadow-sm dark:bg-white dark:text-slate-950`}
              onClick={() => onSelect(section.id)}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{ed(...section.label)}</span>
              {marks}
            </button>
          )
        }
        return (
          <EditorIconButton
            key={section.id}
            ref={bind}
            role="tab"
            aria-selected={false}
            aria-controls={section.domId}
            tabIndex={-1}
            data-editor-section={section.id}
            icon={Icon}
            label={ed(...section.label)}
            badge={marks}
            className={`relative inline-flex ${CHIP_SIZE} min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 ${CHIP_LOOK} [@media(pointer:fine)]:min-w-10`}
            onClick={() => onSelect(section.id)}
          />
        )
      })}
    </div>
  )
}

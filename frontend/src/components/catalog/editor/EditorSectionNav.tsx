import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Images from 'lucide-react/dist/esm/icons/images.js'
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js'
import Megaphone from 'lucide-react/dist/esm/icons/megaphone.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import EditorIconButton from './EditorIconButton.tsx'
import { SECTION_PICKER_ID, sectionTabId, type EditorSectionDef, type EditorSectionIcon, type EditorSectionId } from './editorSections.ts'
import type { EditorText } from './editorText.ts'

type SectionIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
const ICONS: Record<EditorSectionIcon, SectionIcon> = {
  images: Images,
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

// The words for the two markers ('' when a marker is off): the dot and the triangle are drawn, never the only carrier of the meaning.
type MarkerWords = { unsaved: string; seller: string }
const markerWords = (ed: EditorText, dirty: boolean, amber: boolean): MarkerWords => ({
  unsaved: dirty ? ed('web_editor_unsaved', 'Unsaved changes', 'មិនទាន់រក្សាទុក') : '',
  seller: amber ? ed('web_editor_seller_missing', 'Seller details missing', 'ខ្វះព័ត៌មានអ្នកលក់') : '',
})
// A control named by an aria-label (the picker button, a closed tab) loses its inner text, so its markers' words join the name: "FAQ, Unsaved changes".
const nameWithMarkers = (name: string, { unsaved, seller }: MarkerWords): string => [name, unsaved, seller].filter(Boolean).join(', ')

// Two markers that differ in colour AND shape (a blue dot, an amber triangle), each with text for a screen reader.
function Markers({ unsaved, seller }: MarkerWords) {
  return (
    <>
      {unsaved ? (
        <>
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-sky-600 dark:bg-sky-400" />
          <span className="sr-only">{unsaved}</span>
        </>
      ) : null}
      {seller ? (
        <>
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400" />
          <span className="sr-only">{seller}</span>
        </>
      ) : null}
    </>
  )
}

type InnerProps = EditorSectionNavProps & { sectionsLabel: string }

export default function EditorSectionNav(props: EditorSectionNavProps) {
  const sectionsLabel = props.ed('web_editor_sections', 'Sections', 'ផ្នែក')
  return props.compact ? <SectionPicker {...props} sectionsLabel={sectionsLabel} /> : <SectionChips {...props} sectionsLabel={sectionsLabel} />
}

// ---- below 768 px: one button that opens the list of seven ------------------------------------------------------------

function SectionPicker({ ed, sections, active, dirty, sellerMissing, onSelect, sectionsLabel }: InnerProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = sections.find((section) => section.id === active) ?? sections[0]
  const currentLabel = ed(...current.label)
  const CurrentIcon = ICONS[current.icon]
  const currentMarks = markerWords(ed, dirty.has(current.id), sellerMissing && current.id === 'contact')

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  // The menu hangs from the button (absolute, inside a relative wrapper), so it moves with the bar however the page shifts under it: a scroll, a
  // header that collapses, a resize. (Fixed to the screen at the button's measured place, it closed on every scroll event, and a collapsing app
  // header moves the bar without firing one.) A press elsewhere closes it.
  useEffect(() => {
    if (!open) return undefined
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target))) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', outside, true)
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    return () => window.removeEventListener('pointerdown', outside, true)
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
      <div className="relative inline-flex max-w-full align-top">
        <button
          ref={buttonRef}
          id={SECTION_PICKER_ID}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={nameWithMarkers(`${sectionsLabel}: ${currentLabel}`, currentMarks)}
          className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1 max-[359px]:gap-1.5 max-[359px]:px-2 text-sm font-semibold leading-snug text-slate-900 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          onClick={() => (open ? closeMenu(false) : setOpen(true))}
        >
          <CurrentIcon className="h-5 w-5 shrink-0" aria-hidden />
          {/* The one part that gives way when the row is short: the word ends in an ellipsis, while the section icon, the chevron and the
              markers (the dot is the only sign of unsaved work in this section) keep their room. py-1 because overflow:hidden clips at the line
              box, and Khmer vowel signs and subscripts stand outside a box sized for Latin text. */}
          <span className="min-w-0 truncate py-1">{currentLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          <Markers {...currentMarks} />
        </button>
        {open ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={sectionsLabel}
            className="absolute left-0 top-full z-40 mt-1 max-h-[calc(70*var(--app-vh))] w-max min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
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
                  <Markers {...markerWords(ed, dirty.has(section.id), sellerMissing && section.id === 'contact')} />
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ---- from 768 px: the seven as tabs, the open one with its word --------------------------------------------------------

// 44 px for a finger (phones, tablets), 40 px where a mouse is the pointer.
const CHIP_SIZE = 'min-h-11 [@media(pointer:fine)]:min-h-10'
const CHIP_LOOK = 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'

function SectionChips({ ed, sections, active, dirty, sellerMissing, onSelect, sectionsLabel }: InnerProps) {
  const chips = useRef(new Map<EditorSectionId, HTMLElement>())
  const focusAfterSelect = useRef(false)

  // The open tab is a different element from a closed one (it carries its word), so selecting remounts the tab being reached.
  // Focus therefore moves after the commit, to the tab that is now open.
  useEffect(() => {
    if (!focusAfterSelect.current) return
    focusAfterSelect.current = false
    chips.current.get(active)?.focus()
  }, [active])

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
    if (target.id === active) {
      chips.current.get(active)?.focus()
      return
    }
    focusAfterSelect.current = true
    onSelect(target.id)
  }

  return (
    <div role="tablist" aria-label={sectionsLabel} className="flex min-w-0 flex-1 items-center gap-1" onKeyDown={onKeyDown}>
      {sections.map((section) => {
        const Icon = ICONS[section.icon]
        const words = markerWords(ed, dirty.has(section.id), sellerMissing && section.id === 'contact')
        const marks = <Markers {...words} />
        const bind = (node: HTMLElement | null) => {
          if (node) chips.current.set(section.id, node)
          else chips.current.delete(section.id)
        }
        if (section.id === active) {
          return (
            <button
              key={section.id}
              ref={bind}
              id={sectionTabId(section.id)}
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
            id={sectionTabId(section.id)}
            role="tab"
            aria-selected={false}
            aria-controls={section.domId}
            tabIndex={-1}
            data-editor-section={section.id}
            icon={Icon}
            label={nameWithMarkers(ed(...section.label), words)}
            badge={marks}
            className={`relative inline-flex ${CHIP_SIZE} min-w-11 shrink-0 items-center justify-center gap-1 rounded-full px-2 ${CHIP_LOOK} [@media(pointer:fine)]:min-w-10`}
            onClick={() => onSelect(section.id)}
          />
        )
      })}
    </div>
  )
}

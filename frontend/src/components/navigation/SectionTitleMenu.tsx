import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_TITLE_MENU_Z } from '../../utils/mobileNavChrome.ts'

/** Gap between the title button and the dropdown under it, in px. */
const MENU_GAP = 4

export type SectionTitleMenuItem = { id: string; label: string }

type Props = {
  page: string
  title: string
  sections: readonly SectionTitleMenuItem[]
  currentId: string
  menuLabel: string
  onSelect: (id: string) => void
}

/** The mobile top bar's page title. With two or more sections it is a button: tap to open a small
 *  dropdown of the subpage titles anchored under the title, tap again (or Esc, or tap outside) to
 *  close. The dropdown floats over the page and is sized to its list only: the bar keeps its height,
 *  background and layout. Fewer than two sections, plain text. */
export default function SectionTitleMenu({ page, title, sections, currentId, menuLabel, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  // Where the dropdown sits, measured from the title button at the moment it opens so the very
  // first render of the open list is already in place (no stub, no jump).
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const byKeyboard = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const interactive = sections.length > 1

  const measure = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setAnchor({ left: rect.left, top: rect.bottom + MENU_GAP })
  }
  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  useEffect(() => { setOpen(false) }, [page, currentId])
  useEffect(() => { if (!interactive) setOpen(false) }, [interactive])

  useEffect(() => {
    if (!open) return
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[data-bos-title-menu-item]') || [])
    const list = items()
    if (byKeyboard.current) (list.find((item) => item.getAttribute('aria-current') === 'page') || list[0])?.focus()
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close(true)
    }
    // The bar is fixed, so only a resize / rotation can move the title under an open list.
    const onResize = () => measure()
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[data-bos-title-menu-item]') || [])
    const at = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Tab') { event.preventDefault(); close(true); return }
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null
    if (next === null || !list.length) return
    event.preventDefault()
    list[(next + list.length) % list.length].focus()
  }

  const titleClass = 'bos-nav-title min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm font-semibold [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
  if (!interactive) return <div className={titleClass} title={title} tabIndex={0}>{title}</div>

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-bos-title-menu={page}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="mobile-section-menu"
        onClick={(event) => {
          byKeyboard.current = event.detail === 0
          if (!open) measure()
          setOpen((value) => !value)
        }}
        className="bos-nav-title-button flex min-h-11 min-w-0 flex-1 items-center rounded-lg px-2 text-left"
      >
        <span className="bos-nav-title min-w-0 overflow-x-auto whitespace-nowrap py-1 text-sm font-semibold leading-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">{title}</span>
      </button>
      {open && anchor ? createPortal(
        <div className="bos-nav-chrome" data-bos-title-menu-layer>
          {/* Transparent catcher: a tap anywhere outside the list closes it. */}
          <div className="fixed inset-0" style={{ zIndex: SECTION_TITLE_MENU_Z }} onClick={() => close(true)} />
          <div
            ref={menu}
            id="mobile-section-menu"
            role="menu"
            aria-label={menuLabel}
            onKeyDown={move}
            style={{ left: anchor.left, top: anchor.top, zIndex: SECTION_TITLE_MENU_Z + 1, maxHeight: `calc(100dvh - ${anchor.top}px - ${MENU_GAP}px)` }}
            className="bos-nav-subpages fixed w-max min-w-[11rem] max-w-[calc(100vw-1rem)] overflow-y-auto"
          >
            {sections.map((section) => {
              const current = section.id === currentId
              return (
                <button
                  key={section.id}
                  type="button"
                  role="menuitem"
                  aria-current={current ? 'page' : undefined}
                  data-bos-title-menu-item={section.id}
                  onClick={() => { setOpen(false); onSelect(section.id) }}
                  className={`bos-nav-subpage flex min-h-11 w-full items-center text-left text-sm leading-normal ${current ? 'is-active' : ''}`}
                >
                  <span className="min-w-0 break-words py-1">{section.label}</span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

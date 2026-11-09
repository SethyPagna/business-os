import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_TITLE_MENU_Z } from '../../utils/mobileNavChrome.ts'

export type SectionTitleMenuItem = { id: string; label: string }

type Props = {
  page: string
  title: string
  sections: readonly SectionTitleMenuItem[]
  currentId: string
  menuLabel: string
  /** Distance from the viewport top to the bottom edge of the fixed bar. */
  top: string
  onSelect: (id: string) => void
}

/** The mobile top bar's page title. With two or more sections it is a button: tap to expand the
 *  subpage titles as plain text under the bar, tap again to collapse. Fewer than two, plain text. */
export default function SectionTitleMenu({ page, title, sections, currentId, menuLabel, top, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const byKeyboard = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const interactive = sections.length > 1

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
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[data-bos-title-menu-item]') || [])
    const at = list.indexOf(document.activeElement as HTMLElement)
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
        aria-controls="mobile-section-menu"
        onClick={(event) => { byKeyboard.current = event.detail === 0; setOpen((value) => !value) }}
        className="bos-nav-title-button flex min-h-11 min-w-0 flex-1 items-center rounded-lg px-2 text-left"
      >
        <span className="bos-nav-title min-w-0 overflow-x-auto whitespace-nowrap py-1 text-sm font-semibold leading-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">{title}</span>
      </button>
      {open ? createPortal(
        <div className="bos-nav-chrome" data-bos-title-menu-layer>
          <div className="fixed inset-0 md:hidden" style={{ zIndex: SECTION_TITLE_MENU_Z }} onClick={() => setOpen(false)} />
          <div
            ref={menu}
            id="mobile-section-menu"
            role="group"
            aria-label={menuLabel}
            onKeyDown={move}
            style={{ top, zIndex: SECTION_TITLE_MENU_Z + 1, maxHeight: `calc(100dvh - ${top})` }}
            className="bos-nav-subpages fixed left-0 right-0 overflow-y-auto pb-2 pl-[calc(3.75rem+env(safe-area-inset-left))] pr-3 md:hidden"
          >
            {sections.map((section) => {
              const current = section.id === currentId
              return (
                <button
                  key={section.id}
                  type="button"
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

import { cloneElement, isValidElement, useCallback, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PortalMenuProps } from './PortalMenu'

type PortalMenuComponent = typeof import('./PortalMenu').default

export default function LazyPortalMenu(props: PortalMenuProps) {
  const portalMenuPromiseRef = useRef<Promise<PortalMenuComponent> | null>(null)
  const [PortalMenu, setPortalMenu] = useState<PortalMenuComponent | null>(null)
  const [openOnLoad, setOpenOnLoad] = useState(false)

  const loadPortalMenu = useCallback((shouldOpen = false) => {
    if (shouldOpen) setOpenOnLoad(true)
    if (PortalMenu) return
    if (!portalMenuPromiseRef.current) {
      portalMenuPromiseRef.current = import('./PortalMenu').then((module) => module.default)
    }
    portalMenuPromiseRef.current
      .then((component) => setPortalMenu(() => component))
      .catch(() => {
        if (shouldOpen) setOpenOnLoad(false)
      })
  }, [PortalMenu])

  const triggerNode = isValidElement(props.trigger)
    ? cloneElement(props.trigger as ReactElement<Record<string, unknown>>, {
        'aria-expanded': openOnLoad,
        'aria-haspopup': true,
      })
    : props.trigger

  if (!PortalMenu) {
    return (
      <div
        className={props.triggerWrapperClassName}
        style={{ display: 'inline-flex' }}
        // Prefetch (not open) on hover/focus so the chunk is already
        // resolved by the time an actual click lands -- without this, the
        // very first click on any FilterMenu/ActionHistoryBar/etc. in a
        // session kicks off the dynamic import() only at click time, so
        // nothing visibly opens for a beat and then the popover pops in
        // once the chunk arrives. Mouse users almost always hover the
        // trigger before clicking it, so this quietly absorbs that delay
        // ahead of time; touch has no hover equivalent and still pays the
        // one-tick cost on first tap, same as before.
        onMouseEnter={() => loadPortalMenu(false)}
        onFocus={() => loadPortalMenu(false)}
        onClickCapture={(event) => {
          event.stopPropagation()
          loadPortalMenu(true)
        }}
      >
        {triggerNode}
      </div>
    )
  }

  return (
    <PortalMenu
      key={openOnLoad ? 'open-on-load' : 'ready'}
      {...props}
      defaultOpen={openOnLoad || props.defaultOpen}
      onOpenChange={(open) => {
        if (!open) setOpenOnLoad(false)
        props.onOpenChange?.(open)
      }}
    />
  )
}

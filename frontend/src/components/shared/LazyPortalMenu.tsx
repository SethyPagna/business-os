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

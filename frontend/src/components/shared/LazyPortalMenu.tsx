import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PortalMenuProps } from './PortalMenu'

type PortalMenuComponent = typeof import('./PortalMenu').default
type PortalMenuLoader = () => Promise<PortalMenuComponent>

const importPortalMenu: PortalMenuLoader = () => import('./PortalMenu').then((module) => module.default)

/**
 * Prefetching must not replace the trigger DOM node. A pointer gesture focuses
 * the button before its click; if a cached import mounted PortalMenu during
 * that gap, the browser released the pointer over a different node and dropped
 * the first click. Keep the resolved component in a ref until an explicit open
 * intent, then mount it already open. Rejected imports are cleared for retry.
 */
export function useIntentLoadedPortalMenu(loadComponent: PortalMenuLoader = importPortalMenu) {
  const componentRef = useRef<PortalMenuComponent | null>(null)
  const promiseRef = useRef<Promise<PortalMenuComponent> | null>(null)
  const openRequestedRef = useRef(false)
  const [PortalMenu, setPortalMenu] = useState<PortalMenuComponent | null>(null)
  const [openOnLoad, setOpenOnLoad] = useState(false)

  const ensureLoaded = useCallback(() => {
    if (componentRef.current) return Promise.resolve(componentRef.current)
    if (!promiseRef.current) {
      promiseRef.current = loadComponent()
        .then((component) => {
          componentRef.current = component
          if (openRequestedRef.current) setPortalMenu(() => component)
          return component
        })
        .catch((error) => {
          promiseRef.current = null
          if (openRequestedRef.current) {
            openRequestedRef.current = false
            setOpenOnLoad(false)
          }
          throw error
        })
    }
    return promiseRef.current
  }, [loadComponent])

  const preload = useCallback(() => {
    void ensureLoaded().catch(() => undefined)
  }, [ensureLoaded])

  const requestOpen = useCallback(() => {
    openRequestedRef.current = true
    setOpenOnLoad(true)
    if (componentRef.current) {
      setPortalMenu(() => componentRef.current)
      return
    }
    void ensureLoaded().catch(() => undefined)
  }, [ensureLoaded])

  const markClosed = useCallback(() => {
    openRequestedRef.current = false
    setOpenOnLoad(false)
  }, [])

  return { PortalMenu, openOnLoad, preload, requestOpen, markClosed }
}

export default function LazyPortalMenu(props: PortalMenuProps) {
  const { PortalMenu, openOnLoad, preload, requestOpen, markClosed } = useIntentLoadedPortalMenu()

  useEffect(() => {
    if (props.defaultOpen) requestOpen()
  }, [props.defaultOpen, requestOpen])

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
        onMouseEnter={preload}
        onFocus={preload}
        onClickCapture={(event) => {
          event.stopPropagation()
          requestOpen()
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
        if (!open) markClosed()
        props.onOpenChange?.(open)
      }}
    />
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../app/AppContextCore.tsx'

/** Keep the active section's export in its desktop row or mobile title bar. */
export default function SectionExportAction({ children }: { children: ReactNode }) {
  const { page } = useApp() as { page: string }
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    const findHost = () => setHost(document.getElementById('section-export-action-host'))
    findHost()
    // The shell can remount when changing navigation modes or signing in.
    const observer = new MutationObserver(findHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      query.removeEventListener('change', update)
      observer.disconnect()
    }
  }, [])

  // Retained page bodies stay mounted when navigating away. They must not
  // leave their export action attached to another page's title bar.
  if (mobile && host && page === 'sales') return createPortal(children, host)
  return <div className="flex shrink-0 items-center" data-section-export-action>{children}</div>
}

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../../app/AppContextCore.tsx'
import { useLayeredSectionNav } from '../../utils/sectionNavPreference.ts'

export default function SectionTitleAction({ page, section, children }: { page: string; section: string; children: ReactNode }) {
  const { page: activePage, settings } = useApp() as { page: string; settings?: Record<string, unknown> }
  const mobileTitle = useLayeredSectionNav(settings?.ui_mobile_section_nav)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const findHost = () => {
      const target = document.querySelector<HTMLElement>(`[data-section-title-action-host="${page}:${section}"][data-section-title-action-location="${mobileTitle ? 'mobile' : 'sections'}"]`)
      setHost(activePage === page ? target || null : null)
    }
    findHost()
    const observer = new MutationObserver(findHost)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [activePage, page, section, mobileTitle])

  useEffect(() => {
    if (!host) return
    const frame = requestAnimationFrame(() => {
      const row = host.closest<HTMLElement>('.hub-section-pills')
      if (!row) return
      const action = host.getBoundingClientRect(), bounds = row.getBoundingClientRect()
      if (action.right > bounds.right) row.scrollLeft += action.right - bounds.right
      else if (action.left < bounds.left) row.scrollLeft += action.left - bounds.left
    })
    return () => cancelAnimationFrame(frame)
  }, [host])

  return activePage === page && host?.isConnected && host.dataset.sectionTitleActionHost === `${page}:${section}` ? createPortal(children, host) : null
}

import { useEffect, useRef } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import type { PortalAnnouncement } from './portalAnnouncement.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

/**
 * The announcement bar above the storefront header (owner, 2 Nov 2026). The message is a text node, so whatever the
 * owner typed is shown as typed and never read as markup; a link wraps the text and is only ever an absolute http(s)
 * URL (portalAnnouncementLink). `onDismiss` is missing in the Website Editor preview, where the bar is not closable.
 * `onHeight` reports the bar's content height so the floating install notice can sit below it instead of covering it.
 */
export default function PortalAnnouncementStrip({ announcement, copy, onDismiss, onHeight }: {
  announcement: PortalAnnouncement
  copy: CopyFn
  onDismiss?: () => void
  onHeight?: (height: number) => void
}) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = contentRef.current
    if (!onHeight || !node) return undefined
    const report = () => onHeight(Math.round(node.getBoundingClientRect().height))
    report()
    if (typeof ResizeObserver === 'undefined') return () => onHeight(0)
    const observer = new ResizeObserver(report)
    observer.observe(node)
    return () => {
      observer.disconnect()
      onHeight(0)
    }
  }, [onHeight])

  const dismissLabel = copy('portal_a11y_announcement_dismiss', 'Close announcement', 'បិទសេចក្តីជូនដំណឹង')
  const message = (
    <span {...getKhmerTextProps(announcement.text, '[overflow-wrap:anywhere]')} translate="no" lang={announcement.textLanguage}>{announcement.text}</span>
  )

  return (
    <div
      role="region"
      aria-label={copy('portal_a11y_announcement', 'Announcement', 'សេចក្តីជូនដំណឹង')}
      data-portal-announcement="true"
      className="w-full border-b border-amber-700/40 bg-slate-900 pt-[env(safe-area-inset-top)] text-white dark:bg-neutral-800"
    >
      <div ref={contentRef} className="mx-auto flex min-h-11 max-w-[1680px] items-center gap-2 px-4 sm:px-6 lg:px-10 xl:px-14">
        <p className="min-w-0 flex-1 py-2 text-center text-sm font-medium leading-5">
          {announcement.link ? (
            <a
              href={announcement.link}
              target="_blank"
              rel="noopener noreferrer"
              data-portal-announcement-link="true"
              className="underline decoration-amber-400/80 underline-offset-2 hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {message}
            </a>
          ) : message}
        </p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            title={dismissLabel}
            data-portal-announcement-dismiss="true"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

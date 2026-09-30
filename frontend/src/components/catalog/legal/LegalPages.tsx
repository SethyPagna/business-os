// Storefront footer + the three legal pages (N45).
//
// One mount point: <PortalFooter/> renders the real <footer> at the very
// bottom of the page AND the policy reader it opens. The reader is keyed by a
// shareable `?legal=privacy|terms|cookies` query written through history, so
// the browser Back button returns to the catalogue and a policy link can be
// copied and sent to someone.
//
// The pages are TEMPLATES: they interpolate the merchant's own business
// details from /api/portal/config and carry an explicit "have a lawyer review
// this" notice. Nothing here is legal advice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import Facebook from 'lucide-react/dist/esm/icons/facebook.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Instagram from 'lucide-react/dist/esm/icons/instagram.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import {
  LEGAL_PAGE_ORDER,
  LEGAL_PAGE_SECTIONS,
  LEGAL_PAGE_TITLE_KEY,
  LEGAL_STORAGE_ROWS,
  formatLegalLastUpdated,
  interpolateLegal,
  isLegalPageKey,
  legalText,
} from './legalContent.ts'
import type { LegalBusinessDetails, LegalPageKey } from './legalContent.ts'
import { lockDocumentScroll } from '../../shared/documentScrollLock.ts'

export const LEGAL_QUERY_PARAM = 'legal'

// One custom event carries "open a policy page" from anywhere in the
// storefront to the single <PortalFooter/> that owns the reader, so no other
// surface has to grow its own copy of it (or be prop-drilled a callback
// through four components).
export const LEGAL_OPEN_EVENT = 'businessos:portal-legal-open'

/**
 * An inline "Read the Privacy Policy" link for surfaces that are not the
 * footer -- today, the sign-up consent line. It is a real anchor with a real
 * href, so it is focusable, copyable and middle-clickable, and a plain left
 * click opens the reader in place instead of reloading the app.
 */
export function LegalInlineLink({ page, label, className }: { page: LegalPageKey; label: string; className?: string }) {
  const href = typeof window === 'undefined'
    ? `?${LEGAL_QUERY_PARAM}=${page}`
    : legalHref(page, window.location.search, window.location.pathname)
  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // A modified click means "new tab/window" -- leave it to the browser.
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (typeof window === 'undefined') return
    const detail: LegalOpenDetail = { page, handled: false }
    window.dispatchEvent(new CustomEvent(LEGAL_OPEN_EVENT, { detail }))
    // If no footer is mounted to answer, fall through to a real navigation
    // rather than leaving a dead link.
    if (detail.handled) event.preventDefault()
  }
  return (
    <a href={href} onClick={onClick} className={className ?? INLINE_LINK_CLASS}>{label}</a>
  )
}

type LegalOpenDetail = { page: LegalPageKey; handled: boolean }

const INLINE_LINK_CLASS = 'font-semibold text-emerald-700 underline underline-offset-2 transition hover:text-emerald-600 dark:text-emerald-300'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

/** A storefront section the footer can jump to (the nav's own tabs). */
export type PortalFooterQuickLink = { key: string; label: string; onSelect: () => void }
/** An already-normalised external profile link (website/facebook/...). */
export type PortalFooterSocialLink = { key: string; label: string; value: string }

export type PortalFooterProps = {
  copy: CopyFn
  businessName?: string
  legalName?: string
  registrationNumber?: string
  address?: string
  phone?: string
  email?: string
  // P-public-9 (owner, 2026-09-25): the footer carries social links, quick
  // links, contact and policies. Both optional: CatalogPreviewSurface injects
  // the quick links (it owns the tabs) for every caller, and a caller passes
  // the social links it has already filtered and normalised.
  quickLinks?: PortalFooterQuickLink[]
  socialLinks?: PortalFooterSocialLink[]
}

const FOOTER_HEADING_CLASS = 'mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-5 tracking-[0.14em] text-slate-500 dark:text-neutral-400'
const FOOTER_LINK_CLASS = 'inline-flex min-h-10 items-center text-sm leading-6 text-slate-700 underline-offset-2 transition hover:text-slate-900 hover:underline dark:text-neutral-200 dark:hover:text-white'

function SocialIcon({ kind }: { kind: string }) {
  const Icon = kind === 'facebook' ? Facebook : kind === 'instagram' ? Instagram : kind === 'telegram' ? Send : Globe
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
}

/**
 * Which policy page a location's query string selects, or null for none.
 * Exported for the test: this is the whole routing rule.
 */
export function readLegalPageFromSearch(search: string): LegalPageKey | null {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  const value = params.get(LEGAL_QUERY_PARAM)
  return isLegalPageKey(value) ? value : null
}

/** The shareable href for one policy page, preserving any other query keys. */
export function legalHref(page: LegalPageKey | null, search: string, pathname = ''): string {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''))
  if (page) params.set(LEGAL_QUERY_PARAM, page)
  else params.delete(LEGAL_QUERY_PARAM)
  const query = params.toString()
  return `${pathname || ''}${query ? `?${query}` : ''}`
}

/**
 * Everything rendered from merchant-controlled settings goes through this
 * first: control characters stripped (they can break out of a line or hide
 * text), whitespace collapsed, length bounded. React escapes the result, so
 * this is about a sane footer, not about HTML injection.
 */
export function sanitizeBusinessDetail(value: unknown, max = 200): string {
  return String(value ?? '')
    // C0/C1 controls plus the invisible bidi / zero-width / separator
    // characters -- all able to reorder or hide the text that follows.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** A tel:/mailto: href only when the value can safely make one. */
function contactHref(kind: 'tel' | 'mailto', value: string): string {
  if (!value) return ''
  if (kind === 'tel') {
    const digits = value.replace(/[^\d+]/g, '')
    return digits.length >= 6 ? `tel:${digits}` : ''
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : ''
}

export default function PortalFooter({
  copy,
  businessName,
  legalName,
  registrationNumber,
  address,
  phone,
  email,
  quickLinks = [],
  socialLinks = [],
}: PortalFooterProps) {
  const [activePage, setActivePage] = useState<LegalPageKey | null>(() =>
    typeof window === 'undefined' ? null : readLegalPageFromSearch(window.location.search))
  // True while the reader was opened by us (so closing can go BACK and leave
  // no history crumb); false when the visitor arrived on a policy link
  // directly, where going back would leave the site entirely.
  const pushedRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // Capture the catalogue title before a direct ?legal= reader's first
  // effect can replace it. Effect reruns must never promote a policy title to
  // the restoration target.
  const baseDocumentTitleRef = useRef(typeof document === 'undefined' ? '' : document.title)

  // One resolver for every string on these pages: the portal language pack
  // first (so a future translation of portal_legal_* just works), then the
  // en/km text declared in legalContent.ts.
  const text = useCallback(
    (key: string) => copy(key, legalText('en', key), legalText('km', key)),
    [copy],
  )

  const details: LegalBusinessDetails = useMemo(() => ({
    name: sanitizeBusinessDetail(businessName) || 'This business',
    legalName: sanitizeBusinessDetail(legalName),
    registrationNumber: sanitizeBusinessDetail(registrationNumber, 80),
    address: sanitizeBusinessDetail(address, 300),
    phone: sanitizeBusinessDetail(phone, 60),
    email: sanitizeBusinessDetail(email, 120),
  }), [businessName, legalName, registrationNumber, address, phone, email])

  const year = new Date().getFullYear()
  const fill = useCallback((key: string) => interpolateLegal(text(key), details, year), [text, details, year])

  const openPage = useCallback((page: LegalPageKey) => {
    // The opener -- one of the footer's always-visible policy links, or the
    // sign-up consent link -- stays mounted while the reader is open (the
    // reader only marks it inert), so it is itself the stable focus target.
    if (!activePage && typeof document !== 'undefined') {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    setActivePage(page)
    if (typeof window === 'undefined') return
    try {
      const href = legalHref(page, window.location.search, window.location.pathname)
      if (activePage) {
        // Moving between documents inside the same reader must not add
        // another Back step. Close should leave the reader in one action.
        window.history.replaceState({ legal: page }, '', href)
      } else {
        window.history.pushState({ legal: page }, '', href)
        pushedRef.current = true
      }
    } catch {
      // History blocked (rare sandboxes): the reader still opens, the URL
      // simply does not change.
    }
  }, [activePage])

  const closePage = useCallback(() => {
    if (typeof window === 'undefined') { setActivePage(null); return }
    if (pushedRef.current) {
      pushedRef.current = false
      window.history.back()
      return
    }
    setActivePage(null)
    try {
      window.history.replaceState(null, '', legalHref(null, window.location.search, window.location.pathname))
    } catch { /* see openPage */ }
  }, [])

  // Any surface can ask for a policy page (the sign-up consent line does).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<LegalOpenDetail>).detail
      if (!detail || !isLegalPageKey(detail.page)) return
      detail.handled = true
      openPage(detail.page)
    }
    window.addEventListener(LEGAL_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(LEGAL_OPEN_EVENT, onOpen)
  }, [openPage])

  // Back/forward buttons drive the reader, so it behaves like a page.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const sync = () => {
      const next = readLegalPageFromSearch(window.location.search)
      if (!next) pushedRef.current = false
      setActivePage(next)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Title + scroll position while a policy page is open.
  useEffect(() => {
    if (typeof document === 'undefined' || !activePage) return undefined
    document.title = `${text(LEGAL_PAGE_TITLE_KEY[activePage])} · ${details.name}`
    try {
      window.scrollTo({ top: 0, behavior: 'auto' })
    } catch { /* older browsers */ }
    return () => { document.title = baseDocumentTitleRef.current }
  }, [activePage, text, details.name])

  // Restore focus only after the reader has unmounted, to the link that
  // opened it. A direct ?legal= link has no opener; the catalogue main
  // landmark is the meaningful fallback.
  const hadActivePageRef = useRef(!!activePage)
  useEffect(() => {
    const hadActivePage = hadActivePageRef.current
    hadActivePageRef.current = !!activePage
    if (!hadActivePage || activePage || typeof document === 'undefined') return
    const requested = returnFocusRef.current
    returnFocusRef.current = null
    window.requestAnimationFrame(() => {
      const fallback = document.getElementById('portal-main-content')
      const target = requested?.isConnected ? requested : fallback
      target?.focus()
    })
  }, [activePage])

  return (
    <>
      <footer
        role="contentinfo"
        aria-label={text('portal_legal_footer_landmark')}
        data-portal-footer="true"
        className="mt-8 border-t border-slate-200 px-4 py-6 text-slate-600 dark:border-neutral-800 dark:text-neutral-400"
      >
        {/* P-public-9 (owner, 2026-09-25): a real site footer -- contact,
            quick links to the storefront sections, social profiles and the
            policies, as columns that stack on a phone. Every column renders
            only when it has something in it. */}
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 space-y-1 text-xs leading-relaxed">
            <div className="notranslate text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100" translate="no">
              {details.name}
            </div>
            {details.legalName ? (
              <div>{text('portal_legal_identity_legal_name')}: <span className="notranslate" translate="no">{details.legalName}</span></div>
            ) : null}
            {details.registrationNumber ? (
              <div>{text('portal_legal_identity_registration')}: {details.registrationNumber}</div>
            ) : null}
            {details.address || details.phone || details.email ? (
              <div className="pt-2 text-[11px] font-semibold uppercase leading-5 tracking-[0.14em] text-slate-500 dark:text-neutral-400">{text('portal_legal_footer_contact')}</div>
            ) : null}
            {details.address ? <div className="notranslate break-words" translate="no">{details.address}</div> : null}
            <div className="flex flex-col">
              {details.phone ? (
                contactHref('tel', details.phone)
                  ? <a className={FOOTER_LINK_CLASS} href={contactHref('tel', details.phone)}>{details.phone}</a>
                  : <span>{details.phone}</span>
              ) : null}
              {details.email ? (
                contactHref('mailto', details.email)
                  ? <a className={`${FOOTER_LINK_CLASS} break-all`} href={contactHref('mailto', details.email)}>{details.email}</a>
                  : <span className="break-all">{details.email}</span>
              ) : null}
            </div>
            {/* A takedown route, in the one place every page of the site
                ends. A storefront that publishes photographs -- product
                shots, and the screenshots customers send in -- needs
                somewhere for the person in one of them to write. Hidden when
                no address is configured: a contact route with nowhere to
                send it is worse than no route. */}
            {details.email ? (
              <div className="pt-1">{fill('portal_legal_footer_content_concerns')}</div>
            ) : null}
          </div>

          {quickLinks.length ? (
            <nav aria-label={text('portal_legal_footer_quick_links')} className="min-w-0" data-portal-footer-quick-links="true">
              <div className={FOOTER_HEADING_CLASS}>{text('portal_legal_footer_quick_links')}</div>
              <ul className="flex flex-col">
                {quickLinks.map((link) => (
                  <li key={link.key}>
                    <button type="button" className={`${FOOTER_LINK_CLASS} text-left`} onClick={link.onSelect}>
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          {socialLinks.length ? (
            <div className="min-w-0" data-portal-footer-social="true">
              <div className={FOOTER_HEADING_CLASS}>{text('portal_legal_footer_follow')}</div>
              <ul className="flex flex-col">
                {socialLinks.map((link) => (
                  <li key={link.key}>
                    <a className={`${FOOTER_LINK_CLASS} gap-2`} href={link.value} target="_blank" rel="noreferrer">
                      <SocialIcon kind={link.key} />
                      <span className="notranslate break-words" translate="no">{link.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Owner, 2026-09-25 (P-public-7): the three policies are visible
              buttons, not a dropdown. Real links (shareable ?legal= hrefs,
              middle-click opens a tab); a plain click opens the reader. */}
          <nav aria-label={text('portal_legal_policies')} className="min-w-0" data-portal-footer-policies="true">
            <div className={FOOTER_HEADING_CLASS}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {text('portal_legal_policies')}
            </div>
            <div className="flex flex-wrap gap-2">
              {LEGAL_PAGE_ORDER.map((page) => (
                <a
                  key={page}
                  href={typeof window === 'undefined' ? '' : legalHref(page, window.location.search, window.location.pathname)}
                  aria-current={activePage === page ? 'page' : undefined}
                  className="inline-flex min-h-10 items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                    event.preventDefault()
                    openPage(page)
                  }}
                >
                  {text(LEGAL_PAGE_TITLE_KEY[page])}
                </a>
              ))}
            </div>
          </nav>
        </div>
        <div className="mx-auto mt-6 max-w-5xl border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-500 dark:border-neutral-800 dark:text-neutral-500">
          {fill('portal_legal_footer_rights')}
        </div>
      </footer>

      {activePage ? (
        <LegalReader page={activePage} text={text} fill={fill} details={details} onClose={closePage} onNavigate={openPage} />
      ) : null}
    </>
  )
}

function LegalReader({
  page,
  text,
  fill,
  details,
  onClose,
  onNavigate,
}: {
  page: LegalPageKey
  text: (key: string) => string
  fill: (key: string) => string
  details: LegalBusinessDetails
  onClose: () => void
  onNavigate: (page: LegalPageKey) => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const dialog = dialogRef.current
    // The shared counted lock: a plain inline overflow write loses to the
    // storefront's html overflow-y: auto !important (documentScrollLock.ts).
    const releaseScroll = lockDocumentScroll()

    // The reader is rendered beside the catalogue landmarks, rather than
    // inside them. Marking those landmarks inert keeps pointer and keyboard
    // interaction inside the modal without hiding the reader itself.
    const background = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-portal-root="true"] header, [data-portal-root="true"] nav, [data-portal-root="true"] main, [data-portal-root="true"] footer',
    )).filter((element) => !element.contains(dialog) && !dialog?.contains(element))
    const previouslyInert = background.map((element) => element.hasAttribute('inert'))
    background.forEach((element) => element.setAttribute('inert', ''))

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      releaseScroll()
      background.forEach((element, index) => {
        if (!previouslyInert[index]) element.removeAttribute('inert')
      })
    }
  }, [onClose])

  const titleId = `portal-legal-title-${page}`

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-portal-legal-page={page}
      className="fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-white text-slate-800 dark:bg-neutral-950 dark:text-neutral-200"
    >
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <h1
            id={titleId}
            className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-neutral-100"
            style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            {text(LEGAL_PAGE_TITLE_KEY[page])}
          </h1>
          {/* The one close affordance for this surface. */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={text('portal_legal_close')}
            title={text('portal_legal_close')}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-16 pt-5 text-sm leading-7">
        <p data-portal-legal-last-updated="true" className="text-xs leading-6 text-slate-500 dark:text-neutral-500">
          {text('portal_legal_last_updated').replace('{date}', formatLegalLastUpdated())}
        </p>
        <p data-portal-legal-updated="true" className="mt-1 text-xs leading-6 text-slate-600 dark:text-neutral-400">
          {fill('portal_legal_updated_notice')}
        </p>

        <BusinessIdentityCard text={text} details={details} />

        {LEGAL_PAGE_SECTIONS[page].map((section) => (
          <section key={section.heading} className="mt-6">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{fill(section.heading)}</h2>
            {section.bodies.map((body) => (
              <p key={body} className="mt-2 whitespace-pre-line">{fill(body)}</p>
            ))}
            {page === 'cookies' && section.heading === 'portal_legal_cookies_table_h' ? (
              <StorageTable text={text} />
            ) : null}
          </section>
        ))}

        <nav aria-label={text('portal_legal_policies')} className="mt-10 flex flex-wrap gap-2 border-t border-slate-200 pt-5 dark:border-neutral-800">
          {LEGAL_PAGE_ORDER.filter((other) => other !== page).map((other) => (
            <button
              key={other}
              type="button"
              onClick={() => onNavigate(other)}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {text(LEGAL_PAGE_TITLE_KEY[other])}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

function BusinessIdentityCard({ text, details }: { text: (key: string) => string; details: LegalBusinessDetails }) {
  const rows: Array<[string, string]> = [
    [text('portal_legal_identity_legal_name'), details.legalName],
    [text('portal_legal_identity_registration'), details.registrationNumber],
    [text('portal_legal_identity_address'), details.address],
    [text('portal_legal_identity_phone'), details.phone],
    [text('portal_legal_identity_email'), details.email],
  ]
  const filled = rows.filter(([, value]) => !!value)
  if (!filled.length) return null
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <div className="font-semibold text-slate-900 dark:text-neutral-100">{text('portal_legal_identity_h')}</div>
      <dl className="mt-2 space-y-1">
        {filled.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-x-2">
            <dt className="text-slate-500 dark:text-neutral-500">{label}</dt>
            <dd className="min-w-0 break-words text-slate-800 dark:text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function StorageTable({ text }: { text: (key: string) => string }): ReactNode {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 dark:border-neutral-800">
      <table className="w-full min-w-[520px] border-collapse text-left text-xs">
        <thead className="bg-slate-50 text-slate-500 dark:bg-neutral-900 dark:text-neutral-400">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">{text('portal_legal_col_name')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{text('portal_legal_col_kind')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{text('portal_legal_col_purpose')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{text('portal_legal_col_lifetime')}</th>
          </tr>
        </thead>
        <tbody>
          {LEGAL_STORAGE_ROWS.map((row) => (
            <tr key={row.id} className="border-t border-slate-100 align-top dark:border-neutral-800">
              <td className="px-3 py-2 font-mono text-[11px] break-all text-slate-800 dark:text-neutral-200">{row.name}</td>
              <td className="px-3 py-2 whitespace-nowrap">{text(row.kindKey)}</td>
              <td className="px-3 py-2">{text(row.purposeKey)}</td>
              <td className="px-3 py-2">{text(row.lifetimeKey)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

import { useEffect, useRef, useState, type ComponentType } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Headset from 'lucide-react/dist/esm/icons/headset.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { FacebookIcon, InstagramIcon, MessengerIcon, TelegramIcon, TikTokIcon, WhatsAppIcon } from '../shared/BrandIcons.tsx'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { SOCIAL_PLATFORM_NAMES, type SocialPlatform } from '../../utils/socialHandles.ts'
import { PORTAL_CONTACT_BRAND, buildPortalContactFloat, type PortalFlatSocialLink, type PortalSocialGroup } from './portalSocialLinks.ts'

type IconComponent = ComponentType<{ className?: string }>
type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

export const PORTAL_SOCIAL_ICONS: Record<SocialPlatform, IconComponent> = {
  website: Globe,
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  telegram: TelegramIcon,
  messenger: MessengerIcon,
  whatsapp: WhatsAppIcon,
  tiktok: TikTokIcon,
  phone: PhoneCall,
}

type ContactFloatPlatform = 'telegram' | 'messenger' | 'instagram' | 'whatsapp' | 'phone'

function contactFloatName(platform: ContactFloatPlatform, copy: CopyFn): string {
  switch (platform) {
    case 'messenger': return copy('portal_a11y_contact_messenger', 'Chat on Messenger', 'ជជែកតាម Messenger')
    case 'telegram': return copy('portal_a11y_contact_telegram', 'Chat on Telegram', 'ជជែកតាម Telegram')
    case 'instagram': return copy('portal_a11y_contact_instagram', 'Message us on Instagram', 'ផ្ញើសារតាម Instagram')
    case 'whatsapp': return copy('portal_a11y_contact_whatsapp', 'Chat on WhatsApp', 'ជជែកតាម WhatsApp')
    case 'phone': return copy('portal_a11y_contact_phone', 'Call us', 'ទូរស័ព្ទមកយើង')
  }
}

/**
 * The floating contact buttons: right side, stacked above the My List button, one round brand-colour button per
 * configured chat account. Each is a plain link that opens the chat directly; an account that is not configured
 * has no button. The accessible name and tooltip are translated. Below 640px the column would cover the right-hand
 * product card, so a phone shows one Contact button that opens the same links above it (closed again by a tap
 * elsewhere or Escape); from 640px the column is always shown.
 */
export function PortalContactFloat({ channels, copy }: { channels: readonly PortalFlatSocialLink[]; copy: CopyFn }) {
  const buttons = buildPortalContactFloat(channels)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  if (!buttons.length) return null
  const toggleName = open ? copy('close', 'Close', 'បិទ') : copy('contactUs', 'Contact us', 'ទាក់ទងយើង')
  return (
    <div
      ref={root}
      role="group"
      data-portal-contact-float="true"
      aria-label={copy('contactUs', 'Contact us', 'ទាក់ទងយើង')}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-[calc(1.25rem+env(safe-area-inset-right))] z-50 flex flex-col items-center gap-2"
    >
      <div className={`${open ? 'flex' : 'hidden'} flex-col items-center gap-2 sm:flex`}>
        {buttons.map((button) => {
          const platform = button.platform as ContactFloatPlatform
          const Icon = PORTAL_SOCIAL_ICONS[button.platform]
          const name = contactFloatName(platform, copy)
          const isCall = platform === 'phone'
          return (
            <a
              key={button.key}
              href={button.value}
              target={isCall ? undefined : '_blank'}
              rel={isCall ? undefined : 'noreferrer noopener'}
              aria-label={name}
              title={name}
              data-portal-contact-platform={platform}
              style={{ background: PORTAL_CONTACT_BRAND[platform].background }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white/90 transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:ring-neutral-900/90 dark:focus-visible:outline-white"
            >
              <Icon className="h-5 w-5" />
            </a>
          )
        })}
      </div>
      <button
        type="button"
        data-portal-contact-toggle="true"
        aria-expanded={open}
        aria-label={toggleName}
        title={toggleName}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-2 ring-white/90 transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:hidden dark:bg-white dark:text-neutral-950 dark:ring-neutral-900/90 dark:hover:bg-neutral-200 dark:focus-visible:outline-white"
      >
        {open ? <X className="h-5 w-5" /> : <Headset className="h-5 w-5" />}
      </button>
    </div>
  )
}

/** Handles, numbers and domains stay Latin and untranslated; an owner label may be Khmer. */
export function PortalSocialText({ text, latin, className = '' }: { text: string; latin: boolean; className?: string }) {
  const wrap = `${className} [overflow-wrap:anywhere]`.trim()
  if (latin) return <span translate="no" lang="en" dir="ltr" className={`notranslate ${wrap}`}>{text}</span>
  return <span {...getKhmerTextProps(text, wrap)}>{text}</span>
}

const ITEM_CLASS = 'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-stone-300 bg-white px-3.5 text-sm font-medium text-[#23201b] transition hover:border-[#9c7a3c] hover:bg-[#f4f1ea] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-amber-300 dark:hover:bg-neutral-800'
const ICON_CLASS = 'h-4 w-4 shrink-0 text-[#9c7a3c] dark:text-amber-300'

/**
 * The header's social row: its own line, scrolling sideways when long (a handle
 * is never cut), every target 44px tall. A platform with several accounts is
 * one button that opens a picker, so the row stays short.
 */
export default function PortalSocialRow({ groups, mapLink = '', pageLanguage, copy }: {
  groups: readonly PortalSocialGroup[]
  mapLink?: string
  pageLanguage: string
  copy: CopyFn
}) {
  if (!groups.length && !mapLink) return null
  const language = pageLanguage === 'km' ? 'km' : 'en'
  return (
    <nav
      data-portal-social-row="true"
      aria-label={copy('portal_a11y_social_links', 'Social links', 'តំណបណ្តាញសង្គម')}
      className="mt-2 flex min-h-11 flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1"
    >
      {groups.map((group) => {
        const Icon = PORTAL_SOCIAL_ICONS[group.platform]
        const [first] = group.links
        if (group.links.length === 1) {
          return (
            <a key={group.platform} href={first.href} target="_blank" rel="noreferrer" className={ITEM_CLASS} aria-label={first.accessibleName} title={first.accessibleName}>
              <Icon className={ICON_CLASS} />
              <PortalSocialText text={first.visibleText} latin={first.latin} />
            </a>
          )
        }
        const platformName = SOCIAL_PLATFORM_NAMES[group.platform][language]
        const pickerName = `${copy('portal_a11y_choose_account', 'Choose account', 'ជ្រើសរើសគណនី')}: ${platformName}`
        return (
          <LazyPortalMenu
            key={group.platform}
            align="left"
            trigger={(
              <button type="button" className={ITEM_CLASS} aria-label={pickerName} title={pickerName} data-portal-social-picker={group.platform}>
                <Icon className={ICON_CLASS} />
                <PortalSocialText text={first.visibleText} latin={first.latin} />
                <span className="text-xs text-slate-600 dark:text-neutral-300">+{group.links.length - 1}</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              </button>
            )}
            content={({ closeMenu }) => (
              <ul className="max-w-[85vw] py-1" aria-label={pickerName}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={closeMenu}
                      aria-label={link.accessibleName}
                      className="flex min-h-11 items-center gap-2 px-4 text-sm text-[#23201b] hover:bg-[#f4f1ea] dark:text-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <Icon className={ICON_CLASS} />
                      <PortalSocialText text={link.visibleText} latin={link.latin} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          />
        )
      })}
      {mapLink ? (
        <a href={mapLink} target="_blank" rel="noreferrer" className={ITEM_CLASS}>
          <MapPin className={ICON_CLASS} />
          {copy('map', 'Map')}
        </a>
      ) : null}
    </nav>
  )
}

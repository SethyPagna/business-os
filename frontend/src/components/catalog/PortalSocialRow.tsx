import type { ComponentType } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import { FacebookIcon, InstagramIcon, MessengerIcon, TelegramIcon, TikTokIcon, WhatsAppIcon } from '../shared/BrandIcons.tsx'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { SOCIAL_PLATFORM_NAMES, type SocialPlatform } from '../../utils/socialHandles.ts'
import type { PortalSocialGroup } from './portalSocialLinks.ts'

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

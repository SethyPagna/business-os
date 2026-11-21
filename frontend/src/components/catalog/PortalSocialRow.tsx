import type { ComponentType } from 'react'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import { FacebookIcon, InstagramIcon, MessengerIcon, TelegramIcon, TikTokIcon, WhatsAppIcon } from '../shared/BrandIcons.tsx'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import type { SocialPlatform } from '../../utils/socialHandles.ts'
import type { PortalContactEntry } from './portalSocialLinks.ts'

type IconComponent = ComponentType<{ className?: string }>
type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

// The brand marks for every platform a contact row or a footer link can show (the header's chip row and the floating chat buttons are gone).
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

/** Account names, numbers and domains stay Latin and untranslated; an owner label may be Khmer. */
export function PortalSocialText({ text, latin, className = '' }: { text: string; latin: boolean; className?: string }) {
  const wrap = `${className} [overflow-wrap:anywhere]`.trim()
  if (latin) return <span translate="no" lang="en" dir="ltr" className={`notranslate ${wrap}`}>{text}</span>
  return <span translate="no" {...getKhmerTextProps(text, `notranslate ${wrap}`)}>{text}</span>
}

/**
 * The rows themselves: one tappable 44 px row per entry (brand icon, then the real account name or number; the platform word is only the
 * accessible name). The Contact panel shows the chat entries (Phone, Messenger, Telegram, WhatsApp); About shows the account entries; the
 * List page, the FAQ and "Forgot password?" show the chat entries inline where a Contact button used to be (`inline`).
 */
export function PortalContactRows({ entries, copy, onNavigate, className = '', inline = false }: { entries: readonly PortalContactEntry[]; copy: CopyFn; onNavigate?: () => void; className?: string; inline?: boolean }) {
  if (!entries.length) return null
  const rowClass = inline
    ? 'flex min-h-11 items-center gap-3 rounded-xl border border-[#e3d9c8] bg-[#faf6ef] px-4 py-2 text-sm text-[#23201b] transition hover:bg-[#f6ece0] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
    : 'flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-[#23201b] transition hover:bg-stone-100 dark:text-neutral-100 dark:hover:bg-neutral-800'
  return (
    <ul className={className} aria-label={copy('contactUs', 'Contact us', 'ទាក់ទងយើង')} data-portal-contact-menu={inline ? undefined : 'true'} data-portal-contact-inline={inline ? 'true' : undefined}>
      {entries.map((entry) => {
        const Icon = PORTAL_SOCIAL_ICONS[entry.platform]
        const external = !/^(?:tel|mailto):/i.test(entry.href)
        return (
          <li key={entry.key}>
            <a
              href={entry.href}
              target={external ? '_blank' : undefined}
              rel={external ? 'noreferrer noopener' : undefined}
              onClick={onNavigate}
              aria-label={entry.accessibleName}
              data-portal-contact-platform={entry.platform}
              className={rowClass}
            >
              <Icon className="h-4 w-4 shrink-0 text-[#9c7a3c] dark:text-amber-300" />
              <PortalSocialText text={entry.label} latin={entry.latin} />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

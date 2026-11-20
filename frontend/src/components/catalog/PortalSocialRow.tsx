import type { ComponentType } from 'react'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import { FacebookIcon, InstagramIcon, MessengerIcon, TelegramIcon, TikTokIcon, WhatsAppIcon } from '../shared/BrandIcons.tsx'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import type { SocialPlatform } from '../../utils/socialHandles.ts'

type IconComponent = ComponentType<{ className?: string }>

// The brand marks for every platform a contact row or a footer link can show (the header's chip row and the floating chat buttons are gone:
// the Contact menu, PortalContactMenu, is the one entry point).
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
  return <span {...getKhmerTextProps(text, wrap)}>{text}</span>
}

import type { PortalTelegramReplyId } from './portalTelegramToken'

// G38 S3c: every bot reply, in English and Khmer, in one table (AMEND-g38-lean-writes-1.2 sections 4.4 and 5.7).
// S3d and S3e only name a reply id; the words live here. A text never holds a shop name, a phone number, a token or
// an id: the shop and member names of R-CONFIRM and the start time are passed in by the caller. Every text except
// R-CONFIRM stays at or under 200 characters because Telegram caps an answerCallbackQuery text there.

export type PortalTelegramLang = 'en' | 'km'

export type PortalTelegramTextParams = {
  startedHm?: string | null
  shopName?: string | null
  memberName?: string | null
}

type Row = { en: string; km: string; button?: { en: string; km: string } }

// {hm} is the start time (HH:MM, Cambodia). {site} and {who} exist only in R-CONFIRM and are built per language.
export const PORTAL_TELEGRAM_TEXTS: Readonly<Record<PortalTelegramReplyId, Row>> = {
  'R-CONFIRM': {
    en: 'Sign in to {site}{who}? You pressed Continue with Telegram at {hm}. Tap the number the website shows. If you did not just press it yourself, do not tap: someone may be trying to use your account.',
    km: 'ចូលទៅ {site}{who}? អ្នកបានចុច «បន្តជាមួយ Telegram» នៅម៉ោង {hm}។ សូមចុចលេខដែលគេហទំព័របង្ហាញ។ បើមិនមែនអ្នកទើបតែចុចដោយខ្លួនឯងទេ កុំចុច ព្រោះអាចមានអ្នកផ្សេងកំពុងព្យាយាមប្រើគណនីរបស់អ្នក។',
  },
  'R-SHARE': {
    en: 'Tap the button below to share your phone number and finish signing in. Started {hm}.',
    km: 'ចុចប៊ូតុងខាងក្រោមដើម្បីចែករំលែកលេខទូរស័ព្ទរបស់អ្នក ហើយបញ្ចប់ការចូលគណនី។ ចាប់ផ្តើមម៉ោង {hm}។',
    button: { en: 'Share my phone number', km: 'ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ' },
  },
  'R-JOINED': {
    en: 'Done. Go back to the website.',
    km: 'រួចរាល់។ សូមត្រឡប់ទៅគេហទំព័រវិញ។',
  },
  'R-SIGNED-IN': {
    en: 'Signed in. Go back to the website. Started {hm}.',
    km: 'បានចូលគណនីហើយ។ សូមត្រឡប់ទៅគេហទំព័រវិញ។ ចាប់ផ្តើមម៉ោង {hm}។',
  },
  'R-USED': {
    en: 'This button was already used.',
    km: 'ប៊ូតុងនេះត្រូវបានប្រើរួចហើយ។',
  },
  'R-CAP': {
    en: 'Too many sign-ins today. Try again tomorrow.',
    km: 'ចូលគណនីច្រើនពេកថ្ងៃនេះ។ សូមព្យាយាមម្តងទៀតថ្ងៃស្អែក។',
  },
  'R-BUSY': {
    en: 'Too many new accounts right now. Try again in an hour.',
    km: 'មានគណនីថ្មីច្រើនពេកនៅពេលនេះ។ សូមព្យាយាមម្តងទៀតក្នុងរយៈពេលមួយម៉ោង។',
  },
  'R-LATER': {
    en: 'Something went wrong. Please try again in a moment.',
    km: 'មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀតបន្តិចក្រោយ។',
  },
  'R-STALE': {
    en: 'This sign-in link is no longer valid. Open the website and press Continue with Telegram again.',
    km: 'តំណចូលគណនីនេះលែងប្រើបានហើយ។ សូមបើកគេហទំព័រ ហើយចុច «បន្តជាមួយ Telegram» ម្តងទៀត។',
  },
  'R-PAUSED': {
    en: 'This account is paused. Contact the shop.',
    km: 'គណនីនេះត្រូវបានផ្អាក។ សូមទាក់ទងហាង។',
  },
  'R-OFF': {
    en: 'Telegram sign-in is not available right now.',
    km: 'ការចូលគណនីតាម Telegram មិនទាន់អាចប្រើបានពេលនេះទេ។',
  },
  'R-TOO-MANY': {
    en: 'Too many tries. Please wait a little and try again.',
    km: 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំបន្តិច ហើយព្យាយាមម្តងទៀត។',
  },
  'R-TERMS': {
    en: 'Open the website, accept the terms, confirm your age, then press Continue with Telegram again.',
    km: 'សូមបើកគេហទំព័រ ព្រមព្រៀងតាមលក្ខខណ្ឌ បញ្ជាក់អាយុរបស់អ្នក រួចចុច «បន្តជាមួយ Telegram» ម្តងទៀត។',
  },
  'R-OWN-NUMBER': {
    en: 'Use the Share my phone number button. Only your own number works.',
    km: 'សូមប្រើប៊ូតុង «ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ»។ មានតែលេខរបស់អ្នកផ្ទាល់ប៉ុណ្ណោះដែលប្រើបាន។',
  },
  'R-PHONE-BAD': {
    en: 'This phone number cannot be used. Try the Share my phone number button again.',
    km: 'លេខទូរស័ព្ទនេះប្រើមិនបានទេ។ សូមសាកល្បងប៊ូតុង «ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ» ម្តងទៀត។',
  },
  'R-ANON': {
    en: 'Use a Telegram account with a phone number.',
    km: 'សូមប្រើគណនី Telegram ដែលមានលេខទូរស័ព្ទ។',
  },
  'R-PHONE-HELD': {
    en: 'This number already has an account. Contact the shop.',
    km: 'លេខនេះមានគណនីរួចហើយ។ សូមទាក់ទងហាង។',
  },
  'R-DONE-ALREADY': {
    en: 'You already have an account. Press Continue with Telegram on the website again.',
    km: 'អ្នកមានគណនីរួចហើយ។ សូមចុច «បន្តជាមួយ Telegram» នៅលើគេហទំព័រម្តងទៀត។',
  },
  'R-WRONG-CODE': {
    en: 'That number is not the one on the website.',
    km: 'លេខនោះមិនមែនជាលេខដែលគេហទំព័របង្ហាញទេ។',
  },
  'R-HELP': {
    en: 'Open the website and press Continue with Telegram.',
    km: 'សូមបើកគេហទំព័រ ហើយចុច «បន្តជាមួយ Telegram»។',
  },
}

export const PORTAL_TELEGRAM_REPLY_IDS = Object.keys(PORTAL_TELEGRAM_TEXTS) as PortalTelegramReplyId[]

// The token's locale when it is known (km -> Khmer, anything else English); otherwise Telegram's language_code.
export function replyLanguage(tokenLocale: string | null | undefined, languageCode: string | null | undefined): PortalTelegramLang {
  if (typeof tokenLocale === 'string' && tokenLocale) return tokenLocale === 'km' ? 'km' : 'en'
  return languageCode === 'km' ? 'km' : 'en'
}

// A name that came from settings or from a member row: no control characters, at most 60 characters.
function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

export function portalTelegramReplyText(id: PortalTelegramReplyId, lang: PortalTelegramLang, params: PortalTelegramTextParams = {}): string {
  const row = PORTAL_TELEGRAM_TEXTS[id]
  let text = row[lang]
  if (id === 'R-CONFIRM') {
    const shop = cleanName(params.shopName)
    const name = cleanName(params.memberName)
    const site = lang === 'km' ? (shop ? `គេហទំព័រ ${shop}` : 'គេហទំព័រ') : shop ? `the ${shop} website` : 'the website'
    const who = name ? (lang === 'km' ? ` ជា ${name}` : ` as ${name}`) : ''
    text = text.replace('{site}', () => site).replace('{who}', () => who)
  }
  return text.replace('{hm}', () => params.startedHm ?? '')
}

export function portalTelegramButtonText(id: PortalTelegramReplyId, lang: PortalTelegramLang): string | null {
  return PORTAL_TELEGRAM_TEXTS[id].button?.[lang] ?? null
}

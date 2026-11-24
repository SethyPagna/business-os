import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, SetStateAction } from 'react'
import { buildLogoImageStyle } from './logoImageStyle'
import { normalizePriceValue } from '../../utils/pricing.ts'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import LazyPortalMenu from '../shared/LazyPortalMenu.tsx'
import { COVER_BANNER_MAX_PX, coverRatio, coverShape, sameImageFile } from '../../utils/aboutCoverLayout.ts'
import type { CoverShape } from '../../utils/aboutCoverLayout.ts'
import { SectionShell, withTypedTerm } from './catalogUi'
import { portalPrimaryValue } from './portalMultiValue.ts'
import { PORTAL_CONTACT_ROW_INLINE, PortalContactRows } from './PortalSocialRow.tsx'
import { portalAccountsNotShown } from './portalSocialLinks.ts'
import type { PortalContactEntry } from './portalSocialLinks.ts'
import { assistantRowNames } from './portalProductNames.ts'
import { PORTAL_PRIMARY_BUTTON } from './portalButtons.ts'
import { splitNoTranslateSegments, stripNoTranslateMarkers } from './portalNoTranslate.ts'
import { faqEntries, faqSearchVisible, filterFaqEntries, nextOpenFaqKey } from './portalFaqLayout.ts'
import { defaultConfigText } from './portalLanguagePacks.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { aiConsentGiven, fillAiProviderTemplate, saveAiConsent } from './legal/aiProviderDisclosure.ts'
import type { AiDisclosureLanguage, AiProviderState } from './legal/aiProviderDisclosure.ts'
import { contactHref } from '../../utils/socialLinks.ts'
import { PORTAL_MAP_FRAME_REFERRER, PORTAL_MAP_FRAME_SANDBOX } from './portalEditorUtils.ts'

type IdValue = string | number
type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

interface PreviewConfig {
  aboutBlocks?: AboutBlock[]
  aboutContent?: string
  aboutImage?: string
  aboutImageAlt?: string
  aboutTitle?: string
  aiDisclaimer?: string
  aiIntro?: string
  aiTitle?: string
  businessName?: string
  businessTagline?: string
  heroGradientEnd?: string
  heroGradientMid?: string
  heroGradientStart?: string
  intro?: string
  faqTitle?: string
  logoFit?: string
  logoPositionX?: number
  logoPositionY?: number
  logoSize?: number
  logoZoom?: number
  priceDisplay?: string
  showPrices?: boolean
  showCover?: boolean
  showLogo?: boolean
  title?: string
}

interface CatalogMembershipSectionProps {
  copy: CopyFn
}

interface BusinessFact {
  key: string
  label: string
  value?: string
  href?: string
}

interface AboutBlock {
  id: IdValue
  title?: string
  body?: string
  mediaUrl?: string
  type?: string
}

interface CatalogAboutSectionProps {
  copy: CopyFn
  previewConfig: PreviewConfig
  mapEmbedUrl?: string
  addressFact?: BusinessFact | null
  /** The shop's e-mail when the owner shows it (Show email), else empty. */
  emailText?: string
  // The chat entries (Phone, Messenger, Telegram, WhatsApp) and the account entries (Facebook, Instagram, TikTok, Telegram channel, Website): the
  // details card under the story lists both, as tappable rows with the real names.
  contactEntries?: readonly PortalContactEntry[]
  accountEntries?: readonly PortalContactEntry[]
  versionedBusinessLogo?: string
  versionedBusinessCover?: string
  imageFetchPriority?: 'high' | 'low' | 'auto'
  openPortalImage: (title: string, images: string[], index?: number) => void
}

interface FaqItem {
  id: IdValue
  question: string
  answer: string
}

interface CatalogFaqSectionProps {
  copy: CopyFn
  previewConfig: PreviewConfig
  publicFaqItems: FaqItem[]
  expandedFaqId: IdValue | null
  setExpandedFaqId: Dispatch<SetStateAction<IdValue | null>>
  // The chat entries (Phone, Messenger, Telegram, WhatsApp): the FAQ shows them as rows where a Contact button used to be. None: nothing is drawn.
  contactEntries?: readonly PortalContactEntry[]
  faqLoading?: boolean
}

interface AssistantProfile {
  brand: string
  skinType: string
  shoppingFor: string
  goal: string
  concerns: string
}

function toAssistantSelectOptions(values: string[], allLabel: string): AppSelectOption[] {
  return [
    { value: '', label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ]
}

interface AssistantRecommendation {
  product_id: IdValue
  image_path?: string
  name: string
  brand?: string
  category?: string
  selling_price_khr?: number
  selling_price_usd?: number
  reason?: string
  fit_summary?: string
  stock_status?: string
}

interface AssistantResponse {
  summary?: string
  off_topic?: boolean
  followUpQuestions?: string[]
  follow_up_questions?: string[]
  recommendations?: AssistantRecommendation[]
}

interface CatalogAiSectionProps {
  copy: CopyFn
  previewConfig: PreviewConfig
  brands: string[]
  assistantProfile: AssistantProfile
  setAssistantProfile: Dispatch<SetStateAction<AssistantProfile>>
  assistantCategoryOptions: string[]
  assistantQuestion: string
  setAssistantQuestion: (value: string) => void
  questionCharLimit: number
  askAssistant: () => void
  assistantLoading: boolean
  clearAssistantState: () => void
  assistantError?: string
  assistantResponse?: AssistantResponse | null
  // The storefront's product detail sheet; without it a card is plain text.
  openProductById?: (productId: number, productName: string) => void
  // Add a recommended product to the shopper's list (the storefront's bucket). Without it a row has no Add button.
  onAddRecommendation?: (item: { id: number; name: string; shopLine?: string; category: string; brand: string }) => void
  // The loaded catalogue: a result carries only the shop name, so its heading and shop line are resolved from the product here.
  catalogProducts?: ReadonlyArray<{ id: string | number; name?: unknown; description?: unknown }>

  // What /ai/status says about the providers behind the assistant; null until it answers.
  assistantDisclosure?: AiProviderState | null
  assistantDataUseConsent: boolean
  setAssistantDataUseConsent: (value: boolean) => void
}

// The assistant notice the merchant cannot edit away -- see its use below.
const ASSISTANT_AUTOMATED_EN = 'This assistant is automated software, not a member of our team, and it is not medical advice. Your question is sent to a third-party AI provider{providerNames} that processes it outside Cambodia.{providerRetention} Our copy is deleted after 30 days, as our privacy policy sets out. Please leave out personal or medical details. For a skin condition, a reaction, a medicine, or pregnancy, speak to a pharmacist or doctor, and contact the store team for anything about a product.'
const ASSISTANT_AUTOMATED_KM = 'ជំនួយការនេះជាកម្មវិធីស្វ័យប្រវត្តិ មិនមែនបុគ្គលិករបស់យើងទេ ហើយមិនមែនជាការណែនាំវេជ្ជសាស្ត្រឡើយ។ សំណួររបស់អ្នកផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី{providerNames} ដែលដំណើរការក្រៅប្រទេសកម្ពុជា។{providerRetention} ច្បាប់ចម្លងរបស់យើងត្រូវលុបចោលបន្ទាប់ពី ៣០ថ្ងៃ តាមគោលការណ៍ឯកជនភាពរបស់យើង។ សូមកុំបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន ឬព័ត៌មានសុខភាព។ សម្រាប់បញ្ហាស្បែក ប្រតិកម្ម ថ្នាំ ឬការមានផ្ទៃពោះ សូមពិគ្រោះជាមួយឱសថការី ឬវេជ្ជបណ្ឌិត ហើយទាក់ទងក្រុមការងារហាងសម្រាប់សំណួរអំពីផលិតផល។'

// The one-line consent panel shown on the first Send. {providerNames} comes from the one provider map
// (legal/aiProviderDisclosure.ts); the provider's own retention sits in the info popover's full text.
const ASSISTANT_CONSENT_EN = 'Your question and any details go to a third-party AI provider{providerNames} outside Cambodia. Our copy is deleted after 30 days. Leave out personal, medical and payment details.'
const ASSISTANT_CONSENT_KM = 'សំណួរ និងព័ត៌មានលម្អិតរបស់អ្នកត្រូវផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី{providerNames} នៅក្រៅប្រទេសកម្ពុជា។ ច្បាប់ចម្លងរបស់យើងត្រូវលុបចោលបន្ទាប់ពី ៣០ថ្ងៃ។ សូមកុំបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់។'
// The character counter appears only when the box is nearly full.
const ASSISTANT_COUNTER_FROM = 400

type CatalogSecondaryTabsProps = {
  tab?: string
} & Record<string, unknown>

/**
 * Owner-written storefront copy. Phrases the owner wrapped in [[ ]] render
 * inside translate="no" so a browser's page translator leaves them as written;
 * everything else stays translatable (see portalNoTranslate.ts).
 */
function OwnerText({ text }: { text: string }) {
  return (
    <>
      {splitNoTranslateSegments(text).map((segment, index) => (
        segment.noTranslate
          ? <span key={index} translate="no" className="notranslate">{segment.text}</span>
          : <Fragment key={index}>{segment.text}</Fragment>
      ))}
    </>
  )
}

const LEANG_ICON_FALLBACK = '/leang-cosmetics-icon-512-v2.png'

function normalizePortalColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

function CatalogMembershipSection({ copy }: CatalogMembershipSectionProps) {
  return (
    <SectionShell title={copy('membership', 'Membership', 'សមាជិកភាព')}>
      <div className={`flex items-center gap-3 rounded-2xl p-4 text-sm leading-7 text-stone-700 dark:text-neutral-200 ${SURFACE}`}>
        <Ticket aria-hidden="true" className={`h-5 w-5 shrink-0 ${BRASS_TEXT}`} />
        {/* Same row as the signed-in account card; inlined so this chunk never pulls the admin catalog chunk. */}
        <div data-portal-points-row="true">
          {copy('membershipPoints', 'Points', 'ពិន្ទុ')}: <span data-portal-points-value="true">{copy('membershipPointsComingSoon', 'Coming soon', 'នឹងមកដល់ឆាប់ៗនេះ')}</span>
        </div>
      </div>
    </SectionShell>
  )
}

const BRASS_TEXT = 'text-[#9c7a3c] dark:text-amber-300'
// Charcoal fill on ivory text is the storefront's primary button; amber in the dark theme.
const CHARCOAL_BUTTON = PORTAL_PRIMARY_BUTTON
const SURFACE = 'border border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
const ICON_BUTTON = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
// The field recipe (spec section 1). The line is stone-500 / neutral-500, not the stone-400 / neutral-600 the recipe first named: those reach
// only 2.5:1 on a white card and 2.4:1 on the dark one, and a field line must reach 3:1 on the page and on the card.
const FIELD = 'border border-stone-500 bg-white text-[#23201b] placeholder:text-stone-500 focus-visible:border-[#7a5c22] dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400 dark:focus-visible:border-amber-300'

// The owner's photo, laid out by its own shape (utils/aboutCoverLayout.ts) so no frame colour ever shows
// beside it: a wide picture is a full-width banner, a square or tall one sits in a box of its own ratio
// (the hero's left column from md up). Every box is the picture's ratio and the picture fills it
// (object-cover), so there is nothing to letterbox. The settings keep a path, not a size, so the ratio
// is read when the file is in; PublicCatalogPage mounts this card after the file has arrived
// (useCoverState) and the layout is final at once. If that wait runs out, the frame holds a 16:9 box
// until the picture is decoded, never a fixed height a taller picture outgrows (CLS 0.14-0.17).
function AboutCover({ src, imageFetchPriority, onFailed, onShape }: { src: string; imageFetchPriority?: 'high' | 'low' | 'auto'; onFailed: () => void; onShape: (shape: CoverShape | null) => void }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const shape = coverShape(ratio)
  const measure = (image: HTMLImageElement) => {
    const next = coverRatio(image.naturalWidth, image.naturalHeight)
    if (next === null) return
    setRatio(next)
    onShape(coverShape(next))
  }
  const box: CSSProperties | undefined = shape === 'wide'
    ? { aspectRatio: String(ratio), maxHeight: `${COVER_BANNER_MAX_PX}px` }
    : shape === 'tall'
      ? { aspectRatio: String(ratio), ['--cover-ratio' as string]: String(ratio) }
      : undefined
  return (
    <div
      data-portal-about-hero="true"
      data-portal-cover-frame="true"
      data-portal-cover-shape={shape || 'loading'}
      className={shape === 'tall' ? 'p-3 md:w-[460px] md:max-w-[45%] md:shrink-0 md:p-0' : ''}
    >
      <div
        className={`relative w-full overflow-hidden ${shape === 'tall' ? 'mx-auto max-w-[min(100%,460px,calc(60*var(--app-vh)*var(--cover-ratio)))] rounded-xl md:mx-0' : ''} ${shape ? '' : 'aspect-video bg-stone-200 dark:bg-neutral-800'}`}
        style={box}
      >
        <img
          ref={(node) => { if (node && node.complete && node.naturalWidth > 0) measure(node) }}
          src={src}
          alt=""
          aria-hidden="true"
          data-portal-cover="true"
          fetchPriority={imageFetchPriority}
          onLoad={(event) => { event.currentTarget.dataset.loaded = 'true'; measure(event.currentTarget) }}
          onError={onFailed}
          className="portal-cover-image pointer-events-none block h-full w-full object-cover"
        />
      </div>
    </div>
  )
}

// A long story reads better in two columns on a wide screen; a short one stays one block.
const ABOUT_STORY_TWO_COLUMN_FROM = 700

/**
 * Where "Open in Maps" goes: the shop's own Google Maps link when the owner set one, else a plain Maps search for the address, else nothing.
 * Both are https links the visitor opens themselves.
 */
export function portalMapOpenHref(addressLink: unknown, address: unknown): string {
  const link = String(addressLink ?? '').trim()
  // The callers' own rule (normalizeExternalUrl): http or https only. Checked here too so a future caller cannot hand a script URL to an href.
  if (/^https?:\/\//i.test(link)) return link
  const text = String(address ?? '').trim()
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : ''
}

// The address row of the details card: the brass pin, the real address, the whole row a link to the map. It wears the same recipe as a contact row.
function AboutAddressRow({ item }: { item: BusinessFact }) {
  const href = portalMapOpenHref(item.href, item.value)
  const body = (
    <>
      <MapPin aria-hidden="true" className={`h-4 w-4 shrink-0 ${BRASS_TEXT}`} />
      <span className="min-w-0 flex-1 break-words leading-6">
        <span className="sr-only">{item.label}: </span>
        <span translate="no" className="notranslate">{item.value}</span>
      </span>
    </>
  )
  if (!href) return <div className={PORTAL_CONTACT_ROW_INLINE} data-portal-about-address="">{body}</div>
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={PORTAL_CONTACT_ROW_INLINE} data-portal-about-address="" aria-label={`${item.label}: ${item.value}`}>
      {body}
    </a>
  )
}

function AboutEmailRow({ email, copy }: { email: string; copy: CopyFn }) {
  const label = copy('email', 'Email')
  const href = contactHref('mailto', email)
  if (!href) return null
  return (
    <a href={href} className={PORTAL_CONTACT_ROW_INLINE} data-portal-about-email="" aria-label={`${label}: ${email}`}>
      <Mail aria-hidden="true" className={`h-4 w-4 shrink-0 ${BRASS_TEXT}`} />
      <span translate="no" className="notranslate min-w-0 flex-1 break-all leading-6">{email}</span>
    </a>
  )
}

function CatalogAboutSection(props: CatalogAboutSectionProps) {
  const {
    copy,
    previewConfig,
    mapEmbedUrl,
    addressFact,
    emailText = '',
    contactEntries = [],
    accountEntries = [],
    versionedBusinessLogo,
    versionedBusinessCover,
    imageFetchPriority,
    openPortalImage,
  } = props

  const previewTitle = String(previewConfig.businessName || previewConfig.title || '').trim()
  const aboutTitle = previewConfig.aboutTitle || copy('about', 'About')
  // Shopper-voiced fallback: this renders on the PUBLIC About tab when the
  // merchant hasn't written a story yet -- it must never read like an
  // instruction to the merchant (standing public-surface rule).
  const fallbackStory = copy('portalAboutFallback', 'Welcome to our store.')
  const storyText = String(previewConfig.aboutContent || fallbackStory).trim()
  const heroTitle = previewTitle || aboutTitle
  const aboutImage = String(previewConfig.aboutImage || '').trim()
  const aboutImageAlt = String(previewConfig.aboutImageAlt || '').trim()
  // P-public-9: the hero line is the merchant's short intro only. It used to
  // fall back to the story, so a shop without an intro printed its whole story
  // twice -- once under the name and again in the story card below.
  const configuredIntro = String(previewConfig.intro || '').trim()
  const introText = configuredIntro && configuredIntro !== storyText ? configuredIntro : ''
  const aboutBlocks = Array.isArray(previewConfig.aboutBlocks)
    ? previewConfig.aboutBlocks.filter((block) => block?.title || block?.body || block?.mediaUrl)
    : []
  const heroGradientStart = normalizePortalColor(previewConfig.heroGradientStart, '#0f172a')
  const heroGradientMid = normalizePortalColor(previewConfig.heroGradientMid, '#14532d')
  const heroGradientEnd = normalizePortalColor(previewConfig.heroGradientEnd, '#ea580c')
  // 2 Nov (owner): the cover photo shows IN FULL on top of the card; the logo and name sit below it
  // on a plain surface, never over the photo. Without a cover, the brand gradient banner stays. A photo
  // that fails to load falls back to the banner instead of leaving a hole.
  const [failedCover, setFailedCover] = useState('')
  const [coverShapeNow, setCoverShapeNow] = useState<CoverShape | null>(null)
  const hasCover = Boolean(previewConfig.showCover && versionedBusinessCover && failedCover !== versionedBusinessCover)
  const twoColumn = hasCover && coverShapeNow === 'tall'
  const bannerBackground = `linear-gradient(135deg, ${heroGradientStart} 0%, ${heroGradientMid} 55%, ${heroGradientEnd} 100%)`
  const logoSizePx = Math.max(72, Number(previewConfig.logoSize || 80))
  // The same file as the cover: the round logo would only repeat the picture beside it.
  const showRoundLogo = !(hasCover && sameImageFile(versionedBusinessLogo, versionedBusinessCover))
  // The details card: Address, then the chat rows (Phone first), then the account rows; an account already listed as a chat row is not repeated.
  const detailRows = [...contactEntries, ...portalAccountsNotShown(accountEntries, contactEntries)]
  const addressText = String(addressFact?.value || '').trim()
  const aboutEmail = String(emailText || '').trim()
  const hasFacts = Boolean(addressText) || Boolean(aboutEmail) || detailRows.length > 0
  const hasMap = Boolean(mapEmbedUrl)
  const mapOpenHref = portalMapOpenHref(addressFact?.href, addressText)
  const storyInColumns = storyText.length > ABOUT_STORY_TWO_COLUMN_FROM

  return (
    <section className="space-y-4 py-4 sm:py-5">
      <div className={`relative isolate overflow-hidden rounded-2xl ${SURFACE} ${twoColumn ? 'md:flex md:items-center md:gap-8 md:p-6' : ''}`}>
        {hasCover ? (
          <AboutCover
            src={versionedBusinessCover || ''}
            imageFetchPriority={imageFetchPriority}
            onFailed={() => setFailedCover(versionedBusinessCover || '')}
            onShape={setCoverShapeNow}
          />
        ) : (
          <div
            data-portal-about-hero="true"
            className="relative h-20 sm:h-28"
            style={{
              backgroundColor: heroGradientStart,
              backgroundImage: bannerBackground,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}

        <div className={twoColumn ? 'min-w-0 flex-1 px-4 pb-5 md:p-0' : 'relative px-4 pb-5 sm:px-6 sm:pb-6'}>
          <div className="flex items-start gap-3 pt-4 sm:gap-4">
            {showRoundLogo ? (
              <div
                className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-white shadow-sm dark:border-neutral-900 ${hasCover ? '' : '-mt-11 sm:-mt-14'}`}
                style={{ height: `${logoSizePx}px`, width: `${logoSizePx}px` }}
              >
                {previewConfig.showLogo && versionedBusinessLogo ? (
                  <button
                    type="button"
                    className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white"
                    onClick={() => openPortalImage(previewConfig.businessName || copy('logoImage', 'Logo image'), [versionedBusinessLogo])}
                  >
                    <img
                      src={versionedBusinessLogo}
                      alt={previewConfig.businessName || copy('logoImage', 'Logo image')}
                      className="h-full w-full rounded-full"
                      style={{
                        // With the top-bar logo gone (6.2) this hero IS the
                        // live logo surface -- preview == applied runs
                        // through the same shared math, not a hand-rolled
                        // center-origin transform (the focus-slider bug).
                        ...buildLogoImageStyle({
                          fit: previewConfig.logoFit,
                          zoom: previewConfig.logoZoom,
                          positionX: previewConfig.logoPositionX,
                          positionY: previewConfig.logoPositionY,
                        }),
                      }}
                    />
                  </button>
                ) : (
                  <img
                    src={LEANG_ICON_FALLBACK}
                    alt={previewConfig.businessName || copy('logoImage', 'Logo image')}
                    className="h-full w-full rounded-full object-cover"
                  />
                )}
              </div>
            ) : null}

            <div className={`min-w-0 flex-1 ${showRoundLogo ? 'self-center' : ''}`}>
              <h2 className="notranslate break-words text-2xl font-semibold leading-[1.45] tracking-tight text-[#23201b] dark:text-neutral-100 sm:text-3xl" translate="no">
                {heroTitle}
              </h2>
              {previewConfig.businessTagline ? <div className="notranslate mt-0.5 text-sm leading-6 text-stone-600 dark:text-neutral-300" translate="no">{previewConfig.businessTagline}</div> : null}
            </div>
          </div>

          {introText ? (
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600 dark:text-neutral-300 sm:text-base">
              <OwnerText text={introText} />
            </p>
          ) : null}

        </div>
      </div>

      {aboutImage ? (
        <figure data-portal-about-picture="true" className="mx-auto aspect-square w-full max-w-[640px]">
          <button type="button" className="block h-full w-full" onClick={() => openPortalImage(aboutImageAlt || heroTitle, [aboutImage])}>
            <img
              src={aboutImage}
              alt={aboutImageAlt || previewConfig.businessName || aboutTitle}
              className="h-full w-full object-contain"
              loading="eager"
              decoding="async"
              fetchPriority={imageFetchPriority}
            />
          </button>
        </figure>
      ) : null}

      {/* The story takes the full width (two columns on a wide screen when it is long). Directly under it (owner A62, 21 Nov 2026), before the About
          blocks and not only in the footer: one details card (address, the chat rows, the account rows) with the live map beside it on a wide screen,
          stacked on a phone (A63). */}
      {storyText ? (
        <div className={`rounded-2xl p-5 ${SURFACE}`}>
          <div className="text-sm font-semibold leading-6 text-[#23201b] dark:text-neutral-100">{aboutTitle}</div>
          <p className={`mt-2 whitespace-pre-line text-sm leading-7 text-stone-700 dark:text-neutral-300 ${storyInColumns ? 'xl:columns-2 xl:gap-10' : ''}`}>
            <OwnerText text={storyText} />
          </p>
        </div>
      ) : null}

      {hasFacts || hasMap ? (
        <div data-portal-about-details="true" className={`grid gap-4 ${hasFacts && hasMap ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start' : ''}`}>
          {hasFacts ? (
            <div data-portal-contact-tray="true" className={`space-y-2 rounded-2xl p-3 ${SURFACE}`}>
              {addressText ? <AboutAddressRow item={{ ...addressFact, key: 'address', label: addressFact?.label || copy('address', 'Address'), value: addressText }} /> : null}
              <PortalContactRows inline entries={detailRows} copy={copy} className="space-y-2" />
              {aboutEmail ? <AboutEmailRow email={aboutEmail} copy={copy} /> : null}
            </div>
          ) : null}

          {hasMap ? (
            <div data-portal-map-card="true" className={`flex flex-col overflow-hidden rounded-2xl ${SURFACE}`}>
              {/* The live map loads as soon as this tab is shown (no click): 16:9 on a wide screen, 4:3 on a phone, lazy-loaded; Google gets the origin only, never the page path. */}
              <div className="aspect-[4/3] w-full bg-[#f6ece0] sm:aspect-video dark:bg-neutral-800">
                <iframe
                  src={mapEmbedUrl || ''}
                  title={copy('portal_a11y_map_title', "Map showing the shop's location", 'ផែនទីបង្ហាញទីតាំងហាង')}
                  loading="lazy"
                  referrerPolicy={PORTAL_MAP_FRAME_REFERRER}
                  // Google Maps needs scripts and its own origin; it must never navigate the storefront out from under the visitor.
                  sandbox={PORTAL_MAP_FRAME_SANDBOX}
                  className="block h-full w-full border-0"
                  allowFullScreen
                />
              </div>
              {addressText || mapOpenHref ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e3d9c8] bg-[#faf6ef] p-3 dark:border-neutral-700 dark:bg-neutral-800">
                  {addressText ? <p className="min-w-0 flex-1 break-words text-sm leading-6 text-[#23201b] dark:text-neutral-100"><span translate="no" className="notranslate">{addressText}</span></p> : null}
                  {mapOpenHref ? (
                    <a href={mapOpenHref} target="_blank" rel="noreferrer noopener" className={`${CHARCOAL_BUTTON} shrink-0`}>
                      <MapPin aria-hidden="true" className="h-4 w-4" />
                      <span>{copy('openInMaps', 'Open in Maps', 'បើកក្នុងផែនទី')}</span>
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {!storyText && !mapEmbedUrl && !aboutBlocks.length ? (
        <div className={`rounded-2xl p-5 ${SURFACE}`}>
          <p className="text-sm leading-7 text-stone-600 dark:text-neutral-300">{fallbackStory}</p>
        </div>
      ) : null}

      {/* About blocks: alternating media/text rows read as a sequence of
          chapters (workshop, team, milestones, ...) instead of a uniform
          grid of look-alike cards. */}
      {aboutBlocks.length ? (
        <div className="space-y-4">
          {aboutBlocks.map((block, index) => {
            const mediaFirst = index % 2 === 0
            return (
              <div key={block.id} className={`overflow-hidden rounded-2xl ${SURFACE} sm:grid sm:grid-cols-2 sm:items-stretch`}>
                {block.mediaUrl ? (
                  <button
                    type="button"
                    className={`flex w-full items-center justify-center p-4 ${mediaFirst ? 'sm:order-1' : 'sm:order-2'}`}
                    onClick={() => openPortalImage(stripNoTranslateMarkers(block.title) || previewConfig.aboutTitle || copy('about', 'About'), block.mediaUrl ? [block.mediaUrl] : [])}
                  >
                    {block.type === 'video' ? (
                      <video src={block.mediaUrl} controls preload="metadata" className="max-h-[280px] w-full rounded-xl object-contain sm:h-full sm:max-h-none" />
                    ) : (
                      <img src={block.mediaUrl} alt={stripNoTranslateMarkers(block.title) || previewConfig.aboutTitle || copy('about', 'About')} className="max-h-[280px] w-full rounded-xl object-contain sm:h-full sm:max-h-none" />
                    )}
                  </button>
                ) : null}
                <div className={`flex flex-col justify-center space-y-2 p-5 ${block.mediaUrl ? (mediaFirst ? 'sm:order-2' : 'sm:order-1') : 'sm:col-span-2'}`}>
                  {block.title ? <h3 className="text-lg font-semibold leading-8 text-[#23201b] dark:text-neutral-100"><OwnerText text={block.title} /></h3> : null}
                  {block.body ? <p className="whitespace-pre-line text-sm leading-7 text-stone-700 dark:text-neutral-300"><OwnerText text={block.body} /></p> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function FaqSkeleton() {
  return (
    <div className={`mx-auto w-full max-w-3xl rounded-2xl px-4 ${SURFACE}`} data-portal-faq-skeleton="true" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className={`flex min-h-[3.75rem] items-center ${row ? 'border-t border-stone-200 dark:border-neutral-700' : ''}`}>
          <span className="h-4 rounded-full bg-stone-200 motion-safe:animate-pulse dark:bg-neutral-700" style={{ width: `${86 - row * 11}%` }} />
        </div>
      ))}
    </div>
  )
}

export function FaqList(props: {
  copy: CopyFn
  items: FaqItem[]
  expandedFaqId: IdValue | null
  setExpandedFaqId: Dispatch<SetStateAction<IdValue | null>>
  query: string
  setQuery: (value: string) => void
  contactEntries?: readonly PortalContactEntry[]
  loading?: boolean
}) {
  const { copy, items, expandedFaqId, setExpandedFaqId, query, setQuery, contactEntries = [], loading } = props
  const entries = faqEntries(items)
  const searchable = faqSearchVisible(entries.length)
  const activeQuery = searchable ? query.trim() : ''
  const visible = filterFaqEntries(entries, activeQuery)

  if (loading) return <FaqSkeleton />
  if (!entries.length) {
    return (
      <div className={`mx-auto w-full max-w-3xl space-y-3 rounded-2xl px-4 py-3 ${SURFACE}`}>
        <p className="min-w-0 text-sm font-semibold leading-7 text-[#23201b] dark:text-neutral-100">{copy('faqEmptyNone', 'No questions yet.', 'មិនទាន់មានសំណួរនៅឡើយទេ។')}</p>
        <PortalContactRows inline entries={contactEntries} copy={copy} className="grid gap-2 sm:grid-cols-2" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl" data-portal-faq-list="true">
      {searchable ? (
        <div className="relative mb-3">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-600 dark:text-neutral-300" />
          <input
            type="search"
            name="portal_faq_search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={copy('faqSearch', 'Search the questions', 'ស្វែងរកសំណួរ')}
            placeholder={copy('faqSearch', 'Search the questions', 'ស្វែងរកសំណួរ')}
            className={`h-11 w-full rounded-xl pl-10 pr-11 text-sm ${FIELD}`}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-stone-600 dark:text-neutral-300"
              aria-label={copy('clearSearch', 'Reset search', 'សម្អាតការស្វែងរក')}
              title={copy('clearSearch', 'Reset search', 'សម្អាតការស្វែងរក')}
              onClick={() => setQuery('')}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      {visible.length ? (
        <ul className={`m-0 list-none overflow-hidden rounded-2xl p-0 ${SURFACE}`}>
          {visible.map(({ item, index, key }) => {
            const open = expandedFaqId === key
            const answerId = `portal-faq-answer-${index}`
            return (
              <li key={key} className="border-t border-stone-200 first:border-t-0 dark:border-neutral-700">
                <h3 className="m-0">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition hover:bg-[#f6ece0] dark:hover:bg-neutral-800"
                    aria-expanded={open}
                    aria-controls={open ? answerId : undefined}
                    onClick={() => setExpandedFaqId((current) => nextOpenFaqKey(current, key))}
                  >
                    <span
                      {...getKhmerTextProps(item.question, 'min-w-0 text-[15px] font-semibold text-[#23201b] [overflow-wrap:anywhere] dark:text-neutral-100')}
                      style={{ lineHeight: 1.8 }}
                    >
                      {item.question}
                    </span>
                    <ChevronDown aria-hidden="true" className={`mt-1.5 h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${BRASS_TEXT} ${open ? 'rotate-180' : ''}`} />
                  </button>
                </h3>
                {open ? (
                  <div
                    id={answerId}
                    {...getKhmerTextProps(item.answer, 'whitespace-pre-line px-4 pb-4 pr-10 text-sm leading-7 text-stone-700 [overflow-wrap:anywhere] dark:text-neutral-300')}
                    style={{ lineHeight: 1.8 }}
                  >
                    {item.answer}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm text-stone-700 dark:text-neutral-300 ${SURFACE}`} role="status">
          <span className="min-w-0 flex-1 leading-7 [overflow-wrap:anywhere]">{withTypedTerm(copy('faqNoMatch', 'No question matches "{query}"', 'គ្មានសំណួរត្រូវនឹង "{query}" ទេ'), '{query}', activeQuery)}</span>
          <button type="button" className={ICON_BUTTON} aria-label={copy('clearSearch', 'Reset search', 'សម្អាតការស្វែងរក')} title={copy('clearSearch', 'Reset search', 'សម្អាតការស្វែងរក')} onClick={() => setQuery('')}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}

      {contactEntries.length > 0 ? (
        <div className={`mt-4 space-y-3 rounded-2xl px-4 py-3 ${SURFACE}`} data-portal-faq-contact="true">
          <p className="min-w-0 text-base font-semibold leading-8 text-[#23201b] dark:text-neutral-100">{copy('faqStillHeading', 'Still have a question?', 'នៅមានសំណួរទៀតទេ?')}</p>
          <PortalContactRows inline entries={contactEntries} copy={copy} className="grid gap-2 sm:grid-cols-2" />
        </div>
      ) : null}
    </div>
  )
}

function CatalogFaqSection(props: CatalogFaqSectionProps) {
  const { copy, previewConfig, publicFaqItems, expandedFaqId, setExpandedFaqId, contactEntries, faqLoading } = props
  const [query, setQuery] = useState('')

  return (
    <SectionShell title={previewConfig.faqTitle || copy('faq', 'FAQ')}>
      <FaqList
        copy={copy}
        items={publicFaqItems}
        expandedFaqId={expandedFaqId}
        setExpandedFaqId={setExpandedFaqId}
        query={query}
        setQuery={setQuery}
        contactEntries={contactEntries}
        loading={faqLoading}
      />
    </SectionShell>
  )
}

// The consent is read and written through one store, so a blocked browser store never throws.
const consentStore = (): Storage | null => {
  try { return window.localStorage } catch { return null }
}

const CHIP = 'inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm leading-6 transition'
const CHIP_IDLE = 'border-stone-500 bg-white text-[#23201b] hover:border-[#7a5c22] dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-amber-300'
const CHIP_ACTIVE = 'border-[#23201b] bg-[#23201b] text-[#f4f1ea] dark:border-amber-300 dark:bg-amber-300 dark:text-neutral-900'

function AssistantStockBadge({ status, copy }: { status?: string; copy: CopyFn }) {
  if (!status) return null
  const [label, tone] = status === 'out_of_stock'
    ? [copy('outOfStock', 'Out of Stock', 'អស់ស្តុក'), 'text-rose-700 dark:text-rose-300']
    : status === 'low_stock'
      ? [copy('lowStock', 'Low Stock', 'ស្តុកតិច'), 'text-amber-800 dark:text-amber-300']
      : [copy('inStock', 'In Stock', 'មានស្តុក'), 'text-emerald-700 dark:text-emerald-300']
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-2.5 py-0.5 text-xs font-semibold leading-5 dark:border-neutral-700 dark:bg-neutral-900 ${tone}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

// The full disclosure behind the info icon: said once, here. The merchant's own note is editable, so it can
// be shortened to nothing; the app's note is not editable, because what it says is not marketing: the shopper
// is talking to software and not a person, their question leaves the shop, and a skin or health question
// belongs with a pharmacist or a doctor rather than a product recommender (N45). Cosmetics advertising rules
// treat a therapeutic claim as a different product class; the assistant is instructed not to make one, and a
// reader is told what it is either way.
export function AssistantDisclosure({ copy, aiState, language, ownerDisclaimer, onWithdraw }: {
  copy: CopyFn
  aiState: AiProviderState
  language: AiDisclosureLanguage
  ownerDisclaimer: string
  onWithdraw?: () => void
}) {
  return (
    <div data-portal-assistant-info="true" className="space-y-3 text-sm leading-7 text-stone-700 dark:text-neutral-300">
      <p>{fillAiProviderTemplate(language === 'km' ? ASSISTANT_AUTOMATED_KM : ASSISTANT_AUTOMATED_EN, aiState, language)}</p>
      {ownerDisclaimer ? <p>{ownerDisclaimer}</p> : null}
      {onWithdraw ? (
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-500 px-4 text-sm font-semibold text-[#23201b] transition hover:border-[#7a5c22] dark:border-neutral-500 dark:text-neutral-100 dark:hover:border-amber-300"
          onClick={onWithdraw}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          {copy('assistantConsentWithdraw', 'Withdraw consent', 'ដកការយល់ព្រម')}
        </button>
      ) : null}
    </div>
  )
}

// Shown on the first Send of a browser (and again after a new consent version): one line and one button.
export function AssistantConsentPanel({ copy, aiState, language, onAgree }: {
  copy: CopyFn
  aiState: AiProviderState
  language: AiDisclosureLanguage
  onAgree: () => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 dark:border-neutral-700 dark:bg-neutral-900" data-portal-assistant-consent="ask" role="group">
      <p className="min-w-0 flex-1 basis-56 text-sm leading-7 text-stone-700 dark:text-neutral-200">
        {fillAiProviderTemplate(language === 'km' ? ASSISTANT_CONSENT_KM : ASSISTANT_CONSENT_EN, aiState, language)}
      </p>
      <button type="button" className={CHARCOAL_BUTTON} onClick={onAgree}>
        <Check aria-hidden="true" className="h-4 w-4" />
        {copy('assistantAgreeSend', 'Agree and send', 'យល់ព្រម ហើយផ្ញើ')}
      </button>
    </div>
  )
}

function CatalogAiSection(props: CatalogAiSectionProps) {
  const {
    copy,
    previewConfig,
    brands,
    assistantProfile,
    setAssistantProfile,
    assistantCategoryOptions,
    assistantQuestion,
    setAssistantQuestion,
    questionCharLimit,
    askAssistant,
    assistantLoading,
    clearAssistantState,
    assistantError,
    assistantResponse,
    openProductById,
    onAddRecommendation,
    catalogProducts,
    assistantDisclosure,
    assistantDataUseConsent,
    setAssistantDataUseConsent,
  } = props
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [consentPanel, setConsentPanel] = useState(false)
  const [sendAfterConsent, setSendAfterConsent] = useState(false)
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set())
  const questionRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!assistantDataUseConsent && aiConsentGiven(consentStore())) setAssistantDataUseConsent(true)
    // Restore once on mount; the parent owns the live flag afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // askAssistant checks the consent flag of the render it belongs to, so "Agree and send" sends from the
  // render that already carries the new flag, never from the one that was still waiting for it.
  useEffect(() => {
    if (!sendAfterConsent || !assistantDataUseConsent) return
    setSendAfterConsent(false)
    askAssistant()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendAfterConsent, assistantDataUseConsent])

  // The box grows with its text (two rows to start, then up to 12 rem).
  useLayoutEffect(() => {
    const box = questionRef.current
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${Math.min(box.scrollHeight, 192)}px`
  }, [assistantQuestion])

  const changeConsent = (next: boolean) => {
    setAssistantDataUseConsent(next)
    saveAiConsent(consentStore(), next)
  }
  const send = () => {
    if (assistantLoading) return
    // An empty box is answered by askAssistant's own "ask a question first"; consent is asked only for a real question.
    if (!assistantDataUseConsent && assistantQuestion.trim()) {
      setConsentPanel(true)
      return
    }
    askAssistant()
  }
  const agreeAndSend = () => {
    changeConsent(true)
    setConsentPanel(false)
    setSendAfterConsent(true)
  }
  const fillExample = (text: string) => {
    setAssistantQuestion(text)
    questionRef.current?.focus()
  }

  const aiState: AiProviderState = assistantDisclosure || { kind: 'unknown' }
  // copy() answers in the storefront language; asking it for 'en' / 'ខ្មែរ' tells this section which wording to build.
  const language: AiDisclosureLanguage = copy('aiPolicyLanguage', 'en', 'ខ្មែរ') === 'ខ្មែរ' ? 'km' : 'en'
  const title = previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')
  const tagline = previewConfig.aiIntro || copy('assistantTagline', 'AI suggestions, not medical advice.', 'ការណែនាំពី AI មិនមែនជាយោបល់វេជ្ជសាស្ត្រទេ។')
  const defaultDisclaimer = copy('aiDisclaimer', 'Written by AI, for reference only. For exact answers, please contact our shop on Instagram or Facebook.')
  // The editor preview passes the config unlocalized, so a stored copy of an earlier default is mapped here too and never shows as the owner's own note.
  const ownerDisclaimer = String(defaultConfigText(language, 'aiDisclaimer', previewConfig.aiDisclaimer) || '').trim()
  const infoLabel = copy('assistantInfo', 'About the assistant', 'អំពីជំនួយការ')
  const labelClass = 'block text-sm font-medium leading-6 text-stone-700 dark:text-neutral-200'
  const detailsLabel = copy('assistantAddDetails', 'Add details', 'បន្ថែមព័ត៌មាន')
  const questionLabel = copy('assistantQuestion', 'What would you like help finding?', 'តើអ្នកចង់ឲ្យជួយរកអ្វី?')
  // Fixed options are chips; the stored skin-type values stay the English words the Worker prompt expects.
  const skinTypes = [
    { value: 'Dry', label: copy('skinDry', 'Dry', 'ស្ងួត') },
    { value: 'Oily', label: copy('skinOily', 'Oily', 'ខ្លាញ់') },
    { value: 'Combination', label: copy('skinCombination', 'Combination skin', 'ស្បែកចម្រុះ') },
    { value: 'Sensitive', label: copy('skinSensitive', 'Sensitive', 'ងាយប្រតិកម្ម') },
    { value: 'Normal', label: copy('skinNormal', 'Normal', 'ធម្មតា') },
    { value: 'Acne-prone', label: copy('skinAcneProne', 'Acne-prone', 'ងាយកើតមុន') },
  ]
  const examples = [
    copy('assistantExample1', 'A gentle daily sunscreen for oily skin', 'ឡេការពារកម្ដៅថ្ងៃទន់ភ្លន់ សម្រាប់ស្បែកខ្លាញ់'),
    copy('assistantExample2', 'A moisturiser for dry, sensitive skin', 'ក្រែមផ្តល់សំណើម សម្រាប់ស្បែកស្ងួត ងាយប្រតិកម្ម'),
    copy('assistantExample3', 'A gentle cleanser for acne-prone skin', 'ផលិតផលលាងមុខទន់ភ្លន់ សម្រាប់ស្បែកងាយកើតមុន'),
    copy('assistantExample4', 'A long-wear lipstick in a natural shade', 'ក្រហមមាត់ជាប់យូរ ពណ៌ធម្មជាតិ'),
  ]

  return (
    <section data-portal-assistant="true" className="mx-auto w-full max-w-[720px] py-5">
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold leading-8 text-[#23201b] dark:text-neutral-100">{title}</h2>
        <LazyPortalMenu
          align="auto"
          menuClassName="w-[min(24rem,calc(100vw-1.5rem))] p-4"
          trigger={(
            <button type="button" className={ICON_BUTTON} aria-label={infoLabel} title={infoLabel}>
              <Info aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          content={({ closeMenu }) => (
            <AssistantDisclosure
              copy={copy}
              aiState={aiState}
              language={language}
              ownerDisclaimer={ownerDisclaimer && ownerDisclaimer !== defaultDisclaimer ? ownerDisclaimer : ''}
              onWithdraw={assistantDataUseConsent ? () => { changeConsent(false); closeMenu() } : undefined}
            />
          )}
        />
      </div>
      <p className="text-sm leading-7 text-stone-600 dark:text-neutral-300">{tagline}</p>

      <div className={`mt-4 rounded-2xl p-4 ${SURFACE}`}>
        <label htmlFor="portal-assistant-question" className="sr-only">{questionLabel}</label>
        {!assistantQuestion ? (
          <div className="mb-3 flex flex-wrap gap-2" data-portal-assistant-examples="true">
            {examples.map((text) => (
              <button key={text} type="button" className={`${CHIP} ${CHIP_IDLE}`} onClick={() => fillExample(text)}>
                {text}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={questionRef}
          id="portal-assistant-question"
          name="portal_assistant_question"
          autoComplete="off"
          rows={2}
          maxLength={questionCharLimit}
          value={assistantQuestion}
          onChange={(event) => setAssistantQuestion(event.target.value)}
          placeholder={questionLabel}
          className={`block max-h-48 min-h-[4.5rem] w-full resize-none overflow-y-auto rounded-xl px-3.5 py-2.5 text-sm leading-7 ${FIELD}`}
        />
        {assistantQuestion.length > ASSISTANT_COUNTER_FROM ? (
          <div className="mt-1 text-right text-xs leading-6 text-stone-600 dark:text-neutral-300">{assistantQuestion.length}/{questionCharLimit}</div>
        ) : null}

        {detailsOpen ? (
          <div className="mt-3 space-y-3" data-portal-assistant-details="true">
            <div>
              <div className={labelClass}>{copy('assistantSkinType', 'Skin type', 'ប្រភេទស្បែក')}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {skinTypes.map((option) => {
                  const active = assistantProfile.skinType === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      className={`${CHIP} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
                      onClick={() => setAssistantProfile((current) => ({ ...current, skinType: active ? '' : option.value }))}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-assistant-brand" className={labelClass}>{copy('assistantBrand', 'Preferred brand', 'ម៉ាកដែលចូលចិត្ត')}</label>
                <AppSelect
                  id="portal-assistant-brand"
                  name="portal_assistant_brand"
                  value={assistantProfile.brand}
                  onChange={(nextValue) => setAssistantProfile((current) => ({ ...current, brand: nextValue }))}
                  ariaLabel={copy('assistantBrand', 'Preferred brand', 'ម៉ាកដែលចូលចិត្ត')}
                  className="mt-1 w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[12rem]"
                  options={toAssistantSelectOptions(brands, copy('all', 'All'))}
                />
              </div>
              <div>
                <label htmlFor="portal-assistant-shopping-for" className={labelClass}>{copy('assistantShoppingFor', 'Shopping for', 'កំពុងរកទិញ')}</label>
                <AppSelect
                  id="portal-assistant-shopping-for"
                  name="portal_assistant_shopping_for"
                  value={assistantProfile.shoppingFor}
                  onChange={(nextValue) => setAssistantProfile((current) => ({ ...current, shoppingFor: nextValue }))}
                  ariaLabel={copy('assistantShoppingFor', 'Shopping for', 'កំពុងរកទិញ')}
                  className="mt-1 w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[12rem]"
                  options={toAssistantSelectOptions(assistantCategoryOptions, copy('all', 'All'))}
                />
              </div>
              <div>
                <label htmlFor="portal-assistant-goal" className={labelClass}>{copy('assistantGoal', 'Goal / use case', 'គោលដៅ / ការប្រើប្រាស់')}</label>
                <input id="portal-assistant-goal" name="portal_assistant_goal" autoComplete="off" className={`mt-1 h-10 w-full rounded-xl px-3 text-sm ${FIELD}`} maxLength={180} value={assistantProfile.goal} onChange={(event) => setAssistantProfile((current) => ({ ...current, goal: event.target.value }))} placeholder={copy('assistantGoalPlaceholder', 'Daily use, brightening, long wear...', 'ប្រើរាល់ថ្ងៃ ធ្វើឲ្យស្បែកភ្លឺ ឬជាប់បានយូរ...')} />
              </div>
              <div>
                <label htmlFor="portal-assistant-concerns" className={labelClass}>{copy('assistantConcerns', 'Skin concerns', 'បញ្ហាស្បែក')}</label>
                <input id="portal-assistant-concerns" name="portal_assistant_concerns" autoComplete="off" className={`mt-1 h-10 w-full rounded-xl px-3 text-sm ${FIELD}`} maxLength={220} value={assistantProfile.concerns} onChange={(event) => setAssistantProfile((current) => ({ ...current, concerns: event.target.value }))} placeholder={copy('assistantConcernsPlaceholder', 'Acne, sensitivity, dark spots, dryness...', 'មុន ស្បែកងាយប្រតិកម្ម ស្នាមខ្មៅ ឬស្បែកស្ងួត...')} />
              </div>
            </div>
          </div>
        ) : null}

        {consentPanel && !assistantDataUseConsent ? <AssistantConsentPanel copy={copy} aiState={aiState} language={language} onAgree={agreeAndSend} /> : null}

        <div className="mt-3 flex items-center gap-1">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
            {detailsLabel}
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={clearAssistantState}
            aria-label={copy('assistantReset', 'Clear the question and answer')}
            title={copy('assistantReset', 'Clear the question and answer')}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </button>
          <button type="button" className={`${CHARCOAL_BUTTON} ml-auto whitespace-nowrap`} onClick={send} disabled={assistantLoading}>
            <Send aria-hidden="true" className="h-4 w-4" />
            {/* Google rewrites text nodes, so a label that changes is remounted (keyed), never updated in place. */}
            <span key={assistantLoading ? 'wait' : 'send'}>{assistantLoading ? copy('assistantLoading', 'Please wait…') : copy('assistantSend', 'Send', 'ផ្ញើ')}</span>
          </button>
        </div>
      </div>

      {assistantError ? <div role="alert" className="mt-4 rounded-2xl border border-rose-400 bg-white px-4 py-3 text-sm leading-7 text-rose-700 dark:border-rose-500 dark:bg-neutral-900 dark:text-rose-300">{assistantError}</div> : null}

      {assistantResponse?.summary ? (
        <div className={`mt-4 rounded-2xl p-4 ${SURFACE}`}>
          <div className="text-xs font-semibold leading-6 text-stone-600 dark:text-neutral-300">{copy('assistantResults', 'Suggested products')}</div>
          <p translate="no" className="notranslate mt-1 text-sm leading-7 text-stone-700 dark:text-neutral-300">{assistantResponse.summary}</p>
          {/* Backend returns follow_up_questions (snake_case); the camelCase followUpQuestions was
              pre-existing dead UI since askPortalAi returns the raw JSON body with no key remapping.
              Reading either shape fixes that without a wider camelCase pass across the contract. */}
          {(assistantResponse.followUpQuestions?.length || assistantResponse.follow_up_questions?.length) ? (
            <div className="mt-3">
              <div className="text-xs font-semibold leading-6 text-stone-600 dark:text-neutral-300">{copy('assistantFollowUps', 'Helpful follow-up questions')}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(assistantResponse.followUpQuestions || assistantResponse.follow_up_questions || []).map((question) => (
                  <button key={question} type="button" translate="no" className={`notranslate ${CHIP} ${CHIP_IDLE}`} onClick={() => setAssistantQuestion(question)}>
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {assistantResponse?.recommendations?.length ? (
        <div className="mt-4 space-y-3" data-portal-assistant-products="true">
          {assistantResponse.recommendations.map((item) => {
            const servedPrice = previewConfig.showPrices === true
              ? (previewConfig.priceDisplay === 'KHR' ? item.selling_price_khr : item.selling_price_usd)
              : undefined
            const priceLabel = typeof servedPrice === 'number' && Number.isFinite(servedPrice)
              ? (previewConfig.priceDisplay === 'KHR' ? `${servedPrice.toLocaleString()}៛` : `$${normalizePriceValue(servedPrice).toFixed(2)}`)
              : ''
            const productId = Number(item.product_id)
            const canOpen = Boolean(openProductById) && Number.isFinite(productId)
            const addKey = String(item.product_id)
            const meta = [portalPrimaryValue(item.brand), portalPrimaryValue(item.category)].filter(Boolean).join(' · ')
            const { heading, shopLine } = assistantRowNames(item, catalogProducts)
            const open = () => openProductById?.(productId, item.name)
            return (
              <article key={item.product_id} className={`rounded-2xl p-3 ${SURFACE}`}>
                <div className="flex items-center gap-3">
                  {canOpen ? (
                    <button type="button" className="shrink-0 rounded-xl" onClick={open} aria-label={`${copy('assistantViewProduct', 'View product', 'មើលផលិតផល')}: ${heading}`}>
                      <AssistantThumb item={item} />
                    </button>
                  ) : <AssistantThumb item={item} />}
                  <div className="min-w-0 flex-1">
                    {canOpen ? (
                      <button type="button" translate="no" aria-label={heading} className="notranslate block max-w-full break-words text-left text-sm font-semibold leading-6 text-[#23201b] dark:text-neutral-100" onClick={open}>{heading}</button>
                    ) : <div translate="no" className="notranslate break-words text-sm font-semibold leading-6 text-[#23201b] dark:text-neutral-100">{heading}</div>}
                    {shopLine ? <div translate="no" className="notranslate break-words text-xs leading-5 text-stone-600 dark:text-neutral-300">{shopLine}</div> : null}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-6 text-stone-600 dark:text-neutral-300">
                      {meta ? <span translate="no" className="notranslate">{meta}</span> : null}
                      {priceLabel ? <span translate="no" className="notranslate">{priceLabel}</span> : null}
                      <AssistantStockBadge status={item.stock_status} copy={copy} />
                    </div>
                  </div>
                  {onAddRecommendation && Number.isFinite(productId) ? (
                    <button
                      type="button"
                      className={`${CHARCOAL_BUTTON} shrink-0 px-4`}
                      disabled={item.stock_status === 'out_of_stock'}
                      onClick={() => {
                        onAddRecommendation({ id: productId, name: heading, ...(shopLine ? { shopLine } : {}), category: item.category || '', brand: item.brand || '' })
                        setAdded((current) => new Set(current).add(addKey))
                      }}
                    >
                      {added.has(addKey) ? <Check aria-hidden="true" className="h-4 w-4" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
                      {/* Google rewrites text nodes, so a label that changes is remounted (keyed), never updated in place. */}
                      <span key={added.has(addKey) ? 'in' : 'add'}>{added.has(addKey) ? copy('inList', 'In list', 'ក្នុងបញ្ជី') : copy('addToList', 'Add', 'បន្ថែម')}</span>
                    </button>
                  ) : null}
                </div>
                {item.reason ? <p translate="no" className="notranslate mt-2 text-sm leading-7 text-stone-600 dark:text-neutral-300">{item.reason}</p> : null}
                {item.fit_summary ? <p className="mt-1 text-sm leading-7 text-stone-700 dark:text-neutral-300"><span className="font-semibold text-[#23201b] dark:text-neutral-100">{copy('assistantWhy', 'Why recommended')}:</span> <span translate="no" className="notranslate">{item.fit_summary}</span></p> : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function AssistantThumb({ item }: { item: AssistantRecommendation }) {
  return item.image_path ? (
    <img src={item.image_path} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-stone-300 object-cover dark:border-neutral-700" />
  ) : (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-stone-300 text-stone-600 dark:border-neutral-700 dark:text-neutral-300" aria-hidden="true">
      <ShoppingBag className="h-5 w-5" />
    </div>
  )
}

export default function CatalogSecondaryTabs({ tab, ...props }: CatalogSecondaryTabsProps) {
  if (tab === 'membership') return <CatalogMembershipSection {...(props as unknown as CatalogMembershipSectionProps)} />
  if (tab === 'about') return <CatalogAboutSection {...(props as unknown as CatalogAboutSectionProps)} />
  if (tab === 'faq') return <CatalogFaqSection {...(props as unknown as CatalogFaqSectionProps)} />
  if (tab === 'ai') return <CatalogAiSection {...(props as unknown as CatalogAiSectionProps)} />
  return null
}

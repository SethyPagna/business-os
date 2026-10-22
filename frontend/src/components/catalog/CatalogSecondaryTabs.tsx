import { Fragment, useEffect, useState } from 'react'
import type { ComponentType, Dispatch, SetStateAction } from 'react'
import { buildLogoImageStyle } from './logoImageStyle'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import { PORTAL_SOCIAL_ICONS, PortalSocialText } from './PortalSocialRow.tsx'
import type { SocialPlatform } from '../../utils/socialHandles.ts'
import PortalEmbedConsent from './legal/PortalEmbedConsent.tsx'
import { SectionShell } from './catalogUi'
import { splitNoTranslateSegments, stripNoTranslateMarkers } from './portalNoTranslate.ts'
import { faqEntries, faqSearchVisible, filterFaqEntries, nextOpenFaqKey } from './portalFaqLayout.ts'
import { derivePhoneCallLink } from '../../utils/socialLinks.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { aiProviderNames, fillAiProviderTemplate } from './legal/aiProviderDisclosure.ts'
import { getClientIdentity } from '../../app/clientIdentity.ts'
import type { AiDisclosureLanguage, AiProviderState } from './legal/aiProviderDisclosure.ts'

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
  icon?: ComponentType<{ className?: string }>
}

interface SocialLink {
  key: string
  label: string
  value: string
  platform?: string
  accessibleName?: string
  latin?: boolean
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
  businessFacts?: BusinessFact[]
  socialLinks?: SocialLink[]
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
  // Both optional: a surface without a contact sheet simply shows no button.
  onOpenContact?: () => void
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
  replaceVars: (template: string, values: Record<string, string | number>) => string
  assistantError?: string
  assistantResponse?: AssistantResponse | null
  // The storefront's product detail sheet; without it a card is plain text.
  openProductById?: (productId: number, productName: string) => void
  // What /ai/status says about the providers behind the assistant; null until it answers.
  assistantDisclosure?: AiProviderState | null
  assistantDataUseConsent: boolean
  setAssistantDataUseConsent: (value: boolean) => void
}

// The assistant notice the merchant cannot edit away -- see its use below.
const ASSISTANT_AUTOMATED_EN = 'This assistant is automated software, not a member of our team, and it is not medical advice. Your question is sent to a third-party AI provider{providerNames} that processes it outside Cambodia.{providerRetention} Our copy is deleted after 30 days, as our privacy policy sets out. Please leave out personal or medical details. For a skin condition, a reaction, a medicine, or pregnancy, speak to a pharmacist or doctor, and contact the store team for anything about a product.'
const ASSISTANT_AUTOMATED_KM = 'ជំនួយការនេះជាកម្មវិធីស្វ័យប្រវត្តិ មិនមែនបុគ្គលិករបស់យើងទេ ហើយមិនមែនជាការណែនាំវេជ្ជសាស្ត្រឡើយ។ សំណួររបស់អ្នកផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី{providerNames} ដែលដំណើរការក្រៅប្រទេសកម្ពុជា។{providerRetention} ច្បាប់ចម្លងរបស់យើងត្រូវលុបចោលបន្ទាប់ពី ៣០ថ្ងៃ តាមគោលការណ៍ឯកជនភាពរបស់យើង។ សូមកុំបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន ឬព័ត៌មានសុខភាព។ សម្រាប់បញ្ហាស្បែក ប្រតិកម្ម ថ្នាំ ឬការមានផ្ទៃពោះ សូមពិគ្រោះជាមួយឱសថការី ឬវេជ្ជបណ្ឌិត ហើយទាក់ទងក្រុមការងារហាងសម្រាប់សំណួរអំពីផលិតផល។'

// The consent line beside the Send button. {providerNames} and {providerRetention}
// come from the one provider map (legal/aiProviderDisclosure.ts).
const ASSISTANT_CONSENT_EN = 'I understand that my question and optional shopping preferences are sent to a third-party AI provider{providerNames} and processed outside Cambodia.{providerRetention} Our copy is deleted after 30 days. I will not include personal, medical, or payment details.'
const ASSISTANT_CONSENT_KM = 'ខ្ញុំយល់ថាសំណួរ និងចំណូលចិត្តទិញទំនិញស្រេចចិត្តរបស់ខ្ញុំត្រូវបានផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបី{providerNames} ហើយដំណើរការក្រៅប្រទេសកម្ពុជា។{providerRetention} ច្បាប់ចម្លងរបស់យើងត្រូវលុបចោលបន្ទាប់ពី ៣០ថ្ងៃ។ ខ្ញុំនឹងមិនបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ទេ។'

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

const SHOP_ICON_FALLBACK = getClientIdentity().shopIcons.icon512

function normalizePortalColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

function CatalogMembershipSection({ copy }: CatalogMembershipSectionProps) {
  return (
    <SectionShell title={copy('membership', 'Membership', 'សមាជិកភាព')}>
      <div className="flex items-center gap-3 rounded-[28px] border border-slate-200/80 bg-white p-6 text-sm text-slate-700 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-900 dark:text-neutral-200">
        <Ticket aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-500 dark:text-amber-300" />
        {/* Same row as the signed-in account card; inlined so this chunk never pulls the admin catalog chunk. */}
        <div data-portal-points-row="true">
          {copy('membershipPoints', 'Points', 'ពិន្ទុ')}: <span data-portal-points-value="true">{copy('membershipPointsComingSoon', 'Coming soon', 'នឹងមកដល់ឆាប់ៗនេះ')}</span>
        </div>
      </div>
    </SectionShell>
  )
}

function CatalogAboutSection(props: CatalogAboutSectionProps) {
  const {
    copy,
    previewConfig,
    mapEmbedUrl,
    addressFact,
    businessFacts,
    socialLinks,
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
  // A shorter brand-color banner with the logo overlapping its lower edge,
  // and everything else (name, tagline, story, facts) living on a plain
  // surface below rather than layered on top of the image/gradient --
  // avoids the old full-bleed hero's white-text-on-photo legibility fight,
  // and reads closer to a modern profile page than a dashboard splash.
  // 6.1 (user): with a cover set, the IMAGE stands alone -- no colour
  // gradient laid over it -- and it backs the WHOLE about card, not just
  // the top strip (the content below sits on a translucent surface for
  // legibility). Without a cover, the brand gradient banner stays.
  const hasCover = Boolean(previewConfig.showCover && versionedBusinessCover)
  const bannerBackground = `linear-gradient(135deg, ${heroGradientStart} 0%, ${heroGradientMid} 55%, ${heroGradientEnd} 100%)`
  const logoSizePx = Math.max(72, Number(previewConfig.logoSize || 80))
  const hasContactInfo = Boolean(businessFacts?.length || socialLinks?.length)

  return (
    <section
      className="space-y-4 rounded-[36px] p-3 sm:p-5"
      style={{
        // Subtle backdrop for the whole About tab, echoing the hero's own
        // brand-color gradient at very low opacity so the section reads as
        // one cohesive page rather than a stack of unrelated white cards
        // dropped on the plain portal background.
        backgroundImage: `radial-gradient(circle at 15% 0%, ${heroGradientStart}14 0%, transparent 45%), radial-gradient(circle at 100% 20%, ${heroGradientEnd}12 0%, transparent 50%)`,
      }}
    >
      <div className="relative isolate overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_18px_42px_rgba(148,163,184,0.14)] dark:border-neutral-700/80 dark:bg-neutral-900/88">
        {hasCover ? (
          <img
            src={versionedBusinessCover}
            alt=""
            aria-hidden="true"
            data-portal-cover="true"
            fetchPriority={imageFetchPriority}
            onLoad={(event) => { event.currentTarget.dataset.loaded = 'true' }}
            className="portal-cover-image pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
          />
        ) : null}
        <div
          data-portal-about-hero="true"
          className="relative h-20 sm:h-28"
          style={hasCover ? undefined : {
            backgroundColor: heroGradientStart,
            backgroundImage: bannerBackground,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />

        <div className={`relative px-5 pb-5 sm:px-8 sm:pb-8 ${hasCover ? 'bg-white/90 backdrop-blur-sm dark:bg-neutral-900/85' : ''}`}>
          <div className="-mt-7 flex flex-wrap items-end gap-3 sm:-mt-9 sm:gap-4">
            <div
              className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] dark:border-neutral-900"
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
                  src={SHOP_ICON_FALLBACK}
                  alt={previewConfig.businessName || copy('logoImage', 'Logo image')}
                  className="h-full w-full rounded-full object-cover"
                />
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <h2 className="notranslate break-words text-2xl font-semibold leading-[1.35] tracking-tight text-slate-900 dark:text-neutral-100 sm:text-3xl" translate="no">
                {heroTitle}
              </h2>
              {previewConfig.businessTagline ? <div className="notranslate mt-1 text-sm text-slate-500 dark:text-neutral-400" translate="no">{previewConfig.businessTagline}</div> : null}
            </div>
          </div>

          {introText ? (
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600 dark:text-neutral-300 sm:text-base sm:leading-7">
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

      {/* Quick-info card (facts + socials, moved out of the hero banner so
          it doesn't compete with the name/tagline for space) on the left,
          the business story/description on the right per the requested
          layout. The map is intentionally NOT in this row -- it gets its
          own full-width section below instead of sitting beside either
          column, so a long story never squeezes it down to a sliver. */}
      <div className="grid gap-4 lg:grid-cols-[1fr,1.4fr] lg:items-start">
        {/* Story first in the DOM (P-public-9) so a phone, which stacks this
            row, reads the story before the contact details; lg:order keeps
            the requested desktop layout. */}
        {storyText ? (
          <div className={`rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-800 lg:order-2 ${hasContactInfo ? '' : 'lg:col-span-2'}`}>
            <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{aboutTitle}</div>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-neutral-300">
              <OwnerText text={storyText} />
            </p>
          </div>
        ) : null}
        {hasContactInfo ? (
          <div data-portal-contact-tray="true" className={`space-y-3 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 lg:order-1 ${storyText ? '' : 'lg:col-span-2'}`}>
            {businessFacts?.length ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {businessFacts.map((item) => {
                  const Icon = item.icon || (item.key === 'phone'
                    ? Phone
                    : item.key === 'email'
                      ? Mail
                      : MapPin)
                  const body = (
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 transition hover:border-slate-300 hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800/60 dark:hover:bg-neutral-800">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm dark:bg-neutral-900 dark:text-neutral-300">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        {/* The field name ("Phone", "Address", ...) is the
                            only thing that says what the value beside it is,
                            so it is real copy, not decoration: slate-400 is
                            2.56:1 on this card and neutral-500 is 3.29:1 on
                            the dark one. slate-500/neutral-400 is the muted
                            pair the rest of the storefront settled on. */}
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-neutral-400">{item.label}</div>
                        <div className={`portal-contact-value text-sm font-medium text-slate-800 dark:text-neutral-100 ${item.key === 'address' ? 'portal-contact-value-address' : ''}`} title={item.value}>{item.value}</div>
                      </div>
                    </div>
                  )
                  // The dialer link is rebuilt from the number so spaces and dashes in the saved value never reach the tel: URI.
                  const href = item.key === 'phone' ? derivePhoneCallLink(item.value || '') || item.href : item.href
                  return href ? <a key={item.key} href={href} target={href.startsWith('tel:') ? undefined : '_blank'} rel={href.startsWith('tel:') ? undefined : 'noreferrer'} className="block">{body}</a> : <div key={item.key}>{body}</div>
                })}
              </div>
            ) : null}
            {socialLinks?.length ? (
              <div className="flex flex-wrap gap-2">
                {socialLinks.map((item) => {
                  const Icon = PORTAL_SOCIAL_ICONS[(item.platform ?? item.key) as SocialPlatform] || Globe
                  return (
                    <a
                      key={item.key}
                      href={item.value}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      aria-label={item.accessibleName || item.label}
                      title={item.accessibleName || item.label}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <PortalSocialText text={item.label} latin={item.latin ?? true} />
                    </a>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Map now sits full-width below the facts/description row instead
          of squeezed beside the story text. */}
      {mapEmbedUrl ? (
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 dark:border-neutral-800">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
              <MapPin className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{copy('mapCard', 'Store map')}</div>
              {addressFact?.value ? <div className="text-xs text-slate-500 dark:text-neutral-400">{addressFact.value}</div> : null}
            </div>
          </div>
          {/* N45: the map is the storefront's only automatically-loading
              third party, so it waits for a click instead of fetching Google
              the moment this tab renders. Declining is a plain link, not a
              dead end. */}
          <PortalEmbedConsent
            copy={copy}
            src={mapEmbedUrl}
            title={copy('portal_a11y_map_title', "Map showing the shop's location", 'ផែនទីបង្ហាញទីតាំងហាង')}
            address={addressFact?.value || ''}
          />
        </div>
      ) : null}
      {!storyText && !mapEmbedUrl && !aboutBlocks.length ? (
        <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-800">
          <p className="text-sm text-slate-500 dark:text-neutral-400">{fallbackStory}</p>
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
              <div key={block.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90 sm:grid sm:grid-cols-2 sm:items-stretch">
                {block.mediaUrl ? (
                  <button
                    type="button"
                    className={`flex w-full items-center justify-center bg-slate-50 p-4 dark:bg-neutral-950/60 ${mediaFirst ? 'sm:order-1' : 'sm:order-2'}`}
                    onClick={() => openPortalImage(stripNoTranslateMarkers(block.title) || previewConfig.aboutTitle || copy('about', 'About'), block.mediaUrl ? [block.mediaUrl] : [])}
                  >
                    {block.type === 'video' ? (
                      <video src={block.mediaUrl} controls preload="metadata" className="max-h-[280px] w-full rounded-2xl bg-white object-contain dark:bg-neutral-950 sm:h-full sm:max-h-none" />
                    ) : (
                      <img src={block.mediaUrl} alt={stripNoTranslateMarkers(block.title) || previewConfig.aboutTitle || copy('about', 'About')} className="max-h-[280px] w-full rounded-2xl object-contain sm:h-full sm:max-h-none" />
                    )}
                  </button>
                ) : null}
                <div className={`flex flex-col justify-center space-y-3 p-6 ${block.mediaUrl ? (mediaFirst ? 'sm:order-2' : 'sm:order-1') : 'sm:col-span-2'}`}>
                  {block.title ? <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100"><OwnerText text={block.title} /></h3> : null}
                  {block.body ? <p className="whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-neutral-300"><OwnerText text={block.body} /></p> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

const BRASS_TEXT = 'text-[#9c7a3c] dark:text-amber-300'
// Charcoal fill on ivory text is the storefront's primary button; amber in the dark theme.
const CHARCOAL_BUTTON = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#23201b] px-5 text-sm font-semibold text-[#f4f1ea] transition hover:bg-[#3a352c] dark:bg-amber-300 dark:text-neutral-900 dark:hover:bg-amber-200'

function FaqContactButton({ copy, onOpenContact }: { copy: CopyFn; onOpenContact?: () => void }) {
  if (!onOpenContact) return null
  return (
    <button type="button" className={CHARCOAL_BUTTON} onClick={onOpenContact}>
      <MessageCircle aria-hidden="true" className="h-4 w-4" />
      {copy('contactUs', 'Contact us', 'ទាក់ទងយើង')}
    </button>
  )
}

function FaqSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl" data-portal-faq-skeleton="true" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex min-h-[3.75rem] items-center border-b border-stone-200 dark:border-neutral-700">
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
  onOpenContact?: () => void
  loading?: boolean
}) {
  const { copy, items, expandedFaqId, setExpandedFaqId, query, setQuery, onOpenContact, loading } = props
  const entries = faqEntries(items)
  const searchable = faqSearchVisible(entries.length)
  const activeQuery = searchable ? query.trim() : ''
  const visible = filterFaqEntries(entries, activeQuery)

  if (loading) return <FaqSkeleton />
  if (!entries.length) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-stone-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900/90">
        <p className="text-sm font-semibold text-[#23201b] dark:text-neutral-100">{copy('faqEmptyNone', 'No questions yet.', 'មិនទាន់មានសំណួរនៅឡើយទេ។')}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-300">{copy('faqStillBody', 'Ask our team and we will answer.', 'សួរក្រុមការងាររបស់យើង ហើយយើងនឹងឆ្លើយ។')}</p>
        <div className="mt-4 flex justify-center"><FaqContactButton copy={copy} onOpenContact={onOpenContact} /></div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl" data-portal-faq-list="true">
      {searchable ? (
        <div className="relative mb-2">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-neutral-400" />
          <input
            type="search"
            name="portal_faq_search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={copy('faqSearch', 'Search questions', 'ស្វែងរកសំណួរ')}
            placeholder={copy('faqSearch', 'Search questions', 'ស្វែងរកសំណួរ')}
            className="h-11 w-full rounded-full border border-stone-300 bg-white pl-10 pr-11 text-sm text-[#23201b] placeholder:text-slate-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400"
          />
          {query ? (
            <button
              type="button"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-600 dark:text-neutral-300"
              aria-label={copy('clear', 'Clear', 'សម្អាត')}
              title={copy('clear', 'Clear', 'សម្អាត')}
              onClick={() => setQuery('')}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      {visible.length ? (
        <ul className="m-0 list-none p-0">
          {visible.map(({ item, index, key }) => {
            const open = expandedFaqId === key
            const answerId = `portal-faq-answer-${index}`
            return (
              <li key={key} className="border-b border-stone-200 dark:border-neutral-700">
                <h3 className="m-0">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-start justify-between gap-3 py-4 text-left"
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
                    {...getKhmerTextProps(item.answer, 'whitespace-pre-line pb-4 pr-8 text-sm leading-7 text-slate-700 [overflow-wrap:anywhere] dark:text-neutral-300')}
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
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 py-5 text-sm text-slate-700 dark:border-neutral-700 dark:text-neutral-300" role="status">
          <span className="min-w-0 [overflow-wrap:anywhere]">{copy('faqNoMatch', 'No question matches "{query}"', 'គ្មានសំណួរត្រូវនឹង "{query}" ទេ').replace('{query}', activeQuery)}</span>
          <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-stone-300 px-4 text-sm font-semibold text-[#23201b] dark:border-neutral-600 dark:text-neutral-100" onClick={() => setQuery('')}>
            {copy('clear', 'Clear', 'សម្អាត')}
          </button>
        </div>
      )}

      {onOpenContact ? (
        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900/90" data-portal-faq-contact="true">
          <p className="text-base font-semibold text-[#23201b] dark:text-neutral-100">{copy('faqStillHeading', 'Still have a question?', 'នៅមានសំណួរទៀតទេ?')}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-300">{copy('faqStillBody', 'Ask our team and we will answer.', 'សួរក្រុមការងាររបស់យើង ហើយយើងនឹងឆ្លើយ។')}</p>
          <div className="mt-4 flex justify-center"><FaqContactButton copy={copy} onOpenContact={onOpenContact} /></div>
        </div>
      ) : null}
    </div>
  )
}

function CatalogFaqSection(props: CatalogFaqSectionProps) {
  const { copy, previewConfig, publicFaqItems, expandedFaqId, setExpandedFaqId, onOpenContact, faqLoading } = props
  const [query, setQuery] = useState('')

  return (
    <SectionShell
      title={previewConfig.faqTitle || copy('faq', 'FAQ')}
      subtitle={copy('faqHint', 'Quick answers to common questions.')}
    >
      <FaqList
        copy={copy}
        items={publicFaqItems}
        expandedFaqId={expandedFaqId}
        setExpandedFaqId={setExpandedFaqId}
        query={query}
        setQuery={setQuery}
        onOpenContact={onOpenContact}
        loading={faqLoading}
      />
    </SectionShell>
  )
}

// Asked once per browser session: a reload or a trip to another tab does not ask again.
const ASSISTANT_CONSENT_KEY = 'portal-assistant-consent'

function readAssistantConsent(): boolean {
  try {
    return window.sessionStorage.getItem(ASSISTANT_CONSENT_KEY) === '1'
  } catch {
    // Storage blocked (private mode): consent just lasts until the page closes.
    return false
  }
}

function writeAssistantConsent(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(ASSISTANT_CONSENT_KEY, '1')
    else window.sessionStorage.removeItem(ASSISTANT_CONSENT_KEY)
  } catch {
    // Storage blocked: the in-memory flag still gates Send for this page.
  }
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
    replaceVars,
    assistantError,
    assistantResponse,
    openProductById,
    assistantDisclosure,
    assistantDataUseConsent,
    setAssistantDataUseConsent,
  } = props

  useEffect(() => {
    if (!assistantDataUseConsent && readAssistantConsent()) setAssistantDataUseConsent(true)
    // Restore once on mount; the parent owns the live flag afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeConsent = (next: boolean) => {
    setAssistantDataUseConsent(next)
    writeAssistantConsent(next)
  }
  const aiState: AiProviderState = assistantDisclosure || { kind: 'unknown' }
  // copy() answers in the storefront language; asking it for 'en' / 'ខ្មែរ' tells this section which wording to build.
  const language: AiDisclosureLanguage = copy('aiPolicyLanguage', 'en', 'ខ្មែរ') === 'ខ្មែរ' ? 'km' : 'en'
  const provider = aiProviderNames(aiState, language) || copy('assistantProviderFallback', 'our AI provider', 'អ្នកផ្តល់សេវា AI របស់យើង')
  const labelClass = 'block text-sm font-medium text-slate-700 dark:text-neutral-200'

  return (
    <SectionShell
      title={previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')}
      subtitle={previewConfig.aiIntro || copy('assistantNotice', 'AI generated, for reference only.')}
    >
      <div className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
            {/* Every label in this AI-assistant form was `text-slate-700`
                with NO dark: override on a card that already paints
                `dark:bg-neutral-900/90` -- slate-700 (#334155) on that near-
                black card is ~1.7:1, nowhere near AA's 4.5:1 (owner,
                2026-09-18: "the dark mode are not contrasted correctly for
                the text and buttons"). portalContrast.ts's own audited dark
                token (`dark:text-neutral-200`) is what every label here takes. */}
            <div>
              <label htmlFor="portal-assistant-question" className={labelClass}>{copy('assistantQuestion', 'What would you like help finding?', 'តើអ្នកចង់ឲ្យជួយរកអ្វី?')}</label>
              <textarea id="portal-assistant-question" name="portal_assistant_question" autoComplete="off" className="input mt-1 resize-none" rows={4} maxLength={questionCharLimit} value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder={copy('assistantQuestionPlaceholder', 'Example: I have oily acne-prone skin and want a gentle daily sunscreen.', 'ឧទាហរណ៍៖ ខ្ញុំមានស្បែកខ្លាញ់ងាយកើតមុន ហើយចង់បានឡេការពារកម្ដៅថ្ងៃប្រើរាល់ថ្ងៃដែលទន់ភ្លន់។')} />
              <div className="mt-1 text-right text-xs text-slate-500 dark:text-neutral-400">{assistantQuestion.length}/{questionCharLimit}</div>
            </div>

            <details className="group mt-2 rounded-2xl border border-slate-200 dark:border-neutral-700" data-portal-assistant-details="true">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium text-slate-700 dark:text-neutral-200">
                {copy('assistantDetails', 'Skin type, brand and goal (optional)', 'ប្រភេទស្បែក ម៉ាក និងគោលបំណង (មិនបង្ខំ)')}
                <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none ${BRASS_TEXT}`} />
              </summary>
              <div className="space-y-3 px-4 pb-4 pt-1">
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
                    <label htmlFor="portal-assistant-skin-type" className={labelClass}>{copy('assistantSkinType', 'Skin type', 'ប្រភេទស្បែក')}</label>
                    <AppSelect
                      id="portal-assistant-skin-type"
                      name="portal_assistant_skin_type"
                      value={assistantProfile.skinType}
                      onChange={(nextValue) => setAssistantProfile((current) => ({ ...current, skinType: nextValue }))}
                      ariaLabel={copy('assistantSkinType', 'Skin type', 'ប្រភេទស្បែក')}
                      className="mt-1 w-full"
                      buttonClassName="h-10 w-full"
                      menuClassName="min-w-[12rem]"
                      options={[
                        { value: '', label: copy('all', 'All') },
                        { value: 'Dry', label: copy('skinDry', 'Dry', 'ស្ងួត') },
                        { value: 'Oily', label: copy('skinOily', 'Oily', 'ខ្លាញ់') },
                        { value: 'Combination', label: copy('skinCombination', 'Combination', 'ចម្រុះ') },
                        { value: 'Sensitive', label: copy('skinSensitive', 'Sensitive', 'ងាយប្រតិកម្ម') },
                        { value: 'Normal', label: copy('skinNormal', 'Normal', 'ធម្មតា') },
                        { value: 'Acne-prone', label: copy('skinAcneProne', 'Acne-prone', 'ងាយកើតមុន') },
                      ]}
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
                    <label htmlFor="portal-assistant-goal" className={labelClass}>{copy('assistantGoal', 'Goal / use case', 'គោលបំណងប្រើប្រាស់')}</label>
                    <input id="portal-assistant-goal" name="portal_assistant_goal" autoComplete="off" className="input mt-1" maxLength={180} value={assistantProfile.goal} onChange={(event) => setAssistantProfile((current) => ({ ...current, goal: event.target.value }))} placeholder={copy('assistantGoalPlaceholder', 'Daily use, brightening, long wear...', 'ប្រើរាល់ថ្ងៃ បំប៉នឲ្យភ្លឺ ឬជាប់បានយូរ...')} />
                  </div>
                </div>
                <div>
                  <label htmlFor="portal-assistant-concerns" className={labelClass}>{copy('assistantConcerns', 'Skin concerns', 'បញ្ហាស្បែក')}</label>
                  <input id="portal-assistant-concerns" name="portal_assistant_concerns" autoComplete="off" className="input mt-1" maxLength={220} value={assistantProfile.concerns} onChange={(event) => setAssistantProfile((current) => ({ ...current, concerns: event.target.value }))} placeholder={copy('assistantConcernsPlaceholder', 'Acne, sensitivity, dark spots, dryness...', 'មុន ស្បែកងាយប្រតិកម្ម ស្នាមខ្មៅ ឬស្បែកស្ងួត...')} />
                </div>
              </div>
            </details>

            {assistantDataUseConsent ? (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-200" data-portal-assistant-consent="given">
                <Check aria-hidden="true" className={`h-4 w-4 shrink-0 ${BRASS_TEXT}`} />
                <span className="min-w-0 flex-1">
                  {replaceVars(copy('assistantConsentGiven', 'You agreed to send your questions to {provider} during this visit.', 'អ្នកបានយល់ព្រមផ្ញើសំណួរទៅ {provider} ក្នុងអំឡុងពេលចូលមើលលើកនេះ។'), { provider })}
                </span>
                <button
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 dark:text-neutral-300"
                  aria-label={copy('assistantConsentWithdraw', 'Withdraw consent', 'ដកការយល់ព្រម')}
                  title={copy('assistantConsentWithdraw', 'Withdraw consent', 'ដកការយល់ព្រម')}
                  onClick={() => changeConsent(false)}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-200" data-portal-assistant-consent="ask">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={assistantDataUseConsent}
                  onChange={(event) => changeConsent(event.target.checked)}
                />
                <span>
                  {fillAiProviderTemplate(language === 'km' ? ASSISTANT_CONSENT_KM : ASSISTANT_CONSENT_EN, aiState, language)}
                </span>
              </label>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary min-h-11 text-sm" onClick={askAssistant} disabled={assistantLoading || !assistantDataUseConsent}>
                <Send aria-hidden="true" className="mr-2 inline h-4 w-4" />
                {assistantLoading ? copy('assistantLoading', 'Thinking...') : copy('assistantSend', 'Send', 'ផ្ញើ')}
              </button>
              <button
                type="button"
                className="btn-secondary flex min-h-11 min-w-11 items-center justify-center text-sm"
                onClick={clearAssistantState}
                aria-label={copy('assistantReset', 'Clear')}
                title={copy('assistantReset', 'Clear')}
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-4 py-4 text-xs leading-6 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
              {previewConfig.aiDisclaimer || copy('assistantNotice', 'AI generated, for reference only.')}
            </div>

            {/* The block above is the MERCHANT's disclaimer: editable in the
                portal editor, and therefore possible to shorten to nothing.
                This one is the app's own and is not editable, because the
                three things it says are not marketing -- the shopper is
                talking to software and not a person, their question leaves
                the shop, and a skin or health question belongs with a
                pharmacist or a doctor rather than a product recommender
                (N45). Cosmetics advertising rules treat a therapeutic claim
                as a different product class; the assistant is instructed not
                to make one, and a reader is told what it is either way. */}
            <p className="rounded-[28px] border border-slate-200 bg-white px-4 py-3 text-[11px] leading-6 text-slate-600 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-400">
              {fillAiProviderTemplate(language === 'km' ? ASSISTANT_AUTOMATED_KM : ASSISTANT_AUTOMATED_EN, aiState, language)}
            </p>
          </div>
        </div>

        {assistantError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-200">{assistantError}</div> : null}

        {assistantResponse?.summary ? (
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/80">
            <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">{copy('assistantResults', 'Suggested matches')}</div>
            <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-neutral-300">{assistantResponse.summary}</p>
            {/* Backend returns follow_up_questions (snake_case); the
                camelCase followUpQuestions was pre-existing dead UI (this
                chip row never actually rendered) since askPortalAi returns
                the raw JSON body with no key remapping. Reading either
                shape fixes that without needing a wider camelCase pass
                across the AI response contract. */}
            {(assistantResponse.followUpQuestions?.length || assistantResponse.follow_up_questions?.length) ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">{copy('assistantFollowUps', 'Helpful follow-up questions')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(assistantResponse.followUpQuestions || assistantResponse.follow_up_questions || []).map((question) => (
                    <button key={question} type="button" className="min-h-11 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:bg-neutral-900 dark:text-neutral-200" onClick={() => setAssistantQuestion(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantResponse?.recommendations?.length ? (
          <div className="space-y-3" data-portal-assistant-products="true">
            {assistantResponse.recommendations.map((item) => {
              const servedPrice = previewConfig.showPrices === true
                ? (previewConfig.priceDisplay === 'KHR' ? item.selling_price_khr : item.selling_price_usd)
                : undefined
              const priceLabel = typeof servedPrice === 'number' && Number.isFinite(servedPrice)
                ? (previewConfig.priceDisplay === 'KHR' ? `${servedPrice.toLocaleString()}៛` : `$${servedPrice.toFixed(2)}`)
                : ''
              const productId = Number(item.product_id)
              const canOpen = Boolean(openProductById) && Number.isFinite(productId)
              const body = (
                <>
                  {item.image_path ? (
                    <img src={item.image_path} alt={item.name} className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400" aria-hidden="true">
                      <ShoppingBag className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div translate="no" className="notranslate text-sm font-semibold text-slate-900 dark:text-neutral-100">{item.name}</div>
                      <span translate={item.brand ? 'no' : undefined} className={`${item.brand ? 'notranslate ' : ''}rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-200`}>{item.brand || copy('noBrand', 'No brand', 'គ្មានម៉ាក')}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                      {item.category || copy('noCategory', 'No category', 'គ្មានប្រភេទ')}
                      {priceLabel ? (
                        <>
                          {' | '}
                          <span translate="no" className="notranslate">{priceLabel}</span>
                        </>
                      ) : null}
                    </div>
                    {item.reason ? <div className="mt-2 text-sm text-slate-600 dark:text-neutral-300">{item.reason}</div> : null}
                    {item.fit_summary ? <div className="mt-2 text-sm text-slate-700 dark:text-neutral-300"><span className="font-semibold text-slate-900 dark:text-neutral-100">{copy('assistantWhy', 'Why this match')}:</span> {item.fit_summary}</div> : null}
                  </div>
                  {canOpen ? <ChevronRight aria-hidden="true" className={`mt-1 h-5 w-5 shrink-0 ${BRASS_TEXT}`} /> : null}
                </>
              )
              return (
                <article key={item.product_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
                  {canOpen ? (
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-4 text-left"
                      aria-label={`${copy('assistantViewProduct', 'View product', 'មើលផលិតផល')}: ${item.name}`}
                      onClick={() => openProductById?.(productId, item.name)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-4">{body}</div>
                  )}
                </article>
              )
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  )
}

export default function CatalogSecondaryTabs({ tab, ...props }: CatalogSecondaryTabsProps) {
  if (tab === 'membership') return <CatalogMembershipSection {...(props as unknown as CatalogMembershipSectionProps)} />
  if (tab === 'about') return <CatalogAboutSection {...(props as unknown as CatalogAboutSectionProps)} />
  if (tab === 'faq') return <CatalogFaqSection {...(props as unknown as CatalogFaqSectionProps)} />
  if (tab === 'ai') return <CatalogAiSection {...(props as unknown as CatalogAiSectionProps)} />
  return null
}

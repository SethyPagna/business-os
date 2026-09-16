import type { ClipboardEventHandler, ComponentType, Dispatch, SetStateAction } from 'react'
import { buildLogoImageStyle } from './logoImageStyle'
import Bot from 'lucide-react/dist/esm/icons/bot.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import Facebook from 'lucide-react/dist/esm/icons/facebook.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle.js'
import Instagram from 'lucide-react/dist/esm/icons/instagram.js'
import Mail from 'lucide-react/dist/esm/icons/mail.js'
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js'
import Phone from 'lucide-react/dist/esm/icons/phone.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import PortalEmbedConsent from './legal/PortalEmbedConsent.tsx'
import { SectionShell, StatusPill, SummaryTile } from './catalogUi'

type IdValue = string | number
type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

interface PreviewConfig {
  aboutBlocks?: AboutBlock[]
  aboutContent?: string
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
  showCover?: boolean
  showLogo?: boolean
  showPointValue?: boolean
  submissionEnabled?: boolean
  submissionInstructions?: string
  title?: string
}

interface MembershipCustomer {
  name?: string
  membership_number?: string
  created_at?: unknown
  phone?: string
  email?: string
  company?: string
  notes?: string
}

interface MembershipPoints {
  balance?: number
  redeemValueUsd?: number
  redeemValueKhr?: number
}

interface MembershipTotals {
  totalSalesUsd?: number
  totalSalesKhr?: number
  totalReturnsUsd?: number
  totalReturnsKhr?: number
  membershipDiscountUsd?: number
  membershipDiscountKhr?: number
}

interface MembershipSale {
  id: IdValue
  receipt_number?: string
  created_at?: unknown
  branch_name?: string
  payment_status?: string
  items_summary?: string
  total_usd?: number
  total_khr?: number
}

interface MembershipReturn {
  id: IdValue
  return_number?: string
  created_at?: unknown
  branch_name?: string
  status?: string
  items_summary?: string
  reason?: string
  total_refund_usd?: number
  total_refund_khr?: number
}

interface ShareSubmission {
  id: IdValue
  platform?: string
  created_at?: unknown
  status?: string
  note?: string
  screenshots?: string[]
  reward_points?: number
  review_note?: string
}

interface MembershipData {
  customer?: MembershipCustomer
  points?: MembershipPoints
  totals?: MembershipTotals
  sales?: MembershipSale[]
  returns?: MembershipReturn[]
  submissions?: ShareSubmission[]
}

interface SubmissionDraft {
  platform: string
  note: string
  screenshots: string[]
  rightsConsent: boolean
  privacyConsent: boolean
}

interface CatalogMembershipSectionProps {
  copy: CopyFn
  formatDateTime: (value: unknown) => string
  formatPortalPrice: (usd: unknown, khr: unknown, config: PreviewConfig) => string
  membershipNumber: string
  setMembershipNumber: (value: string) => void
  handleMembershipLookup: () => void
  membershipLoading: boolean
  membershipError?: string
  membershipData?: MembershipData | null
  previewConfig: PreviewConfig
  redeemSummaryText: string
  submissionDraft: SubmissionDraft
  setSubmissionDraft: Dispatch<SetStateAction<SubmissionDraft>>
  submissionSaving: boolean
  handleSubmissionPaste: ClipboardEventHandler<HTMLTextAreaElement>
  handleSubmitShareProof: () => void
  handleUploadSubmissionImages: () => void
  openPortalImage: (title: string, images: string[], index?: number) => void
  accountSignedIn: boolean
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

interface AiUsageSummary {
  activeVisitors?: number
  perUserPerMinute?: number
}

interface AssistantRequestPolicy {
  perUserPerMinute?: number
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
  how_to_use?: string
  cautions?: string
  ingredients_focus?: string[]
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
  aiUsageSummary?: AiUsageSummary | null
  assistantRequestPolicy?: AssistantRequestPolicy | null
  replaceVars: (template: string, values: Record<string, string | number>) => string
  assistantError?: string
  assistantResponse?: AssistantResponse | null
  assistantExpandedProductId: IdValue | null
  setAssistantExpandedProductId: Dispatch<SetStateAction<IdValue | null>>
  assistantDisclosure?: { provider?: string; dataUseNotice?: string } | null
  assistantDataUseConsent: boolean
  setAssistantDataUseConsent: (value: boolean) => void
}

// The assistant notice the merchant cannot edit away -- see its use below.
const ASSISTANT_AUTOMATED_EN = 'This assistant is automated software, not a member of our team, and it is not medical advice. Your question is sent to a third-party AI provider to produce an answer and is kept for about 30 days, so please leave out personal or medical details. For a skin condition, a reaction, a medicine, or pregnancy, please speak to a pharmacist or doctor -- and contact the store team for anything about a product.'
const ASSISTANT_AUTOMATED_KM = 'ជំនួយការនេះជាកម្មវិធីស្វ័យប្រវត្តិ មិនមែនបុគ្គលិករបស់យើងទេ ហើយមិនមែនជាការណែនាំវេជ្ជសាស្ត្រឡើយ។ សំណួររបស់អ្នកផ្ញើទៅអ្នកផ្តល់សេវា AI ភាគីទីបីដើម្បីបង្កើតចម្លើយ ហើយរក្សាទុកប្រហែល៣០ថ្ងៃ ដូច្នេះសូមកុំបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន ឬព័ត៌មានសុខភាព។ សម្រាប់បញ្ហាស្បែក ប្រតិកម្ម ថ្នាំ ឬការមានផ្ទៃពោះ សូមពិគ្រោះជាមួយឱសថការី ឬវេជ្ជបណ្ឌិត ហើយទាក់ទងក្រុមការងារហាងសម្រាប់សំណួរអំពីផលិតផល។'

type CatalogSecondaryTabsProps = {
  tab?: string
} & Record<string, unknown>

function normalizePortalColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fallback
}

function CatalogMembershipSection({
  copy,
  previewConfig,
  submissionDraft,
  setSubmissionDraft,
  submissionSaving,
  handleSubmissionPaste,
  handleSubmitShareProof,
  handleUploadSubmissionImages,
  openPortalImage,
  membershipError,
  accountSignedIn,
}: CatalogMembershipSectionProps) {
  // The anonymous membership lookup was removed (§2, user request). Typing a
  // membership number to see purchases/points exposed customer data on a
  // public surface; a customer's own history now lives behind a real account
  // instead of an open lookup. This renders the privacy notice in its place
  // (the storefront Account section carries sign-in / sign-up).
  return (
    <SectionShell
      title={copy('membership', 'Membership')}
      subtitle={copy('membershipDisabledSubtitle', 'Your membership details are kept private.')}
    >
      <div className="rounded-[28px] border border-slate-200/80 bg-white p-6 text-slate-700 shadow-[0_18px_42px_rgba(148,163,184,0.14)] dark:border-neutral-700/80 dark:bg-neutral-900 dark:text-neutral-200 dark:shadow-lg">
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-amber-500 dark:text-amber-300" />
          <div className="space-y-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{copy('membershipPrivacyTitle', 'Membership lookup is off')}</div>
            <p className="text-sm leading-relaxed">
              {copy('membershipDisabledMessage', 'This feature is not built into the account structure for privacy and security purposes.')}
            </p>
          </div>
        </div>
      </div>
      {previewConfig.submissionEnabled ? (
        <div className="mt-4 rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-neutral-700/80 dark:bg-neutral-900">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">{copy('shareProofTitle', 'Send share proof', 'ផ្ញើភស្តុតាងចែករំលែក')}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-neutral-300">
            {previewConfig.submissionInstructions || copy('shareProofInstructions', 'Upload screenshots for staff review. A submission does not guarantee points or approval.', 'បញ្ចូលរូបថតអេក្រង់សម្រាប់បុគ្គលិកពិនិត្យ។ ការផ្ញើមិនធានាថានឹងទទួលបានពិន្ទុ ឬការអនុម័តទេ។')}
          </p>

          {!accountSignedIn ? (
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
              {copy('submissionSignInRequired', 'Sign in before sending a screenshot.', 'សូមចូលគណនីមុនពេលផ្ញើរូបថតអេក្រង់។')}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3">
            <div>
              <label htmlFor="portal-submission-platform" className="block text-sm font-medium text-slate-700 dark:text-neutral-200">{copy('submissionPlatform', 'Platform', 'បណ្ដាញ')}</label>
              <AppSelect
                id="portal-submission-platform"
                name="portal_submission_platform"
                value={submissionDraft.platform}
                onChange={(platform) => setSubmissionDraft((current) => ({ ...current, platform }))}
                ariaLabel={copy('submissionPlatform', 'Platform', 'បណ្ដាញ')}
                className="mt-1 w-full"
                buttonClassName="h-11 w-full"
                options={['Facebook', 'Instagram', 'TikTok', 'Telegram', 'Other'].map((value) => ({ value, label: value }))}
              />
            </div>
            <div>
              <label htmlFor="portal-submission-note" className="block text-sm font-medium text-slate-700 dark:text-neutral-200">{copy('submissionNote', 'Optional note', 'កំណត់ចំណាំ (ស្រេចចិត្ត)')}</label>
              <textarea
                id="portal-submission-note"
                name="portal_submission_note"
                className="input mt-1 min-h-24 resize-y"
                maxLength={1000}
                value={submissionDraft.note}
                onPaste={handleSubmissionPaste}
                onChange={(event) => setSubmissionDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder={copy('submissionPasteHint', 'You can paste screenshots here or use the upload button.', 'អ្នកអាចបិទភ្ជាប់រូបថតអេក្រង់នៅទីនេះ ឬប្រើប៊ូតុងបញ្ចូល។')}
              />
            </div>
            <button type="button" className="btn-secondary w-fit text-sm" onClick={handleUploadSubmissionImages} disabled={!accountSignedIn || submissionSaving}>
              <Upload className="mr-2 inline h-4 w-4" />
              {copy('uploadScreenshots', 'Upload screenshots', 'បញ្ចូលរូបថតអេក្រង់')}
            </button>
            {submissionDraft.screenshots.length ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={copy('selectedScreenshots', 'Selected screenshots', 'រូបថតអេក្រង់ដែលបានជ្រើស')}>
                {submissionDraft.screenshots.map((src, index) => (
                  <li key={`${index}-${src.slice(-24)}`} className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-neutral-700">
                    <button type="button" className="block aspect-square w-full" onClick={() => openPortalImage(copy('submissionScreenshot', 'Submission screenshot', 'រូបថតអេក្រង់ដែលបានផ្ញើ'), submissionDraft.screenshots, index)}>
                      <img src={src} alt={`${copy('submissionScreenshot', 'Submission screenshot', 'រូបថតអេក្រង់ដែលបានផ្ញើ')} ${index + 1}`} className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-rose-700 shadow"
                      onClick={() => setSubmissionDraft((current) => ({ ...current, screenshots: current.screenshots.filter((_, itemIndex) => itemIndex !== index) }))}
                      aria-label={`${copy('remove', 'Remove', 'លុប')} ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 text-sm leading-6 dark:border-neutral-700">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={submissionDraft.rightsConsent} onChange={(event) => setSubmissionDraft((current) => ({ ...current, rightsConsent: event.target.checked }))} />
              <span>{copy('submissionRightsConsent', 'I created these screenshots or have permission to send them for staff review.', 'ខ្ញុំបានបង្កើតរូបថតអេក្រង់ទាំងនេះ ឬមានការអនុញ្ញាតឱ្យផ្ញើសម្រាប់បុគ្គលិកពិនិត្យ។')}</span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 text-sm leading-6 dark:border-neutral-700">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={submissionDraft.privacyConsent} onChange={(event) => setSubmissionDraft((current) => ({ ...current, privacyConsent: event.target.checked }))} />
              <span>{copy('submissionPrivacyConsent', 'I agree that the store may keep the screenshots and note for staff review under the Privacy Policy.', 'ខ្ញុំយល់ព្រមឱ្យហាងរក្សាទុករូបថតអេក្រង់ និងកំណត់ចំណាំសម្រាប់បុគ្គលិកពិនិត្យក្រោមគោលការណ៍ឯកជនភាព។')}</span>
            </label>
            {membershipError ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{membershipError}</p> : null}
            <button
              type="button"
              className="btn-primary w-fit text-sm"
              onClick={handleSubmitShareProof}
              disabled={!accountSignedIn || submissionSaving || !submissionDraft.screenshots.length || !submissionDraft.rightsConsent || !submissionDraft.privacyConsent}
            >
              <Send className="mr-2 inline h-4 w-4" />
              {submissionSaving ? copy('saving', 'Saving...', 'កំពុងរក្សាទុក...') : copy('submitForReview', 'Submit for review', 'ផ្ញើសម្រាប់ពិនិត្យ')}
            </button>
          </div>
        </div>
      ) : null}
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
    openPortalImage,
  } = props

  const previewTitle = String(previewConfig.businessName || previewConfig.title || '').trim()
  const previewBusinessName = String(previewConfig.businessName || '').trim()
  const showBrandLabel = previewBusinessName && previewTitle && previewBusinessName.toLowerCase() !== previewTitle.toLowerCase()
  const aboutTitle = previewConfig.aboutTitle || copy('about', 'About')
  // Shopper-voiced fallback: this renders on the PUBLIC About tab when the
  // merchant hasn't written a story yet -- it must never read like an
  // instruction to the merchant (standing public-surface rule).
  const fallbackStory = copy('portalAboutFallback', 'Welcome to our store.')
  const storyText = String(previewConfig.aboutContent || fallbackStory).trim()
  const heroTitle = previewTitle || aboutTitle
  const introText = String(previewConfig.intro || storyText || fallbackStory).trim()
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
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover"
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
                <span className="text-2xl font-semibold text-slate-700 dark:text-neutral-200">{String(previewConfig.businessName || 'B').slice(0, 2).toUpperCase()}</span>
              )}
            </div>

            <div className="min-w-0 flex-1 pb-1">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                <Store className="h-3 w-3" />
                {aboutTitle}
              </div>
              {showBrandLabel ? (
                <div className="notranslate mt-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400" translate="no">
                  {previewConfig.businessName}
                </div>
              ) : null}
              <h2 className="notranslate mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-neutral-100 sm:text-3xl" translate="no">
                {heroTitle}
              </h2>
              {previewConfig.businessTagline ? <div className="notranslate mt-1 text-sm text-slate-500 dark:text-neutral-400" translate="no">{previewConfig.businessTagline}</div> : null}
            </div>
          </div>

          {introText ? (
            <p className="notranslate mt-4 max-w-3xl text-sm leading-6 text-slate-600 dark:text-neutral-300 sm:text-base sm:leading-7" translate="no">
              {introText}
            </p>
          ) : null}

        </div>
      </div>

      {/* Quick-info card (facts + socials, moved out of the hero banner so
          it doesn't compete with the name/tagline for space) on the left,
          the business story/description on the right per the requested
          layout. The map is intentionally NOT in this row -- it gets its
          own full-width section below instead of sitting beside either
          column, so a long story never squeezes it down to a sliver. */}
      <div className="grid gap-4 lg:grid-cols-[1fr,1.4fr] lg:items-start">
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
                  return item.href ? <a key={item.key} href={item.href} target={item.href.startsWith('tel:') ? undefined : '_blank'} rel={item.href.startsWith('tel:') ? undefined : 'noreferrer'} className="block">{body}</a> : <div key={item.key}>{body}</div>
                })}
              </div>
            ) : null}
            {socialLinks?.length ? (
              <div className="flex flex-wrap gap-2">
                {socialLinks.map((item) => {
                  const Icon = item.key === 'facebook'
                    ? Facebook
                    : item.key === 'instagram'
                      ? Instagram
                      : item.key === 'telegram'
                        ? Send
                        : Globe
                  return (
                    <a
                      key={item.key}
                      href={item.value}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 sm:px-3.5 sm:text-sm"
                      aria-label={item.label}
                      title={item.label}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="sr-only sm:not-sr-only">{item.label}</span>
                    </a>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {storyText ? (
          <div className={`rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-800 lg:order-2 ${hasContactInfo ? '' : 'lg:col-span-2'}`}>
            <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{aboutTitle}</div>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-neutral-300">
              {storyText}
            </p>
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
            title="portal-about-map"
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
                    onClick={() => openPortalImage(block.title || previewConfig.aboutTitle || copy('about', 'About'), block.mediaUrl ? [block.mediaUrl] : [])}
                  >
                    {block.type === 'video' ? (
                      <video src={block.mediaUrl} controls preload="metadata" className="max-h-[280px] w-full rounded-2xl bg-white object-contain dark:bg-neutral-950 sm:h-full sm:max-h-none" />
                    ) : (
                      <img src={block.mediaUrl} alt={block.title || previewConfig.aboutTitle || copy('about', 'About')} className="max-h-[280px] w-full rounded-2xl object-contain sm:h-full sm:max-h-none" />
                    )}
                  </button>
                ) : null}
                <div className={`flex flex-col justify-center space-y-3 p-6 ${block.mediaUrl ? (mediaFirst ? 'sm:order-2' : 'sm:order-1') : 'sm:col-span-2'}`}>
                  {block.title ? <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100">{block.title}</h3> : null}
                  {block.body ? <p className="whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-neutral-300">{block.body}</p> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function CatalogFaqSection(props: CatalogFaqSectionProps) {
  const {
    copy,
    previewConfig,
    publicFaqItems,
    expandedFaqId,
    setExpandedFaqId,
  } = props

  return (
    <SectionShell
      title={previewConfig.faqTitle || copy('faq', 'FAQ')}
      subtitle={copy('faqHint', 'Quick answers to common questions.')}
    >
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {publicFaqItems.length ? publicFaqItems.map((item, index) => {
          const open = expandedFaqId === item.id
          const accentClass = index % 2 === 0
            ? 'from-cyan-50 to-white border-cyan-200/80'
            : 'from-amber-50 to-white border-amber-200/80'
          const iconClass = index % 2 === 0
            ? 'bg-cyan-100 text-cyan-700'
            : 'bg-amber-100 text-amber-700'
          return (
            <article key={item.id || index} className={`self-start overflow-hidden rounded-[24px] border bg-gradient-to-br shadow-sm dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-800 ${accentClass}`}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
                onClick={() => setExpandedFaqId((current) => current === item.id ? null : item.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${iconClass}`}>
                    <HelpCircle className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-neutral-400">{copy('faq', 'FAQ')}</div>
                    <div className="mt-1 text-sm font-semibold leading-6 text-slate-900 dark:text-neutral-100">{item.question}</div>
                  </div>
                </div>
                <span className="rounded-full bg-white/90 p-2 text-slate-500 shadow-sm dark:bg-neutral-800 dark:text-neutral-300">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
              </button>
              {open ? <div className="border-t border-white/80 px-5 py-4 text-sm leading-7 text-slate-700 dark:border-neutral-700 dark:text-neutral-300">{item.answer}</div> : null}
            </article>
          )
        }) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400 sm:col-span-2">
            {copy('faqEmptyState', 'No questions yet. Contact us any time and we are happy to help.')}
          </div>
        )}
      </div>
    </SectionShell>
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
    aiUsageSummary,
    assistantRequestPolicy,
    replaceVars,
    assistantError,
    assistantResponse,
    assistantExpandedProductId,
    setAssistantExpandedProductId,
    assistantDisclosure,
    assistantDataUseConsent,
    setAssistantDataUseConsent,
  } = props

  return (
    <SectionShell
      title={previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')}
      subtitle={previewConfig.aiIntro || copy('assistantNotice', 'AI generated, for reference only.')}
      action={(
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:bg-neutral-800 dark:text-neutral-200">
          <Bot className="h-3.5 w-3.5" />
          {copy('aiQuery', 'AI query', 'សំណួរ AI')}
        </span>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-assistant-brand" className="block text-sm font-medium text-slate-700">{copy('assistantBrand', 'Preferred brand', 'ម៉ាកដែលចូលចិត្ត')}</label>
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
                <label htmlFor="portal-assistant-skin-type" className="block text-sm font-medium text-slate-700">{copy('assistantSkinType', 'Skin type', 'ប្រភេទស្បែក')}</label>
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
                <label htmlFor="portal-assistant-shopping-for" className="block text-sm font-medium text-slate-700">{copy('assistantShoppingFor', 'Shopping for', 'កំពុងរកទិញ')}</label>
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
                <label htmlFor="portal-assistant-goal" className="block text-sm font-medium text-slate-700">{copy('assistantGoal', 'Goal / use case', 'គោលបំណងប្រើប្រាស់')}</label>
                <input id="portal-assistant-goal" name="portal_assistant_goal" autoComplete="off" className="input mt-1" maxLength={180} value={assistantProfile.goal} onChange={(event) => setAssistantProfile((current) => ({ ...current, goal: event.target.value }))} placeholder={copy('assistantGoalPlaceholder', 'Daily use, brightening, long wear...', 'ប្រើរាល់ថ្ងៃ បំប៉នឲ្យភ្លឺ ឬជាប់បានយូរ...')} />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="portal-assistant-concerns" className="block text-sm font-medium text-slate-700">{copy('assistantConcerns', 'Skin concerns', 'បញ្ហាស្បែក')}</label>
              <input id="portal-assistant-concerns" name="portal_assistant_concerns" autoComplete="off" className="input mt-1" maxLength={220} value={assistantProfile.concerns} onChange={(event) => setAssistantProfile((current) => ({ ...current, concerns: event.target.value }))} placeholder={copy('assistantConcernsPlaceholder', 'Acne, sensitivity, dark spots, dryness...', 'មុន ស្បែកងាយប្រតិកម្ម ស្នាមខ្មៅ ឬស្បែកស្ងួត...')} />
            </div>

            <div className="mt-3">
              <label htmlFor="portal-assistant-question" className="block text-sm font-medium text-slate-700">{copy('assistantQuestion', 'What would you like help finding?', 'តើអ្នកចង់ឲ្យជួយរកអ្វី?')}</label>
              <textarea id="portal-assistant-question" name="portal_assistant_question" autoComplete="off" className="input mt-1 resize-none" rows={5} maxLength={questionCharLimit} value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder={copy('assistantQuestionPlaceholder', 'Example: I have oily acne-prone skin and want a gentle daily sunscreen.', 'ឧទាហរណ៍៖ ខ្ញុំមានស្បែកខ្លាញ់ងាយកើតមុន ហើយចង់បានឡេការពារកម្ដៅថ្ងៃប្រើរាល់ថ្ងៃដែលទន់ភ្លន់។')} />
              <div className="mt-1 text-right text-xs text-slate-500">{assistantQuestion.length}/{questionCharLimit}</div>
            </div>

            <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-200">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0"
                checked={assistantDataUseConsent}
                onChange={(event) => setAssistantDataUseConsent(event.target.checked)}
              />
              <span>
                {replaceVars(copy(
                  'assistantDataUseConsent',
                  'I understand that my question and optional shopping preferences are sent to {provider} and may be processed outside Cambodia. I will not include personal, medical, or payment details.',
                  'ខ្ញុំយល់ថាសំណួរ និងចំណូលចិត្តទិញទំនិញស្រេចចិត្តរបស់ខ្ញុំត្រូវបានផ្ញើទៅ {provider} ហើយអាចត្រូវបានដំណើរការនៅក្រៅប្រទេសកម្ពុជា។ ខ្ញុំនឹងមិនបញ្ចូលព័ត៌មានផ្ទាល់ខ្លួន សុខភាព ឬការទូទាត់ទេ។',
                ), {
                  provider: assistantDisclosure?.provider || copy('configuredAiProvider', 'the configured AI provider', 'អ្នកផ្តល់សេវា AI ដែលបានកំណត់'),
                })}
              </span>
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm" onClick={askAssistant} disabled={assistantLoading || !assistantDataUseConsent}>
                <Send className="mr-2 inline h-4 w-4" />
                {assistantLoading ? copy('assistantLoading', 'Thinking...') : copy('askAssistant', 'Ask AI assistant')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={clearAssistantState}>
                <RotateCcw className="mr-2 inline h-4 w-4" />
                {copy('assistantReset', 'Clear')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-300">
              {replaceVars(copy('assistantUsageCompact', '{users} user(s) are using this right now. Each visitor can send {searches} search(es) per minute.'), {
                users: aiUsageSummary?.activeVisitors || 1,
                searches: assistantRequestPolicy?.perUserPerMinute || aiUsageSummary?.perUserPerMinute || 1,
              })}
            </div>

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
              {copy('assistantAutomatedNotice', ASSISTANT_AUTOMATED_EN, ASSISTANT_AUTOMATED_KM)}
            </p>
          </div>
        </div>

        {assistantError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{assistantError}</div> : null}

        {assistantResponse?.summary ? (
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/80">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-neutral-400">{copy('assistantResults', 'Suggested matches')}</div>
            <p className="mt-2 text-sm leading-7 text-slate-700 dark:text-neutral-300">{assistantResponse.summary}</p>
            {/* Backend returns follow_up_questions (snake_case); the
                camelCase followUpQuestions was pre-existing dead UI (this
                chip row never actually rendered) since askPortalAi returns
                the raw JSON body with no key remapping. Reading either
                shape fixes that without needing a wider camelCase pass
                across the AI response contract. */}
            {(assistantResponse.followUpQuestions?.length || assistantResponse.follow_up_questions?.length) ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-neutral-400">{copy('assistantFollowUps', 'Helpful follow-up questions')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(assistantResponse.followUpQuestions || assistantResponse.follow_up_questions || []).map((question) => (
                    <button key={question} type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm dark:bg-neutral-900 dark:text-neutral-200" onClick={() => setAssistantQuestion(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantResponse?.recommendations?.length ? (
          <div className="space-y-3">
            {assistantResponse.recommendations.map((item) => {
              const open = assistantExpandedProductId === item.product_id
              return (
                <article key={item.product_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
                  <button type="button" className="flex w-full items-start gap-3 px-4 py-4 text-left" onClick={() => setAssistantExpandedProductId((current) => current === item.product_id ? null : item.product_id)}>
                    {item.image_path ? (
                      <img src={item.image_path} alt={item.name} className="h-16 w-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400" aria-hidden="true">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{item.name}</div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-neutral-800 dark:text-neutral-200">{item.brand || copy('noBrand', 'No brand', 'គ្មានម៉ាក')}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-neutral-400">{item.category || copy('noCategory', 'No category', 'គ្មានប្រភេទ')} | {previewConfig.priceDisplay === 'KHR' ? `${Number(item.selling_price_khr || 0).toLocaleString()}៛` : `$${Number(item.selling_price_usd || 0).toFixed(2)}`}</div>
                      {item.reason ? <div className="mt-2 text-sm text-slate-600 dark:text-neutral-300">{item.reason}</div> : null}
                    </div>
                    <span className="rounded-full bg-slate-100 p-2 text-slate-500 dark:bg-neutral-800 dark:text-neutral-300">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                  </button>
                  {open ? (
                    <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-700 dark:border-neutral-800 dark:text-neutral-300">
                      {item.fit_summary ? <div><span className="font-semibold text-slate-900 dark:text-neutral-100">{copy('assistantWhy', 'Why this match')}:</span> {item.fit_summary}</div> : null}
                      {item.how_to_use ? <div className="mt-2"><span className="font-semibold text-slate-900 dark:text-neutral-100">{copy('assistantUse', 'How to use')}:</span> {item.how_to_use}</div> : null}
                      {item.cautions ? <div className="mt-2"><span className="font-semibold text-slate-900 dark:text-neutral-100">{copy('assistantCaution', 'Caution')}:</span> {item.cautions}</div> : null}
                      {item.ingredients_focus?.length ? <div className="mt-2"><span className="font-semibold text-slate-900 dark:text-neutral-100">{copy('assistantIngredients', 'Ingredients focus')}:</span> {item.ingredients_focus.join(', ')}</div> : null}
                    </div>
                  ) : null}
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

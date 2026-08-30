import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import Gift from 'lucide-react/dist/esm/icons/gift.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import { isBrokenLocalizedString as isBrokenLocalizedStringHook, useApp as useAppHook } from '../../AppContext.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import SectionSwitcher from '../shared/SectionSwitcher'
import LoadingWatchdog from '../shared/LoadingWatchdog'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import { fmtTime } from '../../utils/formatters.ts'
import { getCustomers as getLoyaltyCustomers } from '../../api/contactReadTransport.ts'
import { awardCustomerPoints } from '../../api/contactWriteTransport.ts'

type LocaleCopy = Record<string, string>

type LoyaltyBasis = 'usd' | 'khr'
type LoyaltySection = 'all' | 'rules' | 'behavior' | 'lookup' | 'leaders' | 'review'

type LoyaltySettingsForm = {
  customer_portal_points_basis: LoyaltyBasis
  customer_portal_points_per_usd: string
  customer_portal_points_per_khr: string
  customer_portal_redeem_points: string
  customer_portal_redeem_value_usd: string
  customer_portal_redeem_value_khr: string
  customer_portal_show_point_value: boolean
  customer_portal_membership_info_text: string
  customer_portal_submission_reward_points: string
}

type CustomerPointRow = {
  id?: number | string
  name?: string | null
  membership_number?: string | null
  points_balance?: number | string | null
}

type MembershipLookupData = {
  customer?: {
    id?: number | string | null
    name?: string | null
    membership_number?: string | null
  } | null
  points?: {
    balance?: number | string | null
    earned?: number | string | null
    deducted?: number | string | null
    redeemed?: number | string | null
    rewarded?: number | string | null
    redeemableUnits?: number | string | null
  } | null
  totals?: MembershipLookupTotals | null
  summary?: MembershipLookupTotals | null
}

type MembershipLookupTotals = {
  totalSalesUsd?: number | string | null
  totalReturnsUsd?: number | string | null
  membershipDiscountUsd?: number | string | null
}

type PortalTransportModule = typeof import('../../api/portalTransport.ts')

type ReviewSubmissionItem = {
  id: string | number
  customer_name?: string | null
  membership_number?: string | null
  platform?: string | null
  note?: string | null
  screenshots?: string[]
  reward_points?: number | string
  review_note?: string
  status?: string
  created_at?: string | null
}

type AppContextValue = {
  settings: Record<string, unknown>
  saveSettings: (newSettings: Record<string, string>, options?: Record<string, unknown>) => Promise<unknown>
  notify: (message: string, type?: string) => void
  t: (key: string) => string
  language: string
  fmtUSD: (value: number | string | null | undefined) => string
  fmtKHR: (value: number | string | null | undefined) => string
}

const useApp = useAppHook as () => AppContextValue
const isBrokenLocalizedString = isBrokenLocalizedStringHook as (value: unknown) => boolean
let portalTransportPromise: Promise<PortalTransportModule> | null = null

const COPY: Record<'en' | 'km', LocaleCopy> = {
  en: {
    pageTitle: 'Loyalty Points',
    pageSubtitle: 'Manage point earning rules, redemption values, and customer point visibility separately from the public portal layout.',
    policyTitle: 'Loyalty Points',
    policyHint: 'These rules affect POS membership discounts, customer portal balances, and point deductions after refunds.',
    customerTitle: 'Customer point lookup',
    customerHint: 'Look up a membership number to review balance, history totals, and how the current rules apply.',
    save: 'Save point rules',
    earningBasis: 'Earning basis',
    basisUsd: 'Based on USD sales',
    basisKhr: 'Based on KHR sales',
    pointsPerUsd: 'Points per USD',
    pointsPerKhr: 'Points per KHR',
    redeemPoints: 'Minimum redemption points',
    redeemValueUsd: 'Value per redemption unit (USD)',
    redeemValueKhr: 'Value per redemption unit (KHR)',
    showPointValue: 'Show point value on customer portal',
    infoText: 'Customer-facing membership note',
    infoTextHint: 'This note appears in the customer portal membership panel under the point summary and redemption rules.',
    submissionRewardPoints: 'Default reward points per approved share',
    validationUsd: 'USD redemption value uses whole numbers only.',
    validationKhr: 'KHR redemption value uses whole 1000 riel units and cannot be below 1000 when enabled.',
    validationRedeem: 'Minimum redemption points must be a whole number of at least 1.',
    saved: 'Point rules saved.',
    membershipNumber: 'Membership number',
    lookup: 'Check points',
    lookupRequired: 'Enter a membership number first.',
    customerNotFound: 'Membership number not found.',
    balance: 'Balance',
    earned: 'Earned',
    redeemed: 'Redeemed',
    rewarded: 'Rewarded',
    deducted: 'Deducted by returns',
    salesTotal: 'Sales total',
    returnsTotal: 'Returns total',
    membershipDiscounts: 'Membership discounts used',
    redemptionUnits: 'Redeemable units',
    wholeUnitsOnly: 'Customers can view balances with decimals, but staff redeem points only in whole units.',
    behaviorTitle: 'How points move',
    behavior1: 'Completed sales earn points based on the active earning basis.',
    behavior2: 'Partial and full returns deduct points from the refunded value.',
    behavior3: 'Awaiting payment and cancelled sales do not count until completed.',
    behavior4: 'Staff can attach a customer later in Sales when an anonymous purchase needs points added afterward.',
    attachHint: 'Use Sales > sale details > attach customer when a past anonymous sale should start counting for membership.',
    pointsPreview: 'Current policy preview',
    unitLabel: '1 redemption unit',
    reviewQueue: 'Review queue',
    reviewQueueHint: 'Approve, reject, and award points for customer share submissions.',
    noSubmissions: 'No share submissions yet.',
    rewardPoints: 'Reward points',
    shareReviewNote: 'Review note',
    reviewNotePlaceholder: 'Internal review note',
    approve: 'Approve',
    reject: 'Reject',
    pending: 'Pending',
    addPoints: 'Add points',
    pointsToAdd: 'Points to add',
    pointNote: 'Reason / note',
    pointNotePlaceholder: 'e.g. service recovery or membership promotion',
    addPointsSuccess: 'Points added to the customer.',
  },
  km: {
    pageTitle: 'ពិន្ទុសមាជិក',
    pageSubtitle: 'កំណត់ច្បាប់ពិន្ទុ ការប្តូរពិន្ទុ និងការបង្ហាញសម្រាប់អតិថិជន ដោយឡែកពីការរចនាទំព័រ Customer Portal។',
    policyTitle: 'ពិន្ទុស្មោះត្រង់',
    policyHint: 'ការកំណត់ទាំងនេះប៉ះពាល់ដល់ POS ការបញ្ចុះតម្លៃសមាជិក Customer Portal និងការកាត់ពិន្ទុពេលមាន Refund។',
    customerTitle: 'ស្វែងរកពិន្ទុអតិថិជន',
    customerHint: 'បញ្ចូលលេខសមាជិក ដើម្បីពិនិត្យសមតុល្យ ប្រវត្តិ និងរបៀបគណនាពិន្ទុតាមច្បាប់បច្ចុប្បន្ន។',
    save: 'រក្សាទុកច្បាប់ពិន្ទុ',
    earningBasis: 'គោលការណ៍គណនាពិន្ទុ',
    basisUsd: 'គណនាតាមការលក់ USD',
    basisKhr: 'គណនាតាមការលក់ KHR',
    pointsPerUsd: 'ពិន្ទុក្នុង 1 ដុល្លារ',
    pointsPerKhr: 'ពិន្ទុក្នុង 1 រៀល',
    redeemPoints: 'ពិន្ទុអប្បបរមាសម្រាប់ប្តូរ',
    redeemValueUsd: 'តម្លៃក្នុងមួយឯកតាប្តូរ (USD)',
    redeemValueKhr: 'តម្លៃក្នុងមួយឯកតាប្តូរ (KHR)',
    showPointValue: 'បង្ហាញតម្លៃពិន្ទុនៅ Customer Portal',
    infoText: 'សារពន្យល់សម្រាប់អតិថិជន',
    submissionRewardPoints: 'ពិន្ទុលំនាំដើមសម្រាប់ការអនុម័តការចែករំលែក',
    validationUsd: 'តម្លៃប្តូរជា USD ត្រូវប្រើជាចំនួនគត់ប៉ុណ្ណោះ។',
    validationKhr: 'តម្លៃប្តូរជា KHR ត្រូវជាចំនួន 1000 រៀល ហើយមិនអាចតិចជាង 1000 នៅពេលបើកប្រើ។',
    validationRedeem: 'ពិន្ទុអប្បបរមាត្រូវជាចំនួនគត់ ហើយយ៉ាងហោចណាស់ 1។',
    saved: 'បានរក្សាទុកច្បាប់ពិន្ទុ។',
    membershipNumber: 'លេខសមាជិក',
    lookup: 'ពិនិត្យពិន្ទុ',
    lookupRequired: 'សូមបញ្ចូលលេខសមាជិកជាមុន។',
    customerNotFound: 'រកមិនឃើញលេខសមាជិកនេះទេ។',
    balance: 'សមតុល្យ',
    earned: 'ពិន្ទុទទួលបាន',
    redeemed: 'ពិន្ទុបានប្រើ',
    rewarded: 'ពិន្ទុរង្វាន់',
    deducted: 'ពិន្ទុកាត់ដោយសារ Return',
    salesTotal: 'សរុបការលក់',
    returnsTotal: 'សរុប Refund',
    membershipDiscounts: 'បញ្ចុះតម្លៃសមាជិកបានប្រើ',
    redemptionUnits: 'ឯកតាអាចប្តូរ',
    wholeUnitsOnly: 'អតិថិជនអាចមើលសមតុល្យមានខ្ទង់ទសភាគបាន ប៉ុន្តែបុគ្គលិកអាចប្តូរបានតែជាឯកតាគត់។',
    behaviorTitle: 'របៀបផ្លាស់ប្តូរពិន្ទុ',
    behavior1: 'ការលក់ដែលបានបញ្ចប់ទើបគិតពិន្ទុតាមគោលការណ៍ដែលបានជ្រើស។',
    behavior2: 'Partial return និង full return កាត់ពិន្ទុតាមតម្លៃ Refund។',
    behavior3: 'ការលក់ awaiting payment និង cancelled មិនរាប់ចូលរហូតដល់ completed។',
    behavior4: 'បុគ្គលិកអាចភ្ជាប់អតិថិជនបន្ថែមនៅ Sales ប្រសិនបើការលក់ចាស់ត្រូវបន្ថែមពិន្ទុពេលក្រោយ។',
    attachHint: 'ប្រើ Sales > sale details > attach customer នៅពេលត្រូវភ្ជាប់សមាជិកទៅការលក់អនាមិកចាស់។',
    pointsPreview: 'ការមើលជាមុននៃច្បាប់បច្ចុប្បន្ន',
    unitLabel: '1 ឯកតាប្តូរ',
    reviewQueue: 'ការត្រួតពិនិត្យការចែករំលែក',
    reviewQueueHint: 'អនុម័ត បដិសេធ និងផ្តល់ពិន្ទុសម្រាប់ការចែករំលែករបស់អតិថិជន។',
    noSubmissions: 'មិនទាន់មានការចែករំលែកទេ។',
    rewardPoints: 'ពិន្ទុរង្វាន់',
    shareReviewNote: 'កំណត់ចំណាំពិនិត្យ',
    reviewNotePlaceholder: 'កំណត់ចំណាំផ្ទៃក្នុង',
    approve: 'អនុម័ត',
    reject: 'បដិសេធ',
    pending: 'កំពុងរង់ចាំ',
    addPoints: 'បន្ថែមពិន្ទុ',
    pointsToAdd: 'ពិន្ទុត្រូវបន្ថែម',
    pointNote: 'មូលហេតុ / កំណត់ចំណាំ',
    pointNotePlaceholder: 'ឧ. សេវាកម្ម ឬការផ្តល់ជូនសមាជិក',
    addPointsSuccess: 'បានបន្ថែមពិន្ទុទៅអតិថិជន។',
  },
}

const LOYALTY_SECTION_OPTIONS = [
  { value: 'all', labelKey: 'sectionAll', label: 'All', hintKey: 'sectionAllHint', hint: 'Show point rules, behavior, preview, lookup, and top balances.' },
  { value: 'rules', labelKey: 'sectionRules', label: 'Rules', hintKey: 'sectionRulesHint', hint: 'Edit earning basis, redemption values, and portal display settings.' },
  { value: 'behavior', labelKey: 'sectionBehavior', label: 'Behavior', hintKey: 'sectionBehaviorHint', hint: 'Review how points move through sales, returns, and manual customer attachment.' },
  { value: 'lookup', labelKey: 'sectionLookup', label: 'Lookup', hintKey: 'sectionLookupHint', hint: 'Check a customer membership number and current balance.' },
  { value: 'leaders', labelKey: 'sectionLeaders', label: 'Top Points', hintKey: 'sectionLeadersHint', hint: 'Show customers with the highest current point balances.' },
  { value: 'review', labelKey: 'sectionReview', label: 'Review Queue', hintKey: 'sectionReviewHint', hint: 'Approve, reject, and award points for customer share submissions.' },
]
const LOYALTY_CUSTOMER_POINTS_TIMEOUT_MS = 12000
const LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS = 12000

function getPortalTransport(): Promise<PortalTransportModule> {
  portalTransportPromise ||= import('../../api/portalTransport.ts')
  return portalTransportPromise
}

async function lookupLoyaltyPortalMembership(membershipNumber: string): Promise<unknown> {
  const module = await getPortalTransport()
  return module.lookupPortalMembership(membershipNumber)
}

function toCustomerPointRows(rows: unknown): CustomerPointRow[] {
  return Array.isArray(rows) ? rows.filter((row): row is CustomerPointRow => typeof row === 'object' && row !== null) : []
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function sanitizeInteger(value: unknown, fallback: number, min = 0): number {
  const num = Math.floor(Number(value))
  return Number.isFinite(num) ? Math.max(min, num) : fallback
}

function sanitizeKhr(value: unknown, fallback: number): number {
  const raw = sanitizeInteger(value, fallback, 0)
  if (raw === 0) return 0
  return Math.max(1000, Math.ceil(raw / 1000) * 1000)
}

function formatLookupValue(value: number | string | null | undefined): string {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function normalizeLoyaltySection(value: string): LoyaltySection {
  return ['all', 'rules', 'behavior', 'lookup', 'leaders', 'review'].includes(value) ? value as LoyaltySection : 'all'
}

function formatReviewDateTime(value: unknown): string {
  if (!value) return '-'
  const raw = String(value)
  const date = new Date(raw.includes('T') ? raw : `${raw}Z`)
  // mm/dd/yyyy + 24-hour in Phnom Penh business time (fmtTime). A bare
  // toLocaleString() rendered the viewer's locale + timezone (dd/mm, 12-hour).
  return Number.isNaN(date.getTime()) ? String(value) : fmtTime(raw)
}

async function fetchPortalReviewItems(): Promise<unknown> {
  const module = await getPortalTransport()
  return module.getPortalSubmissionsForReview()
}

async function submitPortalReview(id: string | number, payload: Record<string, unknown>): Promise<unknown> {
  const module = await getPortalTransport()
  return module.reviewPortalSubmission(id, payload)
}

export default function LoyaltyPointsPage() {
  const { settings, saveSettings, notify, t, language, fmtUSD, fmtKHR } = useApp()
  // G2: this component renders inside the Promotions page now, so its
  // load/refresh lifecycle keys on that page's activity.
  const isActive = useIsPageActive('promotions')
  const isKhmer = language === 'km'
  const copy = (key: string, fallback?: string): string => {
    const translated = t?.(key)
    if (translated && translated !== key) return translated
    const localized = COPY[isKhmer ? 'km' : 'en'][key]
    if (localized && !isBrokenLocalizedString(localized)) return localized
    return COPY.en[key] || fallback || key
  }

  const [form, setForm] = useState<LoyaltySettingsForm>({
    customer_portal_points_basis: 'usd',
    customer_portal_points_per_usd: '1',
    customer_portal_points_per_khr: '0',
    customer_portal_redeem_points: '100',
    customer_portal_redeem_value_usd: '1',
    customer_portal_redeem_value_khr: '4100',
    customer_portal_show_point_value: true,
    customer_portal_membership_info_text: '',
    customer_portal_submission_reward_points: '5',
  })
  const [saving, setSaving] = useState(false)
  const [membershipNumber, setMembershipNumber] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupData, setLookupData] = useState<MembershipLookupData | null>(null)
  const [manualPoints, setManualPoints] = useState('')
  const [manualPointNote, setManualPointNote] = useState('')
  const [manualPointSaving, setManualPointSaving] = useState(false)
  const [customerPoints, setCustomerPoints] = useState<CustomerPointRow[]>([])
  const [customerPointsLoading, setCustomerPointsLoading] = useState(true)
  const [loyaltySection, setLoyaltySection] = useState<LoyaltySection>('all')
  const [reviewItems, setReviewItems] = useState<ReviewSubmissionItem[]>([])
  const [reviewLoading, setReviewLoading] = useState(true)
  const [reviewSavingId, setReviewSavingId] = useState<string | number | null>(null)
  const lookupRequestRef = useRef(0)
  const customerPointsRequestRef = useRef(0)
  const reviewRequestRef = useRef(0)
  const saveInFlightRef = useRef(false)
  const reviewSavingRef = useRef(false)
  const sectionStorageKey = 'business-os:loyalty:section'
  const showLoyaltySection = (sectionId: Exclude<LoyaltySection, 'all'>): boolean => loyaltySection === 'all' || loyaltySection === sectionId
  const globalCopy = useCallback((key: string, fallback: string): string => {
    const translated = t?.(key)
    return translated && translated !== key ? translated : fallback
  }, [t])
  const loyaltySectionOptions = useMemo(() => (
    LOYALTY_SECTION_OPTIONS.map((option) => ({
      value: option.value,
      label: globalCopy(`loyalty_${option.labelKey}`, option.label),
      hint: globalCopy(`loyalty_${option.hintKey}`, option.hint),
    }))
  ), [globalCopy])

  useEffect(() => {
    setForm({
      customer_portal_points_basis: settings.customer_portal_points_basis === 'khr' ? 'khr' : 'usd',
      customer_portal_points_per_usd: String(settings.customer_portal_points_per_usd || '1'),
      customer_portal_points_per_khr: String(settings.customer_portal_points_per_khr || '0'),
      customer_portal_redeem_points: String(settings.customer_portal_redeem_points || '100'),
      customer_portal_redeem_value_usd: String(settings.customer_portal_redeem_value_usd || '1'),
      customer_portal_redeem_value_khr: String(settings.customer_portal_redeem_value_khr || '4100'),
      customer_portal_show_point_value: String(settings.customer_portal_show_point_value ?? 'true') === 'true',
      customer_portal_membership_info_text: String(settings.customer_portal_membership_info_text || ''),
      customer_portal_submission_reward_points: String(settings.customer_portal_submission_reward_points || '5'),
    })
  }, [settings])

  const loadCustomerPoints = useCallback(async (label = 'Loyalty customer points'): Promise<CustomerPointRow[] | null> => {
    const requestId = beginTrackedRequest(customerPointsRequestRef)
    setCustomerPointsLoading(true)
    try {
      const rows = await withLoaderTimeout(() => getLoyaltyCustomers(), label, LOYALTY_CUSTOMER_POINTS_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(customerPointsRequestRef, requestId)) return null
      const nextRows = toCustomerPointRows(rows)
      setCustomerPoints(nextRows)
      return nextRows
    } catch {
      if (!isTrackedRequestCurrent(customerPointsRequestRef, requestId)) return null
      return null
    } finally {
      if (isTrackedRequestCurrent(customerPointsRequestRef, requestId)) {
        setCustomerPointsLoading(false)
      }
    }
  }, [])

  const loadReviewItems = useCallback(async (label = 'Loyalty review items'): Promise<void> => {
    const requestId = beginTrackedRequest(reviewRequestRef)
    setReviewLoading(true)
    try {
      const result = await withLoaderTimeout(() => fetchPortalReviewItems(), label, LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS)
      if (!isTrackedRequestCurrent(reviewRequestRef, requestId)) return
      const nextItems = Array.isArray(result) ? (result as ReviewSubmissionItem[]).slice(0, 30) : []
      setReviewItems(nextItems)
    } catch {
      if (!isTrackedRequestCurrent(reviewRequestRef, requestId)) return
    } finally {
      if (isTrackedRequestCurrent(reviewRequestRef, requestId)) {
        setReviewLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      invalidateTrackedRequest(customerPointsRequestRef)
      invalidateTrackedRequest(lookupRequestRef)
      invalidateTrackedRequest(reviewRequestRef)
      setCustomerPointsLoading(false)
      setLookupLoading(false)
      setReviewLoading(false)
      return undefined
    }

    void loadCustomerPoints()
    void loadReviewItems()
    return () => {
      invalidateTrackedRequest(customerPointsRequestRef)
      invalidateTrackedRequest(lookupRequestRef)
      invalidateTrackedRequest(reviewRequestRef)
    }
  }, [isActive, loadCustomerPoints, loadReviewItems])

  async function handleReviewSubmission(item: ReviewSubmissionItem, status: string): Promise<void> {
    if (!beginSingleAction(reviewSavingRef, { blocked: reviewSavingId != null, value: item.id })) return
    try {
      setReviewSavingId(item.id)
      await withLoaderTimeout(
        () => submitPortalReview(item.id, {
          status,
          reward_points: Number(item.reward_points || 0),
            review_note: item.review_note || '',
        }),
        'Review portal submission',
        LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      )
      notify(status === 'approved' ? copy('approve', 'Approve') : status === 'rejected' ? copy('reject', 'Reject') : copy('pending', 'Pending'))
      void loadReviewItems('Reload loyalty review items')
      if (status === 'approved') void loadCustomerPoints('Reload loyalty customer points after review')
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to update submission'), 'error')
    } finally {
      finishSingleAction(reviewSavingRef)
      setReviewSavingId(null)
    }
  }

  const basis = form.customer_portal_points_basis === 'khr' ? 'khr' : 'usd'
  const redeemPoints = sanitizeInteger(form.customer_portal_redeem_points, 100, 1)
  const redeemValueUsd = sanitizeInteger(form.customer_portal_redeem_value_usd, 1, 0)
  const redeemValueKhr = sanitizeKhr(form.customer_portal_redeem_value_khr, 4100)
  const rewardPoints = sanitizeInteger(form.customer_portal_submission_reward_points, 5, 0)

  const policySummary = useMemo(() => {
    return basis === 'khr'
      ? `${copy('pointsPerKhr', 'Points per KHR')}: ${form.customer_portal_points_per_khr || '0'}`
      : `${copy('pointsPerUsd', 'Points per USD')}: ${form.customer_portal_points_per_usd || '1'}`
  }, [basis, form.customer_portal_points_per_khr, form.customer_portal_points_per_usd])

  const topPointCustomers = useMemo(() => (
    customerPoints
      .filter((row) => String(row?.membership_number || '').trim())
      .sort((a, b) => Number(b.points_balance || 0) - Number(a.points_balance || 0))
      .slice(0, 10)
  ), [customerPoints])

  function setValue<K extends keyof LoyaltySettingsForm>(key: K, value: LoyaltySettingsForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
    if (!beginSingleAction(saveInFlightRef)) return
    try {
      setSaving(true)
      await saveSettings({
        customer_portal_points_basis: basis,
        customer_portal_points_per_usd: basis === 'usd' ? String(Math.max(0, Number(form.customer_portal_points_per_usd || 1))) : '0',
        customer_portal_points_per_khr: basis === 'khr' ? String(Math.max(0, Number(form.customer_portal_points_per_khr || 0))) : '0',
        customer_portal_redeem_points: String(redeemPoints),
        customer_portal_redeem_value_usd: String(redeemValueUsd),
        customer_portal_redeem_value_khr: String(redeemValueKhr),
        customer_portal_show_point_value: form.customer_portal_show_point_value ? 'true' : 'false',
        customer_portal_membership_info_text: form.customer_portal_membership_info_text || '',
        customer_portal_submission_reward_points: String(rewardPoints),
      })
      notify(copy('saved', 'Point rules saved.'))
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to save point rules'), 'error')
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  async function handleLookup(): Promise<void> {
    const value = membershipNumber.trim()
    if (!value) {
      setLookupError(copy('lookupRequired', 'Enter a membership number first.'))
      setLookupData(null)
      return
    }

    const requestId = beginTrackedRequest(lookupRequestRef)
    try {
      setLookupLoading(true)
      setLookupError('')
      const result = await withLoaderTimeout(
        () => lookupLoyaltyPortalMembership(value),
        'Loyalty membership lookup',
        LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      )
      if (!isTrackedRequestCurrent(lookupRequestRef, requestId)) return
      if (!result) {
        setLookupData(null)
        setLookupError(copy('customerNotFound', 'Membership number not found.'))
        return
      }
      setLookupData(result as MembershipLookupData)
    } catch (error) {
      if (!isTrackedRequestCurrent(lookupRequestRef, requestId)) return
      setLookupData(null)
      setLookupError(getErrorMessage(error, copy('customerNotFound', 'Membership number not found.')))
    } finally {
      if (isTrackedRequestCurrent(lookupRequestRef, requestId)) {
        setLookupLoading(false)
      }
    }
  }

  async function handleAwardPoints(): Promise<void> {
    const customerId = lookupData?.customer?.id
    const points = Number(manualPoints)
    if (!customerId || !Number.isFinite(points) || points <= 0) {
      notify(copy('pointsToAdd', 'Points to add'), 'error')
      return
    }
    try {
      setManualPointSaving(true)
      await withLoaderTimeout(
        () => awardCustomerPoints(customerId, { points, note: manualPointNote.trim() }),
        'Award customer loyalty points',
        LOYALTY_MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      )
      setManualPoints('')
      setManualPointNote('')
      notify(copy('addPointsSuccess', 'Points added to the customer.'))
      await Promise.all([handleLookup(), loadCustomerPoints('Reload loyalty customer points after manual award')])
    } catch (error) {
      notify(getErrorMessage(error, 'Failed to add loyalty points'), 'error')
    } finally {
      setManualPointSaving(false)
    }
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <SectionSwitcher
          label={globalCopy('loyalty', 'Loyalty')}
          options={loyaltySectionOptions}
          value={loyaltySection}
          onChange={(value) => setLoyaltySection(normalizeLoyaltySection(value))}
          storageKey={sectionStorageKey}
        />
        <LoadingWatchdog
          loading={customerPointsLoading || lookupLoading}
          timeoutMs={8000}
          label={t('loading') || 'Loading...'}
          details={lookupLoading ? 'Checking the selected membership number.' : 'Loading customer point balances.'}
          onRetry={() => {
            void loadCustomerPoints('Retry loyalty customer points')
            if (membershipNumber.trim()) void handleLookup()
          }}
        />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_380px] 2xl:grid-cols-[minmax(0,1.55fr)_420px]">
          <div className="space-y-5">
            {showLoyaltySection('rules') ? (
            <section className="card p-4 sm:p-5">
              <div className="flex flex-col gap-4 border-b border-gray-100 pb-4 dark:border-gray-700 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    <Ticket className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('policyTitle', 'Point policy')}</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy('policyHint', 'These rules affect POS membership discounts, customer portal balances, and point deductions after refunds.')}</p>
                  </div>
                </div>
                <button type="button" className="btn-primary shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:text-sm" disabled={saving} onClick={handleSave}>
                  <Save className="mr-2 inline h-4 w-4" />
                  {copy('save', 'Save point rules')}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
                  {policySummary}
                </span>
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300">
                  {copy('unitLabel', '1 redemption unit')}: {redeemPoints} pts
                </span>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="points-basis" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('earningBasis', 'Earning basis')}</label>
                  <AppSelect
                    id="points-basis"
                    name="customer_portal_points_basis"
                    value={basis}
                    onChange={(nextValue) => setValue('customer_portal_points_basis', nextValue === 'khr' ? 'khr' : 'usd')}
                    ariaLabel={copy('earningBasis', 'Earning basis')}
                    className="mt-1 w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[14rem]"
                    options={[
                      { value: 'usd', label: copy('basisUsd', 'Based on USD sales') },
                      { value: 'khr', label: copy('basisKhr', 'Based on KHR sales') },
                    ]}
                  />
                </div>

                {basis === 'usd' ? (
                  <div>
                    <label htmlFor="points-per-usd" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('pointsPerUsd', 'Points per USD')}</label>
                    <input
                      id="points-per-usd"
                      name="customer_portal_points_per_usd"
                      className="input mt-1"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.customer_portal_points_per_usd || '1'}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_points_per_usd', event.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="points-per-khr" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('pointsPerKhr', 'Points per KHR')}</label>
                    <input
                      id="points-per-khr"
                      name="customer_portal_points_per_khr"
                      className="input mt-1"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={form.customer_portal_points_per_khr || '0'}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_points_per_khr', event.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="redeem-points" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('redeemPoints', 'Minimum redemption points')}</label>
                  <input
                    id="redeem-points"
                    name="customer_portal_redeem_points"
                    className="input mt-1"
                    type="number"
                    min="1"
                    step="1"
                    value={form.customer_portal_redeem_points || '100'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_redeem_points', event.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{copy('validationRedeem', 'Minimum redemption points must be a whole number of at least 1.')}</p>
                </div>

                <div>
                  <label htmlFor="redeem-usd" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('redeemValueUsd', 'Value per redemption unit (USD)')}</label>
                  <input
                    id="redeem-usd"
                    name="customer_portal_redeem_value_usd"
                    className="input mt-1"
                    type="number"
                    min="0"
                    step="1"
                    value={form.customer_portal_redeem_value_usd || '1'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_redeem_value_usd', event.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{copy('validationUsd', 'USD redemption value uses whole numbers only.')}</p>
                </div>

                <div>
                  <label htmlFor="redeem-khr" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('redeemValueKhr', 'Value per redemption unit (KHR)')}</label>
                  <input
                    id="redeem-khr"
                    name="customer_portal_redeem_value_khr"
                    className="input mt-1"
                    type="number"
                    min="0"
                    step="1000"
                    value={form.customer_portal_redeem_value_khr || '4100'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_redeem_value_khr', event.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{copy('validationKhr', 'KHR redemption value uses whole 1000 riel units and cannot be below 1000 when enabled.')}</p>
                </div>

                <div>
                  <label htmlFor="submission-reward-points" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('submissionRewardPoints', 'Default reward points per approved share')}</label>
                  <input
                    id="submission-reward-points"
                    name="customer_portal_submission_reward_points"
                    className="input mt-1"
                    type="number"
                    min="0"
                    step="1"
                    value={form.customer_portal_submission_reward_points || '5'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_submission_reward_points', event.target.value)}
                  />
                </div>
              </div>

              <label htmlFor="show-point-value" className="mt-4 flex items-center justify-between rounded-2xl border border-gray-200 px-4 py-3 dark:border-gray-700">
                <div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{copy('showPointValue', 'Show point value on customer portal')}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{copy('wholeUnitsOnly', 'Customers can view balances with decimals, but staff redeem points only in whole units.')}</div>
                </div>
                <input
                  id="show-point-value"
                  name="customer_portal_show_point_value"
                  type="checkbox"
                  checked={!!form.customer_portal_show_point_value}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setValue('customer_portal_show_point_value', event.target.checked)}
                />
              </label>

              <div className="mt-4">
                <label htmlFor="membership-info-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('infoText', 'Customer-facing membership note')}</label>
                <textarea
                  id="membership-info-text"
                  name="customer_portal_membership_info_text"
                  className="input mt-1 resize-none"
                  rows={4}
                  value={form.customer_portal_membership_info_text || ''}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue('customer_portal_membership_info_text', event.target.value)}
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{copy('infoTextHint', 'This note appears in the customer portal membership panel under the point summary and redemption rules.')}</p>
              </div>
            </section>
            ) : null}

            {showLoyaltySection('behavior') ? (
            <section className="card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-sky-100 p-3 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                  <BadgeDollarSign className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('behaviorTitle', 'How points move')}</h2>
                  <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    <li>{copy('behavior1', 'Completed sales earn points based on the active earning basis.')}</li>
                    <li>{copy('behavior2', 'Partial and full returns deduct points from the refunded value.')}</li>
                    <li>{copy('behavior3', 'Awaiting payment and cancelled sales do not count until completed.')}</li>
                    <li>{copy('behavior4', 'Staff can attach a customer later in Sales when an anonymous purchase needs points added afterward.')}</li>
                  </ul>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{copy('attachHint', 'Use Sales > sale details > attach customer when a past anonymous sale should start counting for membership.')}</p>
                </div>
              </div>
            </section>
            ) : null}
          </div>

          <aside className="space-y-5 xl:sticky xl:top-6">
            {showLoyaltySection('rules') ? (
            <section className="card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Gift className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('pointsPreview', 'Current policy preview')}</h2>
                  <div className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    <div>{policySummary}</div>
                    <div>{copy('unitLabel', '1 redemption unit')}: {redeemPoints} pts = {fmtUSD(redeemValueUsd)} / {fmtKHR(redeemValueKhr)}</div>
                    <div>{copy('showPointValue', 'Show point value on customer portal')}: {form.customer_portal_show_point_value ? 'ON' : 'OFF'}</div>
                    <div>{copy('submissionRewardPoints', 'Default reward points per approved share')}: {rewardPoints}</div>
                  </div>
                </div>
              </div>
            </section>
            ) : null}

            {showLoyaltySection('lookup') ? (
            <section className="card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-violet-100 p-3 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  <Search className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('customerTitle', 'Customer point lookup')}</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy('customerHint', 'Look up a membership number to review balance, history totals, and how the current rules apply.')}</p>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  id="membership-lookup"
                  name="membership_lookup"
                  className="input flex-1"
                  value={membershipNumber}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setMembershipNumber(event.target.value)}
                  placeholder={copy('membershipNumber', 'Membership number')}
                />
                <button type="button" className="btn-secondary" disabled={lookupLoading} onClick={handleLookup}>
                  {copy('lookup', 'Check points')}
                </button>
              </div>

              {lookupError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                  {lookupError}
                </div>
              ) : null}

              {lookupData ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{lookupData.customer?.name || lookupData.customer?.membership_number}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{lookupData.customer?.membership_number}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      [copy('balance', 'Balance'), formatLookupValue(lookupData.points?.balance)],
                      [copy('earned', 'Earned'), formatLookupValue(lookupData.points?.earned)],
                      [copy('deducted', 'Deducted by returns'), formatLookupValue(lookupData.points?.deducted)],
                      [copy('redeemed', 'Redeemed'), formatLookupValue(lookupData.points?.redeemed)],
                      [copy('rewarded', 'Rewarded'), formatLookupValue(lookupData.points?.rewarded)],
                      [copy('redemptionUnits', 'Redeemable units'), formatLookupValue(lookupData.points?.redeemableUnits)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-gray-200 px-3 py-3 dark:border-gray-700">
                        <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 rounded-2xl border border-gray-200 px-4 py-4 text-sm dark:border-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500 dark:text-gray-400">{copy('salesTotal', 'Sales total')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{fmtUSD((lookupData.totals || lookupData.summary || {}).totalSalesUsd || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500 dark:text-gray-400">{copy('returnsTotal', 'Returns total')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{fmtUSD((lookupData.totals || lookupData.summary || {}).totalReturnsUsd || 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500 dark:text-gray-400">{copy('membershipDiscounts', 'Membership discounts used')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{fmtUSD((lookupData.totals || lookupData.summary || {}).membershipDiscountUsd || 0)}</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                    <div className="text-sm font-semibold text-blue-950 dark:text-blue-100">{copy('addPoints', 'Add points')}</div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                      <input id="loyalty-manual-points" name="loyalty_manual_points" className="input" type="number" min="0.01" step="0.01" value={manualPoints} onChange={(event: ChangeEvent<HTMLInputElement>) => setManualPoints(event.target.value)} placeholder={copy('pointsToAdd', 'Points to add')} />
                      <input id="loyalty-manual-points-note" name="loyalty_manual_points_note" className="input" maxLength={500} value={manualPointNote} onChange={(event: ChangeEvent<HTMLInputElement>) => setManualPointNote(event.target.value)} placeholder={copy('pointNotePlaceholder', 'Reason / note')} />
                      <button type="button" className="btn-primary" disabled={manualPointSaving || !manualPoints} onClick={handleAwardPoints}>{copy('addPoints', 'Add points')}</button>
                    </div>
                    <label htmlFor="loyalty-manual-points-note" className="mt-2 block text-xs text-blue-700 dark:text-blue-300">{copy('pointNote', 'Reason / note')}</label>
                  </div>
                </div>
              ) : null}
            </section>
            ) : null}

            {showLoyaltySection('leaders') ? (
            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('customerTitle', 'Top customer points')}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy('pointsLeaderboardHint', 'Top customer balances from current membership points.')}</p>
              <div className="mt-3 space-y-2">
                {customerPointsLoading ? (
                  <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400 dark:border-gray-700">
                    {t('loading') || 'Loading...'}
                  </div>
                ) : topPointCustomers.length ? topPointCustomers.map((customer) => (
                  <div key={customer.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{customer.name || customer.membership_number}</div>
                      <div className="truncate text-xs font-mono text-gray-500 dark:text-gray-400">{customer.membership_number}</div>
                    </div>
                    <div className="text-right text-sm font-semibold text-blue-600 dark:text-blue-300">
                      {formatLookupValue(customer.points_balance)}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400 dark:border-gray-700">
                    {copy('noCustomersWithPoints', 'No customers with membership points yet.')}
                  </div>
                )}
              </div>
            </section>
            ) : null}
          </aside>
        </div>

        {showLoyaltySection('review') ? (
          <section className="card p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('reviewQueue', 'Review queue')}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy('reviewQueueHint', 'Approve, reject, and award points for customer share submissions.')}</p>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {reviewLoading ? (
                <div className="rounded-2xl border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                  {t('loading') || 'Loading...'}
                </div>
              ) : reviewItems.length ? reviewItems.map((item) => (
                <article key={item.id} className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{item.customer_name || item.membership_number || `#${item.id}`}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.membership_number || '-'}{item.platform ? ` • ${item.platform}` : ''}</div>
                    </div>
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{formatReviewDateTime(item.created_at)}</div>
                  </div>
                  {item.note ? <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{item.note}</p> : null}
                  {(item.screenshots || []).length ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(item.screenshots || []).map((image, index) => (
                        <button
                          key={`${item.id}-${index}`}
                          type="button"
                          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700"
                          onClick={() => window.open(image, '_blank', 'noreferrer')}
                        >
                          <img src={image} alt={`review-${item.id}-${index + 1}`} className="h-28 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`loyalty-review-reward-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('rewardPoints', 'Reward points')}</label>
                      <input
                        id={`loyalty-review-reward-${item.id}`}
                        name={`loyalty_review_reward_${item.id}`}
                        className="input mt-1"
                        type="number"
                        min="0"
                        step="1"
                        value={item.reward_points || 0}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, reward_points: event.target.value } : entry))}
                      />
                    </div>
                    <div>
                      <label htmlFor={`loyalty-review-note-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('shareReviewNote', 'Review note')}</label>
                      <input
                        id={`loyalty-review-note-${item.id}`}
                        name={`loyalty_review_note_${item.id}`}
                        className="input mt-1"
                        value={item.review_note || ''}
                        placeholder={copy('reviewNotePlaceholder', 'Internal review note')}
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, review_note: event.target.value } : entry))}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-primary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'approved')}>
                      {copy('approve', 'Approve')}
                    </button>
                    <button type="button" className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'rejected')}>
                      {copy('reject', 'Reject')}
                    </button>
                    <button type="button" className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'pending')}>
                      {copy('pending', 'Pending')}
                    </button>
                  </div>
                </article>
              )) : (
                <div className="rounded-2xl border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-gray-700">
                  {copy('noSubmissions', 'No share submissions yet.')}
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

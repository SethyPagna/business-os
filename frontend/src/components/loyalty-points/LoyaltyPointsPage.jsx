import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Gift, RotateCcw, Save, Search, Ticket } from 'lucide-react'
import { useApp } from '../../AppContext'

const COPY = {
  en: {
    pageTitle: 'Loyalty Points',
    pageSubtitle: 'Manage point earning rules, redemption values, and customer point visibility separately from the public portal layout.',
    policyTitle: 'Point policy',
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
  },
  km: {
    pageTitle: 'ពិន្ទុសមាជិក',
    pageSubtitle: 'កំណត់ច្បាប់ពិន្ទុ ការប្តូរពិន្ទុ និងការបង្ហាញសម្រាប់អតិថិជន ដោយឡែកពីការរចនាទំព័រ Customer Portal។',
    policyTitle: 'ច្បាប់ពិន្ទុ',
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
  },
}

function sanitizeInteger(value, fallback, min = 0) {
  const num = Math.floor(Number(value))
  return Number.isFinite(num) ? Math.max(min, num) : fallback
}

function sanitizeKhr(value, fallback) {
  const raw = sanitizeInteger(value, fallback, 0)
  if (raw === 0) return 0
  return Math.max(1000, Math.ceil(raw / 1000) * 1000)
}

function formatLookupValue(number) {
  return Number(number || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export default function LoyaltyPointsPage() {
  const { settings, saveSettings, notify, t, language, fmtUSD, fmtKHR } = useApp()
  const isKhmer = language === 'km'
  const copy = (key, fallback) => {
    const translated = t?.(key)
    if (translated && translated !== key) return translated
    return COPY[isKhmer ? 'km' : 'en'][key] || fallback || key
  }

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [membershipNumber, setMembershipNumber] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupData, setLookupData] = useState(null)
  const [customerPoints, setCustomerPoints] = useState([])
  const [customerPointsLoading, setCustomerPointsLoading] = useState(true)

  useEffect(() => {
    setForm({
      customer_portal_points_basis: settings.customer_portal_points_basis || 'usd',
      customer_portal_points_per_usd: settings.customer_portal_points_per_usd || '1',
      customer_portal_points_per_khr: settings.customer_portal_points_per_khr || '0',
      customer_portal_redeem_points: settings.customer_portal_redeem_points || '100',
      customer_portal_redeem_value_usd: settings.customer_portal_redeem_value_usd || '1',
      customer_portal_redeem_value_khr: settings.customer_portal_redeem_value_khr || '4100',
      customer_portal_show_point_value: String(settings.customer_portal_show_point_value ?? 'true') === 'true',
      customer_portal_membership_info_text: settings.customer_portal_membership_info_text || '',
      customer_portal_submission_reward_points: settings.customer_portal_submission_reward_points || '5',
    })
  }, [settings])

  useEffect(() => {
    let cancelled = false
    async function loadCustomerPoints() {
      try {
        setCustomerPointsLoading(true)
        const rows = await window.api.getCustomers()
        if (cancelled) return
        setCustomerPoints(Array.isArray(rows) ? rows : [])
      } catch (_) {
        if (!cancelled) setCustomerPoints([])
      } finally {
        if (!cancelled) setCustomerPointsLoading(false)
      }
    }
    loadCustomerPoints()
    return () => { cancelled = true }
  }, [])

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

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSave() {
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
      notify(error?.message || 'Failed to save point rules', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleLookup() {
    const value = membershipNumber.trim()
    if (!value) {
      setLookupError(copy('lookupRequired', 'Enter a membership number first.'))
      setLookupData(null)
      return
    }

    try {
      setLookupLoading(true)
      setLookupError('')
      const result = await window.api.lookupPortalMembership(value)
      if (!result) {
        setLookupData(null)
        setLookupError(copy('customerNotFound', 'Membership number not found.'))
        return
      }
      setLookupData(result)
    } catch (error) {
      setLookupData(null)
      setLookupError(error?.message || copy('customerNotFound', 'Membership number not found.'))
    } finally {
      setLookupLoading(false)
    }
  }

  return (
    <div className="page-scroll p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{copy('pageTitle', 'Loyalty Points')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{copy('pageSubtitle', 'Manage point earning rules, redemption values, and customer point visibility separately from the public portal layout.')}</p>
          </div>
          <button type="button" className="btn-primary shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:text-sm" disabled={saving} onClick={handleSave}>
            <Save className="mr-2 inline h-4 w-4" />
            {copy('save', 'Save point rules')}
          </button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_420px]">
          <div className="space-y-5">
            <section className="card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <Ticket className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('policyTitle', 'Point policy')}</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{copy('policyHint', 'These rules affect POS membership discounts, customer portal balances, and point deductions after refunds.')}</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="points-basis" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{copy('earningBasis', 'Earning basis')}</label>
                  <select
                    id="points-basis"
                    name="customer_portal_points_basis"
                    className="input mt-1"
                    value={basis}
                    onChange={(event) => setValue('customer_portal_points_basis', event.target.value)}
                  >
                    <option value="usd">{copy('basisUsd', 'Based on USD sales')}</option>
                    <option value="khr">{copy('basisKhr', 'Based on KHR sales')}</option>
                  </select>
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
                      onChange={(event) => setValue('customer_portal_points_per_usd', event.target.value)}
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
                      onChange={(event) => setValue('customer_portal_points_per_khr', event.target.value)}
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
                    onChange={(event) => setValue('customer_portal_redeem_points', event.target.value)}
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
                    onChange={(event) => setValue('customer_portal_redeem_value_usd', event.target.value)}
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
                    onChange={(event) => setValue('customer_portal_redeem_value_khr', event.target.value)}
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
                    onChange={(event) => setValue('customer_portal_submission_reward_points', event.target.value)}
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
                  onChange={(event) => setValue('customer_portal_show_point_value', event.target.checked)}
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
                  onChange={(event) => setValue('customer_portal_membership_info_text', event.target.value)}
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{copy('infoTextHint', 'This note appears in the customer portal membership panel under the point summary and redemption rules.')}</p>
              </div>
            </section>

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
          </div>

          <aside className="space-y-5 xl:sticky xl:top-6">
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
                  onChange={(event) => setMembershipNumber(event.target.value)}
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
                </div>
              ) : null}
            </section>

            <section className="card p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{copy('customerTitle', 'Customer point lookup')}</h2>
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
          </aside>
        </div>
      </div>
    </div>
  )
}

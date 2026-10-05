import { useCallback, useEffect, useRef, useState } from 'react'
import Send from 'lucide-react/dist/esm/icons/send.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import SignupConsentField from './legal/SignupConsentField.tsx'

// "Continue with Telegram" (G38 Telegram, owner rules of 6 Oct 2026).
//
// The member proves their phone through the shop's Telegram bot: the Worker
// mints a single-use sign-in bound to this browser (an httpOnly cookie), the
// member taps Start and "Share my phone number" in Telegram, and this page
// polls until the Worker signs them in (cloudflare/src/lib/portalTelegram.ts).
// Two uses:
//   mode 'signin'  signed out: sign in, or join as a new member;
//   mode 'attach'  signed in to an old phone + password account: connect
//                  Telegram after typing the password again.
//
// Loaded lazily in its own chunk (vite.config.ts 'portal-telegram'), so the
// storefront's first paint and the catalog-products closure carry none of it.
// Every string is in both packs (portal_telegram_*); the inline English and
// Khmer are the fallbacks the storefront shows before a pack loads.

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string

type Props = {
  copy: CopyFn
  mode: 'signin' | 'attach'
  language: string
  consentLocale?: string
  /** The Worker's answer once signed in or connected: { status, account }. */
  onDone: (result: Record<string, unknown>) => void
}

type Phase = 'idle' | 'starting' | 'waiting' | 'stalled'

// Backoff: quick at first (the member is usually back within seconds), then
// every five seconds, for about two minutes. After that the page waits for a
// "Check again" or for the tab to come back into view.
const POLL_DELAYS_MS = [2000, 2000, 3000, 3000, 4000]
const POLL_STEADY_MS = 5000
const POLL_WINDOW_MS = 120_000

const ERRORS: Record<string, [string, string, string]> = {
  telegram_unavailable: ['portal_telegram_err_unavailable', 'Telegram sign-in is not available right now.', 'ការចូលតាម Telegram មិនទាន់អាចប្រើបានទេពេលនេះ។'],
  consent_required: ['portal_telegram_consent_required', 'Please agree to the Terms & Conditions and the Privacy Policy to continue.', 'សូមយល់ព្រមនឹងលក្ខខណ្ឌប្រើប្រាស់ និងគោលការណ៍ឯកជនភាព ដើម្បីបន្ត។'],
  rate_limited: ['portal_telegram_err_rate_limited', 'Too many attempts. Please wait a few minutes.', 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំប៉ុន្មាននាទី។'],
  telegram_challenge_expired: ['portal_telegram_err_expired', 'This sign-in expired. Please try again.', 'ការចូលគណនីនេះផុតកំណត់ហើយ។ សូមព្យាយាមម្តងទៀត។'],
  telegram_challenge_not_found: ['portal_telegram_err_expired', 'This sign-in expired. Please try again.', 'ការចូលគណនីនេះផុតកំណត់ហើយ។ សូមព្យាយាមម្តងទៀត។'],
  telegram_challenge_used: ['portal_telegram_err_expired', 'This sign-in expired. Please try again.', 'ការចូលគណនីនេះផុតកំណត់ហើយ។ សូមព្យាយាមម្តងទៀត។'],
  telegram_signin_conflict: ['portal_telegram_err_expired', 'This sign-in expired. Please try again.', 'ការចូលគណនីនេះផុតកំណត់ហើយ។ សូមព្យាយាមម្តងទៀត។'],
  telegram_phone_has_account: ['portal_telegram_err_phone_has_account', 'This phone number already has an account. Sign in below with your phone number and password, then connect Telegram from your account.', 'លេខទូរស័ព្ទនេះមានគណនីរួចហើយ។ សូមចូលគណនីខាងក្រោមដោយប្រើលេខទូរស័ព្ទ និងពាក្យសម្ងាត់ រួចភ្ជាប់ Telegram ពីគណនីរបស់អ្នក។'],
  telegram_already_attached: ['portal_telegram_err_already_attached', 'This Telegram account or this website account is already connected. Please contact us.', 'គណនី Telegram នេះ ឬគណនីគេហទំព័រនេះ ត្រូវបានភ្ជាប់រួចហើយ។ សូមទាក់ទងយើង។'],
  telegram_phone_mismatch: ['portal_telegram_err_phone_mismatch', 'Your Telegram phone number is not the phone number on this account.', 'លេខទូរស័ព្ទ Telegram របស់អ្នក មិនមែនជាលេខទូរស័ព្ទក្នុងគណនីនេះទេ។'],
  portal_account_suspended: ['portal_telegram_err_suspended', 'This account is paused. Please contact us.', 'គណនីនេះត្រូវបានផ្អាក។ សូមទាក់ទងយើង។'],
  telegram_account_unavailable: ['portal_telegram_err_account_unavailable', 'This account cannot be used. Please contact us.', 'គណនីនេះមិនអាចប្រើបានទេ។ សូមទាក់ទងយើង។'],
  invalid_credentials: ['portal_telegram_err_password', 'The password is not correct.', 'ពាក្យសម្ងាត់មិនត្រឹមត្រូវទេ។'],
  password_required: ['portal_telegram_err_password_required', 'Please enter your password.', 'សូមបញ្ចូលពាក្យសម្ងាត់របស់អ្នក។'],
  portal_unauthenticated: ['portal_telegram_err_signed_out', 'Please sign in again, then connect Telegram.', 'សូមចូលគណនីម្តងទៀត រួចភ្ជាប់ Telegram។'],
}
const GENERIC_ERROR: [string, string, string] = ['portal_telegram_err_generic', 'Something went wrong. Please try again.', 'មានបញ្ហាមួយ។ សូមព្យាយាមម្តងទៀត។']

async function portalJson(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await response.json().catch(() => ({})) as Record<string, unknown>
  return { status: response.status, json }
}

export default function PortalTelegramSignIn({ copy, mode, language, consentLocale, onDone }: Props) {
  const locale = language === 'en' ? 'en' : 'km'
  // null while asking the Worker; false hides the whole block.
  const [available, setAvailable] = useState<boolean | null>(null)
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [stage, setStage] = useState<'pending' | 'started'>('pending')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [password, setPassword] = useState('')

  const nonceRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAtRef = useRef(0)
  const attemptRef = useRef(0)
  const inFlightRef = useRef(false)
  const aliveRef = useRef(true)

  const errorText = useCallback((code: unknown) => {
    const [key, en, km] = ERRORS[String(code || '')] || GENERIC_ERROR
    return copy(key, en, km)
  }, [copy])

  useEffect(() => {
    aliveRef.current = true
    const url = mode === 'attach' ? '/api/portal/account/telegram' : '/api/portal/auth/telegram/status'
    portalJson(url, 'GET')
      .then(({ status, json }) => {
        if (!aliveRef.current) return
        if (status !== 200) { setAvailable(false); return }
        setConnected(json.connected === true)
        setAvailable(json.available === true && (mode === 'signin' || json.connected === true || json.canConnect === true))
      })
      .catch(() => { if (aliveRef.current) setAvailable(false) })
    return () => {
      aliveRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [mode])

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    nonceRef.current = ''
  }, [])

  const poll = useCallback(async () => {
    const nonce = nonceRef.current
    if (!nonce || inFlightRef.current) return
    inFlightRef.current = true
    try {
      const { status, json } = await portalJson('/api/portal/auth/telegram/poll', 'POST', { nonce })
      if (!aliveRef.current || nonceRef.current !== nonce) return
      if (status === 200 && json.status === 'waiting') {
        setStage(json.stage === 'started' ? 'started' : 'pending')
        if (Date.now() - startedAtRef.current >= POLL_WINDOW_MS) { setPhase('stalled'); return }
        const delay = POLL_DELAYS_MS[attemptRef.current] ?? POLL_STEADY_MS
        attemptRef.current += 1
        timerRef.current = setTimeout(() => { void poll() }, delay)
        return
      }
      stop()
      setPhase('idle')
      if (status === 200 && (json.status === 'signed_in' || json.status === 'attached')) {
        setPassword('')
        if (json.status === 'attached') setConnected(true)
        onDone(json)
        return
      }
      setError(errorText(json.code))
    } catch {
      if (!aliveRef.current || nonceRef.current !== nonce) return
      // A dropped connection is not an answer: try again on the steady beat.
      timerRef.current = setTimeout(() => { void poll() }, POLL_STEADY_MS)
    } finally {
      inFlightRef.current = false
    }
  }, [errorText, onDone, stop])

  // Coming back from Telegram brings the tab into view: check at once.
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'stalled') return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !nonceRef.current) return
      if (timerRef.current) clearTimeout(timerRef.current)
      void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [phase, poll])

  const begin = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setError('')
    if (mode === 'signin' && !consent) {
      setConsentError(errorText('consent_required'))
      return
    }
    setConsentError('')
    setPhase('starting')
    try {
      const body = mode === 'attach'
        ? { mode: 'attach', password, locale }
        : { mode: 'signin', consent, consentLocale: consentLocale || locale, locale }
      const { status, json } = await portalJson('/api/portal/auth/telegram/start', 'POST', body)
      if (!aliveRef.current) return
      if (status !== 200 || typeof json.nonce !== 'string' || typeof json.link !== 'string') {
        setPhase('idle')
        setError(errorText(json.code))
        return
      }
      nonceRef.current = json.nonce
      startedAtRef.current = Date.now()
      attemptRef.current = 0
      setLink(json.link)
      setStage('pending')
      setPhase('waiting')
      timerRef.current = setTimeout(() => { void poll() }, POLL_DELAYS_MS[0])
    } catch {
      if (aliveRef.current) { setPhase('idle'); setError(errorText('')) }
    }
  }

  const cancel = () => { stop(); setPhase('idle') }
  const checkAgain = () => {
    if (!nonceRef.current) return
    startedAtRef.current = Date.now()
    attemptRef.current = 0
    setPhase('waiting')
    void poll()
  }

  if (available === null) {
    // Holds the button's place while the Worker answers, so nothing jumps.
    return mode === 'signin' ? <div aria-hidden="true" className="mb-5 h-11 animate-pulse rounded-2xl bg-slate-100 dark:bg-white/5" /> : null
  }
  if (!available) return null

  if (mode === 'attach' && connected) {
    return (
      <div data-portal-telegram="connected" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/5 dark:text-neutral-200">
        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
        <span>{copy('portal_telegram_connected', 'Telegram connected', 'បានភ្ជាប់ Telegram')}</span>
      </div>
    )
  }

  const errorBox = error ? (
    <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">{error}</p>
  ) : null

  if (phase === 'waiting' || phase === 'stalled') {
    return (
      <div data-portal-telegram="waiting" className={`space-y-3 rounded-2xl ${mode === 'signin' ? 'mb-5 ' : ''} border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-400/25 dark:bg-sky-400/5`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{copy('portal_telegram_waiting_title', 'Finish in Telegram', 'បញ្ចប់នៅក្នុង Telegram')}</div>
          <button
            type="button"
            onClick={cancel}
            aria-label={copy('portal_telegram_cancel', 'Cancel', 'បោះបង់')}
            title={copy('portal_telegram_cancel', 'Cancel', 'បោះបង់')}
            className="-mr-1 -mt-1 flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {copy('portal_telegram_open', 'Open Telegram', 'បើក Telegram')}
        </a>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-600 dark:text-neutral-300">
          <li>{copy('portal_telegram_step_start', 'Tap Start, then "Share my phone number".', 'ចុច Start រួចចុច "ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ"។')}</li>
          <li>{copy('portal_telegram_step_return', 'Come back here. We sign you in automatically.', 'ត្រឡប់មកទីនេះវិញ។ យើងនឹងចូលគណនីឱ្យអ្នកដោយស្វ័យប្រវត្តិ។')}</li>
        </ol>
        <p aria-live="polite" className="text-xs font-medium text-sky-800 dark:text-sky-200">
          {phase === 'stalled'
            ? copy('portal_telegram_still_waiting', 'Still waiting? Check again after you share your number.', 'នៅតែរង់ចាំ? សូមពិនិត្យម្តងទៀត បន្ទាប់ពីអ្នកចែករំលែកលេខ។')
            : stage === 'started'
              ? copy('portal_telegram_status_started', 'Now share your phone number in Telegram.', 'ឥឡូវនេះ សូមចែករំលែកលេខទូរស័ព្ទរបស់អ្នកនៅក្នុង Telegram។')
              : copy('portal_telegram_status_pending', 'Waiting for Telegram…', 'កំពុងរង់ចាំ Telegram…')}
        </p>
        {phase === 'stalled' ? (
          <button
            type="button"
            onClick={checkAgain}
            aria-label={copy('portal_telegram_check_again', 'Check again', 'ពិនិត្យម្តងទៀត')}
            title={copy('portal_telegram_check_again', 'Check again', 'ពិនិត្យម្តងទៀត')}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-white text-sky-800 transition hover:bg-sky-50 dark:border-sky-400/30 dark:bg-transparent dark:text-sky-200"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    )
  }

  if (mode === 'attach') {
    return (
      <form onSubmit={begin} data-portal-telegram="connect" className="space-y-2">
        {errorBox}
        <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
          {copy('portal_telegram_connect_hint', 'Enter your password to connect Telegram to this account. Your Telegram phone number must be the one on this account.', 'បញ្ចូលពាក្យសម្ងាត់ ដើម្បីភ្ជាប់ Telegram ទៅគណនីនេះ។ លេខទូរស័ព្ទ Telegram របស់អ្នកត្រូវតែជាលេខក្នុងគណនីនេះ។')}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-label={copy('password', 'Password', 'ពាក្យសម្ងាត់')}
            placeholder={copy('password', 'Password', 'ពាក្យសម្ងាត់')}
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#0369a1] dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus-visible:outline-[#fcd34d]"
          />
          <button type="submit" disabled={phase === 'starting'} className={`${buttonClass} w-auto shrink-0`}>
            <Send className="h-4 w-4" aria-hidden="true" />
            {copy('portal_telegram_connect', 'Connect Telegram', 'ភ្ជាប់ Telegram')}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={begin} data-portal-telegram="start" className="mb-5 space-y-3">
      {errorBox}
      <SignupConsentField
        id="portal-consent-telegram"
        copy={copy}
        checked={consent}
        onChange={(next) => { setConsent(next); if (next) setConsentError('') }}
        error={consentError}
      />
      <button type="submit" disabled={phase === 'starting'} className={buttonClass}>
        <Send className="h-4 w-4" aria-hidden="true" />
        {copy('portal_telegram_continue', 'Continue with Telegram', 'បន្តជាមួយ Telegram')}
      </button>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-neutral-400">
        {copy('portal_telegram_hint', 'New or returning: we confirm your phone number through Telegram. No password needed.', 'សមាជិកថ្មី ឬចាស់៖ យើងបញ្ជាក់លេខទូរស័ព្ទរបស់អ្នកតាម Telegram។ មិនត្រូវការពាក្យសម្ងាត់ទេ។')}
      </p>
      {/* Only when Telegram is offered: existing members still have the password form below. */}
      <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-neutral-500">
        <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" aria-hidden="true" />
        <span className="text-center">{copy('portal_telegram_or_password', 'Or sign in with your phone number and password', 'ឬចូលគណនីដោយលេខទូរស័ព្ទ និងពាក្យសម្ងាត់')}</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" aria-hidden="true" />
      </div>
    </form>
  )
}

// sky-700 on white is 5.9:1 (WCAG AA for the button's small text); Telegram's
// own #229ED9 is about 3:1 and would not pass.
const buttonClass = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60'

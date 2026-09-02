import X from 'lucide-react/dist/esm/icons/x.js'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp as useAppFromContext } from '../../AppContext.tsx'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../utils/loaders.ts'
import { beginSingleAction, finishSingleAction } from '../../utils/actionGuards.ts'
import InfoHint from '../shared/InfoHint.tsx'

type OtpMode = 'setup' | 'disable' | 'recover'
type OtpStep = 'loading' | 'confirm_disable' | 'scan' | 'error'
type Translate = (key: string, fallback?: string) => string | undefined

export type OtpModalProps = {
  mode: OtpMode
  userId?: string | number | null
  targetName?: string | null
  targetUsername?: string | null
  onClose: () => void
  onDone: (enabled: boolean) => void
  t?: Translate
}

type AppContextValue = {
  t?: Translate
}

type OtpApiResult = {
  success?: boolean
  qrDataUrl?: string | null
  otpAuthUrl?: string | null
  secret?: string | null
  error?: string
}

type OtpApi = {
  otpSetup?: (payload: { userId?: string | number | null }) => Promise<OtpApiResult>
  otpConfirm?: (payload: { userId?: string | number | null; token: string }) => Promise<OtpApiResult>
  otpDisable?: (payload: { userId?: string | number | null; password: string }) => Promise<OtpApiResult>
  otpRecoveryReset?: (payload: { userId?: string | number | null; password: string; confirmation: string }) => Promise<OtpApiResult>
}

const useApp = useAppFromContext as () => AppContextValue
const OTP_SETUP_TIMEOUT_MS = 12000
const OTP_CONFIRM_TIMEOUT_MS = 12000
const OTP_DISABLE_TIMEOUT_MS = 12000

function getOtpApi(): OtpApi {
  return typeof window === 'undefined' ? {} : (window as Window & { api?: OtpApi }).api || {}
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback)
}

function normalizeOtpQrDataUrl(value: unknown): string | null {
  const dataUrl = String(value || '').trim()
  return /^data:image\/(?:png|jpeg|webp|svg\+xml);(?:base64|utf8),/i.test(dataUrl) ? dataUrl : null
}

export default function OtpModal({ mode, userId, targetName, targetUsername, onClose, onDone, t }: OtpModalProps) {
  const app = useApp()
  const tr = t || app.t || ((key: string) => key)
  const [step, setStep] = useState<OtpStep>(mode === 'setup' ? 'loading' : 'confirm_disable')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [otpAuthUrl, setOtpAuthUrl] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [qrGenerationFailed, setQrGenerationFailed] = useState(false)
  const setupRequestRef = useRef(0)
  const actionRequestRef = useRef(0)
  const actionInFlightRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(setupRequestRef)
    invalidateTrackedRequest(actionRequestRef)
  }, [])

  useEffect(() => {
    if (mode !== 'setup') {
      invalidateTrackedRequest(setupRequestRef)
      setStep('confirm_disable')
      return
    }

    setStep('loading')
    setError('')
    setQrDataUrl(null)
    setOtpAuthUrl(null)
    setSecret(null)
    setQrGenerationFailed(false)
    const requestId = beginTrackedRequest(setupRequestRef)

    async function loadSetup() {
      try {
        const result = await withLoaderTimeout(
          () => getOtpApi().otpSetup?.({ userId }) || Promise.resolve({ success: false, error: 'OTP setup is unavailable' }),
          'OTP setup',
          OTP_SETUP_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(setupRequestRef, requestId)) return
        if (result?.success) {
          setQrDataUrl(normalizeOtpQrDataUrl(result.qrDataUrl))
          setOtpAuthUrl(result.otpAuthUrl || null)
          setSecret(result.secret || null)
          setStep('scan')
          return
        }
        setError(result?.error || 'Setup failed')
        setStep('error')
      } catch (setupError: unknown) {
        if (!aliveRef.current || !isTrackedRequestCurrent(setupRequestRef, requestId)) return
        setError(getErrorMessage(setupError, 'Setup failed'))
        setStep('error')
      }
    }

    loadSetup()

    return () => {
      invalidateTrackedRequest(setupRequestRef)
    }
  }, [mode, userId])

  // The Worker returns the standards-based otpauth URI, rather than raster
  // image bytes. Generate the QR only in the user's browser so the temporary
  // enrollment secret is neither cached nor exposed by an image endpoint.
  useEffect(() => {
    if (qrDataUrl || !otpAuthUrl || qrGenerationFailed) return
    let cancelled = false
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(otpAuthUrl, { width: 384, margin: 1, errorCorrectionLevel: 'M' }))
      .then((dataUrl) => {
        if (cancelled) return
        const normalized = normalizeOtpQrDataUrl(dataUrl)
        if (normalized) setQrDataUrl(normalized)
        else setQrGenerationFailed(true)
      })
      // The manual key remains a usable, secure fallback if the optional
      // client-side encoder cannot load.
      .catch(() => { if (!cancelled) setQrGenerationFailed(true) })
    return () => { cancelled = true }
  }, [otpAuthUrl, qrDataUrl, qrGenerationFailed])

  const handleConfirm = useCallback(async () => {
    if (!code || code.length !== 6) {
      setError('Enter the 6-digit code')
      return
    }
    if (!beginSingleAction(actionInFlightRef)) return

    const requestId = beginTrackedRequest(actionRequestRef)
    setLoading(true)
    setError('')
    try {
      const result = await withLoaderTimeout(
        () => getOtpApi().otpConfirm?.({ userId, token: code }) || Promise.resolve({ success: false, error: 'OTP confirmation is unavailable' }),
        'OTP confirmation',
        OTP_CONFIRM_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      if (result?.success) {
        onDone(true)
        return
      }
      setError(result?.error || 'Invalid code - check your app is synced')
    } catch (confirmError: unknown) {
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      setError(getErrorMessage(confirmError, 'Failed to confirm code'))
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(actionRequestRef, requestId)) {
        finishSingleAction(actionInFlightRef)
        setLoading(false)
      }
    }
  }, [code, onDone, userId])

  const handleDisable = useCallback(async () => {
    if (!password.trim()) {
      setError(tr('current_password_required_change') || 'Current password is required')
      return
    }
    if (!beginSingleAction(actionInFlightRef)) return

    const requestId = beginTrackedRequest(actionRequestRef)
    setLoading(true)
    setError('')
    try {
      const result = await withLoaderTimeout(
        () => getOtpApi().otpDisable?.({ userId, password }) || Promise.resolve({ success: false, error: 'OTP disable is unavailable' }),
        'OTP disable',
        OTP_DISABLE_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      if (result?.success) {
        onDone(false)
        return
      }
      setError(result?.error || 'Failed to disable')
    } catch (disableError: unknown) {
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      setError(getErrorMessage(disableError, 'Failed to disable'))
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(actionRequestRef, requestId)) {
        finishSingleAction(actionInFlightRef)
        setLoading(false)
      }
    }
  }, [onDone, password, tr, userId])

  const handleRecoveryReset = useCallback(async () => {
    if (!password.trim()) {
      setError(tr('current_password_required_change') || 'Your current password is required')
      return
    }
    if (recoveryConfirmation.trim().toUpperCase() !== 'RESET 2FA') {
      setError(tr('otp_recovery_confirmation_required') || 'Type RESET 2FA to confirm')
      return
    }
    if (!beginSingleAction(actionInFlightRef)) return

    const requestId = beginTrackedRequest(actionRequestRef)
    setLoading(true)
    setError('')
    try {
      const result = await withLoaderTimeout(
        () => getOtpApi().otpRecoveryReset?.({ userId, password, confirmation: recoveryConfirmation }) || Promise.resolve({ success: false, error: '2FA recovery is unavailable' }),
        'Reset another user 2FA',
        OTP_DISABLE_TIMEOUT_MS,
      )
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      if (result?.success) {
        onDone(false)
        return
      }
      setError(result?.error || 'Failed to reset 2FA')
    } catch (recoveryError: unknown) {
      if (!aliveRef.current || !isTrackedRequestCurrent(actionRequestRef, requestId)) return
      setError(getErrorMessage(recoveryError, 'Failed to reset 2FA'))
    } finally {
      if (aliveRef.current && isTrackedRequestCurrent(actionRequestRef, requestId)) {
        finishSingleAction(actionInFlightRef)
        setLoading(false)
      }
    }
  }, [onDone, password, recoveryConfirmation, tr, userId])

  const handleClose = useCallback(() => {
    if (actionInFlightRef.current) return
    onClose()
  }, [onClose])

  // Z6: portal to document.body and sit ABOVE the profile Modal (z-[1050]).
  // Rendered inline, the OTP dialog was a DOM child of UserProfileModal's
  // tree -- trapped inside its stacking context (painted UNDER the profile)
  // and unmounted the moment the profile closed. Portaling + z-[1060] fixes
  // both: it paints on top of everything and its lifecycle is its own.
  return createPortal((
    <div className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1060] flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:items-center sm:p-4">
      <div className="modal-panel-safe flex w-full max-w-md flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800 fade-in">
      <div className="modal-scroll p-3 sm:p-4">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold text-gray-900 dark:text-white">
            {mode === 'setup'
              ? (tr('otp_setup') || 'Set Up 2FA')
              : mode === 'recover'
                ? (tr('otp_recovery_reset', 'Reset another user’s 2FA'))
                : (tr('otp_disable') || 'Disable 2FA')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label={tr('close') || 'Close'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'loading' && <div className="py-8 text-center text-gray-400">{tr('loading') || 'Loading...'}</div>}

        {step === 'error' && (
          <div className="text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>
        )}

        {step === 'scan' && (
          <div className="space-y-3">
            <div className="flex items-center gap-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
              <span>{tr('otp_scan_qr') || 'Scan QR code'}</span>
              <InfoHint label={tr('otp_scan_qr') || 'Scan QR code'} text="Scan with any standards-compatible authenticator app, then enter the current 6-digit code. The manual key below is the fallback if camera scanning is unavailable." />
            </div>
            {qrDataUrl ? (
              <div className="flex justify-center">
                <img
                  src={qrDataUrl}
                  alt={tr('otp_scan_qr') || 'OTP setup QR code'}
                  className="h-44 w-44 rounded-lg border-4 border-white bg-white shadow sm:h-48 sm:w-48"
                  onError={() => {
                    setQrDataUrl(null)
                    setQrGenerationFailed(true)
                  }}
                />
              </div>
            ) : (
              <div className="rounded-lg bg-gray-100 p-2.5 text-center text-sm text-gray-500 dark:bg-gray-700">
                <p className="mb-1 text-xs font-medium">{tr('manual_setup_key') || 'Manual setup key'}</p>
                <code className="select-all break-all font-mono text-xs text-gray-800 dark:text-gray-200">{secret || (tr('loading') || 'Loading...')}</code>
              </div>
            )}
            {qrDataUrl && secret ? (
              <>
                <button type="button" className="w-full text-center text-xs text-blue-600 hover:underline dark:text-blue-300" onClick={() => setShowSecret((value) => !value)}>
                  {showSecret ? (tr('hide_manual_key') || 'Hide manual key') : (tr('show_manual_key') || 'Show manual key')}
                </button>
                {showSecret ? (
                  <div className="rounded-lg bg-gray-50 p-2.5 text-center dark:bg-gray-700/50">
                    <p className="mb-1 text-xs text-gray-500">{tr('manual_setup_key') || 'Manual setup key'}</p>
                    <code className="select-all break-all font-mono text-xs tracking-wider text-gray-800 dark:text-gray-200">{secret}</code>
                  </div>
                ) : null}
              </>
            ) : null}
            <div>
              <label htmlFor="otp-setup-code" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('enter_otp_to_confirm') || 'Enter the 6-digit code to confirm'}</label>
              <input
                id="otp-setup-code"
                name="otp_setup_code"
                autoComplete="one-time-code"
                className="input h-10 text-center font-mono text-lg tracking-widest"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
              />
            </div>
            {error && <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-primary min-w-0 px-2 text-xs" onClick={handleConfirm} disabled={loading || code.length !== 6}>
                {loading ? (tr('verifying') || 'Verifying...') : (tr('confirm_enable') || 'Confirm & Enable')}
              </button>
              <button type="button" className="btn-secondary min-w-0 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50" onClick={handleClose} disabled={loading}>
                {tr('cancel')}
              </button>
            </div>
          </div>
        )}

        {step === 'confirm_disable' && (
          <div className="space-y-3">
            <div className={`flex items-center gap-1 rounded-lg p-2.5 text-sm font-medium ${mode === 'recover' ? 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300' : 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'}`}>
              <span>{mode === 'recover'
                ? (tr('otp_recovery_warning') || `This removes 2FA for ${targetName || targetUsername || 'this account'}, signs it out everywhere, and requires it to enroll again after login.`)
                : (tr('disable_2fa_warning') || 'Disabling 2FA reduces account security.')}</span>
              <InfoHint label={mode === 'recover' ? (tr('otp_recovery_reset', 'Reset another user’s 2FA') || 'Reset another user’s 2FA') : (tr('disable_2fa') || 'Disable 2FA')} text={mode === 'recover'
                ? 'Break-glass recovery requires a different signed-in administrator, that administrator’s current password, and an explicit confirmation phrase. The affected account is signed out of every session.'
                : 'Your current password is required before two-factor authentication can be disabled.'} />
            </div>
            <div>
              <label htmlFor="otp-disable-password" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{mode === 'recover' ? (tr('your_current_password', 'Your current password')) : (tr('current_password') || 'Current password')}</label>
              <input
                id="otp-disable-password"
                name="otp_disable_password"
                autoComplete="current-password"
                className="input h-10"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoFocus
              />
            </div>
            {mode === 'recover' ? (
              <div>
                <label htmlFor="otp-recovery-confirmation" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">{tr('otp_recovery_confirm_label', 'Type RESET 2FA to confirm')}</label>
                <input
                  id="otp-recovery-confirmation"
                  name="otp_recovery_confirmation"
                  autoComplete="off"
                  className="input h-10 font-mono"
                  value={recoveryConfirmation}
                  onChange={(event) => setRecoveryConfirmation(event.target.value)}
                  placeholder="RESET 2FA"
                />
              </div>
            ) : null}
            {error && <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-danger min-w-0 px-2 text-xs" onClick={mode === 'recover' ? handleRecoveryReset : handleDisable} disabled={loading || !password || (mode === 'recover' && recoveryConfirmation.trim().toUpperCase() !== 'RESET 2FA')}>
                {loading
                  ? (mode === 'recover' ? (tr('resetting', 'Resetting...')) : (tr('disabling') || 'Disabling...'))
                  : (mode === 'recover' ? (tr('reset_2fa', 'Reset 2FA')) : (tr('disable_2fa') || 'Disable 2FA'))}
              </button>
              <button type="button" className="btn-secondary min-w-0 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50" onClick={handleClose} disabled={loading}>
                {tr('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  ), document.body)
}

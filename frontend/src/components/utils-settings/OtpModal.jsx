// ── OtpModal ─────────────────────────────────────────────────────────────────
// Two-factor authentication setup / disable modal.
import { useState, useEffect } from 'react'
import { useApp } from '../../AppContext'

export default
function OtpModal({ mode, userId, onClose, onDone, t }) {
  const app = useApp()
  const tr = t || app.t
  const [step, setStep] = useState(mode === 'setup' ? 'loading' : 'confirm_disable')
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [secret, setSecret] = useState(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    if (mode === 'setup') {
      window.api.otpSetup({ userId }).then(res => {
        if (res?.success) { setQrDataUrl(res.qrDataUrl); setSecret(res.secret); setStep('scan') }
        else { setError(res?.error || 'Setup failed'); setStep('error') }
      }).catch(e => { setError(e.message); setStep('error') })
    }
  }, [mode, userId])

  const handleConfirm = async () => {
    if (!code || code.length !== 6) { setError('Enter the 6-digit code'); return }
    setLoading(true); setError('')
    try {
      const res = await window.api.otpConfirm({ userId, token: code })
      if (res?.success) onDone(true)
      else setError(res?.error || 'Invalid code — check your app is synced')
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  const handleDisable = async () => {
    setLoading(true); setError('')
    try {
      const res = await window.api.otpDisable({ userId, password })
      if (res?.success) onDone(false)
      else setError(res?.error || 'Failed to disable')
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 fade-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {mode === 'setup' ? '🔐 Set Up 2FA' : '🔓 Disable 2FA'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center">×</button>
        </div>

        {step === 'loading' && <div className="text-center py-8 text-gray-400">Loading...</div>}

        {step === 'error' && (
          <div className="text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>
        )}

        {step === 'scan' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)
            </p>
            {qrDataUrl ? (
              <div className="flex justify-center">
                <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-xl border-4 border-white shadow-lg" />
              </div>
            ) : (
              <div className="bg-gray-100 dark:bg-gray-700 rounded-xl p-4 text-center text-sm text-gray-500">
                <p className="font-medium mb-1">Manual setup key:</p>
                <code className="text-xs font-mono break-all">{secret}</code>
              </div>
            )}
            <button className="text-xs text-blue-500 hover:underline w-full text-center" onClick={() => setShowSecret(!showSecret)}>
              {showSecret ? '▲ Hide manual key' : '▼ Show manual entry key'}
            </button>
            {showSecret && secret && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Manual entry key:</p>
                <code className="text-sm font-mono tracking-widest text-gray-800 dark:text-gray-200 break-all select-all">{secret}</code>
              </div>
            )}
            <div>
              <label htmlFor="otp-setup-code" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Enter the 6-digit code to confirm:</label>
              <input id="otp-setup-code" name="otp_setup_code" autoComplete="one-time-code" className="input text-center text-xl font-mono tracking-widest" type="text" inputMode="numeric" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" autoFocus />
            </div>
            {error && <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>}
            <div className="flex gap-3">
              <button className="btn-primary flex-1" onClick={handleConfirm} disabled={loading || code.length !== 6}>
                {loading ? (tr('verifying')||'Verifying...') : (tr('confirm_enable')||'✅ Confirm & Enable')}
              </button>
              <button className="btn-secondary" onClick={onClose}>{tr('cancel')}</button>
            </div>
          </div>
        )}

        {step === 'confirm_disable' && (
          <div className="space-y-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-300 font-medium">⚠️ Disabling 2FA reduces your account security.</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">Enter your password to confirm.</p>
            </div>
            <div>
              <label htmlFor="otp-disable-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input id="otp-disable-password" name="otp_disable_password" autoComplete="current-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" autoFocus />
            </div>
            {error && <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</div>}
            <div className="flex gap-3">
              <button className="btn-danger flex-1" onClick={handleDisable} disabled={loading || !password}>
                {loading ? (tr('disabling')||'Disabling...') : (tr('disable_2fa')||'🔓 Disable 2FA')}
              </button>
              <button className="btn-secondary" onClick={onClose}>{tr('cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

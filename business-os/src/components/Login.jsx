import { useState, useEffect, useRef } from 'react'
import { useApp } from '../AppContext'

export default function Login() {
  const { login, t } = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usernameRef = useRef()

  // Ensure inputs are focusable on mount - fixes Electron focus loss bug
  useEffect(() => {
    const timer = setTimeout(() => {
      usernameRef.current?.focus()
    }, 200)
    return () => clearTimeout(timer)
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(username, password)
    if (!result.success) setError(result.error || 'Login failed')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Business OS</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Local Business Management Platform</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('username')}</label>
            <input ref={usernameRef} className="input" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('password')}</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm p-3 rounded-lg">{error}</div>}
          <button className="btn-primary w-full py-3 text-base" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : t('login')}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">Default: admin / admin123</p>
      </div>
    </div>
  )
}

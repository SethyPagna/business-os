import { createElement, useEffect, useState, type ComponentType } from 'react'
import { useApp, type AppContextCoreValue } from '../app/AppContextCore.tsx'

export default function LazyImportRecovery({ componentProps, retry }: {
  componentProps: Record<string, unknown>
  retry: () => Promise<ComponentType<Record<string, unknown>> | null>
}) {
  const { t, language } = useApp() as AppContextCoreValue
  const [next, setNext] = useState<ComponentType<Record<string, unknown>> | null>(null)
  const [closed, setClosed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    if (componentProps.open === false) setClosed(false)
  }, [componentProps.open])
  if (closed || componentProps.open === false) return null
  if (error) throw error
  if (next) return createElement(next, componentProps)
  const text = (key: string, en: string, km: string) => {
    const value = t(key)
    return value && value !== key ? value : language === 'km' ? km : en
  }
  const close = () => {
    const callback = typeof componentProps.onClose === 'function' ? componentProps.onClose : componentProps.onCancel
    setClosed(true)
    if (typeof callback === 'function') callback()
  }
  const retryLoad = async () => {
    setLoading(true)
    try {
      const loaded = await retry()
      if (loaded) setNext(() => loaded)
    } catch (retryError) {
      setError(retryError)
    } finally {
      setLoading(false)
    }
  }
  return <div role="alert" data-lazy-recovery aria-busy={loading} className="rounded-lg border bg-white p-4 dark:bg-gray-900">
    <p>{text('lazy_load_retryable', 'This part could not load. Retry or close it; your work stays here.', 'មិនអាចផ្ទុកផ្នែកនេះបានទេ។ សូមព្យាយាមម្ដងទៀត ឬបិទវា។ ការងាររបស់អ្នកនៅតែមាន។')}</p>
    <button type="button" data-lazy-retry disabled={loading} className="btn-primary" onClick={retryLoad}>{text('retry', 'Retry', 'ព្យាយាមម្ដងទៀត')}</button>
    <button type="button" data-lazy-close className="btn-secondary" onClick={close}>{text('close', 'Close', 'បិទ')}</button>
  </div>
}

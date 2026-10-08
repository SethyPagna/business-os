import { createElement, useEffect, useState, type ComponentType } from 'react'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
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
  const retryLabel = text('retry', 'Retry', 'ព្យាយាមម្ដងទៀត')
  const closeLabel = text('close', 'Close', 'បិទ')
  return <div role="alert" data-lazy-recovery aria-busy={loading} className="rounded-lg border bg-white p-4 dark:bg-gray-900">
    <p>{text('lazy_load_retryable', 'This part could not load. Retry or close it; your work stays here.', 'មិនអាចផ្ទុកផ្នែកនេះបានទេ។ សូមព្យាយាមម្ដងទៀត ឬបិទវា។ ការងាររបស់អ្នកនៅតែមាន។')}</p>
    <div className="mt-3 flex items-center gap-2">
      <button type="button" data-lazy-retry disabled={loading} aria-label={retryLabel} title={retryLabel} className="btn-primary inline-flex items-center gap-2" onClick={retryLoad}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{retryLabel}</span>
      </button>
      <button type="button" data-lazy-close aria-label={closeLabel} title={closeLabel} className="btn-secondary inline-flex items-center gap-2" onClick={close}>
        <X className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{closeLabel}</span>
      </button>
    </div>
  </div>
}

import { useEffect, useMemo, useState } from 'react'
import { getReturnReasonPresets } from '../../../api/returnsReadTransport.ts'
import { buildDefaultReturnReasonPresets, resolveReturnReasonPresets, type ReturnReasonPresetResponse } from './returnReasonPresets.ts'

export function useReturnReasonPresets(t?: (key: string) => string | undefined) {
  const fallback = useMemo(() => buildDefaultReturnReasonPresets((key) => t?.(key)), [t])
  const [presets, setPresets] = useState(fallback)

  useEffect(() => {
    let cancelled = false
    void getReturnReasonPresets()
      .then((response) => {
        if (!cancelled) setPresets(resolveReturnReasonPresets(response as ReturnReasonPresetResponse, fallback))
      })
      .catch(() => {
        if (!cancelled) setPresets(fallback)
      })
    return () => { cancelled = true }
  }, [fallback])

  return presets
}

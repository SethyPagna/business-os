// Like scannerHookProbe.ts, but it never renders the <video> the hook waits for: the "video never appears" path
// of startCamera (the request already made is discarded and its stream stopped). Mounted by scannerIosCameraPause.test.ts.
import React from 'react'
import { useBarcodeCamera } from '../src/components/products/scanning/useBarcodeCamera.ts'
import { MESSAGES } from './scannerHookProbe.ts'

interface ProbeProps {
  open: boolean
  onCamera: (camera: ReturnType<typeof useBarcodeCamera>) => void
}

export default function NoVideoProbe({ open, onCamera }: ProbeProps) {
  const camera = useBarcodeCamera({ open, messages: MESSAGES, onDetected: () => {}, onClose: () => {} })
  onCamera(camera)
  return React.createElement('span', null, `${camera.status}|${camera.error}`)
}

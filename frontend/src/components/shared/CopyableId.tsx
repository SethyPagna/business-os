import { useEffect } from 'react'
import { COPY_ATTR, ensureTextAffordances } from './textAffordances.ts'

type CopyableIdProps = {
  value: string
  copyLabel: string
  copiedLabel: string
  className?: string
  valueClassName?: string
  copyValue?: string
  compact?: boolean
}

/** Plain text: tap still belongs to its row; hold or Enter/Space copies. */
export default function CopyableId({
  value, copyLabel, copiedLabel, className = '', valueClassName = '', copyValue,
}: CopyableIdProps) {
  useEffect(() => { ensureTextAffordances({ copy: copyLabel, copied: copiedLabel }) }, [copyLabel, copiedLabel])
  const text = String(value ?? '').trim()
  if (!text) return null
  return (
    <span
      {...{ [COPY_ATTR]: String(copyValue ?? value).trim() || text }}
      data-copyable-id="true"
      data-copy-success={copiedLabel}
      role="button"
      tabIndex={0}
      aria-label={copyLabel}
      className={`inline-block min-w-0 select-text whitespace-normal break-all leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${className} ${valueClassName}`}
    >{text}</span>
  )
}

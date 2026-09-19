import type { ReactNode } from 'react'
import InfoHint from './InfoHint.tsx'

export interface ButtonGuideEntry {
  icon?: ReactNode
  label: string
  description: string
}

type ButtonGuidePopoverProps = {
  title: string
  entries: ButtonGuideEntry[]
  align?: 'left' | 'right' | 'auto'
  triggerLabel?: string
}

/** Help is explanatory content, not an action menu. Keep each supplied entry intact. */
export default function ButtonGuidePopover({ title, entries, align = 'auto', triggerLabel }: ButtonGuidePopoverProps) {
  return (
    <InfoHint
      text=""
      label={triggerLabel || title}
      align={align}
      triggerClassName="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
    >
      <span className="mb-2 block font-semibold text-gray-800 dark:text-gray-100">{title}</span>
      <ul className="m-0 list-disc space-y-2 pl-4">
        {entries.map((entry, index) => (
          <li key={index} className="min-w-0 pl-0.5">
            {entry.icon ? <span aria-hidden="true" className="mr-1 inline-flex align-middle text-gray-400 dark:text-gray-500">{entry.icon}</span> : null}
            <strong className="font-semibold text-gray-800 dark:text-gray-100">{entry.label}</strong>
            {' — '}{entry.description}
          </li>
        ))}
      </ul>
    </InfoHint>
  )
}

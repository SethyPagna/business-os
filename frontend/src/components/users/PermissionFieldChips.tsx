import Check from 'lucide-react/dist/esm/icons/check.js'

export type PermissionFieldChip = {
  key: string
  label: string
  active: boolean
  disabled?: boolean
}

type PermissionFieldChipsProps = {
  heading: string
  fields: PermissionFieldChip[]
  onToggle: (key: string) => void
}

// "Show recorded stock" and "Image-only role: show barcode" read as a chip by their
// last words; the full label stays the accessible name and the tooltip.
export function fieldChipText(label: string): string {
  const afterRole = label.split(/[:៖]\s*/).pop() || label
  const short = afterRole.replace(/^show\s+/i, '').replace(/^បង្ហាញ\s*/, '').trim() || label
  return short.charAt(0).toUpperCase() + short.slice(1)
}

export default function PermissionFieldChips({ heading, fields, onToggle }: PermissionFieldChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white/70 px-2.5 py-1.5 dark:bg-zinc-900/40" role="group" aria-label={heading}>
      <span className="mr-1 text-xs font-semibold leading-6 text-gray-500 dark:text-gray-400">{heading}</span>
      {fields.map((field) => (
        <button
          type="button"
          key={field.key}
          onClick={() => onToggle(field.key)}
          disabled={field.disabled}
          aria-pressed={field.active}
          aria-label={field.label}
          title={field.label}
          className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium leading-6 transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
            field.active
              ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-400 dark:hover:bg-zinc-800'
          } ${field.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {field.active ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          <span aria-hidden="true">{fieldChipText(field.label)}</span>
        </button>
      ))}
    </div>
  )
}

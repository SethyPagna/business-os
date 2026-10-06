import type { ComponentType, ReactNode, SVGProps } from 'react'
import { useId } from 'react'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../../shared/ConflictIcon.ts'
import { formatPhoneInputValue } from '../../../utils/phoneInput.ts'
import type { MemberEvidence } from '../../../api/portalMembersTransport.ts'
import {
  CHIP_TEXT,
  CHIP_TONE,
  EVIDENCE_TEXT,
  memberText,
  type MemberViewer,
  evidenceOptions,
} from './memberModel.ts'

export type MemberT = (key: string) => string | undefined

/** The text for a [key, fallback] pair from memberModel's tables. */
export const textOf = (t: MemberT, pair: readonly [string, string]): string => memberText(t, pair[0], pair[1])

export function IconAction({ label, icon: Icon, onClick, disabled = false, danger = false, id }: {
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  id: string
}) {
  // Icon-only, so the translated tooltip is also the accessible name (owner button policy).
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-member-action={id}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-100'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

export function ChipBadge({ chip, t }: { chip: string; t: MemberT }) {
  const text = CHIP_TEXT[chip] ?? CHIP_TEXT.unverified
  return (
    <span
      data-member-chip={chip}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-relaxed ${CHIP_TONE[chip] ?? CHIP_TONE.unverified}`}
    >
      {textOf(t, text)}
    </span>
  )
}

export function ConflictLine({ text }: { text: string }) {
  return (
    <p data-member-conflict="" className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
      <ConflictIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${CONFLICT_ICON_CLASS}`} />
      <span className="min-w-0">{text}</span>
    </p>
  )
}

export const phoneLabel = (phone: string | null | undefined): string => (phone ? formatPhoneInputValue(phone) : '')

/** The note field and the hint the owner asked for under every staff note. */
export function NoteField({ value, onChange, t, placeholder, required = false, hintId }: {
  value: string
  onChange: (value: string) => void
  t: MemberT
  placeholder: string
  required?: boolean
  hintId?: string
}) {
  const generated = useId()
  const describedBy = hintId || generated
  return (
    <div className="space-y-1">
      <input
        type="text"
        value={value}
        maxLength={500}
        required={required}
        data-member-note=""
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby={describedBy}
        className="input w-full"
      />
      <p id={describedBy} data-member-note-hint="" className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        {memberText(t, 'pm_note_hint', "Don't write customer details in notes.")}
      </p>
    </div>
  )
}

/**
 * How the member proved who they are. The same picker for Link, a Revert that
 * reconnects a customer and a password reset. Every option is on screen from the
 * first paint; the six-digit field sits on the same row as its option.
 */
export function EvidenceFields({ viewer, evidence, onEvidence, code, onCode, t, withCode = true }: {
  viewer: MemberViewer
  evidence: MemberEvidence | null
  onEvidence: (value: MemberEvidence) => void
  code: string
  onCode: (value: string) => void
  t: MemberT
  /** A reset has no code to check: the member cannot sign in to read one. */
  withCode?: boolean
}) {
  const group = useId()
  const options = evidenceOptions(viewer)
  return (
    <fieldset className="space-y-1.5" data-member-evidence="">
      <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">{memberText(t, 'pm_evidence', 'Identity check')}</legend>
      {options.map((option) => {
        const checked = evidence === option
        return (
          <div key={option} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <label className={`flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-sm leading-relaxed ${checked ? 'border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-900/20' : 'border-gray-200 dark:border-zinc-700'}`}>
              <input
                type="radio"
                name={group}
                value={option}
                checked={checked}
                onChange={() => onEvidence(option)}
                data-member-evidence-option={option}
                className="mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 dark:text-gray-100">{textOf(t, EVIDENCE_TEXT[option].label)}</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">{textOf(t, EVIDENCE_TEXT[option].hint)}</span>
              </span>
            </label>
            {withCode && option === 'called_number_on_file' ? (
              <input
                disabled={!checked}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                data-member-check-code=""
                onChange={(event) => onCode(event.target.value.replace(/[^\d\s]/g, ''))}
                placeholder={memberText(t, 'pm_code_ph', '6-digit code')}
                aria-label={memberText(t, 'pm_code_ph', '6-digit code')}
                className="input w-32 shrink-0 text-center tracking-widest disabled:opacity-50"
              />
            ) : null}
          </div>
        )
      })}
    </fieldset>
  )
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 py-1 text-sm leading-relaxed">
      <dt className="w-24 shrink-0 text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  )
}

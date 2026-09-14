import { type ReactNode } from 'react'
import Modal from '../shared/Modal'
import CopyableId from '../shared/CopyableId.tsx'

type TranslateFn = (key: string) => string | undefined

export type InvoiceFact = { key: string; label: string; value: ReactNode }

export type InvoiceDetailSection = {
  key: string
  title: string
  /** Label/value pairs; rendered as a description list so labels stay readable. */
  facts?: InvoiceFact[]
  /** Anything a fact grid cannot express -- a line-item table, a pager. */
  content?: ReactNode
  /** Why a section is thin, stated instead of left as an empty box. */
  note?: string
}

type InvoiceDetailFloatProps = {
  title: string
  /** The invoice's own identifier, shown in full and copyable. */
  idLabel?: string
  idValue?: string
  /** Paid / Not Yet Paid / Outstanding chip, beside the id. */
  badge?: ReactNode
  sections: InvoiceDetailSection[]
  onClose: () => void
  t: TranslateFn
  wide?: boolean
  layer?: 'default' | 'nested'
}

// P3-2: one float for every invoice row in Contacts (user: "i meant float when
// clicked on the invoice rows click to view details and sections etc..."). The
// three ledgers and the supplier purchases report each hand it their own facts
// and their own line-item table; the shell owns the header, the copyable id and
// the section frames so the four surfaces read identically.
//
// The float renders its real content from the first paint -- every section is
// present as soon as it opens, never a stub that fills in later. A section that
// genuinely has nothing to show says so in `note` rather than disappearing.
//
// One close affordance only: the shared Modal's header X. No footer Close.
export default function InvoiceDetailFloat({
  title, idLabel, idValue, badge, sections, onClose, t, wide = false, layer,
}: InvoiceDetailFloatProps) {
  const tr = (key: string, fallback: string): string => t(key) || fallback
  return (
    <Modal title={title} onClose={onClose} wide={wide} layer={layer} unsavedChanges="read-only">
      <div className="space-y-3">
        {idValue || badge ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {idLabel ? <span className="text-[11px] leading-5 text-gray-400">{idLabel}</span> : null}
            {idValue ? (
              <CopyableId
                value={idValue}
                copyLabel={tr('copy', 'Copy')}
                copiedLabel={tr('copied', 'Copied')}
                valueClassName="text-sm font-semibold leading-6 text-gray-900 dark:text-white"
              />
            ) : null}
            {badge}
          </div>
        ) : null}
        {sections.map((section) => (
          <section key={section.key} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <h3 className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium uppercase leading-5 tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
              {section.title}
            </h3>
            {section.facts && section.facts.length > 0 ? (
              // leading-5 / leading-6 rather than the tighter defaults: Khmer
              // labels carry sub- and superscript marks that a Latin-sized line
              // box clips.
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-3 lg:grid-cols-4">
                {section.facts.map((fact) => (
                  <div key={fact.key} className="min-w-0">
                    <dt className="truncate text-[11px] leading-5 text-gray-400">{fact.label}</dt>
                    <dd className="break-words text-sm leading-6 text-gray-900 dark:text-white">{fact.value ?? '--'}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {section.content}
            {section.note ? (
              <p className="px-3 pb-2 pt-1 text-[11px] leading-5 text-gray-400">{section.note}</p>
            ) : null}
          </section>
        ))}
      </div>
    </Modal>
  )
}

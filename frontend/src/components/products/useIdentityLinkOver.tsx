import { useCallback, useState } from 'react'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import type { IdentityMatch } from './helpers/identityLinkOver.ts'

// N34 / lane "linkover" -- THE prompt for "this edit matches another product".
//
// One flow, shared by every surface that can move a row's identity, exactly as
// useMergeStockChoice is the one flow for "what happens to the other row's
// stock?". The two surfaces that can write a product's name or barcode -- the
// product form's save path and the in-place Resolve editor in Products →
// Conflicts -- ask through this hook, so the operator is asked the same
// question with the same three answers wherever the edit is typed.
//
// The answers, in the owner's own terms ("prompt user if they should link over,
// and keep it changeable in conflict"):
//
//   link_over     -- fold this row's records onto the matched product. The
//                    caller runs the EXISTING carry-all merge kernel
//                    (useMergeStockChoice → POST /possible-duplicates/merge),
//                    one Worker transaction that moves sale items, returns,
//                    movements, batches, branch stock and promotion scopes.
//                    Nothing about the fold is re-implemented here.
//   keep_separate -- write the edit anyway. The pair becomes an ordinary
//                    Conflicts row the operator can merge later, either way.
//   back          -- return to the form with everything intact.
//
// `back` is deliberately the answer for the ✕ and for Cancel: a prompt this
// consequential must not have a destructive default, and a dismissed dialog has
// told us nothing. It is also why keep-separate is a distinct button rather
// than the cancel slot -- "I closed the dialog" and "I decided these are two
// different articles" are not the same statement.

type TranslateFn = (key: string, fallback?: string) => string | undefined

export type IdentityLinkOverChoice = 'link_over' | 'keep_separate' | 'back'

type PendingAsk = {
  subjectName: string
  matches: IdentityMatch[]
  canLinkOver: boolean
  canKeepSeparate: boolean
  resolve: (choice: IdentityLinkOverChoice) => void
}

export type IdentityLinkOverRequest = Omit<PendingAsk, 'resolve'>

function labelOf(match: IdentityMatch): string {
  const name = String(match.name || '').trim()
  return name || `#${match.id}`
}

export function useIdentityLinkOver(t: TranslateFn) {
  const [pending, setPending] = useState<PendingAsk | null>(null)

  const askIdentityLinkOver = useCallback(
    (request: IdentityLinkOverRequest) => new Promise<IdentityLinkOverChoice>((resolve) => {
      setPending({ ...request, resolve })
    }),
    [],
  )

  const answer = (choice: IdentityLinkOverChoice) => {
    const resolve = pending?.resolve
    setPending(null)
    resolve?.(choice)
  }

  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const identityLinkOverDialog = pending ? (
    <ConfirmDialog
      t={t}
      layer="nested"
      title={T('identity_link_over_title', 'This matches another product')}
      message={pending.matches.length === 1
        ? T('identity_link_over_message', 'This matches "{name}". Link this product’s records over to it?')
          .replace('{name}', labelOf(pending.matches[0]))
        : T('identity_link_over_message_many', 'This matches {count} existing products. Link this product’s records over to the first?')
          .replace('{count}', String(pending.matches.length))}
      items={pending.matches.map((match) => ({
        label: `#${match.id}`,
        value: `${labelOf(match)}${match.barcode ? ` · ${match.barcode}` : ''}`,
      }))}
      note={pending.canLinkOver
        ? T(
          'identity_link_over_note',
          'Linking over moves every record — sales, returns, stock movements, batches, branch stock and discount scopes — onto the matched product. Keeping them separate writes your change and lists the pair in Conflicts, where you can still merge them either way.',
        )
        : T(
          'identity_keep_separate_only_note',
          'There is no saved row yet to link over. Open the existing product instead, or keep them separate — the pair is then listed in Conflicts, where you can still merge them either way.',
        )}
      confirmLabel={T('identity_link_over_action', 'Link records over')}
      confirmDisabled={!pending.canLinkOver}
      cancelLabel={T('back', 'Back')}
      onConfirm={() => answer('link_over')}
      onClose={() => answer('back')}
    >
      {pending.canKeepSeparate ? (
        <button
          type="button"
          onClick={() => answer('keep_separate')}
          className="w-full rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-950/30"
        >
          {T('identity_keep_separate_action', 'Keep them separate')}
        </button>
      ) : null}
    </ConfirmDialog>
  ) : null

  return { askIdentityLinkOver, identityLinkOverDialog }
}

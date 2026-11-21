import { useEffect, useRef, useState } from 'react'
import { clearAllFocusLeft, clearAllPressIsOutside, clearAllStep } from './portalClearConfirm.ts'
import type { ClearAllEvent } from './portalClearConfirm.ts'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Minus from 'lucide-react/dist/esm/icons/minus.js'
import PlusIcon from 'lucide-react/dist/esm/icons/plus.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import CatalogProductImage from './catalogImages'
import { PortalContactRows } from './PortalSocialRow.tsx'
import PortalNoPaymentNotice from './PortalNoPaymentNotice.tsx'
import type { PortalContactEntry } from './portalSocialLinks.ts'

type CopyFn = (key: string, fallback?: string, fallbackKm?: string) => string
export type PortalListSegment = 'list' | 'saved'

type Row = { id: string | number; name: string; shopLine?: string; priceText?: string; qty?: number }

const ICON_BUTTON = 'inline-flex h-11 w-11 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-[#23201b] transition hover:bg-stone-200 dark:text-neutral-200 dark:hover:bg-neutral-800'
const DANGER_BUTTON = 'inline-flex h-11 w-11 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-rose-700 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950'
const SURFACE = 'overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900'

const CLEAR_BUTTON = 'inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold transition sm:min-h-10'

/** "Clear all" as a words button that turns, in place, into a two-button question. Only Clear empties the list. */
function ClearAllControl({ copy, count, label, onClear }: { copy: CopyFn; count: number; label: string; onClear: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const keepRef = useRef<HTMLButtonElement | null>(null)
  const step = (event: ClearAllEvent) => {
    const next = clearAllStep(confirming, event)
    setConfirming(next.confirming)
    if (next.clear) onClear()
  }
  useEffect(() => {
    if (!confirming) return undefined
    keepRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirming(false) }
    // A press anywhere else puts the question away. This, not blur, covers the mouse and touch: Safari does not focus a button that is
    // pressed, so a blur there arrives with no target while the visitor is pressing Clear itself.
    const onPointerDown = (event: PointerEvent) => { if (clearAllPressIsOutside(rootRef.current, event.target)) setConfirming(false) }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [confirming])
  const question = count > 1
    ? replaceCount(copy('clearAllConfirm', 'Clear all {count} items?', 'សម្អាត {count} មុខទាំងអស់ឬ?'), count)
    : copy('clearOneConfirm', 'Clear this item?', 'សម្អាតមុខនេះឬ?')
  if (!confirming) {
    return (
      <button type="button" data-portal-clear-all="rest" className={`${CLEAR_BUTTON} text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950`} onClick={() => step('ask')}>{label}</button>
    )
  }
  return (
    <span
      ref={rootRef}
      role="group"
      aria-label={question}
      data-portal-clear-all="confirm"
      className="inline-flex flex-wrap items-center gap-2"
      onBlur={(event) => { if (clearAllFocusLeft(rootRef.current, event.relatedTarget)) step('leave') }}
    >
      <span className="text-sm font-medium text-[#23201b] dark:text-neutral-100">{question}</span>
      <button type="button" className={`${CLEAR_BUTTON} bg-rose-700 text-white hover:bg-rose-800 dark:bg-rose-600 dark:hover:bg-rose-500`} onClick={() => step('confirm')}>{copy('clearAllYes', 'Yes, clear', 'សម្អាត')}</button>
      <button ref={keepRef} type="button" className={`${CLEAR_BUTTON} border border-stone-300 text-[#23201b] hover:bg-stone-200 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800`} onClick={() => step('keep')}>{copy('clearAllKeep', 'Keep', 'រក្សា')}</button>
    </span>
  )
}

function replaceCount(template: string, count: number): string {
  return template.split('{count}').join(String(count))
}

/**
 * Saved and List as one full page inside the storefront (spec section 4): one view, two segments. List rows are image, name, quantity stepper,
 * remove; Saved rows are image, name, add-to-list, remove. One payment line, once. Back is the browser's own Back (the page pushes a history
 * entry when it opens), so the back button here only asks the page to go back.
 */
export default function PortalListPage({
  copy, segment, onSegment, onBack, listItems, savedItems, imageFor, inList, onSetQty, onRemoveFromList, onClearList,
  onAddSaved, onRemoveSaved, onClearSaved, contactEntries, onCopy, onDownload, copyState,
}: {
  copy: CopyFn
  segment: PortalListSegment
  onSegment: (next: PortalListSegment) => void
  onBack: () => void
  listItems: readonly Row[]
  savedItems: readonly Row[]
  imageFor: (id: string | number) => string
  inList: (id: string | number) => boolean
  onSetQty: (id: string | number, qty: number) => void
  onRemoveFromList: (id: string | number) => void
  onClearList: () => void
  onAddSaved: (id: string | number) => void
  onRemoveSaved: (id: string | number) => void
  onClearSaved: () => void
  contactEntries: readonly PortalContactEntry[]
  onCopy: () => void
  onDownload: () => void
  copyState: 'idle' | 'copied' | 'failed'
}) {
  const pageRef = useRef<HTMLElement | null>(null)
  // Focus lands on the page when it opens, so a keyboard or screen-reader visitor starts at its top, not behind it.
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }) }, [])
  const listLabel = copy('portalSegmentList', 'List', 'បញ្ជី')
  const savedLabel = copy('saved', 'Saved')
  const segments: Array<[PortalListSegment, string, number]> = [['list', listLabel, listItems.length], ['saved', savedLabel, savedItems.length]]

  const thumb = (row: Row) => (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-stone-100 text-stone-500 dark:bg-neutral-800 dark:text-neutral-400">
      {imageFor(row.id)
        ? <CatalogProductImage thumbnail sizes="56px" src={imageFor(row.id)} alt="" className="h-full w-full object-cover" />
        : <ShoppingBag aria-hidden="true" className="h-6 w-6" />}
    </div>
  )
  const nameBlock = (row: Row) => (
    <div className="min-w-0 flex-1">
      {/* A product name is never cut on this project: it scrolls. getKhmerTextProps because a name can be Khmer whatever the page language is. */}
      <div translate="no" {...getKhmerTextProps(row.name, 'detail-scroll-text notranslate text-sm font-medium text-[#23201b] dark:text-neutral-100')}>{row.name}</div>
      {row.shopLine ? <div translate="no" {...getKhmerTextProps(row.shopLine, 'detail-scroll-text notranslate text-xs text-stone-600 dark:text-neutral-300')}>{row.shopLine}</div> : null}
      {row.priceText ? <div translate="no" className="notranslate text-xs text-stone-600 dark:text-neutral-300">{row.priceText}</div> : null}
    </div>
  )
  const emptyLine = (text: string) => <p className="py-10 text-center text-sm text-stone-600 dark:text-neutral-300">{text}</p>

  return (
    <section ref={pageRef} tabIndex={-1} data-portal-list-page="true" aria-label={`${listLabel} / ${savedLabel}`} className="mx-auto w-full max-w-[720px] space-y-4 py-4 outline-none sm:py-6">
      <div className="flex items-center gap-2">
        <button type="button" className={ICON_BUTTON} onClick={onBack} aria-label={copy('back', 'Go back', 'ត្រឡប់')} title={copy('back', 'Go back', 'ត្រឡប់')} data-portal-list-back="">
          {/* arrow-right turned round: arrow-left is pinned to the sign-in icon chunk, which the storefront must not load (chunk cycle). */}
          <ArrowRight className="h-5 w-5 rotate-180" />
        </button>
        <div role="group" className="grid min-w-0 flex-1 grid-cols-2 rounded-xl bg-stone-200 p-1 text-sm dark:bg-neutral-800">
          {segments.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={segment === key}
              data-portal-list-segment={key}
              onClick={() => onSegment(key)}
              className={`min-h-11 rounded-lg px-4 sm:min-h-9 text-center font-semibold transition ${segment === key ? 'bg-white text-[#23201b] shadow-sm dark:bg-neutral-700 dark:text-white' : 'text-stone-600 dark:text-neutral-300'}`}
            >
              <span>{label}</span>{count > 0 ? <span translate="no" className="notranslate ml-1.5 text-xs font-medium text-stone-600 dark:text-neutral-300">{count}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {segment === 'list' ? (
        <>
          <PortalNoPaymentNotice copy={copy} className="text-center" />
          {/* Where the Contact button was: the chat rows themselves (Phone, Messenger, Telegram, WhatsApp), tappable, under the payment line. */}
          {listItems.length > 0 && contactEntries.length > 0 ? (
            <div data-portal-list-contact="">
              <PortalContactRows inline entries={contactEntries} copy={copy} className="grid gap-2 sm:grid-cols-2" />
            </div>
          ) : null}
          {listItems.length === 0 ? emptyLine(copy('listEmptyLine', 'Your list is empty.', 'បញ្ជីរបស់អ្នកនៅទទេ។')) : (
            <ul className={`${SURFACE} divide-y divide-stone-200 dark:divide-neutral-700`}>
              {listItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 p-3">
                  {thumb(item)}
                  {nameBlock(item)}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" className={ICON_BUTTON} onClick={() => onSetQty(item.id, (item.qty || 1) - 1)} aria-label={copy('decreaseQty', 'Decrease quantity')} title={copy('decreaseQty', 'Decrease quantity')}>
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-[#23201b] dark:text-neutral-100" aria-live="polite">{item.qty || 1}</span>
                    <button type="button" className={ICON_BUTTON} onClick={() => onSetQty(item.id, (item.qty || 1) + 1)} aria-label={copy('increaseQty', 'Increase quantity')} title={copy('increaseQty', 'Increase quantity')}>
                      <PlusIcon className="h-4 w-4" />
                    </button>
                    <button type="button" className={`${DANGER_BUTTON} ml-2`} onClick={() => onRemoveFromList(item.id)} aria-label={copy('removeFromBucket', 'Remove')} title={copy('removeFromBucket', 'Remove')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {listItems.length > 0 ? (
            <div className="flex items-center gap-1">
              <button type="button" className={ICON_BUTTON} onClick={onCopy} aria-label={copy('copyList', 'Copy the list')} title={copy('copyList', 'Copy the list')}>
                {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
              <button type="button" className={ICON_BUTTON} onClick={onDownload} aria-label={copy('downloadList', 'Download')} title={copy('downloadList', 'Download')}>
                <Download className="h-4 w-4" />
              </button>
              <ClearAllControl key="list" copy={copy} count={listItems.length} label={copy('clearBucket', 'Clear all', 'សម្អាតទាំងអស់')} onClear={onClearList} />
              {copyState !== 'idle' ? (
                <span role="status" className={`ml-1 text-xs ${copyState === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-stone-600 dark:text-neutral-300'}`}>
                  {copyState === 'copied' ? copy('bucketCopied', 'Copied!') : copy('bucketCopyFailed', 'Could not copy automatically -- try Download instead.')}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {savedItems.length === 0 ? emptyLine(copy('savedEmptyLine', 'Nothing saved yet.', 'មិនទាន់មានអ្វីរក្សាទុកទេ។')) : (
            <ul className={`${SURFACE} divide-y divide-stone-200 dark:divide-neutral-700`}>
              {savedItems.map((item) => {
                const added = inList(item.id)
                return (
                  <li key={item.id} className="flex items-center gap-3 p-3">
                    {thumb(item)}
                    {nameBlock(item)}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        className={ICON_BUTTON}
                        onClick={() => onAddSaved(item.id)}
                        aria-label={added ? copy('inList', 'In list', 'ក្នុងបញ្ជី') : copy('addToList', 'Add', 'បន្ថែម')}
                        title={added ? copy('inList', 'In list', 'ក្នុងបញ្ជី') : copy('addToList', 'Add', 'បន្ថែម')}
                      >
                        {added ? <Check className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                      </button>
                      <button type="button" className={DANGER_BUTTON} onClick={() => onRemoveSaved(item.id)} aria-label={copy('removeSavedItem', 'Remove', 'លុបចេញ')} title={copy('removeSavedItem', 'Remove', 'លុបចេញ')}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {savedItems.length > 0 ? (
            <ClearAllControl key="saved" copy={copy} count={savedItems.length} label={copy('clearWishlist', 'Clear all', 'សម្អាតទាំងអស់')} onClear={onClearSaved} />
          ) : null}
        </>
      )}
    </section>
  )
}

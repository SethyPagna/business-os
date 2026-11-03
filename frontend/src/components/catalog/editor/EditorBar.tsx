import Check from 'lucide-react/dist/esm/icons/check.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import EditorSectionNav from './EditorSectionNav.tsx'
import type { EditorSectionDef, EditorSectionId } from './editorSections.ts'
import type { EditorText } from './editorText.ts'
import type { SaveBarState, SaveBlockedReason } from './saveReview.ts'

// The Website Editor's bar (EDITOR-REDESIGN-REFRESH, ED-1a): the section picker (below 768 px) or the chips (from 768 px),
// Save, and the status. One row on every width, 56 px on a phone and 52 px from md up. Sticky and opaque with no backdrop
// blur: a blur over a near-opaque fill costs a GPU pass per scroll frame for no visible difference.
//
// The bar sits inside the editor's aside, which clips sideways (overflow-x: clip, so the bar can stick): a negative margin to run it full-bleed
// would only be cut off at the aside's edge, taking the first letter of the status line and the Save dot with it. It is a rounded card at every width.
//
// Save is the one text button (icon + word). When there is nothing to save, a Save is in flight, or something blocks it,
// it is aria-disabled rather than disabled: it stays focusable, so a keyboard user reaches it and hears the reason, and the
// press is simply ignored. The reason is a visible live line -- never a tooltip -- inside the row from md up, one line
// below the row on a phone.
type EditorBarProps = {
  ed: EditorText
  compact: boolean
  sections: readonly EditorSectionDef[]
  activeSection: EditorSectionId
  dirtySections: ReadonlySet<EditorSectionId>
  sellerMissing: boolean
  state: SaveBarState
  blockedReason: SaveBlockedReason | null
  onSelectSection: (id: EditorSectionId) => void
  onSave: () => void
}

const STATUS_ID = 'portal-editor-status'

function statusText(ed: EditorText, state: SaveBarState, blockedReason: SaveBlockedReason | null): string {
  if (state === 'saving') return ed('web_editor_saving', 'Saving', 'កំពុងរក្សាទុក')
  if (state === 'saved') return ed('web_editor_saved', 'Saved', 'បានរក្សាទុក')
  if (state === 'changed') return ed('web_editor_unsaved', 'Unsaved changes', 'មិនទាន់រក្សាទុក')
  if (state === 'blocked') {
    return blockedReason === 'uploads'
      ? ed('web_editor_blocked_uploads', 'Wait for uploads to finish', 'រង់ចាំការផ្ទុកឡើងបញ្ចប់')
      : ed('web_editor_blocked_loading', 'Loading settings', 'កំពុងផ្ទុកការកំណត់')
  }
  return ''
}

export default function EditorBar({ ed, compact, sections, activeSection, dirtySections, sellerMissing, state, blockedReason, onSelectSection, onSave }: EditorBarProps) {
  const text = statusText(ed, state, blockedReason)
  const pressable = state === 'changed'
  const tone = state === 'blocked' ? 'text-amber-700 dark:text-amber-300' : state === 'saved' ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'
  return (
    <div
      id="portal-editor-bar"
      className="sticky top-0 z-30 rounded-2xl border border-slate-200 bg-white px-3 shadow-md dark:border-slate-700 dark:bg-slate-950 sm:top-2"
    >
      <div data-testid="editor-bar-row" className="flex h-14 min-w-0 items-center gap-2 md:h-[52px]">
        <EditorSectionNav
          ed={ed}
          compact={compact}
          sections={sections}
          active={activeSection}
          dirty={dirtySections}
          sellerMissing={sellerMissing}
          onSelect={onSelectSection}
        />
        {compact ? null : <p id={STATUS_ID} role="status" aria-live="polite" className={`min-w-0 shrink text-sm leading-6 ${tone}`}>{text}</p>}
        <button
          type="button"
          aria-disabled={pressable ? undefined : true}
          aria-busy={state === 'saving' ? true : undefined}
          aria-describedby={state === 'blocked' ? STATUS_ID : undefined}
          className={`btn-primary inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap !px-3 !py-1 leading-snug md:h-10 ${pressable ? '' : 'cursor-not-allowed opacity-60'}`}
          onClick={() => {
            if (pressable) onSave()
          }}
        >
          {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : state === 'saved' ? <Check className="h-4 w-4" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          <span>{state === 'saving' ? ed('web_editor_saving', 'Saving', 'កំពុងរក្សាទុក') : state === 'saved' ? ed('web_editor_saved', 'Saved', 'បានរក្សាទុក') : ed('web_editor_save', 'Save', 'រក្សាទុក')}</span>
          {state === 'changed' ? <span aria-hidden className="h-2 w-2 rounded-full bg-white ring-2 ring-white/40" /> : null}
        </button>
      </div>
      {compact ? (
        <div className={text ? 'pb-1.5' : ''}>
          <p id={STATUS_ID} role="status" aria-live="polite" className={`text-xs leading-5 ${tone}`}>{text}</p>
        </div>
      ) : null}
    </div>
  )
}

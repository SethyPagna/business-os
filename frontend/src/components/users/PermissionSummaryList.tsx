import Check from 'lucide-react/dist/esm/icons/check.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { actionsForKey } from '../../utils/permissionActions.ts'
import { normalizePermissionState } from '../../utils/permissions.ts'
import type { PermissionSensitivity } from './permissionDefinitions.ts'
import { MODULE_ROWS, chipStates, moduleCanDo, moduleIsOn, moduleState, type ModuleRow, type PermissionState } from './permissionSummary.ts'
import { levelWord } from './rolePermissionLabel.ts'

type Translate = (key: string, fallback: string) => string

// A read-only reading of a permission map, one line per module: `Products  Full  ✓ View · Edit · Images  ✕ 13`.
// It reads the map through the same model as the access grid (permissionSummary.ts), so a role reads the same here as
// it does in the editor. Two modes:
//   role        what the role holds; ✕ counts the actions it switches off while the level still grants them
//   exceptions  a user's own overrides on top of their role: only modules the map mentions, and each denial is named
//               (there are few of them, and the name is the whole message)
export type SummaryMode = 'role' | 'exceptions'

export type ModuleSummaryLine = {
  id: string
  name: string
  /** None for a module the map names without a level of its own (an extra or a single action). */
  level: string | null
  /** Short words for what the map lets this module do. */
  can: string[]
  /** Short words for the actions it switches off. */
  off: string[]
  sensitivity: PermissionSensitivity
}

const rowName = (row: ModuleRow, tr: Translate): string => (row.sub && row.lead ? tr(row.lead.tKey, row.lead.label) : tr(row.section.tKey, row.section.label))

/** Whether a user's own map says anything about this module. */
function mentions(row: ModuleRow, perms: PermissionState): boolean {
  const own = [row.lead, ...row.group, ...row.extras, ...row.fields, row.imageOnly?.toggle, ...(row.imageOnly?.fields ?? [])]
  if (own.some((def) => def && Object.hasOwn(perms, def.key))) return true
  return !!row.actionKey && Object.keys(perms).some((key) => key.startsWith(`${row.actionKey}:`))
}

/** Whether the map sets the module's level itself, rather than only an extra or one action in it. */
const holdsOwnLevel = (row: ModuleRow, perms: PermissionState): boolean => (
  row.lead ? Object.hasOwn(perms, row.lead.key) : row.group.some((def) => Object.hasOwn(perms, def.key))
)

function levelText(row: ModuleRow, perms: PermissionState, tr: Translate): string | null {
  const state = moduleState(row, perms)
  if (state.partial) return tr('perm_n_of_total', '{n} of {total}').replace('{n}', String(state.partial.on)).replace('{total}', String(state.partial.total))
  if (state.follows) return tr('perm_follows_inventory', 'Follows Inventory')
  if (row.group.length) return state.level === 'full' ? levelWord('full', tr) : null
  return levelWord(state.level, tr)
}

function offWords(row: ModuleRow, perms: PermissionState, mode: SummaryMode, tr: Translate): string[] {
  if (mode === 'role') {
    return chipStates(row, perms).filter((chip) => chip.mark === 'off').map((chip) => tr(chip.action.shortTKey, chip.action.short))
  }
  const actions = row.actionKey ? actionsForKey(row.actionKey).filter((action) => perms[`${row.actionKey}:${action.key}`] === false).map((action) => tr(action.shortTKey, action.short)) : []
  const extras = row.extras.filter((def) => perms[def.key] === false).map((def) => tr(def.shortTKey ?? def.tKey, def.short ?? def.label))
  return [...actions, ...extras]
}

export function permissionSummaryLines(raw: unknown, mode: SummaryMode, tr: Translate): { admin: boolean; lines: ModuleSummaryLine[] } {
  const perms = normalizePermissionState(raw)
  if (perms.all === true) return { admin: true, lines: [] }
  const lines = MODULE_ROWS.filter((row) => (mode === 'role' ? moduleIsOn(row, perms) : mentions(row, perms))).map((row): ModuleSummaryLine => ({
    id: row.id,
    name: rowName(row, tr),
    level: mode === 'exceptions' && !holdsOwnLevel(row, perms) ? null : levelText(row, perms, tr),
    can: moduleCanDo(row, perms, tr),
    off: offWords(row, perms, mode, tr),
    sensitivity: moduleState(row, perms).sensitivity,
  })).filter((line) => mode === 'role' || line.level !== null || line.can.length > 0 || line.off.length > 0)
  return { admin: false, lines }
}

const VISIBLE_WORDS = 3

function SummaryLine({ line, mode, tr }: { line: ModuleSummaryLine; mode: SummaryMode; tr: Translate }) {
  const shown = line.can.slice(0, VISIBLE_WORDS)
  const more = line.can.length - shown.length
  const sensitive = line.sensitivity === 'normal' ? '' : tr(line.sensitivity === 'critical' ? 'permission_sensitive_critical' : 'permission_sensitive_high', 'Sensitive')
  const offLabel = `${tr('perm_n_off', '{n} off').replace('{n}', String(line.off.length))}: ${line.off.join(', ')}`
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-5 text-gray-600 dark:text-gray-300">
      <span className="inline-flex items-baseline gap-1 text-[13px] font-semibold text-gray-800 dark:text-gray-100">
        {line.name}
        {sensitive ? (
          <span role="img" aria-label={sensitive} title={sensitive} className={`inline-flex self-center ${line.sensitivity === 'critical' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </span>
      {line.level ? <span className="text-gray-500 dark:text-gray-400">{line.level}</span> : null}
      {shown.length ? (
        <span className="inline-flex items-baseline gap-1">
          <Check className="h-3 w-3 flex-shrink-0 self-center" aria-hidden="true" />
          {shown.join(' · ')}{more > 0 ? ` +${more}` : ''}
        </span>
      ) : null}
      {line.off.length ? (
        // A role's denials can be many, so the line shows the count and the names ride the tooltip; a user's few
        // exceptions are named outright.
        <span role="img" aria-label={offLabel} title={offLabel} className="inline-flex items-baseline gap-1 text-gray-500 dark:text-gray-400">
          <X className="h-3 w-3 flex-shrink-0 self-center" aria-hidden="true" />
          {mode === 'exceptions' ? line.off.join(', ') : line.off.length}
        </span>
      ) : null}
    </li>
  )
}

/** The map as a list of module lines, one Administrator chip, or None. */
export default function PermissionSummaryList({ permissions, mode, tr }: { permissions: unknown; mode: SummaryMode; tr: Translate }) {
  const { admin, lines } = permissionSummaryLines(permissions, mode, tr)
  if (admin) {
    return (
      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs leading-5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
        {tr('full_access', 'Full access')}
      </span>
    )
  }
  if (!lines.length) return <span className="text-xs italic text-gray-400">{tr('none', 'None')}</span>
  return (
    <ul className="space-y-1">
      {lines.map((line) => <SummaryLine key={line.id} line={line} mode={mode} tr={tr} />)}
    </ul>
  )
}

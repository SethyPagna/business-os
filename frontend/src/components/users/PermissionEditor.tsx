import { Fragment, useState } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import Eraser from 'lucide-react/dist/esm/icons/eraser.js'
import Hourglass from 'lucide-react/dist/esm/icons/hourglass.js'
import Link2 from 'lucide-react/dist/esm/icons/link.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import InfoHint from '../shared/InfoHint.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import PermissionFieldChips from './PermissionFieldChips.tsx'
import { type PermissionDefinition, type PermissionSensitivity } from './permissionDefinitions'
import {
  MODULE_ROWS, applyModuleLevel, chipStates, levelsOf, moduleCanDo, moduleChanged, moduleIsOn, moduleState, searchRow, toggleGrant,
  type ChipMark, type ChipState, type ControlState, type Level, type ModuleRow, type ModuleState, type PermissionState,
} from './permissionSummary.ts'
import { effectivePermissions, normalizePermissionState } from '../../utils/permissions.ts'
import { isActionOverriddenOff, toggleActionOverrideMap, type ActionRequirement } from '../../utils/permissionActions.ts'

type Filter = 'all' | 'on' | 'changed'

// Tap targets grow to 44px on touch screens only, so the desktop editor stays compact.
const TOUCH_TARGET = '[@media(pointer:coarse)]:min-h-[44px]'
const TOUCH_SQUARE = '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'
const HINT_TRIGGER = `inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200 ${TOUCH_SQUARE}`
// One column for the module and one per level; the same template drives the header and every row. It sets
// `display: grid` through an arbitrary property rather than the `grid` class on purpose: main.css gives every `.grid`
// a 0.75rem !important gap on phones, which would take 48px of a 360px row away from the module name.
const GRID = '[display:grid] grid-cols-[minmax(0,1fr)_repeat(4,3rem)] items-center sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)]'
const COLUMNS: Level[] = ['none', 'view', 'review', 'full']

const LEVEL_DOT: Record<Level, string> = { none: 'bg-gray-400', view: 'bg-teal-600', review: 'bg-amber-500', full: 'bg-blue-600' }
const LEVEL_FILLED: Record<Level, string> = {
  none: 'border-gray-400 bg-gray-400', view: 'border-teal-600 bg-teal-600', review: 'border-amber-500 bg-amber-500', full: 'border-blue-600 bg-blue-600',
}
const LEVEL_HOVER: Record<Level, string> = {
  none: 'hover:border-gray-400', view: 'hover:border-teal-600', review: 'hover:border-amber-500', full: 'hover:border-blue-600',
}
const MARK_ICON: Record<ChipMark, typeof Check> = { allow: Check, queue: Hourglass, limited: Pencil, fullOnly: Lock, off: X, needs: AlertTriangle }
const MARK_CLASS: Record<ChipMark, string> = {
  allow: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  queue: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  limited: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  fullOnly: 'border-gray-200 bg-gray-100 text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-400',
  off: 'border-gray-200 bg-white text-gray-400 line-through dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-500',
  needs: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
}
const CHIP_BASE = `inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium leading-6 transition-colors ${TOUCH_TARGET}`
const CHIP_RING = 'ring-2 ring-primary-400 ring-offset-1 dark:ring-offset-zinc-800'
// Past this width the grid has room for several open modules; below it only one stays open.
const isPhoneScreen = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches

function SensitiveMark({ sensitivity, label }: { sensitivity: PermissionSensitivity; label: string }) {
  if (sensitivity === 'normal') return null
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex flex-shrink-0 ${sensitivity === 'critical' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

interface PermissionEditorProps {
  permissions?: string | Record<string, unknown> | null
  // The saved role, when editing one: rows that differ from it carry a gold dot and the Changed filter appears.
  baseline?: string | Record<string, unknown> | null
  onChange: (permissions: PermissionState) => void
  t?: (key: string) => string | undefined
}

// Mirrors Users.tsx's normalizePermissionState -- see that file's comment
// for the full reasoning. A permission value is normally a plain boolean,
// but for a key in REVIEW_TIER_KEYS the literal string 'review' is also
// valid and must survive a round-trip through this editor: collapsing it
// via Boolean(value) here would silently upgrade a role's Review Required
// tier to Full Access the moment this editor mounted, even before the
// admin touched anything.
function parsePermissionState(permissions: PermissionEditorProps['permissions']): PermissionState {
  return normalizePermissionState(permissions)
}

export default function PermissionEditor({ permissions, baseline, onChange, t }: PermissionEditorProps) {
  const translate = (key: string, fallback: string): string => {
    if (typeof t !== 'function') return fallback
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const labelFor = (permission: PermissionDefinition): string => translate(permission.tKey, permission.label)
  const shortFor = (permission: PermissionDefinition): string => translate(permission.shortTKey ?? permission.tKey, permission.short ?? permission.label)
  // Only called for a `tier: true` permission -- see permissionDefinitions.ts's
  // reviewTKey/reviewDescription comment for why this is per-key rather than
  // one shared sentence, and the generic fallback below for a key that adds
  // `tier: true` without also adding its own explanation.
  const reviewDescriptionFor = (permission: PermissionDefinition): string => {
    const fallback = permission.reviewDescription
      || translate('review_required_generic_desc', 'Some actions in this section are limited or need admin approval under Review.')
    return permission.reviewTKey ? translate(permission.reviewTKey, fallback) : fallback
  }
  const sensitivityLabel = (value: PermissionSensitivity): string => {
    if (value === 'critical') return translate('permission_sensitive_critical', 'Sensitive')
    if (value === 'high') return translate('permission_sensitive_high', 'Sensitive')
    return translate('permission_sensitive_normal', 'Standard')
  }
  // One level vocabulary everywhere: None, View, Review, Full.
  const levelWord = (level: Level): string => {
    if (level === 'none') return translate('none', 'None')
    if (level === 'view') return translate('view', 'View')
    if (level === 'review') return translate('review_required', 'Review')
    return translate('label_full_access', 'Full')
  }
  const markWord = (mark: ChipMark): string => {
    if (mark === 'allow') return translate('perm_outcome_allow', 'Allowed')
    if (mark === 'queue') return translate('perm_outcome_queue', 'Needs approval')
    if (mark === 'limited') return translate('perm_outcome_limited', 'Name only')
    if (mark === 'fullOnly') return translate('perm_outcome_full_only', 'Full only')
    if (mark === 'off') return translate('perm_action_off', 'Off')
    return translate('perm_outcome_needs', 'Needs another permission')
  }
  const needsList = (requirements: ActionRequirement[]) => requirements.map((requirement) => translate(requirement.tKey, requirement.label)).join(', ')
  const nOff = (count: number): string => translate('perm_n_off', '{n} off').replace('{n}', String(count))
  const rowName = (row: ModuleRow): string => (row.sub && row.lead ? labelFor(row.lead) : translate(row.section.tKey, row.section.label))

  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Rows the admin has flipped from their default: closed normally, open while a search is showing its matches.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const perms = parsePermissionState(permissions)
  // A role saved with no permissions at all has an empty baseline, not none: every grant added is a change.
  const savedPermissions = baseline === undefined ? undefined : parsePermissionState(baseline)
  const hasBaseline = savedPermissions !== undefined
  const admin = perms.all === true

  const commit = (next: PermissionState) => {
    if (next !== perms) onChange(next)
  }
  const setLevel = (row: ModuleRow, level: Level) => commit(applyModuleLevel(row, level, perms))
  const toggleFlag = (key: string) => commit(toggleGrant(perms, key))

  // Switches ONE action off for this role, or hands it back to the level.
  //
  // Stored as an explicit `false` under a `section:action` key rather than
  // by deleting anything, because absent and false must mean different
  // things here: absent is "the level decides", false is "an admin decided".
  // Handing it back therefore DELETES the key rather than writing `true` --
  // otherwise a later level change would be silently overridden by a stale
  // `true` nobody remembers setting.
  const toggleActionOverride = (permissionKey: string, actionKey: string) => {
    const toggled = toggleActionOverrideMap(perms, permissionKey, actionKey)
    if (toggled === perms) return
    const next: PermissionState = { ...toggled }
    delete next.all
    onChange(next)
  }

  const activeCount = Object.keys(perms).filter((key) => perms[key]).length
  const permissionsWord = translate('permissions', 'Permissions')
  const administratorAfter = translate('perm_confirm_all_after', 'Full administrator')

  // Each bulk change replaces the whole draft, so each shows before -> after first.
  const requestAdminOn = async () => {
    const confirmed = await askToConfirm({
      title: translate('perm_confirm_all_title', 'Give this role full administrator access?'),
      items: [{ label: permissionsWord, value: `${activeCount} → ${administratorAfter}` }],
      note: translate('perm_confirm_all_note', 'Administrators can use every section. Nothing is saved until you save the role.'),
    })
    if (confirmed) onChange({ all: true })
  }
  const requestAdminOff = async () => {
    const confirmed = await askToConfirm({
      title: translate('perm_confirm_admin_off_title', 'Turn off Administrator?'),
      items: [{ label: permissionsWord, value: `${administratorAfter} → ${translate('none', 'None')}` }],
      note: translate('perm_confirm_admin_off_note', 'Every module starts at None. Nothing is saved until you save the role.'),
    })
    if (confirmed) onChange({})
  }
  const requestClear = async () => {
    const confirmed = await askToConfirm({
      title: translate('perm_confirm_clear_title', 'Clear every permission for this role?'),
      items: [{ label: permissionsWord, value: `${activeCount} → 0` }],
      note: translate('perm_confirm_clear_note', 'Nothing is saved until you save the role.'),
      confirmLabel: translate('perm_clear', 'Clear'),
      danger: true,
    })
    if (confirmed) onChange({})
  }

  const needle = query.trim()
  const searchHits = new Map<string, Set<string>>()
  const visibleRows = MODULE_ROWS.filter((row) => {
    if (needle) {
      const found = searchRow(row, needle, translate)
      if (!found.hit) return false
      searchHits.set(row.id, found.chips)
    }
    if (filter === 'on') return moduleIsOn(row, perms)
    if (filter === 'changed') return moduleChanged(row, perms, savedPermissions)
    return true
  })
  const isOpen = (id: string): boolean => (needle !== '') !== flipped.has(id)
  const toggleRow = (id: string) => setFlipped((previous) => {
    if (!needle && isPhoneScreen()) return previous.has(id) ? new Set() : new Set([id])
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const search = (value: string) => {
    setQuery(value)
    setFlipped(new Set())
  }

  const authority = effectivePermissions({ permissions: perms })

  // The tooltip of an action chip: its full name, what it does now, and what a tap does.
  const chipTitle = (chip: ChipState, label: string): string => {
    const parts = [label, chip.mark === 'needs' ? translate('perm_action_also_needs', 'Also needs: {list}').replace('{list}', needsList(chip.missing)) : markWord(chip.mark)]
    if (chip.toolNeedsFull) parts.push(translate('perm_action_review_tool_full', 'Under Review an edit waits for approval. The tool itself needs Full Access.'))
    if (chip.viewLocked) parts.push(translate('perm_view_implied', 'On while Add or Edit is on.'))
    else if (chip.canToggle) parts.push(chip.overriddenOff ? translate('perm_tap_to_turn_on', 'Tap to turn back on') : translate('perm_tap_to_switch_off', 'Tap to switch off for this role'))
    return parts.join(' · ')
  }

  const renderControl = (control: ControlState, ringed: boolean) => {
    const label = translate(control.action.tKey, control.action.label)
    const Icon = MARK_ICON[control.mark]
    const detail = control.mark === 'needs'
      ? translate('perm_action_also_needs', 'Also needs: {list}').replace('{list}', needsList(control.missing))
      : control.mark === 'fullOnly'
        ? translate('perm_action_control_needs_full', '{control} needs Full Access.').replace('{control}', label)
        : markWord(control.mark)
    return (
      <Fragment key={control.action.key}>
        <span aria-hidden="true" className="-mx-1 text-xs text-gray-400">›</span>
        <span
          role="img"
          aria-label={label}
          title={`${label} · ${detail}`}
          data-perm-control={control.action.key}
          data-perm-mark={control.mark}
          className={`${CHIP_BASE} cursor-default ${MARK_CLASS[control.mark]} ${ringed ? CHIP_RING : ''}`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          <span aria-hidden="true">{translate(control.action.shortTKey, control.action.short)}</span>
        </span>
      </Fragment>
    )
  }

  const renderActionChip = (row: ModuleRow, chip: ChipState, ringed: Set<string>) => {
    const label = translate(chip.action.tKey, chip.action.label)
    const Icon = chip.viewLocked ? Link2 : MARK_ICON[chip.mark]
    const matched = ringed.has(`action:${chip.action.key}`)
    return (
      <Fragment key={chip.action.key}>
        <button
          type="button"
          disabled={!chip.canToggle}
          aria-disabled={chip.canToggle ? undefined : true}
          aria-pressed={chip.pressed}
          aria-label={label}
          title={chipTitle(chip, label)}
          data-perm-action={chip.action.key}
          data-perm-mark={chip.mark}
          onClick={() => { if (chip.canToggle) toggleActionOverride(row.actionKey as string, chip.action.key) }}
          className={`${CHIP_BASE} ${MARK_CLASS[chip.viewLocked ? 'allow' : chip.mark]} ${chip.canToggle ? 'hover:brightness-95' : 'cursor-default'} ${matched ? CHIP_RING : ''}`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          <span aria-hidden="true">{translate(chip.action.shortTKey, chip.action.short)}</span>
        </button>
        {chip.controls.map((control) => renderControl(control, ringed.has(`action:${control.action.key}`)))}
      </Fragment>
    )
  }

  // An extra stays its own switch: a level tap never turns it on, and nothing is held by inclusion.
  const renderSwitch = (def: PermissionDefinition, ringed: Set<string>) => {
    const on = !!perms[def.key]
    const label = labelFor(def)
    const hint = def.hintTKey ? translate(def.hintTKey, def.hint ?? '') : ''
    const title = [label, def.sensitivity === 'normal' ? '' : sensitivityLabel(def.sensitivity), hint].filter(Boolean).join(' · ')
    return (
      <button
        key={def.key}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        title={title}
        data-perm-grant={def.key}
        onClick={() => toggleFlag(def.key)}
        className={`${CHIP_BASE} ${on ? 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-400 dark:hover:bg-zinc-800'} ${ringed.has(`grant:${def.key}`) ? CHIP_RING : ''}`}
      >
        {on ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
        {def.sensitivity === 'normal' ? null : <ShieldAlert className={`h-3 w-3 ${def.sensitivity === 'critical' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`} aria-hidden="true" />}
        <span aria-hidden="true">{shortFor(def)}</span>
      </button>
    )
  }

  const fieldChips = (heading: string, fields: PermissionDefinition[], ringed: Set<string>, needs?: Record<string, string>) => (
    <PermissionFieldChips
      heading={heading}
      fields={fields.map((entry) => ({ key: entry.key, label: labelFor(entry), active: !!perms[entry.key], needs: needs?.[entry.key], matched: ringed.has(`grant:${entry.key}`) }))}
      onToggle={toggleFlag}
    />
  )

  const renderPanel = (row: ModuleRow, state: ModuleState) => {
    const ringed = searchHits.get(row.id) ?? new Set<string>()
    const name = rowName(row)
    const description = [translate(`${row.section.tKey}_desc`, row.section.description), row.lead?.tier && !row.sub ? reviewDescriptionFor(row.lead) : ''].filter(Boolean).join('\n\n')
    const chips = chipStates(row, perms)
    const needLines = [
      ...chips.filter((chip) => chip.mark === 'needs').map((chip) => ({ label: translate(chip.action.tKey, chip.action.label), list: needsList(chip.missing) })),
      ...chips.flatMap((chip) => chip.controls.filter((control) => control.mark === 'needs').map((control) => ({ label: translate(control.action.tKey, control.action.label), list: needsList(control.missing) }))),
    ].slice(0, 3)
    const costViewHeld = authority.hasPermission('product_cost_view')
    const imageOnly = row.imageOnly && state.level === 'none' ? row.imageOnly : null
    return (
      <div id={`perm-panel-${row.id}`} className="mx-1 mb-1.5 rounded-lg bg-gray-50 p-2 dark:bg-zinc-800/70">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1 space-y-2">
            {admin ? <p className="text-xs text-gray-600 dark:text-gray-300">{translate('perm_admin_locked', 'Administrator has every permission. Turn it off to set each module.')}</p> : null}
            {!admin && row.id === 'sales' && state.level !== 'none' ? (
              <label className="block text-xs text-gray-700 dark:text-gray-200">
                {translate('perm_sales_customer_mode', 'Edit customer mode')}
                <AppSelect
                  className="mt-1 w-full"
                  buttonClassName="input w-full text-xs"
                  ariaLabel={translate('perm_sales_customer_mode', 'Edit customer mode')}
                  disabled={state.level !== 'full' || isActionOverriddenOff(perms as Record<string, unknown>, 'sales', 'customer')}
                  value={isActionOverriddenOff(perms as Record<string, unknown>, 'sales', 'customer_reassign') ? 'name-only' : 'assignment'}
                  onChange={(value) => {
                    const nameOnly = isActionOverriddenOff(perms as Record<string, unknown>, 'sales', 'customer_reassign')
                    if ((value === 'name-only') !== nameOnly) toggleActionOverride('sales', 'customer_reassign')
                  }}
                  options={[
                    { value: 'assignment', label: translate('perm_sales_customer_assignment', 'Choose another customer (default)') },
                    { value: 'name-only', label: translate('perm_sales_customer_name_only', 'Edit this sale’s name only') },
                  ]}
                />
              </label>
            ) : null}
            {chips.length ? <div className="flex flex-wrap items-center gap-1.5">{chips.map((chip) => renderActionChip(row, chip, ringed))}</div> : null}
            {chips.some((chip) => chip.viewLocked) ? <p className="text-xs text-gray-600 dark:text-gray-300">{translate('perm_view_implied', 'On while Add or Edit is on.')}</p> : null}
            {row.extras.length ? <div className="flex flex-wrap items-center gap-1.5">{row.extras.map((def) => renderSwitch(def, ringed))}</div> : null}
            {imageOnly ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">{renderSwitch(imageOnly.toggle, ringed)}</div>
                {perms[imageOnly.toggle.key] ? fieldChips(translate('perm_fields_shown', 'Fields shown'), imageOnly.fields, ringed) : null}
              </div>
            ) : null}
            {row.fields.length && state.level === 'full' ? fieldChips(translate('perm_fields_shown', 'Fields shown'), row.fields, ringed, costViewHeld ? undefined : { inventory_check_show_cost: translate('perm_action_also_needs', 'Also needs: {list}').replace('{list}', translate('perm_product_cost_view', 'View product costs')) }) : null}
            {needLines.map((line) => (
              <p key={line.label} className="text-xs text-amber-700 dark:text-amber-300">
                {translate('perm_action_control_also_needs', '{control} also needs: {list}').replace('{control}', line.label).replace('{list}', line.list)}
              </p>
            ))}
          </div>
          <InfoHint className="flex-shrink-0" triggerClassName={HINT_TRIGGER} label={name} text={description} />
        </div>
      </div>
    )
  }

  const renderLevelCell = (row: ModuleRow, state: ModuleState, level: Level, name: string) => {
    // Neither dot is pressed while a group of grants is partly on (the Full dot is half filled).
    const pressed = state.admin ? level === 'full' : state.level === level && !state.partial
    const half = !state.admin && level === 'full' && !!state.partial
    const hasExtras = !row.group.length && row.extras.length > 0
    const aria = [`${name}: ${levelWord(level)}`]
    if (half && state.partial) aria.push(translate('perm_n_of_total', '{n} of {total}').replace('{n}', String(state.partial.on)).replace('{total}', String(state.partial.total)))
    const title = state.admin
      ? translate('perm_admin_locked', 'Administrator has every permission. Turn it off to set each module.')
      : level === 'full' && hasExtras
        ? `${levelWord(level)} · ${translate('perm_full_main_only', 'Full gives the main access only. The extras stay separate switches.')}`
        : aria.join(' · ')
    return (
      <button
        key={level}
        type="button"
        aria-pressed={pressed}
        aria-label={aria.join(', ')}
        title={title}
        disabled={state.admin}
        data-perm-level={level}
        onClick={() => setLevel(row, level)}
        className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full disabled:cursor-not-allowed ${TOUCH_SQUARE}`}
      >
        <span
          className={`block h-[18px] w-[18px] rounded-full border-2 transition-colors ${
            pressed || half
              ? LEVEL_FILLED[level]
              : `border-gray-300 bg-white dark:border-zinc-600 dark:bg-zinc-900 ${LEVEL_HOVER[level]}`
          }`}
          style={half ? { background: 'linear-gradient(90deg, #2563eb 50%, transparent 50%)' } : undefined}
        />
      </button>
    )
  }

  const renderRow = (row: ModuleRow) => {
    const state = moduleState(row, perms)
    const name = rowName(row)
    const open = isOpen(row.id)
    const changed = moduleChanged(row, perms, savedPermissions)
    const offered = levelsOf(row)
    const doing = moduleCanDo(row, perms, translate)
    const shown = doing.slice(0, 3)
    const summary = `${shown.join(' · ')}${doing.length > shown.length ? ` +${doing.length - shown.length}` : ''}`
    return (
      <div key={row.id} data-perm-module={row.id} data-perm-changed={changed ? 'true' : undefined} className="border-b border-gray-100 last:border-b-0 dark:border-zinc-700/60">
        <div className={GRID}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`perm-panel-${row.id}`}
            title={[name, state.admin ? levelWord('full') : state.partial ? translate('perm_n_of_total', '{n} of {total}').replace('{n}', String(state.partial.on)).replace('{total}', String(state.partial.total)) : levelWord(state.level), doing.join(' · ')].filter(Boolean).join(' · ')}
            onClick={() => toggleRow(row.id)}
            className={`flex min-h-[44px] min-w-0 flex-col justify-center gap-0.5 rounded-lg py-1 pr-1 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/60 ${row.sub ? 'pl-5' : 'pl-1'}`}
          >
            <span className="flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold leading-6 text-gray-800 dark:text-gray-100">
              {changed ? <span role="img" aria-label={translate('perm_filter_changed', 'Changed')} title={translate('perm_filter_changed', 'Changed')} data-perm-dot="changed" className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500" /> : null}
              <span className={`min-w-0 break-words ${row.sub ? 'font-medium' : ''}`}>{name}</span>
              <SensitiveMark sensitivity={state.sensitivity} label={sensitivityLabel(state.sensitivity)} />
              {state.queued > 0 ? (
                <span title={`${translate('perm_outcome_queue', 'Needs approval')}: ${state.queued}`} aria-label={`${translate('perm_outcome_queue', 'Needs approval')}: ${state.queued}`} role="img" className="inline-flex items-center gap-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <Hourglass className="h-3 w-3" aria-hidden="true" />{state.queued}
                </span>
              ) : null}
              {state.off > 0 ? (
                <span title={nOff(state.off)} aria-label={nOff(state.off)} role="img" className="inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                  <X className="h-3 w-3" aria-hidden="true" />{state.off}
                </span>
              ) : null}
              <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </span>
            {summary ? (
              <span className="flex w-full min-w-0 items-center gap-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                {doing.length ? <Check className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> : null}
                <span className="truncate">{summary}</span>
              </span>
            ) : null}
          </button>
          {COLUMNS.map((level) => (offered.includes(level)
            ? renderLevelCell(row, state, level, name)
            : <span key={level} aria-hidden="true" className="mx-auto select-none text-xs text-gray-300 dark:text-zinc-600">–</span>))}
        </div>
        {open ? renderPanel(row, state) : null}
      </div>
    )
  }

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: translate('perm_select_all', 'All') },
    { id: 'on', label: translate('perm_filter_on', 'On') },
    ...(hasBaseline ? [{ id: 'changed' as const, label: translate('perm_filter_changed', 'Changed') }] : []),
  ]
  const legend: Array<{ mark: ChipMark; text: string }> = (['allow', 'queue', 'limited', 'fullOnly', 'off', 'needs'] as const).map((mark) => ({ mark, text: markWord(mark) }))
  const adminLabel = translate('perm_all', 'Administrator (full access)')

  return (
    <div>
      {confirmDialog}
      <div className="sticky top-0 z-20 -mx-1 bg-white px-1 pb-1 pt-1 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="relative order-1 block min-w-0 flex-1 sm:order-2 sm:max-w-[16rem]">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => search(event.target.value)}
              placeholder={translate('perm_find', 'Find permission')}
              aria-label={translate('perm_find', 'Find permission')}
              className={`input h-8 w-full pl-7 text-xs ${TOUCH_TARGET}`}
            />
          </label>
          <button
            type="button"
            onClick={requestClear}
            disabled={activeCount === 0}
            aria-label={translate('perm_clear_all', 'Clear all permissions')}
            title={translate('perm_clear_all', 'Clear all permissions')}
            className={`order-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/30 sm:order-5 sm:ml-auto ${TOUCH_SQUARE}`}
          >
            <Eraser className="h-4 w-4" aria-hidden="true" />
          </button>
          <div aria-hidden="true" className="order-3 h-0 basis-full sm:hidden" />
          <button
            type="button"
            role="switch"
            aria-checked={admin}
            aria-label={adminLabel}
            title={adminLabel}
            onClick={() => (admin ? requestAdminOff() : requestAdminOn())}
            className={`order-4 inline-flex select-none items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-zinc-800 sm:order-1 ${TOUCH_TARGET} min-h-8`}
          >
            <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-300" aria-hidden="true" />
            {translate('role_preset_admin', 'Administrator')}
            <span aria-hidden="true" className={`relative inline-block h-5 w-9 flex-shrink-0 rounded-full transition-colors ${admin ? 'bg-blue-600' : 'bg-gray-300 dark:bg-zinc-600'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${admin ? 'left-[1.1rem]' : 'left-0.5'}`} />
            </span>
          </button>
          <div className="order-5 inline-flex overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700 sm:order-3">
            {filters.map((entry, index) => (
              <button
                type="button"
                key={entry.id}
                aria-pressed={filter === entry.id}
                onClick={() => setFilter(entry.id)}
                className={`px-2.5 text-xs font-semibold leading-7 ${TOUCH_TARGET} ${index > 0 ? 'border-l border-gray-200 dark:border-zinc-700' : ''} ${filter === entry.id ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <InfoHint
            className="order-2 flex-shrink-0 sm:order-4"
            triggerClassName={HINT_TRIGGER}
            label={translate('perm_marks_label', 'What the marks mean')}
            text={legend.map((entry) => entry.text).join('\n')}
          >
            <ul className="space-y-1.5">
              {legend.map((entry) => {
                const Icon = MARK_ICON[entry.mark]
                return (
                  <li key={entry.mark} className="flex items-center gap-1.5">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${MARK_CLASS[entry.mark]}`}><Icon className="h-3 w-3" aria-hidden="true" /></span>
                    {entry.text}
                  </li>
                )
              })}
            </ul>
          </InfoHint>
        </div>
        <div role="group" aria-label={translate('perm_access_levels', 'Access level')} className={`${GRID} mt-1 border-b border-gray-200 pb-1 dark:border-zinc-700`}>
          <span />
          {COLUMNS.map((level) => (
            <span key={level} className="flex flex-col items-center gap-0.5 text-xs font-medium leading-4 text-gray-600 dark:text-gray-300">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${LEVEL_DOT[level]}`} />
              {levelWord(level)}
            </span>
          ))}
        </div>
      </div>
      {visibleRows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{translate('perm_find_none', 'No matching permission')}</p>
      ) : null}
      <div>{visibleRows.map(renderRow)}</div>
    </div>
  )
}

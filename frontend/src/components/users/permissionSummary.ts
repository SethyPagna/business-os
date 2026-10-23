// permissionSummary.ts -- the role editor's model, without React.
//
// The access grid shows one row per module, so everything the grid needs to decide is answered here from the two
// catalogs and the stored permission map: which level a module is at, what each action chip says, what a tap on a
// level writes, and whether a module differs from the saved role. Keeping it free of React and of any pack lookup
// lets the editor and the user detail share one reading of a role (and keeps the detail's chunk light: this file
// imports only the catalogs and utils/permissions).
//
// Nothing here changes the stored format. A level tap writes the same keys the old pickers wrote, with one
// deliberate difference: Full sets a module's main key and nothing else, so costs, destructive imports, Security,
// backup restore, the Suppliers section, Identity, Policies, Receipts, Drive, AI provider keys, the Website Editor
// areas, the Library and the count sessions stay separate switches (owner, 21 Oct 2026: Full = main access only;
// the Worker has no fallback between keys, so the grid shows exactly what is stored).
import { PERMISSION_SECTIONS, type PermissionDefinition, type PermissionSection, type PermissionSensitivity } from './permissionDefinitions.ts'
import { actionsForKey, isActionOverriddenOff, isViewImpliedByWrite, outcomeAt, type ActionOutcome, type ActionRequirement, type PermissionAction } from '../../utils/permissionActions.ts'
import { effectivePermissions, normalizePermissionState, type PermissionValue } from '../../utils/permissions.ts'

export type PermissionState = Record<string, PermissionValue>
export type Level = 'none' | 'view' | 'review' | 'full'
export type Translate = (key: string, fallback: string) => string

export const LEVELS: readonly Level[] = ['none', 'view', 'review', 'full']

const FIELD_GROUP_PREFIXES = ['inventory_check_show_', 'products_image_only_show_']
const fieldPrefixOf = (key: string): string | undefined => FIELD_GROUP_PREFIXES.find((prefix) => key.startsWith(prefix))
const SENSITIVITY_RANK: Record<PermissionSensitivity, number> = { normal: 0, high: 1, critical: 2 }

/** One row of the grid: a module, or the Inventory check sessions sub-row under Inventory. */
export interface ModuleRow {
  /** The row's lead key, or the section key for a group of grants (Website Editor). Unique across the grid. */
  id: string
  section: PermissionSection
  sub: boolean
  /** The key the level cells write: the section's tiered key, or its `lead` key. Null for a group row. */
  lead: PermissionDefinition | null
  /** A section with no lead (Website Editor): the level is derived from these grants, None clears all and Full sets all. */
  group: PermissionDefinition[]
  /** The middle level the lead offers, if any. */
  middle: 'view' | 'review' | null
  /** Switch chips: grants that stay separate from the level. For a group row these are the group's own grants. */
  extras: PermissionDefinition[]
  /** Field chips (the count-session fields), shown on the sub-row, or on the main row when there is none. */
  fields: PermissionDefinition[]
  /** The narrower route into the page: a switch and its field chips, offered only while the lead is None. */
  imageOnly: { toggle: PermissionDefinition; fields: PermissionDefinition[] } | null
  /** The PERMISSION_ACTIONS table this row draws chips from. */
  actionKey: string | null
}

function buildRows(): ModuleRow[] {
  const rows: ModuleRow[] = []
  for (const section of PERMISSION_SECTIONS) {
    if (section.key === 'full_access') continue
    const defs = section.permissions
    const alternates = defs.filter((def) => def.exclusiveWithTier)
    const alternateKeys = new Set(alternates.flatMap((def) => [def.key, ...(def.alsoClearsKeys ?? [])]))
    const fieldDefs = defs.filter((def) => fieldPrefixOf(def.key) && !alternateKeys.has(def.key))
    const main = defs.find((def) => def.tier) ?? defs.find((def) => def.lead && !def.subRow) ?? null
    const subs = defs.filter((def) => def.subRow)
    const extras = defs.filter((def) => def !== main && !def.subRow && !alternateKeys.has(def.key) && !fieldDefs.includes(def))
    const imageOnly = alternates[0]
      ? { toggle: alternates[0], fields: (alternates[0].alsoClearsKeys ?? []).map((key) => defs.find((def) => def.key === key)).filter((def): def is PermissionDefinition => !!def) }
      : null
    rows.push({
      id: main?.key ?? section.key,
      section,
      sub: false,
      lead: main,
      group: main ? [] : extras,
      middle: main?.tier ? (main.middleTier === 'view' ? 'view' : 'review') : null,
      extras,
      fields: subs.length ? [] : fieldDefs,
      imageOnly,
      actionKey: main?.key ?? null,
    })
    for (const sub of subs) {
      rows.push({ id: sub.key, section, sub: true, lead: sub, group: [], middle: null, extras: [], fields: fieldDefs, imageOnly: null, actionKey: sub.key })
    }
  }
  return rows
}

/** Every row of the grid, in the catalog's order. */
export const MODULE_ROWS: ModuleRow[] = buildRows()

/** The levels a row really offers, in column order. */
export function levelsOf(row: ModuleRow): Level[] {
  return ['none', ...(row.middle ? [row.middle] : []), 'full']
}

export function tierLevel(value: PermissionValue | undefined): Level {
  if (value === 'review') return 'review'
  if (value === 'view') return 'view'
  return value ? 'full' : 'none'
}

/** The tier the action table is read at: the level for a tiered module, on/off for the rest. */
function actionTierOf(row: ModuleRow, perms: PermissionState): Level {
  if (!row.lead) return 'none'
  return row.lead.tier ? tierLevel(perms[row.lead.key]) : perms[row.lead.key] === true ? 'full' : 'none'
}

export type ChipMark = 'allow' | 'queue' | 'limited' | 'fullOnly' | 'off' | 'needs'

export interface ControlState {
  action: PermissionAction
  mark: 'allow' | 'fullOnly' | 'off' | 'needs'
  missing: ActionRequirement[]
}

export interface ChipState {
  action: PermissionAction
  mark: ChipMark
  /** The level's own answer for this action, before any switch-off or missing grant. */
  outcome: ActionOutcome
  /** aria-pressed: on or off. Undefined while the level blocks the action, which makes the chip inert. */
  pressed: boolean | undefined
  canToggle: boolean
  overriddenOff: boolean
  /** Contacts View while Add or Edit is on. */
  viewLocked: boolean
  missing: ActionRequirement[]
  /** At Review the edit queues, but the page tool itself needs Full. */
  toolNeedsFull: boolean
  controls: ControlState[]
}

const customerModeDropdown = (permissionKey: string, action: PermissionAction): boolean => permissionKey === 'sales' && action.key === 'customer_reassign'

/** The action chips of a row at its current level. Empty at None: nothing on a page the role cannot open. */
export function chipStates(row: ModuleRow, perms: PermissionState): ChipState[] {
  const key = row.actionKey
  if (!key || perms.all) return []
  const tier = actionTierOf(row, perms)
  if (tier === 'none') return []
  const actions = actionsForKey(key)
  const authority = effectivePermissions({ permissions: perms })
  const unmet = (requirements: ActionRequirement[] = []) => requirements.filter((requirement) => !authority.meets(requirement.key))
  const bag = perms as Record<string, unknown>
  return actions.filter((action) => !action.follows && !customerModeDropdown(key, action)).map((action) => {
    const outcome = outcomeAt(action, tier)
    const overriddenOff = isActionOverriddenOff(bag, key, action.key)
    const viewLocked = outcome !== 'block' && isViewImpliedByWrite(bag, key, action.key)
    const missing = outcome === 'block' ? [] : unmet(action.requires)
    const blocked = outcome === 'block'
    const mark: ChipMark = blocked ? 'fullOnly' : overriddenOff ? 'off' : missing.length ? 'needs' : outcome === 'queue' ? 'queue' : outcome === 'limited' ? 'limited' : 'allow'
    const controls: ControlState[] = actions.filter((entry) => entry.follows === action.key).map((control) => {
      const controlMissing = outcomeAt(control, tier) === 'block' ? [] : unmet(control.requires)
      // A parent switched off takes its control with it, whatever the level would have said.
      if (overriddenOff) return { action: control, mark: 'off', missing: [] }
      if (outcomeAt(control, tier) === 'block') return { action: control, mark: 'fullOnly', missing: [] }
      const missingAll = [...missing, ...controlMissing]
      return { action: control, mark: missingAll.length ? 'needs' : 'allow', missing: missingAll }
    })
    return {
      action,
      mark,
      outcome,
      pressed: blocked ? undefined : !overriddenOff,
      canToggle: !blocked && !viewLocked,
      overriddenOff,
      viewLocked,
      missing,
      toolNeedsFull: tier === 'review' && !overriddenOff && !blocked && action.controlReview === 'block',
      controls,
    }
  })
}

export interface ModuleState {
  level: Level
  admin: boolean
  /** A group row with some but not all grants on. */
  partial: { on: number; total: number } | null
  extrasOn: number
  imageOnlyOn: boolean
  /** The highest sensitivity among the grants this role holds in the row. */
  sensitivity: PermissionSensitivity
  /** Actions switched off while the level still grants them. */
  off: number
  /** Actions that wait for approval at this level. */
  queued: number
}

const isOn = (perms: PermissionState, key: string): boolean => !!perms[key]

/** Whether a grant is stored on. Nothing is held by inclusion: each grant is its own switch. */
const isGranted = (perms: PermissionState, def: PermissionDefinition): boolean => isOn(perms, def.key)

export function moduleState(row: ModuleRow, perms: PermissionState): ModuleState {
  const admin = perms.all === true
  const chips = chipStates(row, perms)
  const extrasOn = row.extras.filter((def) => isGranted(perms, def)).length
  const imageOnlyOn = !!row.imageOnly && isOn(perms, row.imageOnly.toggle.key)
  let level: Level = 'none'
  let partial: ModuleState['partial'] = null
  if (admin) level = 'full'
  else if (row.group.length) {
    const on = row.group.filter((def) => isGranted(perms, def)).length
    if (on === row.group.length) level = 'full'
    else if (on > 0) partial = { on, total: row.group.length }
  } else if (row.lead) {
    level = row.lead.tier ? tierLevel(perms[row.lead.key]) : perms[row.lead.key] === true ? 'full' : 'none'
  }
  const held: PermissionDefinition[] = [
    ...(row.lead && level !== 'none' && !row.group.length ? [row.lead] : []),
    ...row.extras.filter((def) => isGranted(perms, def)),
    ...(imageOnlyOn && row.imageOnly ? [row.imageOnly.toggle] : []),
  ]
  const sensitivity = admin ? 'normal' : held.reduce<PermissionSensitivity>((top, def) => (SENSITIVITY_RANK[def.sensitivity] > SENSITIVITY_RANK[top] ? def.sensitivity : top), 'normal')
  return {
    level,
    admin,
    partial,
    extrasOn,
    imageOnlyOn,
    sensitivity,
    off: chips.filter((chip) => chip.mark === 'off').length,
    queued: chips.filter((chip) => chip.mark === 'queue').length,
  }
}

/** What the role can actually do in a row, as short words: allowed actions, then the extras that are on. */
export function moduleCanDo(row: ModuleRow, perms: PermissionState, tr: Translate): string[] {
  if (perms.all) return [tr('all_actions', 'All actions')]
  const words = chipStates(row, perms)
    .filter((chip) => chip.mark === 'allow' || chip.mark === 'limited')
    .map((chip) => tr(chip.action.shortTKey, chip.action.short))
  for (const def of row.extras) {
    if (isGranted(perms, def)) words.push(tr(def.shortTKey ?? def.tKey, def.short ?? def.label))
  }
  if (row.imageOnly && isOn(perms, row.imageOnly.toggle.key) && actionTierOf(row, perms) === 'none') {
    words.push(tr(row.imageOnly.toggle.shortTKey ?? row.imageOnly.toggle.tKey, row.imageOnly.toggle.short ?? row.imageOnly.toggle.label))
  }
  return words
}

/** Modules per level, plus how many actions are switched off in all: the Roles list's strip. The sub-row is not a module. */
export function roleTierCounts(perms: PermissionState): Record<Level, number> & { off: number } {
  const counts = { none: 0, view: 0, review: 0, full: 0, off: 0 }
  for (const row of MODULE_ROWS) {
    const state = moduleState(row, perms)
    counts.off += state.off
    if (row.sub) continue
    counts[state.partial ? 'full' : state.level] += 1
  }
  return counts
}

/** Every stored key a row owns: its own grants, and the `key:action` switches of its action table. */
function rowKeys(row: ModuleRow, ...maps: PermissionState[]): string[] {
  const own = [
    ...(row.lead ? [row.lead.key] : []),
    ...row.group.map((def) => def.key),
    ...row.extras.map((def) => def.key),
    ...row.fields.map((def) => def.key),
    ...(row.imageOnly ? [row.imageOnly.toggle.key, ...row.imageOnly.fields.map((def) => def.key)] : []),
  ]
  const overrides = row.actionKey ? maps.flatMap((map) => Object.keys(map).filter((key) => key.startsWith(`${row.actionKey}:`))) : []
  return [...new Set([...own, ...overrides])]
}

/** A stored value as the editor reads it: an action switch only counts when it is an explicit false. */
function readValue(map: PermissionState, key: string, row: ModuleRow): string {
  if (key.includes(':')) return map[key] === false ? 'off' : 'default'
  const value = map[key]
  return value === 'review' || value === 'view' ? value : value === true ? 'on' : 'off'
}

/** Whether a row differs from the saved role. Editing a new role has no baseline, so nothing is changed. */
export function moduleChanged(row: ModuleRow, perms: PermissionState, baseline: unknown): boolean {
  if (baseline === undefined || baseline === null) return false
  const before = normalizePermissionState(baseline)
  if (!!before.all !== !!perms.all) return true
  return rowKeys(row, perms, before).some((key) => readValue(perms, key, row) !== readValue(before, key, row))
}

/** Whether a row grants anything at all: the "On" filter. */
export function moduleIsOn(row: ModuleRow, perms: PermissionState): boolean {
  const state = moduleState(row, perms)
  return state.admin || state.level !== 'none' || !!state.partial || state.extrasOn > 0 || state.imageOnlyOn
}

/** Every row key the search can match, as the words a person sees. Returns the chip keys that matched. */
export function searchRow(row: ModuleRow, needle: string, tr: Translate): { hit: boolean; chips: Set<string> } {
  const lowered = needle.trim().toLowerCase()
  const chips = new Set<string>()
  if (!lowered) return { hit: true, chips }
  const has = (...words: string[]) => words.some((word) => word.toLowerCase().includes(lowered))
  let hit = row.sub
    ? !!row.lead && has(tr(row.lead.tKey, row.lead.label))
    : has(tr(row.section.tKey, row.section.label)) || (!!row.lead && has(tr(row.lead.tKey, row.lead.label)))
  for (const action of row.actionKey ? actionsForKey(row.actionKey) : []) {
    if (has(tr(action.tKey, action.label), tr(action.shortTKey, action.short))) { chips.add(`action:${action.key}`); hit = true }
  }
  const grants = [...row.extras, ...row.fields, ...(row.imageOnly ? [row.imageOnly.toggle, ...row.imageOnly.fields] : [])]
  for (const def of grants) {
    if (has(tr(def.tKey, def.label), tr(def.shortTKey ?? def.tKey, def.short ?? def.label))) { chips.add(`grant:${def.key}`); hit = true }
  }
  return { hit, chips }
}

/** The group definition behind an exclusive alternate (image-only access), found from its key. */
function exclusivityOf(key: string): PermissionDefinition | undefined {
  return PERMISSION_SECTIONS.flatMap((section) => section.permissions).find((def) => def.key === key && def.exclusiveWithTier)
}

/** What a tap on one level writes. Returns the same map when the tap changes nothing. */
export function applyModuleLevel(row: ModuleRow, level: Level, perms: PermissionState): PermissionState {
  if (perms.all) return perms
  if (level !== 'none' && level !== 'full' && level !== row.middle) return perms
  const state = moduleState(row, perms)
  if (state.level === level && !state.partial) return perms
  const next: PermissionState = { ...perms }
  if (level === 'none') {
    if (row.lead) delete next[row.lead.key]
    for (const def of row.group) delete next[def.key]
    for (const def of row.extras) delete next[def.key]
    if (row.imageOnly) {
      delete next[row.imageOnly.toggle.key]
      for (const def of row.imageOnly.fields) delete next[def.key]
    }
    return next
  }
  if (row.group.length) {
    for (const def of row.group) next[def.key] = true
    return next
  }
  if (!row.lead) return perms
  next[row.lead.key] = level === 'full' ? true : level
  // Real access to the page overrides the narrower route into it, and the two never coexist.
  if (row.imageOnly) {
    delete next[row.imageOnly.toggle.key]
    for (const def of row.imageOnly.fields) delete next[def.key]
  }
  return next
}

/** Flips one on/off grant: an extra, a field chip, or the image-only switch. Returns the same map when refused. */
export function toggleGrant(perms: PermissionState, key: string): PermissionState {
  if (perms.all) return perms
  const exclusive = exclusivityOf(key)
  if (exclusive && !perms[key] && tierLevel(perms[exclusive.exclusiveWithTier as string]) !== 'none') return perms
  const next: PermissionState = { ...perms }
  if (next[key]) delete next[key]
  else next[key] = true
  return next
}

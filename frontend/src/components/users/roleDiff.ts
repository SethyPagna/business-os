import { PERMISSION_DEFS, type PermissionDefinition, type PermissionSensitivity } from './permissionDefinitions.ts'
import { levelWord, rolePermissionLabel } from './rolePermissionLabel.ts'
import { MODULE_ROWS, moduleState, type ModuleRow, type PermissionState } from './permissionSummary.ts'
import { actionsForKey } from '../../utils/permissionActions.ts'
import { normalizePermissionState, type PermissionValue } from '../../utils/permissions.ts'

type Translate = (key: string, fallback: string) => string

export type RoleValueWord = 'on' | 'off' | 'review' | 'view' | 'unset'

export type RolePermissionChange = {
  key: string
  label: string
  sensitivity: PermissionSensitivity
  before: RoleValueWord
  after: RoleValueWord
}

const wordOf = (value: PermissionValue | undefined): RoleValueWord => (
  value === undefined ? 'unset' : value === 'review' ? 'review' : value === 'view' ? 'view' : value ? 'on' : 'off'
)

/** A `section:action` switch carries its section's sensitivity; an unknown key is treated as standard. */
function sensitivityOf(key: string): PermissionSensitivity {
  const def = PERMISSION_DEFS.find((item) => item.key === key) ?? PERMISSION_DEFS.find((item) => item.key === key.split(':')[0])
  return def?.sensitivity ?? 'normal'
}

/** The word shown for a stored value: the same vocabulary the editor uses; ABSENT is "no opinion", not Off. */
export function roleValueLabel(word: RoleValueWord, tr: Translate): string {
  if (word === 'on') return tr('perm_value_on', 'On')
  if (word === 'off') return tr('off', 'Off')
  if (word === 'review') return tr('review_required', 'Review')
  if (word === 'view') return tr('view', 'View')
  return tr('perm_value_not_set', 'Not set')
}

/**
 * Every key whose stored value differs between two permission maps, in the editor's own order (catalogue
 * sections first, then their actions, then anything the catalogue cannot name). An unknown key is listed
 * under its raw name rather than dropped: the admin approves exactly what will be written.
 */
export function diffRolePermissions(before: unknown, after: unknown, tr: Translate): RolePermissionChange[] {
  const a = normalizePermissionState(before)
  const b = normalizePermissionState(after)
  const order = new Map<string, number>()
  PERMISSION_DEFS.forEach((def, index) => order.set(def.key, index * 1000))
  const rank = (key: string): number => order.get(key) ?? (order.get(key.split(':')[0]) ?? 1e9) + 1
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
  const changes: RolePermissionChange[] = []
  for (const key of keys) {
    if (a[key] === b[key]) continue
    changes.push({
      key,
      label: rolePermissionLabel(key, tr) ?? key,
      sensitivity: sensitivityOf(key),
      before: wordOf(a[key]),
      after: wordOf(b[key]),
    })
  }
  return changes
}

// -- The save review: one row per module, in the words the editor and the Roles list use ------------------------

/**
 * `level` is the module's level move (or, `unchanged`, just the level it stays at, so the lines under it have
 * something to hang from), `actions` the page controls switched off or handed back, `extra` one separate switch.
 */
export type RoleChangeLine = { kind: 'level' | 'actions' | 'extra'; text: string; sensitivity?: PermissionSensitivity; unchanged?: true }

export type RoleChangeRow = {
  kind: 'name' | 'admin' | 'module' | 'other'
  id: string
  label: string
  /** The stored key of a row the catalogue cannot name: it rides the tooltip, never the visible label. */
  hint?: string
  sensitivity: PermissionSensitivity
  lines: RoleChangeLine[]
}

const SENSITIVITY_RANK: Record<PermissionSensitivity, number> = { normal: 0, high: 1, critical: 2 }

/** What a role holds in one module, reading the Worker's rules the way the editor does (each grant is its own stored switch). */
function snapshotOf(row: ModuleRow, perms: PermissionState) {
  const admin = perms.all === true
  const state = moduleState(row, perms)
  const grants = new Map<string, boolean>()
  const extras = [...row.extras, ...(row.imageOnly ? [row.imageOnly.toggle] : [])]
  const fields = [...row.fields, ...(row.imageOnly?.fields ?? [])]
  for (const def of [...extras, ...fields]) grants.set(def.key, admin || !!perms[def.key])
  const off = new Set<string>()
  if (row.actionKey && !admin) {
    for (const action of actionsForKey(row.actionKey)) if (perms[`${row.actionKey}:${action.key}`] === false) off.add(action.key)
  }
  return { level: state.level, grants, off, extras, fields }
}

function moduleChange(row: ModuleRow, a: PermissionState, b: PermissionState, tr: Translate): RoleChangeRow | null {
  const was = snapshotOf(row, a)
  const now = snapshotOf(row, b)
  const lines: RoleChangeLine[] = []
  let sensitivity: PermissionSensitivity = 'normal'
  const raise = (value: PermissionSensitivity) => { if (SENSITIVITY_RANK[value] > SENSITIVITY_RANK[sensitivity]) sensitivity = value }
  const stateWord = (snapshot: typeof was): string => levelWord(snapshot.level, tr)

  // A group of grants with no main key (Website Editor) has no level of its own: each grant is its own line below.
  const moved = !row.group.length && was.level !== now.level
  if (moved) raise(row.lead?.sensitivity ?? 'normal')

  const actions = row.actionKey ? actionsForKey(row.actionKey) : []
  const word = (action: (typeof actions)[number]): string => tr(action.shortTKey, action.short)
  const switchedOff = actions.filter((action) => now.off.has(action.key) && !was.off.has(action.key))
  const handedBack = actions.filter((action) => was.off.has(action.key) && !now.off.has(action.key))
  if (switchedOff.length || handedBack.length) {
    lines.push({
      kind: 'actions',
      text: [switchedOff.length ? `✕ ${switchedOff.map(word).join(', ')}` : '', handedBack.length ? `✓ ${handedBack.map(word).join(', ')}` : ''].filter(Boolean).join(' · '),
    })
    for (const action of [...switchedOff, ...handedBack]) raise(sensitivityOf(`${row.actionKey}:${action.key}`))
  }

  // Extras are separate switches and each is its own line, so a level change never hides one.
  const grantWord = (def: PermissionDefinition): string => tr(def.shortTKey ?? def.tKey, def.short ?? def.label)
  for (const def of now.extras) {
    if (was.grants.get(def.key) === now.grants.get(def.key)) continue
    lines.push({ kind: 'extra', text: `${now.grants.get(def.key) ? '+' : '−'} ${grantWord(def)}`, sensitivity: def.sensitivity })
    raise(def.sensitivity)
  }
  // Field chips only say which columns show: grouped, one line each way.
  for (const gained of [true, false]) {
    const shifted = now.fields.filter((def) => was.grants.get(def.key) !== now.grants.get(def.key) && now.grants.get(def.key) === gained)
    if (shifted.length) lines.push({ kind: 'extra', text: `${gained ? '+' : '−'} ${shifted.map((def) => tr(def.tKey, def.label)).join(', ')}` })
  }

  if (!lines.length && !moved) return null
  const level: RoleChangeLine[] = row.group.length ? [] : [moved ? { kind: 'level', text: `${stateWord(was)} → ${stateWord(now)}` } : { kind: 'level', text: stateWord(now), unchanged: true }]
  const label = row.sub && row.lead ? tr(row.lead.tKey, row.lead.label) : tr(row.section.tKey, row.section.label)
  return { kind: 'module', id: row.id, label, sensitivity, lines: [...level, ...lines] }
}

/**
 * The save review for a role: one row per changed module instead of one per stored key.
 * Order: the name, Administrator, modules holding a critical change, then the rest in catalogue order, and last
 * any key the catalogue cannot name (listed raw, never dropped). A value that moved between "absent" and "off"
 * is no change, so there is no "Not set" here. Turning Administrator on is a single row: it covers every module.
 */
export function summarizeRoleChangesByModule(before: unknown, after: unknown, tr: Translate, rename?: { from: string; to: string }): RoleChangeRow[] {
  const a = normalizePermissionState(before)
  const b = normalizePermissionState(after)
  const head: RoleChangeRow[] = []
  const from = rename?.from.trim() ?? ''
  const to = rename?.to.trim() ?? ''
  if (rename && from !== to) {
    head.push({ kind: 'name', id: 'name', label: tr('role_name', 'Role name'), sensitivity: 'normal', lines: [{ kind: 'level', text: from ? `${from} → ${to}` : to }] })
  }
  if (!!a.all !== !!b.all) {
    head.push({
      kind: 'admin',
      id: 'all',
      label: tr('role_preset_admin', 'Administrator'),
      sensitivity: 'critical',
      lines: [{ kind: 'level', text: `${roleValueLabel(a.all ? 'on' : 'off', tr)} → ${roleValueLabel(b.all ? 'on' : 'off', tr)}` }],
    })
  }
  if (b.all) return head

  const modules = MODULE_ROWS.flatMap((row) => moduleChange(row, a, b, tr) ?? [])
  const unknown: RoleChangeRow[] = []
  for (const change of diffRolePermissions(a, b, tr)) {
    if (rolePermissionLabel(change.key, tr) !== null) continue
    const was = change.before === 'unset' ? 'off' : change.before
    const now = change.after === 'unset' ? 'off' : change.after
    if (was === now) continue
    // A key the catalogue has no name for still gets a plain, translated label; the stored key stays in the tooltip.
    unknown.push({ kind: 'other', id: change.key, label: tr('role_other_permission', 'Other permission'), hint: change.key, sensitivity: change.sensitivity, lines: [{ kind: 'level', text: `${roleValueLabel(was, tr)} → ${roleValueLabel(now, tr)}` }] })
  }
  return [
    ...head,
    ...modules.filter((row) => row.sensitivity === 'critical'),
    ...modules.filter((row) => row.sensitivity !== 'critical'),
    ...unknown,
  ]
}

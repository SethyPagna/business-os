import { Fragment, useState } from 'react'
import Search from 'lucide-react/dist/esm/icons/search.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import InfoHint from '../shared/InfoHint.tsx'
import AppSelect from '../shared/AppSelect.tsx'
import { useConfirmDialog } from '../shared/useConfirmDialog.tsx'
import PermissionFieldChips from './PermissionFieldChips.tsx'
import { PERMISSION_SECTIONS, permissionDefinitionValue, type PermissionDefinition, type PermissionSection, type PermissionSensitivity } from './permissionDefinitions'
import { effectivePermissions, normalizePermissionState, type PermissionValue } from '../../utils/permissions.ts'
import { actionsForKey, isActionOverriddenOff, isViewImpliedByWrite, outcomeAt, toggleActionOverrideMap, type ActionOutcome, type ActionRequirement } from '../../utils/permissionActions.ts'

type PermissionState = Record<string, PermissionValue>
// 'view' is the read-only middle tier for VIEW_TIER_KEYS sections (Settings, ...):
// the page is visible but every write is blocked. It sits where 'review' does for
// REVIEW_TIER_KEYS; a section offers exactly one of the two middle flavors
// (permissionDefinitions.ts's `middleTier`).
type Tier = 'full' | 'review' | 'view' | 'none'
// Section-level picker: 'none'/'full' bulk-set every key the section defines
// (setSectionMode), 'view'/'review' set only the section's tiered key and 'custom'
// reveals the per-key controls. It aggregates the same per-key data those controls
// edit, so it adds no permission key and no storage shape. The header chip, the
// picker and the glance line all read sectionInfo, so they cannot disagree.
type SectionMode = 'none' | 'view' | 'review' | 'full' | 'custom'

// Field groups render as one row of toggle chips instead of one switch per field.
const FIELD_GROUP_PREFIXES = ['inventory_check_show_', 'products_image_only_show_']
const fieldGroupPrefix = (key: string): string | undefined => FIELD_GROUP_PREFIXES.find((prefix) => key.startsWith(prefix))

// Tap targets grow to 44px on touch screens only, so the desktop editor stays compact.
const TOUCH_TARGET = '[@media(pointer:coarse)]:min-h-[44px]'

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

function tierOf(value: PermissionValue | undefined): Tier {
  if (value === 'review') return 'review'
  if (value === 'view') return 'view'
  if (value) return 'full'
  return 'none'
}

export default function PermissionEditor({ permissions, onChange, t }: PermissionEditorProps) {
  const translate = (key: string, fallback: string): string => {
    if (typeof t !== 'function') return fallback
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const labelFor = (permission: PermissionDefinition): string => translate(permission.tKey, permission.label)
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
  // One tier vocabulary everywhere: None, View, Review, Full (and Custom for a mixed section).
  const modeLabel = (mode: SectionMode): string => {
    if (mode === 'none') return translate('none', 'None')
    if (mode === 'view') return translate('view', 'View')
    if (mode === 'review') return translate('review_required', 'Review')
    if (mode === 'full') return translate('label_full_access', 'Full')
    return translate('permission_custom', 'Custom')
  }
  const { askToConfirm, confirmDialog } = useConfirmDialog(t)
  const [query, setQuery] = useState('')
  // One short word per action outcome, plus the colour it renders in.
  // Deliberately terse: the point of the per-action matrix is that an
  // admin can scan a column of buttons and see at a glance which ones this
  // tier can press -- a sentence per row would defeat that. The longer
  // prose stays in the section's own (i) tooltip.
  const outcomeMeta = (outcome: ActionOutcome): { label: string; className: string } => {
    if (outcome === 'allow') {
      return { label: translate('perm_outcome_allow', 'Allowed'), className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' }
    }
    if (outcome === 'queue') {
      return { label: translate('perm_outcome_queue', 'Needs approval'), className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200' }
    }
    if (outcome === 'limited') {
      return { label: translate('perm_outcome_limited', 'Name only'), className: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200' }
    }
    return { label: translate('perm_outcome_block', 'Hidden'), className: 'bg-gray-200 text-gray-600 dark:bg-zinc-700 dark:text-gray-300' }
  }
  const perms = parsePermissionState(permissions)

  // Generic lookup for the mutual-exclusivity link declared on a
  // permission definition (see permissionDefinitions.ts's
  // `exclusiveWithTier` comment) -- keyed by the boolean permission's own
  // key so both toggle() and the render below can check it in one place.
  const exclusivityByKey: Record<string, PermissionDefinition> = {}
  for (const section of PERMISSION_SECTIONS) {
    for (const permission of section.permissions) {
      if (permission.exclusiveWithTier) exclusivityByKey[permission.key] = permission
    }
  }

  // Keys that are only a narrower ALTERNATE path into a section (declared
  // `exclusiveWithTier`) or only meaningful as that alternate path's own
  // sub-toggle (listed in its `alsoClearsKeys`) -- e.g. Products'
  // `products_image_only` and its five `show_*` fields. These are
  // deliberately excluded from the section's None/Full bulk-set and from
  // the None/Full/Custom mode calculation below: a real page-level
  // Full Access grant supersedes the narrower path entirely (same rule
  // `setTier` already enforces), and a role using only the narrow path is
  // a genuinely custom configuration, not "None" for the page.
  const subOrAltKeys = new Set<string>()
  for (const definition of Object.values(exclusivityByKey)) {
    subOrAltKeys.add(definition.key)
    for (const dependentKey of definition.alsoClearsKeys || []) subOrAltKeys.add(dependentKey)
  }

  // Local, ephemeral UI state only -- which sections the admin has
  // explicitly clicked "Custom" on, so the breakdown stays open while
  // they're mid-edit even if their choices happen to land back on a pure
  // None/Full combination. Never persisted; a genuinely mixed
  // (data-level "custom") section is always shown regardless of this set.
  const [customOpenSections, setCustomOpenSections] = useState<Set<string>>(new Set())

  const sectionDataMode = (section: PermissionSection): SectionMode => {
    const relevant = section.permissions.filter((permission) => !subOrAltKeys.has(permission.key))
    if (relevant.length === 0) return 'none'
    let allNone = true
    let allFull = true
    for (const permission of relevant) {
      const value = permissionDefinitionValue(permission, perms)
      const isNone = !value
      const isFull = permission.tier ? value === true : !!value
      if (!isNone) allNone = false
      if (!isFull) allFull = false
    }
    if (allNone) {
      const anyAltSet = section.permissions.some((permission) => subOrAltKeys.has(permission.key) && !!perms[permission.key])
      return anyAltSet ? 'custom' : 'none'
    }
    if (allFull) return 'full'
    return 'custom'
  }

  // Only offer the top None/Full/Custom picker for a section with more
  // than one key, or a single `tier: true` key (None/Review Required/Full
  // Access) -- a section with exactly one plain boolean key has nothing a
  // "Custom" breakdown could show beyond the None/Full toggle itself, so
  // showing a 3rd button there would be decorative, not functional.
  const sectionIsCustomizable = (section: PermissionSection): boolean => (
    section.permissions.length > 1 || section.permissions.some((permission) => permission.tier)
  )

  // A section's tiered key, when it has one, and the middle tier that key offers.
  const leadOf = (section: PermissionSection): { permission: PermissionDefinition; middle: 'view' | 'review' } | null => {
    const permission = section.permissions.find((entry) => entry.tier)
    return permission ? { permission, middle: permission.middleTier === 'view' ? 'view' : 'review' } : null
  }

  // The single answer to "what is this section set to": a middle tier on the section's
  // tiered key wins, otherwise the per-key aggregate (or Custom while the admin has the
  // breakdown open).
  const sectionModeOf = (section: PermissionSection): SectionMode => {
    const lead = leadOf(section)
    const leadTier = lead ? tierOf(perms[lead.permission.key]) : 'none'
    if (leadTier === 'review' || leadTier === 'view') return leadTier
    return customOpenSections.has(section.key) ? 'custom' : sectionDataMode(section)
  }

  // Actions an admin switched off while the tier still grants them: the "n off" the
  // chips show, so a section that reads Full is never silently narrower than it looks.
  const sectionOffCount = (section: PermissionSection): number => {
    let count = 0
    for (const permission of section.permissions) {
      const value = permissionDefinitionValue(permission, perms)
      const tier: Tier = permission.tier ? tierOf(value) : value ? 'full' : 'none'
      for (const action of actionsForKey(permission.key)) {
        if (action.follows || outcomeAt(action, tier) === 'block') continue
        if (isActionOverriddenOff(perms as Record<string, unknown>, permission.key, action.key)) count += 1
      }
    }
    return count
  }

  const sectionInfo: Record<string, { mode: SectionMode; off: number }> = {}
  for (const section of PERMISSION_SECTIONS) {
    if (section.key !== 'full_access') sectionInfo[section.key] = { mode: sectionModeOf(section), off: sectionOffCount(section) }
  }
  const modeChipClass = (mode: SectionMode): string => (
    mode === 'full'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      : mode === 'review'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
        : mode === 'view'
          ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200'
          : mode === 'custom'
            ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
            : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400'
  )

  const setSectionMode = (section: PermissionSection, mode: 'none' | 'full') => {
    const next: PermissionState = { ...perms }
    delete next.all
    for (const permission of section.permissions) {
      if (mode === 'none' || subOrAltKeys.has(permission.key)) {
        delete next[permission.key]
        continue
      }
      next[permission.key] = true
    }
    setCustomOpenSections((prev) => {
      if (!prev.has(section.key)) return prev
      const copy = new Set(prev)
      copy.delete(section.key)
      return copy
    })
    onChange(next)
  }

  const openSectionCustom = (sectionKey: string) => {
    setCustomOpenSections((prev) => {
      if (prev.has(sectionKey)) return prev
      const copy = new Set(prev)
      copy.add(sectionKey)
      return copy
    })
  }

  const toggle = (key: string) => {
    const exclusivity = exclusivityByKey[key]
    // Blocked, not just visually disabled: turning this ON while the
    // linked tier permission already grants real (Full or Review
    // Required) access is never a meaningful combination -- the tier
    // access already overrides it. The button below is also disabled in
    // this state so this is a belt-and-suspenders guard, not the only
    // thing stopping it.
    if (exclusivity && !perms[key] && tierOf(perms[exclusivity.exclusiveWithTier as string]) !== 'none') return

    const next: PermissionState = { ...perms }
    const definition = PERMISSION_SECTIONS.flatMap(section => section.permissions).find(permission => permission.key === key)
    if (definition?.defaultFromFull) next[key] = !permissionDefinitionValue(definition, perms)
    else if (next[key]) delete next[key]
    else next[key] = true

    if (key === 'all' && next.all) {
      onChange({ all: true })
      return
    }

    if (key !== 'all') delete next.all
    onChange(next)
  }

  // Switches ONE action off for this role, or hands it back to the tier.
  //
  // Stored as an explicit `false` under a `section:action` key rather than
  // by deleting anything, because absent and false must mean different
  // things here: absent is "the tier decides", false is "an admin decided".
  // Handing it back therefore DELETES the key rather than writing `true` --
  // otherwise a later tier change would be silently overridden by a stale
  // `true` nobody remembers setting.
  const toggleActionOverride = (permissionKey: string, actionKey: string) => {
    const toggled = toggleActionOverrideMap(perms, permissionKey, actionKey)
    if (toggled === perms) return
    const next: PermissionState = { ...toggled }
    delete next.all
    onChange(next)
  }

  // Tier-aware setter for a REVIEW_TIER_KEYS permission (see
  // permissionDefinitions.ts's `tier: true` flag). 'none' clears the key
  // entirely (same shape as an unchecked plain permission), 'full' sets a
  // plain `true`, and 'review' sets the literal string 'review' that
  // getPermissionTierFromMap()/getPermissionTier() (frontend and backend,
  // kept in sync) and lib/reviewGate.ts's maybeQueueForReview() branch on.
  const setTier = (key: string, tier: Tier) => {
    const next: PermissionState = { ...perms }
    if (tier === 'none') delete next[key]
    else if (tier === 'review') next[key] = 'review'
    else if (tier === 'view') next[key] = 'view'
    else next[key] = true

    delete next.all

    // Granting real (Full or Review Required) access to this tier
    // overrides -- and must never coexist with -- any boolean permission
    // elsewhere that declared `exclusiveWithTier: key`. Clear it (and
    // whatever it lists in `alsoClearsKeys`) the moment that happens.
    if (tier !== 'none') {
      for (const definition of Object.values(exclusivityByKey)) {
        if (definition.exclusiveWithTier !== key) continue
        delete next[definition.key]
        for (const dependentKey of definition.alsoClearsKeys || []) delete next[dependentKey]
      }
    }

    onChange(next)
  }

  // Per-action rows under a permission, read from utils/permissionActions.ts: the same table that gates
  // the real buttons at runtime, so the editor and the pages cannot drift apart. Three-way sections pass
  // their tier; on/off sections read on as Full and off as None. Each row shows one badge, for the
  // selected level only, to stay scannable.
  const renderActionRows = (permission: PermissionDefinition, tier: Tier, className: string) => {
    const actions = actionsForKey(permission.key)
    if (!actions.length) return null
    const effective = effectivePermissions({ permissions: perms })
    const needsList = (requirements: ActionRequirement[]) => requirements.map((requirement) => translate(requirement.tKey, requirement.label)).join(', ')
    return (
      <div className={`${className} rounded-lg border border-gray-200 bg-white/70 p-1.5 dark:border-zinc-700 dark:bg-zinc-900/40`}>
        <div className="mb-1 px-1 text-[11px] font-semibold leading-5 text-gray-400 dark:text-gray-500">
          {translate('perm_actions_heading', 'Buttons and actions on this page')}
        </div>
        {/* Each row is a control: the tier sets the baseline, clicking a row switches that single action off
            for this role, and clicking again hands it back. An override only removes what the tier grants
            and never adds (see permissionActions.ts), so a row the tier blocks is inert. */}
        {permission.key === 'sales' ? (
          <label className="mb-2 block px-1 text-xs text-gray-700 dark:text-gray-200">
            {translate('perm_sales_customer_mode', 'Edit customer mode')}
            <AppSelect
              className="mt-1 w-full"
              buttonClassName="input w-full text-xs"
              ariaLabel={translate('perm_sales_customer_mode', 'Edit customer mode')}
              disabled={tier !== 'full' || isActionOverriddenOff(perms as Record<string, unknown>, 'sales', 'customer')}
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
        <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {actions.filter((action) => !action.follows && (permission.key !== 'sales' || action.key !== 'customer_reassign')).map((action) => {
            const tierOutcome = outcomeAt(action, tier)
            const overriddenOff = isActionOverriddenOff(perms as Record<string, unknown>, permission.key, action.key)
            const missing = (requirements: ActionRequirement[] = []) => requirements.some((requirement) => !effective.meets(requirement.key))
            const rowUnavailable = overriddenOff || (tierOutcome !== 'block' && missing(action.requires))
            const meta = outcomeMeta(rowUnavailable ? 'block' : tierOutcome)
            const controls = actions.filter((entry) => entry.follows === action.key)
            const needs: Array<{ text: string; missing: boolean }> = []
            if (tierOutcome !== 'block') {
              if (action.requires?.length) {
                needs.push({ text: translate('perm_action_also_needs', 'Also needs: {list}').replace('{list}', needsList(action.requires)), missing: missing(action.requires) })
              }
              for (const control of controls) {
                if (outcomeAt(control, tier) === 'block' || !control.requires?.length) continue
                needs.push({
                  text: translate('perm_action_control_also_needs', '{control} also needs: {list}')
                    .replace('{control}', translate(control.tKey, control.label)).replace('{list}', needsList(control.requires)),
                  missing: missing(control.requires),
                })
              }
            }
            const viewLocked = tierOutcome !== 'block' && isViewImpliedByWrite(perms as Record<string, unknown>, permission.key, action.key)
            const canToggle = tierOutcome !== 'block' && !viewLocked
            const toolNotes: string[] = []
            if (canToggle && !overriddenOff && tier === 'review') {
              if (action.controlReview === 'block') toolNotes.push(translate('perm_action_review_tool_full', 'Under Review an edit waits for approval. The tool itself needs Full Access.'))
              for (const control of controls) {
                if (outcomeAt(control, tier) === 'block') toolNotes.push(translate('perm_action_control_needs_full', '{control} needs Full Access.').replace('{control}', translate(control.tKey, control.label)))
              }
            }
            const toolNote = toolNotes.join(' ')
            const toggleHint = overriddenOff
              ? translate('perm_action_restore', 'Switched off for this role. Click to hand it back to the tier.')
              : translate('perm_action_switch_off', 'Click to switch this single action off for this role.')
            return (
              <li key={action.key}>
                <button
                  type="button"
                  disabled={!canToggle}
                  aria-disabled={canToggle ? undefined : true}
                  aria-pressed={tierOutcome === 'block' ? undefined : !overriddenOff}
                  onClick={() => toggleActionOverride(permission.key, action.key)}
                  title={viewLocked
                    ? translate('perm_view_implied', 'On while Add or Edit is on.')
                    : canToggle
                    ? (toolNote ? `${toolNote} ${toggleHint}` : toggleHint)
                    : translate('perm_action_tier_blocked', 'Already blocked by the selected tier.')}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${TOUCH_TARGET} ${
                    canToggle
                      ? 'hover:bg-gray-100 dark:hover:bg-zinc-800'
                      : 'cursor-default opacity-60'
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block break-words text-xs ${overriddenOff ?'text-gray-400 line-through dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
                      {translate(action.tKey, action.label)}
                    </span>
                    {needs.map((need) => (
                      <span key={need.text} className={`block break-words text-[10px] ${need.missing ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-gray-500'}`}>
                        {need.text}
                      </span>
                    ))}
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                    {overriddenOff ? translate('perm_action_off', 'Off') : meta.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  const activeCount = Object.keys(perms).filter((key) => perms[key]).length
  const permissionsWord = translate('permissions', 'Permissions')

  // Both bulk buttons replace the whole draft, so each shows before -> after first.
  const requestAll = async () => {
    const confirmed = await askToConfirm({
      title: translate('perm_confirm_all_title', 'Give this role full administrator access?'),
      items: [{ label: permissionsWord, value: `${activeCount} → ${translate('perm_confirm_all_after', 'Full administrator')}` }],
      note: translate('perm_confirm_all_note', 'Administrators can use every section. Nothing is saved until you save the role.'),
      confirmLabel: translate('select_all', 'Select all'),
    })
    if (confirmed) onChange({ all: true })
  }
  const requestClear = async () => {
    const confirmed = await askToConfirm({
      title: translate('perm_confirm_clear_title', 'Clear every permission for this role?'),
      items: [{ label: permissionsWord, value: `${activeCount} → 0` }],
      note: translate('perm_confirm_clear_note', 'Nothing is saved until you save the role.'),
      confirmLabel: translate('deselect_all', 'Clear'),
      danger: true,
    })
    if (confirmed) onChange({})
  }

  const needle = query.trim().toLowerCase()
  const sectionMatches = (section: PermissionSection): boolean => {
    if (!needle) return true
    const names = [translate(section.tKey, section.label)]
    for (const permission of section.permissions) {
      names.push(labelFor(permission))
      for (const action of actionsForKey(permission.key)) names.push(translate(action.tKey, action.label))
    }
    return names.some((name) => name.toLowerCase().includes(needle))
  }
  const visibleSections = PERMISSION_SECTIONS.filter(sectionMatches)
  const jumpToSection = (key: string) => {
    document.getElementById(`perm-section-${key}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  const glance = (['full', 'review', 'view', 'custom', 'none'] as const)
    .map((mode) => ({ mode, count: Object.values(sectionInfo).filter((info) => info.mode === mode).length }))
    .filter((entry) => entry.count > 0)
  const offTotal = Object.values(sectionInfo).reduce((sum, info) => sum + info.off, 0)
  const nOff = (count: number): string => translate('perm_n_off', '{n} off').replace('{n}', String(count))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm text-gray-500">
          {activeCount} {permissionsWord}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={requestAll} disabled={!!perms.all} className={`rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-900/30 ${TOUCH_TARGET}`}>
            {translate('select_all', 'Select all')}
          </button>
          <button type="button" onClick={requestClear} disabled={activeCount === 0} className={`rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950/30 ${TOUCH_TARGET}`}>
            {translate('deselect_all', 'Clear')}
          </button>
        </div>
      </div>

      {/* The whole role in one line before any scrolling. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span className="font-semibold leading-6">{translate('perm_role_summary', 'This role at a glance:')}</span>
        {glance.map((entry) => (
          <span key={entry.mode} data-perm-chip="glance" className={`rounded-full px-2 py-0.5 font-semibold leading-5 ${modeChipClass(entry.mode)}`}>{entry.count} {modeLabel(entry.mode)}</span>
        ))}
        {offTotal > 0 ? <span data-perm-chip="glance-off" className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold leading-5 text-gray-600 dark:bg-zinc-800 dark:text-gray-300">{nOff(offTotal)}</span> : null}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="relative block w-40 flex-shrink-0 sm:w-52">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate('perm_find', 'Find permission')}
            aria-label={translate('perm_find', 'Find permission')}
            className={`input h-8 w-full pl-7 text-xs ${TOUCH_TARGET}`}
          />
        </label>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5" aria-label={translate('perm_jump_to', 'Jump to section')}>
          {visibleSections.filter((section) => section.key !== 'full_access').map((section) => (
            <button
              type="button"
              key={section.key}
              onClick={() => jumpToSection(section.key)}
              className={`flex-shrink-0 whitespace-nowrap rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs leading-5 text-gray-600 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800 ${TOUCH_TARGET}`}
            >
              {translate(section.tKey, section.label)}
            </button>
          ))}
        </nav>
      </div>
      {confirmDialog}
      {visibleSections.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{translate('perm_find_none', 'No matching permission')}</p>
      ) : null}
      <div className="space-y-3">
        {visibleSections.map((section) => {
          // The master "Full Administrator Access" section keeps its
          // original single-toggle behavior -- a None/Full/Custom picker
          // wrapping the one all-or-nothing override key wouldn't add
          // anything.
          const isMasterSection = section.key === 'full_access'
          const customizable = !isMasterSection && sectionIsCustomizable(section)
          const info = isMasterSection ? null : sectionInfo[section.key]
          const effectiveMode: SectionMode = info ? info.mode : 'full'
          const lead = leadOf(section)
          const showBreakdown = isMasterSection || !customizable || sectionDataMode(section) === 'custom' || customOpenSections.has(section.key)
          const pickerOptions: Array<{ value: SectionMode; label: string }> = [
            { value: 'none', label: modeLabel('none') },
            ...(lead ? [{ value: lead.middle as SectionMode, label: modeLabel(lead.middle) }] : []),
            { value: 'full', label: modeLabel('full') },
            { value: 'custom', label: modeLabel('custom') },
          ]
          const pickMode = (mode: SectionMode) => {
            if (mode === 'custom') openSectionCustom(section.key)
            else if (mode === 'review' || mode === 'view') setTier(lead?.permission.key as string, mode)
            else setSectionMode(section, mode === 'full' ? 'full' : 'none')
          }
          const sectionName = translate(section.tKey, section.label)
          return (
          <section key={section.key} id={`perm-section-${section.key}`} className="scroll-mt-2 rounded-2xl border border-gray-200 bg-gray-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            {/* Header on one row: the description lives in the info hint, and a live state chip
                makes the whole role readable top to bottom without opening a section. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <InfoHint
                  className="flex-shrink-0"
                  label={sectionName}
                  text={translate(`${section.tKey}_desc`, section.description)}
                />
                <span className="min-w-0 break-words text-sm font-semibold leading-6 text-gray-700 dark:text-gray-200">
                  {sectionName}
                </span>
                {info ? (
                  <span data-perm-chip="mode" className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 ${modeChipClass(info.mode)}`}>
                    {modeLabel(info.mode)}
                  </span>
                ) : null}
                {info && info.off > 0 ? (
                  <span data-perm-chip="off" className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold leading-5 text-gray-600 dark:bg-zinc-800 dark:text-gray-300">
                    {nOff(info.off)}
                  </span>
                ) : null}
              </div>
              {customizable ? (
                <div className="flex max-w-full overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700" role="group" aria-label={translate('perm_access_level', '{section} access').replace('{section}', sectionName)}>
                  {pickerOptions.map((option, index) => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => pickMode(option.value)}
                      aria-pressed={effectiveMode === option.value}
                      className={`min-w-[3.75rem] px-2.5 py-1.5 text-sm font-semibold leading-5 transition-colors ${TOUCH_TARGET} ${index > 0 ? 'border-l border-gray-200 dark:border-zinc-700' : ''} ${
                        effectiveMode === option.value
                          ? option.value === 'custom'
                            ? 'bg-slate-600 text-white'
                            : option.value === 'full'
                              ? 'bg-blue-600 text-white'
                              : option.value === 'review'
                                ? 'bg-amber-500 text-white'
                                : option.value === 'view'
                                  ? 'bg-teal-600 text-white'
                                  : 'bg-gray-400 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {!showBreakdown ? null : (
            <div className="space-y-1.5">
              {section.permissions.map((permission) => {
                // Nine "Show ..." rows and eight image-only rows collapse to one chip row each,
                // drawn where the group's first field sits.
                const groupPrefix = fieldGroupPrefix(permission.key)
                if (groupPrefix) {
                  const groupFields = section.permissions.filter((entry) => entry.key.startsWith(groupPrefix))
                  if (groupFields[0]?.key !== permission.key) return null
                  return (
                    <PermissionFieldChips
                      key={groupPrefix}
                      heading={translate('perm_fields_shown', 'Fields shown')}
                      fields={groupFields.map((entry) => ({ key: entry.key, label: labelFor(entry), active: !!permissionDefinitionValue(entry, perms) }))}
                      onToggle={toggle}
                    />
                  )
                }

                if (permission.tier) {
                  const tier = tierOf(perms[permission.key])
                  // The tier itself is picked in the section header; this row keeps the section's
                  // one explanation (the info hint) and the action switches that follow from it.
                  return (
                    <div
                      key={permission.key}
                      className={`w-full rounded-xl border p-2.5 text-left transition-colors ${
                        tier !== 'none'
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                          : 'border-transparent bg-white/70 dark:bg-zinc-900/40'
                      }`}
                    >
                      <div className="flex w-full flex-wrap items-center gap-2">
                        <span className={`inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium leading-6 ${tier !== 'none' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                          {/* The info icon leads the label it explains, as in MergeDuplicatesReviewModal.tsx and BulkImportModal.tsx. */}
                          <InfoHint
                            className="flex-shrink-0"
                            label={labelFor(permission)}
                            text={reviewDescriptionFor(permission)}
                          />
                          {labelFor(permission)}
                        </span>
                        <SensitiveMark sensitivity={permission.sensitivity} label={sensitivityLabel(permission.sensitivity)} />
                      </div>
                      {renderActionRows(permission, tier, 'mt-2')}
                    </div>
                  )
                }

                const active = !!permissionDefinitionValue(permission, perms)
                const exclusivity = permission.exclusiveWithTier
                const blockedByTier = !!exclusivity && !active && tierOf(perms[exclusivity]) !== 'none'
                const blockedTierLabel = blockedByTier ? modeLabel(tierOf(perms[exclusivity as string]) as SectionMode) : ''
                const toggleButton = (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => (permission.key === 'all' && !active ? requestAll() : toggle(permission.key))}
                    disabled={blockedByTier}
                    title={blockedByTier ? translate('perm_overridden_by_tier', `Already covered by this role's ${blockedTierLabel} Products access -- turn that down to None first to use this instead.`) : undefined}
                    aria-disabled={blockedByTier}
                    className={`flex w-full select-none items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${TOUCH_TARGET} ${
                      blockedByTier
                        ? 'cursor-not-allowed border-transparent bg-gray-50 opacity-50 dark:bg-zinc-900/20'
                        : 'cursor-pointer'
                    } ${
                      active
                        ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                        : blockedByTier ? '' : 'border-transparent bg-white/70 hover:bg-gray-50 dark:bg-zinc-900/40 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`relative inline-block h-5 w-9 flex-shrink-0 rounded-full transition-colors ${active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-zinc-600'}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? 'left-[1.1rem]' : 'left-0.5'}`} />
                    </span>
                    <span className={`min-w-0 flex-1 text-sm font-medium leading-6 ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                      {labelFor(permission)}
                      {blockedByTier ? (
                        <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                          {translate('perm_overridden_by_tier_badge', `Overridden by ${blockedTierLabel} Products access`)}
                        </span>
                      ) : null}
                    </span>
                    <SensitiveMark sensitivity={permission.sensitivity} label={sensitivityLabel(permission.sensitivity)} />
                  </button>
                )
                // An on/off switch reads as Full when on and None when off.
                return (
                  <Fragment key={permission.key}>
                    {toggleButton}
                    {renderActionRows(permission, active ? 'full' : 'none', 'ml-4')}
                  </Fragment>
                )
              })}
            </div>
            )}
          </section>
          )
        })}
      </div>
    </div>
  )
}

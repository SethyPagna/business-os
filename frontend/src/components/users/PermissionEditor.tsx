import { useState } from 'react'
import InfoHint from '../shared/InfoHint.tsx'
import { PERMISSION_SECTIONS, type PermissionDefinition, type PermissionSection, type PermissionSensitivity } from './permissionDefinitions'
import { REVIEW_TIER_KEYS, type PermissionValue } from '../../utils/permissions.ts'
import { actionOverrideKey, actionsForKey, isActionOverriddenOff, outcomeAt, type ActionOutcome } from '../../utils/permissionActions.ts'

type PermissionState = Record<string, PermissionValue>
type Tier = 'full' | 'review' | 'none'
// Section-level picker added per explicit user request ("page permission
// none, full access, and custom at top -- choose custom to allow check
// the breakdown permission below"). This is deliberately a UI-only
// aggregation over the SAME per-key data this editor already reads/writes
// -- no new permission keys, no new storage shape, no backend change.
// 'none'/'full' bulk-set every key already defined for that section (see
// setSectionMode below); 'custom' just reveals the section's existing
// per-key controls (the tier 3-way toggle and/or individual checkboxes)
// that used to always be shown -- for a section with only one permission
// key, Custom therefore shows exactly the one control that was always
// there, nothing invented. Deeper per-action/per-button/per-stat
// breakdown than the keys already defined in permissionDefinitions.ts
// does not exist yet for most pages -- adding that is a separate,
// larger backend-and-frontend wiring job per page (see progress.md).
type SectionMode = 'none' | 'full' | 'custom'

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
  let value: unknown = permissions
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value || '{}')
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.entries(value as Record<string, unknown>).reduce<PermissionState>((acc, [key, raw]) => {
    acc[key] = raw === 'review' && REVIEW_TIER_KEYS.has(key) ? 'review' : Boolean(raw)
    return acc
  }, {})
}

function tierOf(value: PermissionValue | undefined): Tier {
  if (value === 'review') return 'review'
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
      || translate('review_required_generic_desc', 'Some actions in this section require admin approval under Review Required.')
    return permission.reviewTKey ? translate(permission.reviewTKey, fallback) : fallback
  }
  const sensitivityLabel = (value: PermissionSensitivity): string => {
    if (value === 'critical') return translate('permission_sensitive_critical', 'Sensitive')
    if (value === 'high') return translate('permission_sensitive_high', 'Review')
    return translate('permission_sensitive_normal', 'Standard')
  }
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
      const value = perms[permission.key]
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

  // 7.2: the at-a-glance read. One state per section -- what an admin
  // scanning the list needs before opening anything -- computed from the
  // SAME per-key data the controls edit, purely presentational.
  const sectionGlance = (section: PermissionSection): { label: string; tone: 'full' | 'none' | 'partial' } => {
    const keys = section.permissions
    const granted = keys.filter((permission) => tierOf(perms[permission.key]) !== 'none').length
    const reviewCount = keys.filter((permission) => tierOf(perms[permission.key]) === 'review').length
    if (granted === 0) return { label: translate('none', 'None'), tone: 'none' }
    if (granted === keys.length && reviewCount === 0) return { label: translate('label_full_access', 'Full Access'), tone: 'full' }
    if (reviewCount > 0) return { label: translate('review_required', 'Partial Access'), tone: 'partial' }
    return { label: `${granted}/${keys.length}`, tone: 'partial' }
  }
  const glanceChipClass = (tone: 'full' | 'none' | 'partial'): string => (
    tone === 'full'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      : tone === 'partial'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
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
    if (next[key]) delete next[key]
    else next[key] = true

    if (key === 'all' && next.all) {
      onChange({ all: true })
      return
    }

    if (key !== 'all') delete next.all
    onChange(next)
  }

  // Tier-aware setter for a REVIEW_TIER_KEYS permission (see
  // permissionDefinitions.ts's `tier: true` flag). 'none' clears the key
  // entirely (same shape as an unchecked plain permission), 'full' sets a
  // plain `true` (identical to the old checkbox-on state, so nothing about
  // a Full Access grant changes for keys that already worked that way),
  // and 'review' sets the literal string 'review' that
  // getPermissionTierFromMap()/getPermissionTier() (frontend and backend,
  // kept in sync) and lib/reviewGate.ts's maybeQueueForReview() branch on.
  // Switches ONE action off for this role, or hands it back to the tier.
  //
  // Stored as an explicit `false` under a `section:action` key rather than
  // by deleting anything, because absent and false must mean different
  // things here: absent is "the tier decides", false is "an admin decided".
  // Handing it back therefore DELETES the key rather than writing `true` --
  // otherwise a later tier change would be silently overridden by a stale
  // `true` nobody remembers setting.
  const toggleActionOverride = (permissionKey: string, actionKey: string) => {
    const overrideKey = actionOverrideKey(permissionKey, actionKey)
    const next: PermissionState = { ...perms }
    if (next[overrideKey] === false) delete next[overrideKey]
    else next[overrideKey] = false
    delete next.all
    onChange(next)
  }

  const setTier = (key: string, tier: Tier) => {
    const next: PermissionState = { ...perms }
    if (tier === 'none') delete next[key]
    else if (tier === 'review') next[key] = 'review'
    else next[key] = true

    delete next.all

    // Granting real (Full or Review Required) access to this tier
    // overrides -- and is never allowed to coexist with -- any boolean
    // permission elsewhere that declared `exclusiveWithTier: key`. Clear
    // it (and whatever it lists in `alsoClearsKeys`) the moment that
    // happens, per explicit user request that the two never both be set.
    if (tier !== 'none') {
      for (const definition of Object.values(exclusivityByKey)) {
        if (definition.exclusiveWithTier !== key) continue
        delete next[definition.key]
        for (const dependentKey of definition.alsoClearsKeys || []) delete next[dependentKey]
      }
    }

    onChange(next)
  }

  const activeCount = Object.keys(perms).filter((key) => perms[key]).length

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {activeCount} {translate('permissions', activeCount === 1 ? 'permission' : 'permissions')}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange({ all: true })} className="text-xs text-blue-500 hover:underline">
            {translate('select_all', 'All')}
          </button>
          <span className="text-gray-300">|</span>
          <button type="button" onClick={() => onChange({})} className="text-xs text-red-500 hover:underline">
            {translate('deselect_all', 'Clear')}
          </button>
        </div>
      </div>

      {/* 7.2: the whole role in one line before any scrolling. */}
      {(() => {
        const scanned = PERMISSION_SECTIONS.filter((section) => section.key !== 'full_access')
        const counts = { full: 0, none: 0, partial: 0 }
        for (const section of scanned) counts[sectionGlance(section).tone] += 1
        return (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold">{translate('perm_role_summary', 'This role at a glance:')}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${glanceChipClass('full')}`}>{counts.full} {translate('label_full_access', 'Full Access')}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${glanceChipClass('partial')}`}>{counts.partial} {translate('permission_custom', 'Custom')}</span>
            <span className={`rounded-full px-2 py-0.5 font-semibold ${glanceChipClass('none')}`}>{counts.none} {translate('none', 'None')}</span>
          </div>
        )
      })()}
      <div className="space-y-3">
        {PERMISSION_SECTIONS.map((section) => {
          // The master "Full Administrator Access" section keeps its
          // original single-toggle behavior -- a None/Full/Custom picker
          // wrapping the one all-or-nothing override key wouldn't add
          // anything.
          const isMasterSection = section.key === 'full_access'
          const customizable = !isMasterSection && sectionIsCustomizable(section)
          const dataMode = isMasterSection ? 'full' : sectionDataMode(section)
          const effectiveMode: SectionMode = dataMode === 'custom' || customOpenSections.has(section.key) ? 'custom' : dataMode
          const showBreakdown = isMasterSection || !customizable || effectiveMode === 'custom'
          return (
          <section key={section.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            {/* 7.2: header on ONE row -- the description lives in the
                info hint instead of an always-on paragraph under every
                title, and a live state chip makes the whole role readable
                top-to-bottom without opening a single section. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <InfoHint
                  className="flex-shrink-0"
                  label={translate(section.tKey, section.label)}
                  text={translate(`${section.tKey}_desc`, section.description)}
                />
                <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {translate(section.tKey, section.label)}
                </span>
                {!isMasterSection ? (() => {
                  const glance = sectionGlance(section)
                  return (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${glanceChipClass(glance.tone)}`}>
                      {glance.label}
                    </span>
                  )
                })() : null}
              </div>
              {customizable ? (
                <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700" role="group" aria-label={`${translate(section.tKey, section.label)} access mode`}>
                  {([
                    { value: 'none' as const, label: translate('none', 'None') },
                    { value: 'full' as const, label: translate('label_full_access', 'Full Access') },
                    { value: 'custom' as const, label: translate('permission_custom', 'Custom') },
                  ]).map((option, index) => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => (option.value === 'custom' ? openSectionCustom(section.key) : setSectionMode(section, option.value))}
                      aria-pressed={effectiveMode === option.value}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${index > 0 ? 'border-l border-gray-200 dark:border-zinc-700' : ''} ${
                        effectiveMode === option.value
                          ? option.value === 'custom'
                            ? 'bg-slate-600 text-white'
                            : option.value === 'full'
                              ? 'bg-blue-600 text-white'
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
                const sensitive = permission.sensitivity === 'critical' || permission.sensitivity === 'high'

                if (permission.tier) {
                  const tier = tierOf(perms[permission.key])
                  const tierOptions: { value: Tier; label: string }[] = [
                    { value: 'none', label: translate('none', 'None') },
                    { value: 'review', label: translate('review_required', 'Partial Access') },
                    { value: 'full', label: translate('label_full_access', 'Full Access') },
                  ]
                  return (
                    <div
                      key={permission.key}
                      className={`w-full rounded-xl border p-2.5 text-left transition-colors ${
                        tier !== 'none'
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                          : 'border-transparent bg-white/70 dark:bg-zinc-900/40'
                      }`}
                    >
                      <div className="flex w-full flex-wrap items-center gap-3">
                        <span className={`inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium ${tier !== 'none' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                          {/* Part 207: info icon moved before the label it
                              explains, matching MergeDuplicatesReviewModal.tsx's
                              and BulkImportModal.tsx's "Information" toggle --
                              the two call sites in the app that already put
                              Info first rather than last. */}
                          <InfoHint
                            className="flex-shrink-0"
                            label={labelFor(permission)}
                            text={reviewDescriptionFor(permission)}
                          />
                          {labelFor(permission)}
                        </span>
                        {sensitive ? (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            permission.sensitivity === 'critical'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                          }`}>
                            {sensitivityLabel(permission.sensitivity)}
                          </span>
                        ) : null}
                        <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-700" role="group" aria-label={labelFor(permission)}>
                          {tierOptions.map((option, index) => (
                            <button
                              type="button"
                              key={option.value}
                              onClick={() => setTier(permission.key, option.value)}
                              aria-pressed={tier === option.value}
                              className={`min-w-[5.5rem] px-3 py-2 text-sm font-semibold transition-colors ${index > 0 ? 'border-l border-gray-200 dark:border-zinc-700' : ''} ${
                                tier === option.value
                                  ? option.value === 'review'
                                    ? 'bg-amber-500 text-white'
                                    : option.value === 'full'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-gray-400 text-white'
                                  : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Explicit request: under Review Required, show what
                          that tier actually includes inline, not just via
                          the (i) tooltip above -- same text, just always
                          visible once this tier is picked so an admin
                          reviewing an existing role's Custom breakdown
                          doesn't have to hover/click to understand the
                          scope. */}
                      {tier === 'review' ? (
                        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                          {reviewDescriptionFor(permission)}
                        </p>
                      ) : null}
                      {/* Per-action breakdown -- "show the selected
                          permissions for buttons/actions like edit,
                          adjust, stock, discounts, import, export,
                          delete". Reads utils/permissionActions.ts, the
                          same table that gates the real buttons at
                          runtime, so what an admin is shown here and what
                          the page actually does cannot drift apart. Only
                          the CURRENTLY selected tier's column is shown
                          (one badge per row, not a 3-column grid) to keep
                          it scannable rather than a wall of text. */}
                      {actionsForKey(permission.key).length ? (
                        <div className="mt-2 rounded-lg border border-gray-200 bg-white/70 p-1.5 dark:border-zinc-700 dark:bg-zinc-900/40">
                          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {translate('perm_actions_heading', 'Buttons and actions on this page')}
                          </div>
                          {/* Each row is now a real control, not a readout.
                              The tier sets the baseline; clicking a row
                              switches that single action OFF for this role,
                              and clicking again hands it back to the tier.
                              Deliberately one-way: an override can only
                              REMOVE what the tier granted, never add what it
                              withheld -- see permissionActions.ts for why
                              that is what makes it safe to enforce. A row
                              the tier already blocks is therefore inert. */}
                          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                            {actionsForKey(permission.key).map((action) => {
                              const tierOutcome = outcomeAt(action, tier)
                              const overriddenOff = isActionOverriddenOff(perms as Record<string, unknown>, permission.key, action.key)
                              const meta = outcomeMeta(overriddenOff ? 'block' : tierOutcome)
                              const canToggle = tierOutcome !== 'block'
                              return (
                                <li key={action.key}>
                                  <button
                                    type="button"
                                    disabled={!canToggle}
                                    aria-pressed={!overriddenOff}
                                    onClick={() => toggleActionOverride(permission.key, action.key)}
                                    title={canToggle
                                      ? (overriddenOff
                                        ? translate('perm_action_restore', 'Switched off for this role. Click to hand it back to the tier.')
                                        : translate('perm_action_switch_off', 'Click to switch this single action off for this role.'))
                                      : translate('perm_action_tier_blocked', 'Already blocked by the selected tier.')}
                                    className={`flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left transition-colors ${
                                      canToggle
                                        ? 'hover:bg-gray-100 dark:hover:bg-zinc-800'
                                        : 'cursor-default opacity-60'
                                    }`}
                                  >
                                    <span className={`min-w-0 truncate text-xs ${overriddenOff ? 'text-gray-400 line-through dark:text-gray-500' : 'text-gray-600 dark:text-gray-300'}`}>
                                      {translate(action.tKey, action.label)}
                                    </span>
                                    <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                                      {overriddenOff ? translate('perm_action_off', 'Off') : meta.label}
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                          {/* The one action that needs a second grant even
                              at Full Access -- called out rather than left
                              to look like a plain "Allowed" row. */}
                          {actionsForKey(permission.key).some((action) => action.requiresKey && outcomeAt(action, tier) !== 'block') ? (
                            <p className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500">
                              {translate('perm_actions_requires_extra', 'Some actions above also need their own separate permission, listed in this section.')}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                }

                const active = !!perms[permission.key]
                const exclusivity = permission.exclusiveWithTier
                const blockedByTier = !!exclusivity && !active && tierOf(perms[exclusivity]) !== 'none'
                const blockedTierLabel = blockedByTier
                  ? (tierOf(perms[exclusivity as string]) === 'review' ? translate('review_required', 'Partial Access') : translate('label_full_access', 'Full Access'))
                  : ''
                return (
                  <button
                    type="button"
                    key={permission.key}
                    onClick={() => toggle(permission.key)}
                    disabled={blockedByTier}
                    title={blockedByTier ? translate('perm_overridden_by_tier', `Already covered by this role's ${blockedTierLabel} Products access -- turn that down to None first to use this instead.`) : undefined}
                    aria-disabled={blockedByTier}
                    className={`flex w-full select-none items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      blockedByTier
                        ? 'cursor-not-allowed border-transparent bg-gray-50 opacity-50 dark:bg-zinc-900/20'
                        : 'cursor-pointer'
                    } ${
                      active
                        ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                        : blockedByTier ? '' : 'border-transparent bg-white/70 hover:bg-gray-50 dark:bg-zinc-900/40 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                        active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {active ? <span className="text-[10px] font-bold text-white">OK</span> : null}
                    </div>
                    <span className={`min-w-0 flex-1 text-sm font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                      {labelFor(permission)}
                      {blockedByTier ? (
                        <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                          {translate('perm_overridden_by_tier_badge', `Overridden by ${blockedTierLabel} Products access`)}
                        </span>
                      ) : null}
                    </span>
                    {sensitive ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        permission.sensitivity === 'critical'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                      }`}>
                        {sensitivityLabel(permission.sensitivity)}
                      </span>
                    ) : null}
                  </button>
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

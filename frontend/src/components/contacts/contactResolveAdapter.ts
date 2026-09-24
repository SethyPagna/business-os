import { createClientRequestId } from '../../api/requestIds.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { formatPhoneInputValue } from '../../utils/phoneInput.ts'
import type { ResolveAdapter, ResolveAfterItem, ResolveChange, ResolveDraft } from '../shared/ResolveModal.tsx'
import type { ResolveCell, ResolveChoice, ResolveColumn, ResolveOption, ResolveRow } from '../shared/ResolveGrid.tsx'
import {
  chooseBulkMergeKeeper,
  CONTACT_MERGE_MAX_RECORDS,
  mergeContacts,
  readContactRecords,
  type ContactDuplicateCluster,
  type ContactDuplicateClusterEntry,
  type ContactDuplicateEntryHistory,
  type ContactMergeChoice,
  type ContactMergeOutcome,
  type ContactMergeRequest,
  type ContactTableKind,
} from './contactDuplicates.ts'
import { buildContactOptionSummary, parseStoredContactOptions } from './contactOptionUtils.ts'

// The contacts side of the one conflict resolver (R12). A duplicate group opens
// in the shared ResolveModal: one column per record, one row per field. Resolve
// sends ONE merge request (contactDuplicates.ts mergeContacts) that names every
// field's value explicitly, so what the confirm shows is what the server
// writes. Contact merges have no undo (council D9).
//
// Rows (plan-resolver-grid.md §2B):
//   Record kept  chooseBulkMergeKeeper, the same rule Merge selected uses.
//   Each field   the kept record's value when it has one, else the first
//                record's that does (the server's own default).
//   Membership   D6: one number stays, every other one is added to Notes.
//                With two or more numbers the row is required; it starts
//                answered with the kept record's number (else the first
//                holder's), so the merge never stops to ask.
//   Storefront   D7: the account of the membership number that stays stays
//                linked (the account with that id, else the record the
//                number came from), else the kept record's, else the first.
//                "Most recently used" would need portal_sessions.last_seen_at,
//                which no endpoint exposes. The other accounts are unlinked
//                and the confirm names each of them.
//   History      what moves onto the kept record.

type Translate = (key: string) => string | undefined
type ContactRow = Record<string, unknown>

export type ContactResolveData = {
  table: ContactTableKind
  /** Every record of the group in id order: one grid column each. */
  ids: number[]
  /** The records as read now; a missing id was deleted or merged elsewhere. */
  records: Map<number, ContactRow>
  /** What the duplicate list showed per record: its name and history counts. */
  listed: Map<number, Pick<ContactDuplicateClusterEntry, 'name' | 'history'>>
}

export type ContactResolveToken = {
  request: ContactMergeRequest
  /** Rows whose Final differs from the kept record: shown again from the server's answer. */
  changed: Array<{ key: string; label: string }>
}

export type ContactResolveOptions = {
  table: ContactTableKind
  cluster: ContactDuplicateCluster
  t: Translate
  /** Asked again right before writing: permissions can change while the grid is open. */
  canMerge: () => boolean
  /** A merge step committed. The host's list is out of date even if a later step fails. */
  onWritten?: () => void
}

type FieldKind = 'text' | 'phone' | 'options' | 'notes' | 'gender' | 'date'
type FieldSpec = { column: string; label: [key: string, fallback: string]; kind: FieldKind }

const FIELDS: Record<string, FieldSpec> = {
  name: { column: 'name', label: ['name', 'Name'], kind: 'text' },
  phone: { column: 'phone', label: ['phone', 'Phone'], kind: 'phone' },
  email: { column: 'email', label: ['email', 'Email'], kind: 'text' },
  company: { column: 'company', label: ['company', 'Company'], kind: 'text' },
  contact_person: { column: 'contact_person', label: ['contact_person', 'Contact Person'], kind: 'text' },
  area: { column: 'area', label: ['area_zone', 'Area / Zone'], kind: 'text' },
  address: { column: 'address', label: ['resolve_contact_options', 'Contact options'], kind: 'options' },
  gender: { column: 'gender', label: ['gender', 'Gender'], kind: 'gender' },
  notes: { column: 'notes', label: ['notes', 'Notes'], kind: 'notes' },
  created_at: { column: 'created_at', label: ['col_added', 'Added'], kind: 'date' },
}

// Every column each table merges (routes/contacts.ts), membership_number
// aside, in grid order. Customers show their membership and storefront rows
// right after Name and Phone; Notes comes after them because the numbers that
// do not stay are appended to it.
const TABLE_FIELDS: Record<ContactTableKind, string[]> = {
  customers: ['name', 'phone', 'email', 'address', 'gender', 'notes', 'created_at'],
  suppliers: ['name', 'phone', 'email', 'company', 'contact_person', 'address', 'gender', 'notes'],
  delivery_contacts: ['name', 'phone', 'area', 'address', 'gender', 'notes'],
}

// The same line the server writes (cloudflare/src/lib/contactMerge.ts).
const MEMBERSHIP_NOTE_PREFIX = 'Merged membership: '

// Refusals that mean the records moved under the review: read them again.
const STALE_CODES = new Set(['contact_merge_conflict', 'membership_choice_required', 'portal_choice_required', 'anonymous_customer_immutable'])

function tr(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

// The server's blank: a field nobody chose takes the first value that is not this.
const isBlank = (value: unknown): boolean => value === null || value === undefined || value === ''

function membershipOf(row: ContactRow | null | undefined): string | null {
  const value = row?.membership_number
  return value === null || value === undefined || String(value).trim() === '' ? null : String(value)
}

function accountOf(row: ContactRow | null | undefined): string | null {
  const account = row?.portal_account
  if (!account || typeof account !== 'object') return null
  return String((account as { membershipId?: unknown }).membershipId ?? '').trim()
}

function recordLabel(name: unknown, id: number): string {
  const text = String(name ?? '').trim()
  return text ? `${text} (#${id})` : `#${id}`
}

/** The linked-history chips a duplicate record shows (sales, returns, points). */
export function contactHistoryParts(history: ContactDuplicateEntryHistory | null | undefined, t: Translate): string[] {
  if (!history) return []
  const parts: string[] = []
  if (history.salesCount > 0) parts.push(`${history.salesCount} ${tr(t, 'sales', 'Sales')}`)
  if (history.returnsCount > 0) parts.push(`${history.returnsCount} ${tr(t, 'returns', 'Returns')}`)
  if ((history.pointsBalance ?? 0) > 0) parts.push(`${history.pointsBalance} ${tr(t, 'points', 'points')}`)
  return parts
}

function genderOptions(t: Translate): ResolveOption[] {
  return [
    { id: 'male', label: tr(t, 'male', 'Male') },
    { id: 'female', label: tr(t, 'female', 'Female') },
    { id: 'other', label: tr(t, 'other', 'Other') },
    { id: 'unspecified', label: tr(t, 'unspecified', 'Unspecified') },
  ]
}

function fieldText(spec: FieldSpec, value: unknown, table: ContactTableKind, t: Translate): string {
  if (spec.kind === 'options') {
    const mode = table === 'delivery_contacts' ? 'area' : 'address'
    const options = parseStoredContactOptions(value, { legacyField: mode })
    return options.length ? buildContactOptionSummary(options, { mode }).split('\n').join(' · ') : ''
  }
  if (spec.kind === 'gender') {
    const raw = String(value ?? '').trim()
    return genderOptions(t).find((option) => option.id === (raw.toLowerCase() || 'unspecified'))?.label ?? raw
  }
  if (spec.kind === 'date') return isBlank(value) ? '' : fmtDateTime24(String(value))
  if (spec.kind === 'notes') return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' · ')
  return String(value ?? '').trim()
}

// Appends the membership numbers that do not stay, exactly as the server does.
function notesWithMembership(notes: unknown, others: string[]): unknown {
  const text = String(notes ?? '')
  const present = new Set(text.split(/\r?\n/))
  const lines = others.map((number) => `${MEMBERSHIP_NOTE_PREFIX}${number}`).filter((line) => !present.has(line))
  if (!lines.length) return notes
  return text.trim() ? `${text}\n${lines.join('\n')}` : lines.join('\n')
}

type FieldPick = { source: number } | { custom: string | null }

type Context = {
  data: ContactResolveData
  draft: ResolveDraft
  /** The records merged in, in column order. */
  included: number[]
  keeperId: number | null
}

const recordOf = (ctx: Context, id: number): ContactRow | undefined => ctx.data.records.get(id)
const valueOf = (ctx: Context, id: number, column: string): unknown => recordOf(ctx, id)?.[column]
const sourceOf = (choice: ResolveChoice | undefined): number => (choice && 'source' in choice ? Number(choice.source) : Number.NaN)

function keeperEntry(data: ContactResolveData, id: number): ContactDuplicateClusterEntry {
  const row = data.records.get(id)
  return { id, name: row?.name == null ? null : String(row.name), phone: row?.phone == null ? null : String(row.phone), membershipNumber: membershipOf(row) }
}

function contextOf(data: ContactResolveData, draft: ResolveDraft): Context {
  const included = data.ids.filter((id) => data.records.has(id) && draft.columns[String(id)]?.disposition !== 'separate')
  const picked = sourceOf(draft.selection.record)
  const keeperId = included.includes(picked)
    ? picked
    : chooseBulkMergeKeeper(included.map((id) => keeperEntry(data, id)))?.id ?? included[0] ?? null
  return { data, draft, included, keeperId }
}

function fieldPick(ctx: Context, spec: FieldSpec): FieldPick | null {
  const { keeperId, included } = ctx
  if (keeperId === null) return null
  const explicit = ctx.draft.selection[spec.column]
  if (explicit && 'source' in explicit && included.includes(Number(explicit.source))) return { source: Number(explicit.source) }
  if (explicit && 'custom' in explicit && (spec.kind === 'text' || spec.kind === 'phone')) return { custom: explicit.custom }
  if (explicit && 'option' in explicit && spec.kind === 'gender') {
    return { custom: explicit.option === 'unspecified' ? null : explicit.option }
  }
  if (!isBlank(valueOf(ctx, keeperId, spec.column))) return { source: keeperId }
  return { source: included.find((id) => !isBlank(valueOf(ctx, id, spec.column))) ?? keeperId }
}

function fieldChoice(ctx: Context, spec: FieldSpec, pick: FieldPick): ResolveChoice {
  const explicit = ctx.draft.selection[spec.column]
  if ('source' in pick) return { source: String(pick.source) }
  return explicit && 'option' in explicit ? explicit : { custom: pick.custom ?? '' }
}

type Membership = { required: boolean; holders: number[]; source: number; final: string; others: string[] }

function membershipPlan(ctx: Context): Membership | null {
  const { keeperId } = ctx
  if (ctx.data.table !== 'customers' || keeperId === null) return null
  // The server's order, kept record first, so Notes gains the lines in the order it writes them.
  const holders = [keeperId, ...ctx.included.filter((id) => id !== keeperId)].filter((id) => membershipOf(recordOf(ctx, id)) !== null)
  const numbers = [...new Set(holders.map((id) => membershipOf(recordOf(ctx, id)) as string))]
  if (!numbers.length) return null
  const picked = sourceOf(ctx.draft.selection.membership)
  const source = numbers.length > 1 && holders.includes(picked) ? picked : holders[0]
  const final = membershipOf(recordOf(ctx, source)) as string
  return { required: numbers.length > 1, holders, source, final, others: numbers.filter((number) => number !== final) }
}

type Storefront = { holders: number[]; kept: number }

function storefrontPlan(ctx: Context, membership: Membership | null): Storefront | null {
  const { keeperId } = ctx
  if (ctx.data.table !== 'customers' || keeperId === null) return null
  const holders = ctx.included.filter((id) => accountOf(recordOf(ctx, id)) !== null)
  if (!holders.length) return null
  const picked = sourceOf(ctx.draft.selection.storefront)
  if (holders.length > 1 && holders.includes(picked)) return { holders, kept: picked }
  // D7: the account of the membership number that stays (its id, else the
  // record that number came from), else the kept record's, else the first.
  const wanted = membership?.final.trim().toLowerCase() ?? ''
  const kept = (wanted ? holders.find((id) => accountOf(recordOf(ctx, id))?.toLowerCase() === wanted) : undefined)
    ?? (membership && holders.includes(membership.source) ? membership.source : undefined)
    ?? (holders.includes(keeperId) ? keeperId : holders[0])
  return { holders, kept }
}

type Plan = {
  ctx: Context
  rows: ResolveRow[]
  picks: Map<string, FieldPick>
  membership: Membership | null
  storefront: Storefront | null
}

function buildPlan(data: ContactResolveData, draft: ResolveDraft, t: Translate): Plan {
  const ctx = contextOf(data, draft)
  const { included, keeperId } = ctx
  const membership = membershipPlan(ctx)
  const storefront = storefrontPlan(ctx, membership)
  const picks = new Map<string, FieldPick>()

  const cells = (text: (id: number) => string, disabled?: (id: number) => string | undefined): Record<string, ResolveCell> => (
    Object.fromEntries(data.ids.map((id) => {
      if (!data.records.has(id)) return [String(id), { text: '' }]
      const reason = disabled?.(id)
      return [String(id), reason ? { text: text(id), disabledReason: reason } : { text: text(id) }]
    }))
  )
  // Every record merged in holds what Final shows: the row folds away.
  const identical = (row: Record<string, ResolveCell>, finalText: string): boolean => (
    included.every((id) => (row[String(id)]?.text ?? '') === finalText)
  )

  const rows: ResolveRow[] = [{
    key: 'record',
    label: tr(t, 'resolve_record_kept', 'Record kept'),
    hint: tr(t, 'resolve_record_kept_hint', 'This record stays. The other records\' history moves onto it, then they are deleted.'),
    kind: 'choice',
    cells: cells((id) => `#${id}`),
    final: { text: keeperId === null ? '' : `#${keeperId}` },
    ...(keeperId === null ? {} : { choice: { source: String(keeperId) } }),
    identical: false,
  }]

  const fieldRow = (spec: FieldSpec): ResolveRow => {
    const pick = fieldPick(ctx, spec)
    if (pick) picks.set(spec.column, pick)
    let value: unknown = pick ? ('source' in pick ? valueOf(ctx, pick.source, spec.column) : pick.custom) : null
    if (spec.column === 'notes' && membership?.others.length) value = notesWithMembership(value, membership.others)
    const row = cells((id) => fieldText(spec, valueOf(ctx, id, spec.column), data.table, t))
    const finalText = pick ? fieldText(spec, value, data.table, t) : ''
    return {
      key: spec.column,
      label: tr(t, spec.label[0], spec.label[1]),
      kind: 'choice',
      cells: row,
      final: { text: finalText },
      ...(pick ? { choice: fieldChoice(ctx, spec, pick) } : {}),
      identical: identical(row, finalText),
      ...(spec.kind === 'text' ? { custom: { kind: 'text' as const } } : {}),
      ...(spec.kind === 'phone' ? { custom: { kind: 'text' as const, normalize: formatPhoneInputValue } } : {}),
      ...(spec.kind === 'gender' ? { options: genderOptions(t) } : {}),
      ...(spec.column === 'name' ? { copyable: true } : {}),
    }
  }

  for (const column of TABLE_FIELDS[data.table]) {
    rows.push(fieldRow(FIELDS[column]))
    if (column !== 'phone') continue
    if (membership) {
      const row = cells(
        (id) => membershipOf(recordOf(ctx, id)) ?? '',
        membership.required ? (id) => (membershipOf(recordOf(ctx, id)) === null ? tr(t, 'resolve_membership_blank', 'No number') : undefined) : undefined,
      )
      rows.push({
        key: 'membership',
        label: tr(t, 'membership_number', 'Membership number'),
        hint: tr(t, 'resolve_membership_hint', 'The chosen number stays. The other numbers are added to Notes.'),
        kind: membership.required ? 'required' : 'computed',
        cells: row,
        final: { text: membership.final },
        ...(membership.required ? { choice: { source: String(membership.source) } } : {}),
        identical: identical(row, membership.final),
      })
    }
    if (storefront) {
      const several = storefront.holders.length > 1
      const row = cells(
        (id) => accountOf(recordOf(ctx, id)) ?? '',
        several ? (id) => (accountOf(recordOf(ctx, id)) === null ? tr(t, 'resolve_storefront_none', 'No account') : undefined) : undefined,
      )
      const finalText = accountOf(recordOf(ctx, storefront.kept)) ?? ''
      rows.push({
        key: 'storefront',
        label: tr(t, 'resolve_storefront_account', 'Storefront account'),
        hint: tr(t, 'resolve_storefront_hint', 'The chosen account stays linked to the kept record. The others are unlinked but can still sign in.'),
        kind: several ? 'choice' : 'computed',
        cells: row,
        final: { text: finalText },
        ...(several ? { choice: { source: String(storefront.kept) } } : {}),
        identical: identical(row, finalText),
      })
    }
  }

  const history = (id: number) => data.listed.get(id)?.history ?? null
  const total = included.reduce<ContactDuplicateEntryHistory>((sum, id) => ({
    salesCount: sum.salesCount + (history(id)?.salesCount ?? 0),
    returnsCount: sum.returnsCount + (history(id)?.returnsCount ?? 0),
    pointsBalance: (sum.pointsBalance ?? 0) + (history(id)?.pointsBalance ?? 0),
  }), { salesCount: 0, returnsCount: 0, pointsBalance: 0 })
  const historyRow = cells((id) => contactHistoryParts(history(id), t).join(' · '))
  const historyText = contactHistoryParts(total, t).join(' · ')
  rows.push({
    key: 'history',
    label: tr(t, 'history', 'History'),
    hint: tr(t, 'resolve_history_hint', 'Everything linked to the merged records moves onto the kept record.'),
    kind: 'computed',
    cells: historyRow,
    final: { text: historyText },
    identical: identical(historyRow, historyText),
  })

  return { ctx, rows, picks, membership, storefront }
}

export function createContactResolveAdapter(options: ContactResolveOptions): ResolveAdapter<ContactResolveData, ContactResolveToken> {
  const { table, cluster, t } = options
  const ids = [...new Set(cluster.contacts.map((contact) => contact.id))].sort((a, b) => a - b)
  const listed = new Map(cluster.contacts.map((contact) => [contact.id, { name: contact.name, history: contact.history }]))
  // The running outcome of a merge that stopped part way, so Continue resumes
  // from the step that did not answer instead of starting over.
  const progress = new WeakMap<ContactResolveToken, ContactMergeOutcome>()

  const afterItems = (outcome: ContactMergeOutcome, token: ContactResolveToken): ResolveAfterItem[] => {
    const keeper = outcome.keeper ?? {}
    const items: ResolveAfterItem[] = [{ label: tr(t, 'resolve_record_kept', 'Record kept'), value: recordLabel(keeper.name, token.request.keepId) }]
    for (const { key, label } of token.changed) {
      if (key === 'membership') items.push({ label, value: membershipOf(keeper) ?? '' })
      else if (FIELDS[key]) items.push({ label, value: fieldText(FIELDS[key], keeper[key], table, t) })
    }
    items.push({ label: tr(t, 'merged_records', 'Merged records'), value: outcome.merged.map((entry) => recordLabel(entry.name, entry.id)).join(', ') })
    if (outcome.membershipToNotes.length) {
      items.push({ label: tr(t, 'resolve_membership_to_notes', 'Membership numbers moved to Notes'), value: outcome.membershipToNotes.join(', ') })
    }
    if (outcome.unlinkedAccounts.length) {
      items.push({
        label: tr(t, 'resolve_storefront_unlinked_after', 'Storefront accounts unlinked'),
        value: outcome.unlinkedAccounts.map((account) => account.membership_id || `#${account.id}`).join(', '),
      })
    }
    return items
  }

  return {
    async load(signal) {
      const rows = await readContactRecords(table, ids, signal)
      return { table, ids, records: new Map(rows.map((row) => [Number(row.id), row])), listed }
    },

    // A group larger than one merge starts with the kept record and the next
    // five in id order merged in, the same six Merge selected would take.
    initialSelection(data) {
      const present = data.ids.filter((id) => data.records.has(id))
      if (present.length <= CONTACT_MERGE_MAX_RECORDS) return { selection: {}, columns: {} }
      const keeperId = chooseBulkMergeKeeper(present.map((id) => keeperEntry(data, id)))?.id ?? present[0]
      const first = new Set([keeperId, ...present.filter((id) => id !== keeperId).slice(0, CONTACT_MERGE_MAX_RECORDS - 1)])
      return {
        selection: {},
        columns: Object.fromEntries(present.filter((id) => !first.has(id)).map((id) => [String(id), { disposition: 'separate' as const }])),
      }
    },

    columns(data, draft): ResolveColumn[] {
      const { keeperId } = contextOf(data, draft)
      return data.ids.map((id) => {
        const row = data.records.get(id)
        const title = String(row?.name ?? data.listed.get(id)?.name ?? '').trim() || `#${id}`
        if (!row) {
          return {
            id: String(id),
            title,
            subtitle: `#${id}`,
            disposition: 'separate',
            dispositions: ['separate'],
            disabledReason: tr(t, 'resolve_contact_missing', 'No longer exists, so it cannot be merged.'),
          }
        }
        return {
          id: String(id),
          title,
          subtitle: id === keeperId ? `#${id} · ${tr(t, 'resolve_record_kept', 'Record kept')}` : `#${id}`,
          disposition: draft.columns[String(id)]?.disposition === 'separate' ? 'separate' : 'include',
          dispositions: ['include', 'separate'],
        }
      })
    },

    rows(data, draft) {
      return buildPlan(data, draft, t).rows
    },

    blockers(data, draft) {
      const { ctx, rows } = buildPlan(data, draft, t)
      const out: string[] = []
      if (ctx.included.length < 2) out.push(tr(t, 'resolve_merge_needs_two', 'Merge in at least two records.'))
      if (ctx.included.length > CONTACT_MERGE_MAX_RECORDS) {
        out.push(fill(tr(t, 'resolve_merge_max', 'Merge at most {n} records at a time.'), { n: CONTACT_MERGE_MAX_RECORDS }))
      }
      if (ctx.included.length >= 2 && !rows.find((row) => row.key === 'name')?.final.text) out.push(tr(t, 'name_required', 'Name is required'))
      return out
    },

    async review(data, draft) {
      const { ctx, rows, picks, membership, storefront } = buildPlan(data, draft, t)
      const keepId = ctx.keeperId
      if (keepId === null) throw new Error(tr(t, 'resolve_merge_needs_two', 'Merge in at least two records.'))
      const mergeIds = ctx.included.filter((id) => id !== keepId)
      const choices: Record<string, ContactMergeChoice> = {}
      for (const [column, pick] of picks) choices[column] = 'source' in pick ? { source_id: pick.source } : { custom: pick.custom }
      const request: ContactMergeRequest = {
        keepId,
        mergeIds,
        manual: true,
        client_request_id: createClientRequestId('contact_merge'),
        expected: [keepId, ...mergeIds].map((id) => {
          const version = recordOf(ctx, id)?.updated_at
          return { id, updated_at: version == null ? null : String(version) }
        }),
        choices,
        ...(membership ? { membership_source_id: membership.source } : {}),
        ...(storefront ? { portal_keep_contact_id: storefront.kept } : {}),
      }

      const changes: ResolveChange[] = []
      const changed: ContactResolveToken['changed'] = []
      for (const row of rows) {
        if (row.key === 'record' || row.key === 'history') continue
        const before = row.cells[String(keepId)]?.text ?? ''
        if (before === row.final.text) continue
        changes.push({ label: row.label, before, after: row.final.text })
        changed.push({ key: row.key, label: row.label })
      }

      const name = (id: number) => recordLabel(valueOf(ctx, id, 'name'), id)
      const warnings = [tr(t, 'cannot_be_undone', 'This cannot be undone.')]
      for (const id of storefront?.holders ?? []) {
        if (id === storefront?.kept) continue
        warnings.push(fill(
          tr(t, 'resolve_storefront_unlinked', 'Storefront account {account} of {name} will be unlinked. It can still sign in.'),
          { account: accountOf(recordOf(ctx, id)) || `#${id}`, name: name(id) },
        ))
      }
      const finalName = rows.find((row) => row.key === 'name')?.final.text ?? ''
      return {
        message: fill(tr(t, 'resolve_contact_confirm', 'Merge {records} into {name}.'), {
          records: mergeIds.map(name).join(', '),
          name: recordLabel(finalName, keepId),
        }),
        changes,
        warnings,
        token: { request, changed },
        undoable: false,
      }
    },

    async apply(token, _signal, onProgress) {
      if (!options.canMerge()) throw new Error(tr(t, 'access_denied', 'Access Denied'))
      const total = token.request.mergeIds.length
      const outcome = await mergeContacts(table, token.request, (step) => {
        progress.set(token, step)
        options.onWritten?.()
        onProgress(Math.min(step.merged.length, total), total)
      }, progress.get(token) ?? null)
      progress.delete(token)
      return { after: afterItems(outcome, token), done: total, total }
    },

    isStale(error) {
      const code = (error as { code?: unknown } | null)?.code
      return typeof code === 'string' && STALE_CODES.has(code)
    },
  }
}

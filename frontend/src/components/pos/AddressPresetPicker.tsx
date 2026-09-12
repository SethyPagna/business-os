import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Modal from '../shared/Modal.tsx'
import { getPosAddressPresets, savePosAddressPresets } from '../../api/posAddressPresetsTransport.ts'
import { captureActorReadScope, isActorReadScopeCurrent } from '../../api/actorReadScope.ts'
import {
  ADDRESS_PRESET_CATEGORIES,
  addressPrefixBeforePreset,
  composeAddress,
  EMPTY_ADDRESS_PRESETS,
  MAX_ADDRESS_PRESET_LENGTH,
  normalizeAddressPresetList,
  normalizeAddressSegment,
  validateAddressPresets,
  type AddressPresetCategory,
  type AddressPresets,
} from '../../utils/addressPresets.ts'

type Translate = (key: string) => string
type Props = {
  actorKey: string
  currentAddress: string
  previousSuffix?: string
  onApply: (result: { address: string; suffix: string }) => void
  onClose: () => void
  t: Translate
}

type EditState = { category: AddressPresetCategory; value: string; original: string } | null

export default function AddressPresetPicker({ actorKey, currentAddress, previousSuffix = '', onApply, onClose, t }: Props) {
  const tr = useCallback((key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }, [t])
  const initialPrefix = useMemo(() => addressPrefixBeforePreset(currentAddress, previousSuffix), [currentAddress, previousSuffix])
  const [prefix, setPrefix] = useState(initialPrefix)
  const [presets, setPresets] = useState<AddressPresets>(EMPTY_ADDRESS_PRESETS)
  const [revision, setRevision] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [selected, setSelected] = useState<Partial<Record<AddressPresetCategory, string>>>({})
  const [drafts, setDrafts] = useState<Record<AddressPresetCategory, string>>({ province: '', district: '', subdistrict: '' })
  const [editing, setEditing] = useState<EditState>(null)
  const [pendingRemove, setPendingRemove] = useState('')
  const [manage, setManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const labels: Record<AddressPresetCategory, string> = {
    province: tr('address_preset_province', 'Province ខេត្ត'),
    district: tr('address_preset_district', 'District ខណ្ឌ'),
    subdistrict: tr('address_preset_subdistrict', 'Subdistrict សង្កាត់'),
  }

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    const actorScope = captureActorReadScope('pos:address-presets')
    setLoading(true)
    setError('')
    setPresets(EMPTY_ADDRESS_PRESETS)
    setRevision(null)
    setCanManage(false)
    try {
      const response = await getPosAddressPresets()
      if (requestRef.current !== requestId || !isActorReadScopeCurrent(actorScope, false)) return
      setPresets(response.presets)
      setRevision(response.revision)
      setCanManage(response.can_manage === true)
    } catch (loadError) {
      if (requestRef.current !== requestId || !isActorReadScopeCurrent(actorScope, false)) return
      setError(loadError instanceof Error ? loadError.message : tr('address_preset_load_failed', 'Failed to load saved address options.'))
    } finally {
      if (requestRef.current === requestId && isActorReadScopeCurrent(actorScope, false)) setLoading(false)
    }
  }, [actorKey, tr])

  useEffect(() => {
    setPrefix(initialPrefix)
    setSelected({})
    setDrafts({ province: '', district: '', subdistrict: '' })
    setEditing(null)
    setPendingRemove('')
    setSaving(false)
    void load()
    return () => { requestRef.current += 1 }
  }, [actorKey, initialPrefix, load])

  const persist = async (next: AddressPresets) => {
    const validated = validateAddressPresets(next)
    if (validated.error) {
      setError(tr('address_preset_save_failed', 'The saved address options are invalid.'))
      return false
    }
    const requestId = ++requestRef.current
    const actorScope = captureActorReadScope('pos:address-presets')
    setSaving(true)
    setError('')
    try {
      const response = await savePosAddressPresets(validated.presets, revision)
      if (requestRef.current !== requestId || !isActorReadScopeCurrent(actorScope, false)) return false
      setPresets(response.presets)
      setRevision(response.revision)
      return requestId
    } catch (saveError) {
      if (requestRef.current !== requestId || !isActorReadScopeCurrent(actorScope, false)) return false
      const conflict = saveError && typeof saveError === 'object' && (saveError as { code?: unknown }).code === 'write_conflict'
      setError(conflict
        ? tr('address_preset_conflict', 'Saved addresses changed on another device. Reload before saving again.')
        : saveError instanceof Error ? saveError.message : tr('address_preset_save_failed', 'Failed to save address options.'))
      return false
    } finally {
      if (requestRef.current === requestId && isActorReadScopeCurrent(actorScope, false)) setSaving(false)
    }
  }

  const add = async (category: AddressPresetCategory) => {
    const callerScope = captureActorReadScope('pos:address-presets')
    const value = normalizeAddressSegment(drafts[category])
    if (!value) return
    if (value.length > MAX_ADDRESS_PRESET_LENGTH) {
      setError(tr('address_preset_save_failed', 'That saved address is too long.'))
      return
    }
    const nextList = normalizeAddressPresetList([...presets[category], value])
    if (nextList.length === presets[category].length) return
    const completedRequestId = await persist({ ...presets, [category]: nextList })
    if (completedRequestId && requestRef.current === completedRequestId && isActorReadScopeCurrent(callerScope, false)) {
      setDrafts((current) => ({ ...current, [category]: '' }))
      setSelected((current) => ({ ...current, [category]: value }))
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const callerScope = captureActorReadScope('pos:address-presets')
    const value = normalizeAddressSegment(editing.value)
    if (!value || value.length > MAX_ADDRESS_PRESET_LENGTH) {
      setError(tr('address_preset_save_failed', 'That saved address is invalid.'))
      return
    }
    const nextList = normalizeAddressPresetList(presets[editing.category].map((item) => item === editing.original ? value : item))
    const completedRequestId = await persist({ ...presets, [editing.category]: nextList })
    if (completedRequestId && requestRef.current === completedRequestId && isActorReadScopeCurrent(callerScope, false)) {
      setSelected((current) => current[editing.category] === editing.original ? { ...current, [editing.category]: value } : current)
      setEditing(null)
    }
  }

  const remove = async (category: AddressPresetCategory, value: string) => {
    const callerScope = captureActorReadScope('pos:address-presets')
    const next = { ...presets, [category]: presets[category].filter((item) => item !== value) }
    const completedRequestId = await persist(next)
    if (completedRequestId && requestRef.current === completedRequestId && isActorReadScopeCurrent(callerScope, false)) {
      setSelected((current) => current[category] === value ? { ...current, [category]: '' } : current)
      if (editing?.category === category && editing.original === value) setEditing(null)
      setPendingRemove('')
    }
  }

  const preview = composeAddress(prefix, selected)
  return (
    <Modal title={tr('address_presets', 'Saved address options')} onClose={onClose} size="md" unsavedChanges={{ dirty: false }}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
          {tr('address_house_street', 'House / street (kept as typed)')}
          <input className="input mt-1 w-full text-sm" value={prefix} onChange={(event) => setPrefix(event.target.value)} autoComplete="street-address" />
        </label>

        {error ? (
          <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            <div className="break-words">{error}</div>
            <button type="button" className="mt-1 font-semibold underline" disabled={loading || saving} onClick={() => void load()}>{tr('address_preset_reload', 'Reload')}</button>
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          {ADDRESS_PRESET_CATEGORIES.map((category) => (
            <section key={category} className="min-w-0 rounded-xl border border-gray-200 p-2 dark:border-gray-700" aria-labelledby={`address-preset-${category}`}>
              <h3 id={`address-preset-${category}`} className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{labels[category]}</h3>
              {loading ? <div className="py-2 text-xs text-gray-400">{tr('loading', 'Loading...')}</div> : (
                <div className="space-y-1">
                  {presets[category].map((value) => {
                    const isEditing = editing?.category === category && editing.original === value
                    const removeKey = `${category}:${value}`
                    return isEditing ? (
                      <div key={value} className="flex min-w-0 gap-1">
                        <input className="input h-8 min-w-0 flex-1 px-2 text-xs" value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} />
                        <button type="button" className="btn-primary h-8 px-2 text-[11px]" disabled={saving} onClick={() => void saveEdit()}>{tr('save', 'Save')}</button>
                      </div>
                    ) : (
                      <div key={value} className="flex min-w-0 items-center gap-0.5">
                        <button type="button" className={`min-w-0 flex-1 break-words rounded-md px-2 py-1.5 text-left text-xs ${selected[category] === value ? 'bg-blue-100 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200' : 'bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300'}`} aria-pressed={selected[category] === value} onClick={() => setSelected((current) => ({ ...current, [category]: current[category] === value ? '' : value }))}>{value}</button>
                        {manage && pendingRemove === removeKey ? <>
                          <button type="button" className="h-7 shrink-0 rounded px-1 text-[10px] text-gray-500" disabled={saving} onClick={() => setPendingRemove('')}>{tr('cancel', 'Cancel')}</button>
                          <button type="button" className="h-7 shrink-0 rounded bg-rose-600 px-1.5 text-[10px] font-semibold text-white" disabled={saving} onClick={() => void remove(category, value)}>{tr('remove', 'Remove')}</button>
                        </> : manage ? <>
                          <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-blue-600" disabled={saving} onClick={() => setEditing({ category, original: value, value })} aria-label={`${tr('rename', 'Rename')} ${value}`}><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-rose-600" disabled={saving} onClick={() => setPendingRemove(removeKey)} aria-label={`${tr('remove', 'Remove')} ${value}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </> : null}
                      </div>
                    )
                  })}
                  {manage ? (
                    <div className="flex min-w-0 gap-1 pt-1">
                      <input className="input h-8 min-w-0 flex-1 px-2 text-xs" value={drafts[category]} onChange={(event) => setDrafts((current) => ({ ...current, [category]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') void add(category) }} placeholder={tr('add_address_option', 'Add option')} />
                      <button type="button" className="btn-secondary h-8 px-2 text-[11px]" disabled={saving || !drafts[category].trim()} onClick={() => void add(category)}>{tr('add', 'Add')}</button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          ))}
        </div>

        <button type="button" className="text-xs font-semibold text-blue-600 disabled:text-gray-400 dark:text-blue-300" disabled={!canManage} title={!canManage ? tr('address_preset_read_only', 'Full POS access is required to manage saved addresses.') : undefined} onClick={() => setManage((value) => !value)}>{tr('manage_address_presets', 'Manage saved address options')}</button>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900/40">
          <span className="font-semibold text-gray-600 dark:text-gray-300">{tr('address_preview', 'Address preview')}:</span>{' '}
          <span className="break-words text-gray-800 dark:text-gray-100">{preview.address || '—'}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{tr('cancel', 'Cancel')}</button>
          <button type="button" className="btn-primary" disabled={loading || saving || !preview.address} onClick={() => { onApply(preview); onClose() }}>{tr('apply_address', 'Apply address')}</button>
        </div>
      </div>
    </Modal>
  )
}

export const CONTACT_OPTION_LIMIT = 3

export function createContactOption(overrides = {}) {
  return {
    label: '',
    name: '',
    phone: '',
    email: '',
    address: '',
    area: '',
    ...overrides,
  }
}

function normalizeOption(option = {}, { legacyField = 'address' } = {}) {
  return {
    label: String(option?.label || '').trim(),
    name: String(option?.name || '').trim(),
    phone: String(option?.phone || '').trim(),
    email: String(option?.email || '').trim(),
    address: String(option?.address || (legacyField === 'address' ? option?.[legacyField] : '') || '').trim(),
    area: String(option?.area || (legacyField === 'area' ? option?.[legacyField] : '') || '').trim(),
  }
}

export function limitContactOptions(options = []) {
  return (Array.isArray(options) ? options : []).slice(0, CONTACT_OPTION_LIMIT)
}

export function parseStoredContactOptions(raw, { legacyField = 'address' } = {}) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (!parsed.length) return []
      if (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0])) {
        return limitContactOptions(parsed.map((option) => normalizeOption(option, { legacyField }))).filter(hasContactOptionData)
      }
      return limitContactOptions(parsed.map((value, index) => normalizeOption({
        label: index === 0 ? 'Default' : `Option ${index + 1}`,
        [legacyField]: String(value || ''),
      }, { legacyField }))).filter(hasContactOptionData)
    }
  } catch (_) {}
  return limitContactOptions([normalizeOption({
    label: 'Default',
    [legacyField]: String(raw),
  }, { legacyField })]).filter(hasContactOptionData)
}

export function hasContactOptionData(option = {}) {
  return [
    option?.label,
    option?.name,
    option?.phone,
    option?.email,
    option?.address,
    option?.area,
  ].some((value) => String(value || '').trim())
}

export function serializeContactOptions(options = []) {
  const clean = limitContactOptions(options)
    .map((option) => normalizeOption(option))
    .filter(hasContactOptionData)
  return clean.length ? JSON.stringify(clean) : null
}

export function buildContactOptionSummary(options = [], { mode = 'address' } = {}) {
  const key = mode === 'area' ? 'area' : 'address'
  if (!options.length) return '-'
  return options.map((option, index) => {
    const parts = [option.name, option.phone, option.email, option[key]].filter(Boolean)
    return `#${index + 1} ${option.label ? `(${option.label}) ` : ''}${parts.join(' | ') || '-'}`
  }).join('\n')
}

export function parseContactOptionsFromImportRow(row = {}, { mode = 'address' } = {}) {
  const options = []
  const valueField = mode === 'area' ? 'area' : 'address'
  for (let index = 1; index <= CONTACT_OPTION_LIMIT; index += 1) {
    const option = createContactOption({
      label: row[`contact_label_${index}`] || '',
      name: row[`contact_name_${index}`] || '',
      phone: row[`contact_phone_${index}`] || '',
      email: mode === 'area' ? '' : (row[`contact_email_${index}`] || ''),
      [valueField]: row[`contact_${valueField}_${index}`] || '',
    })
    if (hasContactOptionData(option)) options.push(option)
  }
  return limitContactOptions(options)
}

export function getPrimaryContactOption(options = [], { fallback = {} } = {}) {
  const first = limitContactOptions(options).find(hasContactOptionData)
  if (first) return first
  return createContactOption(fallback)
}

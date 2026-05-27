'use strict'

const CONTACT_OPTION_LIMIT = 3

function cleanText(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeContactOption(option = {}, { mode = 'address' } = {}) {
  return {
    label: cleanText(option.label),
    name: cleanText(option.name),
    phone: cleanText(option.phone),
    email: mode === 'area' ? null : cleanText(option.email),
    address: mode === 'area' ? null : cleanText(option.address),
    area: mode === 'area' ? cleanText(option.area) : null,
  }
}

function hasContactOptionData(option = {}, { mode = 'address' } = {}) {
  const keys = mode === 'area'
    ? ['label', 'name', 'phone', 'area']
    : ['label', 'name', 'phone', 'email', 'address']
  for (const key of keys) {
    if (cleanText(option?.[key])) return true
  }
  return false
}

function collectNormalizedContactOptions(entries = [], { mode = 'address' } = {}) {
  const options = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const option = normalizeContactOption(entry, { mode })
    if (hasContactOptionData(option, { mode })) {
      options.push(option)
      if (options.length >= CONTACT_OPTION_LIMIT) break
    }
  }
  return options
}

function collectLegacyContactOptions(entries = [], { mode = 'address' } = {}) {
  const options = []
  const legacyKey = mode === 'area' ? 'area' : 'address'
  const values = Array.isArray(entries) ? entries : []
  for (let index = 0; index < values.length; index += 1) {
    const option = normalizeContactOption({
      label: index === 0 ? 'Default' : `Option ${index + 1}`,
      [legacyKey]: values[index],
    }, { mode })
    if (hasContactOptionData(option, { mode })) {
      options.push(option)
      if (options.length >= CONTACT_OPTION_LIMIT) break
    }
  }
  return options
}

function parseStoredContactOptions(raw, { mode = 'address' } = {}) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (typeof parsed[0] === 'object' && parsed[0] !== null) {
        return collectNormalizedContactOptions(parsed, { mode })
      }
      return collectLegacyContactOptions(parsed, { mode })
    }
  } catch (_) {}
  const legacyKey = mode === 'area' ? 'area' : 'address'
  const fallback = normalizeContactOption({
    label: 'Default',
    [legacyKey]: raw,
  }, { mode })
  return hasContactOptionData(fallback, { mode }) ? [fallback] : []
}

function parseImportContactOptions(row = {}, { mode = 'address' } = {}) {
  const valueField = mode === 'area' ? 'area' : 'address'
  const options = []
  for (let index = 1; index <= CONTACT_OPTION_LIMIT; index += 1) {
    const option = normalizeContactOption({
      label: row[`contact_label_${index}`],
      name: row[`contact_name_${index}`],
      phone: row[`contact_phone_${index}`],
      email: mode === 'area' ? null : row[`contact_email_${index}`],
      [valueField]: row[`contact_${valueField}_${index}`],
    }, { mode })
    if (hasContactOptionData(option, { mode })) options.push(option)
  }
  return options.slice(0, CONTACT_OPTION_LIMIT)
}

function serializeContactOptions(options = [], { mode = 'address' } = {}) {
  const clean = collectNormalizedContactOptions(options, { mode })
  return clean.length ? JSON.stringify(clean) : null
}

function getPrimaryContactOption(options = [], { mode = 'address' } = {}) {
  for (const entry of Array.isArray(options) ? options : []) {
    if (hasContactOptionData(entry, { mode })) return normalizeContactOption(entry, { mode })
  }
  return normalizeContactOption({}, { mode })
}

function buildImportedContactState(source = {}, { mode = 'address' } = {}) {
  const importedOptions = parseImportContactOptions(source, { mode })
  const storedOptions = importedOptions.length
    ? importedOptions
    : parseStoredContactOptions(source.address, { mode })
  if (!storedOptions.length) {
    const fallback = normalizeContactOption({
      name: source.contact_person || source.name,
      phone: source.phone,
      email: source.email,
      [mode === 'area' ? 'area' : 'address']: mode === 'area' ? source.area : source.address,
    }, { mode })
    if (hasContactOptionData(fallback, { mode })) storedOptions.push(fallback)
  }
  const primary = getPrimaryContactOption(storedOptions, { mode })
  return {
    options: storedOptions.slice(0, CONTACT_OPTION_LIMIT),
    serialized: serializeContactOptions(storedOptions, { mode }),
    primary,
  }
}

module.exports = {
  CONTACT_OPTION_LIMIT,
  cleanText,
  normalizeContactOption,
  hasContactOptionData,
  parseStoredContactOptions,
  parseImportContactOptions,
  serializeContactOptions,
  getPrimaryContactOption,
  buildImportedContactState,
}

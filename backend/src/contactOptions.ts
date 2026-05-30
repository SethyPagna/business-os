'use strict'

const CONTACT_OPTION_LIMIT = 3

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanText(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

/**
 * @typedef {'address' | 'area'} ContactOptionMode
 * @typedef {{ mode?: ContactOptionMode }} ContactOptionModeOptions
 * @typedef {{
 *   label?: unknown,
 *   name?: unknown,
 *   phone?: unknown,
 *   email?: unknown,
 *   address?: unknown,
 *   area?: unknown,
 *   contact_person?: unknown,
 * }} ContactOptionSource
 * @typedef {{
 *   label: string | null,
 *   name: string | null,
 *   phone: string | null,
 *   email: string | null,
 *   address: string | null,
 *   area: string | null,
 * }} NormalizedContactOption
 */

/**
 * @param {ContactOptionSource} [option]
 * @param {ContactOptionModeOptions} [options]
 * @returns {NormalizedContactOption}
 */
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

/**
 * @param {ContactOptionSource} [option]
 * @param {ContactOptionModeOptions} [options]
 * @returns {boolean}
 */
function hasContactOptionData(option = {}, { mode = 'address' } = {}) {
  const keys = mode === 'area'
    ? ['label', 'name', 'phone', 'area']
    : ['label', 'name', 'phone', 'email', 'address']
  for (const key of keys) {
    if (cleanText(option?.[key])) return true
  }
  return false
}

/**
 * @param {ContactOptionSource[]} [entries]
 * @param {ContactOptionModeOptions} [options]
 * @returns {NormalizedContactOption[]}
 */
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

/**
 * @param {unknown[]} [entries]
 * @param {ContactOptionModeOptions} [options]
 * @returns {NormalizedContactOption[]}
 */
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

/**
 * @param {unknown} raw
 * @param {ContactOptionModeOptions} [options]
 * @returns {NormalizedContactOption[]}
 */
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

/**
 * @param {Record<string, unknown>} [row]
 * @param {ContactOptionModeOptions} [options]
 * @returns {NormalizedContactOption[]}
 */
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

/**
 * @param {ContactOptionSource[]} [options]
 * @param {ContactOptionModeOptions} [modeOptions]
 * @returns {string | null}
 */
function serializeContactOptions(options = [], { mode = 'address' } = {}) {
  const clean = collectNormalizedContactOptions(options, { mode })
  return clean.length ? JSON.stringify(clean) : null
}

/**
 * @param {ContactOptionSource[]} [options]
 * @param {ContactOptionModeOptions} [modeOptions]
 * @returns {NormalizedContactOption}
 */
function getPrimaryContactOption(options = [], { mode = 'address' } = {}) {
  for (const entry of Array.isArray(options) ? options : []) {
    if (hasContactOptionData(entry, { mode })) return normalizeContactOption(entry, { mode })
  }
  return normalizeContactOption({}, { mode })
}

/**
 * @param {Record<string, unknown>} [source]
 * @param {ContactOptionModeOptions} [options]
 * @returns {{ options: NormalizedContactOption[], serialized: string | null, primary: NormalizedContactOption }}
 */
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

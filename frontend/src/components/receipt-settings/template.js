import { DEFAULT_TEMPLATE } from './constants.js'

export function parseReceiptTemplate(input) {
  try {
    return {
      ...DEFAULT_TEMPLATE,
      ...(typeof input === 'string' ? JSON.parse(input || '{}') : (input || {})),
    }
  } catch {
    return { ...DEFAULT_TEMPLATE }
  }
}

export function serializeReceiptTemplate(template = {}) {
  return JSON.stringify(parseReceiptTemplate(template))
}

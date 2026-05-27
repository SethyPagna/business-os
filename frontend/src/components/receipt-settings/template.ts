import { DEFAULT_TEMPLATE } from './constants.js'
import type { ReceiptTemplate } from './constants.ts'

type ReceiptTemplateInput = Partial<ReceiptTemplate> | Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseTemplateInput(input: unknown): ReceiptTemplateInput {
  if (typeof input === 'string') {
    const parsed = JSON.parse(input || '{}')
    return isRecord(parsed) ? parsed : {}
  }

  return isRecord(input) ? input : {}
}

export function parseReceiptTemplate(input: unknown): ReceiptTemplate {
  try {
    return {
      ...DEFAULT_TEMPLATE,
      ...parseTemplateInput(input),
    }
  } catch {
    return { ...DEFAULT_TEMPLATE }
  }
}

export function serializeReceiptTemplate(template: unknown = {}): string {
  return JSON.stringify(parseReceiptTemplate(template))
}

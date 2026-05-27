export const KHMER_INITIALS: string[]

export function normalizeInitialText(value: unknown): string
export function getInitialKey(value: unknown): string
export function getInitialType(key: unknown): 'latin' | 'number' | 'khmer' | 'other' | 'symbol'
export function compareInitialKeys(left: unknown, right: unknown): number
export function aggregateInitialOptions(rows?: Array<{
  key?: unknown
  value?: unknown
  label?: unknown
  count?: unknown
}>): Array<{
  key: string
  label: string
  count: number
  type: 'latin' | 'number' | 'khmer' | 'other' | 'symbol'
}>
export function buildInitialOptionsFromProducts(products?: Array<{
  name?: unknown
  label?: unknown
}>): Array<{
  key: string
  label: string
  count: number
  type: 'latin' | 'number' | 'khmer' | 'other' | 'symbol'
}>

interface MutableRef<T> {
  current: T
}

interface BeginSingleActionOptions<T = unknown> {
  blocked?: unknown
  value?: T
}

interface BeginNamedActionOptions {
  blocked?: unknown
}

interface BeginKeyedActionOptions {
  blocked?: unknown
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

export function beginSingleAction<T = boolean>(
  ref: MutableRef<T | boolean | string | undefined> | null | undefined,
  options: BeginSingleActionOptions<T | boolean | string> = {},
): boolean {
  const blocked = !!options.blocked
  const value = hasOwn(options, 'value') ? options.value : true
  if (!ref || blocked || ref.current) return false
  ref.current = value
  return true
}

export function finishSingleAction<T = boolean>(
  ref: MutableRef<T | boolean | string | undefined> | null | undefined,
  value: T | boolean | string = false,
): void {
  if (!ref) return
  ref.current = value
}

export function beginNamedAction(
  ref: MutableRef<string> | null | undefined,
  action: unknown,
  options: BeginNamedActionOptions = {},
): boolean {
  const name = String(action || '').trim()
  if (!ref || !name || options.blocked || ref.current) return false
  ref.current = name
  return true
}

export function finishNamedAction(ref: MutableRef<string> | null | undefined, action: unknown = ''): void {
  if (!ref) return
  const name = String(action || '').trim()
  if (!name || ref.current === name) ref.current = ''
}

export function beginKeyedAction(
  setRef: MutableRef<Set<string>> | null | undefined,
  key: unknown,
  options: BeginKeyedActionOptions = {},
): boolean {
  const normalizedKey = String(key || '').trim()
  const set = setRef?.current
  if (!normalizedKey || options.blocked || !(set instanceof Set) || set.has(normalizedKey)) return false
  set.add(normalizedKey)
  return true
}

export function finishKeyedAction(setRef: MutableRef<Set<string>> | null | undefined, key: unknown): void {
  const normalizedKey = String(key || '').trim()
  const set = setRef?.current
  if (!normalizedKey || !(set instanceof Set)) return
  set.delete(normalizedKey)
}

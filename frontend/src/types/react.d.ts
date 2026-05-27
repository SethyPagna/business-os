declare module 'react' {
  export type EffectCallback = () => void | (() => void)
  export type DependencyList = readonly unknown[]
  export type Dispatch<T> = (value: T) => void
  export type SetStateAction<T> = T | ((previous: T) => T)

  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: DependencyList): T
  export function useEffect(effect: EffectCallback, deps?: DependencyList): void
  export function useMemo<T>(factory: () => T, deps: DependencyList): T
  export function useRef<T>(initialValue: T): { current: T }
  export function useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>]
}

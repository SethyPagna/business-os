// The one Node built-in lib/requestMetrics.ts uses. wrangler.toml enables
// nodejs_compat, so workerd provides `node:async_hooks` at runtime, but this
// package compiles against @cloudflare/workers-types only (no @types/node), so
// the surface actually used is declared here rather than pulling in every Node
// type for one class.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined
    run<R>(store: T, callback: () => R): R
  }
}

/**
 * Minimal ambient declarations for the Cloudflare bindings this Worker uses.
 *
 * Hand-written rather than pulled from `@cloudflare/workers-types` on purpose:
 * that package also declares Node compat globals, and with it in `types` the
 * expressions `process.env.HOME` and `Buffer.from("x")` typechecked CLEANLY here
 * (measured). Neither exists in the deployed runtime, so the typechecker would
 * have been blind to precisely the class of mistake it is meant to catch.
 *
 * Only what this Worker actually touches is declared. If a new binding or method
 * is needed, add it here explicitly — the narrowness is the feature.
 */

interface D1Meta {
  changes?: number
}

interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta?: D1Meta
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(colName?: string): Promise<T | null>
  run<T = unknown>(): Promise<D1Result<T>>
  all<T = unknown>(): Promise<D1Result<T>>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface ScheduledController {
  readonly scheduledTime: number
  readonly cron: string
}

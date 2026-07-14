/**
 * The filesystem capability the apply engine needs, as a narrow port (ADR 0037).
 * Keeping I/O behind this interface lets the engine's dangerous orchestration
 * (lock → backup → atomic write → verify → rollback) be unit-tested in-memory
 * with byte-for-byte fidelity, while production uses a real fsync'd Node port.
 *
 * The engine performs the atomic dance (temp → fsync → rename) by CALLING these
 * primitives — the port only supplies the primitives, so a test port and the
 * Node port exercise the exact same sequence.
 */
export interface ConfigFs {
  /** True if a regular file exists at `path`. */
  exists(path: string): boolean
  /** Read a file as utf8. Throws if missing. */
  readFile(path: string): string
  /** Write bytes to `path` (used for temp + backup files). */
  writeFile(path: string, data: string): void
  /** Best-effort durability barrier for a written file (no-op in memory). */
  fsync(path: string): void
  /** Atomically move `from` onto `to` (replacing it). */
  rename(from: string, to: string): void
  /** Remove a file if present (used for temp cleanup + lock release). */
  remove(path: string): void
  /** Ensure the parent directory of `path` exists. */
  ensureDir(path: string): void
  /**
   * Acquire an exclusive lock file at `path`. Returns false if it already exists
   * (someone else holds it → APPLY_CONFLICT). Must be atomic (O_EXCL).
   */
  acquireLock(path: string): boolean
}

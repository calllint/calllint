/**
 * Guarded acquisition of a `calllint.agent-adoption-contract.v1` for the
 * safe-install orchestrator (new14 Phase 2.4 Batch 5; ADR 0056 §10.5).
 *
 * The contract is EVIDENCE ONLY — it can never upgrade a local verdict
 * (INV-2.4-02). Local prepare re-resolves every fact. So this reader's job is
 * purely to obtain the bytes safely and confirm the wire shape; it makes no
 * decision.
 *
 * Sources (§10.5): a local file, explicit --stdin, or the zero-friction
 * CallLint-owned origin `https://calllint.com`. Arbitrary remote origins are
 * REJECTED in v1 (ADR 0056 Open decision #5 — `--allow-contract-origin` is
 * deferred), so a substituted host can never even be read, let alone trusted.
 *
 * Remote fetch hardening (§10.5): HTTPS only, origin allowlist, redirect limit
 * with no cross-origin/downgrade hops, response size cap, JSON depth cap,
 * timeout, no cookies, no credentials, and no user-specific URL parameters in
 * any surfaced note.
 *
 * This module does the async network work at the CLI edge (mirroring
 * online.ts / computeOnlineEnrichment); the sync `safe-install` command consumes
 * the already-resolved text via deps, so the command itself stays pure + testable.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { parseArgs, flagStr, flagBool, EXIT } from "../../args.js"

/** The only remote origin a contract may be fetched from in v1 (§10.5). */
export const CALLLINT_CONTRACT_ORIGIN = "https://calllint.com"

/** The wire tag every adoption contract must carry (ADR 0043/0055 §5). */
export const AGENT_ADOPTION_CONTRACT_SCHEMA = "calllint.agent-adoption-contract.v1"

/** Conservative caps for the CallLint-owned static contract path. */
const DEFAULT_MAX_BYTES = 256 * 1024 // 256 KB — an adoption contract is small
const DEFAULT_MAX_DEPTH = 32 // reject pathological nesting
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REDIRECTS = 3

/** Minimal shape of the response we depend on — global fetch satisfies it, and
 *  tests inject a stub. Kept tiny so no DOM lib types are required. */
export interface ContractResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}
export type ContractFetch = (url: string, init?: unknown) => Promise<ContractResponse>

/** A resolved contract: the raw text, OR a resolution error to surface verbatim. */
export interface ResolvedContract {
  /** Raw JSON text of the contract, when acquisition + wire-shape check passed. */
  text?: string
  /** A fail-closed resolution error (guard reject / not found / bad shape). */
  error?: { message: string; exitCode: number }
  /** Sanitized source label for human notes (origin + path only — never query). */
  source?: string
}

/** Strip a URL to origin+pathname so no user-specific params reach a log/note. */
function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}`
  } catch {
    return "(unparseable url)"
  }
}

/** Compute JSON nesting depth without recursion blowups; capped early. */
function jsonDepth(value: unknown, cap: number): number {
  let max = 0
  const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 1 }]
  while (stack.length > 0) {
    const { v, d } = stack.pop()!
    if (d > max) max = d
    if (d > cap) return d // early-out past the cap
    if (v && typeof v === "object") {
      for (const child of Object.values(v as Record<string, unknown>)) {
        stack.push({ v: child, d: d + 1 })
      }
    }
  }
  return max
}

/**
 * Validate that parsed JSON is an adoption contract by WIRE SHAPE (string
 * compare — there is no runtime ajv in the repo; full validation is a test-only
 * ajv pass). Returns the text on success, or a fail-closed usage error. A
 * malformed or mis-tagged document is NEVER treated as a guessed install.
 */
export function checkContractShape(text: string): ResolvedContract {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: { message: "contract is not valid JSON", exitCode: EXIT.USAGE } }
  }
  if (jsonDepth(parsed, DEFAULT_MAX_DEPTH) > DEFAULT_MAX_DEPTH) {
    return { error: { message: "contract JSON nesting exceeds the safety cap", exitCode: EXIT.USAGE } }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: { message: "contract is not a JSON object", exitCode: EXIT.USAGE } }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.schema !== AGENT_ADOPTION_CONTRACT_SCHEMA) {
    return {
      error: {
        message: `not a ${AGENT_ADOPTION_CONTRACT_SCHEMA} document (schema tag was ${JSON.stringify(obj.schema)})`,
        exitCode: EXIT.USAGE,
      },
    }
  }
  if (!obj.subject || typeof obj.subject !== "object") {
    return { error: { message: "contract is missing its subject identity", exitCode: EXIT.USAGE } }
  }
  return { text }
}

export interface FetchGuardOptions {
  fetchImpl: ContractFetch
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
}

/**
 * Fetch a contract from the CallLint-owned origin under the §10.5 guards.
 * Fail-closed: any guard violation (non-HTTPS, foreign origin, oversize,
 * redirect over the limit or cross-origin, non-2xx) yields a usage error and
 * NEVER a partial/guessed contract. No cookies, no credentials, no query params
 * in the surfaced source.
 */
export async function fetchGuardedContract(
  url: string,
  opts: FetchGuardOptions,
): Promise<ResolvedContract> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let current: URL
  try {
    current = new URL(url)
  } catch {
    return { error: { message: `contract URL is not a valid URL: ${url}`, exitCode: EXIT.USAGE } }
  }

  // Origin + scheme gate BEFORE any network touch.
  const originOf = (u: URL) => `${u.protocol}//${u.host}`
  if (current.protocol !== "https:") {
    return { error: { message: "contract URL must be https", exitCode: EXIT.USAGE } }
  }
  if (originOf(current) !== CALLLINT_CONTRACT_ORIGIN) {
    return {
      error: {
        message:
          `contract origin ${originOf(current)} is not allowed; v1 accepts only ${CALLLINT_CONTRACT_ORIGIN} ` +
          `(arbitrary remote origins are deferred — use a local file for other sources)`,
        exitCode: EXIT.USAGE,
      },
    }
  }

  let signal: AbortSignal | undefined
  try {
    signal = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout?.(timeoutMs)
  } catch {
    signal = undefined
  }

  let redirects = 0
  // Manual redirect following: each hop must stay https + same allowed origin
  // (no downgrade, no cross-origin) and we never exceed the limit.
  for (;;) {
    let res: ContractResponse
    try {
      res = await opts.fetchImpl(current.toString(), {
        redirect: "manual",
        credentials: "omit",
        // No Cookie / Authorization headers are ever set.
        headers: { accept: "application/json" },
        signal,
      })
    } catch (err) {
      return { error: { message: `contract fetch failed: ${err instanceof Error ? err.message : String(err)}`, exitCode: EXIT.USAGE } }
    }

    // Redirect handling.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location")
      if (!loc) return { error: { message: "contract fetch returned a redirect with no Location", exitCode: EXIT.USAGE } }
      if (++redirects > maxRedirects) {
        return { error: { message: "contract fetch exceeded the redirect limit", exitCode: EXIT.USAGE } }
      }
      let nextUrl: URL
      try {
        nextUrl = new URL(loc, current)
      } catch {
        return { error: { message: "contract fetch redirect Location is not a valid URL", exitCode: EXIT.USAGE } }
      }
      if (nextUrl.protocol !== "https:" || originOf(nextUrl) !== CALLLINT_CONTRACT_ORIGIN) {
        return { error: { message: "contract fetch redirect leaves the allowed https origin (blocked)", exitCode: EXIT.USAGE } }
      }
      current = nextUrl
      continue
    }

    if (!res.ok) {
      return { error: { message: `contract fetch returned HTTP ${res.status}`, exitCode: EXIT.USAGE } }
    }

    // Size cap: reject an oversized declared length up front, then re-check the
    // materialized body (a lying/absent content-length can't smuggle past).
    const declared = Number(res.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { error: { message: `contract exceeds the ${maxBytes}-byte size cap`, exitCode: EXIT.USAGE } }
    }
    let body: string
    try {
      body = await res.text()
    } catch (err) {
      return { error: { message: `reading contract body failed: ${err instanceof Error ? err.message : String(err)}`, exitCode: EXIT.USAGE } }
    }
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      return { error: { message: `contract exceeds the ${maxBytes}-byte size cap`, exitCode: EXIT.USAGE } }
    }
    const shaped = checkContractShape(body)
    return shaped.error ? shaped : { text: shaped.text, source: sanitizeUrl(current.toString()) }
  }
}

export interface ResolveContractDeps {
  cwd: string
  readStdin: () => string
  fetchImpl: ContractFetch
}

/**
 * Resolve the contract TEXT from --contract / --stdin. Dispatches by ref kind:
 *   --stdin        → injected stdin (no network, no file)
 *   local path     → read the file read-only from cwd
 *   https URL       → guarded remote fetch (calllint.com only)
 * Returns undefined when no --contract/--stdin was supplied (the command then
 * emits its own usage error). Fail-closed on every acquisition problem.
 */
export async function resolveContract(
  args: { flags: Record<string, string | boolean> },
  deps: ResolveContractDeps,
): Promise<ResolvedContract | undefined> {
  const useStdin = flagBool(args.flags, "stdin")
  const ref = flagStr(args.flags, "contract")

  if (useStdin) {
    const text = deps.readStdin()
    if (!text.trim()) return { error: { message: "no contract JSON on stdin", exitCode: EXIT.USAGE } }
    return checkContractShape(text)
  }
  if (!ref) return undefined

  // Remote?
  if (/^https?:\/\//i.test(ref)) {
    return fetchGuardedContract(ref, { fetchImpl: deps.fetchImpl })
  }

  // Local file (read-only).
  const abs = resolvePath(deps.cwd, ref)
  if (!existsSync(abs)) {
    return { error: { message: `contract file not found: ${ref}`, exitCode: EXIT.USAGE } }
  }
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch (err) {
    return { error: { message: `cannot read contract file: ${(err as Error).message}`, exitCode: EXIT.USAGE } }
  }
  const shaped = checkContractShape(text)
  return shaped.error ? shaped : { text: shaped.text, source: ref }
}

/**
 * CLI-edge helper (mirror of computeOnlineEnrichment): parse argv, and only when
 * the command is `safe-install` with a --contract/--stdin, resolve the contract
 * text asynchronously so the synchronous command can consume it via deps.
 * Returns undefined for every other command, keeping non-safe-install paths
 * byte-identical and network-free.
 */
export async function computeContractFetch(
  argv: string[],
  deps: ResolveContractDeps,
): Promise<ResolvedContract | undefined> {
  const args = parseArgs(argv)
  if (args.command !== "safe-install") return undefined
  if (!flagBool(args.flags, "stdin") && !flagStr(args.flags, "contract")) return undefined
  return resolveContract(args, deps)
}

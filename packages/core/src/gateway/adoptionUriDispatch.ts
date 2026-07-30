/**
 * Turn a parsed deep link into the EXACT argv a handler may run — and nothing else.
 *
 * This is the security core of the `calllint://` surface. A registered URI handler is
 * reachable by any web page, so the question that matters is not "what does the happy
 * path do" but "what is the worst thing a hostile link can cause". Two structural
 * answers, both enforced here rather than by convention:
 *
 *   1. ARGV, NEVER A SHELL STRING. The result is a string array handed to a spawn API
 *      with no shell. There is no interpolation site, so `;`, `|`, backticks and `$()`
 *      inside a URI are inert data even if the parser were one day loosened.
 *
 *   2. THE WRITE FLAGS ARE UNREACHABLE. `--apply` / `--approve` are refused by
 *      construction (`FORBIDDEN_ARGS`), asserted over the produced argv rather than
 *      trusted. The deep link lands the user AT the authority prompt; only a human at
 *      that prompt can write. This is why one click removes finding-the-docs and
 *      copying-a-command, and does not remove the approval — see ADR (this batch).
 *
 * Digests from the URI are passed as `--expect-*` ASSERTIONS, which the shipped
 * safe-install path already re-checks against locally committed bytes and STOPS on
 * mismatch (never "not found", never a silent fresh anchor). So a link asserting a
 * digest CallLint does not have locally is a refusal, not a fetch.
 *
 * Pure and total: no I/O, no spawn, no environment read.
 */
import type { AdoptionUriRequest } from "./adoptionUri.js"

/**
 * Flags a deep link may never produce. Checked over the built argv, so adding a
 * future flag cannot quietly re-open the write path.
 */
export const FORBIDDEN_ARGS: readonly string[] = Object.freeze([
  "--apply",
  "--approve",
  "--host-config",
  "--plan-out",
])

export interface AdoptionDispatch {
  /** The subcommand argv, WITHOUT the `calllint` binary itself. */
  readonly argv: readonly string[]
  /** True when the URI pinned digests, so the run is identity-asserted. */
  readonly digestAsserted: boolean
}

export type AdoptionDispatchResult =
  | { readonly ok: true; readonly dispatch: AdoptionDispatch }
  | { readonly ok: false; readonly reason: "FORBIDDEN_ARG_PRODUCED"; readonly detail: string }

/**
 * Build the argv for a deep link.
 *
 * `contractRef` is resolved by the CALLER from the slug against locally committed
 * data — it is deliberately not derived from the URI here, so a hostile link cannot
 * choose which bytes get read. `host` likewise comes from local detection.
 */
export function dispatchAdoptionUri(
  request: AdoptionUriRequest,
  contractRef: string,
  host: string,
): AdoptionDispatchResult {
  const argv: string[] = ["safe-install", "--contract", contractRef, "--host", host]

  if (request.expectedArtifactDigest !== null) {
    argv.push("--expect-artifact-digest", request.expectedArtifactDigest)
  }
  if (request.expectedContractDigest !== null) {
    argv.push("--expect-contract-digest", request.expectedContractDigest)
  }

  // Assert over the RESULT, not over the inputs. If any future edit above introduces
  // a write flag — or a caller-supplied value happens to look like one — this fails
  // closed instead of producing a silently more powerful command.
  for (const arg of argv) {
    if (FORBIDDEN_ARGS.includes(arg)) return { ok: false, reason: "FORBIDDEN_ARG_PRODUCED", detail: arg }
  }

  return {
    ok: true,
    dispatch: {
      argv,
      digestAsserted:
        request.expectedArtifactDigest !== null || request.expectedContractDigest !== null,
    },
  }
}

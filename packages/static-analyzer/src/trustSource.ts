import type { AuthorityCapability, TrustSource } from "@calllint/types"

/**
 * Trust-Source Classification (F1) — the `trustSource` compiler for the Authority
 * Manifest (ADR 0041). Answers "what is the trust class of the DATA at the head of
 * this capability?" so Toxic-Flow analysis (ADR 0040) can tell an
 * `untrusted.public_content → send` path (a blocker) from a
 * `trusted.user_explicit → send` one (routine).
 *
 * DERIVE-WHAT-IS-DERIVABLE, DEFAULT `unknown` (ADR 0041 §3). The classification is a
 * pure, deterministic function of the already-captured
 * `(action, resource, scope, destination, evidenceSource, pattern)` — same
 * capability in → byte-identical class out, no clock, no I/O. Any non-`unknown`
 * class MUST be justified by the evidence that already granted the capability
 * (I-07); a class that cannot be *deterministically* established from the shipped
 * signals is left `unknown` (fail-safe). `unknown` never reads as trusted (I-04).
 *
 * Scope boundary (calibration, not a v1.5.0 blocker): the shipped Authority Manifest
 * models *capabilities*, not a first-class inbound-untrusted-content read, so the
 * `untrusted.*` classes cannot yet be produced with precision from config/instruction
 * signals — capabilities that would carry them stay `unknown` until a dedicated
 * inbound-provenance signal is calibrated. Corpus fixtures that exercise `untrusted.*`
 * sources supply the class directly (ADR 0041 §3).
 */

/**
 * Classify one capability's trust source. Total & deterministic: every capability
 * maps to exactly one class, defaulting to `unknown` when nothing stronger is
 * establishable from the shipped signals.
 */
export function classifyTrustSource(cap: AuthorityCapability): TrustSource {
  // read × secret — the data at the head IS a secret (a config secret-shaped env
  // key, or the instruction `sensitive-file-read` pattern). ADR 0041 §3.
  if (cap.action === "read" && cap.resource === "secret") return "sensitive.secret"

  // A local process the config itself names is local-project trust. Narrow on
  // purpose: only the config exec capability, cited to `server.command` — NOT
  // instruction surfaces, whose data provenance (local vs. injected public content)
  // is not deterministically establishable, so those stay `unknown`.
  if (
    cap.action === "execute" &&
    cap.resource === "process" &&
    cap.evidenceSource === "server.command"
  ) {
    return "trusted.local_project"
  }

  // Everything else — external network destinations (a sink, not a trusted source),
  // dangerous instruction patterns whose data origin is unknown, etc. — is not
  // deterministically establishable. Fail safe: `unknown` ↛ trusted (I-04).
  return "unknown"
}

/**
 * Attach a derived `trustSource` to each capability, preserving order. ADDITIVE &
 * MINIMAL: only a non-`unknown` class is attached; capabilities that classify as
 * `unknown` are returned untouched, so they stay byte-identical to a pre-F1 manifest
 * (absent `trustSource` reads as `unknown` = not trusted, per the type contract).
 */
export function withTrustSource(
  caps: readonly AuthorityCapability[],
): AuthorityCapability[] {
  return caps.map((c) => {
    const ts = classifyTrustSource(c)
    return ts === "unknown" ? { ...c } : { ...c, trustSource: ts }
  })
}

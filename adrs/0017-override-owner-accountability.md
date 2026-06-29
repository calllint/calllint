# ADR 0017: Override accountability — `owner` on `PolicyOverride` (S4)

Status: **Accepted — option 0017-B** (optional, validated-if-present; recorded 2026-06-27, implemented same day)

## Context

The master plan's S4 item ("exception → policy-override layer", Conflict A) asks
where the accountability metadata for a security exception should live. An earlier
draft (new2) wanted `owner` / `reason` / `expiry` fields on `BaselineEntry`. That
was rejected: the baseline is a **deterministic drift fingerprint**, and stamping it
with human metadata (who approved, why, until when) would make a pure artifact carry
mutable social state. Conflict A is resolved in favour of **`PolicyOverride`** owning
the exception metadata — it already carries `reason` and `expiresAt` (ADR 0004); the
only thing missing for a complete accountability record is **who** owns the exception.

Today an override answers *why* (`reason`) and *until when* (`expiresAt`) but not
*who is accountable*. In a shared/team policy file, "who signed off on tolerating
this BLOCK" is exactly the audit question a security reviewer asks first.

### What the override layer actually does today (verified)

Per `packages/policy/src/applyPolicy.ts` and `policy.md`: an override is the
*only* policy mechanism that changes a verdict, and it only ever does
`BLOCK → REVIEW` (never `SAFE`), for a named `target`, when an active override's
`allow` set covers every blocking symbol. `validatePolicy` already enforces
`target` + `reason` + `expiresAt`, and gates `EXEC`/`MONEY` behind
`dangerousOverride: true`. This ADR adds an accountability field; it does **not**
change which verdicts an override can produce.

## Decision (accepted — option 0017-B)

Add an **`owner`** field to `PolicyOverride` in `calllint.policy.v0`:

- `owner: string` — an accountable identity for the exception (a handle, team, or
  email; CallLint does not interpret or verify it, only records and echoes it).

Two sub-options for your sign-off (this is the open question):

- **0017-A — `owner` required.** Every override must name an owner, same standing as
  `reason`/`expiresAt`. Strongest accountability; **breaking** for any existing
  override-bearing policy file (none ship in this repo, but external users may have
  them).
- **0017-B — `owner` optional, validated-if-present.** No break; an override without
  an owner stays valid. Weaker guarantee, but a clean additive change. The
  `policy.applied` diagnostic includes the owner when present.

Recommended: **0017-B** — additive, non-breaking, and consistent with "pre-1.0 but
don't break a contract without cause." A later ADR can tighten to required if field
use shows owners are routinely omitted.

**Chosen: 0017-B** (maintainer sign-off, 2026-06-27). `owner` is optional; when
present it must be a non-empty string. No existing policy file breaks. A future ADR
may tighten to required (0017-A) if field use shows owners are routinely omitted.

## Why this needs an ADR

`PolicyOverride` is part of `calllint.policy.v0`. Per CLAUDE.md, **any breaking
change to the policy schema requires an ADR** — and even the additive 0017-B touches
the schema's public shape, so it is recorded here before any code. The baseline
artifact and its fingerprints are explicitly **out of scope**: this ADR reaffirms
that exception metadata never lands on `BaselineEntry` (Conflict A).

## Consequences / required work (none done yet)

If accepted (assuming 0017-B):

- `packages/types/src/policy.ts`: add `owner?: string` to `PolicyOverride` with a
  doc comment ("accountable identity; recorded, not verified").
- `packages/policy/src/validatePolicy.ts`: if `owner` is present, require it to be a
  non-empty string (mirror the `reason` check). For 0017-A, also require its presence.
- `packages/policy/src/applyPolicy.ts`: include `owner` in the `policy.applied`
  diagnostic note when present (e.g. `… — <reason> (owner: <owner>)`), so the audit
  trail in the report names who accepted the risk.
- Tests (CLAUDE.md): a positive case (override with a valid `owner` validates and the
  diagnostic echoes it) and a negative case (empty-string `owner` rejected; for
  0017-A, a missing `owner` rejected). The existing `applyPolicy` BLOCK→REVIEW and
  "never SAFE / never UNKNOWN-downgrade" tests must stay green unchanged.
- `policy.md`: document `owner` in the `PolicyOverride` field list and the
  validation-rules section. Update `examples/policies/override-timeboxed.json` to
  show an `owner` on each override (illustrative, still valid).
- `CHANGELOG.md` `[Unreleased]`: a schema-additive entry citing this ADR. SemVer:
  additive (0017-B) is a MINOR; required (0017-A) is a breaking change pre-1.0,
  still flagged loudly.

Explicitly **not** changing: the set of verdicts an override can produce
(`BLOCK → REVIEW` only), the `dangerousOverride` gate, the `defaults`/`allowedSources`/
`allowedPaths` fields (still declared-not-read; see `policy.md`), or anything on
the baseline/drift path.

## Related

- ADR 0004 (policy-as-code; the `reason`/`expiresAt`/`dangerousOverride` rules this
  extends).
- ADR 0002 (verdict semantics — an override never reaches SAFE).
- `policy.md` (current, verified override behavior).
- Master plan Conflict A (exception fields on PolicyOverride, not BaselineEntry).

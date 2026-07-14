# ADR 0039: Decision Receipt v1 & Gateway Drift Taxonomy

**Status**: Accepted
**Date**: 2026-07-13
**Phase**: G (Automated Trust Gateway Core, v1.3.0) — Milestone G7
**Related**: [0028 Local Receipt Core], [0032 Receipt Signing], [0035 Authority Manifest], [0036 Install Plan & Approval Binding], [0037 Host Adapter Safety Contract]

## Context

The gateway can now `prepare → approve → apply → verify` (G1–G6). What is still
missing is the **durable proof** of *what was approved, under what evidence and
policy, by whom, and when it expires* — and a way to detect when the world has
**drifted** away from that approved state.

The shipped `calllint.receipt.v0` (ADR 0028) is a *scan* receipt: a reporting
layer over a `ScanReport`. It proves "this CallLint version produced this verdict
over this input under this policy". It does **not** bind the six gateway digests
or an apply outcome, so it cannot serve as the gateway's approval record.

This ADR freezes a **new, sibling** schema `calllint.receipt.v1` (the *decision
receipt*) and the **drift taxonomy** the `verify` path uses — before any code, per
the project rule that a schema/receipt change requires an ADR.

## Decision

### 1. `calllint.receipt.v1` is a NEW schema, not a mutation of v0

`v0` (scan receipt) is unchanged and keeps serving `calllint scan --receipt`.
`v1` (decision receipt) is produced by `trust apply` and binds the gateway chain:

```jsonc
{
  "schema": "calllint.receipt.v1",
  "receiptId": "clrec_<base64url>",       // deterministic: derived from planDigest+approvedAt
  "artifactDigest": "sha256:…|null",       // object 1  (null when unpinned/absent)
  "evidenceDigests": ["sha256:…"],          // object 2  (sorted; [] when none)
  "authorityDigest": "sha256:…",           // object 3
  "policyDigest": "sha256:…",              // object 4  (from the decision)
  "decisionDigest": "sha256:…",            // object 4
  "installPlanDigest": "sha256:…",         // object 5  (the approved plan)
  "approval": {
    "type": "local-human",                  // only local-human in v1.3.0
    "approvedAt": "<iso>",
    "approver": "<string|null>",            // e.g. os user; null when unattributed
    "approvedDigest": "sha256:…"            // the exact planDigest the human approved
  },
  "result": "applied",                      // applied | rolled-back | prepared-only
  "host": "claude-code",
  "configPath": "<abs>",
  "configDigestBefore": "sha256:…|absent",
  "configDigestAfter": "sha256:…|null",
  "policyVersion": "<string|null>",
  "scannerVersion": "<cli semver>",         // for scanner-version drift
  "exceptionReason": null,
  "expiration": "<iso>",                    // inherited from the plan's expiresAt
  "supersedes": null,                        // receiptId of a prior receipt, or null
  "revocation": null,                        // { revokedAt, reason } or null
  "signature": null                          // optional ed25519 (reuse @calllint/signature)
}
```

### 2. The receipt body is DETERMINISTIC (so tamper/signing is meaningful)

`buildDecisionReceipt(applyResult, plan, approval, ctx)` is a **pure function**:
same inputs ⇒ byte-identical receipt. There are no `Date.now()`/random calls
inside it — `approvedAt`, `approver`, `scannerVersion`, and any timestamp are
**inputs** injected from the CLI edge (matching how the whole gateway is built).
`receiptId` is derived deterministically from `installPlanDigest + approvedAt`
(NOT random), so re-emitting the same approval reproduces the same id — this is
what lets a receipt point at its `<config>.calllint-backup-<receiptId>`.

The optional `signature` is computed over the canonical receipt **minus the
`signature` field** (identical rule to ADR 0032), reusing `@calllint/signature`.
`signed_at` inside the signature block is the only non-deterministic value and is
outside the signed body.

### 3. A receipt proves provenance, NOT safety

A receipt records *what was approved under what evidence/policy by whom, expiring
when*. It is **not** a certificate that the target is safe, and `verify` never
re-judges a verdict, never re-scans, never executes the target, never touches the
network. This carries the v0 trust-boundary posture into v1.

### 4. Drift taxonomy — 9 signals labeled into 4 change classes

`classifyReceiptDrift(receipt, current)` is **pure**: it compares a receipt
against a `current` snapshot of freshly-computed digests (the caller computes
them; the classifier does no I/O) and emits typed drift entries. Nine signals:

| # | Signal              | Compares                                   | Change class |
|---|---------------------|--------------------------------------------|--------------|
| 1 | `artifact`          | `artifactDigest`                           | **artifact** |
| 2 | `config`            | `configDigestAfter` vs live config bytes   | **artifact** |
| 3 | `tool-metadata`     | tool/skill metadata digest                 | **artifact** |
| 4 | `permission`        | authority capabilities/permissions         | **authority**|
| 5 | `authority`         | `authorityDigest`                          | **authority**|
| 6 | `evidence`          | `evidenceDigests` set                      | **evidence** |
| 7 | `evidence-expiry`   | evidence freshness vs `now`                | **evidence** |
| 8 | `policy`            | `policyDigest` / `policyVersion`           | **policy**   |
| 9 | `scanner-version`   | `scannerVersion` vs current CLI            | **policy**   |

Two **integrity** flags sit alongside the change classes (not change classes
themselves): `signatureChainBroken` (signature present but fails ed25519 verify)
and `expired` (`now > expiration`). A `gateway-downstream` observation — the live
config no longer matches `configDigestAfter` — is signal #2 (`config`, class
`artifact`): the approved change was reverted or overwritten by something else.

### 5. `verify` is fail-closed and never auto-heals

`verifyDecisionReceipt` returns `{ valid, errors, signed, expired, tampered }`.
Structural failure, a broken signature, or (when checked against a public key)
a crypto failure ⇒ `valid: false`. Expiry is reported but is not a structural
error (an expired receipt is still a *valid record* of a past approval; the
caller decides whether to act on it). `verify` NEVER rewrites the receipt, the
config, or anything else — detecting drift is a read-only operation.

## Non-negotiables locked by this ADR

- `receipt.v1` is a new sibling schema; `receipt.v0` is untouched.
- The receipt body is deterministic; timestamps/approver/version are injected inputs.
- `receiptId` is derived from `installPlanDigest + approvedAt`, never random.
- A receipt proves provenance, not safety; `verify` never re-judges/re-scans/executes.
- Signing reuses `@calllint/signature`; signature covers the body minus `signature`.
- Drift = 9 signals → 4 change classes {artifact, authority, evidence, policy} + 2
  integrity flags {expired, signatureChainBroken}. All classification is pure.

## Consequences

### Positive
- One durable, portable object proves an approval and its full provenance chain.
- Drift detection reuses the same digests the gateway already computes — no new
  trust surface, no re-scan.
- Signing is optional and local; an unsigned receipt is still a structurally
  verifiable record.

### Negative
- A second receipt schema exists alongside v0. Mitigated: they serve different
  subjects (scan vs gateway decision) and share the signature machinery.

### Trade-offs
- Chose a **deterministic** receipt (timestamps as inputs) over a convenient
  `Date.now()` inside the builder — determinism is what makes signing and repeat
  verification meaningful, and matches every other gateway object.
- Chose to report expiry as **non-fatal** to `valid` — an expired receipt is a
  true historical record; treating expiry as corruption would be wrong.

## Compliance / gate impact

G7 acceptance is bound to this ADR: deterministic builder (byte-identical repeat),
tamper detection (mutated body ⇒ `verify` fails), expiry detection, all 9 drift
signals + 4 classes covered by tests, optional ed25519 sign/verify roundtrip, and
`verify` proven read-only (no writes, no network, target never executed). Any
change to `receipt.v1` or the drift taxonomy requires a new ADR.

[0028 Local Receipt Core]: ../docs/adr/0028-receipt-first-trust-layer.md
[0032 Receipt Signing]: ../docs/adr/0032-cloud-signed-receipt-infrastructure.md
[0035 Authority Manifest]: ./0035-automated-trust-gateway-authority-manifest.md
[0036 Install Plan & Approval Binding]: ./0036-install-plan-approval-binding.md
[0037 Host Adapter Safety Contract]: ./0037-host-adapter-safety-contract.md

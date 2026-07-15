# ADR 0043: Schema `$id` Domain Consistency (`calllint.dev` → `calllint.com`)

**Status**: Accepted
**Date**: 2026-07-15
**Phase**: Cleanup (post-v1.4.0)
**Supersedes**: none
**Related**: [0036 Install Plan & Approval Binding](./0036-install-plan-approval-binding.md), [0039 Decision Receipt v1 & Drift Taxonomy](./0039-decision-receipt-v1-and-drift-taxonomy.md)

## Context

CallLint JSON Schemas declare a canonical `$id` of the form
`https://calllint.com/schemas/<name>.schema.json`. Eight of the ten schemas use the
canonical `calllint.com` domain (`authority-manifest`, `decision`, `artifact-identity`,
`evidence-provider`, `receipt`, `agent-inbox-event`, `action`, plus the corpus schema).

Two schemas added during Phase G (Trust Gateway) drifted to a different host,
`calllint.dev`:

- `schemas/install-plan.schema.json` — `calllint.install-plan.v1`
- `schemas/decision-receipt.schema.json` — `calllint.receipt.v1`

`calllint.com` is the project's canonical domain: it is the website, the `homepage` in
`apps/cli/package.json`, the security-contact domain, and the host used by every other
schema `$id`. `calllint.dev` is not a domain CallLint publishes under. The split was an
inconsistency, not a deliberate two-domain design.

## Decision

Normalize the two outliers to the canonical domain:

```
https://calllint.dev/schemas/install-plan.schema.json
  → https://calllint.com/schemas/install-plan.schema.json

https://calllint.dev/schemas/decision-receipt.schema.json
  → https://calllint.com/schemas/decision-receipt.schema.json
```

## Why this is non-breaking

The wire contract for every CallLint object is its **`schema` / `schema_version` tag**
(the `const` string, e.g. `calllint.install-plan.v1`, `calllint.receipt.v1`), **not** the
`$id` URL. Verified before the change:

1. **No cross-schema `$ref` uses these `$id`s.** Every `$ref` in the repo is a local
   pointer (`#/definitions/...`). Changing an `$id` resolves no differently.
2. **No code reads the `$id` string.** Grep over `packages/` and `apps/` for `calllint.dev`
   returns only the two schema files themselves; nothing imports, compares, or fetches the
   `$id` URL. Object validation keys off the `schema`/`schema_version` `const`, which is
   unchanged.
3. **No test asserts on the `$id`.** The two schema-touching tests
   (`report-renderer/sarif-schema`, `fixtures/agent-inbox`) do not reference these
   schemas' `$id`.
4. **The `$id` URLs were never resolvable content.** Neither `calllint.com/schemas/*` nor
   `calllint.dev/schemas/*` is fetched at runtime; the schemas ship in-repo.

Therefore the change is a cosmetic identity normalization with no effect on validation,
determinism, digests (the object digest is `hashJson` over the object minus its own
`digest`/`$id`-free content — the `$id` is schema metadata, not object data), or any
emitted artifact.

## Consequences

- **Positive**: all ten schema `$id`s now share one canonical domain; no reader can be
  confused about which host is authoritative; removes a latent trust-signal inconsistency
  in a security product's public schemas.
- **Cost**: none beyond this two-line change + this ADR.
- **Follow-up**: none. If CallLint ever publishes schemas at a resolvable URL, they resolve
  under `calllint.com` consistently.

## Invariants preserved

Object `schema`/`schema_version` tags unchanged · no `$ref` resolution change · digests
unchanged · determinism unchanged · no `ScanReport`/policy/receipt *object* schema change
(only the metadata `$id` host).

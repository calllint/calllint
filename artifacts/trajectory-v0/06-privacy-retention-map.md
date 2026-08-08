# 06 — Privacy and retention map

Answers T0 question 7, and measures what a trajectory feature would inherit on the privacy and
retention axes — the axes where "we will add it later" is most expensive, because collected data
outlives the decision to collect it.

**Status: flag system `ABSENT` · retention `PARTIAL` (one surface bounded, and it was bounded in
this batch) · outbound transmission `ABSENT`.**

## Q7 — what is the Feature Flag system?

**`ABSENT`.** Measured: **0** occurrences of `featureFlag` / `feature_flag`, case-insensitive, under
any `packages/*/src`. No registry, no defaults table, no typed accessor, no kill switch, no per-flag
docs.

What exists is direct environment reads in **8** source files:

| File | Purpose of its env read |
| --- | --- |
| [packages/discovery/src/extractors/base.ts](../../packages/discovery/src/extractors/base.ts) | discovery extraction |
| [packages/discovery/src/path-resolver.ts](../../packages/discovery/src/path-resolver.ts) | host config path resolution |
| [packages/trust-index/src/bake.ts](../../packages/trust-index/src/bake.ts) | bake-time input |
| [packages/trust-index/src/projectAdoptionIndex.ts](../../packages/trust-index/src/projectAdoptionIndex.ts) | projection source selection |
| [packages/trust-index/src/pruneCas.ts](../../packages/trust-index/src/pruneCas.ts) | both retention windows |
| [packages/trust-index/src/refreshSnapshot.ts](../../packages/trust-index/src/refreshSnapshot.ts) | ingest feature switches |
| [packages/trust-index/src/resolveEvidence.ts](../../packages/trust-index/src/resolveEvidence.ts) | evidence resolution |
| [packages/trust-index/src/verifyClaims.ts](../../packages/trust-index/src/verifyClaims.ts) | claim verification |

Six of the eight are in `trust-index`, i.e. the *operational* plane — bake, ingest, prune. None is in
`risk-engine`, `types`, or `policy`: **no environment variable influences a verdict.** That is a real
property and it is worth stating positively, because it means the absent flag system has never been
needed on the decision path.

**Consequence.** There is no mechanism to ship trajectory collection dark, and no established way to
disable it per-host after shipping. A design assuming "land it behind a flag" must first build the
flag system (a new subsystem, out of T0/T1 scope) or add a ninth bare `process.env` read with its own
validating parser.

The pattern the repo actually uses, from this batch's own R-9 work, is per-variable rigour rather
than a framework: a named variable, a parser that refuses zero / negative / non-integer, the chosen
value recorded in the systemd unit, and a gate pinning the unit so the value cannot silently fall
back to a code default. Two variables were shipped that way — `CAS_RETENTION_DAYS` and
`CAS_STAGING_ORPHAN_HOURS`. That is the bar a trajectory switch would be held to.

## Retention — what is bounded today

| Surface | Bound | Binding | Status |
| --- | --- | --- | --- |
| CAS blobs (`cas/blobs`) | `CAS_RETENTION_DAYS=90`, swept daily | [packages/trust-index/src/casRetention.ts](../../packages/trust-index/src/casRetention.ts) · [pruneCas.ts](../../packages/trust-index/src/pruneCas.ts) | **bounded** |
| CAS staging (`work/*.part`) | `CAS_STAGING_ORPHAN_HOURS=48` | same | **bounded, newly** — had no sweeper before this batch |
| Adoption-index SQLite rows | Every table upserts (`ON CONFLICT`); row count tracks corpus size | `packages/adoption-index/src/storage/` | **bounded by corpus** |
| `compiler_runs` | The one table with no conflict clause — one row appended per run | measured this batch | **monotonic**, ~1 row/day sub-kB → hundreds of kB/year |
| Receipts | `expiration` field exists (ISO-8601 UTC), 10+ files carry `expiresAt`/`expiration` | [decisionReceipt.ts:80-81](../../packages/types/src/decisionReceipt.ts#L80-L81) | **expiry is representable**; no sweeper measured |
| Store backups | date-stamped, one object/day, remote lifecycle 90 days | `deploy/adoption-index/` (this batch) | **bounded** |

Two properties of this table bear on a trajectory design:

1. **`DELETE FROM` and `VACUUM` have 0 occurrences under `packages/adoption-index/src`.** Nothing on
   the SQLite side deletes any row, ever. That is correct for upsert tables whose size tracks the
   corpus — but it means **"retention" on the store side has no existing implementation to extend.**
   A trajectory table, unlike every current table, would grow with *time and activity* rather than
   with corpus size, so it would be the first table in the store needing row-level retention. That
   is a new capability, not a configuration.
2. **Retention is enforced at the filesystem, not in the schema.** Both bounded surfaces are swept
   by an external script on a systemd timer. There is no TTL column, no expiry index, and no
   sweep-on-write anywhere in the store.

## Outbound transmission

**`ABSENT`.** Measured: **0** occurrences of `fetch(` / `http.request` / `axios` under any
`packages/*/src` outside `trust-index` (whose reads are registry ingestion — inbound). No
CallLint package transmits data anywhere.

`schemas/telemetry-event.schema.json` exists, so a telemetry *shape* is defined — but nothing sends
it. This is a shipped-not-wired shape, and naming it matters: a trajectory design that reused the
telemetry schema would be the first thing to give it a transmitter, and that is a privacy decision
with an ADR, not an integration detail.

## What a trajectory feature would inherit

Recorded as measured constraints, not recommendations — the recommendations are in
[09](09-recommended-delta.md):

| Question a design must answer | What exists to build on |
| --- | --- |
| Where does trajectory state live? | No session store, no session table ([05](05-existing-state-and-receipt-map.md)). Nothing to extend |
| How is it bounded? | No row-level retention anywhere in the store; filesystem sweeps only |
| Can it ship disabled? | No flag system; 8 bare `process.env` reads as precedent |
| Can it be attached to a receipt? | No — `additionalProperties: false` × 29 + a gate ([02](02-schema-and-type-map.md)) |
| Does anything leave the machine? | No transmitter exists today |
| Is the data even complete? | No — guaranteed incomplete, three ways ([04](04-host-evidence-capability-matrix.md)) |

The last row is the one that dominates. Retention and privacy questions about trajectory data are
premature in a specific, measurable sense: the Host cannot emit a complete trajectory
([04](04-host-evidence-capability-matrix.md) Q10), so the data whose retention would be designed does
not yet exist in a form worth retaining.

## What this chapter does not claim

- No audit of what personal data current findings may contain. The question asked was about the flag
  system and retention mechanisms; a PII audit of the evidence model was not performed and is not
  claimed.
- No measurement of receipt expiry *enforcement*. The `expiration` field exists and is populated;
  whether any consumer refuses an expired receipt was not measured.
- `compiler_runs` growth is arithmetic from one row per run at sub-kB, not from a measured table on
  a live host.

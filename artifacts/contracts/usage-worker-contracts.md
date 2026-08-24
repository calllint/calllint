# Usage Worker Contracts

**Replaces**: "queue ACK" and "privacy cleanup" (informal, no measurable semantics)

**What this is**: The ingestion acknowledgement contract and the privacy-safe schema
validation contract, both enforced at `POST /v1/events/usage` (the usage-worker).

---

## Contract 1: Ingestion Acknowledgement

**Old name**: "queue ACK"  
**Observable behavior**: When the worker returns HTTP 204, the client may clear the
batch from its queue; the worker guarantees it was folded into D1 exactly once.

### Semantics

- **Idempotency**: A batch identified by `batchId` (SHA-256 hex digest of the event
  fingerprints) is acknowledged on the FIRST successful POST. Replays (same `batchId`)
  return HTTP 204 immediately without re-folding counters.

- **Transactionality**: The `batchId` ledger row (`usage_ingested_batches`) is inserted
  in the SAME D1 transaction as the counter updates. If any part fails, the batch is
  NOT ledgered, so a client retry folds it in cleanly rather than half-applying it.

- **All-or-nothing**: Invalid events reject the WHOLE batch. A partially-accepted batch
  would be acknowledged (client clears queue) but some events would vanish. All-or-nothing
  keeps retry semantics honest.

- **What HTTP 204 means**: "I have this batch in my ledger, and its counters are in D1."
  Not "I received bytes" or "I parsed JSON". The ACK is the durability guarantee.

### Implementation

`apps/usage-worker/src/index.ts` lines 150-219: idempotency check → aggregate → batch
transaction.

---

## Contract 2: Privacy-Safe Schema Validation

**Old name**: "privacy cleanup"  
**Observable behavior**: The worker accepts ONLY the allowlisted event shape defined
in `@calllint/telemetry-contract`. Forbidden fields are rejected at the boundary, not
silently stripped.

### What makes it privacy-safe

1. **Server-side re-validation**: The client's `sanitizeEvent` runs on the reporter's
   machine, which an attacker controls completely. The worker re-implements validation
   AGAINST THE SAME VOCABULARY (`packages/telemetry-contract/src/events.ts`) so
   client-side sanitization cannot be bypassed.

2. **Fail-closed on forbidden fields**: Fields that carry secrets, commands, or private-repo
   identity (the `FORBIDDEN_FIELDS` denylist) are rejected on PRESENCE ALONE, not silently
   stripped. Silently stripping would make a leak invisible; failing closed makes an
   attempt noisy.

3. **Bounded dimensions**: Open-ended fields (`hostFamily`, `inputKind`, `productVersion`)
   are token-checked (alphanumeric + `._+-`, no `/` or `@`, max 64 chars). Closed-vocabulary
   fields (`discoverySurface`, `source`, `result`) are enum-checked. Enum checking prevents
   row-count amplification: a hostile client cannot mint unbounded distinct values that
   each become a new primary key in `usage_daily_counts`.

4. **Installation ID hashing**: `anonymousInstallationId` is HMAC'd immediately after
   validation and the raw value is discarded (never persisted, never logged). The HMAC
   key is the `USAGE_HASH_KEY` Worker secret.

5. **IP/User-Agent never persisted**: `CF-Connecting-IP` and `User-Agent` are read ONLY
   for rate limiting and are never written to D1 (new18 §20).

### What the validation rejects

- Unknown `schema` (not `calllint.telemetry-batch.v0`)
- Invalid `batchId` (not a 64-char hex digest)
- Empty or oversized `events` array (1-100 events, hard cap)
- Off-vocabulary `eventName` / `source` / `result` / `discoverySurface`
- Malformed `timestamp` (unparseable, out of 2024-2100 range)
- Invalid dimensions (too long, contains `/`, not alphanumeric+allowed punctuation)
- Malformed `anonymousInstallationId` (not `cli-anon-<uuid>` format)
- Presence of any `FORBIDDEN_FIELDS` member

### Implementation

`apps/usage-worker/src/validate.ts`: `validateBatch()` function, lines 130-231.

### Contract assertion

The `@calllint/telemetry-contract` vocabulary is the single source of truth for both
client and server. If the vocabularies drift apart, tests fail:
- `apps/usage-worker/test/validate.test.ts` (server-side validation unit tests)
- `.github/workflows/security-boundary.yml` (verifies no forbidden field ever appears in telemetry-emit's output)

---

## Why these are separate contracts

"Queue ACK" describes **when** the client may clear its queue (after 204). "Privacy cleanup"
describes **what** the worker accepts (allowlist + reject forbidden). The two concerns
are orthogonal: a batch can be valid-but-not-idempotent (already seen) or
invalid-but-idempotent (malformed on first POST). Conflating them makes neither testable
alone.

## What this replaces

- "queue ACK" → **Ingestion Acknowledgement** (idempotency + transactionality semantics)
- "privacy cleanup" → **Privacy-Safe Schema Validation** (fail-closed + bounded dimensions)

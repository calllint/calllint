# Action Fixtures — Contract & Stub Directory (R4 / v0.9.0)

This directory holds **fixture contracts and stubs** for `calllint action inspect`
(ADR 0029). **No real fixtures exist yet** — they are written during implementation
(post-ADR-acceptance), not in the design phase (R4 / v0.9.0).

## Fixture contract (per action kind)

Every action `kind` in `calllint.action.v0` requires **three artifacts** before its
detector wiring merges:

### 1. Positive fixture
An action descriptor of that kind with a **clear risk signal** ⇒ expected verdict
REVIEW or BLOCK, with expected findings listed.

**Example (email.reply):** descriptor with a secret-shaped header key (`Authorization`,
`X-API-Token`) ⇒ verdict REVIEW, finding `secrets.env-key`, reason code
`SECRET_IN_WORKSPACE_CONFIG`.

**Format:** `<kind>/positive-<scenario>.json` + `<kind>/positive-<scenario>.expected.json`

### 2. Negative fixture
A **benign** action descriptor of that kind ⇒ expected verdict SAFE or REVIEW (but
not BLOCK), with **no false-positive findings**.

**Example (payment.authorize):** descriptor with $0.01 to a known test account ⇒
verdict SAFE or REVIEW (small amount, test context), no `action.financial-observed`
false alarm.

**Format:** `<kind>/negative-<scenario>.json` + `<kind>/negative-<scenario>.expected.json`

### 3. Unit test stub
A vitest test that loads the fixture, calls `analyzeAction(descriptor)` (once
implemented), and asserts the expected verdict / findings / reason codes.

**Format:** `<kind>/<kind>.test.ts`

---

## Directory structure (stub, not yet populated)

```
packages/fixtures/action/
├── README.md                   ← this file
├── email.reply/                ← stub directory for email.reply kind
│   └── .gitkeep                ← placeholder (no real fixtures yet)
├── email.forward/              ← stub directory for email.forward kind
│   └── .gitkeep
├── message.post/               ← stub directory for message.post kind
│   └── .gitkeep
├── a2a.delegate/               ← stub directory for a2a.delegate kind
│   └── .gitkeep
├── payment.authorize/          ← stub directory for payment.authorize kind
│   └── .gitkeep
├── account.register/           ← stub directory for account.register kind
│   └── .gitkeep
├── github.write/               ← stub directory for github.write kind
│   └── .gitkeep
├── npm.publish/                ← stub directory for npm.publish kind
│   └── .gitkeep
└── cloud.modify/               ← stub directory for cloud.modify kind
    └── .gitkeep
```

**All `.gitkeep` placeholders are removed when the first real fixture is added to
that kind's directory.**

---

## Fixture authoring rules (enforced during implementation)

1. **No fabricated real-provider payloads.** A positive fixture may use a real npm
   package name / GitHub repo / email domain as a **base**, but any risk signal
   (secret header, large payment amount, unknown delegation target) must be
   **clearly labelled synthetic** in the fixture's `provenance` or adjacent
   `.notes.md`. Never present a synthetic payload as a real snapshot.

2. **Negative fixtures use real benign examples.** Prefer actual test-account emails,
   $0.01 sandbox payments, known-safe GitHub repos. Provenance recorded in
   `.notes.md`.

3. **Expected verdict / findings are immutable.** Once a fixture's `.expected.json`
   is committed, it cannot be weakened to make a test pass (per CLAUDE.md). If a
   detector changes and the expected verdict shifts, write an ADR first.

4. **Offline-invariance.** Action fixtures must not require network access. Use
   injected fetch stubs (as in `packages/online/test/online.test.ts`) if the
   `analyzeAction` path calls online enrichment.

---

## Implementation checkpoint (post-ADR-0029-acceptance)

When ADR 0029 moves from **Proposed → Accepted**, the implementation phase begins:

1. Write `packages/action-analyzer/src/analyzeAction.ts` (or equivalent module in
   `@calllint/core`).
2. For each action `kind`, write positive + negative fixtures in its stub directory.
3. Write unit tests that load fixtures and assert expected verdicts.
4. Wire `apps/cli/src/commands/action.ts` to call `analyzeAction` and render the
   `ScanReport`.
5. Run full gate suite (`pnpm typecheck && pnpm test && pnpm corpus:test`) — action
   fixtures do **not** count toward the existing 60-case MCP corpus (separate
   fixture suite).

**R4 / v0.9.0 deliverable:** this README + stub directories. No real fixtures, no
tests, no runtime code.

---

## Questions / clarifications

- **Open question 1 (ADR 0029):** Should `metadata.attachment_hashes` be required
  for `has_attachments: true`, or optional with an `action.unverified-attachment`
  finding?
  - *Tentative:* required when `has_attachments: true`; unhashed attachments →
    REVIEW-class finding.

- **Open question 2 (ADR 0029):** `a2a.delegate` target identity format (URL,
  agent ID, public key hash)?
  - *Tentative:* string (URL or agent ID); unknown targets → `supply.unknown-remote`.

- **Open question 3 (ADR 0029):** `cloud.modify` resource_type — closed enum or
  open string?
  - *Tentative:* open string for v0; pattern-match high-risk types for MONEY/EXEC.

- **Open question 4 (ADR 0029):** Policy override scoping for action kinds
  (`pattern: "action:email.*"`, new `action_kind` field, or `scope` value)?
  - *Tentative:* `pattern: "action:email.*"` reuses existing glob logic.

**(To be resolved during ADR review, before implementation.)**

---

## References

- ADR 0029: Unified External Action Preflight (`calllint action inspect`)
- ADR 0028: Receipt-first Trust Layer (schema reuse)
- ADR 0020: Compact Decision + 12 reason codes (action kinds map to these)
- CLAUDE.md: never weaken a fixture's expected verdict to pass a test
- new5 master plan: R4 / v0.9.0 design-first, zero runtime code until ADR Accepted

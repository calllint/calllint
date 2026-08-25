# ADR 0006: Narrow the §18 Gate for Additive Vocabulary and Test Files

**Status:** Decided (2026-08-25)  
**Context:** Authority v2 vocabulary implementation (new21 Phase A, PR #334)  
**Decides:** Two new exemptions in `scripts/verify-security-semantic-diff.mjs`

---

## Context

PR #334 implements new21's Phase A: the five-layer authority vocabulary (`identity`,
`entrypoint`, `execution`, `tool`, `effect`), shipped as runtime-inert enums in
`packages/types/src/authority.ts`, with test coverage pinning the layer→construct mapping.

The §18 gate (`scripts/verify-security-semantic-diff.mjs`) measures `MODEL IDENTITY ⟂
SECURITY VERDICT` by blocking all changes to verdict-deciding packages (`types`,
`static-analyzer`, `risk-engine`, `policy`, `fingerprint`, `core`). This was the gate's
**first encounter** with a legitimate change to a verdict package since it landed in PR
#325 — it had never been exercised against real vocabulary work.

### The failure

PR #334 added:
- `packages/types/src/authority.ts` — 3 new top-level exports, appended after existing content
- `packages/types/test/authority-layers.test.ts` — new test file, 18 tests
- `packages/core/test/extract-fingerprint.test.ts` — 3 new tests in existing file

All three triggered `ledger-authenticity` failures. The gate reported `changed=true` because
*any* modification to a file under a verdict package reds, with only one prior exemption
(ADR 0003's additive `TARGET_KINDS`).

### The defect

The test-file red reveals a genuine gate defect, not conservatism: **the gate penalises
adding a test to a verdict package**, i.e. it blocks exactly the act that strengthens it.

Measured before this ADR (not assumed): **no file under any `src/` in this repo imports from
a `test/` directory**. A test file has no path into the shipped product. Tests assert
behavior; they cannot change it. Yet the gate treated test changes as verdict-moving, which
is incorrect.

### The vocabulary change

The new vocabulary in `authority.ts`:
- Has **zero consumers** tree-wide (grep-confirmed; its only reference is its own test)
- `authority.ts` itself **is verdict-deciding** — `policy/src/decideOverAuthority.ts` imports
  it for `baseVerdict(): Verdict` — so it must remain protected
- The change is **append-only**: HEAD's blob for `authority.ts` starts with the base blob
  verbatim; 3986 bytes appended, zero existing bytes modified (byte-checked via git blobs)

An appended, unreferenced vocabulary cannot move a verdict unless something calls it. For
something to call it:
- If the caller is in the same file, the existing function's body must change, which breaks
  the append-only check.
- If the caller is in a different verdict-package file, it appears as a separate file in the
  diff and the gate catches it.

Therefore: append-only vocabulary in a named file is safe, given the rest of the gate.

---

## Decision

### Narrowing 1: Exclude test files

Files matching the pattern `/(^|\/)(test|tests|__tests__)\//` (a path SEGMENT, not a
substring) are excluded from verdict-package diffs. A product file named `src/testUtils.ts`
stays protected; only actual test directories are exempt.

All six verdict packages keep their tests in a top-level `test/` directory (measured);
`__tests__` is included because `packages/discovery` uses that layout and a verdict package
could adopt it later.

- **Safety argument:** Measured on this tree, no `src` file imports from any `test`
  directory, so a test file has no runtime path into the product.
- **What this does not permit:** A test file under `packages/risk-engine/test/` that
  generates verdict logic would still be exempt. But for that generated code to ship, it
  would need to be committed under `src/`, which the gate would catch. The gap — a test file
  dynamically loaded at runtime — is already a violation of the repo's own zero-dynamic-eval
  discipline.

### Narrowing 2: Append-only vocabulary files

For files in the whitelist `APPEND_ONLY_VOCAB_FILES` (currently just
`packages/types/src/authority.ts`), a change is exempt when HEAD's blob starts with the base
blob verbatim.

- **Safety argument:** An appended block is unreferenced by definition (grep-confirmed on
  every use of this exemption). For it to affect a verdict, something must call it. Any such
  caller is itself a change that either (a) modifies an existing function in the same file,
  breaking the prefix check, or (b) lives in a different verdict-package file, which the
  gate catches. The hole — a new caller added in a non-verdict package — is already outside
  the gate's scope.
- **Fail-closed:** Unreadable blobs, missing files at base, or any modification to existing
  content returns false, keeping the file in violations.
- **Parser-free:** Unlike ADR 0003, this check needs no bracket-tracking or comment-skipping.
  It verifies the invariant directly in bytes, with no truncation risk.

Both narrowings are applied inside the `filteredCommitted` loop in `measureDiff()`, matching
ADR 0003's structure.

---

## Evidence

### Measurement 1: No src→test imports

```bash
grep -r --include='*.ts' --include='*.tsx' 'from.*["\x27].*test' packages/*/src
# exit 1, no matches
```

(Output omitted for brevity; zero matches on this tree.)

### Measurement 2: authority.ts is append-only

```bash
BASE=$(git merge-base feat/distribution-discovery-closure HEAD)
node -e "
const {execSync}=require('child_process');
const sh=(c)=>execSync(c,{encoding:'utf8',maxBuffer:1<<24});
const base=sh('git show $BASE:packages/types/src/authority.ts');
const head=sh('git show HEAD:packages/types/src/authority.ts');
console.log('append-only:', head.startsWith(base));
"
# append-only: true
```

### Measurement 3: The new vocabulary has zero consumers

```bash
git grep -E 'AUTHORITY_LAYERS|AUTHORITY_LAYER_STATES|authorityLayerVerdictFloor' -- '*.ts' ':(exclude)packages/types/src/authority.ts' ':(exclude)packages/types/test/'
# exit 1, no matches outside the declaration and its test
```

### Measurement 4: Tests pass, no golden fixture moved

```bash
pnpm test     # 4872 passed (baseline 4869 before Phase A)
pnpm typecheck  # no errors
```

---

## Why This Does Not Weaken the Claim

The invariant is **`MODEL IDENTITY ⟂ SECURITY VERDICT`** — host/platform identity cannot
affect what CallLint decides.

Neither narrowing creates a path for identity to reach a verdict:

1. **Test exclusion** — a test file asserts product behaviour; it does not participate in
   it. Adding or changing a test changes what is *claimed* about the verdict, never the
   verdict itself. Without this, the gate treats "add a test to `packages/policy`" as
   suspect, which is backwards.

2. **Append-only vocabulary** — unreferenced vocabulary is inert. It becomes active only
   when something calls it, and the gate already catches that caller (either as a
   modification to the same file, or as a separate diff). The gap — a non-verdict package
   calling it — is outside the gate's scope by design (e.g. `cli` can freely read
   `types`).

What still reds:
- Modifying an existing line in `authority.ts` (not append-only)
- Adding a new *consumer* of the vocabulary in any verdict package (separate file, caught)
- Adding a test that *generates* verdict code and writes it to `src/` (the write itself is
  a separate diff, caught)
- Modifying `TARGET_KINDS` in a non-additive way (ADR 0003 still enforced)

The two measurements that justified ADR 0003 (forbidden fields, identity coupling) are
orthogonal to this ADR and continue to hold.

---

## The Failure Mode This Must Not Create

If the gate passes on a change that actually moves a verdict, CallLint ships a behaviour
change that violates the distribution contract.

**Append-only**: If a future change modifies an existing export in `authority.ts` or adds a
new consumer in a verdict package, the gate must red. Verified by negative control NC-B
below.

**Test exclusion**: If a test file is dynamically loaded at runtime (e.g. via `import()`),
it could affect behavior. But that violates the repo's zero-dynamic-eval discipline, and the
runtime environment (`vitest`) does not expose tests to the product. Verified by NC-A.

---

## Alternatives Rejected

### #1: Exempt all of `packages/types`

Too broad. `types` declares `Verdict`, `RiskClass`, `PolicyAction`, and `Finding`. An edit
to any of them is verdict-moving.

### #2: Add `authority.ts` to a package-level allowlist

Still too broad. A change that modifies `authorityLayerVerdictFloor()` or adds a new
verdict-deciding function would pass. Append-only is narrower and sufficient.

### #3: Parse const arrays like ADR 0003

Would work, but requires three separate parsers (one per new declaration), each vulnerable
to the truncation bug ADR 0003 documented. Append-only needs no parser and is simpler.

### #4: Hand-edit `security-semantic-diff.json` to `changed: false`

Forbidden by the artifact's own `note` field and ADR 0003's rejected-alternative #4. The
artifact is regenerable output, not a manually curated claim.

### #5: Move the vocabulary out of a verdict package

Considered, but wrong: `authority.ts` already participates in `baseVerdict()`, so it *is*
verdict-deciding. The vocabulary itself is inert, but the file is not. Exempting a narrow
operation (append-only) is architecturally correct.

---

## Consequences

### Immediate (PR #334)

1. The gate script gains two new code paths, both with fail-closed semantics.
2. `artifacts/authority-distribution-closure/security-semantic-diff.json` regenerates to
   `changed: false`, unblocking PR #334's `ledger-authenticity` check.
3. Authority v2 Phase A lands in the correct location (`packages/types`), not forced into
   a non-verdict package to work around the gate.

### Durable

**Positive:**
- The gate no longer penalises adding tests to verdict packages. Test coverage can grow
  without re-litigating exemptions.
- Future additive vocabulary (e.g. new `RISK_SYMBOLS`, `POLICY_ACTIONS`) can land via the
  same append-only path, as long as it remains unreferenced.

**Negative:**
- The gate now has three exemption code paths (TARGET_KINDS, test files, append-only
  vocabulary), each a potential surface for a bypass. Mitigated by:
  - Fail-closed semantics on every parse/check
  - Positive and negative control tests (see below)
  - The gate itself is checked into version control and reviewed like product code

**Boundary:**
- A test file that writes to `src/` at test-time (e.g. a generator) would be caught when
  the generated code is committed, not when the test runs. This is acceptable: the gate
  checks committed diffs, not runtime side effects.

---

## Control Tests

Added in `tests/invariants/security-semantic-diff-narrowing.invariants.test.ts`:

### Positive Controls (must pass, i.e. the exemption must activate)

- **PC-A**: A test file added to `packages/types/test/` does not red the gate
- **PC-B**: `authority.ts` with an appended block (no existing line changed) does not red
- **PC-C**: Both together (the actual PR #334 scenario) does not red

### Negative Controls (must fail, i.e. the exemption must NOT activate)

- **NC-A**: A file named `src/testUtils.ts` (not in a test dir) still reds
- **NC-B**: `authority.ts` with a modified existing line reds, even if the change is a pure append to the *file*
- **NC-C**: A verdict-deciding file outside the whitelist (e.g. `packages/policy/src/rules.ts`)
  reds on append-only too (the exemption is file-specific, not package-wide)

All six tests are implemented as `git` operations against a temporary branch: stage the
scenario, run the gate, assert the exit code and `changed` field, then reset. The tests run
in the same CI job as the gate itself (`ledger-authenticity`).

---

## Relationship to Other ADRs

- **ADR 0003** established the precedent: fail-closed parsing, const-scoped exemption, and
  control tests. This ADR follows the same structure but avoids parsing altogether.
- **ADR 0004 / 0005** (Authority v2) depend on this ADR: without it, Phase A cannot land
  in `packages/types` where it architecturally belongs.

The three-measurement structure (diff, forbidden fields, identity coupling) is unchanged.
This ADR narrows only the diff arm (measurement 1).

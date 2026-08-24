# ADR 0003: Narrow §18 gate to additive TARGET_KINDS

**Status:** Proposed (2026-08-24)

**Context:**

Commit b2aa79e and 78d4573 (this PR) added three new extractors (Kiro, Gemini CLI, Codex) and
introduced two new `TargetKind` values (`opencode-mcp`, `codex-mcp`) into `packages/types/src/report.ts`.
The §18 security-semantic zero-diff gate (`scripts/verify-security-semantic-diff.mjs`) now fails
CI with `SECURITY_SEMANTICS = CHANGED`, claiming a verdict-deciding file moved.

The gate exists to enforce the §18 invariant: **MODEL IDENTITY ⟂ SECURITY VERDICT**. From the
script's own comment:

> The distribution work is allowed to change how CallLint is FOUND. It is not allowed to change
> what CallLint DECIDES.

The gate compares diffs across six verdict-deciding packages, one of which is `packages/types`.
The gate's rationale already excludes `resolver` and `config-parser`:

> `resolver` and `config-parser` are deliberately excluded: they decide what gets scanned, not
> what the scan concludes. Discovery of a new host legitimately touches them, which is exactly
> the kind of change this gate must permit.

**The problem:** `TARGET_KINDS` in report.ts is a const array defining the schema of config file
formats CallLint can parse — exactly the "what gets scanned" category the gate's rationale says
must be permitted during discovery work. But `packages/types` also contains verdict-deciding
structures (`Verdict`, `RiskClass`, `PolicyAction`, `Finding`) that must NOT change in the same
PR as discovery work, or the orthogonality claim becomes unfalsifiable.

The gate's whole-package granularity cannot express this distinction, even though the rationale
would allow it.

**Evidence that TARGET_KINDS does not reach verdict logic:**

```bash
$ grep -rc "TargetKind\|targetKind" packages/risk-engine/src/*.ts
packages/risk-engine/src/assessServer.ts:0
packages/risk-engine/src/computeReproducibility.ts:0
packages/risk-engine/src/computeRiskClass.ts:0
packages/risk-engine/src/computeVerdict.ts:0
packages/risk-engine/src/index.ts:0
$ grep -rc "TargetKind\|targetKind" packages/policy/src/*.ts
(all 0)
```

The value is consumed by `config-parser` (which the gate already exempts) and passed through
`packages/types` solely as the schema of file formats, analogous to JSON key names.

**Decision:**

Narrow the §18 gate to permit additive-only changes to the `TARGET_KINDS` const array in
`packages/types/src/report.ts`, while maintaining fail-closed protection against all other
modifications to that package.

When `packages/types/src/report.ts` appears in the range diff, the gate parses `TARGET_KINDS` at
both ends of the range and drops the file from the violation list **only if every kind declared
at the base is still declared at HEAD**. Any other outcome keeps the violation.

**Set semantics, not prefix semantics.** The first implementation required the base array to be a
positional prefix of HEAD's, on the assumption that a new kind is appended. That assumption was
false in the very change this ADR exists for: `opencode-mcp` and `codex-mcp` were inserted
mid-array, beside the harnesses they relate to. Order is safe to ignore for a checkable reason —
`TARGET_KINDS` has exactly one consumer, `export type TargetKind = (typeof TARGET_KINDS)[number]`,
and a union of string literals is order-independent. Nothing indexes the array:

```bash
$ grep -rn "TARGET_KINDS" --include=*.ts packages/ apps/
packages/types/src/report.ts:13:export const TARGET_KINDS = [
packages/types/src/report.ts:27:export type TargetKind = (typeof TARGET_KINDS)[number]
```

If a consumer ever depends on position, the check becomes wrong and must be revisited; that
condition is recorded in the function's own comment.

A **removal** still reds. Dropping a kind narrows the union — a breaking schema change, not a
discovery addition — so it is not covered by this exemption.

**Why this does not weaken the orthogonality claim:**

Adding a new TargetKind tells the discovery layer "this file format is a config". It does NOT
tell the verdict layer "this host is safe/risky" or "this NPM package is trusted". The verdict
still depends ONLY on what is inside the parsed config (the server's command, args, env,
evidence), never on which harness the config came from.

The gate will continue to catch:

- Any change to `Verdict`, `RiskClass`, `PolicyAction`, `Finding`, or any other structure in
  `packages/types` — the exemption is scoped to one named const array, not the package.
- A TargetKind **removal or reordering**, which would be a breaking schema change rather than a
  discovery addition.
- Any change under `risk-engine`, `static-analyzer`, `policy`, `fingerprint`, or `core` — those
  five packages remain wholly protected, unchanged by this ADR.
- All eight forbidden risk fields and all five identity-coupling tokens (measurements 2 and 3),
  which are properties of the tree at HEAD and are untouched by this narrowing.

**The failure mode this ADR must not create:**

The exemption is a hole in a security gate, so it is written to be *narrow by construction*
rather than narrow by intention:

- It matches ONE file (`packages/types/src/report.ts`) and ONE const (`TARGET_KINDS`). A change
  to any other file in `packages/types` still reds, and is asserted by a negative control.
- It permits ONLY additions. The check parses both sides' arrays and requires the base's entries
  to be a prefix-preserving subset of HEAD's, so a silent removal cannot ride in with an addition.
- If the parse fails on either side, the gate FAILS rather than falling back to "no change
  detected". An exemption that cannot read its subject must not grant itself.

**A parser bug this exemption already survived, and what it cost.** The first parse used
`\[([^\]]+)\]` to grab the array body. That regex ends at the first `]` — and one of the two new
entries carries the comment `// Codex (TOML [mcp_servers.*])`, whose `]` terminated the match
early, yielding 8 of 10 kinds. `isAdditiveChange` read the truncation as a removal and kept the
violation. The fail-closed direction held, which is the point of writing it that way, but the
failure was indistinguishable from a real one: the gate printed exactly the red it would have
printed for a genuine schema removal.

The parse now scans to the matching bracket while skipping `//` comments and string bodies, and
returns `null` on an unbalanced array. The lesson is recorded here because it generalises: a
comment must not be able to move a security gate's verdict, and a fail-closed default makes a
parser bug *safe* without making it *visible*.

**Alternatives rejected:**

1. **Remove `packages/types` from VERDICT_PACKAGES.** This would exempt `Verdict` and `RiskClass`
   themselves — the two structures most central to the invariant. It trades a false red for a
   genuine blind spot.
2. **Split the branch so discovery lands separately.** Legitimate, and it would pass the gate
   today, but it does not fix the gate: the next harness addition hits the same false red. The
   defect is in the gate's granularity, not in this branch's shape.
3. **Revert the two TargetKind values.** They are load-bearing for the three extractors this PR
   adds (`codex-mcp` is the Codex extractor's declared `kind`), so reverting them means reverting
   the discovery work the PR exists to deliver.
4. **Hand-edit `security-semantic-diff.json` to `changed: false`.** Explicitly forbidden by the
   artifact's own `note` field, and it is the exact defect the script was written to prevent — a
   claim that costs nothing to write and nothing to keep true.

**Consequences:**

- The gate gains a code path that must itself be tested, with positive and negative fixtures per
  the repo's detection-rule discipline.
- Adding a harness whose config format is already covered (`mcp-servers`) still touches no
  verdict package and needs no exemption; only a genuinely new file format does.
- `security-semantic-diff.json` must be regenerated in the same commit that narrows the gate, and
  its `changed` field returns to `false` on this branch — not because the diff was hidden, but
  because the diff is now correctly classified as discovery rather than verdict.

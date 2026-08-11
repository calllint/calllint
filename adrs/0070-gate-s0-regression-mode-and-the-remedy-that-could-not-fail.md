# ADR 0070 — Gate S0 runs in CI in a third mode, because its own prescribed remedy could not fail

- **Status:** Accepted
- **Date:** 2026-08-10
- **Workstream:** S (Gate S0 / adoption-index status record)
- **Batch:** S batch 2
- **Supersedes:** nothing. **Amends:** ADR 0069 §2/§5 (a runtime figure) and §7 (a bullet that no
  longer describes the repository).
- **Closes:** S0-OPEN-2.
- **Leaves open:** S0-OPEN-1, S0-OPEN-4.

## §1 Numbering: 0070, and 0060 remains reserved

`ls adrs/` tops out at `0069`. **0060 is still not available** — ADR 0061 §1 records that it is
reserved by name for the `propertyNames` defect in `presentation-plane-audit.json:135`, and a gate
in `pnpm ci:local` reads that reservation. Re-listed rather than inferred from the ADR that says so,
per `proposed-file-map.md`'s standing instruction.

0069 was Workstream S's first ADR; this is its second.

## §2 Context: the corrected exit code had no consumer

ADR 0069 (S batch 1, merged as `344cd1b`) split `GATE-VERIFIED` into MEASURED / EXECUTED / SCANNED
so `--gate` could no longer print `✓` on bytes where its own subject was red. That fixed what the
gate *reports*. It did not fix who *reads* the report: `grep -rn "gate:s0"` returned **two** hits,
both script definitions in `package.json:42-43`. No workflow, no `ci:local` step, no test, no cron.

So the five assertions Gate S0 measures were re-measured only when a human typed the command, and
S0-OPEN-2 was the row that said so. 0069 §5 recorded that the two rows were **sequential, not
independent**: scheduling a gate that could not see its own failure would have scheduled a false
green. That ordering held, and this batch is the second half of it.

## §3 The decision, and the measurement that forced it

**A third mode, `--regression`, wired into `ci:local` and `.github/workflows/ci.yml`.** Neither
existing mode was wireable, and that was established by measurement rather than argument.

**Report mode has no failing mode at all.** Before designing anything, DEP-8's flag scan was pointed
at a token that does not exist in the source. Report mode printed `✗` beside DEP-8 and **exited 0**.
It exits 0 unconditionally.

This is what makes the decision worth an ADR. Scheduling report mode was **S0-OPEN-2's own first
prescribed remedy**, written in the row's *"What would make this row false"* — *"a scheduled
invocation of `gate:s0` in report mode (measuring is useful even when the gate would fail)"*. Had it
been implemented as written, CI would have gained a step whose green says nothing about the bytes it
read: ADR 0069 §2's defect wearing a workflow file, reinstated one level up. The parenthetical is
true of a human reading output and false of CI, which reads only the exit code.

**`--gate` is unwireable for the opposite reason.** It exits 2 on `main` today for the cohort
shortfall (19 < 25, S0-OPEN-1), clearable only by merging the registry expansion. Wiring it would
pin the required check red for a reason **no PR under review can fix** — CI's signal made
meaningless from the other direction. So `gate:s0:gate` must never appear in `ci.yml` or `ci:local`,
and the reader asserts its absence in both.

## §4 What `--regression` enforces, and the one thing it deliberately does not

Exit 2 if any of the five assertions fails, or if the registry cohort **shrinks** below a floor
derived from HEAD. The 25-record requirement is printed as census and **never enforced**.

The split is the whole idea, and it is what the row could not see while treating "the gate" as one
thing:

| | on `main` today | what it means |
|---|---|---|
| `registryShort` (19 < 25) | **true** | a known shortfall, S0-OPEN-1's business — not a regression |
| `cohortRegressed` (19 < floor) | **false** | a record was lost — a real defect, enforce it |

The 25-record *requirement* is what cannot pass today; the five *assertions* all pass on `main`
right now. **A passing assertion nothing runs is not a measurement.** Blending the two booleans into
one is precisely what made the gate unwireable, and separating them is what made a wireable mode
possible without lowering any bar.

The two modes are mutually exclusive (asking for both exits 2 rather than silently preferring one),
and `--no-run` is refused under `--regression` as it already was under `--gate` — so S0-OPEN-2's
addendum question (*"it must state whether it runs with `--no-run` and why"*) is answered by
construction: CI runs the full form, and the cheap path can never be mistaken for enforcement.

## §5 The ratchet floor cannot be edited slack

A floor is only as good as its resistance to being lowered by whoever is annoyed by a red CI.
`S0_REGRESSION_FLOOR` is defended twice:

1. **Load-time coherence.** `S0_REGRESSION_FLOOR > S0_REQUIRED_RECORDS` exits 2 before any
   measurement runs. A floor above the requirement is incoherent by construction and says so.
2. **Pinned against the input, not the output.** The reader pins the floor against
   `packages/trust-index/snapshots/official-mcp-registry.json` — the **input** the gate reconciles
   against under INV-R5.

(2) was a correction during implementation, and it matters: the first draft read
`apps/web/public/trust/index.json`, which is exactly what S0-OPEN-2 itself says a test must not do
("running the gate for real is S0-OPEN-2's business, not a test's"). A guard for this row that
violated this row's own rule would have been the third instance this workstream has seen of a
correction landing in a form its own record forbids. Anchoring on the upstream snapshot keeps the
pin honest without making the suite depend on baked bytes.

## §6 The runtime figure that sustained a scheduling deliberation

ADR 0069 §2 and §5, and S0-OPEN-2's first amendment, all state the batched `vitest run` costs
**~25 s**. Measured end to end, three times: **7 s / 9 s / 9 s**, 156/156 passing, EXIT=0. The
**156 tests** figure is correct; the seconds are out by roughly 3×.

The number was estimated, never timed, while arguing that cost was an input to *where* the gate
runs. At ~8 s that question dissolves — it becomes one more step in the main matrix. The
overstatement therefore did not merely misreport a value, it **sustained an entire deliberation the
measured value does not support**. Both figures are kept, here and in the artifact: "estimated a
cost, then reasoned from the estimate" is the reusable part, and deleting the estimate would delete
the evidence of how the reasoning went wrong.

Generalising: a cost figure carried in prose is a claim about a stopwatch nobody started. It
inherits the authority of the sentence around it while having no measurement behind it — the same
shape as [[prose-justified-constant-is-ungated]], one level further from the code.

## §7 What closes S0-OPEN-2, and how the closure is guarded

The row is CLOSED by **neither** of its two prescribed disjuncts: the first was measured and
refused (§3), the second (*"a recorded decision that manual invocation is sufficient"*) became the
worse answer once the first was understood. A row's own falsification conditions can be **wrong**,
and the honest close is to satisfy the row's *intent* while recording that its stated remedy was
refused and why.

That refusal is the assertion most likely to be quietly undone — a later batch could schedule report
mode "for extra measurement" and every other assertion here would still pass. So the reader asserts
over the artifact's prose that report mode's unconditional exit 0 is named as the reason. The
closure's own falsification conditions are pinned too: `ci:local` and `ci.yml` must both invoke
`gate:s0:regression`, and `--regression` must gate on `allOk` and `cohortRegressed` while **not**
exiting on `registryShort`.

## §8 Negative controls

Applied to **source or artifact, never to a test**; backed up with `cp` to `/d/tmp/*.bak` and
restored from that copy, each verified byte-identical. A positive control ran first, so a red could
not be a broken importer.

| # | mutation | required failure |
|---|---|---|
| 170 | lower `S0_REGRESSION_FLOOR` below the real cohort | must red naming the snapshot cohort, not "expected false to be true" |
| 171 | raise `S0_REGRESSION_FLOOR` above `S0_REQUIRED_RECORDS` | must exit 2 at **load time**, before any measurement |
| 172 | remove `pnpm gate:s0:regression` from `ci:local` | must red naming the row's subject, not an off-by-one on the step count |
| 173 | remove the step from `ci.yml` | must red separately — the two invocations are two claims |
| 174 | swap `ci.yml`'s step to `gate:s0:gate` | must red on the exclusion, not merely on the count |
| 175 | break one assertion's subject under `--regression` | must **exit 2** — the defect report mode could not detect |
| 176 | revert `gate-H-no-regression.json` to its pre-batch copy | must red naming the **coupling** and the regeneration command, not "an artifact is stale" |

**All six red, each on its own subject, each restored byte-identical from its `cp` backup.** Two
results are worth keeping:

**#175 measured §3's central claim rather than restating it.** With `INV-R6`'s anchor pointed at a
non-existent token, on identical bytes in one working tree: report mode printed
`✗ INV-R6: anchor absent …` and exited **0**; `--regression` printed
`❌ one or more assertions FAILED` and exited **2**. Both *print* the failure; only one *reports* it.

**#176 exists because `ci:local` had an undocumented fourth consumer.** Appending a step red
`pnpm ci:local` at **Gate 2.4-H**, not at the new step:
`artifacts/phase-2.4/gate-H-no-regression.json` embeds `ci:local`'s `&&`-joined string verbatim and
byte-compares it. Regenerating moved exactly one line. S0-OPEN-2's first amendment had enumerated
the consumers of that string and missed this one, so the reader now asserts the coupling — kept
narrow (Gate H's copy must contain `ci:local`'s exactly) rather than duplicating Gate H's own drift
check, which would red two gates for one cause.

**#174 changed the reader instead of confirming it.** Swapping `ci.yml`'s step to `gate:s0:gate` red
with *"expected … to contain 'pnpm gate:s0:regression'"* — true, but it names a **missing step**, not
the hazard, because the presence assertion preceded the exclusion and short-circuited it: the
exclusion never ran. Reordered exclusion-first, the swap now reds on the swap. This is
[[assertion-order-decides-falsifiability]] recurring **inside the file that cites it**, in a batch
where the `ci:local` half of the same test already had the order right. A principle applied
correctly at one assertion does not propagate to the next one in the same file, which is the
argument for running a control per hazard rather than per file.

## §9 What this batch deliberately did not do

- **No S0-OPEN-4 remedy.** Its three candidates (raise the ingest cap, exempt the self-claim from
  the slice, seed the cohort from a pinned list) are each an ingest-policy or served-bytes change
  and each needs its own authorization. `--regression` does **not** see S0-OPEN-4's hazard: it
  counts records, and an eviction that adds a record while removing CallLint's own claimed page
  holds any floor. Recorded so the next batch does not mistake a green ratchet for coverage.
- **No S0-OPEN-1 movement.** The cohort is still 19/25, and `--regression` reports it as census on
  purpose. **PR #234 untouched** — merging it is a served-bytes change needing its own
  authorization, and it was independently measured unsafe (`--gate` EXIT=0 with 37 tests red, the
  defect 0069 §3 removed).
- **`--gate`'s behaviour unchanged.** Not relaxed, not rewired, still exits 2 on the shortfall. The
  new mode sits beside it and enforces a different claim.
- **No served bytes touched.** Nothing under `apps/web/public/**`; the MCP surface (13 tools / 19
  resources) and `packages/calllint-mcp` runtime `dependencies: {}` are untouched.
- **The overstated runtime keeps its bytes**, corrected beside it rather than in place. ADR 0061
  §8.5.1.

## §10 Correction 2026-08-11 — the workflow this ADR wired in did not parse, and the reader could not tell

Everything above was verified locally and pushed. **The step never ran.** It went in as
`- name: Gate S0 (regression: assertions + cohort ratchet)`; the unquoted `: ` makes the whole file
unparseable, so the `test` job never started.

The failure mode is worse than a red build, and this is the part worth transferring:

```
gh pr checks 286   → six green checks, `build-and-test` ABSENT from the list
gh run list        → .github/workflows/ci.yml   completed   failure   (zero jobs)
```

**An unparseable workflow contributes no check runs, so a required check does not fail — it stops
existing.** Branch protection has nothing to fail on. §3's argument against wiring `--gate` was that
it would pin the required check red for an unfixable reason; the actual outcome was the opposite
hazard, a required check that was neither red nor green.

**Why nothing caught it.** §7 says the closure's falsification conditions are pinned: *"`ci:local`
and `ci.yml` must both invoke `gate:s0:regression`."* The reader implemented that as
`expect(ci).toContain("pnpm gate:s0:regression")` — true of a file no runner can execute. The
assertion's subject is *a string is present*; the claim is *CI runs the step*.

That is **§2's defect reproduced inside this batch's own closing evidence.** §3 refused report mode
by measuring its exit code rather than reading its output, and then this ADR accepted a text match as
proof that the measurement had been applied. The same distinction, one level out from the gate and
into the gate's own guard.

**Repair.** `ci.yml` is parsed and Gate S0's step looked up as a structure inside `jobs.test.steps`,
with `build-and-test` asserted to survive in the parsed graph. A second test parses **all fifteen**
workflows — nothing here could have caught this in any of them. `yaml@2.8.2` is a pinned root
devDependency; it was previously undeclared and resolved from `D:\my-web-app\node_modules`, i.e.
**outside the repository**, so an import would have passed locally and been absent in CI.

Controls #177 (the pushed bytes, red naming the parser's line), #178 (valid YAML, empty `jobs` —
only the shape bound reds), #179 (`--frozen-lockfile` refuses the undeclared parser). All restored
byte-identical.

The generalisation, and it is narrower than "parse your YAML": **a guard asserting that a
configuration file *mentions* a step cannot see whether the runtime *accepts the file*.** Wherever a
gate's subject is "X is wired to something that runs it," the wiring must be read the way the runner
reads it. Gate 2.4-H's `workflowBinding` check (`scripts/phase-2.4-gates.ts:717`) is regex-over-text
for the same 20 checks and has the same blind spot; not changed here, because it belongs to Phase 2.4
and this batch already carries its own correction — filed as **S0-OPEN-5**.

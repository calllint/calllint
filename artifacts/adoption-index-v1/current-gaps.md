# Current gaps — measured absences only

Workstream R Batch-0 reality audit (new15 Execution Plan §6.6). ADR **0061**.
Measured 2026-08-02 against `main` at `84f56c5`, clean tree.

**Scope discipline.** This file records what is **not there**, with the command or file
read that established it. It contains no roadmap, no sequencing, and no estimates —
`docs/new15-execution-status.md` owns those. A gap list that drifts into planning prose
stops being falsifiable, and the whole point of Batch 0 is that every later batch can
re-run these measurements and get the same answer.

Grading comes from `current-capability-matrix.json`. That file grades **55** rows;
**18** are `ABSENT` and **9** are `PARTIAL`. Twelve of the eighteen absences are in the
blueprint's own **do-not-build** bucket, where `ABSENT` is the *passing* state. So the
real gap surface is smaller than a raw count suggests:

| | |
| --- | --- |
| Rows graded | **55** |
| `ABSENT` in a build bucket (real gaps) | **6** |
| `ABSENT` in the do-not-build bucket (correctly absent) | **12** |
| `PARTIAL` (exists, wrong shape) | **9** |
| `CONTRADICTED` (blueprint asserts a gap that shipped) | **5** |

## 1. The six real absences

Each is `ABSENT` in a keep/refactor/add bucket, and each was established by a search that
returned nothing.

### 1.1 No durable source mirror

`grep -rln "SourceRecord\|adoption-record" packages/*/src apps/*/src` → **no match**.
There is no `SourceRecord`, no `calllint.adoption-record.v1`, and no table that could hold
one. `packages/adoption-index/` does not exist (`ls -d` → absent).

### 1.2 No incremental sync — ingestion is a single-shot full refresh

`packages/trust-index/src/fetchRegistry.ts:90` `fetchRegistrySnapshot` performs **one**
`doFetch(endpoint)` at `:101`, reads `body.servers`, sorts by name, and `.slice(0, max)`.
Measured: `grep -n "cursor\|updated_since\|updatedSince\|watermark"` on that file →
**no match**. There is no cursor, no watermark, and no pagination — the cap is a
`.slice()` over one response.

The committed snapshot confirms the scale this was built for:
`packages/trust-index/snapshots/official-mcp-registry.json` holds **19** entries against
`DEFAULT_MAX_ENTRIES = 25` (`fetchRegistry.ts:19`), fetched
`2026-07-17T00:00:00.000Z`. Cadence is weekly (`.github/workflows/trust-ingest.yml:18`,
`cron: "17 6 * * 1"`), and the workflow's own header calls itself "the SOLE scanner".

**What that means precisely:** the ingestion path is correct and sufficient for 19–25
entries reviewed weekly by a human. It has no mechanism that survives being asked for
500. That is the gap — not a defect in what exists.

### 1.3 No job state machine, and the file to generalize is not the obvious one

No persistent job queue, no leases, no dead-letter, no idempotency key.

`packages/evidence/src/model/stateMachine.ts` is the **resolution** state machine
(`canTransition`, `isTerminal`, `stateFromResolverStatus`). ADR 0061 §10 names it as the
file to **generalize** to INV-10's seven terminal states — `SUPPORTED`,
`LOCAL_PREFLIGHT_REQUIRED`, `UNSUPPORTED`, `DEPRECATED`, `TOMBSTONED`,
`IDENTITY_CONFLICT`, `PROCESSING_FAILED`. It is **not** Guard's state machine and it is
not a job state machine. Both mislabels are live hazards: one sends a batch to generalize
the wrong file, the other implies a machine already exists.

### 1.4 No freshness calculator

No module under `packages/*/src` computes freshness. Evidence *level* ships
(`packages/trust-index/test/evidenceLevel.test.ts`); freshness does not. This is the
calculation the **rolling** half of the compiler exists to feed, so its absence is what
makes "rolling" currently unrepresentable.

### 1.5 No claim-facing control API

Nothing serves a publisher-facing control surface. Note the precondition **has** been met:
the blueprint's do-not-build list forbade this "before the GitHub App flow works end to
end", and that flow now works — new13 closed the self-claim lifecycle 3/3 on the live
account. So this is unblocked-but-unbuilt, which is a different fact from forbidden.

### 1.6 No scale-threshold instrumentation

Nothing measures the 25 → 100 → 500 step. This absence is **deliberate and gated**:
Gate S0 and PR R-9 confirm the step sizes, and ADR 0061 §11 authorizes no expansion step
in this batch. Recording it as a gap is not a request to close it.

Also absent by design: no SQLite dependency exists anywhere yet
(`grep -rln "better-sqlite3\|node:sqlite"` across `packages/*/src`, `apps/*/src`, and every
`package.json` → **no match**). ADR 0061 §7 decides the driver and pins
`better-sqlite3` to exactly `12.11.1`; R-1 is the batch that may add it.

> **CLOSED at R-1 (`c7f25e8`, #251), and the pinned version above is superseded.** Both sentences
> were true when measured at `84f56c5` and both have since moved, so they are left standing per the
> house rule "invert a stale assertion, never delete it" — this artifact is R-0's measurement of the
> repo as it stood, not a live index.
>
> The dependency now exists: `packages/adoption-index/package.json` declares it, and it is reachable
> from exactly one shipped file (`packages/trust-index/src/refreshSnapshot.ts`) and from no bundled
> entry point — asserted by `tests/invariants/adoption-index-unreachable.invariants.test.ts`, which
> walks the same module graph esbuild walks from both publishable entry points.
>
> The version is **`12.9.0`**, not `12.11.1`. ADR 0061 §7 was amended by re-measurement at R-1
> authoring: `better-sqlite3` dropped its Node 20 prebuild (ABI 115) at `12.10.0` while still
> declaring `engines.node: "20.x || …"`, and all three CI legs run Node 20, so `12.11.1` would have
> fallen through `prebuild-install || node-gyp rebuild` to a source build on every leg. `engines.node`
> states what upstream permits; the prebuild assets state what upstream ships, and only the second
> decides whether CI compiles C++. The pin is also now **gated**
> (`packages/adoption-index/test/store-schema.test.ts`, on the declared specifier rather than the
> resolved version) — before R-1 it was documented in three places and read by no gate, so an open
> `^12.9.0` passed all 117 R-1 tests.

## 2. The five forks — one capability, two real owners

These are **not** gaps. They are recorded here because §6.5's job is to surface authority
facts, and "two owners" is exactly the kind of fact that gets flattened by a later reader
into "one owner, and the other must be drift". Each of the five is measured, deliberate,
and load-bearing. Full detail in `current-symbol-bindings.json` (rows 4, 11, 14, 20, 21).

| # | Capability | The two owners | Why flattening it is a defect |
| --- | --- | --- | --- |
| 4 | Evidence resolution | script `resolveEvidence.ts:40` (only export `remoteSubjects`; `main()` at `:48` is **not** exported) · engine `packages/resolver/src/evidence/resolveSubject.ts:17` + `P1_RESOLVERS` at `index.ts:32` | binding the script alone points every later batch at a `main()` it **cannot import**. The binding would look right and fail at the first `import` |
| 11 | Gateway prepare | general `prepare.ts:134` · safe-install `prepareSafeInstall.ts:137` | the safe-install path is the one both the CLI and MCP delegate to. Recording only `prepare` aims a batch at the path *not* under test |
| 14 | Receipt schema | v1 `decisionReceipt.ts:89` `calllint.receipt.v1` · v0 `core/src/receipt/types.ts:17` `calllint.receipt.v0` | **v0 still ships** for `scan --receipt`. "One receipt schema" would license deleting a live surface |
| 20 | Generated deployment | producers `bake.ts:121` + `sync-assets.mjs` · deployer `deploy-web.yml:85` | binding only the producer hides the deploy gate at `:114`; binding only the workflow hides who writes the bytes |
| 21 | Telemetry contracts | `telemetry-contract` `ALLOWED_EVENTS:11` · `trust-event-contract` `TRUST_EVENTS:31` | two **independent** closed vocabularies with separate version constants. Recording one makes a batch believe an event name is allowed when its vocabulary does not contain it |

Row 4 is the only `PARTIAL` among the 21 subsystems, and the reason is precisely the fork:
the capability exists, but not as an importable schedulable unit. Turning it into one is
what the rolling compiler needs from it.

## 3. The five contradictions — the blueprint asserts gaps that shipped

Blueprint v1.4 §§1.1–1.3 label these as **confirmed** gaps. All five were measurably
closed by new13/new14. Grading them `ABSENT` would re-authorize building them, which is
exactly the waste `Blueprint v1.4:216` forbids (不允许重复建设).

| Blueprint claim | What actually shipped |
| --- | --- |
| §1.1 "Production installations: 0 / Active claim store: empty" | new13 Phase 2.5-A closed the self-claim lifecycle **3/3** on the live account (revoke #220 + reactivate #221; harness #219 merged `bd53d15`). `pnpm audit:self-claim` prints 3/3, no faults. Verdict SAFE and `pageDigest sha256:20091cd…` were byte-identical across all three legs — the kill-gate held |
| §1.2 missing "deterministic task-to-tool safe search" | **N7**, `b7c7bfd` (#227) — shared `matchLexical` over a byte-copied committed `lookup-index.json` |
| §1.2 missing "Claude Code installation/configuration interception" | **N8**, `95587aa` (#228) — `preflight-core.mjs` `installCapture` names the `trust prepare → apply` route verbatim, emits a `calllint.receipt.v1`, exits 0, writes nothing, never calls `applyPlan` |
| §1.3 "no dedicated `/install/{tool}/` human decision capsule" | new14 Batch 3 (`f0e58d6`) promoted the shadow tree to **served** `apps/web/public/install/**` — **38** committed files, enumerated in `current-generated-tree.json`. ADR 0059 fixes the first screen |
| §1.3 "no Agent Adoption Contract" | **19** contracts served and exposed as MCP resources at `calllint://adoption/{slug}[@{version}]`, verbatim (`renderSafeInstall.ts:643` `renderSafeInstallContract`) |

**This is the audit's most consequential finding for scoping.** Five blueprint "gaps" are
already closed, and all 21 subsystems §6.1 names bind to committed code
(20 `EXISTS`, 1 `PARTIAL`, **0 `ABSENT`**). What the plan calls "build" is, for §6.1,
largely "bind and generalize".

## 4. What is correctly absent

Twelve do-not-build rows are `ABSENT`, and each one being absent is a **pass**, not a gap:
no second scoring engine, no LLM explanation service, no dynamic scanner in the web app,
no live fetch at request time, no mutable record without an immutable digest, no central
claim dashboard, no distributed queue, no Cloudflare storage migration, no parallel MCP
server for search, no LLM in the search path, no prompt-injection surface, no silent
installation.

Two deserve a note because a Workstream R batch is the most likely place to break them:

* **No parallel MCP server.** One server, **13 tools / 19 resources**, asserted by
  `pnpm pack:smoke:mcp`. new15 adds **zero** MCP tools. N7 delivered search *inside* the
  one server. A compiler batch that adds a tool has moved a number a distribution smoke
  test pins.
* **No target execution.** `packages/resolver/test/evidence/noExec.test.ts` is the test that
  fails if this regresses. The compiler is the component with the strongest incentive to
  violate it — fetching and unpacking an artifact is one short step from running it — which
  is why ADR 0061 §2 enumerates the forbidden operations rather than stating the principle
  and trusting it.

## 5. What this file deliberately does not say

It does not say which gap to close first, how long any of them takes, or which batch owns
which. It does not grade sufficiency for the compiler beyond the measured statuses. And it
does not treat a `PARTIAL` as a defect: nine capabilities exist in a shape the blueprint
did not anticipate, and in at least three of those (publish channels, evidence level,
namespace claims) the shipped shape is the one that passed a gate.

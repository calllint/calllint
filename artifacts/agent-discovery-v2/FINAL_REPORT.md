# Agent Discovery v2 — Final Report

**Scope:** new19 §25. **Measured at:** commit `abfb44a` on branch `fix/explain-command-runnable`
(the head branch of PR #329, which is `OPEN`), 2026-08-22. Every figure below was read from the tree
or from a gate's exit code at that commit; none is carried over from an earlier document. Where a
requirement was already satisfied before this work, that is stated rather than re-claimed as new —
new19 §0 forbids rebuilding what exists.

The audit that preceded this report is [REALITY_AUDIT.md](REALITY_AUDIT.md); it measured 10 of the
17 requirements as **already satisfied**, and this report covers the 7 that were not.

---

## 1. Architecture

**Before — a distribution system.** `apps/web/data/distribution-surfaces.json` existed and already
projected host pages, `llms.txt`, `agent-surfaces.json` and two matrices. Its organising question
was *where can CallLint be installed*: the records were keyed by delivery channel, and a reader
asking "which agent harnesses does CallLint know about, and what does it claim for each" had to
infer the answer from install primitives.

**After — agent discovery infrastructure.** The same SSOT now also projects
`apps/web/public/agent-discovery-index.json`, a machine-readable surface whose organising question
is *what does CallLint know about this agent host, and what does it truthfully claim*. Three things
make it infrastructure rather than a second file:

- It is a **generated projection**, not a hand-maintained document (REALITY_AUDIT D1). There is no
  second place to edit, so there is no second truth to drift.
- `type` is **derived from container membership** (D2), so a surface cannot be mislabelled by hand.
- It is **schema-governed and closed-world**: `agent-discovery-index.v1.json` publishes
  `additionalProperties: false` at both the envelope and the per-surface level, so an invented
  field is a validation failure rather than silently-ignored data.

What did **not** change is the more important half: no new entity, no `distribution/` tree, no
second page set, no `capabilities` rename, no `.well-known` writer. §12 named seven new paths; all
seven remain **ABSENT** by decision, each recorded in the audit with its reason.

---

## 2. Coverage

18 hosts in `hosts[]`, by support class:

| Class | Count | Hosts |
|---|---|---|
| `NATIVE` | 8 | claude-code, claude-desktop, cursor, vscode, windsurf, workbuddy, qwen-code, openclaw |
| `DISCOVERY_ONLY` | 5 | codex, copilot-cli, cline, continue, deepseek-harness |
| `DEFERRED` | 4 | gemini-cli, codebuddy, kiro, roo-code |
| `CONFIG_SCAN` | 1 | opencode |

new19 §5 organises coverage as Tier 0 / 1 / 2. **The SSOT carries no `tier` field on `hosts[]`** —
measured: the 13 host fields are `id, displayName, vendor, priority, authoritySurfaces,
configEvidence, supportClass, truthfulCommands, canonicalPath, legacyPaths, officialSources,
distributionPrimitives, coverageBoundary`. Tiering exists only on `officialMcpRegistry.tierLevel`
(0).

**This was first recorded here as a justified divergence. That judgment was wrong, and the
obligation is now implemented — as an assertion, not as a field.** The original objection was that
a `tier` column would be a second classification no gate reads, duplicating `supportClass`. That
objection still holds against a *field*, but it answered the wrong question: §9 ("REQUIRED INITIAL
HARNESS COVERAGE") names fourteen hosts across the three tiers, and §3040's validation list
requires literally `all Tier 0 entries exist`. That is a **membership obligation over the host
set** — checkable with no per-record attribute at all. Reading it as a request for a column is what
made it look optional.

`tests/invariants/agent-discovery-v2.invariants.test.ts` now carries a §9/§3040 block: a reviewed
`REQUIRED_COVERAGE` constant (5 / 6 / 3 members) anchored on SSOT `id`, plus
`BEYOND_SECTION_9 = [claude-desktop, vscode, windsurf, openclaw]` making the partition total in
both directions — an unaccounted host reds, and so does an exemption naming a host that no longer
exists.

Two things that block cannot do, deliberately:

- **It never asserts a host is supported.** §9 says "Do not claim implementation where none
  exists. The record may honestly say: DISCOVERY_ONLY." So the assertion is only that a record
  exists, its `supportClass` is a known value, and its `coverageBoundary` is non-empty. Six of the
  fourteen are `DISCOVERY_ONLY` or `DEFERRED` and stay that way.
- **It does not anchor on `displayName`.** §9 spells its members as display names and two do not
  match this repo — "Codex" is `OpenAI Codex`, "GitHub Copilot" is `GitHub Copilot CLI`. Exact-name
  matching fails today; loose matching would let a rename silently dissolve a coverage obligation.

`priority` was measured and is **not** the same axis: `codex` and `cline` are §9 Tier 0 yet carry
`P2`, and `claude-desktop` carries `P0` while appearing in no §9 tier. `priority` orders CallLint's
own work; the tier records an obligation new19 imposed. That disagreement is pinned by test so a
future edit cannot quietly conflate them.

Three hosts were added by this work: **continue**, **roo-code**, **deepseek-harness**.

### The four representations §26 names individually

- **Codex — correct.** `supportClass: DISCOVERY_ONLY`, vendor OpenAI, **zero** truthful commands,
  while simultaneously being a member of the `AgentType` union. That asymmetry is deliberate and
  now pinned by test: a registered type does **not** license a support claim, so a future edit
  cannot promote Codex to NATIVE by pointing at `types.ts`. Its public status renders as
  "Guide only".
- **DeepSeek — correct, and correct in the harder direction.** `deepseek-harness` is a
  `DISCOVERY_ONLY` host with zero commands, and `harnesses/deepseek/` is a model-intent landing
  page endorsed by `modelIntentLandingPages.deepseek-hub`, with 8 hosts forwarding legacy
  `/harnesses/deepseek/<host>` URLs to their canonical paths. Zero deepseek-specific detectors
  exist in the engine. DeepSeek is a distribution surface, never a supported harness.
- **WorkBuddy / CodeBuddy — boundary intact.** Distinct vendors (`Tencent Cloud` vs `Tencent`) and
  distinct classes (`NATIVE` vs `DEFERRED`). Pinned by test, because the two names are similar
  enough that a well-meaning edit could merge them.
- **Registry — still Tier 0.** `io.github.calllint/calllint`, package `calllint-mcp`, state `LIVE`,
  version `0.2.0`, published `2026-07-13`, `tierLevel: 0`, `upstreamPrimitive: true`.

---

## 3. Registry status

`officialMcpRegistry` is unchanged by this work and remains the upstream primitive: other surfaces
are described as reaching CallLint *through* it rather than as parallel channels. §18's marketplace
principle ("does this ecosystem consume the Official MCP Registry? if yes, prefer Registry") is
why `counts.byType.marketplace` is **0** and `mirror` is **0** — those containers exist in the
schema's `surfaceTypes` and are legitimately empty. The index asserts them as present-and-zero
rather than omitting them, so a marketplace silently arriving reds a test.

---

## 4. Generated surfaces

The generator writes **11 targets through a single `emit()`**, and the discovery index is the 11th.
One write path is the load-bearing property: `--check` and write mode are the same code, so a green
`--check` means "the tree is current", not "two generators agree".

21 surfaces in the index: 18 `agent-harness`, 1 `mcp-registry`, 1 `documentation`,
1 `search-surface`, 0 `marketplace`, 0 `mirror`. 19 host page directories — 18 hosts plus the
endorsed `deepseek/` landing page. Pages are template-driven (`scripts/templates/host-page.hbs`);
none is hand-authored, and a hand-authored one reds the endorsement test.

`.well-known/calllint.json` is **excluded** by decision (D7). §15 lists it as a generated surface;
this report records, as the audit did, that §15 must not be followed literally there — the path is
owned by the Safe-install bake, and two writers on it already dropped `resources[]` once.

### A blindness found and fixed while verifying this

`agent-discovery-index.json`, `agent-discovery-index.v1.json` and the three new host pages were
**never `git add`ed**. The watcher's drift step is `git diff --exit-code`, which cannot observe an
untracked file — so it was structurally blind to 4 of the 11 write targets while reporting green.
REALITY_AUDIT M10 recorded this exact property as a risk; it had already happened. Now tracked, and
verified by control: a 1-byte edit to `harnesses/roo-code/index.html` was invisible before the fix
and reds after it.

---

## 5. Tests

**37 tests** in `tests/invariants/agent-discovery-v2.invariants.test.ts`, all passing (count read
from the runner, not from a `grep` — a `grep` for `it(` over-counts here because it also matches
prose inside comments). They encode §22's propositions and the §23 controls the file names
explicitly: `NC-01` (Codex), `NC-02` (DeepSeek model identity), `NC-03` (marketplace presence),
`NC-05` (unsupported agent command), `NC-06` (500 manual pages), `NC-07` (new platform → new
detector) and `NC-08` (discovery metadata in the security engine). `NC-04` is deliberately **not**
in this file, and the file says why: "generated page manually edited → FAIL" is a property of the
generator, not of the SSOT.

The last seven are the §9/§3040 tier-coverage block described in §2 above.

Five of those eight are one invariant under five projections rather than five tests — if a
distribution fact cannot reach the verdict path, then adding Codex cannot change a verdict, nor can
a model vendor, nor marketplace presence, nor a new platform, nor discovery metadata. Writing them
as five separate assertions of the same fact would inflate the count without adding an observation.

Every cohort test pins its **denominator before its verdict** (`sources.length > 400`,
`registeredTypes.size > 10`, `SSOT.hosts.length > 10`, `servedPages.length > 10`,
`native.length > 5`) — an assertion over an empty set passes while observing nothing, which is this
repo's dominant fault class.

The command-shape invariant is four-way, matching the product rule rather than a simplification of
it: `NATIVE` must advertise `--agent <id>`; `CONFIG_SCAN` **must** advertise a command and **must
not** use `--agent`; `DISCOVERY_ONLY` must not use `--agent`; `DEFERRED` must advertise nothing. A
first draft asserted "non-NATIVE ⇒ no command" and flagged the healthy `opencode` — an assertion
that libels correct behaviour is worse than a missing one, and the rule was read from
`check-harness-distribution.mjs` before the data was touched.

"Discovery metadata cannot reach the security verdict" is asserted in **two directions**, because
either alone is defeatable: the import graph proves no engine source *names* these files (defeated
by a rename), and the record's key set proves there is no risk/score/verdict field to read
(defeated by an indirect read). Measured at this commit: zero occurrences of `deepseek`, in any
case, across `packages/*/src` — so the "DeepSeek is a distribution surface, never a detector"
claim is a measurement, not a policy statement.

### Mutation controls

Beyond the §23 scenarios above, each new or changed guard was checked by temporarily mutating its
subject and confirming it reds — non-zero exit *and* the expected failing assertion, not merely a
non-zero exit. These were run as throwaway shell mutations and, unlike `NC-01`…`NC-08`, have no
persisted identifiers; the record of them is this section and the guards they hardened, not a
label. Two were themselves defective, which is worth recording because it is the same fault class
the suite exists to catch:

- One anchored on `async function main()`, a string that does not exist in the generator. The
  mutation was a silent no-op and the control read GREEN having changed nothing — a control that
  cannot reach its subject proves the subject safe by accident.
- One mutated only the body of the `open-items.md` amendment while the heading still carried
  `**26**`, so `toContain("**26**")` satisfied itself on the heading. The fix was to the
  *assertion*, not just the control: it now regex-binds to the sentence that makes the measurement
  and asserts the captured number equals the live step count.

Both were repaired by anchoring on a verified string and asserting the mutation actually landed
before reading the exit code.

The two guards added last carried their controls in both directions, and every mutation printed a
confirmation that it landed before the guard was run:

| Control | Mutation | Result |
|---|---|---|
| §9 tier — false positive | added a nonexistent `ghost-harness` to Tier 0 | 3 red, incl. the length lock (5) |
| §9 tier — silent shrink | dropped `cline` from the Tier 0 obligation | 3 red — the partition reports it unaccounted |
| §29 — harness subdirectory | linked `usage.calllint.com` from `harnesses/cursor/index.html` | red, names the file |
| §29 — sitemap (`.xml`) | added the private host as a `<loc>` in `trust/sitemap.xml` | red, names the file |
| §29 — workflow | added `cloudflare/wrangler-action` to `usage-report.yml` | red, names the step |
| §29 — anti-vacuity | removed `apps/web/public/harnesses/` entirely | red (`0 harness pages … would be vacuous`) |

The shrink control is the one that matters most for the tier block: without the total partition, a
maintainer could quietly delete a member from `REQUIRED_COVERAGE` and every remaining assertion
would still pass. The subdirectory and `.xml` controls matter for §29 for the same structural
reason — both are surfaces the inherited file-discovery cannot see.

**Suite-wide at this commit:** 246/246 test files pass.

---

## 6. Security semantic diff

**Empty. Measured, in two independent directions.**

```
pnpm check:security-semantics  → EXIT 0
  fields:    0 of 8 forbidden fields present
  coupling:  0 of 5 identity tokens reach the risk engine
  ✓ SECURITY_SEMANTICS = UNCHANGED
  ✓ --check: committed artifact agrees with the live measurement

git diff main...HEAD -- packages/risk-engine packages/static-analyzer \
                        packages/policy packages/fingerprint packages/types
  → no output (zero files changed)
```

The second reading matters because the first is a gate that could in principle be wrong about its
own subject. No file in the verdict path changed on this branch at all, so there is no verdict
whose inputs could have moved.

---

## 7. §24 final validation

All eight gates, exit codes read **unpiped**:

| Gate | Exit |
|---|---|
| `pnpm typecheck` | 0 (0 errors) |
| `pnpm test` | 0 (246/246 test files) |
| `pnpm build` | 0 |
| `pnpm corpus:test` | 0 |
| `pnpm check:public-copy` | 0 |
| `pnpm check:harness-distribution` | 0 |
| `pnpm pack:smoke:mcp` | 0 |
| `pnpm ci:local` | 0 (**27** steps) |

`ci:local` grew twice during this work: 25 → 26 (`check:distribution-drift`) and 26 → 27
(`check:published-schema`). Both are recorded as dated amendments in
[artifacts/gate-s0/open-items.md](../gate-s0/open-items.md), and **25, 26 and 27 all remain
written there**. Overwriting the older figures would convert a history into a claim; the pinned
literal in `gate-s0-claims.invariants.test.ts` is deliberately a literal so that a step *leaving*
CI is as much an event as one arriving.

---

## 8. §19 watcher

Five weekly checks. Three were already covered; two were added, on opposite sides of the
fail/report line, and the split is the design rather than an accident:

| Check | Mechanism | On change |
|---|---|---|
| Registry presence | `verify-registry-presence.mjs` | **fail** |
| Harness changes | regenerate + `git diff --exit-code` over 9 paths / 11 writes | **fail** |
| Marketplace status | *partially* — see below | **fail** (projection only) |
| Schema changes | `check-published-schema-contract.mjs` **(new)** | **fail** |
| Official source changes | `check-official-sources.mjs` **(new)** | **report only** |

**Why the last one exits 0 on an unreachable source**, when `verify-registry-presence.mjs` exits 1
for the same symptom: the subjects differ. Registry presence is a fact about *our own*
publication, so an unverifiable claim about ourselves must red. A vendor's documentation URL is a
fact about *them* — Anthropic moving a page is not a CallLint defect, and a job that reds on it
trains maintainers to ignore a red run. What that habit would mask is the internal drift check in
the same workflow, which is a real bug every time it reds. So 404, 429, 403, timeout and TLS error
are all **data**, written to an internal artifact.

**Marketplace coverage is partial, and the limit is stated precisely** rather than rounded up:
there is no `marketplaces[]` container and `counts.byType.marketplace` is 0. Marketplace state
lives as `distributionPrimitives[].state` on each host (14 kinds today, e.g.
`windsurf-mcp-marketplace`, `tencent-mcp-market`, `cline-marketplace-pr`). The diff step therefore
guards that those *recorded* states still project correctly — **not** that they still match what
the vendor's marketplace says. The source observation samples that second question; it does not
gate it.

§19's handling is implemented literally: no change → silent; change → internal artifact; never an
external PR, issue, form, or maintainer contact. The observation step issues anonymous GETs and
nothing else, and `--offline` skips every fetch.

**The watcher has not yet run with these steps.** Its schedule is weekly (`0 9 * * 1`) and it has
**0 runs** to date. One live observation was made locally to prove the script works against real
responses — 13 of 26 URLs returned HTTP (including a 404, a 429 and a 403, each recorded
distinctly) and 13 were unreachable with `UND_ERR_CONNECT_TIMEOUT`. That unreachability was
**diagnosed as this machine's network**, not as vendor downtime: the same process reached
`registry.modelcontextprotocol.io` and `cursor.com` with 200 in the same run. The polluted baseline
was therefore **deleted rather than committed** — committing it would have made the first CI run
report 13 false REACHABILITY changes. The first clean baseline will be built by CI.

---

## 9. §26 stop conditions

| Condition | State | Evidence |
|---|---|---|
| One canonical discovery source | **MET** | index is a generated projection of the SSOT; no second editable file |
| No duplicate distribution truth | **MET** | all 7 of §12's proposed paths measured ABSENT at this commit; `.well-known/calllint.json` has exactly one writer (see below) |
| Codex correctly represented | **MET** | `DISCOVERY_ONLY`, 0 commands, is an `AgentType`; asymmetry pinned by test |
| DeepSeek correctly represented | **MET** | `DISCOVERY_ONLY` host + endorsed landing page + 8 legacy forwards; 0 occurrences of `deepseek` in `packages/*/src` |
| WorkBuddy/CodeBuddy boundary | **MET** | distinct vendors and classes, pinned by test |
| Registry remains Tier-0 | **MET** | `tierLevel: 0`, `upstreamPrimitive: true`, unchanged |
| Pages generated, not handcrafted | **MET** | 1 template → 19 dirs; a served page with no SSOT container reds (`NC-06`) |
| llms surfaces synchronised | **MET** | `llms.txt` + `llms-full.txt` in the drift diff set; `ci:local` exit 0 |
| Watcher ready | **MET (ready, not yet observed)** | 5 checks wired; 0 scheduled runs so far |
| Security semantics unchanged | **MET** | gate exit 0 + zero diff across 5 engine packages |

**On "one writer", and why the naive measurement is wrong.** A `grep -l` for the path returns ten
files, which would read as ten writers. Nine are not: `check-public-copy.mjs` and
`presentation-plane-audit.ts` *read* it, `emitCohort.ts` and `renderDiscoveryManifest.ts` describe
or route it, the test files assert on it, and `generate-distribution-surfaces.mjs`'s two
non-comment hits emit the *URL as a value* (one metadata field, one documentation link) rather than
the file. The single write is `emitSafeInstall.ts:191` —
`files.push({ path: ".well-known/calllint.json", content: renderDiscoveryManifest(discovery) })`.
Counting mentions instead of writes is how the earlier two-writer collision was able to hide.

**The seven §12 paths, each checked individually at this commit:**
`apps/web/public/distribution`, `apps/web/public/.well-known/agent.json`,
`apps/web/data/capabilities.json`, `packages/agent-registry`, `apps/web/public/agents`,
`apps/web/data/distribution`, `apps/web/public/discovery` — **all ABSENT**.

---

## 10. Remaining manual actions

Nothing in this list is blocked on code; each is an operator decision or an external event.

1. **Merge and publish are NOT authorised.** The standing instruction for this work is 「确保但是暂时
   不合并也不publish」. PR #329 is `OPEN` and stays open. Measured: the branch is **3 commits ahead
   of `origin`** — `cd0837c`, `abfb44a` and this report are local only, so the PR currently shows
   the work up to `eabd580`. Pushing is a separate, metered act and was not performed.
2. **Cloudflare Access, `USAGE_HASH_KEY`, and the real `database_id`** remain unauthorised
   (new18 §106 P (2)). No code here depends on them.
3. **Observe the watcher's first run** when the weekly cron fires, and confirm the first clean
   source baseline. Measure it; do not predict it.
4. **new18 unification** — measured, and it needs **no edit**. §107's vocabulary already carries
   `AGENT_DISCOVERY = READY`, which is the name this work would have added. It is also, measured,
   **read by no gate**: nothing under `tests/`, `scripts/`, `packages/` or `apps/` mentions
   `AGENT_DISCOVERY`, and every file that cites `new18` cites §45 (release ancestry), not §107. So
   §107 is a human-facing vocabulary, and adding `AGENT_DISCOVERY_INDEX` beside the name that
   already covers it would create a second unread label — the duplicate-truth failure this
   workstream removed. `OPERATOR_ACTION_REQUIRED` stays **1** (§106 P's credential/environment
   item); this work adds no operator action, which is what "stays 1" had to mean.
5. **§5's tier vocabulary is now implemented** as a §9/§3040 membership assertion (§2 above),
   reversing what this report first recorded. It is deliberately **not** a `hosts[]` field: the
   obligation §9 states is "a record exists for each of these fourteen", which needs no column, and
   a column no gate reads is the duplicate truth this work removed. Nothing here is owed.
6. **new18 §29 stays fail-closed, and that is the terminal state — not debt.** Clearing it means
   verifying an account-level Cloudflare Access policy from CI, which requires a token carrying
   `Access: Organizations, Identity Providers, and Groups — Read`. That is strictly larger authority
   than this pipeline needs to read a D1 table, and a private usage report does not justify minting
   it (the reasoning is recorded in
   [CLOUDFLARE_ACCESS_ACTION.md](../authority-distribution-closure/CLOUDFLARE_ACCESS_ACTION.md)).
   `OPERATOR_ACTION_REQUIRED` therefore stays **1** by design.

   What *was* owed there is now closed: §29's nine-surface prohibition held but **nothing enforced
   it**. `scripts/check-public-copy.mjs` check 24 now locks it over 45 surfaces (2 sitemaps, 20
   harness pages, 23 depth-1 files including nav/footer, README, both llms files, robots and agent
   instructions), plus an assertion that `usage-report.yml` uploads an artifact and carries no
   deploy or commit path. Two details worth keeping:

   - The cohort is **built by the check, not inherited**. The guard's own `discoverPublicFiles()`
     takes depth-1 `.html/.md/.txt`, which misses two of the nine surfaces outright — sitemaps are
     `.xml`, and harness pages live in per-host subdirectories. Reusing it would have scanned
     neither while printing a checkmark.
   - The needle is the **host**, not the word "usage". `## Basic Usage` appears in `llms.txt` and
     `llms-full.txt` as CLI documentation; a naive `/usage/i` reds on both. The tokens are the ones
     that can only mean the private surface (`usage.calllint.com`, `calllint.com/usage`, `/usage/`,
     `dist/usage`, `usage-report`).

### Recorded, deliberately not fixed — out of scope

- The Distribution section of `host-page.hbs` renders primitive `{{state}}` values
  (`AUDIT_REQUIRED`, `PENDING_UPSTREAM`) as visible human text. Not in `INTERNAL_ONTOLOGY`, so §20
  does not forbid them; the behaviour predates this work.
- `predictCtaColumns` divergence window `vp ∈ [492, 529]`, 38px wide — the arithmetic model flips
  the CTA row at 492 where the browser flips at 530, because the model computes from `vp − 40` and
  reality is `vp − 77.6`. First measured in
  [authority-distribution-closure/FINAL_REPORT.md](../authority-distribution-closure/FINAL_REPORT.md),
  not by this work; re-derived from the shipped `CTA_REFLOW_RULES` at this commit and unchanged.
  All three graded viewports (390 / 768 / 1280) sit outside the window, so the grader stays correct.
- A misnamed test in `packages/trust-index/test/safe-install/token-plane.test.ts` (~line 579).

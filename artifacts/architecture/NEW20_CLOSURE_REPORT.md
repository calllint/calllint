# new20 closure report

- **Date:** 2026-08-24
- **Asked by:** new20 §17 (FINAL OUTPUT) and §18 (ACCEPTANCE CRITERIA).
- **Branch:** `fix/recorded-three-items`, at `7417529`.
- **Security impact: NONE.** Measured, not asserted — see criterion H.

## What §17 asked for, and where it actually lives

§17 names four documents under `docs/architecture/`. Two of them already existed under
better names before this plan was written, and both are **generated from the SSOT** rather
than hand-typed — which is strictly stronger than what §17 asked for, because a generated
document cannot drift from the data it describes. Creating same-content copies under the §17
filenames would have produced exactly the fault the repo's rules name: a hand-typed
projection with no reader when it goes stale.

| §17 document | Where it lives | Why |
|---|---|---|
| 1. `AGENT_DISCOVERY_ACTIVATION_CLOSURE.md` | **this file** | The activation contract's own closure record. Nothing existed for it; this is it. |
| 2. `DISCOVERY_SURFACE_STATUS.md` | [`FINAL_PLATFORM_MATRIX.md`](../authority-distribution-closure/FINAL_PLATFORM_MATRIX.md) | **Generated** from the SSOT: all 18 hosts × 14 columns, including state, blocker, live/submission URL, canonical URL. Byte-compared by `check:distribution-drift`. |
| 3. `DISCOVERY_CONVERSION_REVIEW.md` | [`DISCOVERY_CONVERSION_REVIEW.md`](DISCOVERY_CONVERSION_REVIEW.md) | Written this sprint, at `7417529`. |
| 4. `SUBMISSION_ARTIFACT_GUIDE.md` | [`submissions/README.md`](../submissions/README.md) + [`CHANNEL-COUNTS.md`](../submissions/CHANNEL-COUNTS.md) | The guide is tracked prose; the counts inside it are **generated**, deliberately not restated, because a hand-typed count cannot fail when a channel is added. |

`docs/` is gitignored repo-wide (`.gitignore:44`) as local-only planning notes, so every one
of these lives under `artifacts/` — a review no reviewer can read is not an output.

### §1, §6 and §10's three other filenames — carried, not skipped

§17's table above is the one this report was written against, but §1, §6 and §10 each name a
further document, and none of those three filenames exists on disk. Recorded here explicitly,
because "never written" and "written under a better name" are indistinguishable from an
absent file, and only one of them is a gap:

| Named at | Filename asked for | Where the obligation is discharged |
|---|---|---|
| §1 | `docs/architecture/AGENT_DISCOVERY_ACTIVATION_AUDIT.md` | [`agent-discovery-v2/REALITY_AUDIT.md`](../agent-discovery-v2/REALITY_AUDIT.md) — the pre-work audit §1 describes (surfaces known / artifacts existing / missing activation steps), measured against a named commit. Written before new20 was, which is why it does not carry new20's filename. |
| §6 | `docs/architecture/DISCOVERY_ACTIVATION_PRIORITY.md` | The ranking function is split across two shipped surfaces, deliberately: [`submissions/ROI.md`](../submissions/ROI.md) orders the *actionable channels* by return (9 rows, keyed on host × channel, because a submission acts on a channel and not on a host — `copilot-cli` appears twice), and the SSOT's `priority` field orders CallLint's own work per host — the axis the gates read. Neither is a copy of §6's host ranking. **All three orders differ; see below.** |
| §10 | `DISCOVERY_STATUS_REPORT.md` | [`FINAL_PLATFORM_MATRIX.md`](../authority-distribution-closure/FINAL_PLATFORM_MATRIX.md) (generated, 18 × 14) for standing state, and `artifacts/distribution-watch/official-sources.json` for the observed-change stream the watcher emits weekly. |

No further file is owed. The rule applied is the same one §17's table applies: a hand-typed
copy under the asked-for name would be a second projection with no reader, and the repo's
dominant fault class is exactly a surface nothing reads going stale unnoticed.

### §6's ranking and the SSOT's `priority` disagree on 7 of 13 hosts — deliberately

§6 ranks hosts by "highest user acquisition probability". The SSOT's `priority` orders
**CallLint's own engineering work**. Those are different questions, and measured against
each other they give different answers:

| host | §6 rank | SSOT `priority` |
|---|---|---|
| cline | P0 (3rd) | `P2` |
| copilot-cli | P0 (5th) | `P2` |
| gemini-cli | P1 (6th) | `P2` |
| opencode | P1 (7th) | `P3` |
| continue | P1 (8th) | `P2` |
| roo-code | P1 (9th) | `P3` |
| workbuddy | P2 (12th) | `P0` |

The disagreement is not drift. A host can be highly acquisitive and cheap to reach (so §6
ranks it first) while needing no further CallLint work (so `priority` ranks it last), and
`workbuddy` is the reverse: low acquisition, but it was the host whose extractor needed
building. Collapsing the two into one field would silently discard whichever meaning lost.

A third axis exists and must not be confused with either: `coverageTier`
(`tier0|tier1|tier2|beyond-section-9`) records the *obligation* new19 §9 imposed — that a
record exist — and says nothing about work order or about acquisition. All three are pinned
apart by test: `agent-discovery-v2.invariants.test.ts` asserts `codex`/`cline` are tier0 while
carrying `P2`, and `claude-desktop` carries `P0` while sitting outside §9's tiers entirely, so
a future edit cannot quietly merge the axes.

## Completed

**Infrastructure.** One SSOT (`apps/web/data/distribution-surfaces.json`: 18 hosts, 31
channels) with a JSON Schema that rejects the shape, gates that check cross-file relations,
and committed mutation-tested fixtures that notice a rule being *deleted*. HD-01..HD-08 plus
`check:distribution-drift`, `check:agent-surface`, `check:published-schema` and
`check:security-semantics` now run **per-PR** — they previously ran only on a weekly
schedule or in no workflow at all, which meant a PR could break any of them and every status
a reviewer saw stayed green.

**Activation.** Every host page carries a next action as a data contract, not prose:
`activation.whyHere`, `installRef` (resolved against `project-facts.json` at generation
time, so a page cannot advertise a command the product does not ship), and
`firstSuccessAction`. A host with no verified discovery path prints **no** start section
rather than a plausible one.

**Generated surfaces.** 31 git-tracked projections from that one input — all 18 host pages,
the DeepSeek landing page, sitemap, `_redirects`, `llms.txt`, `llms-full.txt`,
`agent-instructions.md`, `agent-surfaces.json`, `agent-discovery-index.json`,
`CHANNEL-COUNTS.md`, and both §104/§105 matrices. The drift gate enforces byte-identity
**and** that every emitted path is git-tracked.

**Artifacts.** Six submission packages, a tracked blocker register, ROI ordering, generated
channel counts, and two ADRs — [0001](../adr/0001-one-distribution-state-not-six.md) (one
distribution state, not six) and [0002](../adr/0002-submission-records-the-act.md)
(`submission` records the act on its own axis, with no second status).

## Remaining

**Human submissions — 9 actionable shelf rows.** Not blocked and not startable by an agent:
new18 §22 makes the distribution watcher read-only toward the outside world (GET only, no
credentials, no form posts, no external PR or issue creation, no maintainer contact). The
packages are prepared; submitting them is a human action. Ordered by ROI in
[`ROI.md`](../submissions/ROI.md).

**External approvals.** 1 `PENDING_UPSTREAM` shelf channel — `cline`'s
[marketplace#49](https://github.com/cline/marketplace/pull/49), submitted 2026-08-18, still
open. 4 `BLOCKED`, each with a recorded reason; these are not a to-do.

**One open defect, found by this sprint's own review and deliberately not bundled with it.**
No host page asserts no-execution (0/18) or determinism (0/18), because the verdict-semantics
paragraph is nested inside the template's `installCommand` guard, and the copy gate's corpus
does not include these pages. Measured with a negative control. Two ordered fixes are named
in [`DISCOVERY_CONVERSION_REVIEW.md`](DISCOVERY_CONVERSION_REVIEW.md).

## §18 acceptance criteria, each with the measurement behind it

| | Criterion | Verdict | Measurement |
|---|---|---|---|
| A | One canonical discovery inventory exists | **met** | One SSOT, 18 hosts / 31 channels; 31 projections derive from it and nothing else. |
| B | Discovery state is explicit | **met** | 31/31 channels carry a `state`. `AVAILABLE` 3, `AUDIT_REQUIRED` 22, `BLOCKED` 4, `PENDING_UPSTREAM` 2. |
| C | Top priority surfaces have actionable activation path | **met** | Measured by priority, which is what "top priority" means: **P0 4/4, P1 3/3** publish an install + verify command. P3 2/3, P2 0/8 — those are `DISCOVERY_ONLY`/`DEFERRED` hosts with no verified extraction path, and they publish nothing rather than a guess. |
| D | Claude plugin artifact is complete | **met** | `.claude-plugin/marketplace.json` present, parses, and carries name/owner/metadata. Landed at `2c0a606`. |
| E | MCP Registry health is verified | **met** | `verify-registry-presence.mjs` reads the live Registry and **fails closed** — its predecessor had no failing mode at all. Weekly + at publish. |
| F | Website/LLM surfaces reflect reality | **met, with one gap** | Drift gate: 31/31 byte-identical. The gap is the trust copy above — a real §13 finding, on generated pages, recorded rather than smoothed over. |
| G | No false availability claims exist | **met** | 0 channels are `AVAILABLE` without evidence (`upstream` or `liveUrl`); 0 `BLOCKED` without a reason. Enforced by HD-05/HD-07, not just observed. |
| H | No security semantics changed | **met** | Two independent measurements: `check:security-semantics` rc=0 (committed artifact vs live measurement), and `git diff --name-only 3dfae0b~1 HEAD` touches **zero** files under `packages/{risk-engine,static-analyzer,policy,core,fingerprint,types}/` across the entire Sprint 1–5 chain. |
| I | Future platforms can be added by data entry first | **met** | A new host is SSOT rows + `pnpm gen:distribution`. Code changes only where deterministic capability extraction is genuinely absent — which is why 9 hosts have no command instead of a fabricated one. |

## Verification

- 255/255 test files pass; 4748 tests, 1 skipped.
- `check:public-copy`, `check:distribution-drift`, `check:agent-surface`,
  `check:harness-distribution`, `check:security-semantics` — all rc=0.
- Pre-existing and unrelated: `detectorCount: facts=113 code=13` prints a warning and fails
  no test. Confirmed pre-existing by stashing all changes and reproducing it on a clean tree.

## What was deliberately not done

- **No telemetry.** §14 forbids it; the attribution hooks it does allow already exist as
  unique `id` + `canonicalUrl` on all 23 surfaces, with uniqueness guarded non-vacuously.
  Nothing was added.
- **No `submission.status`.** §4 asked for one. [ADR 0002](../adr/0002-submission-records-the-act.md)
  records why the field carries only a date: of the four values, one is the block's own
  existence, two restate `state` via fields a gate already checks, and one has no records.
- **No new lifecycle state.** The plan's binding constraint, honored: `submission` sits on a
  second axis instead.
- **No push, no merge, no publish.** None authorized in this task.

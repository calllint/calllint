# ADR 0061 — Canonical Adoption Graph & Rolling Evidence Compiler: what a compiler that never runs its subjects is allowed to be

- Status: Accepted (2026-08-02). Boundary-only decision artifact; changes **no**
  behavior, **no** served byte, and **no** line of production code. It freezes the
  invariants Phase 2.3 (new15 Workstream R — Canonical Adoption Graph, Rolling
  Evidence Compiler, content-addressed evidence store, self-hosted worker, registry
  expansion) must honor before any of it is built. Written first in Workstream R /
  Batch 0 / PR R-0. Acceptance authorizes the PR R-1 build to begin under these
  boundaries; it does **not** by itself compile one record, fetch one registry page,
  or create one database file.
- Date: 2026-08-02 (PR R-0)
- Refines: 0038 (public Trust Index boundaries — the direct parent; serving reads
  committed static artifacts, and a rolling compiler must not turn serving into
  computation), 0034 (evidence provider interface — the compiler is a new *producer*
  behind that interface, not a second interface), 0053 (distribution-index boundary
  — publish channels and what an index is allowed to assert), 0056 (safe-install
  acquisition projection — the projection the graph feeds)
- Related: 0057 (adoption deep link — **and why this ADR is not 0057**; see §1),
  0058 (presentation control plane — the Workstream-P sibling boundary; P closed at
  `84f56c5`/#248), 0059 (install capsule first screen), 0035 (authority manifest),
  0036 (install-plan approval binding), 0039 (decision-receipt v1), 0043 (schema
  `$id`/domain convention — the adoption-record schema follows it), 0054 (claim
  auto-adoption), 0055 (agent-search capture & safe-install gateway boundary)

## §1 Numbering: this ADR is 0061, and the tracker said 0057

The tracker is wrong about the number, and the correction is recorded here rather
than applied silently, because a bare `0061` that matches no planning document is
harder for a later reader to trust than a stated history.

The chain, measured against the repo at `84f56c5` rather than read from prose:

1. The Blueprint's suggested-ADR list (doc 09 §6) proposed `0053`–`0060`. **None of
   those numbers were ever free** — real 0053 = distribution-index-boundary, 0054 =
   claim-auto-adoption, 0055 = agent-search-capture, 0056 = safe-install-acquisition-
   projection. `docs/new15-integration.md` §2.1 already caught this once and
   corrected the Workstream-R boundary ADR to **0057**.
2. That correction has since been overtaken by shipping. `adrs/0057-adoption-deep-
   link-boundary.md` is the `calllint://` deep-link boundary, merged in `8ef6319`
   (#245). `0058` is the presentation control plane, `0059` is the install capsule.
   The highest ADR on disk is 0059.
3. The next apparently-free number, **0060, is the one number not available.** It is
   reserved for the `overrides.resources` `propertyNames` fix by **committed,
   drift-checked artifact bytes**: `artifacts/phase-2.4/presentation-plane-audit.json`
   says verbatim *"that is a schema change requiring an ADR, and ADR 0060 is reserved
   for it"*, and the reservation is also written into that artifact's generator
   (`scripts/presentation-plane-audit.ts`) and into one of its fault messages. Those
   bytes are regenerated and byte-compared by a gate in `pnpm ci:local`. Taking 0060
   would put `adrs/` in contradiction with an artifact the CI already enforces.
4. **Therefore this ADR is `0061`.**

**This renumber is in-contract, not a deviation.** `docs/new15-integration.md` §2.1
carries its own escape clause for exactly this moment: the recommended numbers have
*"final numbers assigned at authoring, after re-inspecting the repo — **never trust
the blueprint's numbers**"*. PR R-0 is that authoring moment. An ADR-number gap is
established practice here, not an anomaly: `adrs/` holds 28 ADRs spanning 0016–0059
with 16 numbers missing (`0018`–`0032`, `0042`; 0042 lives in the frozen `docs/adr/`
tree).

Two consequences follow, and both are decisions rather than notes:

- **0060's reservation is left untouched.** This ADR does not claim it, does not
  amend the artifact that reserves it, and does not fix `overrides.resources`. That
  remains a separate schema change owing a separate ADR.
- **The stale `0057` references in the tracker are corrected in place, with the
  reason preserved.** They are not deleted. This follows the repo's shipped
  discipline of inverting a stale assertion rather than removing it, so that a reader
  who arrives via the old number learns why it moved.

### §1.1 The PR-label collision is real and is not to be "fixed"

ADR 0057 (deep link) and ADR 0059 (install capsule) both landed in `8ef6319`/#245
under the labels **"PR R-1"** and **"PR R-2"**. The Rolling Compiler's own R-1 and
R-2 are *different, not-started* pull requests. Both labellings are legitimate; they
were assigned by different documents at different times.

**Decision: disambiguate by ADR number, permanently. Never renumber either side.**
A reader who sees "R-2" must resolve it by asking which ADR it carries, not by
assuming a sequence. Renumbering the compiler's batches to dodge the collision would
invalidate every cross-reference in the execution plan to buy nothing.

## Context

Phase 2.3 is the one phase of the plan that was never built. Phases 2.4–2.6 shipped
*around* it: a baked Trust object per resource, an Install capsule, an Agent Adoption
Contract, a safe-install gateway, safe search, an install hook, and — as of #248 —
a presentation control plane over all of it. Every one of those consumes a set of
adoption facts that today is produced by a **one-shot bake over a hand-maintained
25-entry cohort**.

What is missing is the thing that keeps those facts *true over time*: a canonical
identity graph for adoption subjects, and a rolling compiler that re-derives evidence
on a schedule, gives every source record a terminal state, and stores what it saw in
a content-addressed store so that a page emitted last month can still be explained.

That is a substantial new subsystem — a database, a worker, a job state machine, a
CAS, and a registry ingestion path that will grow from 25 to 500+ subjects. It runs
on a self-hosted Linux host rather than in CI. It is, in other words, the first piece
of CallLint infrastructure that is **long-lived, stateful, and network-facing**.

Everything CallLint has refused to become is one careless design decision away from
here. A compiler that re-derives evidence is one `npm install` away from executing
its subjects. A compiler with a database is one migration away from being the second
place a verdict is decided. A compiler with a worker on a shared VPS is one
convenience away from reading credentials that belong to a different tenant.

So the boundary has to be written before the first line, which is what this ADR is.

## The problem this ADR actually solves

Existing ADRs bound *who may decide* (0020, 0035, 0036) and *what serving may do*
(0038, 0053). ADR 0058 bound *what a config edit may reach*. None of them bound
**what a long-running producer may do to obtain evidence**, because until now there
was no long-running producer: every fact was derived inside a CI job that started
from a clean checkout and ended.

Without that boundary, "resolve evidence for 500 subjects" has no reviewable
stopping point. Each subsequent PR gets to argue afresh whether one more probe is
"just reading metadata" — and the honest answer is that installing a package to see
what it does is the single most effective evidence-gathering technique available, and
it is permanently forbidden here. A boundary that is only re-litigated per-PR will
eventually lose one of those arguments.

## Decision

### §2 The compiler never executes its subjects. This is a property of the design, not of the code review

INV-04 already forbids target execution. This ADR states the enumerated list as the
compiler's own boundary, because the compiler is the component with the strongest
incentive to violate it:

```text
runs npm lifecycle scripts
runs setup.py / build backends
starts a container
loads a native library
starts an MCP server
connects to a remote MCP server
tests target credentials
```

**Decision: the compiler's only permitted network operations are registry metadata
reads and artifact *downloads* — never artifact *execution*.** A downloaded tarball
is a blob to be hashed and statically inspected. It is never unpacked into a location
on `PATH`, never handed to a package manager, and never `require`d.

Two structural consequences, both intended to make the boundary hold without relying
on reviewer vigilance:

- **A no-execution surface is easier to keep than a no-execution policy.** The
  compiler package must not depend on a package manager, a container runtime, or a
  child-process helper. If executing a subject requires adding a dependency, the
  violation shows up in a lockfile diff rather than in a control-flow review.
- **Static inspection reuses the shipped analyzer.** `@calllint/static-analyzer`
  already inspects untrusted code without running it. The compiler calls that; it
  does not grow a second inspection path with different safety properties.

### §3 The compiler writes zero host configuration, and persists only under its own data directory

**Decision: the compiler is not a writer.** `applyPlan`
(`packages/install-planner/src/applyEngine.ts`) remains the only writer of host
config, exactly as INV-02 requires, and the compiler does not delegate to it either
— it has no reason to write host config at all. It produces records and artifacts;
a *human* or an *agent* later takes those to the Trust Gateway.

**Decision: all compiler state lives under `.var/calllint-adoption-index/`.** The
database, the WAL files, the CAS blobs, and the job state all sit there. Nothing is
written to `$HOME`, to any host config location, to any MCP or editor settings file,
or anywhere in the served tree except through the existing bake path.

This is INV-09 read strictly: a compiler that is deployed once must not acquire
persistent presence on the host beyond its own data directory. It follows that
uninstalling the compiler is `systemctl disable` plus deleting one directory, and
that claim must stay true.

### §4 The graph decides identity. It never decides a verdict

**Decision: the Canonical Adoption Graph resolves *which subject this is*. It has no
opinion about whether that subject is safe.** INV-01 is unchanged and unweakened:
`computeVerdict` (`packages/risk-engine/src/computeVerdict.ts`) is the only verdict
engine, and no adapter, compiler, graph query, page renderer, Agent Contract, or LLM
may issue or modify a verdict.

The failure mode this forecloses is specific and tempting: a graph that has resolved
"these four registry entries are one subject" is one field away from also recording
"and this subject is trusted", because it is the only component that has seen all
four. It must not. Identity merging produces an identity; the verdict is computed
downstream from evidence, every time, by the one engine.

**Decision: an identity conflict is a terminal state, not a guess.** INV-10's
`IDENTITY_CONFLICT` is a real destination. When two records cannot be proven to be
the same subject or proven to be different, the compiler records the conflict and
stops; it does not pick the more likely merge. This is INV-05 applied to identity: a
failure to resolve cannot improve anything.

### §5 Serving stays static. The compiler is upstream of the bake, never inside serving

**Decision: nothing served ever queries the compiler.** ADR 0038's boundary holds
unchanged — public serving reads committed/generated static artifacts, with no
serving-time scan, registry resolution, or plan creation. The compiler runs on its
own schedule, produces records, and the existing bake path projects them into
`apps/web/public/`. A request for a Trust page must never cause a database read.

It follows that the compiler's availability is not the site's availability, and that
a compiler outage degrades *freshness* only. That property is worth more than any
latency it costs, and it is why the SQLite-plus-filesystem shape below is sufficient
rather than limiting.

### §6 O-2 — the compiler is a new package: `packages/adoption-index/`

**Decided.** The compiler lives in `packages/adoption-index/`, with migrations under
`packages/adoption-index/migrations/`. It is a new package, not an expansion of
`packages/trust-index/`.

`packages/trust-index/` is the *projection* layer: it bakes, renders, and emits. It
is reached by CI and by the bake script. The compiler is a *stateful producer* with a
database and a worker lifecycle. Merging the two would put a native-or-stdlib
database dependency into the package that CI builds on every PR, and would make
"does this change affect served bytes?" harder to answer than it is today.

Only the compiler's later Layer-4/Layer-5 edits touch `packages/trust-index/src/`,
and those are EXTEND edits to existing entry points, reviewed as projection changes.

### §7 O-3 — the SQLite driver is `better-sqlite3`, pinned to exactly `12.9.0`

**Decided, with the version pinned exactly and no range operator.** The dependency
is recorded as `"better-sqlite3": "12.9.0"` — not `^12.9.0`, not `~12.9.0`.

> **AMENDED 2026-08-03, at R-1 authoring time, by re-measurement.** This section
> originally pinned **`12.11.1`**. That pin was chosen by reading `engines.node`,
> which for `12.11.1` still declares `20.x`. Re-measuring against the registry and
> the upstream release assets found a second, independent fact that `engines.node`
> does not express: **`better-sqlite3` dropped its Node 20 prebuild (ABI 115) at
> `12.10.0`**, while continuing to declare `20.x` support.
>
> | version | `engines.node` | node-ABI prebuilds | ABI 115 (Node 20) |
> | --- | --- | --- | --- |
> | `12.9.0` | `20.x \|\| 22.x \|\| 23.x \|\| 24.x \|\| 25.x` | 115, 127, 131, 137, 141 | **yes** |
> | `12.10.0` | `20.x \|\| … \|\| 26.x` | 127, 137, 141, 147 | no |
> | `12.11.1` | `20.x \|\| … \|\| 26.x` | 127, 137, 141, 147 | **no** |
> | `13.0.2` (latest) | `>=22` | — | excluded by the floor |
>
> The repo floor is `>=20` and **all three CI legs run Node 20**
> (`ci.yml:29` `[ubuntu-latest, macos-latest, windows-latest]`, `:42`
> `node-version: 20`). `better-sqlite3`'s install script is
> `prebuild-install || node-gyp rebuild --release`, so under the original pin every
> leg would fall through to a **source build**, adding a Python and C++ toolchain
> dependency to CI on three operating systems. `12.9.0` is the newest release with an
> ABI-115 prebuild, and its coverage was verified per leg: `win32-x64`,
> `darwin-arm64`, `darwin-x64`, `linux-x64`.
>
> The original reasoning below is left standing rather than rewritten, because it was
> not wrong — it was **incomplete**, and the shape of the omission is the reusable
> lesson: `engines.node` states what upstream *permits*, prebuild assets state what
> upstream *ships*, and only the second one decides whether CI compiles C++. This is
> the case §7's closing paragraph anticipated: this ADR is authority for the decision
> *procedure*, never a cache of a version fact.

The candidate this displaces is `node:sqlite`, and the reason it loses is measured
rather than preferred: **the repo's own Node floor forbids it.** `package.json`
declares `engines.node: ">=20"`, and `.github/workflows/ci.yml` runs the gate matrix
on Node 20. `node:sqlite` did not exist in Node 20. Choosing it would mean either
raising the floor for every package in the monorepo to serve one new package, or
shipping a package that cannot run on the version the CI proves against. Neither is
worth the saved dependency.

**The same floor selects the version, and it is not the newest one.** Measured
against the registry on 2026-08-02: `better-sqlite3@13.x` declares
`engines.node: ">=22"` and has dropped Node 20; the highest release that still
declares support is `12.11.1`
(`engines.node: "20.x || 22.x || 23.x || 24.x || 25.x || 26.x"`). Pinning 13.x would
reintroduce the exact incompatibility that disqualified `node:sqlite`, which is why
the version is measured rather than taken from `npm view better-sqlite3 version`.
When the monorepo floor rises to 22, moving to 13.x is a deliberate follow-up with
its own lockfile diff — not a range operator that would have done it silently.

*(Superseded in part by the amendment above: `12.11.1` declares the floor but does
not ship a binary for it. The selection rule is unchanged — the floor still selects
the version — but the rule now reads both `engines.node` **and** the published
prebuild ABIs, which moves the answer to `12.9.0`.)*

`better-sqlite3` is native and needs a build toolchain, which is a real cost. It is
an acceptable one here because §10.1 of the execution plan fixes the production
target as **a single Linux host** — one platform, provisioned once, not a
cross-platform install path. Windows/WSL is dogfood only. The compiler is explicitly
not part of the npm-published CLI surface, so no end user builds it.

**The exact pin is a reproducibility requirement, not a style preference.** A range
operator on a native module means the bytes that get compiled depend on when the
install ran. This repo already gates artifact reproducibility by byte-comparing
regenerated output; an open range would make that gate's green a statement about a
moment rather than about a commit.

### §8 O-1 — credential provisioning stays the user's decision, and LORDL secrets are never harvested

**Not decided here, deliberately.** O-1 covers how the CallLint systemd units are
provisioned on the existing VPS and whether the co-tenant LORDL deployment is left
running or stopped. That is the user's call, and this ADR records only the boundary
it must respect:

- **LORDL secrets are never read, printed, copied, or harvested** — not by the
  compiler, not by a provisioning script, not by an agent working in this repo. The
  files that hold them are referenced by name only when a name is unavoidable, and
  never by value.
- CallLint's own credentials are documented **by key name only**, never by value, in
  whatever artifact records the deploy shape.
- The CallLint units get their own systemd unit, their own `.var/` data directory,
  and their own ports. Co-tenancy on one host is not shared state.

When the user decides the deploy shape, it is recorded as an amendment to this ADR or
as a follow-up ADR — not inferred from whatever a script happened to need.

> **AMENDED 2026-08-04 — the user decided the deploy shape. O-1 is now CLOSED.**
> Recorded here, per the sentence above, rather than left to a provisioning script.
>
> **The decision, in the user's terms:** deploy on the **existing Aliyun VPS**,
> **co-tenant with LORDL, which is left running** — not stopped, not disabled. The
> user offered to take LORDL down to free resources; measurement says that trade buys
> nothing, so it is declined on evidence rather than accepted on courtesy.
>
> **§8.1 The committed artifact stays a pure function of committed bytes (the load-bearing half).**
> The worker owns the canonical store and the CAS. It does **not** own
> `packages/trust-index/snapshots/adoption-index.json`: that file is always produced by
> the `--from-snapshot` path, never by a warm store. `firstSeenAt` history lives on the
> worker and does not enter committed bytes.
>
> This is not a new rule and does not need a new gate — **it is already gated**, which is
> why it was chosen over the alternatives. `packages/trust-index/test/committed-tree.test.ts`
> re-derives the committed document from the committed snapshot and byte-compares
> (control #117), and separately pins `adoption.projectedAt === snapshot.fetchedAt`.
>
> **Both halves were falsified before this amendment was written** (2026-08-04, negative
> controls run against the committed file, which was then restored byte-identically):
>
> | Mutation, simulating | Result |
> | --- | --- |
> | `projectedAt` → a wall clock (`2026-08-04T08:15:00Z`) | **1 failed / 123 passed** — the `fetchedAt` pin |
> | a 20th ghost subject (the warm store's larger row set) | **1 failed / 123 passed** — control #117's byte-compare |
>
> Each shape trips **one** test, not both, and the split is by design: the byte-compare
> deliberately reads `projectedAt` from the committed document (`committed-tree.test.ts:151-154`)
> so that it measures identity rather than timing, while the stamp is pinned separately. A
> real warm-store artifact carries both defects at once and so trips both — but each is
> caught independently, which is what makes the pair non-redundant.
>
> The measurement that makes this load-bearing is already recorded at
> `packages/trust-index/src/projectAdoptionIndex.ts:81-86` — run against a warm `.var/`,
> the store path emitted **298** subjects under a wall clock while the committed snapshot
> beside it derived **19**, and the snapshot's own `io.github.calllint/calllint` was
> **absent** from the 298. Those are two different observations, not a superset and a
> subset. **In Actions the store is ephemeral, so it is always cold and the two paths
> agree; a persistent store on a VPS is warm by definition.** So the thing that currently
> keeps the committed artifact reproducible is the absence of persistence — exactly what
> R-9 introduces. Recording §8.1 is what keeps R-9 from silently spending that guarantee.
>
> **Consequence for `trust-ingest.yml`:** unchanged. Its `project-adoption-index:trust-index:store`
> step (line 94) stays correct **because** Actions' store is cold and was just written by
> the ingest one step earlier. The worker does not inherit that property, and therefore
> does not inherit that step.
>
> **§8.2 Provisioning and credentials.** The credential-provisioning method is a dedicated
> deploy key / service account supplied out-of-band by the operator, recorded in the deploy
> runbook **by key name only**. The §8 boundary above is unchanged and unweakened:
> **LORDL's secrets are never read, reused, copied, or harvested** — this amendment adds no
> exception, and the isolation contract needs none to be correct. ~~This repo contains no
> `deploy/` directory at all~~ — **superseded by §8.5: `deploy/adoption-index/` now exists and is
> the only thing under `deploy/` here.** The claim it was making still holds and is what matters:
> LORDL's `deploy/systemd/**`, `deploy/nginx/**`, and `deploy/ssl.env` live in a **separate
> repository**, so `deploy/adoption-index/**` has no path overlap with LORDL's tree. Isolation is a
> filesystem fact here, not a convention to be remembered.
>
> **§8.3 Resource quotas, and what each number is argued against.** Measured
> 2026-08-04 rather than estimated:
>
> | Measured | Value | Where |
> | --- | --- | --- |
> | committed registry snapshot | 490 B / entry (9 310 B / 19) | `snapshots/official-mcp-registry.json` |
> | committed identity plane | 404 B / subject (7 681 B / 19) | `snapshots/adoption-index.json` |
> | committed evidence | 1 149 B / record (20 682 B / 18) | `snapshots/evidence-snapshot.json` |
> | empty SQLite schema | 131 072 B (32 pages × 4 096) | local `.var/`, **0 data rows** |
> | full upstream walk | 653 pages / 65 235 records / 7 090 s | `trust-ingest.yml:45` |
> | per-run artifact ceiling | 64 × 32 MiB = **2 GiB** | `DEFAULT_MAX_ARTIFACTS` × `DEFAULT_MAX_ARTIFACT_BYTES` |
>
> `MemoryMax=1G`, `CPUQuota=50%`, `TasksMax=256`, `IOWeight=100`. The memory number is
> argued against a full-corpus database, not against today's 19 rows: ~2 KB of projected
> JSON per subject across the three planes × 65 235 records ≈ 133 MB raw, and SQLite with
> indices runs 2–3× that, so 270–400 MB of database against a 1 GB ceiling leaves room for
> Node, the driver, and one 32 MiB artifact buffer. `CPUQuota=50%` is the co-tenancy term:
> it bounds a compile storm's blast radius so it cannot starve LORDL, per §7.1.
>
> **§8.4 A CAS retention policy is now an R-9 deliverable, because it does not exist.**
> Measured, not assumed: `packages/adoption-index/src/artifacts/` contains **no** GC,
> prune, evict, or retention path — the only `rmSync` calls (`cas.ts:85,88`) delete a
> failed *staging* file, never a stored blob. **CAS growth is therefore monotonic and
> unbounded**, and no committed line states a disk ceiling. A quota cannot be derived
> from code that has no retention policy, so this amendment does not invent one by
> arithmetic. R-9 must ship a retention policy **together with** the daily backup, and
> a monotonic CAS on a co-tenant host is precisely the failure mode §7.1's quotas exist
> to prevent. Until R-9 ships it, the operator's disk headroom is the only bound —
> stated here so it is a known gap rather than a discovered one.
>
> **§8.5 The §8.4 gap is CLOSED — the retention policy shipped with the units.** `pnpm prune:cas`
> (`packages/trust-index/src/{casRetention,pruneCas}.ts`) deletes blobs whose mtime precedes
> `now - CAS_RETENTION_DAYS`, default **90**, and runs as the third `ExecStart` of
> `deploy/adoption-index/calllint-adoption-worker.service`. §8.4's "together with" is honoured
> literally: the units and the policy are one change, so no revision of this repo has a worker
> without a bound.
>
> Three things were measured while closing it, each of which had to change a decision:
>
> - **The blob tree is two levels deep** (`cas/blobs/<hex[0:2]>/<hex>`, `paths.ts:90`). A
>   single-level sweep typechecks, passes a flat-layout test suite, and inspects **zero** blobs
>   against a real store. The tests place their blobs through `casBlobPath` for that reason, and a
>   negative control confirmed 5 of 8 go red when the descent is removed.
> - **`cas/expanded` and `cas/manifests` have no writer at all** — `tarInspect.ts` never
>   materializes an archive. So `cas/blobs` is the whole growth surface, and the sweep's scope is
>   measured rather than assumed.
> - **The sweep cannot live in `packages/adoption-index`.** A retention decision needs a clock, and
>   INV-R6 / control #11 (`source-mirror.test.ts:849`) forbids argless `new Date()` anywhere under
>   that package's `src/` *and* pins the set of files permitted to name `new Date(` to one entry.
>   The invariant is right; the placement was wrong. The sweep lives in `trust-index` beside the
>   worker's other two steps, and imports `casBlobsRoot` from `adoption-index` so INV-R7 still has
>   exactly one owner of the layout.
>
> `pruneOldBlobs` **throws** on an absent `cas/blobs` rather than reporting a clean zero: a
> misconfigured root must fail the unit, not log `deleted 0` nightly forever. A failed delete sets a
> non-zero exit so a partial sweep surfaces as a systemd failure.
>
> **What §8.4 asked for and this does NOT deliver: the daily backup.** §8.4 requires the retention
> policy to ship "**together with** the daily backup", and only the retention half is here. The
> pairing is not decorative — retention deletes bytes, and deleting without a restore path is
> strictly worse than not deleting. Two things make the gap smaller than it reads, and neither
> closes it:
>
> - Nothing under `.var/` is a source of truth. The identity plane, the evidence, and the registry
>   snapshot are all **committed** (`packages/trust-index/snapshots/*.json`), and §5 requires the
>   bake to read those committed bytes and never the store. A total loss of `.var/` costs one
>   re-fetch, not a fact.
> - The one thing a re-fetch cannot reconstruct is `firstSeenAt` history
>   (`projectAdoptionIndex.ts:26-27`) — which is exactly why the committed projection carries
>   `lastSeenAt` instead, so nothing served depends on it.
>
> So the honest scope is: **`firstSeenAt` history is unbacked, and the sweep does not touch it.**
> `first_seen_at` is a column on `source_records`, `canonical_subjects`, and `artifact_versions`
> (`migrations/001-canonical-adoption-graph.sql`) — all inside the SQLite file, none of it in the CAS,
> so a 90-day blob sweep cannot reach it either way. A backup needs a destination, a retention window
> of its own, and a credential — three decisions with no measured basis in this repo yet. Adding an
> `ExecStart=… rsync …` line to satisfy the letter of §8.4 would be inventing all three silently.
> It is named here as an open R-9 item rather than closed by prose.

### §9 The twelve invariants, as they bind Workstream R

Restated so that a compiler PR can be checked against one list. None of these are new;
what is new is that each now has a named consequence for a stateful producer.

| # | Invariant | How it binds the compiler |
| --- | --- | --- |
| INV-01 | One verdict engine | The graph resolves identity only (§4). No adapter, compiler, renderer, contract, or LLM issues or modifies a verdict. |
| INV-02 | One live-config writer | The compiler writes **zero** host config (§3). `applyPlan` stays the only writer; `applyUrlHandler` remains the narrowly-scoped OS-registration writer admitted by ADR 0057. |
| INV-03 | One canonical decision record | All projections consume one immutable record. The compiler produces it; it does not fork a compiler-specific variant for its own convenience. |
| INV-04 | No target execution | §2, as an enumerated list, enforced structurally by dependency absence. |
| INV-05 | UNKNOWN never becomes SAFE | A fetch failure, a resolve failure, a timeout, or a rate limit records the failure. It never yields the more optimistic reading, including for identity (§4). |
| INV-06 | Exact artifact before actionable setup | No `PREPARE_AVAILABLE` without an exact identity and artifact digest accepted by the current Trust Gateway. The compiler may not relax this to keep a cohort full. |
| INV-07 | Publisher content is untrusted | Registry descriptions, README text, categories, and keywords are ingested as *data* and may not enter verdict, authority, installability, agent protocol policy, command argv, or approval. |
| INV-08 | Presentation cannot alter behavior | Compiler output feeds the presentation plane bounded by ADR 0058; it does not gain a second path into decision digests. |
| INV-09 | No hidden persistence | `.var/calllint-adoption-index/` only (§3). One-time setup never authorizes a persistent component. |
| INV-10 | Every source record gets a terminal state | The seven terminal states are destinations, not error strings. `IDENTITY_CONFLICT` and `PROCESSING_FAILED` are successes of the state machine. Silently dropping a hard record is a defect. |
| INV-11 | Static serving | §5. No request path reaches the database. |
| INV-12 | LLM is non-authoritative and optional | Every compiler gate passes with `llm.enabled = false`. An LLM may summarize; it never decides and never writes a field a decision reads. |

### §10 What Workstream R reuses rather than rebuilds

Stated as a decision because the plan's own rule is 不允许重复建设, and a new package
is where duplication is easiest to introduce by accident:

- **The resolution state machine already exists** at
  `packages/evidence/src/model/stateMachine.ts` (`canTransition`, `isTerminal`,
  `stateFromResolverStatus`). The compiler **generalizes** it to cover INV-10's seven
  terminal states. It does not write a second state machine.
- **Evidence resolution already exists** behind ADR 0034's provider interface —
  `packages/resolver/src/evidence/resolveSubject.ts` and its `P1_RESOLVERS` registry.
  The compiler drives that engine on a schedule. The existing
  `packages/trust-index/src/resolveEvidence.ts` is a *script* wrapper around this, not
  the engine.
- **Static inspection** is `@calllint/static-analyzer`. **Hashing and reproducibility**
  are `@calllint/fingerprint`. **Verdicts** are `@calllint/risk-engine`. The compiler
  imports all four and reimplements none.

### §11 Registry expansion is gated, and this ADR does not lift the gate

The 25→100→500→all expansion is confirmed at PR R-9 and at Gate S0, per the execution
plan's O-5. **This ADR authorizes no expansion step.** Acceptance authorizes R-1 to
begin building the graph and compiler at the current cohort size. Each expansion step
stays its own gated PR with its own artifact.

## Consequences

**Accepted cost.** A native dependency (`better-sqlite3`) means the compiler package
needs a build toolchain wherever no prebuilt binary is available. Bounded by the
single-Linux-host production target (§7), by the compiler's exclusion from the
published CLI, and — after the §7 amendment — by pinning a version that ships an
ABI-115 prebuild for all three CI platforms, so the toolchain is not exercised on any
gate leg.

**A cost the original decision missed:** `"private": true` keeps this package out of
every *published* artifact, but it does **not** keep the driver out of CI's *install*
graph. The workspace globs `packages/*` (`pnpm-workspace.yaml`) and every gate leg
runs `pnpm install --frozen-lockfile`, so the dependency resolves on all three
operating systems regardless of privacy. Privacy is a publishing boundary, not an
installation one — which is why the prebuild coverage above had to be verified per
platform rather than only for the Linux production target.

**Accepted cost.** Refusing to execute subjects means some evidence is permanently
unobtainable — runtime behavior, actual network destinations, real credential
requirements. The compiler will therefore produce `UNKNOWN` for questions a sandbox
could answer. That is the correct trade under INV-04 and INV-05: an unobtainable
answer is recorded as unobtainable, and Deep Scan remains out of scope.

**Accepted cost.** A rolling compiler that is upstream of the bake (§5) means served
freshness is bounded by the compile schedule, not by request time. A page can be
stale. It cannot be wrong about which config produced it, and a compiler outage
cannot take the site down.

**Rejected: merging the compiler into `packages/trust-index/`.** §6. It would put a
database dependency in the package CI builds on every PR and blur the
producer/projection line that makes served-byte questions answerable.

**Rejected: `node:sqlite`.** §7. Unavailable on the Node 20 floor the repo declares
and gates against.

**Rejected: a second verdict field on the graph.** §4. Identity and safety are
different questions, computed by different components, and the graph answers only the
first.

**Rejected: sandboxed execution to enrich evidence.** INV-04 and Product Principle 7
(Deep Scan requires a sandbox and is out of scope). Not a v1 compromise to revisit
inside Workstream R.

**Unchanged.** No verdict moves. No served byte changes at acceptance. No production
code changes at acceptance — PR R-0 writes this ADR and six measurement artifacts and
nothing else. The inherited kernel invariant holds: no LLM in the critical decision
path, and all gates pass with `llm.enabled=false`.

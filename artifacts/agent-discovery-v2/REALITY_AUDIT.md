# Agent Discovery v2 — Reality Audit

**Mandated by** `docs/new19.md` §3, which requires this file to exist *before* implementation and
forbids writing a new architecture document "without comparing against existing code."

**Measured at** commit `cd0837c`, branch `fix/explain-command-runnable`, 2026-08-22, Node v20.20.2.
Working tree clean (`git status --porcelain` → 0 lines) when every measurement below was taken.

Every row in this document is the output of a command. Where a conclusion is inferred rather than
measured, it says so. The point of §3 is that the audit precedes the design, so nothing here is
written to justify a decision already made.

---

## 0. Summary — what is already closed, and what is not

new19 reads as a request for a new subsystem. Measured against the tree, it is mostly a request for
**two coverage records, three mechanisms, and a test suite that does not exist yet**. The canonical
layer §4 asks for is already present as `apps/web/data/distribution-surfaces.json` (the SSOT).

| new19 requirement | State | Evidence |
| --- | --- | --- |
| §4 ONE canonical layer | **ALREADY SATISFIED** | SSOT with 15 hosts + 4 containers, `$schema`-governed, `additionalProperties: false` |
| §5 `surfaces[]` schema | **PARTIAL** — 6 of 8 fields present under other names; `type` and `status` absent | M2/M3 |
| §6 surface types | **STRUCTURALLY PRESENT, UNNAMED** — 4 containers distinguish the types; no `type` field | M1/M3 |
| §7 support model | **ALREADY SATISFIED** — enum is exactly the four classes | M5 |
| §8 harness capability model | **ALREADY SATISFIED** — all 6 §8 capabilities are in the 12-value enum | M4 |
| §9 Tier 0 coverage | **ALREADY SATISFIED** — 5 of 5 present | M11 |
| §9 Tier 1/2 coverage | **GAP** — missing `continue`, `roo-code`, `deepseek-harness` | M11 |
| §10 Codex first-class | **ALREADY SATISFIED** — `agent-harness` container, no codex-specific engine | M12 |
| §11 DeepSeek not special | **ALREADY SATISFIED (by absence)** — 0 deepseek-specific detectors | M13 |
| §12 WorkBuddy/CodeBuddy separate | **ALREADY SATISFIED** — 2 distinct hosts, different classes | M11 |
| §15 generator `--check` mode | **MISSING** | M8 |
| §16 template-driven pages | **ALREADY SATISFIED** — 1 template → 16 page dirs | M7/M14 |
| §17 Registry Tier-0 | **ALREADY SATISFIED** — `officialMcpRegistry`, tierLevel 0 | M15 |
| §19 watcher | **PARTIAL** — exists; schema-change and official-source-change unmeasured | M10 |
| §22 tests | **MISSING** — 0 of 9 propositions tested | M16 |
| §23 NC-01..NC-08 | **MISSING** — 0 of 8 exist | M16 |
| §25 FINAL_REPORT | **MISSING** | M17 |

**Net: 10 already satisfied, 3 partial, 4 missing.** new19 §0's instruction — "If existing
implementation already satisfies a requirement: DO NOT rebuild it. Extend minimally." — therefore
governs most of this work.

---

## 1. Measurements

### M1 — SSOT containers

```
$ node -e "const s=require('./apps/web/data/distribution-surfaces.json'); ..."
topKeys: $schema, version, generatedAt, officialMcpRegistry, hosts,
         modelIntentLandingPages, candidateFeeds, maintainedBy, repository, licenseNote
hosts: 15 | modelIntentLandingPages: 1 | candidateFeeds: 1 | officialMcpRegistry: 1
```

Four containers hold four different kinds of subject. This matters for §6: the type distinction
new19 asks for is already **structural**, it just has no name as a field.

### M2 — host field union (all 15 hosts)

```
authoritySurfaces, canonicalPath, configEvidence, coverageBoundary, displayName,
distributionPrimitives, id, legacyPaths, officialSources, priority, supportClass,
truthfulCommands, vendor
```

### M3 — §5's field names, measured directly

```
type             0/15
capabilities     0/15
status           0/15
calllintSupport  0/15
discovery        0/15
distribution     0/15
canonicalUrl     0/15
```

Zero of §5's literal names exist. But §5 asks for *information*, not spellings. Mapping:

| §5 field | Existing carrier | Equivalent? |
| --- | --- | --- |
| `id` | `id` | identical |
| `vendor` | `vendor` | identical |
| `officialSources` | `officialSources` | identical |
| `capabilities` | `authoritySurfaces` | **yes** — see M4 |
| `calllintSupport` | `supportClass` | **yes** — see M5 |
| `distribution` | `distributionPrimitives[]` | yes, richer (per-primitive `state`) |
| `canonicalUrl` | `canonicalPath` | yes, relative; absolute URL is produced in projection |
| `discovery` | `configEvidence` + `truthfulCommands` | yes, split across two fields |
| `type` | *(container membership only)* | **NO — genuine gap** |
| `status` | *(per-primitive `state` only, no host-level roll-up)* | **NO — genuine gap** |

### M4 — §8's capability vocabulary is a subset of the existing enum

```
enum(12): api, cli, code-generation, exec, extensions, filesystem, mcp, plugins,
          shell, skills, tools, vscode-extensions
§8 named: mcp, tools, filesystem, shell, extensions, plugins
§8 covered: mcp, tools, filesystem, shell, extensions, plugins
§8 MISSING: none
```

All six capabilities §8 names are already expressible. The enum is closed on purpose — the schema
documents that a free-form string "would let a new host introduce an authority the risk model has
never seen, and silently."

### M5 — §7's support model is the existing enum, exactly

```
schema supportClass enum:    NATIVE, CONFIG_SCAN, DISCOVERY_ONLY, DEFERRED
schema primitive.state enum: AVAILABLE, AUDIT_REQUIRED, READY_NOT_SUBMITTED, PENDING_UPSTREAM
host.required(12): id, displayName, vendor, priority, authoritySurfaces, configEvidence,
                   supportClass, truthfulCommands, canonicalPath, officialSources,
                   distributionPrimitives, coverageBoundary
host.additionalProperties: false
```

§7's four classes and the schema's enum are the same four tokens in the same order. This is the
single strongest piece of evidence that new19 describes the existing architecture rather than a
replacement for it.

### M6 — NC-08 precondition: discovery metadata is not in the security engine

```
$ grep -rn "distribution-surfaces|agent-surfaces|agent-discovery-index" packages/ --include=*.ts
(no matches)
$ find packages -path '*/src/*' -name '*.ts' -not -path '*/node_modules/*' | wc -l
333
risk-engine EXISTS · policy EXISTS · static-analyzer EXISTS · core EXISTS
types EXISTS · resolver EXISTS · fingerprint EXISTS
```

**333 files scanned, 0 references.** The denominator is recorded because a guard that scans an
empty set and prints a checkmark is this repository's dominant fault class. NC-01/02/03/07/08 all
reduce to keeping this number at 0.

### M7 — NC-06 precondition: pages vs hosts, in both directions

```
SSOT hosts (15): claude-code,claude-desktop,cline,codebuddy,codex,copilot-cli,cursor,
                 gemini-cli,kiro,openclaw,opencode,qwen-code,vscode,windsurf,workbuddy
page dirs  (16): ...same 15... + deepseek
pages with NO SSOT host: deepseek
hosts with NO page: none
```

**This falsifies the obvious form of NC-06.** A naive "every page directory has a `hosts[]` entry"
assertion would go **red on a healthy tree**, because `/harnesses/deepseek/` is backed by
`modelIntentLandingPages`, not by `hosts`. The correct invariant is that every page directory is
endorsed by *some* SSOT container. Recorded here because the wrong version of this test would have
been written without the measurement.

### M8 — the generator has 11 write targets and no `--check`

```
$ grep -n "writeFileSync" scripts/generate-distribution-surfaces.mjs
line 10  = the import
lines 219, 374, 477, 532, 584, 667, 777, 934, 1028, 1205, 1300  = 11 writes
$ grep -n "process.argv|--check|process.exit" scripts/generate-distribution-surfaces.mjs
(no matches)
```

No argv handling at all: the script has exactly one mode. §15's `--check` does not exist.

### M9 — the 11 writes, by destination

| # | line | destination |
| --- | --- | --- |
| 1 | 219 | `apps/web/public/harnesses/<id>/index.html` (per host) |
| 2 | 374 | `apps/web/public/harnesses/index.html` |
| 3 | 477 | `scripts/distribution-sources.json` |
| 4 | 532 | `apps/web/public/agent-surfaces.json` |
| 5 | 584 | `apps/web/public/harnesses/sitemap.xml` |
| 6 | 667 | `apps/web/public/_redirects` |
| 7 | 777 | `apps/web/public/llms.txt` |
| 8 | 934 | `apps/web/public/llms-full.txt` |
| 9 | 1028 | `apps/web/public/agent-instructions.md` |
| 10 | 1205 | `artifacts/authority-distribution-closure/FINAL_PLATFORM_MATRIX.md` |
| 11 | 1300 | `artifacts/authority-distribution-closure/EXTERNAL_DISTRIBUTION_MATRIX.md` |

### M10 — the watcher's existing drift gate covers all 11

`.github/workflows/distribution-watch.yml` regenerates, then `git diff --exit-code` over 9 paths.
Nine paths cover eleven writes because `apps/web/public/harnesses/` subsumes writes 1, 2 and 5.

Two properties of this gate, both load-bearing for the plan:

1. **`git diff` cannot observe an untracked file.** A newly generated 12th output would be
   invisible to it until `git add`. This exact defect has already occurred once on this workstream.
2. `.well-known/calllint.json` is **deliberately excluded** — it is owned by the Safe-install bake
   (`packages/trust-index/src/renderDiscoveryManifest.ts`, emitting `calllint.discovery.v1`). The
   workflow comment says "Do not add it back." §15 lists that path as a generated surface; **this
   audit records that new19 §15 must not be followed literally there**, because two writers on one
   path already silently dropped `resources[]` once.

### M11 — §9 coverage, measured against the 14 named surfaces

```
T0 present: claude-code,codex,cursor,copilot-cli,cline   | MISSING: none
T1 present: gemini-cli,opencode,workbuddy,codebuddy      | MISSING: continue,roo-code
T2 present: qwen-code,kiro                               | MISSING: deepseek
```

Full host table as measured:

```
P0  claude-code     NATIVE          mcp+filesystem+shell+plugins
P0  claude-desktop  NATIVE          mcp+filesystem
P0  cursor          NATIVE          mcp+filesystem+shell
P0  workbuddy       NATIVE          mcp+extensions
P1  qwen-code       NATIVE          mcp+tools
P1  vscode          NATIVE          extensions+mcp
P1  windsurf        NATIVE          mcp+filesystem
P2  cline           DISCOVERY_ONLY  vscode-extensions+tools+mcp
P2  codebuddy       DEFERRED        mcp+extensions
P2  codex           DISCOVERY_ONLY  code-generation+api+mcp
P2  copilot-cli     DISCOVERY_ONLY  shell+cli+mcp
P2  gemini-cli      DEFERRED        mcp+tools
P2  kiro            DEFERRED        mcp+filesystem+shell
P3  openclaw        NATIVE          mcp+skills+exec
P3  opencode        CONFIG_SCAN     mcp+tools
```

WorkBuddy (`NATIVE`) and CodeBuddy (`DEFERRED`) are two records with different support classes —
§12's "treat separately, do not merge" is already honoured, and the differing classes are evidence
that they were assessed separately rather than copied.

### M12 — §10 Codex, as recorded today

```json
{"id":"codex","displayName":"OpenAI Codex","vendor":"OpenAI","priority":"P2",
 "authoritySurfaces":["code-generation","api","mcp"],
 "configEvidence":["Config mechanism requires verification"],
 "supportClass":"DISCOVERY_ONLY","truthfulCommands":[],
 "canonicalPath":"/harnesses/codex","legacyPaths":["/harnesses/deepseek/codex"],
 "officialSources":["https://developers.openai.com/codex/extend/mcp"],
 "distributionPrimitives":[
   {"kind":"mcp-stdio","upstream":"officialMcpRegistry","state":"AUDIT_REQUIRED",
    "auditNote":"Codex supports local STDIO MCP, Registry auto-discovery not confirmed"},
   {"kind":"openai-plugin","state":"AUDIT_REQUIRED",
    "blocker":"Do not create remote MCP just for public listing eligibility"}],
 "coverageBoundary":"CallLint does not yet auto-discover Codex configuration."}
```

§10 forbids `codex-security-engine` and `codex-plugin-system`. Neither exists (M6 shows no
platform-specific reader anywhere in `packages/`). `truthfulCommands: []` with
`supportClass: DISCOVERY_ONLY` is what §9's "Do not claim implementation where none exists" asks
for, and it is already the recorded state.

### M13 — §11 DeepSeek, and the evidence that settles its representation

Before this audit, DeepSeek existed only as a model-intent landing page:

```json
{"id":"deepseek-hub","displayName":"DeepSeek with Agent Hosts","path":"/harnesses/deepseek/",
 "purpose":"Model-intent landing page that links to canonical host pages",
 "note":"Preserved for DeepSeek users; not canonical truth root"}
```

§9/§14 name "DeepSeek Harness" as a required Tier-2 / Cohort-10 surface. Whether such a product
exists is a claim about the world, so it was measured rather than assumed:

```
$ curl https://api.github.com/repos/deepseek-ai/deepseek-harness
full_name:        deepseek-ai/deepseek-harness
description:      "DeepSeek Harness: Everything is a Plugin."
homepage:         https://deepseek.com/harness
language:         TypeScript      license: MIT      archived: false
stargazers_count: 182101          pushed_at: 2026-08-21T12:35:08Z
topics:           ai-agents, cordis, dsh, dsh-plugin
default_branch:   master
```

It exists and is first-party. **The root README mentions MCP zero times** — a single absence that
would have supported the wrong conclusion. Measuring the package list instead:

```
$ curl .../contents/packages   → 55 entries, including: mcp
$ curl .../contents/packages/mcp → mcp-client/
$ curl .../packages/mcp/README.md
  "Packages bridging the harness to the MCP ecosystem."
  mcp-client/ — MCP client bridge that registers external server tools on ctx.tools
```

Config shape, from `packages/mcp/mcp-client/README.md` (9875 bytes) — one plugin instance per MCP
server in `cordis.yml`:

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio          # "stdio" | "streamable-http"
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env: { GITHUB_TOKEN: ... }
```

Required/optional fields: `transport`, `serverName`, `command`, `args`, `env`, `cwd`, `url`,
`headers`, `toolCallTimeoutMs`, `failOnStartupError`, `reconnect.*`.

**Consequence for the support class.** The `stdio` form (`command` + `args` + `env` + `cwd`) maps
onto the existing `NormalizedMcpServer` with no new concepts, so `CONFIG_SCAN` is *reachable*. But
it is not *reached*: M18 shows no `deepseek-harness` member of `AgentType` and no extractor. §7 says
"Never upgrade state without evidence," so the record this plan writes is **`DISCOVERY_ONLY`**, and
the path to `CONFIG_SCAN` is recorded as a boundary, not claimed as support.

### M14 — §16's five questions vs the existing template

`scripts/templates/host-page.hbs` renders 6 sections:

```
Usage · Configuration Paths · Authority Surfaces · Distribution ·
Official Sources · Coverage Boundary
```

| §16 question | Covered by | Present? |
| --- | --- | --- |
| 1. What authority can this agent grant? | Authority Surfaces | yes |
| 2. What can CallLint inspect? | Configuration Paths | yes |
| 3. What command works? | Usage | yes |
| 4. What is unsupported? | Coverage Boundary | yes |
| 5. What is current status? | *(nothing)* | **no — gap** |

Support class is rendered nowhere as a status statement; §20's rule that the internal ontology token
must never appear in visible page text means the fix must render the *public label*, not the token.

### M15 — §17 Registry identity

```
officialMcpRegistry: io.github.calllint/calllint · package calllint-mcp
                     state LIVE · version 0.2.0 · transport stdio · tierLevel 0
```

### M16 — §22/§23 test inventory

```
$ ls tests/            → e2e/ facts/ invariants/ public-copy.test.ts readback/ schema/
$ ls tests/invariants/ | wc -l  → 20
$ ls tests/invariants/ | grep -i "distrib|surface|harness|registry|cohort|discover"
cohort-departure-class.invariants.test.ts
registry-cohort-retention.invariants.test.ts
```

Neither tests any §22 proposition. **0 of 9 §22 propositions and 0 of 8 §23 negative controls
exist.** This is the largest body of missing work in new19, and the only part that is genuinely new
rather than an extension.

### M17 — §24 gates and §12 target paths

All eight §24 gates exist. `check:harness-distribution` and `check:agent-surface` are already inside
`ci:local` (25 steps at `cd0837c`); `gen:distribution` is deliberately outside it.

§12's named new paths, measured:

```
distribution/agent-discovery-index.json    ABSENT
scripts/discovery-index-build              ABSENT
deploy/generated-agent-surfaces            ABSENT
docs/AGENT_DISCOVERY.md                    ABSENT
tests/discovery-index-schema               ABSENT
artifacts/agent-discovery-v2               ABSENT (created by this audit)
apps/web/public/agents                     ABSENT
```

### M18 — `AgentType`, the gate that decides what may be called NATIVE

`packages/discovery/src/types.ts:7` — 14 values:

```
cursor claude-code claude-desktop workbuddy vscode windsurf qwen-code
codex amazon-q gemini-cli openclaw opencode antigravity amp
```

No `deepseek-harness`, no `continue`, no `roo-code`. `scripts/check-harness-distribution.mjs`
HD-01 fails any host marked `NATIVE` whose id is absent from this union or whose extractor is not
bootstrapped; HD-02 fails any `DISCOVERY_ONLY` host that advertises an `--agent` command. **The
three new records are therefore constrained by an existing gate to `DISCOVERY_ONLY`/`DEFERRED`** —
the honesty §9 demands is mechanically enforced, not merely intended.

---

## 2. Decisions that follow from the measurements

Each decision cites the measurement that forces it. §0 requires extending rather than rebuilding, so
the burden of proof is on any decision that creates something new.

### D1 — `surfaces[]` is a generated projection of the SSOT, not a new hand-maintained file

Forced by M1–M5: the SSOT already carries 6 of §5's 8 fields, the identical §7 enum, and a superset
of §8's capability vocabulary. §4 says "If an existing equivalent exists: extend it. Do not
duplicate," and §26's stop condition requires "no duplicate distribution truth exists." A
second hand-edited index would violate both.

### D2 — `type` is **derived from container membership**, never hand-written

Forced by M1 + M3. The four containers already partition the subjects; a hand-written `type` field
could contradict the container it sits in, and §6 explicitly warns "Do not treat registry as an
agent." A derived field cannot be mislabelled:

```
hosts[]                  → agent-harness
officialMcpRegistry      → mcp-registry
modelIntentLandingPages  → documentation
candidateFeeds           → search-surface
```

`marketplace` and `mirror` stay in the §6 vocabulary with no current members. Recording an empty
type is honest; inventing a member to fill it is not.

### D3 — `authoritySurfaces` is **not** renamed to `capabilities`

Forced by M4 + M8/M9: the field is read by 11 projections, 2 gates in `ci:local`, and a published
schema carrying `$id` and `additionalProperties: false`. Renaming is a breaking change to a public
surface that buys zero information. The equivalence is documented in the schema description
instead — §0's "extend minimally."

### D4 — `/agents/<id>` becomes a 301 to `/harnesses/<id>`; no second page set

Forced by M7 + M14: a template-driven projection already exists and already answers 4 of §16's 5
questions for 16 directories. Building `/agents/*` as real pages would create two page sets for one
subject — the §26 violation D1 avoids in the data layer. The genuine gap is question 5, fixed by
adding one status section to the existing template.

> **Correction (2026-08-22).** As written above, the first clause described an outcome that did not
> exist. At `abfb44a` no `/agents/<id>` redirect was present in any form — not in `_redirects`, not
> in `_routes.json`, not in `functions/`, and not in the generator. The decision was recorded as
> though implemented; only the "no second page set" half was ever true, and it was true by default
> rather than by construction.
>
> This is now implemented. `generateRedirects()` emits one 301 per host plus `/agents` →
> `/harnesses/`, as a block kept deliberately separate from the frozen per-host `legacyPaths` — an
> alias invented for documentation must not be conflated with a URL that really was served.
> `check-agent-surface-contract.mjs` asserts totality over the host cohort (not over the rule count,
> which legacy rules and `.html` spellings would satisfy on their own), and the invariant suite
> covers the same property plus the no-collision requirement.
>
> Recorded rather than silently corrected, because the failure mode is the one this document exists
> to catch: a decision log is itself an unverified claim unless a gate reads it.

### D5 — `--check` compares **bytes in memory against disk**, not `git diff`

Forced by M8 + M10: `git diff` cannot see an untracked file, which has already produced one vacuous
green on this workstream. A `--check` that renders all 11 outputs and byte-compares is strictly
stronger, and independent of git state. Both gates are kept: they fail for different reasons.

> **Amended (2026-08-22).** Byte-comparison being independent of git state is exactly why it could
> not, on its own, close M10: a file can match its projection perfectly and still be absent from the
> index, which is the shape that produced the original vacuous green. `--check` now also asserts
> index membership for every `emit()` target, over the same denominator its anti-vacuity floor pins,
> and degrades to an explicit "unverified" line outside a work tree rather than failing where its
> subject is absent. The byte comparison remains git-independent; the run as a whole now reports on
> both properties instead of leaving the second to a gate that structurally cannot see it.

### D6 — the discovery index is published under `apps/web/public/`, not `distribution/`

**This is a deliberate, flagged deviation from §4's example path** (`distribution/agent-discovery-index.json`).
§1 states the purpose: "Agent ecosystems should naturally expose CallLint." A file no server serves
cannot be fetched by an agent, so the literal path defeats the stated purpose of the section that
names it. The file is emitted as generator output #12 at
`apps/web/public/agent-discovery-index.json`, alongside the existing `agent-surfaces.json`.
Reversible in one line if the literal path is preferred.

### D7 — `.well-known/calllint.json` is **excluded** from §15's generated-surface list

Forced by M10. §15 lists it; the tree already documents why it must not be written here (two
writers on one path silently dropped `resources[]`). Following §15 literally would re-introduce a
known defect. Its drift is covered by the bake's own reproducibility gate.

### D8 — DeepSeek Harness is added as a `hosts[]` record with `supportClass: DISCOVERY_ONLY`

Forced by M13 + M18. The product exists (first-party, `packages/mcp/mcp-client`, deterministic
`cordis.yml` config), so recording its absence would be false. CallLint has no extractor for it, so
`CONFIG_SCAN` would be false too. `DISCOVERY_ONLY` is the only class both true and mechanically
permitted by HD-01/HD-02. The existing `deepseek-hub` model-intent page is **kept** — it is a
different subject (a model, not a harness), and M7 shows its page directory depends on it.

### D9 — NC-06 asserts *container endorsement*, not `hosts[]` membership

Forced by M7. The naive form reds on a healthy tree. Every page directory must be endorsed by some
SSOT container; the reverse direction (every host has a page) is already asserted by the existing
sitemap gate.

### D10 — NC-01/02/03/07/08 collapse into one import-graph invariant

Forced by M6: they are five phrasings of "discovery metadata must not enter the security engine."
One assertion — no `packages/**` source reads distribution truth — covers all five, and its
negative control is adding such an import. It carries a mandatory anti-vacuity premise asserting the
scanned file set is non-empty (M6's denominator is 333), because a mistyped glob would otherwise
scan nothing and print a checkmark.

---

## 3. Boundaries this work does not cross

From §2 and §12, verified absent from the plan's change set:

- verdict engine, policy engine, risk engine, static analyzer, corpus, receipt, Trust Gateway,
  Safe Install semantics — untouched. M6 is the standing measurement that keeps this checkable.
- no LLM decision making, no model-specific security logic, no marketplace database, no
  platform-specific security engines, no `codex-security-engine`, no deepseek-specific detector.
- no default telemetry. §20/§21's Usage Measurement stays separate from the Discovery Index.
- `UNKNOWN != SAFE` is a property of the verdict engine, which this work does not reach.

Operator actions: this work adds **none**. `new18.md` §106 P's `OPERATOR_ACTION_REQUIRED = 1` is
unchanged by anything here, and that is asserted in the final report rather than assumed.

---

## 4. Relationship to new18

`artifacts/authority-distribution-closure/FINAL_REPORT.md` is the sealed record of its own scope.
This workstream **references it and does not rewrite it**. Two consequences:

- new18 §107's SUCCESS STATES vocabulary is the only place new state names are minted. This work
  adds one name and leaves the other 15 alone.
- `ci:local` grows from 25 to 26 steps when `check:distribution-drift` is added. new18's report
  records "25 steps" as a measurement at `cd0837c`. The two are reconciled by **dating both**, not
  by overwriting one: that report's number stays true of its commit, and this workstream's report
  records the new value with its own commit. Two dated sentences, neither falsifying the other.

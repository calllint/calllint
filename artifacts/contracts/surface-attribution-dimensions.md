# Surface Attribution Dimensions

**Replaces**: "scan/auto/changed counting" (vague, no observable contract)

**What this is**: The enum of `discoverySurface` values that tag where a config was
discovered, and the mapping from those values to the attribution buckets that feed
operator-facing reports.

## Why this exists

new19 §21 added `discoverySurface` as a separate dimension from `source`. `source`
answers "what emitted this" (cli/ci/server/install) and gates privacy tiers;
`discoverySurface` answers "where did the user find CallLint" and feeds distribution
analytics. The two dimensions are orthogonal: a CLI scan (source=cli) may have been
reached via the MCP Registry (discoverySurface=mcp-registry) or via an agent's
command palette (discoverySurface=agent-harness).

This document defines the canonical six-member vocabulary and what each value means.

## The six types

Defined in `packages/telemetry-contract/src/events.ts` as `DISCOVERY_SURFACES`:

| Value              | Meaning                                                                 |
|--------------------|-------------------------------------------------------------------------|
| `agent-harness`    | Found via a command in an agent harness (e.g. Claude Code `/calllint`) |
| `mcp-registry`     | Found via the MCP Registry listing                                      |
| `marketplace`      | Found via a marketplace (VS Code, Cursor, etc.)                         |
| `documentation`    | Found via docs.calllint.com or a direct docs link                       |
| `search-surface`   | Found via web search or a link aggregator                               |
| `mirror`           | Found via a mirror (npm Registry, crates.io, PyPI, etc.)                |

## Why these are surface **types**, not surface **ids**

The 23 published distribution surfaces (see `artifacts/distribution/distribution-surfaces.json`)
each have a unique id like `io.github.calllint/calllint-mcp-server` or `cursor-mcp`.
Those ids are **NOT** sent as `discoverySurface` values, because:

1. **Safety**: Ids contain `/`, which the ingress's `SAFE_TOKEN_PATTERN` excludes to
   prevent filesystem paths from being stored as dimensions (new18 §20). A vocabulary
   whose members fail server validation would be silently dropped.

2. **Cardinality**: 23 ids × existing key dimensions = daily rows that approach
   one-install granularity. 6 types keep a row a genuine aggregate (new18 §20).

3. **Durability**: New surfaces (e.g. a 24th) would mint new ids, but the server's
   enum check would reject off-vocabulary values. Types absorb new surfaces without
   schema changes.

## How to map a surface id to a type

The CLI assigns `discoverySurface` based on the install source (see `apps/cli/src/state.ts`
and `apps/cli/src/telemetry.ts`):

Example logic:
- Installed from MCP Registry listing → `mcp-registry`
- Installed via agent harness built-in command → `agent-harness`
- Installed from VS Code marketplace → `marketplace`
- Installed from npm → `mirror`
- Installed from documentation link → `documentation`
- Fallback → `search-surface` (organic discovery)

The type is inferred from the install context, not looked up from a mapper file.

## Contract assertions

- **Equality**: The six types here MUST equal the published surface-type vocabulary.
  Asserted in `tests/invariants/telemetry-surface-vocabulary.invariants.test.ts`.
  
- **Enum-checked**: `discoverySurface` is enum-checked at ingestion, NOT token-checked.
  Open-ended tokens (like `hostFamily`) accept any safe pattern; closed enums prevent
  row-count amplification (see `apps/usage-worker/src/validate.ts` line 184-206).

- **Never empty**: An empty `discoverySurface` means "not stated" (client didn't know),
  stored as `""`. It does NOT mean "zero observations" — that's a claim the data cannot
  support (new18 §25).

## What this enables

Operator reports can now answer "which distribution surface drove the most adoption"
without storing high-cardinality ids or guessing from opaque counters.

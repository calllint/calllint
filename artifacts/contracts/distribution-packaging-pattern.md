# Distribution Packaging Pattern

**Replaces**: "primitive" (overloaded, ambiguous — meant 7 different things across 9 usages)

**What this is**: The 5-part definition of how CallLint reaches an agent harness,
and the contract for what each distribution artifact must deliver.

---

## The 5-part definition

A **distribution packaging pattern** is a complete, self-contained specification for
delivering CallLint to one agent harness. It consists of exactly five artifacts:

### 1. **Scan command integration**
   The install snippet, command registration, or activation hook that makes CallLint
   callable from the agent. Examples:
   - MCP server entry in `mcp.json` (Cursor, VS Code, Claude Code)
   - Extension marketplace listing (VS Code marketplace, Cursor directory)
   - Built-in slash command (`/calllint` in Claude Code, Kiro)

### 2. **First-run instructions**
   What the user sees after install, before their first scan. Must answer:
   - "How do I call this?" (command syntax, UI path)
   - "What will happen when I do?" (preview of CallLint's output/verdict)
   - "Where is my config?" (file path for the agent's MCP config)
   
   Examples: MCP Registry "Usage" tab, marketplace README, agent onboarding toast.

### 3. **Version synchronization**
   How the integration stays aligned with CallLint CLI releases. One of:
   - **Static reference** (MCP Registry JSON points to npm `latest`)
   - **Lockfile** (extension bundles a pinned CLI version)
   - **Package manager** (agent runs `npx calllint@latest`, always fresh)

### 4. **Update notification**
   How the user learns a new CallLint version exists (if applicable). Examples:
   - Extension auto-update (marketplace-distributed extensions)
   - MCP Registry reflects npm `latest` (static reference pattern)
   - Agent polls npm `/calllint/latest` and shows upgrade prompt
   - None (always-`latest` pattern has no "update", only "run")

### 5. **Surface-to-discovery mapping**
   The `discoverySurface` attribution value that telemetry assigns when a scan originates
   from this integration. Maps the surface id (e.g. `cursor-mcp`, `vscode-marketplace/calllint`)
   to one of six types: `agent-harness`, `mcp-registry`, `marketplace`, `documentation`,
   `search-surface`, `mirror`.
   
   See [surface-attribution-dimensions.md](./surface-attribution-dimensions.md) for the
   canonical mapping rules.

---

## What it is NOT

A distribution packaging pattern is NOT:
- A marketing surface (docs page, blog post, tweet)
- A discovery breadcrumb (link in a README, SEO landing page)
- A partial integration (browser bookmark, shell alias)
- An internal API client (partner API call, trust verifier ingress)

Those are valuable distribution activities, but they do not deliver the five parts.
A pattern is the **complete path** from "user has never heard of CallLint" to "user
can run a scan."

---

## Why 5 parts, not fewer

Each part addresses a distinct failure mode measured in real integrations:

1. Without **scan command**, CallLint is installed but uncallable (orphaned npm package).
2. Without **first-run instructions**, users don't know the command exists (GitHub star, no usage).
3. Without **version sync**, the integration references a CLI version that no longer exists or has CVEs.
4. Without **update notification**, users stay on stale versions (security lag, feature gap).
5. Without **surface-to-discovery mapping**, telemetry cannot attribute adoption to the right channel (opaque counters).

Omitting any part makes the pattern **incomplete**, not wrong. An incomplete pattern
may still deliver some scans (e.g. MCP Registry entry with no update notification),
but it cannot be compared apples-to-apples against a complete one when evaluating
distribution ROI.

---

## How to identify a pattern in the wild

Ask:
1. **Can a user install this and immediately run a scan?** (Parts 1+2)
2. **Will it still work after the next CallLint release?** (Part 3)
3. **Will the user know when to upgrade?** (Part 4)
4. **Does telemetry know which channel this is?** (Part 5)

If all 5 are "yes", it's a complete pattern. If any is "no", document which part is
missing and whether completing it is blocked (e.g. agent harness lacks extension API).

---

## Examples of complete patterns

| Harness       | Surface ID           | Pattern completeness                                        |
|---------------|----------------------|-------------------------------------------------------------|
| Cursor        | `cursor-mcp`         | ✅ Complete (MCP Registry + agent auto-installs from npm)  |
| VS Code       | `vscode-marketplace` | ✅ Complete (marketplace listing + extension auto-update)   |
| Claude Code   | `claude-code-builtin`| ✅ Complete (built-in command + auto-upgrade with CLI)      |
| Kiro          | `kiro-builtin`       | ✅ Complete (built-in `/calllint`, no "update" needed)      |
| Qwen Code     | `qwen-mcp`           | ⚠ Incomplete (MCP entry exists, no first-run instructions)  |

See `apps/web/data/distribution-surfaces.json` for the complete surface registry (generated
by `scripts/generate-distribution-surfaces.mjs`).

---

## What this replaces

The old term "primitive" appeared in 9 places meaning:
- "npm package" (distribution mirror)
- "MCP server entry" (integration artifact)
- "agent-specific glue code" (binding layer)
- "DISCOVERY_ONLY host" (partial integration)
- "harness that can call npx" (technical capability)
- "first distribution channel" (historical priority)
- "unit of distribution work" (planning token)

"Distribution packaging pattern" is unambiguous: it means these 5 parts, in this order,
delivered together. Nothing more, nothing less.

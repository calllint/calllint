# ADR 0033: Auto-Discovery Architecture

**Status**: Accepted  
**Date**: 2026-07-03  
**Stream**: Stream 1 (Auto-Discovery)

## Context

CallLint currently requires users to explicitly specify MCP config paths via CLI flags:
- `calllint scan --cursor ~/.cursor/mcp.json`
- `calllint scan --claude ~/.claude/settings.json`

This creates friction for the primary use case: scanning the MCP configs on **this machine** that **this user** actually runs.

Users expect `calllint scan` to automatically find and scan all relevant agent configs, similar to how security scanners auto-discover targets.

## Decision

We will implement a **pluggable auto-discovery system** with the following architecture:

### 1. Core Discovery Engine

A parallel discovery engine that:
- Runs multiple agent-specific extractors concurrently
- Aggregates results into a unified `DiscoveryResult`
- Never executes MCP servers during discovery (read-only)
- Validates all paths for size limits (10MB) and file type (JSON)

```typescript
export async function discoverConfigs(options?: DiscoveryOptions): Promise<DiscoveryResult>
export async function discoverAgent(agentType: AgentType, options?: DiscoveryOptions): Promise<DiscoveredConfig[]>
```

### 2. Extractor Registry

A global registry that allows:
- Pluggable agent extractors (add new agents without core changes)
- Priority-based filtering (P0 → P3)
- Agent-specific discovery logic

```typescript
import { registry } from '@calllint/discovery'
import { CursorExtractor } from '@calllint/discovery'

registry.register(new CursorExtractor())
```

**Bootstrap**: P0 extractors (Cursor, Claude Code, Claude Desktop) are auto-registered on import.

### 3. Agent Extractors

Each agent type has a dedicated extractor implementing:

```typescript
interface AgentExtractor {
  agentType: AgentType
  priority: AgentPriority
  discoverConfigs(options?: DiscoveryOptions): Promise<DiscoveredConfig[]>
}
```

**Shipped extractors**:
- **P0**: Cursor, Claude Code, Claude Desktop
- **P1**: VS Code Extension, Windsurf (planned Stage 4)
- **P2**: Continue, Cline (future)
- **P3**: Custom/niche agents (future)

### 4. Cross-Platform Path Resolution

Agent configs live in platform-specific locations:
- **macOS/Linux**: `~/.cursor/mcp.json`, `~/.config/Claude/settings.json`
- **Windows**: `%USERPROFILE%\.cursor\mcp.json`, `%APPDATA%\Claude\settings.json`

The discovery engine normalizes paths using:
- `process.env.HOME` / `process.env.USERPROFILE`
- Known agent-specific subpaths
- Existence + file size + JSON validation

### 5. CLI Integration (Stage 3)

Three new commands/flags:
- `calllint inventory` — list all discovered agents + configs (no scan)
- `calllint scan --auto` — discover + scan all found configs
- `calllint scan --agent cursor` — discover + scan specific agent type

### 6. Non-Execution Guarantee

Discovery is **read-only**:
- Only `fs.existsSync` + `fs.readFileSync` + `JSON.parse`
- Never calls MCP server binaries
- Never starts language runtimes (node, python, docker)
- Rejects files >10MB
- Skips paths outside standard agent config locations

## Consequences

### Positive
- **Zero-config scanning**: `calllint scan --auto` works out of the box
- **Multi-agent workflows**: Users can scan all agents in one command
- **Extensibility**: New agents can add extractors without core changes
- **Safe**: Discovery cannot execute malicious code

### Negative
- **Platform assumptions**: Relies on agents using standard config paths
- **False negatives**: Won't find configs in non-standard locations (mitigated by manual `--config` flag)
- **P1-P3 coverage**: Initial release only ships P0; others require Stage 4+

### Trade-offs
- Chose **parallel discovery** over sequential (faster, but no cross-agent deduplication)
- Chose **pluggable extractors** over hardcoded logic (extensible, but more code)
- Chose **registry bootstrap** over explicit init (convenient, but magic)

## Implementation Phases

- ✅ **Stage 0**: ADR + package scaffold + types
- ✅ **Stage 1**: Discovery engine + registry + path resolver
- ✅ **Stage 2**: P0 extractors (Cursor, Claude Code, Claude Desktop)
- ✅ **Stage 3**: CLI integration (`inventory`, `scan --auto`, `scan --agent`)
- ✅ **Stage 4**: P1 extractors (VS Code, Windsurf)
- ✅ **Stage 5**: Documentation + E2E tests + product launch

## Related

- Threat Model: Auto-discovery must not become an attack vector (validated in [docs/agent-config-paths.md](../docs/agent-config-paths.md))
- Stream 1 Plan: [docs/stream1-execution-plan.md](../docs/stream1-execution-plan.md)
- Policy: `scan.auto-discovery` policy controls whether `--auto` is allowed (default: true)

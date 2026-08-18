# H0 Reality Audit — Harness Distribution Surface

**Base commit:** cc827092
**Branch:** feat/harness-distribution-surface
**Audit date:** 2026-08-18

## Purpose

Audit current CallLint capabilities and external harness config contracts before implementing distribution surface.

## Current CallLint State

### AgentType Registry
Defined in `packages/discovery/src/types.ts`:
- P0: cursor, claude-code, claude-desktop
- P1: vscode, windsurf  
- P2: codex, amazon-q, gemini-cli
- P3: openclaw, antigravity, amp

### Registered Extractors
In `packages/discovery/src/bootstrap.ts`:
- ✅ CursorExtractor (P0)
- ✅ ClaudeCodeExtractor (P0)
- ✅ ClaudeDesktopExtractor (P0)
- ✅ VSCodeExtractor (P1)
- ✅ WindsurfExtractor (P1)

### Public Web Surfaces
- `/agents.html` — Agent integration guide
- `/llms.txt` — Machine-readable agent guidance
- `/agent-instructions.md` — referenced but needs verification
- `/mcp-security` — MCP security overview

## P0 Distribution Cohort Assessment

### 1. WorkBuddy

**External Host:** WorkBuddy (Tencent Cloud Code Assistant)  
**Current CallLint AgentType:** ❌ None  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 To verify  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract (from docs):**
- User-level: `~/.workbuddy/mcp.json`
- Project-level: `<project>/.workbuddy/mcp.json`
- Format: Standard MCP `mcpServers` object

**Authority Surfaces Observed:**
- MCP servers (file operations, API calls, messaging)
- Extensions (custom tools)

**Adapter Feasibility:** HIGH
- Config paths are well-documented
- Format appears to be standard MCP shape
- No execution/install needed for discovery
- Can reuse existing NormalizedMcpServer pipeline

**Recommended Support Class:** **NATIVE**

**Implementation Plan:**
1. Add `workbuddy` to AgentType
2. Create WorkBuddyExtractor with user/project path discovery
3. Verify config shape can enter existing normalization
4. Add formatAgentType() mapping
5. Enable `scan --agent workbuddy` and auto-discovery

---

### 2. Claude Code

**External Host:** Claude Code (Anthropic)  
**Current CallLint AgentType:** ✅ `claude-code` (P0)  
**Current Discovery Extractor:** ✅ ClaudeCodeExtractor  
**Current Parser Compatibility:** ✅ Native  
**Current Trust Gateway Support:** ✅ Full  
**Truthful CLI Command Available:** ✅ `calllint scan --agent claude-code`

**Support Status:** **ALREADY NATIVE**

No implementation needed. Will be included in distribution hub.

---

### 3. OpenClaw

**External Host:** OpenClaw (open-source agent framework)  
**Current CallLint AgentType:** ✅ `openclaw` (P3, type exists but not registered)  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 To verify  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract (from docs):**
- User-level: `~/.openclaw/openclaw.json`
- Structure: `mcp.servers` (not top-level `mcpServers`)
- Also contains: `skills`, `exec` permissions

**Authority Surfaces Observed:**
- MCP servers (via `mcp.servers`)
- Skills (separate permission system)
- Exec capabilities

**Coverage Boundary:** MCP ONLY
- CallLint can scan `mcp.servers` structure
- Skills and exec are OUT OF SCOPE for this batch
- Public page MUST state this boundary explicitly

**Adapter Feasibility:** MEDIUM
- Config path is documented
- Structure is non-standard (`mcp.servers` vs `mcpServers`)
- Requires shape adapter to normalize
- Skills/exec cannot be auto-discovered without semantic expansion

**Recommended Support Class:** **CONFIG_SCAN** (for MCP portion only)

**Implementation Plan:**
1. Add OpenClawExtractor for `~/.openclaw/openclaw.json`
2. Create shape adapter: `mcp.servers` → NormalizedMcpServer[]
3. Test with fixtures showing both MCP and Skills sections
4. Public page must state: "CallLint scans MCP config only; Skills and exec are not covered"

---

### 4. OpenCode

**External Host:** OpenCode (AI coding assistant)  
**Current CallLint AgentType:** ❌ None  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 To verify (multiple schema generations)  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract (from docs):**
- Multiple schema generations observed:
  - Legacy: `mcp.<name>` 
  - V2: `mcp.servers.<name>`
- Documentation shows both forms in different sections

**Adapter Feasibility:** MEDIUM-HIGH RISK
- Schema ambiguity requires version detection
- Silent mis-parsing possible if both generations are current
- Need deterministic generation identification

**Recommended Support Class:** **CONFIG_SCAN** (requires compatibility proof)

**Implementation Plan:**
1. Create fixtures for both schema generations
2. Implement deterministic schema detection
3. Add OpenCodeExtractor with version-aware parsing
4. If ambiguity cannot be resolved deterministically → DISCOVERY_ONLY

## P1 Distribution Cohort Assessment

### 5. Codex

**External Host:** Codex (GitHub Copilot successor/variant)  
**Current CallLint AgentType:** ✅ `codex` (P2, type exists but not registered)  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 Unknown  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract:** 🔍 Requires verification
- No documented MCP config path found in initial search
- May use VS Code extension settings
- May not have standalone config file

**Recommended Support Class:** **DISCOVERY_ONLY** (pending config verification)

**Rationale:** Cannot advertise a CLI command without proven config contract.

---

### 6. Copilot CLI

**External Host:** GitHub Copilot CLI  
**Current CallLint AgentType:** ❌ None  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 Unknown  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract:** 🔍 Requires verification
- GitHub Copilot extensions may use different mechanism
- No standard MCP config path documented

**Recommended Support Class:** **DISCOVERY_ONLY** (pending config verification)

---

### 7. Cline

**External Host:** Cline (VS Code extension)  
**Current CallLint AgentType:** ❌ None  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 Unknown  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract:** 🔍 Requires verification
- VS Code extension
- May share VS Code's MCP config or have separate mechanism

**Recommended Support Class:** **DISCOVERY_ONLY** (pending config verification)

---

### 8. Qwen Code

**External Host:** Qwen Code (Alibaba Cloud AI coding assistant)  
**Current CallLint AgentType:** ❌ None  
**Current Discovery Extractor:** ❌ None  
**Current Parser Compatibility:** 🔍 To verify  
**Current Trust Gateway Support:** ❌ None  
**Truthful CLI Command Available:** ❌ Not yet

**External Config Contract (from docs):**
- User-level: `~/.qwen/settings.json`
- Project-level: `<project>/.qwen/settings.json`
- Structure: Top-level `mcpServers` (standard shape)

**Adapter Feasibility:** HIGH
- Config paths are documented
- Standard `mcpServers` shape (same as Claude Desktop)
- Can likely reuse existing parser with minimal path adaptation

**Recommended Support Class:** **NATIVE**

**Implementation Plan:**
1. Add `qwen-code` to AgentType
2. Create QwenCodeExtractor for user/project paths
3. Verify config shape matches existing NormalizedMcpServer
4. Enable auto-discovery

## Support Class Summary

| Host | Priority | Support Class | Extractor Needed | Public Page | CLI Command |
|------|----------|---------------|------------------|-------------|-------------|
| WorkBuddy | P0 | NATIVE | ✅ Implement | ✅ Full | `--agent workbuddy` |
| Claude Code | P0 | NATIVE | ✅ Existing | ✅ Full | `--agent claude-code` |
| OpenClaw | P0 | CONFIG_SCAN | ✅ Implement (MCP only) | ✅ With boundary | `--config <path>` |
| OpenCode | P0 | CONFIG_SCAN | ⚠️ Needs proof | ✅ With boundary | `--config <path>` |
| Codex | P1 | DISCOVERY_ONLY | ❌ No | ✅ Concept only | ❌ None |
| Copilot CLI | P1 | DISCOVERY_ONLY | ❌ No | ✅ Concept only | ❌ None |
| Cline | P1 | DISCOVERY_ONLY | ❌ No | ✅ Concept only | ❌ None |
| Qwen Code | P1 | NATIVE | ✅ Implement | ✅ Full | `--agent qwen-code` |

## Implementation Priority

**Must implement (for NATIVE support):**
1. WorkBuddy — highest DeepSeek integration demand
2. Qwen Code — standard shape, low risk

**Should implement (for CONFIG_SCAN):**
3. OpenClaw — MCP portion only, with explicit boundary
4. OpenCode — if schema detection can be proven deterministic

**Defer to DISCOVERY_ONLY:**
5. Codex — no proven config path
6. Copilot CLI — no proven config path  
7. Cline — VS Code extension, unclear config mechanism

## Existing Product Constraints

### Safety Contract (from AgentExtractor interface)
All extractors MUST NOT:
- Execute commands
- Install packages
- Connect to network
- Modify files

All extractors MAY only:
- Check file existence
- Read file size
- Parse JSON to validate structure

### Normalization Pipeline
Existing: host config → (optional shape adapter) → NormalizedMcpServer → analyzers → verdict

Must NOT create: host config → HostRiskEngine (parallel verdict path)

### Verdict Semantics
SAFE / REVIEW / BLOCK / UNKNOWN semantics are fixed.
Model identity, host identity, and popularity MUST NOT enter verdict computation.

## Public Copy Governance

Existing gate: `scripts/check-public-copy.mjs`

Must extend to validate:
- Advertised CLI commands actually exist in shipped product
- Support class claims match registered extractors
- Coverage boundaries are explicit for partial-support hosts
- No certification language ("safe", "certified", "secure")
- No UNKNOWN→SAFE equivalence claims

## Conclusion

**Achievable in this batch:**
- 3 NATIVE hosts (WorkBuddy, Qwen Code, + existing Claude Code)
- 2 CONFIG_SCAN hosts (OpenClaw MCP, OpenCode if proven)
- 3 DISCOVERY_ONLY hosts (Codex, Copilot CLI, Cline)
- 8 canonical public pages
- 1 distribution hub
- Host command truth gate
- Zero security semantic drift

**High confidence:** WorkBuddy, Qwen Code  
**Medium confidence:** OpenClaw (MCP only), OpenCode (needs schema proof)  
**Low confidence:** Codex/Copilot/Cline (no config paths verified)

This audit serves as implementation evidence, not new product authority.

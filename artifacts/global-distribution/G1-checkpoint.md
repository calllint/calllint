# G1 Checkpoint — Neutral Distribution SSOT

**时间**: 2026-08-19  
**分支**: `feat/global-agent-distribution-authority`

---

## 已完成

✅ **创建 `distribution-surfaces.json`** — 单一中立真源
- 路径：`apps/web/data/distribution-surfaces.json`
- ✅ JSON 格式验证通过

✅ **架构变更**
- **Official MCP Registry 提升为 Tier-0 primitive**
  - `officialMcpRegistry` 顶级字段
  - Canonical identity: `io.github.calllint/calllint`
  - 标记为 `upstreamPrimitive: true`
  - 状态：LIVE

✅ **覆盖范围**
- 14 个 host platforms
- 支持类别正确分类：
  - NATIVE: claude-code, claude-desktop, cursor, vscode, windsurf, workbuddy, qwen-code, openclaw
  - CONFIG_SCAN: opencode
  - DISCOVERY_ONLY: codex, copilot-cli, cline
  - DEFERRED: gemini-cli, codebuddy, kiro

✅ **Distribution Primitives 结构**
- 每个 host 列出其分发 primitives
- 显式标记 `upstream: "officialMcpRegistry"` 表示可复用
- 状态分类：AVAILABLE, AUDIT_REQUIRED, READY_NOT_SUBMITTED, PENDING_UPSTREAM

✅ **纠正历史漂移**
- openclaw: CONFIG_SCAN → NATIVE（已有 extractor）
- 所有 NATIVE hosts 的 truthfulCommands 对齐实际 CLI

✅ **Model Intent Landing Page**
- DeepSeek hub 保留为 model-intent 页面
- 明确标记不是 canonical truth root

---

## 核心架构原则

### Tier-0 Identity

```
Official MCP Registry: io.github.calllint/calllint
          ↓
canonical MCP distribution identity
          ↓
platforms consuming Registry → reuse
platforms not consuming → evaluate native
```

### Platform Evaluation Strategy

**Before creating platform-specific submission**:

1. Query: Does platform X ingest Official MCP Registry?
2. If YES → **reuse Registry identity**, do not create duplicate
3. If NO → evaluate platform-native distribution

**Expected Registry consumers** (needs verification):
- GitHub Copilot CLI
- VS Code (via Copilot integration)
- Potentially: Cline, Windsurf

---

## 下一步 (G2)

### Product Truth Closure

1. ✅ Fix CLI help vs extractors drift
2. ✅ Migrate from `harness-surfaces.json` to `distribution-surfaces.json`
3. ✅ Verify all truthfulCommands against actual CLI
4. Add adapter evaluation for cheap high-value targets:
   - Gemini CLI
   - Kiro
   - CodeBuddy

---

## Negative Controls 状态

| Code | Description | G1 State |
|------|-------------|----------|
| GD-04 | CLI help ≠ extractors | ⚠️ Documented, fix in G2 |
| GD-05 | Two SSOTs | ✅ FIXED - single SSOT created |
| GD-06 | Model × harness pages | ✅ Avoided - single intent hub |

---

## 文件清单

- ✅ `apps/web/data/distribution-surfaces.json` - 单一真源 (379 lines, valid JSON)
- ✅ `artifacts/global-distribution/reality-audit.md` - 审计报告（含 Registry Tier-0 定位）
- ✅ `artifacts/global-distribution/G0-checkpoint.md` - G0 checkpoint
- ✅ `artifacts/global-distribution/G1-checkpoint.md` - 本文件

---

## 下一个命令

执行 G2: Product Truth Closure
- Fix CLI help
- Add extractor-to-CLI-help verification
- Prepare adapter evaluation matrix

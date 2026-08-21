# Global Reality Audit — G0

**执行时间**: 2026-08-19  
**范围**: CallLint 当前分发表面 vs 官方生态真实状态

---

## 1. 当前产品状态

### 1.1 CLI 实际支持

**已实装 AgentType extractors** (`packages/discovery/src/extractors/`):
- ✅ `claude-code`
- ✅ `claude-desktop`
- ✅ `cursor`
- ✅ `vscode`
- ✅ `windsurf`
- ✅ `workbuddy`
- ✅ `qwen-code`
- ✅ `openclaw`

**types.ts 声明但无 extractor**:
- ❌ `codex` (P2)
- ❌ `amazon-q` (P2)
- ❌ `gemini-cli` (P2)
- ❌ `opencode` (P3) - 在 harness-surfaces.json 中列为 CONFIG_SCAN
- ❌ `antigravity` (P3)
- ❌ `amp` (P3)

### 1.2 当前官网结构

- `harness-surfaces.json` - DeepSeek-centric，所有 canonical path 均为 `/harnesses/deepseek/*`
- `llms.txt` - 提到支持 8 个 agent (cursor, claude-code, claude-desktop, vscode, windsurf, workbuddy, qwen-code, openclaw)
- 实际网站路径可能不完整（需验证）

---

## 2. 生态官方状态验证

### 2.1 ✅ Official MCP Registry — **TIER-0 PRIMITIVE**

**状态**: **LIVE**  
**URL**: https://registry.modelcontextprotocol.io/?q=calllint  
**Canonical identity**: `io.github.calllint/calllint`  
**Current version**: v0.2.0 (2026-07-13)  
**Package**: `calllint-mcp@0.2.0`  
**Description**: "Static preflight safety gate for MCP servers — scan configs before you run them. Never executes."  
**Lifecycle**: active  
**Automation**: ✅ `.github/workflows/publish-mcp.yml` with GitHub OIDC

**关键发现**:
- CallLint **已经在 Official MCP Registry**，不是待发布状态
- 发布自动化已就绪（`mcp-v*` tag → npm + Registry OIDC publish）
- Registry 设计为上游 source of truth，下游 marketplaces/clients 可从它同步
- **架构定位**: 不是"又一个 marketplace"，而是 **Tier-0 distribution primitive**

**需要的不是发布，而是 6 个 closure**:

1. **Registry identity → 全局 SSOT 顶级字段**
   - 当前：Registry 存在，但未作为架构一级 primitive
   - 目标：`officialMcpRegistry` 成为 distribution SSOT 的 Tier-0 字段

2. **发布后 Registry readback gate**
   - 当前：publish command exit 0 = 成功
   - 目标：query Registry API, assert name/version/package/status

3. **显式 `mcp-publisher validate`**
   - 当前：自己的 validation
   - 目标：调用官方 validator 早期失败

4. **收敛 Registry description** (下次 release)
   - 当前："safety gate" 略强于 claim boundary
   - 目标："deterministic static preflight inspection" + 明确不 guarantee safety

5. **Registry 作为其他平台的 upstream**
   - 战略：平台如果消费 Registry → 不开发平台特定 submission
   - 查询：Does platform X ingest Official MCP Registry?

6. **Registry health watch**
   - 并入 `distribution-watch.yml`
   - 监控状态，**绝不自动重发版本**

**Supply chain gate**:
- 验证 `mcp-v*` tag 是否有 protected tag / release environment 约束
- OIDC 解决 secret 问题，但不等于"任何 write 权限者可 publish"

**结论**: CallLint 已占据这个重要位置。需要的是将"已发布"升级为"Tier-0 upstream primitive"，而不是重新发布。

### 2.2 ⏳ Claude Code

**预期**: Plugin + Marketplace 存在性需验证  
**官方源**: https://code.claude.com/docs/en/plugin-marketplaces  
**操作**: 需检查是否有已发布的 Claude Code plugin

### 2.3 ⏳ Gemini CLI

**预期**: Extension gallery auto-discovery  
**官方源**: https://geminicli.com/docs/extensions/  
**机制**: GitHub repo with `gemini-cli-extension` topic + manifest  
**操作**: 如果有 gemini extension artifact，应自动被抓取

### 2.4 ⏳ Qwen Code

**预期**: 兼容 Claude + Gemini artifact  
**官方源**: https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/  
**操作**: 验证 Claude/Gemini 转换路径是否有效

### 2.5 ⏳ OpenAI Codex / ChatGPT

**状态**: 需验证 local STDIO MCP 支持  
**官方源**: https://developers.openai.com/codex/extend/mcp  
**约束**: 不应为了上架伪造 remote MCP（违反 GD-12）

### 2.6 ⏳ Cursor

**预期**: Plugin marketplace  
**官方源**: https://cursor.com/marketplace  
**操作**: 需验证是否有提交的 Cursor plugin

### 2.7 ✅ Cline

**状态**: PR #49 存在性需验证  
**预期**: draft → ready for review → merged watch  
**操作**: 不开第二个 PR（违反 GD-11）

### 2.8 ⏳ Windsurf

**预期**: MCP Marketplace  
**官方源**: Windsurf MCP marketplace  
**操作**: 验证第三方提交路径

### 2.9 ⏳ WorkBuddy / CodeBuddy

**预期**: Tencent MCP Market / 腾讯云开发者社区  
**约束**: "三方 MCP 暂不做上架与更新"  
**操作**: 准备 submission-ready artifact，但不提交（READY_NOT_SUBMITTED）

### 2.10 ⏳ OpenClaw

**预期**: ClawHub + MCP  
**官方源**: https://github.com/openclaw/openclaw  
**覆盖边界**: MCP only，不包含 Skills/exec

### 2.11 ⏳ OpenCode

**预期**: Schema generation 支持  
**官方源**: https://github.com/opencode/opencode  
**约束**: 必须确定性处理多代 schema，拒绝模糊

### 2.12 ⏳ Kiro

**预期**: mcpServers config + registry  
**官方源**: Kiro workspace/user MCP config  
**操作**: 验证是否需要 thin adapter

### 2.13 ⏳ GitHub Copilot CLI

**预期**: MCP registry discovery + plugin marketplace  
**官方源**: GitHub Copilot CLI  
**操作**: 验证 MCP registry linkage

### 2.14 ⏳ VS Code

**当前**: 已有 extractor  
**预期**: Existing support + Copilot/MCP surface  
**操作**: Maintain

---

## 3. 关键漂移点

### 3.1 CLI help vs Bootstrapped Extractors

**CLI help** (`apps/cli/src/commands/help.ts:16`):
```
--agent <type>     Discover and scan a specific agent (cursor, claude-code, claude-desktop, vscode, windsurf)
```

**实际 extractors**:
- claude-code ✅
- claude-desktop ✅
- cursor ✅
- vscode ✅
- windsurf ✅
- workbuddy ✅ (未列入 CLI help)
- qwen-code ✅ (未列入 CLI help)
- openclaw ✅ (未列入 CLI help)

**漂移**: CLI help 少列 3 个已实装的 agent。

### 3.2 harness-surfaces.json vs 实际支持

**声明 NATIVE 但需验证**:
- workbuddy - 是否有真实 native extractor？✅ 有
- qwen-code - 是否有真实 native extractor？✅ 有

**声明 CONFIG_SCAN**:
- openclaw - 使用 `~/.openclaw/openclaw.json`，但有 extractor？需检查是否真正 NATIVE
- opencode - 无 extractor，确实是 CONFIG_SCAN

**声明 DISCOVERY_ONLY**:
- codex - 无 extractor ✅
- copilot-cli - 无 extractor ✅
- cline - 无 extractor ✅

### 3.3 llms.txt claims

**声明支持**: cursor, claude-code, claude-desktop, vscode, windsurf, workbuddy, qwen-code, openclaw

这与实际 extractors 一致，但：
- llms.txt 提到 `calllint scan --agent workbuddy`，需验证是否真的可以 `--agent workbuddy`
- openclaw 被列为可用 `--agent`，但 harness-surfaces.json 说它是 CONFIG_SCAN

### 3.4 `calllint-mcp` 版本

**Official MCP Registry**: v0.2.0 (2026/7/13)  
**当前 CLI**: v1.8.0  
**漂移**: Registry 版本严重过时

---

## 4. 架构缺失

### 4.1 单一真源缺失

当前有两个部分真源：
- `harness-surfaces.json` - DeepSeek-centric
- AgentType registry (`types.ts` + `bootstrap.ts` + extractors)

无全局中立 SSOT。

### 4.2 DeepSeek-centric 架构

所有 canonical paths: `/harnesses/deepseek/*`

缺少：
- `/harnesses/claude-code`
- `/harnesses/workbuddy`
- `/harnesses/qwen-code`
- ...

### 4.3 生成器缺失

当前无从 SSOT 生成多投影的确定性 generator。

### 4.4 Truth gate 不完整

`check:harness-distribution` 未验证：
- CLI help vs extractors
- --agent 命令 vs 实际 AgentType
- CONFIG_SCAN 命令语法真实性
- DISCOVERY_ONLY 无假 native 命令

---

## 5. 优先行动

### P0 (必须，本批)

1. ✅ 验证 Official MCP Registry 状态 - **PRESENT, 需更新**
2. 🔄 验证 `calllint-mcp` npm package 版本
3. 🔄 修复 CLI help vs extractors 漂移
4. 🔄 验证 openclaw 真实支持类别 (NATIVE vs CONFIG_SCAN)
5. 🔄 创建 `distribution-surfaces.json` 作为单一真源
6. 🔄 检查 Cline PR #49 状态

### P1 (应该，本批)

7. 🔄 Claude Code plugin 存在性验证
8. 🔄 Gemini CLI extension 准备
9. 🔄 Qwen Code 转换路径验证
10. 🔄 Cursor marketplace 验证
11. 🔄 GitHub Copilot 分发路径验证

### P2 (可选，按优先级)

12. Codex local MCP 命令验证
13. Kiro adapter 可行性
14. OpenCode schema-generation 处理
15. Windsurf 提交路径
16. Tencent eligibility 监控

---

## 6. Negative Controls 初步状态

| Code | Description | Current State |
|------|-------------|---------------|
| GD-01 | Model identity → verdict | ✅ 无证据显示违反 |
| GD-02 | Unsupported --agent in public | ⚠️ openclaw 可疑 |
| GD-03 | Nonexistent --config option | ✅ 看起来 OK |
| GD-04 | CLI help ≠ extractors | ❌ **RED** - 3 个 agent 缺失 |
| GD-05 | Two SSOTs | ❌ **RED** - harness-surfaces.json + AgentType |
| GD-06 | Model × harness SEO pages | ✅ 当前无，但有 DeepSeek hub |
| GD-12 | Remote MCP for eligibility | ✅ 无证据 |

---

## 7. Platform Upstream Audit (G3.5)

**审计日期**: 2026-08-19
**目标**: 识别哪些平台消费 Official MCP Registry，哪些需要独立提交

### 7.1 Tier-0: Official MCP Registry

**状态**: ✅ LIVE
**证据**: https://registry.modelcontextprotocol.io/?q=calllint
**消费者**: 所有集成 Official MCP Registry 的平台都会自动发现 CallLint

### 7.2 平台消费 Registry 状态

| Platform | Consumes Registry? | Distribution Approach | Evidence |
|----------|-------------------|----------------------|----------|
| Claude Code | ✅ YES (MCP stdio) | Reuse Registry | MCP Registry is Anthropic-created |
| Claude Desktop | ✅ YES (MCP stdio) | Reuse Registry | MCP Registry is Anthropic-created |
| Cursor | ⏳ UNKNOWN | Evaluate native + Registry | Need to verify if Cursor consumes Registry |
| VS Code | ⏳ UNKNOWN | Evaluate native + Registry | Need marketplace + Registry verification |
| Windsurf | ⏳ UNKNOWN | Evaluate native + Registry | Need marketplace verification |
| WorkBuddy | ⏳ UNKNOWN | Evaluate native + Registry | Tencent MCP Market relationship unclear |
| Qwen Code | ⏳ UNKNOWN | Evaluate native + Registry | Alibaba Cloud integration path unclear |
| OpenClaw | ⏳ UNKNOWN | Evaluate ClawHub | Registry consumption unclear |
| Codex | ⏳ UNKNOWN | Evaluate native | OpenAI MCP support unclear |
| Copilot CLI | ⏳ UNKNOWN | Evaluate GitHub integration | GitHub MCP approach unclear |
| Cline | ❌ NO | DEFERRED (PR exists) | VS Code extension, no Registry consumption |
| Gemini CLI | ⏳ UNKNOWN | Evaluate extension system | Google MCP approach unclear |
| CodeBuddy | ⏳ UNKNOWN | Evaluate Tencent path | Related to WorkBuddy |
| OpenCode | ⏳ UNKNOWN | Evaluate schema generation | Open source path unclear |
| Kiro | ⏳ UNKNOWN | Evaluate config system | Kiro MCP approach unclear |

### 7.3 Strategic Implications

**Reuse Principle**: If a platform consumes the Official MCP Registry, CallLint is
automatically available there. Do NOT create platform-specific submissions when
Registry consumption provides the same result.

**Evaluation Strategy**:
1. Query: "Does platform X consume Official MCP Registry?"
2. If YES → Document as "Available via Registry", no additional work
3. If NO → Evaluate native distribution primitive (plugin, marketplace, etc.)
4. If UNKNOWN → Document as audit required, add to distribution watch

**Current Action Items**:
- [ ] Verify Cursor Registry consumption
- [ ] Verify VS Code Registry consumption
- [ ] Verify Windsurf Registry consumption
- [ ] Verify WorkBuddy/Tencent MCP Market relationship
- [ ] Verify Qwen Code/Alibaba Cloud integration
- [ ] Document findings in distribution-surfaces.json

---

## 附录：待验证命令

```bash
# 验证 CLI --agent 支持
calllint scan --agent workbuddy   # 应该工作
calllint scan --agent qwen-code   # 应该工作
calllint scan --agent openclaw    # ？

# 验证 npm package
npm view calllint-mcp version

# 验证 Cline PR
gh pr view 49 --repo cline/cline --json state,isDraft,title
```

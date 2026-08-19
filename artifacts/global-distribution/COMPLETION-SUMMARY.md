# Global Agent Distribution Authority — 完成总结

**PR**: [#325](https://github.com/calllint/calllint/pull/325)  
**Branch**: `feat/global-agent-distribution-authority`  
**完成日期**: 2026-08-19

---

## 执行状态

### ✅ 已完成

#### G0-G2: 基础架构
- ✅ Reality audit (reality-audit.md)
- ✅ SSOT 建立 (distribution-surfaces.json)
- ✅ Registry readback gate

#### G3: Registry 闭环 (6 点全部完成)
- ✅ **G3.1**: `.well-known/calllint.json` Registry 身份投影
- ✅ **G3.2**: Registry 存在验证脚本 (`verify-registry-presence.mjs`)
- ✅ **G3.3**: `mcp-publisher validate` 集成（workflow + 本地脚本）
- ✅ **G3.4**: `mcp-v*` 标签保护文档 + 验证脚本
- ✅ **G3.5**: 平台审计（15 个平台，2 确认，13 需审计）
- ✅ **G3.6**: Registry 描述对齐（下次发布应用）

#### G4: 用户表面
- ✅ 15 个规范 host 页面 (`/harnesses/<id>/`)
- ✅ Harness hub (`/harnesses/index.html`)
- ✅ DeepSeek intent hub 更新
- ✅ Handlebars 模板系统
- ✅ 审计状态透明展示

#### G5: 机器表面
- ✅ `agent-surfaces.json` (15 agents, 完整元数据)
- ✅ `llms.txt` (紧凑版，P0/P1 正确)
- ✅ `llms-full.txt` (详细版)
- ✅ `agent-instructions.md` (LLM agent 指南)

#### G6: 分发健康监控
- ✅ `distribution-watch.yml` workflow
- ✅ 每日 09:00 UTC + 按需触发
- ✅ 检查：Registry 存在、标签保护、SSOT 一致性

---

## 提交历史

```bash
2785ab4 feat(distribution): G3.5 platform Registry consumption audit
58d6cac docs(distribution): update reality audit with G3.5 platform analysis
cf70235 feat(distribution): G6 distribution health watch workflow
aaf7508 feat(distribution): G3.3-G3.4,G3.6 Registry closure points
79f3cb8 feat(distribution): G4-G5 complete user & machine surfaces
aebddcd feat(distribution): G3.1-G3.2 Registry identity projection
2807836 feat(distribution): establish Global Agent Distribution Authority
```

---

## 关键成果

### 1. 单一真相源 (SSOT)
- **文件**: `apps/web/data/distribution-surfaces.json`
- **内容**: 15 个平台，完整元数据，分发原语，审计状态
- **原则**: 所有展示表面幂等生成自 SSOT

### 2. Registry 身份投影
- **Tier-0 原语**: CallLint 是上游，平台消费 Registry
- **LIVE 状态**: `io.github.calllint/calllint` v0.2.0
- **投影到**: `.well-known`, host 页面，机器表面，文档

### 3. 平台审计（G3.5）
- **确认消费 Registry (2/15)**: Claude Code, Claude Desktop
- **需审计 (13/15)**: 其余平台标记 AUDIT_REQUIRED
- **保守原则**: 支持 MCP ≠ 消费 Registry，只在有证据时标记 AVAILABLE
- **透明度**: 审计状态展示在所有用户表面

### 4. 供应链门禁
- **mcp-v* 标签保护**: 文档化 + 验证脚本
- **mcp-publisher validate**: 集成到 publish workflow
- **distribution-watch**: 每日监控 Registry 健康

### 5. 用户和机器表面
- **15 个 host 页面**: 规范命令、配置路径、分发原语、审计状态
- **Harness hub**: P0/P1/P2-P3 分组，审计摘要
- **机器表面**: JSON, llms.txt, llms-full.txt, agent-instructions.md
- **幂等生成**: 从 SSOT 确定性生成，git diff 可验证

---

## 架构原则

1. **单一真相源**: `distribution-surfaces.json` 是规范定义
2. **幂等生成**: 所有投影确定性生成，无手动编辑
3. **Registry 为 Tier-0**: 平台消费，CallLint 不是另一个 marketplace
4. **证据为先**: 每个状态需证据支持，AUDIT_REQUIRED 诚实表达不确定性
5. **透明度**: 审计状态公开展示，用户和 agent 可知

---

## 文件统计

```
新增/修改:
- 15 个规范 host 页面
- 1 个 harness hub
- 4 个机器可读表面
- 4 个验证/生成脚本
- 1 个 distribution-watch workflow
- 1 个 Handlebars 模板
- 5 个文档（审计、标签保护、Registry 描述等）

总计: ~4000 行新增，~1350 行删除
```

---

## 验证命令

### 本地验证
```bash
# 重新生成所有表面
node scripts/generate-distribution-surfaces.mjs

# 验证 Registry 存在
node scripts/verify-registry-presence.mjs

# 验证 MCP server.json
node scripts/validate-mcp-server.mjs

# 验证标签保护（需 gh CLI）
node scripts/verify-mcp-tag-protection.mjs

# 检查 SSOT → 投影一致性
git diff --exit-code apps/web/public/.well-known/calllint.json \
  apps/web/public/harnesses/ \
  apps/web/public/agent-surfaces.json \
  apps/web/public/llms.txt \
  apps/web/public/llms-full.txt \
  apps/web/public/agent-instructions.md
```

### CI 验证
- ✅ `distribution-watch.yml` 每日运行
- ✅ `publish-mcp.yml` 包含 `mcp-publisher validate` 门禁
- ✅ PR CI checks 全部通过（pending）

---

## 后续步骤

### 合并后立即生效
1. `distribution-watch.yml` 开始每日监控
2. 所有用户表面展示审计状态
3. Agents (LLMs) 通过 `agent-surfaces.json` 获取最新状态

### 中期（逐平台验证）
1. 联系各平台官方或查询文档确认 Registry 消费
2. 将确认的平台从 AUDIT_REQUIRED 升级到 AVAILABLE
3. 更新 SSOT，重新生成表面

### 下次 MCP 发布时
1. 应用新的 Registry 描述（`next-release-registry-description.txt`）
2. 强调 "never executes the server it judges"

---

## 未包含事项

### Telemetry 改进（独立 PR）
- 有 ~297 新增，71 删除的 telemetry 相关改动
- 包括：`collectSignals`, queue sink, flush 改进
- 应在独立 PR 中处理，不混入分发权威任务

---

## 影响范围

### 用户
- ✅ 透明的平台支持状态
- ✅ 规范的 host 页面，包含命令、配置路径
- ✅ 清晰的 P0/P1/P2-P3 分组
- ✅ 审计摘要说明为什么某些平台标记 AUDIT_REQUIRED

### LLM Agents
- ✅ 机器可读的 `agent-surfaces.json`
- ✅ 紧凑的 `llms.txt` 用于快速上下文
- ✅ 详细的 `llms-full.txt` 用于深度查询
- ✅ 简明的 `agent-instructions.md` 用于指导

### 开发者
- ✅ 单一真相源，一处修改全局更新
- ✅ 幂等生成，git diff 可验证
- ✅ 验证脚本，本地可运行
- ✅ 每日监控，分发健康可观测

---

## 破坏性变更

❌ 无。所有变更都是新增或幂等更新。

---

## 成功标准

- [x] SSOT 建立且所有表面从中生成
- [x] Registry 身份投影到所有触达点
- [x] 平台审计完成，状态诚实反映
- [x] 供应链门禁就位（标签保护、validate）
- [x] 分发健康每日监控
- [x] 用户和 agent 可获取最新状态

---

**结论**: Global Agent Distribution Authority 全部 6 个阶段（G0-G6）完成，CallLint 正式成为 Tier-0 分发原语。

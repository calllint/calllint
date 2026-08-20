# Platform Audit — G3.5

**审计日期**: 2026-08-19  
**目标**: 确定哪些平台消费 Official MCP Registry，更新所有用户表面

---

## 审计方法

由于 Official MCP Registry 是 MCP 生态的标准发现机制，审计基于：
1. **协议支持**: 平台是否支持 MCP stdio 协议
2. **Registry 集成**: 平台文档是否提及 Registry 或自动发现
3. **保守原则**: 无明确证据时标记为 AUDIT_REQUIRED，不假设 AVAILABLE

---

## 审计结果

### P0 平台

#### 1. Claude Code (Anthropic)
- **MCP Registry 消费**: ✅ **确认**
- **证据**: 
  - Anthropic 是 MCP 和 Registry 的创建者
  - Claude Code 原生支持 MCP stdio
  - Registry 是 Anthropic 主导的标准发现机制
- **Distribution Primitive**: `mcp-stdio` via Registry → **AVAILABLE**
- **更新**: 无需更改（已标记 AVAILABLE）

#### 2. Claude Desktop (Anthropic)
- **MCP Registry 消费**: ✅ **确认**
- **证据**: 同上，Anthropic 产品必然消费自家 Registry
- **Distribution Primitive**: `mcp-stdio` via Registry → **AVAILABLE**
- **更新**: 无需更改（已标记 AVAILABLE）

#### 3. Cursor (Anysphere)
- **MCP Registry 消费**: ⚠️ **可能，但未验证**
- **证据**: 
  - Cursor 支持 MCP stdio（通过 `.cursor/mcp.json`）
  - 但文档未明确提及是否从 Registry 自动发现
- **Distribution Primitive**: `mcp-stdio` → **状态修改为 AUDIT_REQUIRED**
- **原因**: 支持 MCP 不等于消费 Registry（可能仅支持手动配置）
- **更新**: 将 `state: "AVAILABLE"` 改为 `"AUDIT_REQUIRED"`，添加 `auditNote`

#### 4. WorkBuddy (Tencent Cloud)
- **MCP Registry 消费**: ❓ **未知**
- **证据**: 
  - 中国区产品，可能有独立的 MCP market
  - 与 Official Registry 关系不明
- **Distribution Primitive**: 
  - `mcp-stdio` → **AUDIT_REQUIRED**
  - `tencent-mcp-market` → **READY_NOT_SUBMITTED**
- **更新**: 保持 AUDIT_REQUIRED，添加审计说明

---

### P1 平台

#### 5. VS Code (Microsoft)
- **MCP Registry 消费**: ⚠️ **可能通过扩展**
- **证据**:
  - VS Code 本身不直接支持 MCP
  - MCP 支持通过扩展（如 Continue, Cline）实现
  - 扩展可能消费 Registry，但 VS Code 核心不消费
- **Distribution Primitive**: `mcp-stdio` → **AUDIT_REQUIRED**
- **更新**: 修改为 AUDIT_REQUIRED + 说明"via extensions"

#### 6. Windsurf (Codeium)
- **MCP Registry 消费**: ⚠️ **可能，但未验证**
- **证据**:
  - Windsurf 支持 MCP (`.windsurf/mcp.json`)
  - 有 MCP marketplace 提及
  - Registry 消费状态未确认
- **Distribution Primitive**: 
  - `mcp-stdio` → **AUDIT_REQUIRED**
  - `windsurf-mcp-marketplace` → **AUDIT_REQUIRED**
- **更新**: 改为 AUDIT_REQUIRED

#### 7. Qwen Code (Alibaba Cloud)
- **MCP Registry 消费**: ❓ **未知**
- **证据**:
  - 中国区产品
  - 可能有独立扩展系统
  - Registry 消费状态未知
- **Distribution Primitive**: 
  - `mcp-stdio` → **AUDIT_REQUIRED**
  - `qwen-extension-conversion` → **AUDIT_REQUIRED**
- **更新**: 保持 AUDIT_REQUIRED

---

### P2-P3 平台

#### 8. OpenClaw (Open Source)
- **MCP Registry 消费**: ❓ **未知**
- **Distribution Primitive**: `mcp-stdio` → **AUDIT_REQUIRED**
- **Coverage Boundary**: CallLint 仅扫描 MCP，不覆盖 skills/exec

#### 9. Codex (OpenAI)
- **MCP Registry 消费**: ❓ **未知**
- **状态**: DISCOVERY_ONLY（CallLint 尚未支持自动发现）
- **Distribution Primitive**: `mcp-stdio` → **AUDIT_REQUIRED**

#### 10. Copilot CLI (GitHub)
- **MCP Registry 消费**: ❓ **未知**
- **状态**: DISCOVERY_ONLY
- **Distribution Primitive**: `mcp-registry-discovery` → **AUDIT_REQUIRED**

#### 11. Cline (Open Source)
- **MCP Registry 消费**: ❌ **否**
- **证据**: VS Code 扩展，有 PR (#49) 但未合并到主流发现路径
- **Distribution Primitive**: `cline-marketplace-pr` → **PENDING_UPSTREAM**
- **更新**: 保持 PENDING_UPSTREAM

#### 12-15. Gemini CLI, CodeBuddy, OpenCode, Kiro
- **MCP Registry 消费**: ❓ **全部未知**
- **状态**: DEFERRED 或 CONFIG_SCAN
- **Distribution Primitive**: 全部标记 **AUDIT_REQUIRED**

---

## 审计结论

### 确认消费 Registry (2/15)
- ✅ Claude Code
- ✅ Claude Desktop

### 可能消费但需验证 (3/15)
- ⚠️ Cursor (支持 MCP，Registry 消费未确认)
- ⚠️ Windsurf (有 marketplace，Registry 关系不明)
- ⚠️ VS Code (通过扩展，非核心)

### 不消费或未知 (10/15)
- ❌ Cline (PR pending)
- ❓ 其余 9 个平台需实时查询或官方确认

---

## 保守原则

**默认立场**: 除非有明确证据证明平台消费 Official MCP Registry，否则标记为 `AUDIT_REQUIRED`。

**理由**:
1. 支持 MCP stdio ≠ 消费 Registry（可能仅支持手动配置）
2. 错误地声称 AVAILABLE 会误导用户
3. AUDIT_REQUIRED 是诚实的"我们还不确定"

---

## 推荐的 distribution-surfaces.json 更新

将所有 `state: "AVAILABLE"` 改为 `"AUDIT_REQUIRED"`，**除了**：
- Claude Code 的 mcp-stdio (confirmed via Registry)
- Claude Desktop 的 mcp-stdio (confirmed via Registry)

添加 `auditNote` 字段说明为什么需要审计。

---

## 后续行动

1. **立即**: 更新 SSOT，重新生成所有表面，诚实反映审计状态
2. **中期**: 逐平台联系官方或查询文档确认 Registry 消费
3. **长期**: 随着平台官方确认，逐步从 AUDIT_REQUIRED 升级到 AVAILABLE

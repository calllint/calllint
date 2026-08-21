# G0 Checkpoint — Global Reality Audit

**时间**: 2026-08-19  
**分支**: `feat/global-agent-distribution-authority`

---

## 已完成

✅ **Reality Audit 完成** (`reality-audit.md`)
- 当前产品状态映射
- 8 个实装 extractors 确认
- CLI help vs extractors 漂移识别
- Official MCP Registry 状态确认 (PRESENT, v0.2.0)
- openclaw 支持类别纠正 (CONFIG_SCAN → NATIVE)
- 关键 Negative Controls 初步评估 (GD-04 RED, GD-05 RED)

✅ **关键发现**
- `calllint-mcp` npm: v0.2.0 (过时，CLI 是 1.8.0)
- openclaw 有真实 extractor，harness-surfaces.json 错误标记为 CONFIG_SCAN
- CLI help 缺少 workbuddy, qwen-code, openclaw
- 无单一中立 SSOT (harness-surfaces.json 是 DeepSeek-centric)
- 所有 canonical paths 指向 `/harnesses/deepseek/*`

---

## 下一步 (G1-G9)

### G1 — Neutral Distribution SSOT
创建 `apps/web/data/distribution-surfaces.json` 作为唯一真源

### G2 — Product Truth Closure
- 修复 CLI help vs extractors
- 修复 harness-surfaces.json 中 openclaw 的支持类别
- 验证所有 truthfulCommand 的真实性

### G3 — High-Leverage Primitives
- 更新 Official MCP Registry metadata (v0.2.0 → v1.8.0)
- 验证/准备 Claude Code plugin
- 准备 Gemini CLI extension
- 验证 Cline PR #49 状态

### G4 — Global Human Web
生成中立 host pages (`/harnesses/*`)

### G5 — Agent-Native Machine Projection
生成 machine surfaces from SSOT

### G6 — Continuous Watch
创建 weekly distribution-watch.yml

### G7 — Measurement Attribution
private usage 增加 hostFamily

### G8 — Bounded Native Presence
MAX_NEW_EXTERNAL_SUBMISSIONS = 3

### G9 — Gates + Final Closure
升级 truth gate, 安全语义零漂移验证

---

## 阻塞点

无当前阻塞，继续执行。

---

## 下一个命令

继续 G1 阶段：创建 distribution-surfaces.json SSOT

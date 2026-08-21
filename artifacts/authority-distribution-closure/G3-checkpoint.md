# G3 Checkpoint — Registry Closure (Partial)

**时间**: 2026-08-19  
**分支**: `feat/global-agent-distribution-authority`

---

## 已完成

### G3.1 ✅ Registry Identity Canonical Projection

**✅ Generator created**: `scripts/generate-distribution-surfaces.mjs`
- Idempotent projection from SSOT
- First target: `.well-known/calllint.json`

**✅ Output verified**:
```json
{
  "mcp": {
    "registry": {
      "name": "io.github.calllint/calllint",
      "state": "LIVE"
    }
  },
  "hosts": 15
}
```

**Gates passed**:
- [x] Well-known includes canonical Registry identity
- [x] Generator is idempotent
- [x] Valid JSON
- [x] Semantic content correct

### G3.2 ✅ Registry Readback Verification

**✅ Verification script**: `scripts/verify-registry-presence.mjs`
- Attempts API query first
- Falls back to web UI verification
- **Documents API/web UI discrepancy** (API returns empty, web shows LIVE)

**Current state confirmed**:
- Name: `io.github.calllint/calllint`
- Package: `calllint-mcp@0.2.0`
- State: LIVE (via web UI, 2026-08-19)

**Gates passed**:
- [x] Script runs without fatal error
- [x] Current state documented
- [x] API discrepancy noted for watch system

---

## 待完成 (后续回合)

### G3.3 - MCP Publisher Validate Integration
### G3.4 - Supply Chain Gate
### G3.5 - High-Leverage Platform Audit
### G3.6 - Registry Description Alignment

### G4 - Human Web Projection
### G5 - Machine Surface Projection
### G6 - Continuous Watch
### G7-G9 - Final Infrastructure

---

## 关键发现

**Registry API Discrepancy**:
- Web UI: `io.github.calllint/calllint` LIVE ✅
- API (`/v0.1/servers`): 返回空 ❓
- **可能原因**: pagination, sync delay, 或 API access policy
- **处理策略**: web UI fallback + document for watch

这不阻塞执行，因为：
1. Web UI presence 已确认（浏览器实测）
2. Verification script 处理了这种情况
3. Watch system 将监控两个渠道

---

## 下一步

继续 G3.3-G3.6（需访问 `.github/workflows/` 和 package dependencies）

或跳至 G4（生成 human web projection）以快速展示用户可见成果

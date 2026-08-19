# Global Agent Distribution Authority — 详细执行计划

**分支**: `feat/global-agent-distribution-authority`  
**原则**: 极度优雅、鲁棒、第一性、充分自检、完美闭环

---

## 执行哲学

### 核心不变量
```
ONE SSOT → ALL PROJECTIONS → ALWAYS SYNCHRONIZED

distribution-surfaces.json (SSOT)
    ↓ (deterministic generation)
    ├─ Human Web (HTML pages)
    ├─ Machine Surfaces (JSON/llms.txt)
    ├─ Documentation (README)
    └─ Infrastructure (sitemap/watch)

任何用户可见表面的变化 = SSOT 变化 → 自动重新生成所有投影
```

### 验证门禁原则
每个 phase 必须通过：
1. **Syntax Gate** - 所有生成的文件格式正确
2. **Semantic Gate** - 内容符合 CallLint claim boundary
3. **Consistency Gate** - 所有投影互相一致
4. **Negative Control** - 不违反任何 GD-* 规则
5. **User-Facing Gate** - 用户可见表面完整且正确

---

## Phase 3: G3 — Registry Closure + High-Leverage Primitives

### G3.1 — Registry Identity Canonical Projection

**Input**:
- ✅ `distribution-surfaces.json` with `officialMcpRegistry` top-level field

**Action**:
1. Create generator: `scripts/generate-distribution-surfaces.mjs`
2. First target: `apps/web/public/.well-known/calllint.json`
3. Add Registry identity to well-known

**Verification**:
```bash
# Syntax
cat apps/web/public/.well-known/calllint.json | jq . > /dev/null

# Semantic
jq '.mcp.registry.name' apps/web/public/.well-known/calllint.json
# Expected: "io.github.calllint/calllint"

# Consistency
jq '.mcp.registry.name' apps/web/public/.well-known/calllint.json == \
  jq '.officialMcpRegistry.name' apps/web/data/distribution-surfaces.json
```

**Output**:
- Generator script (reusable for all projections)
- Updated `.well-known/calllint.json`

**Gate**:
- [ ] Well-known includes canonical Registry identity
- [ ] Generator is idempotent (re-run = no change)

---

### G3.2 — Registry Readback Verification

**Input**:
- Official MCP Registry API

**Action**:
1. Create `scripts/verify-registry-presence.mjs`
2. Query `https://registry.modelcontextprotocol.io/api/.../io.github.calllint/calllint`
3. Assert: name, version, package, status, repository

**Verification**:
```bash
node scripts/verify-registry-presence.mjs
# Expected exit 0 + log current state
```

**Output**:
- Verification script
- Current Registry state snapshot

**Gate**:
- [ ] Script can read Registry API
- [ ] Current state matches expected
- [ ] Script fails loudly on mismatch

---

### G3.3 — MCP Publisher Validate Integration

**Input**:
- `packages/calllint-mcp/server.json`

**Action**:
1. Add `mcp-publisher` to devDependencies (if not present)
2. Update `.github/workflows/publish-mcp.yml`:
   ```yaml
   - run: npx mcp-publisher validate packages/calllint-mcp/server.json
     before: publish
   ```
3. Add local validation script

**Verification**:
```bash
npx mcp-publisher validate packages/calllint-mcp/server.json
# Expected exit 0
```

**Output**:
- Updated workflow
- Local validation command

**Gate**:
- [ ] Validation passes locally
- [ ] Workflow includes validation before publish

---

### G3.4 — Supply Chain Gate (mcp-v* Tag Protection)

**Input**:
- Current repo settings

**Action**:
1. Document required tag protection rules
2. Create verification script
3. Add to distribution watch

**Verification**:
```bash
# Check if tag protection exists
gh api repos/calllint/calllint/tags/protection
```

**Output**:
- Protection recommendation document
- Verification in watch script

**Gate**:
- [ ] Protection requirements documented
- [ ] Verification script exists
- [ ] User notified if protection missing

---

### G3.5 — High-Leverage Platform Audit

**Input**:
- `distribution-surfaces.json` platforms list

**Action**:
1. For each platform with `distributionPrimitives.upstream = "officialMcpRegistry"`:
   - Verify if platform actually consumes Registry
   - Update state: AVAILABLE | AUDIT_REQUIRED | BLOCKED
2. Document findings

**Platforms to audit**:
- Claude Code (plugin vs MCP stdio)
- GitHub Copilot CLI (Registry discovery?)
- Gemini CLI (extension gallery)
- Cline (PR #49 status)
- Qwen Code (conversion from Claude/Gemini)

**Verification**:
Query official docs + live testing where possible

**Output**:
- `artifacts/global-distribution/platform-audit-G3.md`
- Updated `distribution-surfaces.json` states

**Gate**:
- [ ] Each platform state is evidence-backed
- [ ] No guessed/assumed states

---

### G3.6 — Registry Description Alignment (prep for next release)

**Input**:
- Current Registry description
- CallLint claim boundary

**Action**:
1. Draft new description
2. Document as "apply on next calllint-mcp release"
3. Do NOT publish now

**Proposed**:
```
Deterministic static preflight inspection for MCP and agent-tool 
configurations. Shows authority and evidence before execution; 
never executes the server it judges.
```

**Output**:
- `artifacts/global-distribution/next-release-registry-description.txt`

**Gate**:
- [ ] Description aligns with claim boundary
- [ ] Documented for next release
- [ ] Does NOT claim "safety guarantee"

---

## Phase 4: G4 — Global Human Web Projection

### G4.1 — Host Page Template System

**Input**:
- `distribution-surfaces.json`

**Action**:
1. Create page template: `scripts/templates/host-page.hbs` (Handlebars)
2. Template includes:
   - Host identity
   - Authority surfaces
   - Exact commands
   - Distribution primitives
   - Coverage boundary
   - Official sources

**Verification**:
```bash
# Render one page as test
node scripts/generate-host-pages.mjs --host claude-code --dry-run
```

**Output**:
- Template file
- Generator partial

**Gate**:
- [ ] Template renders without error
- [ ] All SSOT fields accessible in template

---

### G4.2 — Generate All Host Pages

**Input**:
- Template + SSOT

**Action**:
1. Generate `/harnesses/<host-id>/index.html` for each host
2. Use existing CallLint web styling
3. Include "powered by SSOT" timestamp

**Verification**:
```bash
# All pages exist
ls apps/web/public/harnesses/*/index.html

# All pages are valid HTML
for f in apps/web/public/harnesses/*/index.html; do
  tidy -q -e "$f" || echo "FAIL: $f"
done
```

**Output**:
- 14 host pages
- Hub page `/harnesses/index.html`

**Gate**:
- [ ] All NATIVE hosts have pages
- [ ] All pages render in browser
- [ ] No broken links
- [ ] Coverage boundaries displayed where exist

---

### G4.3 — Update DeepSeek Intent Hub

**Input**:
- Existing `/harnesses/deepseek/` page

**Action**:
1. Update to clearly state: "Model-intent landing page"
2. Link to canonical host pages
3. Remove any duplicated content

**Verification**:
```bash
# Page exists and links to canonical hosts
grep -q "claude-code" apps/web/public/harnesses/deepseek/index.html
```

**Output**:
- Updated DeepSeek hub

**Gate**:
- [ ] Page states it's not canonical truth root
- [ ] Links to `/harnesses/<host>` canonical pages

---

## Phase 5: G5 — Agent-Native Machine Projection

### G5.1 — Generate agent-surfaces.json

**Input**:
- SSOT

**Action**:
Generate compact machine-readable surface:
```json
{
  "version": "1.0.0",
  "registry": {
    "name": "io.github.calllint/calllint",
    "package": "calllint-mcp",
    "state": "LIVE"
  },
  "hosts": [
    {
      "id": "claude-code",
      "supportClass": "NATIVE",
      "commands": ["calllint scan --agent claude-code"],
      "canonicalUrl": "https://calllint.com/harnesses/claude-code",
      "coverageBoundary": null
    },
    ...
  ]
}
```

**Verification**:
```bash
cat apps/web/public/agent-surfaces.json | jq . > /dev/null
jq '.hosts | length' apps/web/public/agent-surfaces.json
# Expected: 14
```

**Output**:
- `apps/web/public/agent-surfaces.json`

**Gate**:
- [ ] Valid JSON
- [ ] All hosts present
- [ ] Compact (< 10KB)

---

### G5.2 — Regenerate llms.txt / llms-full.txt

**Input**:
- SSOT + current llms.txt structure

**Action**:
1. Update `llms.txt` compact version
2. Update `llms-full.txt` detailed version
3. Ensure Registry identity prominent
4. List all NATIVE agents

**Verification**:
```bash
# Registry mentioned
grep "io.github.calllint" apps/web/public/llms.txt

# All NATIVE agents listed
grep -E "(claude-code|workbuddy|openclaw)" apps/web/public/llms.txt
```

**Output**:
- Updated llms.txt files

**Gate**:
- [ ] Registry identity in llms.txt
- [ ] All NATIVE commands correct
- [ ] Machine index URL present

---

### G5.3 — Update agent-instructions.md

**Input**:
- SSOT

**Action**:
1. Update agent instructions with current hosts
2. Add Registry identity guidance
3. Update harness hub reference

**Verification**:
```bash
grep "io.github.calllint" apps/web/public/agent-instructions.md
```

**Output**:
- Updated agent-instructions.md

**Gate**:
- [ ] Registry identity documented
- [ ] Host list current
- [ ] Links point to new canonical pages

---

### G5.4 — Generate Sitemap

**Input**:
- All generated pages

**Action**:
Generate `apps/web/public/harnesses/sitemap.xml`:
```xml
<urlset>
  <url><loc>https://calllint.com/harnesses/</loc></url>
  <url><loc>https://calllint.com/harnesses/claude-code</loc></url>
  ...
</urlset>
```

**Verification**:
```bash
xmllint --noout apps/web/public/harnesses/sitemap.xml
```

**Output**:
- Sitemap XML

**Gate**:
- [ ] Valid XML
- [ ] All canonical pages listed

---

## Phase 6: G6 — Continuous Distribution Watch

### G6.1 — Create Distribution Watch Workflow

**Input**:
- `scripts/distribution-sources.json` (official source URLs)

**Action**:
1. Create `.github/workflows/distribution-watch.yml`
2. Schedule: weekly (off-hour minute to avoid :00/:30)
3. Check:
   - Official MCP Registry state
   - Cline PR #49
   - Platform official docs (major changes only)

**Verification**:
```bash
# Workflow syntax
gh workflow view distribution-watch

# Test locally
node scripts/distribution-watch.mjs
```

**Output**:
- Watch workflow
- Watch script

**Gate**:
- [ ] Workflow valid
- [ ] Script runs without error
- [ ] No auto-external-writes

---

### G6.2 — Add Registry Health Check

**Input**:
- Registry verification script from G3.2

**Action**:
Integrate into watch:
```javascript
const registryState = await verifyRegistry()
if (registryState.changed) {
  createInternalPR({ evidence: registryState })
}
```

**Verification**:
```bash
# Dry run
node scripts/distribution-watch.mjs --dry-run
```

**Output**:
- Integrated watch

**Gate**:
- [ ] Watch detects Registry changes
- [ ] Never auto-republishes

---

## Phase 7: G7-G9 — Final Infrastructure

### G7 — Measurement Attribution

**Action**:
Add `hostFamily` to telemetry where deterministically known

**Gate**:
- [ ] Privacy-preserving
- [ ] Opt-in only

---

### G8 — Bounded External Writes

**Action**:
Document: MAX_NEW_EXTERNAL_SUBMISSIONS = 3 for this batch

**Gate**:
- [ ] Count external writes
- [ ] Document rationale for each

---

### G9 — Truth Gate v2 + Final Verification

**Input**:
- All generated projections

**Action**:
1. Upgrade `scripts/check-harness-distribution.mjs` → `check-global-distribution.mjs`
2. Verify:
   - SSOT → all projections consistent
   - CLI help == extractors
   - --agent commands real
   - CONFIG_SCAN commands real
   - DISCOVERY_ONLY no fake native
   - Canonical URLs in sitemap
   - Registry identity everywhere
   - No model/vendor in verdict path

**Verification**:
```bash
pnpm check:global-distribution
# Expected exit 0
```

**Output**:
- Truth gate v2
- CI integration

**Gate**:
- [ ] All verifications pass
- [ ] Security semantic unchanged

---

## Final Acceptance Criteria

Before merge:

- [ ] **SSOT exists** - `distribution-surfaces.json` is canonical
- [ ] **All projections generated** - human + machine
- [ ] **User-facing complete** - web pages, llms.txt, agent-instructions, well-known
- [ ] **Registry Tier-0** - identity in all projections
- [ ] **CLI aligned** - help matches reality
- [ ] **Watch enabled** - weekly monitoring
- [ ] **Truth gate passes** - all consistency checks
- [ ] **Security semantic unchanged** - no verdict changes
- [ ] **All negative controls GREEN** - GD-01 through GD-20
- [ ] **Documentation complete** - FINAL_REPORT.md

---

## Execution Cadence

**This session**: G3.1-G3.3 (Registry projection + validation)  
**Next session**: G3.4-G3.6 (supply chain + platform audit)  
**Following**: G4-G5 (human/machine projection generation)  
**Final**: G6-G9 (infrastructure + gates)

Estimate: 3-4 sessions for complete execution + verification.

---

## Rollback Safety

Every phase:
- Commits incrementally
- Tests before next phase
- Can rollback to any checkpoint

If any gate FAILS:
- STOP
- Document failure
- Fix root cause
- Re-run from failed phase

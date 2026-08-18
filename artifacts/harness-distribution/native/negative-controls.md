# H9 Native Presence Negative Controls

## Purpose

Verify that H9 Native Presence Closure respects boundaries and does not violate any of the specified gates.

## Controls

### NP-01: Multiple Marketplace Submissions (Cline)

**Rule:** Do NOT submit to both cline/marketplace and legacy cline/mcp-marketplace.

**Test:** Only one Cline PR exists.

**Result:** ✅ PASS — Only PR #49 to cline/marketplace exists. No legacy submission.

---

### NP-02: Idempotence

**Rule:** Rerun must NOT create duplicate external submissions.

**Test:** Check if pre-existing CallLint PR was found before creating new one.

**Result:** ✅ PASS — Searched for existing PRs/entries before submission. None found. Single submission created.

---

### NP-03: Self-Verified Status

**Rule:** Do NOT set verified=true ourselves.

**Test:** entry.json has verified: false.

**Result:** ✅ PASS — `"verified": false` in entry.json.

---

### NP-04: Fit Gate (CLI vs MCP)

**Rule:** Submit calllint-mcp (the MCP server), NOT calllint CLI.

**Test:** Install command references calllint-mcp.

**Result:** ✅ PASS — Command is `cline mcp install calllint -- npx -y calllint-mcp`.

---

### NP-05: Public Copy Boundary

**Rule:** Do NOT advertise native availability before upstream merge.

**Test:** No public-facing copy claims "CallLint is available in Cline marketplace".

**Result:** ✅ PASS — No public copy updated. Draft PR only. SUBMISSION.md states "draft".

---

### NP-06: Installability Gate

**Rule:** Marketplace install command must complete CallLint MCP smoke test.

**Test:** `npx -y calllint-mcp` passes MCP smoke test.

**Result:** ✅ PASS — `pnpm pack:smoke:mcp` passed with initialize + tools + resources.

---

### NP-07: Source Authority (WorkBuddy)

**Rule:** Do NOT invent/reverse-engineer submission channel if none documented.

**Test:** WorkBuddy state is NO_PUBLIC_CHANNEL with evidence.md only.

**Result:** ✅ PASS — No submission attempt. Evidence.md documents lack of public channel.

---

### NP-08: DeepSeek H6/H9 Deduplication

**Rule:** Do NOT create second DeepSeek PR if H6 already created/prepared one.

**Test:** H6 was not executed; H9 audited fit instead of blindly submitting.

**Result:** ✅ PASS — DeepSeek assessed as NOT_A_FIT. No submission created by H6 or H9.

---

### NP-09: Max Write Limit

**Rule:** External writes must target ≤3 ecosystems.

**Test:** Count distinct ecosystems in external-write-ledger.json.

**Result:** ✅ PASS — 1 ecosystem (Cline). Within limit.

---

### NP-10: One Submission Per Ecosystem

**Rule:** Each ecosystem receives ≤1 submission.

**Test:** Cline has 1 PR. No other ecosystem has multiple submissions.

**Result:** ✅ PASS — 1 PR to Cline, 0 to others.

---

### NP-11: No Spam

**Rule:** Do NOT tag maintainers, request reviews, or create promotional issues.

**Test:** PR is draft, no reviewers requested, no @mentions.

**Result:** ✅ PASS — Draft PR #49 has no reviewer requests, no maintainer tags.

---

### NP-12: Security Orthogonality

**Rule:** Marketplace membership must NOT influence CallLint verdict/evidence.

**Test:** CallLint verdict engine unchanged; no marketplace-aware logic added.

**Result:** ✅ PASS — No code changes to verdict/policy/evidence. Distribution-only change.

---

## Summary

**Total Controls:** 12  
**Passed:** 12  
**Failed:** 0

All negative controls passed. H9 Native Presence Closure compliant.

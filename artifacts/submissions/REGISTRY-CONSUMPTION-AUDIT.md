# Registry-consumption audit — the 13 `mcp-stdio` channels awaiting judgement

- **Measured:** 2026-08-25, read-only GET only (new18 §86).
- **Subject:** the 13 `mcp-stdio` primitives in `AUDIT_REQUIRED`. Evidence gathered by me;
  **the judgement is the user's** — see [ADR 0001](../adr/0001-one-distribution-state-not-six.md)
  and the `state` description in `distribution-surfaces.schema.json`.

## The question, stated precisely

Not "does this host support stdio MCP" — all 17 do, and the schema says so outright:

> that a host documents stdio MCP support is **NOT** the same fact as that host consuming
> the Official MCP Registry.

The question is whether the host **discovers or installs servers from
`registry.modelcontextprotocol.io`**. That is what `state: AVAILABLE` claims, and the schema
records that it "remains an editorial judgement no gate can make."

## Verdict scale

| code | meaning |
|---|---|
| `CONSUMES` | a primary source says servers are discovered/installed from the Official Registry |
| `OWN_SHELF` | the host has its own gallery/marketplace, which is not the Official Registry |
| `NO_EVIDENCE` | primary source documents only hand-written stdio config |

## Findings

| host | verdict | primary source read | what it actually says |
|---|---|---|---|
| `cursor` | `NO_EVIDENCE` | `docs.cursor.com/context/mcp` (330 KB, 4× "mcp") | **0 occurrences of "registry"** |
| `vscode` | `OWN_SHELF` | `code.visualstudio.com/docs/copilot/chat/mcp-servers` | "install an MCP server from the **MCP server gallery**", browsed via `@mcp` in the Extensions view. Gallery source never named as the Official Registry |
| `windsurf` | `OWN_SHELF` | `docs.windsurf.com/windsurf/cascade/mcp` | default is the **"Devin Desktop MCP marketplace"**. Custom registry URLs *replace* it for enterprises. "Custom registries must follow the official MCP registry **schema**" — a format requirement, not consumption |
| `kiro` | `OWN_SHELF` | `kiro.dev/docs/mcp/registry` | its "MCP registry" is **enterprise-private**: IAM Identity Center, admin allowlist, Pro-tier. Same word, different subject |
| `gemini-cli` | `OWN_SHELF` | `geminicli.com/docs/extensions/` | "Gemini CLI **extension gallery**" with its own "Publish to the gallery" path |
| `codex` | `NO_EVIDENCE` | `developers.openai.com/codex/extend/mcp` | only match for "registry" is the page's own JS (`window.customElements`) |
| `continue` | `NO_EVIDENCE` | `docs.continue.dev/customize/deep-dives/mcp` | links to modelcontextprotocol.io **docs/quickstart**; instructs users to hand-write a server block |
| `openclaw` | `NO_EVIDENCE` | `openclaw/openclaw@main/README.md` (111 KB) | **0 occurrences of "mcp"** and of "registry" |
| `qwen-code` | `NO_EVIDENCE` | `QwenLM/Qwen-Code@main/README.md` (9.8 KB, 2× "mcp") | 0 occurrences of "registry" |
| `deepseek-harness` | `NO_EVIDENCE` | `deepseek-ai/deepseek-harness@master/README.md` (2 KB) | 0 occurrences of "mcp" or "registry" |
| `codebuddy` | `NO_EVIDENCE` | `cloud.tencent.com/product/codebuddy` (29 KB) | 0 occurrences of "mcp" or "registry" |
| `opencode` | `NO_EVIDENCE` | `opencode.ai/docs/mcp-servers/` (127 KB, 247× "mcp") | 0 occurrences of "registry" — re-measured 2026-08-26 on the corrected URL |
| `workbuddy` | `NO_EVIDENCE` | `cloud.tencent.com/product/workbuddy` (40 KB) | 0 occurrences of "mcp" or "registry" — re-measured 2026-08-26 on the corrected URL |

**0 of 13 reach `CONSUMES`.** Nothing here supports moving any channel to `AVAILABLE`.

## Instrument validation (why the zeros are findings, not failures)

A zero count is worthless unless the fetch worked — this repo's dominant fault class is a
guard that cannot observe its subject. Every `NO_EVIDENCE` above was checked with a control
term that must appear if the page is real:

- `cursor`: 330 KB, title `Cursor Docs — Agent, Rules, MCP, Skills & CLI`, 4× "mcp" → real page, "registry" genuinely absent.
- `openclaw`: 111 KB, README begins `# OpenClaw 🦞` → real content; 0× "mcp" is a fact about the README.
- `qwen-code`: 2× "mcp" → fetch succeeded, "registry" genuinely absent.
- Three fetches initially returned 404 and were **not** recorded as zero-evidence until the cause was
  established: `deepseek-harness` was a branch-name error (`master`, not `main`) and re-fetched
  successfully; the other two are genuinely dead URLs, recorded as defects rather than as findings.
- `opencode` and `workbuddy` were re-measured on 2026-08-26 after their URLs were fixed (below).
  `opencode`: 127 KB, title `MCP servers | OpenCode`, **247× "mcp"** → the page is not merely
  real, it is *about* MCP, which makes 0× "registry" a strong absence rather than a weak one.
  `workbuddy`: 40 KB, title `WorkBuddy` → fetch succeeded; 0× "mcp" is a fact about a Chinese
  product landing page that does not discuss MCP at all. Both were controlled against a
  known-nonexistent sibling on the same host (`opencode.ai/docs/nonexistent-control-sibling/`
  → 404 / 117 bytes), so a 200 with a real title is distinguishable from a catch-all.

## Two defects found while measuring — FIXED 2026-08-26, after this audit

Both were in `officialSources`, i.e. the watch list `check-official-sources.mjs` reads. Neither
was in scope for a registry-consumption audit, so neither was touched *at the time*:

1. **`opencode`** — `https://github.com/opencode/opencode` is 404 at the repo API level. The
   SSOT names a repository that does not exist, so the watcher has been polling a dead URL.
2. **`workbuddy`** — `https://github.com/TencentCloud/workbuddy` is likewise 404.

A source that 404s cannot fail loudly in a watcher that only looks for *changes*, which is why
this surfaced from an unrelated audit rather than from the gate that owns those URLs.

**Both are now repaired in the SSOT** (2026-08-26), along with two more of the same kind that
this audit did not reach — `claude-code` and `codebuddy`. The verdict table above is left as
measured for the rows whose pages were real; the two rows that rested on a 404 have been
**re-measured on the corrected URLs** and now carry real evidence (see the row notes and the
instrument-validation entry above). `codebuddy`'s original row stands on its own terms: its
29 KB page was real and 0× "mcp" is a fact about it, but the URL that served it has since gone
404, so the row's source column names a page that no longer answers; the replacement
(`product/acc`, 56 KB, 2× "mcp", 0× "registry") does not change the verdict.

**All four corrections are link repairs, not verdict changes.** No channel moves out of
`AUDIT_REQUIRED` as a result, and `0 of 13 reach CONSUMES` still holds.

## What the user decides

For each row: accept the verdict, or overrule it with a source I did not read. Only a
`CONSUMES` verdict justifies `state: AVAILABLE`, and `OWN_SHELF` is worth separating from
`NO_EVIDENCE` because it names a *different* channel that could be pursued (a gallery
submission), rather than an absent one.

If every verdict stands, the honest outcome is that these 13 stay `AUDIT_REQUIRED` and the
`auditNote` on each becomes measured rather than presumed — the notes already said
"not confirmed"; this audit is the confirmation that they are not confirmable from primary
sources today.

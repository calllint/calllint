# Public surface roles

This matrix pins what each public-facing asset is responsible for, and what it
must not duplicate — so the website, README, agent-readable docs, limitations,
corpus, demo repo, and project status stay consistent instead of drifting.

The single source of truth for version, install command, and corpus numbers is
[`docs/project-facts.json`](./project-facts.json). The
`pnpm check:public-copy` guard enforces the rules below at CI time.

## Asset responsibilities

| Asset | Primary job | Must not do |
|---|---|---|
| Website (`apps/web/public/index.html`) | Tell the value, trust, and try-it path in 60 seconds | Not a full threat model; not a full detector reference |
| `README.md` | Open-source quickstart + technical overview | Not long-form marketing; not a safety certificate |
| `LIMITATIONS.md` | State the trust boundaries explicitly | No sales copy; no overclaim |
| `SECURITY.md` | Document CallLint's own security model | Not product positioning |
| `docs/CORPUS.md` | Corpus methodology and evidence | No claim of full MCP ecosystem coverage |
| Demo repo (`calllint-demo-risky-mcp`) | Runnable proof: SARIF in Code Scanning, no server executed | No claim of runtime safety or third-party safety |
| `PROJECT_STATUS.md` | Current state — the human-readable facts source | Not user education; not marketing |
| `docs/project-facts.json` | Machine-readable facts source for public copy | No prose; no claims beyond verifiable facts |
| `apps/web/public/agent-instructions.md` | Let coding agents recommend CallLint accurately | No overclaim; no "proves safe" |
| `apps/web/public/llms.txt` | Agent-readable entry point with stable commands | No marketing language; no exaggeration |

## Sync rules (enforced by `pnpm check:public-copy`)

- No primary install path uses `npx calllint@preview scan`. `@preview` belongs
  only in release-channel / advanced notes.
- No public copy contains absolute safety claims — including phrases such as
  "100% safe", "guaranteed safe", "certified safe", "proves a server is safe",
  "proves safety", "complete MCP protection", "secure all agent tools",
  "AI-powered security scanner", or "complete MCP security solution". (These
  are listed in `project-facts.json` `forbiddenPhrases`; the guard matches them
  case-insensitively, so do not quote them verbatim inside public copy — not
  even in a "do not say" list.)
- Every public surface together contains, at least once:
  `No blockers observed`, `Not a proof of runtime safety`,
  `Never executes the server it judges`, `UNKNOWN is never SAFE`,
  `Heuristic decision support`.
- The website corpus section's case count, real/redacted count, and UNKNOWN
  ratio match `docs/project-facts.json` exactly.
- The website corpus section reflects the current corpus phase tag
  (`R2.2 · ` or whatever `project-facts.json` declares).

## Where `@preview` is allowed

Release channels · advanced install · preview builds · changelog.
Never in: hero · get-started · install & scan · demo repo main command ·
README quickstart · CI copy-paste snippet.

## Change protocol

When the corpus grows, the stable version moves, or a claim changes:

1. Update `docs/project-facts.json` first.
2. Run `pnpm check:public-copy`. It will fail and name the exact mismatches.
3. Update the website, README, and agent-readable docs to match the facts file.
4. Re-run `pnpm check:public-copy` until green.
5. Run `pnpm typecheck && pnpm test` to confirm no scanner regression.

This is the structural answer to the "public preview / 30 calibrated cases"
drift class: the facts file is the only place numbers live, and the guard makes
silent drift fail CI.

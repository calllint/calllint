# ADR 0016: docker `-e KEY=value` / `-e KEY` env keys are not extracted for secrets (C049)

Status: Proposed — deferred (recorded 2026-06-25; no code change yet)

## Context

While harvesting real configs for the R2.2 corpus, scanning the Google Drive MCP
docker config surfaced a gap, now anchored as corpus case
**C049-safe-gdrive-docker-volume-creds**.

`detectSecretEnvKeys` (`packages/static-analyzer/src/detectors/secretEnvKeys.ts`)
reads `server.envKeys` — the keys of the config's `env` block — and flags any whose
name matches a credential hint (TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL/AUTH/SESSION).
It does **not** read environment variables passed to a container via docker
`-e KEY=value` / `-e KEY` / `--env KEY` arguments. Those keys live in `server.args`,
which the secret detector never inspects.

Reproduced on the current engine:

| input | verdict |
|-------|---------|
| `{"command":"npx","env":{"MY_API_KEY":"…"}}` | REVIEW (`secrets.env-key`) |
| `{"command":"docker","args":["run","-e","MY_API_KEY=sk-secret","mcp/x"]}` | **SAFE** (no finding) |

The second form passes a credential-named variable straight into the container, but
because it is a docker argument rather than an `env` block key, `secrets.env-key`
does not fire. C049 is a real instance: `-e GDRIVE_CREDENTIALS_PATH=…` inline, with
no `env` block, resolves SAFE.

This is the **secrets-detector analogue of ADR 0012** (which fixed the same class of
gap for docker `--mount` host *paths* in the broad-path detector). The broad-path
detector now reads docker bind sources; the secret detector does not yet read docker
`-e` env keys.

## Why this is NOT a dangerous false-SAFE

`secrets.env-key` is a **non-blocker** (medium, REVIEW). The gap means a config that
*should* be REVIEW can read SAFE — an under-call of a sensitive-read signal, not a
hidden BLOCK-class source. It is strictly less severe than the C023/ADR-0012 case
(which was a missed *blocker*). Most real upstream docker configs that use `-e KEY`
also declare the matching `env` block (e.g. C017/C018/C029/C042), so the secret is
still flagged via the env-block path; the gap only bites the `-e KEY=value`
inline-only shape (no `env` block), as in C049.

It is recorded here, on the case, not hidden — exactly as the C023 false negative was
before ADR 0012 was accepted.

## Decision (proposed — NOT yet accepted)

Record the gap and its exact mechanism; do not change the detector yet. The
candidate fix, when scheduled:

- Teach `detectSecretEnvKeys` (or a shared docker-arg pre-pass, reusing the same
  arg-walking shape as the ADR 0012 host-path extractor) to extract env-var **keys**
  from docker `-e KEY[=value]`, `--env KEY[=value]` arguments (never `--env-file`,
  which names a file, not a key), and run the same credential-name match on them.
- **Dedup against the `env` block**: a key present in both `-e GITHUB_TOKEN` and
  `env.GITHUB_TOKEN` must produce one finding with one evidence entry, not two
  (C017/C018/C029/C042 must keep their exact current finding shape).
- Never surface env **values** (the existing detector reports key names only); the
  `-e KEY=value` value must not be echoed into evidence.

## Why deferred

Adding docker `-e` key extraction is a new detection surface ("stable fixes bugs; it
does not widen surface") and a verdict-behaviour change (some SAFE → REVIEW), so per
CLAUDE.md it needs positive + negative fixtures, a unit test, and a corpus impact
pass before landing. The blast radius spans every docker-`-e` case
(C013/C017/C018/C029/C042/C049/C050) and must be re-verified — C013
(`-e DOCKER_CONTAINER=true`, not credential-shaped) must stay SAFE; the env-block
cases must keep exactly one finding per key. That is a deliberate detector-calibration
cycle, not a harvest-time tweak.

## Consequences / required work (none done yet)

If accepted:

- docker `-e`/`--env` key extraction in the secret detector path, with a **positive**
  fixture (`-e API_KEY=… `, no env block → REVIEW), a **negative** fixture
  (`-e DOCKER_CONTAINER=true` → SAFE), and a unit test incl. the env-block dedup.
- Corpus impact pass: **C049 flips SAFE → REVIEW** (its `GDRIVE_CREDENTIALS_PATH`
  name matches `CREDENTIAL`); its contract, notes, and `index.json` updated;
  `R2_CALIBRATION.md` regenerated; re-run `pnpm test`, `pnpm typecheck`,
  `corpus:test:r2-final`. Verify no regression on C013/C017/C018/C029/C042/C050.

Until then C049 remains SAFE with the gap documented on the case.

## Related

- ADR 0012 (the broad-path analogue: docker `--mount` host paths, now extracted).
- Corpus case `C049-safe-gdrive-docker-volume-creds` (the anchor).
- `packages/static-analyzer/src/detectors/secretEnvKeys.ts` (reads `envKeys`, not args).

# ADR 0016: Extract docker inline `-e`/`--env` keys in the secret detector (S8)

Status: **Accepted** (recorded 2026-07-01, implemented same day). The
secrets-detector analogue of ADR 0012 (docker bind-mount host-path extraction).

## Context

`detectSecretEnvKeys` (`packages/static-analyzer/src/detectors/secretEnvKeys.ts`)
flags credential-shaped environment keys (`TOKEN`, `SECRET`, `API_KEY`,
`CREDENTIAL`, `AUTH`, …). It read **only** the parsed `env` block
(`server.envKeys`, populated by `normalizeMcpServers` from `Object.keys(env)`).

Docker MCP servers commonly pass credentials **inline as arguments** —
`docker run -e GITHUB_PERSONAL_ACCESS_TOKEN …` or
`-e GDRIVE_CREDENTIALS_PATH=/path` — not in an `env` block. Those keys never
reach `server.envKeys`, so a credential-named variable passed inline via `-e`
with no `env` block was **invisible** to the detector. This is a non-blocker
(REVIEW-class) **under-call**, the exact secrets-side mirror of the host-path
gap that ADR 0012 closed for `files.broad-path`. It was recorded as Deferred in
the 0.4.0 CHANGELOG and anchored by corpus case **C049**.

### What was verified (not assumed), before the fix

- C049 (`-e GDRIVE_CREDENTIALS_PATH=…`, **no** env block) → SAFE.
- The **same key in an `env` block** → REVIEW (`secrets.env-key`).
- So the SAFE was the docker-`-e` extraction gap, **not** "the name isn't
  credential-shaped" (it is — it contains `CREDENTIAL`).

## Decision

Extend `detectSecretEnvKeys` to also read docker inline env keys, gated on
`command === "docker"` and extracted **inside the detector** (not the parser),
exactly as ADR 0012 extracts host paths inside `detectBroadFilesystemPath`. The
config parser and `server.envKeys` are unchanged, so **only this detector's
output changes** — no other detector, and no schema, is touched.

1. **Extractor.** `extractDockerEnvKeys(args)` collects the KEY from `-e KEY`,
   `-e KEY=value`, `--env KEY`, `--env=KEY=value`. Only the KEY is used (the
   value, if inline, is never read or emitted). `--env-file` is intentionally
   **ignored** — CallLint does not read files here.

2. **Same shape check.** Extracted keys run through the identical `looksSecret`
   substring check. `GDRIVE_CREDENTIALS_PATH` matches `CREDENTIAL` → flagged.
   `DOCKER_CONTAINER` (C013) matches nothing → not flagged. There is **no
   `*_PATH` exclusion**: the detector keys on credential SHAPE, by design (a
   `*_PATH` var can still name a credential file). This is consistent with the
   existing env-block behavior and with C049's pre-recorded expectation.

3. **Dedupe.** A key present in both the `env` block and a `-e` arg is reported
   once (env-block evidence wins). Evidence for an inline key uses `key: "args"`
   to distinguish it from `key: "env"`.

### Verdict impact (deliberate, safe-direction, ADR-gated)

The only corpus/golden case that changes verdict is **C049: SAFE → REVIEW**,
pre-authorized in that case's own `source.json`/`notes.md` before this ADR.
Proven-minimal blast radius:

- C013 (`-e DOCKER_CONTAINER=true`, no env block, SAFE) — no secret hint → stays SAFE.
- C017 / C018 / C029 / C042 / C050 (docker `-e` **and** an `env` block, already
  REVIEW) — `secrets.env-key` already fires from the env block; the inline key is
  deduped → unchanged.
- Golden `safe-docker-env-flag.json` — not in the golden verdict contract; asserted
  only for the *exec* detector returning `[]` (that assertion is unaffected).

`C049.thisCaseMustNeverBeSafe` stays **false**: the source is observable and the
missed signal is a non-blocker, so this was never a *dangerous* false-SAFE — an
under-call being tightened, never a fixture weakened (the corpus floor ratchets
up: 0 dangerous false-SAFE unchanged, UNKNOWN 10.0% unchanged).

## Why this needs an ADR

Per CLAUDE.md, a detector change that alters a golden/corpus expected verdict is
deliberate calibration and must be ADR-gated with positive + negative fixtures and
a unit test. It ships with:

- unit tests in `detectors.test.ts` (positive: `-e API_KEY=…` on a docker command
  flags SECRETS from `args`; negative: `-e DOCKER_CONTAINER=true` does not),
- the C049 re-verdict (SAFE → REVIEW) with case dir renamed
  `C049-safe-…` → `C049-review-…`, `expected.calllint.json` / `index.json` /
  `source.json` / `notes.md` all updated in lockstep,
- a `CHANGELOG.md` entry moving ADR 0016 from Deferred to Changed.

## Alternatives considered

- **(a) Extract `-e` keys in the config parser into `server.envKeys`.** Rejected:
  it would change input seen by *every* detector and blur the env-block vs
  inline-arg distinction. Extracting inside the one detector that cares keeps the
  change surgical (same rationale as ADR 0012).
- **(b) Add a `*_PATH`/`*_FILE` exclusion to suppress `GDRIVE_CREDENTIALS_PATH`.**
  Rejected: a path-named variable can still name a credential file; excluding it
  would be a deliberate under-call, and C049's recorded expectation is REVIEW.
- **(c) Leave deferred.** Rejected: it is a real, reproducible under-call on
  common docker configs, and the calibration was already settled on C049.

## Related

- ADR 0012 (docker bind-mount host-path extraction — the `files.broad-path`
  analogue this mirrors).
- ADR 0002 (verdict semantics — `secrets.env-key` is a non-blocker REVIEW signal,
  never SAFE-downgrading).
- Corpus case C049 (the anchor; SAFE → REVIEW under this ADR).
- Master plan S8.

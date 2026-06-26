# ADR 0012: docker `--mount`/`-v` host paths — now inspected for broad access (C023)

Status: Accepted (recorded 2026-06-23 as Proposed — deferred; **accepted and implemented 2026-06-25**)

> **Resolution (2026-06-25):** the gap described below is now closed. The
> Context/mechanism sections are kept in the past tense of "what was true before
> the fix" so the decision is auditable; see **Decision** and **Consequences** for
> what shipped. C023 is now **BLOCK** (`C023-block-filesystem-docker-mount`).

## Context (the gap as it stood before the fix)

Corpus case **C023** (then `C023-safe-filesystem-docker-mount`, a real
`modelcontextprotocol/servers` filesystem-over-docker README config) **was SAFE**,
and this **was** a documented **false negative**: the config binds broad host paths
into the container via docker bind-mounts that the broad-path detector did not read.

The input (verbatim upstream docs):

```json
{ "mcpServers": { "filesystem": { "command": "docker", "args": [
  "run","-i","--rm",
  "--mount","type=bind,src=/Users/username/Desktop,dst=/projects/Desktop",
  "--mount","type=bind,src=/path/to/other/allowed/dir,dst=/projects/other/allowed/dir,ro",
  "mcp/filesystem","/projects"
]}}}
```

The broad-path detector
(`packages/static-analyzer/src/detectors/broadFilesystemPath.ts:54-55`) iterates
`server.args` and matches each arg **as a whole** against broad roots
(`looksLikeBroadPath`, lines 32-44: `arg === p` or `arg.startsWith(p + "/")`).

The broad host path here is `/Users/username/Desktop`, but it sits **inside** a
compound argument — `type=bind,src=/Users/username/Desktop,dst=/projects/Desktop`.
That whole string neither equals nor starts with a broad root (the broad path is a
substring after `src=`), so `looksLikeBroadPath` returns false. The server's own
positional arg is `/projects` — a container-internal path, correctly not broad.
The detector never parses docker `--mount type=bind,src=...` or `-v src:dst`
components, so the host side of the bind is invisible. Verdict: SAFE.

A user reading the report sees "no blockers," while the container in fact has the
host's `~/Desktop` bound in.

## Why this was not "fixed" at calibration time

This was found during R2.1 calibration and **recorded on the case** rather than
patched (see `R2_CALIBRATION.md` → "A documented false negative"). The reasoning:
docker arg parsing is a non-trivial surface (`--mount` k=v CSV, `-v src:dst:opts`,
`--volume`, env-var interpolation in paths, named volumes vs bind mounts), and a
half-built parser risks both new false positives (flagging named volumes or
container-internal `dst`) and a false sense of completeness. It deserves its own
detector pass, not an inline tweak.

## Decision (accepted — implemented 2026-06-25)

Record the gap and its exact mechanism, then close it. The implemented fix:

- The filesystem analyzer now extracts **host-side** paths from
  `--mount type=bind,src=<host>,...`, `-v <host>:<container>[:opts]`, and
  `--volume` forms (in `broadFilesystemPath.ts`, gated on `command === "docker"`),
  and runs `looksLikeBroadPath` against the extracted `src`/host component only
  (never the container `dst`).
- Existing true-negatives are preserved: named volumes (`src=myvolume` /
  `myvolume:/container`, no leading `/`), container-internal paths, image refs,
  and workspace-scoped sources (`${workspaceFolder}`) stay SAFE.

The same `files.broad-path` finding id is reused (no new id, no policy-key change)
— this is the minimal safe-direction expansion: it only adds findings the tool
previously missed.

## Why it was deferred (until 2026-06-25)

Adding host-path extraction is a **new detection surface** ("stable fixes bugs; it
does not widen surface" — ROADMAP non-goals; R4-adjacent). It is a verdict-behaviour
change for docker-bind configs (some SAFE → BLOCK), so per CLAUDE.md it needs
positive + negative fixtures, a unit test, and a corpus impact pass before landing.
It is safe-direction (it only adds findings the tool currently misses), but it is
still a `ScanReport` change recorded here per the "breaking change requires an ADR"
rule.

## Consequences / required work — DONE (2026-06-25)

Implemented:

- Docker bind-mount host-path extraction in the filesystem detector
  (`packages/static-analyzer/src/detectors/broadFilesystemPath.ts`:
  `extractDockerHostPaths` + `looksLikeHostPath` + `dockerVolumeHostSide`), with a
  **positive** fixture (`golden/block-docker-bind-broad.json`: broad `src=` bind →
  BLOCK), a **negative** fixture (`golden/safe-docker-volume-scoped.json`: named
  volume + `${workspaceFolder}` bind → SAFE), and unit tests in
  `packages/static-analyzer/test/detectors.test.ts` (positive asserts the evidence
  value is the host path, not the container dst; negative asserts no finding).
- Corpus impact pass: **C023 flipped SAFE → BLOCK** (dir renamed
  `C023-safe-…` → `C023-block-filesystem-docker-mount`); its `humanExpectation`,
  `knownLimitations`, `expected.calllint.json` (now requires `files.broad-path`,
  `thisCaseMustNeverBeSafe: true`), `notes.md`, and the `index.json` entry are
  updated. `R2_CALIBRATION.md` regenerated. `pnpm test`, `pnpm typecheck`,
  `corpus:test:r2-final` all green.
- No regression on the other docker cases: **C011/C012/C013/C024** (named volumes /
  scoped mounts / connection strings) re-verified **SAFE** via the CLI.

## Reason

The honest report today says "the broad-path detector reads the server's own path
args, not docker `--mount src=` host paths." Recording that as an explicit,
mechanism-level ADR (rather than only a one-line calibration note) makes the gap a
tracked decision with a clear acceptance path, and prevents a future contributor
from "fixing" it ad hoc without the fixtures and corpus pass the contract requires.

## Related

- Corpus case `C023-block-filesystem-docker-mount` (the anchor, now BLOCK).
- `docs/R2_CALIBRATION.md` → "A documented false negative".
- ADR 0011 (a sibling documented-limitation calibration question).
- Detector: `packages/static-analyzer/src/detectors/broadFilesystemPath.ts`.

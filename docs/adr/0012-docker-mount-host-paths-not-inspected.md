# ADR 0012: docker `--mount`/`-v` host paths are not inspected for broad access (C023)

Status: Proposed — deferred (recorded 2026-06-23; no code change yet)

## Context

Corpus case **C023-safe-filesystem-docker-mount** (a real
`modelcontextprotocol/servers` filesystem-over-docker README config) is **SAFE**,
and this is a documented **false negative**: the config binds broad host paths into
the container via docker bind-mounts that the broad-path detector does not read.

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

## Decision (proposed — NOT yet accepted)

Record the gap and its exact mechanism; do not change the detector yet. The
candidate fix, when scheduled:

- Teach the filesystem analyzer (or a docker-arg pre-pass) to extract **host-side**
  paths from `--mount type=bind,src=<host>,...`, `-v <host>:<container>[:opts]`, and
  `--volume` forms, and run `looksLikeBroadPath` against the extracted `src`/host
  component only (never the container `dst`).
- Preserve existing true-negatives: named volumes (`src=myvolume` with no leading
  `/`), container-internal paths, and workspace-scoped sources must stay SAFE.

This ADR fixes the scope and the contract; it does not implement the parser.

## Why deferred

Adding host-path extraction is a **new detection surface** ("stable fixes bugs; it
does not widen surface" — ROADMAP non-goals; R4-adjacent). It is a verdict-behaviour
change for docker-bind configs (some SAFE → BLOCK), so per CLAUDE.md it needs
positive + negative fixtures, a unit test, and a corpus impact pass before landing.
It is safe-direction (it only adds findings the tool currently misses), but it is
still a `ScanReport` change recorded here per the "breaking change requires an ADR"
rule.

## Consequences / required work (none done yet)

If accepted:

- Docker bind-mount host-path extraction in the filesystem detector path, with a
  **positive** fixture (broad `src=` bind → BLOCK), a **negative** fixture (named
  volume / container-internal `dst` / workspace-scoped src → SAFE), and a unit test.
- Corpus impact pass: C023 flips SAFE → BLOCK; its `humanExpectation`,
  `knownLimitations`, and `expected.calllint.json` are updated; `R2_CALIBRATION.md`
  regenerated; re-run `pnpm test`, `pnpm typecheck`, `corpus:test:r2-final`.
- Verify no regression on the other docker cases (C011/C012/C013/C024) that
  correctly use scoped mounts/volumes and must stay SAFE.

Until then C023 remains SAFE with the false negative documented on the case.

## Reason

The honest report today says "the broad-path detector reads the server's own path
args, not docker `--mount src=` host paths." Recording that as an explicit,
mechanism-level ADR (rather than only a one-line calibration note) makes the gap a
tracked decision with a clear acceptance path, and prevents a future contributor
from "fixing" it ad hoc without the fixtures and corpus pass the contract requires.

## Related

- Corpus case `C023-safe-filesystem-docker-mount` (the anchor false-negative).
- `docs/R2_CALIBRATION.md` → "A documented false negative".
- ADR 0011 (a sibling documented-limitation calibration question).
- Detector: `packages/static-analyzer/src/detectors/broadFilesystemPath.ts`.

# C055 — Docker -v broad host bind (BLOCK; locks the ADR 0012 -v branch)

## What this is

A synthetic contract seed locking the docker **`-v` branch** of the ADR 0012
host-path extractor at the corpus gate. C023 locks the `--mount type=bind,src=`
form; this locks the colon-separated `-v host:container[:opts]` form:

```
docker run -i --rm -v /etc:/data:ro mcp/filesystem /data
```

## Verdict: BLOCK

The ADR 0012 extractor splits the host side (`/etc`) from the container dst
(`/data`) and the `:ro` option; `/etc` is a broad root → `files.broad-path`
(critical blocker) → BLOCK. `thisCaseMustNeverBeSafe: true`.

## Why this case is high-value (not filler)

`/etc:/data:ro` is **not** caught by the plain-arg loop — that loop checks
`startsWith("/etc/")`, and the arg is `/etc:` (colon, not slash). So **only** the
docker `-v` extractor + `dockerVolumeHostSide` colon-split can flag it. The case
therefore proves the `-v` branch is doing real work — a coverage gap the unit tests
fill in source, now also locked end-to-end through the CLI at the corpus gate. The
evidence value is the extracted host path `/etc`, never the container dst `/data`.

## Why synthetic

A minimal, unambiguous `-v` broad-bind shape; no provenance needed.

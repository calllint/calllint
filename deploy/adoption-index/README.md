# Adoption-index worker (systemd)

Two units that run the nightly ingest for the Canonical Adoption Index on the shared Aliyun host,
per ADR 0061 §8.

| File | What it is |
| --- | --- |
| `calllint-adoption-worker.service` | `Type=oneshot`, three `ExecStart` steps, resource-capped |
| `calllint-adoption-worker.timer` | daily at **02:30 UTC** (10:30 Asia/Shanghai), `Persistent=true` |

## What the three steps are, and why the middle one matters

```
1. pnpm ingest:trust-index                    mirror the registry, resolve artifacts (R-4),
                                              compile evidence (R-5)  → writes .var/
2. pnpm project-adoption-index:trust-index    project the identity plane FROM THE COMMITTED
                                              SNAPSHOT → packages/trust-index/snapshots/
3. pnpm prune:cas                             delete CAS blobs older than CAS_RETENTION_DAYS
```

**Step 2 must never become `project-adoption-index:trust-index:store`.** That is the store-reading
variant `.github/workflows/trust-ingest.yml` runs, and it is correct *there* only because an Actions
runner has a cold `.var/` on every run. On this host `.var/` persists, and the store-first path was
measured committing **298 subjects where the snapshot derives 19**
(`packages/trust-index/src/projectAdoptionIndex.ts:29-33`). ADR 0061 §8.1 records the choice as
option A: committed bytes are always projected with `--from-snapshot`.

`TRUST_INGEST_ARTIFACTS` / `TRUST_INGEST_EVIDENCE` are intentionally **not** set. Both default on;
turning them off would leave `artifacts` and `evidence_records` empty forever, which is the exact
shipped-not-wired shape R-4 and R-5 were built to close.

## Install

```bash
# 0. Prerequisites: Node 20+, pnpm via corepack, repo cloned to /opt/calllint,
#    dependencies installed (`pnpm install --frozen-lockfile`).
sudo useradd -r -s /usr/sbin/nologin calllint
sudo chown -R calllint:calllint /opt/calllint

# 1. Fix the pnpm path. The units ship with /usr/bin/pnpm; corepack usually puts it elsewhere.
which pnpm            # e.g. /usr/local/bin/pnpm or ~/.local/share/pnpm/pnpm
#    Edit all three ExecStart lines, or symlink:  sudo ln -s "$(which pnpm)" /usr/bin/pnpm

# 2. Install and enable.
sudo cp calllint-adoption-worker.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now calllint-adoption-worker.timer
```

## Verify

```bash
systemctl list-timers calllint-adoption-worker.timer   # next trigger
sudo systemctl start calllint-adoption-worker.service  # run once, now
journalctl -u calllint-adoption-worker.service -n 80 --no-pager
```

A successful run ends with `prune:cas` reporting `failed 0`. `prune:cas` exits non-zero if any blob
could not be deleted, so a partial sweep shows up as a unit failure rather than a quiet log line.

## Retention

`CAS_RETENTION_DAYS=90` in the service file. The CAS is write-once and nothing else ever removed a
blob (ADR 0061 §8.4), so this sweep is the only bound on its growth. Override per-host without
editing the shipped unit:

```bash
sudo systemctl edit calllint-adoption-worker.service
# [Service]
# Environment="CAS_RETENTION_DAYS=30"
```

Non-integer, zero, and negative values are refused rather than coerced — `parseInt` would read
`"-1"` as a negative window and delete the entire CAS, including the blobs the run just wrote.

An absent blob tree is an error, not a clean zero: the sweep exits non-zero rather than reporting
`inspected 0`, so a root that points at the wrong directory cannot read as "nothing to prune"
forever. In normal operation the tree always exists by the time step 3 runs — step 1 creates every
index directory unconditionally, before any of its own feature switches
(`refreshSnapshot.ts:278`) — so this fires only on a genuine misconfiguration.

**Do not set `ADOPTION_INDEX_CWD` in the unit.** The steps do not share root-resolution logic: step 1
reads a bare `process.cwd()`, while the sweep reads `ADOPTION_INDEX_CWD ?? process.cwd()`. Setting it
therefore moves *only* the sweep, which would then delete from a tree the ingest step never writes
to — and because that decoy directory exists, the loud-on-absence check above cannot catch it. The
run would report healthy `inspected`/`deleted` counts while the real CAS kept growing.
`WorkingDirectory=` is the one lever that moves all three steps together; a machine gate
(`tests/invariants/worker-deployment-unit.invariants.test.ts`) keeps this variable out of the unit.

## Resource caps and the co-tenant

`MemoryMax=1G`, `CPUQuota=50%`, `TasksMax=256`, `IOWeight=100` (ADR 0061 §8.3). LORDL runs on the
same host and stays running — that was decided on measured footprint, not courtesy. Nothing in
these units reads, copies, or references any path outside CallLint's own tree, and
`ProtectSystem=strict` + `ProtectHome=true` enforce it at the OS level: only `/opt/calllint/.var`
and `/opt/calllint/packages/trust-index/snapshots` are writable.

## Committing the result

These units do **not** push. They leave the refreshed snapshots in the working tree; the Actions
workflow remains the path that opens a PR. If this host should also commit, that is a separate
decision with its own credentials question — not something to bolt onto `ExecStart`.

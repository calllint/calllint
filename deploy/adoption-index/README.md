# Adoption-index worker (systemd)

Four units on the shared Aliyun host, per ADR 0061 §8: an ingest pair (§8.5) and a backup pair
(§8.6). The two pairs are deliberately separate — see [Why the backup is its own
unit](#why-the-backup-is-its-own-unit-and-not-a-fourth-execstart).

| File | What it is |
| --- | --- |
| `calllint-adoption-worker.service` | `Type=oneshot`, three `ExecStart` steps, resource-capped |
| `calllint-adoption-worker.timer` | daily at **02:30 UTC** (10:30 Asia/Shanghai), `Persistent=true` |
| `calllint-adoption-backup.service` | `Type=oneshot`, archive + upload, sweeps staging from `ExecStopPost=` |
| `calllint-adoption-backup.timer` | daily at **03:30 UTC**, `Persistent=true` |

## What the three steps are, and why the middle one matters

```
1. pnpm ingest:trust-index                    mirror the registry, resolve artifacts (R-4),
                                              compile evidence (R-5)  → writes .var/
2. pnpm project-adoption-index:trust-index    project the identity plane FROM THE COMMITTED
                                              SNAPSHOT → packages/trust-index/snapshots/
3. pnpm prune:cas                             delete CAS blobs older than CAS_RETENTION_DAYS,
                                              then sweep orphaned work/*.part staging files
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
#    Edit every pnpm ExecStart/ExecStopPost line, or symlink once:
sudo ln -s "$(which pnpm)" /usr/bin/pnpm

# 2. Install and enable the ingest pair. For the backup pair see the Backup section below —
#    it needs a credential file that does not exist yet.
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
(`tests/invariants/worker-deployment-unit.invariants.test.ts`) keeps this variable out of **every**
unit in this directory — the gate enumerates the directory rather than naming files, so the backup
unit is covered by the same assertion.

### The second growth surface: `work/*.part`

`prune:cas` sweeps two trees, not one. `cas/blobs` is bounded by the retention window above; the
surface nobody swept was the CAS staging directory. `cas.ts:85,88` removes a `work/<hex>.part` file
on both of its failure paths, but a `SIGKILL` between `writeFileSync` and the `rename` — which is
exactly what `MemoryMax=1G` or `TimeoutStartSec=45min` delivers — leaves it behind, and the blob
sweep never looks at `work/`.

The window is `CAS_STAGING_ORPHAN_HOURS=48`, in **hours**, not days. A staging file is live for as
long as it takes to write bytes and rename them; anything older than two full ingest cycles is an
orphan with certainty. Reusing the 90-day blob window would leave every orphan on disk for three
months, which is the growth this sweep exists to stop. Zero is refused rather than read as "sweep
everything" — a 0h window would delete the `.part` file a concurrent write is streaming into.

Only `*.part` is touched; anything else in `work/` is counted as `skipped` and left alone, so a
future writer putting something durable there is not swept by a sweep written before it existed.

## Backup (ADR 0061 §8.6)

```
1. pnpm backup:adoption-index                       VACUUM INTO .var/calllint-adoption-backup/
                                                    adoption-index-YYYY-MM-DD.sqlite
2. ossutil cp --update --recursive …                upload to oss://$OSS_BUCKET/adoption-index/
ExecStopPost: pnpm backup:adoption-index:prune-staging   delete every staged archive
```

**Only the database is archived.** It is the one thing under `.var/` holding facts that cannot be
rebuilt — `first_seen_at` on three tables is the timestamp of an observation nobody can observe
twice. CAS blobs are content-addressed downloads: losing one costs a re-fetch, not a fact. Shipping
them would also move the growth surface `prune:cas` exists to bound off this host and into object
storage, where the retention window is a console setting rather than a line in a unit file. That is
a decision recorded in §8.6, not an omission.

**`VACUUM INTO`, not a file copy.** The store runs in WAL mode, so `db/…sqlite` on disk is not a
complete database on its own: committed transactions live in `-wal` until a checkpoint. Copying the
three files while a writer runs yields a torn archive that only reveals itself when someone tries to
restore it.

**One object per day.** The archive is date-stamped, not timestamped, so "delete after N days" is a
sentence about the object key. A same-day re-run replaces the day's archive rather than leaving two
that age out independently.

### Prerequisites

`ossutil` is **not** installed by this repo. Install it from Aliyun and put it at `/usr/bin/ossutil`
(or edit the second `ExecStart`).

The credential lives in a root-only file that is **not in git**. Only the key names appear in this
repository:

```bash
sudo install -d -m 700 /etc/calllint
sudo tee /etc/calllint/backup.env >/dev/null <<'EOF'
OSS_BUCKET=…
OSS_ENDPOINT=…
OSS_ACCESS_KEY_ID=…
OSS_ACCESS_KEY_SECRET=…
EOF
sudo chown root:root /etc/calllint/backup.env
sudo chmod 600 /etc/calllint/backup.env
```

A missing file makes the unit fail at start, which is the correct outcome: a backup that silently ran
without a destination is worse than one that did not run. Use a RAM-scoped account with write access
to this bucket prefix only — the unit never reads and never deletes remote objects, so no other
permission is required. A machine gate asserts no unit file carries a credential *value*; it reports
the offending key name and never the value.

```bash
sudo cp calllint-adoption-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now calllint-adoption-backup.timer
```

### The window

03:30 UTC, one hour after the ingest's 02:30. The gap is not decoration: the worker's
`TimeoutStartSec=45min` bounds how long a run can hold the store, so 60 minutes puts the backup
outside the worst legal ingest even after both timers' `RandomizedDelaySec=5min`. Backing up
mid-ingest would still produce a *consistent* archive — `VACUUM INTO` snapshots a transaction, and
WAL readers do not block the writer — but it would capture a half-mirrored run, so the archive would
be valid SQLite holding a state no complete run ever produced. A machine gate asserts the gap in
minutes rather than pinning the two times, so either schedule may move as long as the separation
survives.

Neither timer sets `Timezone=`. Both are UTC, so the schedule cannot silently shift when the host's
zone changes.

### Local cleanup, and why it is unconditional

A staged archive is one full copy of the store per day — the largest single file this host would
grow, and the reason the cleanup exists. It is deleted **unconditionally**, with no window: the
archive exists only to be handed to object storage, and the copy that matters is the remote one.
Keeping N days locally would mean N SQLite copies on the disk this is meant to protect.

The sweep runs from `ExecStopPost=`, not as a third `ExecStart`. Under `Type=oneshot` a third
`ExecStart` would be **skipped** after any earlier failure — i.e. exactly when a stale archive is
most likely to be sitting there. `ExecStopPost=` fires on success, failure, and timeout alike.

An absent staging directory reports zeroes here rather than throwing, which is the deliberate
opposite of the `prune:cas` rule above. `work/` is created unconditionally by the ingest's step 1, so
its absence can only mean a wrong root; this directory is created by the backup's own first step, and
the sweep fires even when that step failed before creating anything. Throwing would turn "the
archive step already failed and said so" into a second, louder failure naming the wrong cause. The
mis-rooted guard lives in the archive step instead: it refuses to run when the database is absent,
because `openBetterSqlite3` *creates* the file when it is missing, and uploading a freshly-created
empty database under today's key would age a real archive out of the lifecycle window while reading
as a healthy backup the whole time.

### Remote retention

Configure this **once, in the OSS console** — nothing in this repo deletes a remote object, because
deleting remote state is irreversible and belongs behind a human decision:

| Prefix | Rule |
| --- | --- |
| `adoption-index/` | expire objects **90 days** after last modification |

The one-object-per-day key shape is what makes that rule legible: 90 objects, one per day, and "how
many days of history do we hold" is answerable from the key alone.

### Verify

```bash
systemctl list-timers calllint-adoption-backup.timer
sudo systemctl start calllint-adoption-backup.service
journalctl -u calllint-adoption-backup.service -n 60 --no-pager
ossutil ls oss://$OSS_BUCKET/adoption-index/ | tail -5
```

A successful run logs the archive path, then the upload, then a staging sweep whose `deleted` count
matches its `inspected` count. `failed` must be 0 — a partial sweep exits non-zero so it surfaces as
a unit failure rather than a quiet log line, the same rule `prune:cas` follows.

### Why the backup is its own unit, and not a fourth `ExecStart`

`Type=oneshot` runs `ExecStart` lines sequentially and **aborts the rest when one fails**. A backup
appended to the worker would therefore be skipped exactly when the ingest failed — the moment a
backup matters most. The converse is as bad: a credential failure would fail the whole ingest unit
and poison `prune:cas … failed 0`, which this file documents above as the worker's success criterion.

This is the same shape as the note under [Committing the result](#committing-the-result): a step that
needs its own credentials is a separate decision, not something bolted onto `ExecStart`.

## Resource caps and the co-tenant

The ingest unit takes `MemoryMax=1G`, `CPUQuota=50%`, `TasksMax=256`, `IOWeight=100` (ADR 0061 §8.3).
The backup unit is capped lower on purpose — `512M` / `25%` / `128` / `50` — because it reads a
database and streams one file where the ingest resolves artifacts and compiles evidence.

LORDL runs on the same host and stays running — that was decided on measured footprint, not
courtesy. Nothing in these units reads, copies, or references any path outside CallLint's own tree,
and `ProtectSystem=strict` + `ProtectHome=true` enforce it at the OS level. Exactly two paths are
writable: `/opt/calllint/.var` and `/opt/calllint/packages/trust-index/snapshots`. The backup unit
grants only the first — it rewrites no committed bytes, so granting the snapshots path would widen
the surface for nothing. A machine gate pins that allowed set for every unit in this directory,
because a unit that staged anything elsewhere would fail on the host, where no CI of ours is watching.

## Committing the result

These units do **not** push. They leave the refreshed snapshots in the working tree; the Actions
workflow remains the path that opens a PR. If this host should also commit, that is a separate
decision with its own credentials question — not something to bolt onto `ExecStart`.

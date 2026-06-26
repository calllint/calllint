# C056 — docker --mount type=volume (named volume, not bind) SAFE

Synthetic seed locking the ADR 0012 extractor's `type !== "bind"` skip.

`--mount type=volume,src=appdata,dst=/data` names a docker **named volume**, which
has no host path. The host-path extractor reads only `type=bind` mounts, so even
though this carries `src=appdata` it is correctly **not** flagged. Pinned image, no
env → **SAFE**. No prior case covered the `type=volume` branch; this proves the
extractor does not over-flag volume mounts. `allowExtraFindings: false`.

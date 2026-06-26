# C060 — docker --volume /root:/data (long-form) BLOCK

Synthetic seed locking the ADR 0012 extractor's **`--volume` long-form (next-token)**
branch — the alias complement to C055's `-v` short-form. The `arg === "--volume"`
branch reads the next token `/root:/data` as the spec; `dockerVolumeHostSide` splits
the broad host side `/root` from container `/data` → `files.broad-path` (blocker) →
**BLOCK**. `thisCaseMustNeverBeSafe: true`. The 60th corpus case.

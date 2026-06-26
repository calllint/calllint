# C057 — docker --mount type=bind,source=/var,target=/data BLOCK (source/target aliases)

Synthetic seed locking the ADR 0012 extractor's docker key aliases. docker accepts
both `src=` and `source=` for the host side, and `dst=`/`target=`/`destination=` for
the container side. C023 uses `src=`/`dst=`; this uses **`source=`/`target=`** with a
broad host root `/var`. The extractor reads `fields.get("source") ?? fields.get("src")`,
so `/var` is extracted and flagged broad → `files.broad-path` (blocker) → **BLOCK**.
The container `target=/data` is never flagged. `thisCaseMustNeverBeSafe: true`.

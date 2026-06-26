# C058 — docker -v ${workspaceFolder}/data:/data SAFE (-v scoped negative)

Synthetic seed locking the **-v branch's workspace-scoped negative** — the SAFE
companion to C055/C060 (broad `-v` binds → BLOCK). The `-v` host side is
`${workspaceFolder}/data`, which `looksLikeBroadPath` rejects via `isWorkspaceScoped`.
`dockerVolumeHostSide` extracts the host side, but it is not broad, so
`files.broad-path` does **not** fire → **SAFE**. Proves the `-v` extractor honors
workspace-scoping and does not over-flag legitimate workspace mounts.
`allowExtraFindings: false`.

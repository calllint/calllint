# Release verification

How to verify a *published* CallLint artifact on the public npm registry, and how
to correct the known dist-tag drift. This runs after a release is published; it
complements [release-checklist.md](./release-checklist.md) (the pre-tag gate).

CallLint never executes a scanned server; none of these steps run untrusted code.

## 1. Package identity & dist-tags

```bash
npm view calllint version dist-tags repository homepage --registry=https://registry.npmjs.org/
```

Expected at the current preview stage:

```text
dist-tags = { preview: '0.3.0-preview.1', latest: '0.3.0-preview.0' }
```

- `preview` must point at the newest published preview.
- `repository` must be `git+https://github.com/calllint/calllint.git`.
- `homepage` must be `https://calllint.com`.

### Known dist-tag drift

`latest` currently points at `0.3.0-preview.0`. It was published before the
release workflow derived dist-tags from the version, so the first preview claimed
the default `latest` tag. A preview should not occupy `latest`.

We intentionally **do not** retag now (npm always keeps a `latest`; pointing it
at a different preview is not an improvement). The drift is corrected at the
first stable release, by pointing `latest` at the stable version:

```bash
# Run only when 0.3.0 (stable, no hyphen) is published:
npm dist-tag add calllint@0.3.0 latest --registry=https://registry.npmjs.org/
npm dist-tag ls calllint --registry=https://registry.npmjs.org/   # verify
```

Until then, document `npx calllint@preview` as the install path for the newest
preview.

## 2. Provenance & signatures

Trusted Publishing (OIDC) generates build provenance automatically. Verify the
published artifact's registry signatures and provenance attestations:

```bash
mkdir -p /tmp/calllint-verify && cd /tmp/calllint-verify
npm init -y >/dev/null
npm install calllint@preview --registry=https://registry.npmjs.org/
npm audit signatures
```

`npm audit signatures` should report a verified registry signature and, for
trusted-publishing releases, a verified provenance attestation.

## 3. Clean-environment smoke

Confirm the published package installs and runs from a throwaway environment:

```bash
cd /tmp/calllint-verify
npx --yes calllint@preview --help
npx --yes calllint@preview scan .cursor/mcp.json --json
echo "exit: $?"   # 0 SAFE · 10 REVIEW · 20 UNKNOWN · 30 BLOCK
```

The bundle must be self-contained (zero runtime dependencies) and never reach the
network on a default (offline) scan.

## 4. Cross-surface consistency

The same facts must hold across npm, GitHub, and the website:

- [ ] npm version == git tag (`v<version>`) == `apps/cli/package.json` version.
- [ ] npm `repository`/`homepage` point at `calllint/calllint` and calllint.com.
- [ ] The published tarball contains only the `files` allowlist (`dist`,
      `LICENSE`, `NOTICE`, `logo-mark-128.png`) — no tests, corpus, or
      `.github`.
- [ ] A GitHub Release exists for the tag with notes from `docs/releases/`.

/**
 * In-test registry/API fixtures for the P1 evidence resolvers (PR-06).
 * Named to mirror the §FIX evidence fixture classes:
 *   npm-valid-provenance · npm-no-provenance · missing-version · repository-mismatch.
 * These are hand-built minimal docs; the full 100-object golden corpus is P1-G.
 */
import type { FetchJson, FetchText } from "../../src/evidence/resolverInterface.js"

/** Build a fetchJson that returns `docs[url]`, else throws (network-absent). */
export function fakeFetchJson(docs: Record<string, unknown>): {
  fetch: FetchJson
  calls: string[]
} {
  const calls: string[] = []
  const fetch: FetchJson = async (url: string) => {
    calls.push(url)
    if (url in docs) return docs[url]
    throw new Error(`no fixture for ${url}`)
  }
  return { fetch, calls }
}

/** A fetchJson that always rejects — models a network outage. */
export const failingFetch: FetchJson = async (url: string) => {
  throw new Error(`network down: ${url}`)
}

const NPM = (name: string) => `https://registry.npmjs.org/${name.replace(/\//g, "%2f")}`

/** npm-valid-provenance: pinned version, repo, integrity, and attestations. */
export function npmValidProvenance(): Record<string, unknown> {
  return {
    [NPM("good-pkg")]: {
      name: "good-pkg",
      "dist-tags": { latest: "1.2.3" },
      repository: { type: "git", url: "git+https://github.com/acme/good-pkg.git" },
      versions: {
        "1.2.3": {
          name: "good-pkg",
          version: "1.2.3",
          repository: { url: "git+https://github.com/acme/good-pkg.git" },
          dist: {
            integrity: "sha512-abc",
            shasum: "deadbeef",
            attestations: { url: "https://registry.npmjs.org/-/npm/v1/attestations/good-pkg@1.2.3" },
          },
        },
      },
    },
  }
}

/** npm-no-provenance: pinned + repo + integrity but NO attestations/signatures. */
export function npmNoProvenance(): Record<string, unknown> {
  return {
    [NPM("bare-pkg")]: {
      name: "bare-pkg",
      "dist-tags": { latest: "0.1.0" },
      repository: "https://github.com/acme/bare-pkg",
      versions: {
        "0.1.0": {
          name: "bare-pkg",
          version: "0.1.0",
          dist: { integrity: "sha512-xyz" },
        },
      },
    },
  }
}

/** missing-version: package exists but the requested version was never published. */
export function npmMissingVersion(): Record<string, unknown> {
  return {
    [NPM("partial-pkg")]: {
      name: "partial-pkg",
      "dist-tags": { latest: "2.0.0" },
      versions: { "2.0.0": { name: "partial-pkg", version: "2.0.0", dist: { integrity: "sha512-q" } } },
    },
  }
}

/** package-not-found: registry has no such document (empty versions). */
export function npmNotFound(): Record<string, unknown> {
  return { [NPM("ghost-pkg")]: { name: "ghost-pkg", versions: {} } }
}

/** A public GitHub repo API doc. */
export function githubRepo(): Record<string, unknown> {
  return {
    "https://api.github.com/repos/acme/good-pkg": {
      full_name: "acme/good-pkg",
      default_branch: "main",
      private: false,
      owner: { login: "acme" },
    },
  }
}

/** GitHub "Not Found" body (404-style). */
export function githubNotFound(): Record<string, unknown> {
  return { "https://api.github.com/repos/acme/missing": { message: "Not Found" } }
}

/** A fetchText that returns `files[url]`, undefined if absent (404), throws only if flagged. */
export function fakeFetchText(files: Record<string, string | undefined>): {
  fetch: FetchText
  calls: string[]
} {
  const calls: string[] = []
  const fetch: FetchText = async (url: string) => {
    calls.push(url)
    return url in files ? files[url] : undefined
  }
  return { fetch, calls }
}

const REG = "https://registry.modelcontextprotocol.io/v0/servers"
const OFFICIAL = "io.modelcontextprotocol.registry/official"

/** A registry body with one active+latest server carrying a repository. */
export function registryBody(repoUrl = "https://github.com/acme/good-pkg"): Record<string, unknown> {
  return {
    [REG]: {
      servers: [
        {
          server: {
            name: "io.acme/good-server",
            description: "a server",
            version: "1.2.3",
            repository: { url: repoUrl },
          },
          _meta: { [OFFICIAL]: { status: "active", isLatest: true, publishedAt: "2026-01-01" } },
        },
      ],
    },
  }
}

/** A well-known publisher file for a verified domain. */
export function wellKnownFiles(publisher = "acme"): Record<string, string | undefined> {
  return {
    "https://acme.com/.well-known/mcp-publisher.json": JSON.stringify({ publisher }),
  }
}

/** A static tool manifest with two tools; first fully-annotated, second sparse. */
export function toolManifest(): Record<string, unknown> {
  return {
    "https://example.com/tools.json": {
      tools: [
        {
          name: "read_file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "delete_all",
          annotations: { destructiveHint: true }, // incomplete hints, no schema
        },
      ],
    },
  }
}

/** A remote-endpoint well-known descriptor with owner + auth model. */
export function remoteDescriptor(): Record<string, string | undefined> {
  return {
    "https://api.acme.com/.well-known/mcp.json": JSON.stringify({
      owner: "acme",
      authModel: "oauth2",
    }),
  }
}

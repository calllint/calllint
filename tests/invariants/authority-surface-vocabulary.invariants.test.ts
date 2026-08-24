/**
 * new19 Amendment — Codex First-Class Harness Authority
 *
 * new19 explicitly requires Codex be modelled as a harness exposing MCP, tool, filesystem,
 * shell and plugin authorities rather than as a model exposing code-generation and API
 * attributes. This test enforces the broader principle: `authoritySurfaces` must describe
 * what a host can GRANT (an authority surface), not what a host IS or PRODUCES.
 *
 * The concrete defect was: codex carried `["code-generation", "api", "mcp"]`. Those are
 * model attributes — what codex produces — not authorities. A security scanner must know
 * what authority a server would be granted if it ran there, and `code-generation` is not a
 * grantable authority: no MCP server receives the "generate code" capability from being
 * loaded into a host. But it DOES receive shell, filesystem, plugin reach from being loaded
 * into a LOCAL AGENT. The harness-vs-model distinction matters for the threat model.
 *
 * WHAT THIS TEST GUARDS.
 * 1. The schema enum excludes `api` and `code-generation` — making the class unrepresentable.
 * 2. No host uses either term (the live SSOT invariant).
 * 3. Negative controls: injecting either term fails schema validation (the enum works).
 *
 * WHY THE ENUM, NOT ONLY A DENYLIST.
 * A denylist (asserting `!includes("api")`) would red only the TWO known model attributes.
 * Closing the enum reds ANY model attribute someone adds later. The description explains why:
 * a new term that has never been reviewed by the risk model must not silently enter the SSOT.
 * The harness-vs-model distinction is one case; other cases may appear.
 *
 * WHO USES WHAT, POST-FIX. The enum permits 10 terms: cli, exec, extensions, filesystem,
 * mcp, plugins, shell, skills, tools, vscode-extensions. `api` and `code-generation` have
 * zero users after the fix and are excluded to make the model-attribute class unrepresentable.
 * `cli` remains (copilot-cli), though it is borderline — it describes a delivery form rather
 * than an authority. A follow-on could challenge it, but that's scope creep beyond the Codex
 * fix.
 *
 * ANTI-VACUITY. The premise is that at least one host carries authoritySurfaces. If zero do,
 * the exclusion is meaningless. Asserted first.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8")
const readJson = (rel: string) => JSON.parse(read(rel))

const SSOT_PATH = "apps/web/data/distribution-surfaces.json"
const SCHEMA_PATH = "apps/web/data/distribution-surfaces.schema.json"

interface Host {
  id: string
  authoritySurfaces?: string[]
}
const ssot: { hosts: Host[] } = readJson(SSOT_PATH)
const schema = readJson(SCHEMA_PATH)

describe("premise", () => {
  it("has at least one host with authoritySurfaces", () => {
    const withAuth = ssot.hosts.filter((h) => h.authoritySurfaces && h.authoritySurfaces.length > 0)
    expect(withAuth.length).toBeGreaterThan(0)
  })
})

describe("schema enum excludes model attributes", () => {
  it("authoritySurfaces enum exists and is a closed list", () => {
    const hostDef = schema.definitions?.host?.properties?.authoritySurfaces
    expect(hostDef, "authoritySurfaces not found at definitions.host.properties").toBeDefined()
    expect(hostDef.items.enum).toBeInstanceOf(Array)
    expect(hostDef.items.enum.length).toBeGreaterThan(0)
  })

  it('excludes "api" — a model attribute, not an authority', () => {
    const enumValues: string[] = schema.definitions.host.properties.authoritySurfaces.items.enum
    expect(
      enumValues.includes("api"),
      '"api" describes what a model produces, not what authority a host grants. Removing it makes the model-attribute class unrepresentable.',
    ).toBe(false)
  })

  it('excludes "code-generation" — a model attribute, not an authority', () => {
    const enumValues: string[] = schema.definitions.host.properties.authoritySurfaces.items.enum
    expect(
      enumValues.includes("code-generation"),
      '"code-generation" describes what a model produces, not what authority a host grants.',
    ).toBe(false)
  })
})

describe("no host uses model attributes", () => {
  it("no host carries api or code-generation in authoritySurfaces", () => {
    for (const h of ssot.hosts) {
      if (!h.authoritySurfaces) continue
      expect(
        h.authoritySurfaces.includes("api"),
        `host ${h.id} uses "api" — a model attribute. See new19 for why this is a defect.`,
      ).toBe(false)
      expect(
        h.authoritySurfaces.includes("code-generation"),
        `host ${h.id} uses "code-generation" — a model attribute`,
      ).toBe(false)
    }
  })
})

describe("negative controls — injecting a banned term fails validation", () => {
  // Same options every other validator in this repo uses: the schema declares
  // `format: "date"`, which Ajv does not know without ajv-formats, and strict mode
  // would reject the whole schema over it rather than the thing under test.
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false })
  const validate = ajv.compile(schema)

  it("M1: injecting api into codex fails schema validation", () => {
    const mutated = JSON.parse(JSON.stringify(ssot))
    const codex = mutated.hosts.find((h: Host) => h.id === "codex")
    expect(codex, "codex not found — test cannot inject").toBeDefined()
    if (codex.authoritySurfaces && !codex.authoritySurfaces.includes("api")) {
      codex.authoritySurfaces.push("api")
    }
    const valid = validate(mutated)
    expect(
      valid,
      'injecting "api" passed validation — the enum does not exclude it, or validation is not running',
    ).toBe(false)
    expect(validate.errors, "no validation errors reported").toBeDefined()
  })

  it("M2: injecting code-generation into codex fails schema validation", () => {
    const mutated = JSON.parse(JSON.stringify(ssot))
    const codex = mutated.hosts.find((h: Host) => h.id === "codex")
    expect(codex).toBeDefined()
    if (codex.authoritySurfaces && !codex.authoritySurfaces.includes("code-generation")) {
      codex.authoritySurfaces.push("code-generation")
    }
    const valid = validate(mutated)
    expect(
      valid,
      'injecting "code-generation" passed validation — the enum does not exclude it',
    ).toBe(false)
    expect(validate.errors).toBeDefined()
  })

  it("baseline: unmodified SSOT passes validation", () => {
    const valid = validate(ssot)
    expect(valid, "SSOT fails its own schema — fix the SSOT or the schema first").toBe(true)
  })
})

/**
 * new19 names the five authorities Codex must carry. Each is grounded in the openai/codex
 * implementation, not in new19's prose — the doc pages are stubs pointing at a host that
 * returns 403, so the source is the evidence:
 *
 *   mcp         codex-rs/core/src/tools/handlers/mcp.rs; config/src/mcp_edit.rs reads the
 *               `mcp_servers` table out of config.toml
 *   shell       handlers/shell_spec.rs, handlers/unified_exec.rs, runtimes/zsh_fork.rs
 *   filesystem  handlers/apply_patch.rs
 *   plugins     codex-rs/plugin/ (9 files), handlers/list_available_plugins_to_install.rs
 *   tools       tools/handlers/ generally, plus dynamic.rs and extension_tools.rs
 */
describe("new19 — codex carries the five harness authorities", () => {
  const codex = ssot.hosts.find((h) => h.id === "codex")

  it("codex exists in the SSOT", () => {
    expect(codex, "codex host missing — new19 requires it as a first-class harness").toBeDefined()
  })

  it.each(["mcp", "tools", "filesystem", "shell", "plugins"])(
    "declares %s authority",
    (surface) => {
      expect(
        codex?.authoritySurfaces?.includes(surface),
        `codex omits "${surface}". new19 requires MCP, tool, filesystem, shell and extension authority; each is evidenced in openai/codex (see this block's docblock).`,
      ).toBe(true)
    },
  )

  it("declares a real config path, not a placeholder", () => {
    const evidence = (codex as unknown as { configEvidence?: string[] })?.configEvidence ?? []
    expect(evidence.length).toBeGreaterThan(0)
    const joined = evidence.join(" ")
    expect(
      /config\.toml/.test(joined),
      "codex configEvidence names no config.toml. codex-rs/config/src/lib.rs:40 defines CONFIG_TOML_FILE = \"config.toml\", joined to codex_home (CODEX_HOME, default ~/.codex).",
    ).toBe(true)
    for (const e of evidence) {
      expect(
        /requires verification|unknown|tbd/i.test(e),
        `configEvidence entry "${e}" is a placeholder, not a path. The path is documented in the vendor's own repo; a placeholder here understates what CallLint knows.`,
      ).toBe(false)
    }
  })
})

#!/usr/bin/env node
/**
 * Harness distribution truth gate.
 *
 * Validates that harness public pages advertise only commands that exist in the shipped
 * product, and that support-class claims match registered extractors. This is the gate
 * that keeps `--agent <id>` on a public page from naming a type the CLI does not have.
 *
 * SUBJECT: `apps/web/data/distribution-surfaces.json` — the single distribution SSOT.
 *
 * It used to read `apps/web/data/harness-surfaces.json`, a second, hand-maintained file
 * with an older ontology (P0/P1 cohorts, `deepSeekIntegrationObserved`, 8 hosts). Two
 * independent files describing one cohort is a forbidden state: nothing compared them, so
 * they drifted silently and this gate audited 8 of 15 hosts while reading green. The
 * seven it never saw included every DISCOVERY_ONLY and DEFERRED host — precisely the
 * classes whose claims most need checking, since those are the ones that must NOT
 * advertise an `--agent` command.
 *
 * Field names differ between the two ontologies and that difference is load-bearing:
 * the legacy file used `calllintSupportClass` (singular) and `truthfulCommand` (a string);
 * the SSOT uses `supportClass` and `truthfulCommands` (an array). Reading the SSOT with
 * the legacy names yields `undefined` for every host, which makes every branch below
 * unreachable and the gate vacuous — it would print "PASSED" having asserted nothing.
 * `assertCohortShape()` exists to make that failure loud instead of silent.
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks failed
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const DATA_FILE = path.join(repoRoot, "apps/web/data/distribution-surfaces.json")
const TYPES_FILE = path.join(repoRoot, "packages/discovery/src/types.ts")
const BOOTSTRAP_FILE = path.join(repoRoot, "packages/discovery/src/bootstrap.ts")

let failed = false

function fail(msg) {
  console.error(`❌ ${msg}`)
  failed = true
}

function pass(msg) {
  console.log(`✅ ${msg}`)
}

// Read harness data
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
const typesContent = fs.readFileSync(TYPES_FILE, "utf8")
const bootstrapContent = fs.readFileSync(BOOTSTRAP_FILE, "utf8")

// Extract registered agent types from types.ts
const agentTypeMatch = typesContent.match(/export type AgentType =\s*\n([^]*?)\n\s*$/m)
if (!agentTypeMatch) {
  fail("Could not parse AgentType from types.ts")
  process.exit(1)
}

const agentTypeLines = agentTypeMatch[1].split("\n")
const registeredTypes = new Set()
for (const line of agentTypeLines) {
  const match = line.match(/"([^"]+)"/)
  if (match) {
    registeredTypes.add(match[1])
  }
}

// Extract bootstrapped extractors from bootstrap.ts
const extractorMatches = bootstrapContent.matchAll(/registry\.register\(new (\w+)Extractor\(\)\)/g)
const bootstrappedExtractors = new Set()

// Manual mapping for multi-word class names
const classToAgentType = {
  "Cursor": "cursor",
  "ClaudeCode": "claude-code",
  "ClaudeDesktop": "claude-desktop",
  "WorkBuddy": "workbuddy",
  "VSCode": "vscode",
  "Windsurf": "windsurf",
  "QwenCode": "qwen-code",
  "OpenClaw": "openclaw",
  "OpenCode": "opencode",
}

for (const match of extractorMatches) {
  const className = match[1]
  const agentType = classToAgentType[className]
  if (agentType) {
    bootstrappedExtractors.add(agentType)
  }
}

console.log("\n=== Harness Distribution Truth Gate ===\n")

const SUPPORT_CLASSES = new Set(["NATIVE", "CONFIG_SCAN", "DISCOVERY_ONLY", "DEFERRED"])

/*
 * Anti-vacuity. Every assertion below is guarded by `supportClass === "..."`, so if the
 * field is missing or misspelled, no branch runs and the gate exits 0 having checked
 * nothing. A renamed field in the SSOT must red this gate, not silence it.
 */
function assertCohortShape(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    fail(`${path.basename(DATA_FILE)}: hosts[] is missing or empty — nothing to audit`)
    process.exit(1)
  }
  const noClass = hosts.filter((h) => !SUPPORT_CLASSES.has(h.supportClass))
  if (noClass.length > 0) {
    fail(
      `${noClass.length}/${hosts.length} hosts have no recognized supportClass ` +
        `(got: ${[...new Set(noClass.map((h) => JSON.stringify(h.supportClass)))].join(", ")}). ` +
        `Every assertion in this gate is keyed on supportClass, so this would make it vacuous.`,
    )
    process.exit(1)
  }
  console.log(
    `Auditing ${hosts.length} hosts from ${path.relative(repoRoot, DATA_FILE)}: ` +
      Object.entries(
        hosts.reduce((a, h) => ((a[h.supportClass] = (a[h.supportClass] || 0) + 1), a), {}),
      )
        .map(([k, v]) => `${v} ${k}`)
        .join(", "),
  )
}

const hosts = data.hosts
assertCohortShape(hosts)

// Check each host
{
  for (const host of hosts) {
    const { id, displayName, supportClass: calllintSupportClass } = host
    // The SSOT holds an array; every assertion below is about whether ANY advertised
    // command makes a claim, so flatten and test the joined text plus each element.
    const commands = Array.isArray(host.truthfulCommands)
      ? host.truthfulCommands
      : host.truthfulCommands
        ? [host.truthfulCommands]
        : []
    const truthfulCommand = commands.join(" ; ")

    console.log(`\nChecking: ${displayName} (${id}) [${calllintSupportClass}]`)

    // HD-01: NATIVE support must have registered extractor
    if (calllintSupportClass === "NATIVE") {
      if (!registeredTypes.has(id)) {
        fail(`${id}: marked NATIVE but AgentType "${id}" not in types.ts`)
      } else {
        pass(`${id}: AgentType registered`)
      }

      if (!bootstrappedExtractors.has(id)) {
        fail(`${id}: marked NATIVE but extractor not registered in bootstrap.ts`)
      } else {
        pass(`${id}: Extractor bootstrapped`)
      }

      if (!truthfulCommand || !truthfulCommand.includes(`--agent ${id}`)) {
        fail(`${id}: marked NATIVE but truthfulCommand does not match pattern "--agent ${id}"`)
      } else {
        pass(`${id}: Truthful command matches NATIVE support`)
      }
    }

    // HD-02: DISCOVERY_ONLY must not have fake CLI command
    if (calllintSupportClass === "DISCOVERY_ONLY") {
      if (truthfulCommand && truthfulCommand.includes("--agent")) {
        fail(`${id}: marked DISCOVERY_ONLY but advertises --agent command`)
      } else {
        pass(`${id}: DISCOVERY_ONLY correctly shows no auto-discovery command`)
      }
    }

    // HD-03: DEFERRED means no support is claimed yet, so it must advertise no command
    // at all. Previously unreachable: all three DEFERRED hosts live outside the legacy
    // file this gate used to read.
    if (calllintSupportClass === "DEFERRED") {
      if (commands.length > 0) {
        fail(`${id}: marked DEFERRED but advertises ${commands.length} command(s): ${truthfulCommand}`)
      } else {
        pass(`${id}: DEFERRED correctly advertises no command`)
      }
    }

    // HD-04: CONFIG_SCAN scans a path the user names; it must NOT imply auto-detection.
    if (calllintSupportClass === "CONFIG_SCAN") {
      if (truthfulCommand.includes("--agent")) {
        fail(`${id}: marked CONFIG_SCAN but advertises --agent (implies auto-detection)`)
      } else if (commands.length === 0) {
        fail(`${id}: marked CONFIG_SCAN but advertises no command at all`)
      } else {
        pass(`${id}: CONFIG_SCAN advertises an explicit-path command`)
      }
    }

    // Host command must be truthful — every advertised command, not just the first.
    for (const cmd of commands) {
      for (const m of String(cmd).matchAll(/--agent\s+([^\s"';]+)/g)) {
        const agentArg = m[1]
        if (!registeredTypes.has(agentArg)) {
          fail(`${id}: advertises "--agent ${agentArg}" but that type does not exist`)
        }
      }
    }
  }
}

/*
 * HD-05: a recorded blocker and the state label must agree, in BOTH directions.
 *
 * This exists because they once did not. Four channels carried a `blocker` saying
 * submission is impossible or explicitly rejected, while their state said
 * READY_NOT_SUBMITTED / AUDIT_REQUIRED — which the public projections print as
 * "Not yet submitted" / "Listing not yet verified", i.e. as PENDING. The blocker text
 * reached the HTML, so nothing was concealed from a human reading the whole row; but
 * `state` is the field machines consume, and in agent-discovery-index.json the blocker
 * is not carried at all, so an agent saw "unverified" with no way to learn "impossible".
 *
 * Both directions are load-bearing:
 *   blocker ⇒ BLOCKED   stops a known-impossible channel from reading as pending work.
 *   BLOCKED ⇒ blocker   stops BLOCKED from becoming a verdict with no recorded reason,
 *                       which is the same evidence-free claim in the other direction.
 *
 * The denominator is pinned before the claim: this gate must not be able to report
 * agreement because it found no channels to compare.
 */
{
  console.log("\nChecking: distribution channel blocker/state agreement [HD-05]")

  const channels = hosts.flatMap((h) =>
    (Array.isArray(h.distributionPrimitives) ? h.distributionPrimitives : []).map((p) => ({
      host: h.id,
      ...p,
    })),
  )

  if (channels.length === 0) {
    fail(
      `${path.basename(DATA_FILE)}: no distributionPrimitives found across ${hosts.length} hosts — ` +
        `HD-05 compares blocker against state, so this would make it vacuous`,
    )
  } else {
    const contradictions = channels.filter((c) => c.blocker && c.state !== "BLOCKED")
    const unexplained = channels.filter((c) => c.state === "BLOCKED" && !c.blocker)

    for (const c of contradictions) {
      fail(
        `${c.host}/${c.kind}: declares a blocker but state is ${c.state}, not BLOCKED — ` +
          `the public label would read as pending while the blocker says otherwise`,
      )
    }
    for (const c of unexplained) {
      fail(`${c.host}/${c.kind}: state is BLOCKED but records no blocker explaining why`)
    }

    if (contradictions.length === 0 && unexplained.length === 0) {
      const blocked = channels.filter((c) => c.state === "BLOCKED").length
      pass(
        `${channels.length} channels checked; ${blocked} BLOCKED, each with a recorded blocker, ` +
          `and no blocker recorded outside BLOCKED`,
      )
    }
  }
}

console.log("\n=== Summary ===\n")

if (failed) {
  console.error("❌ Harness distribution truth gate FAILED")
  process.exit(1)
} else {
  console.log("✅ All harness distribution checks PASSED")
  process.exit(0)
}
